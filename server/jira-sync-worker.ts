import type { ExternalObjectMapping, IntegrationInstallation } from "../src/integrations/adapter.js";
import { syncOpenRoadRequestFromJiraIssue, type JiraIssue } from "../src/integrations/jira.js";
import {
  openRoadReducer,
  type OpenRoadState,
  type Workspace
} from "../src/domain/openroad.js";
import {
  createIntegrationCredentialSecretContext,
  parseIntegrationState,
  type IntegrationCredential,
  type IntegrationState,
  type IntegrationStore,
  type IntegrationSyncJob
} from "./integrations.js";
import { parseOpenRoadState, type OpenRoadStore } from "./store.js";
import {
  type IntegrationTokenVault,
  IntegrationTokenVaultError
} from "./token-vault.js";
import type { IntegrationSyncWorker, IntegrationSyncWorkerResult } from "./sync-jobs.js";
import {
  JiraApiClientError,
  type JiraApiClient,
  type JiraApiCredential
} from "./jira-api.js";

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type JiraIntegrationSyncWorkerOptions = {
  integrationStore: IntegrationStore;
  jiraApiClient: JiraApiClient;
  now?: () => Date;
  runIntegrationMutationExclusive: ExclusiveRunner;
  store: OpenRoadStore;
  tokenVault: IntegrationTokenVault;
};

type JiraSyncPlan = {
  credential: JiraApiCredential;
  credentialId: string;
  installation: IntegrationInstallation;
  targets: JiraIssueSyncTarget[];
};

type JiraIssueSyncTarget = {
  cloudId: string;
  issueIdOrKey: string;
  mappingId: string;
};

type FetchedJiraIssues = {
  issuesByMappingId: Map<string, JiraIssue>;
  missingMappingIds: Set<string>;
  targetMappingIds: Set<string>;
};

type JiraSyncApplyResult = {
  missing: number;
  skipped: number;
  synced: number;
};

export function canConfigureJiraIntegrationSyncWorker(tokenVault: IntegrationTokenVault) {
  return tokenVault.status === "ready";
}

export function createJiraIntegrationSyncWorker({
  integrationStore,
  jiraApiClient,
  now = () => new Date(),
  runIntegrationMutationExclusive,
  store,
  tokenVault
}: JiraIntegrationSyncWorkerOptions): IntegrationSyncWorker {
  return {
    async process(job) {
      if (job.provider !== "jira") {
        return fatalResult("Jira sync worker cannot process this provider.");
      }

      try {
        const plan = await runIntegrationMutationExclusive(async () =>
          createJiraSyncPlan((await integrationStore.load()).state, job, tokenVault, now().toISOString())
        );

        if (plan.targets.length === 0) {
          return successResult(`No active Jira issue mappings to sync for installation ${plan.installation.id}.`);
        }

        const fetchedIssues = await fetchMappedJiraIssues(jiraApiClient, plan);
        const applied = await runIntegrationMutationExclusive(async () =>
          applyJiraIssueSync({
            credentialId: plan.credentialId,
            fetchedIssues,
            integrationStore,
            job,
            now: now().toISOString(),
            store
          })
        );

        return successResult(
          `Synced ${applied.synced} Jira issue mapping${applied.synced === 1 ? "" : "s"}; ${applied.missing} missing from live response; ${applied.skipped} skipped.`
        );
      } catch (error) {
        return mapJiraSyncError(error);
      }
    }
  };
}

function createJiraSyncPlan(
  state: IntegrationState,
  job: IntegrationSyncJob,
  tokenVault: IntegrationTokenVault,
  now: string
): JiraSyncPlan {
  const installation = findActiveJiraInstallation(state, job);
  const credential = findActiveJiraCredential(state, installation, now);
  const mappings = findJiraIssueMappings(state, job, installation);

  if (job.mappingId && mappings.length === 0) {
    throw new JiraSyncWorkerError("fatal-error", "Jira sync mapping was not found or is not active.");
  }

  return {
    credential: openJiraCredential(tokenVault, credential),
    credentialId: credential.id,
    installation,
    targets: mappings.map((mapping) => getIssueSyncTarget(mapping, installation))
  };
}

