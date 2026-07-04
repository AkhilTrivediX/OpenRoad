import type { ExternalObjectMapping, IntegrationInstallation } from "../src/integrations/adapter.js";
import {
  syncOpenRoadRequestFromGitHubIssue,
  type GitHubIssue
} from "../src/integrations/github.js";
import {
  openRoadReducer,
  type OpenRoadState,
  type Workspace
} from "../src/domain/openroad.js";
import {
  parseIntegrationState,
  type IntegrationState,
  type IntegrationStore,
  type IntegrationSyncJob
} from "./integrations.js";
import {
  GitHubAppClientError,
  type GitHubAppClient,
  type GitHubAppConfig
} from "./github-app.js";
import { parseOpenRoadState, type OpenRoadStore } from "./store.js";
import type { IntegrationSyncWorker, IntegrationSyncWorkerResult } from "./sync-jobs.js";

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type GitHubIntegrationSyncWorkerOptions = {
  githubAppClient: GitHubAppClient;
  integrationStore: IntegrationStore;
  now?: () => Date;
  runIntegrationMutationExclusive: ExclusiveRunner;
  store: OpenRoadStore;
};

type GitHubSyncPlan = {
  installation: IntegrationInstallation;
  targets: GitHubIssueSyncTarget[];
};

type GitHubIssueSyncTarget = {
  issueNumber: number;
  mappingId: string;
  owner: string;
  repo: string;
};

type FetchedGitHubIssues = {
  issuesByMappingId: Map<string, GitHubIssue>;
  missingMappingIds: Set<string>;
  targetMappingIds: Set<string>;
};

type GitHubSyncApplyResult = {
  missing: number;
  skipped: number;
  synced: number;
};

export function canConfigureGitHubIntegrationSyncWorker(config: GitHubAppConfig) {
  return Boolean(config.appId && (config.privateKey || config.privateKeyFile));
}

export function createGitHubIntegrationSyncWorker({
  githubAppClient,
  integrationStore,
  now = () => new Date(),
  runIntegrationMutationExclusive,
  store
}: GitHubIntegrationSyncWorkerOptions): IntegrationSyncWorker {
  return {
    async process(job) {
      if (job.provider !== "github") {
        return fatalResult("GitHub sync worker cannot process this provider.");
      }

      try {
        const plan = await runIntegrationMutationExclusive(async () =>
          createGitHubSyncPlan((await integrationStore.load()).state, job)
        );

        if (plan.targets.length === 0) {
          return successResult(`No active GitHub issue mappings to sync for installation ${plan.installation.id}.`);
        }

        const fetchedIssues = await fetchMappedGitHubIssues(githubAppClient, plan);
        const applied = await runIntegrationMutationExclusive(async () =>
          applyGitHubIssueSync({
            fetchedIssues,
            integrationStore,
            job,
            now: now().toISOString(),
            store
          })
        );

        return successResult(
          `Synced ${applied.synced} GitHub issue mapping${applied.synced === 1 ? "" : "s"}; ${applied.missing} missing from live response; ${applied.skipped} skipped.`
        );
      } catch (error) {
        return mapGitHubSyncError(error);
      }
    }
  };
}

function createGitHubSyncPlan(state: IntegrationState, job: IntegrationSyncJob): GitHubSyncPlan {
  const installation = findActiveGitHubInstallation(state, job);
  const mappings = findGitHubIssueMappings(state, job, installation);

  if (job.mappingId && mappings.length === 0) {
    throw new GitHubSyncWorkerError(
      "fatal-error",
      "GitHub sync mapping was not found or is not active."
    );
  }

  return {
    installation,
    targets: mappings.map(getIssueSyncTarget)
  };
}

async function fetchMappedGitHubIssues(
  githubAppClient: GitHubAppClient,
  plan: GitHubSyncPlan
) {
  const issuesByMappingId = new Map<string, GitHubIssue>();
  const missingMappingIds = new Set<string>();
  const targetMappingIds = new Set(plan.targets.map((target) => target.mappingId));

  for (const target of plan.targets) {
    try {
      issuesByMappingId.set(
        target.mappingId,
        await githubAppClient.getRepositoryIssue({
          installationId: getGitHubApiInstallationId(plan.installation.id),
          issueNumber: target.issueNumber,
          owner: target.owner,
          repo: target.repo
        })
      );
    } catch (error) {
      if (error instanceof GitHubAppClientError && error.code === "github_api_error" && error.status === 404) {
        missingMappingIds.add(target.mappingId);
        continue;
      }

      throw error;
    }
  }

  return {
    issuesByMappingId,
    missingMappingIds,
    targetMappingIds
  };
}

async function applyGitHubIssueSync({
  integrationStore,
  fetchedIssues,
  job,
  now,
  store
}: {
  integrationStore: IntegrationStore;
  fetchedIssues: FetchedGitHubIssues;
  job: IntegrationSyncJob;
  now: string;
  store: OpenRoadStore;
}): Promise<GitHubSyncApplyResult> {
  const [openRoadResult, integrationResult] = await Promise.all([
    store.load(),
    integrationStore.load()
  ]);
  const installation = findActiveGitHubInstallation(integrationResult.state, job);
  const mappings = findGitHubIssueMappings(integrationResult.state, job, installation).filter((mapping) =>
    fetchedIssues.targetMappingIds.has(mapping.id)
  );

  if (job.mappingId && mappings.length === 0) {
    throw new GitHubSyncWorkerError(
      "fatal-error",
      "GitHub sync mapping changed before it could be updated."
    );
  }

  let nextOpenRoadState = openRoadResult.state;
  let nextMappings = integrationResult.state.mappings;
  let missing = 0;
  let skipped = 0;
  let synced = 0;

  for (const mapping of mappings) {
    const issue = fetchedIssues.issuesByMappingId.get(mapping.id);
    if (!issue) {
      missing += 1;
      continue;
    }

    const workspace = findWorkspace(nextOpenRoadState, mapping);
    const request = workspace?.requests.find((item) => item.id === mapping.openRoad.id);

    if (!workspace || !request || mapping.openRoad.type !== "request") {
      skipped += 1;
      continue;
    }

    nextOpenRoadState = parseOpenRoadState(
      openRoadReducer(nextOpenRoadState, {
        request: syncOpenRoadRequestFromGitHubIssue(request, issue, now),
        type: "replace-request",
        workspaceId: workspace.id
      })
    );
    nextMappings = nextMappings.map((item) =>
      item.id === mapping.id ? { ...item, lastSyncedAt: now } : item
    );
    synced += 1;
  }

  if (synced > 0) {
    await store.replaceState(nextOpenRoadState);
    await integrationStore.replaceState(
      parseIntegrationState({
        ...integrationResult.state,
        mappings: nextMappings
      })
    );
  }

  return { missing, skipped, synced };
}

function findActiveGitHubInstallation(state: IntegrationState, job: IntegrationSyncJob) {
  const installation = state.installations.find(
    (item) =>
      item.provider === "github" &&
      item.workspaceId === job.workspaceId &&
      doesGitHubInstallationIdMatch(item.id, job.installationId)
  );

  if (!installation) {
    throw new GitHubSyncWorkerError("fatal-error", "GitHub installation was not found.");
  }

  if (installation.status !== "active") {
    throw new GitHubSyncWorkerError("fatal-error", "GitHub installation is not active.");
  }

  if (!installation.permissions.includes("read:external")) {
    throw new GitHubSyncWorkerError("fatal-error", "GitHub installation cannot read issues.");
  }

  return installation;
}

function findGitHubIssueMappings(
  state: IntegrationState,
  job: IntegrationSyncJob,
  installation: IntegrationInstallation
) {
  return state.mappings.filter(
    (mapping) =>
      mapping.status === "active" &&
      mapping.external.provider === "github" &&
      mapping.external.type === "issue" &&
      mapping.openRoad.workspaceId === job.workspaceId &&
      mapping.installationId === installation.id &&
      (!job.mappingId || mapping.id === job.mappingId)
  );
}