async function fetchMappedJiraIssues(
  jiraApiClient: JiraApiClient,
  plan: JiraSyncPlan
): Promise<FetchedJiraIssues> {
  const issuesByMappingId = new Map<string, JiraIssue>();
  const missingMappingIds = new Set<string>();
  const targetMappingIds = new Set(plan.targets.map((target) => target.mappingId));

  for (const target of plan.targets) {
    try {
      issuesByMappingId.set(
        target.mappingId,
        await jiraApiClient.getIssue({
          cloudId: target.cloudId,
          credential: plan.credential,
          issueIdOrKey: target.issueIdOrKey
        })
      );
    } catch (error) {
      if (error instanceof JiraApiClientError && (error.code === "not_found" || error.status === 404)) {
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

async function applyJiraIssueSync({
  credentialId,
  fetchedIssues,
  integrationStore,
  job,
  now,
  store
}: {
  credentialId: string;
  fetchedIssues: FetchedJiraIssues;
  integrationStore: IntegrationStore;
  job: IntegrationSyncJob;
  now: string;
  store: OpenRoadStore;
}): Promise<JiraSyncApplyResult> {
  const [openRoadResult, integrationResult] = await Promise.all([
    store.load(),
    integrationStore.load()
  ]);
  const installation = findActiveJiraInstallation(integrationResult.state, job);
  findActiveJiraCredential(integrationResult.state, installation, now, credentialId);
  const mappings = findJiraIssueMappings(integrationResult.state, job, installation).filter((mapping) =>
    fetchedIssues.targetMappingIds.has(mapping.id)
  );

  if (job.mappingId && mappings.length === 0) {
    throw new JiraSyncWorkerError("fatal-error", "Jira sync mapping changed before it could be updated.");
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
        request: syncOpenRoadRequestFromJiraIssue(request, issue, now),
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

function findActiveJiraInstallation(state: IntegrationState, job: IntegrationSyncJob) {
  const installation = state.installations.find(
    (item) =>
      item.provider === "jira" &&
      item.workspaceId === job.workspaceId &&
      item.id === job.installationId
  );

  if (!installation) {
    throw new JiraSyncWorkerError("fatal-error", "Jira installation was not found.");
  }

  if (installation.status !== "active") {
    throw new JiraSyncWorkerError("fatal-error", "Jira installation is not active.");
  }

  if (!installation.permissions.includes("read:external")) {
    throw new JiraSyncWorkerError("fatal-error", "Jira installation cannot read issues.");
  }

  if (!installation.providerAccountId) {
    throw new JiraSyncWorkerError("fatal-error", "Jira installation cloud id is not available.");
  }

  return installation;
}

function findActiveJiraCredential(
  state: IntegrationState,
  installation: IntegrationInstallation,
  now: string,
  credentialId?: string
) {
  const credential = state.credentials.find(
    (item) =>
      item.provider === "jira" &&
      item.workspaceId === installation.workspaceId &&
      item.installationId === installation.id &&
      item.status === "active" &&
      (!credentialId || item.id === credentialId)
  );

  if (!credential) {
    throw new JiraSyncWorkerError("fatal-error", "Jira credential was not found.");
  }

  if (!credential.permissions.includes("read:external")) {
    throw new JiraSyncWorkerError("fatal-error", "Jira credential cannot read issues.");
  }

  if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.parse(now)) {
    throw new JiraSyncWorkerError("fatal-error", "Jira credential is expired.");
  }

  if (!credential.encryptedSecret) {
    throw new JiraSyncWorkerError("fatal-error", "Jira credential secret is not available.");
  }

  return credential;
}

function findJiraIssueMappings(
  state: IntegrationState,
  job: IntegrationSyncJob,
  installation: IntegrationInstallation
) {
  return state.mappings.filter(
    (mapping) =>
      mapping.status === "active" &&
      mapping.external.provider === "jira" &&
      mapping.external.type === "issue" &&
      mapping.openRoad.workspaceId === job.workspaceId &&
      mapping.installationId === installation.id &&
      (!job.mappingId || mapping.id === job.mappingId)
  );
}

function openJiraCredential(
  tokenVault: IntegrationTokenVault,
  credential: IntegrationCredential
): JiraApiCredential {
  if (tokenVault.status !== "ready") {
    throw new JiraSyncWorkerError("fatal-error", "Jira credential vault is not configured.");
  }

  if (!credential.encryptedSecret) {
    throw new JiraSyncWorkerError("fatal-error", "Jira credential secret is not available.");
  }

  try {
    const secret = tokenVault.open(credential.encryptedSecret, {
      associatedData: createIntegrationCredentialSecretContext(credential)
    });

    return {
      accessToken: secret.accessToken
    };
  } catch (error) {
    if (error instanceof IntegrationTokenVaultError) {
      throw new JiraSyncWorkerError("fatal-error", "Jira credential could not be opened.");
    }

    throw error;
  }
}

function findWorkspace(state: OpenRoadState, mapping: ExternalObjectMapping): Workspace | undefined {
  return state.workspaces.find((workspace) => workspace.id === mapping.openRoad.workspaceId);
}

function getIssueSyncTarget(
  mapping: ExternalObjectMapping,
  installation: IntegrationInstallation
): JiraIssueSyncTarget {
  const externalId = mapping.external.id.trim();
  const [cloudIdFromExternalId, issueIdFromExternalId] = splitCompositeJiraIssueId(externalId);
  const cloudId = cloudIdFromExternalId || installation.providerAccountId;
  const issueIdOrKey = issueIdFromExternalId || externalId || mapping.external.key;

  if (!cloudId) {
    throw new JiraSyncWorkerError("fatal-error", "Jira issue mapping does not include a cloud id.");
  }

  if (!issueIdOrKey) {
    throw new JiraSyncWorkerError("fatal-error", "Jira issue mapping does not include an issue id or key.");
  }

  return {
    cloudId,
    issueIdOrKey,
    mappingId: mapping.id
  };
}

function splitCompositeJiraIssueId(value: string) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return [undefined, undefined] as const;

  return [value.slice(0, separator), value.slice(separator + 1)] as const;
}

function mapJiraSyncError(error: unknown): IntegrationSyncWorkerResult {
  if (error instanceof JiraSyncWorkerError) {
    return {
      error: error.message,
      kind: error.kind
    };
  }

  if (error instanceof JiraApiClientError) {
    if (error.code === "invalid_response") {
      return fatalResult("Jira API response was invalid.");
    }

    if (isRetryableJiraStatus(error.status)) {
      return {
        error: error.status
          ? `Jira API request failed with retryable status ${error.status}.`
          : "Jira API request failed before response.",
        kind: "retryable-error",
        retryAfterSeconds: getRetryAfterSeconds(error.status)
      };
    }

    return fatalResult(`Jira API request failed with status ${error.status ?? "unknown"}.`);
  }

  return {
    error: "Jira sync worker failed before updating OpenRoad.",
    kind: "retryable-error"
  };
}

function isRetryableJiraStatus(status: number | undefined) {
  return status === undefined || status === 408 || status === 409 || status === 429 || Boolean(status && status >= 500);
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

class JiraSyncWorkerError extends Error {
  constructor(
    readonly kind: "fatal-error" | "retryable-error",
    message: string
  ) {
    super(message);
  }
}