function findWorkspace(state: OpenRoadState, mapping: ExternalObjectMapping): Workspace | undefined {
  return state.workspaces.find((workspace) => workspace.id === mapping.openRoad.workspaceId);
}

function getIssueSyncTarget(mapping: ExternalObjectMapping): GitHubIssueSyncTarget {
  const issueRef = getIssueRefFromKey(mapping.external.key) ?? getIssueRefFromUrl(mapping.external.url);

  if (!issueRef) {
    throw new GitHubSyncWorkerError(
      "fatal-error",
      "GitHub issue mapping does not include a repository issue reference."
    );
  }

  return { ...issueRef, mappingId: mapping.id };
}

function getIssueRefFromKey(value: string | undefined) {
  const key = value?.trim();
  const hashIndex = key?.lastIndexOf("#") ?? -1;
  if (!key || hashIndex <= 0) return undefined;
  const fullName = key.slice(0, hashIndex);
  const issueNumber = Number.parseInt(key.slice(hashIndex + 1), 10);
  if (!fullName.includes("/") || !Number.isInteger(issueNumber) || issueNumber <= 0) return undefined;
  const [owner, repo] = fullName.split("/");
  return owner && repo ? { issueNumber, owner, repo } : undefined;
}

function getIssueRefFromUrl(value: string | undefined) {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const [, owner, repo, issuePath, issueNumberText] = url.pathname.split("/");
    const issueNumber = Number.parseInt(issueNumberText ?? "", 10);
    return owner && repo && issuePath === "issues" && Number.isInteger(issueNumber) && issueNumber > 0
      ? { issueNumber, owner, repo }
      : undefined;
  } catch {
    return undefined;
  }
}

function mapGitHubSyncError(error: unknown): IntegrationSyncWorkerResult {
  if (error instanceof GitHubSyncWorkerError) {
    return {
      error: error.message,
      kind: error.kind
    };
  }

  if (error instanceof GitHubAppClientError) {
    if (error.code === "missing_config") {
      return fatalResult("GitHub App configuration is incomplete.");
    }

    if (error.code === "invalid_response") {
      return fatalResult("GitHub API response was invalid.");
    }

    if (isRetryableGitHubStatus(error.status)) {
      return {
        error: `GitHub API request failed with retryable status ${error.status}.`,
        kind: "retryable-error",
        retryAfterSeconds: getRetryAfterSeconds(error.status)
      };
    }

    return fatalResult(`GitHub API request failed with status ${error.status ?? "unknown"}.`);
  }

  return {
    error: "GitHub sync worker failed before updating OpenRoad.",
    kind: "retryable-error"
  };
}

function isRetryableGitHubStatus(status: number | undefined) {
  return status === 408 || status === 409 || status === 429 || Boolean(status && status >= 500);
}

function getRetryAfterSeconds(status: number | undefined) {
  return status === 429 ? 300 : 60;
}

function successResult(summary: string): IntegrationSyncWorkerResult {
  return {
    kind: "success",
    summary
  };
}

function fatalResult(error: string): IntegrationSyncWorkerResult {
  return {
    error,
    kind: "fatal-error"
  };
}

function doesGitHubInstallationIdMatch(storedId: string, candidateId: string) {
  const normalizedCandidate = normalizeGitHubInstallationId(candidateId);
  return (
    storedId === candidateId ||
    storedId === normalizedCandidate ||
    normalizeGitHubInstallationId(storedId) === normalizedCandidate
  );
}

function normalizeGitHubInstallationId(value: string) {
  return value.startsWith("github-installation-") ? value : `github-installation-${value}`;
}

function getGitHubApiInstallationId(value: string) {
  return value.replace(/^github-installation-/, "");
}

class GitHubSyncWorkerError extends Error {
  constructor(
    readonly kind: "fatal-error" | "retryable-error",
    message: string
  ) {
    super(message);
  }
}
