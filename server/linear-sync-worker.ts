import type { ExternalObjectMapping, IntegrationInstallation } from "../src/integrations/adapter.js";
import {
  syncOpenRoadRequestFromLinearIssue,
  type LinearIssue
} from "../src/integrations/linear.js";
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
  LinearApiClientError,
  type LinearApiClient,
  type LinearApiCredential
} from "./linear-api.js";

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type LinearIntegrationSyncWorkerOptions = {
  integrationStore: IntegrationStore;
  linearApiClient: LinearApiClient;
  now?: () => Date;
  runIntegrationMutationExclusive: ExclusiveRunner;
  store: OpenRoadStore;
  tokenVault: IntegrationTokenVault;
};

type LinearSyncPlan = {
  credential: LinearApiCredential;
  credentialId: string;
  installation: IntegrationInstallation;
  targets: LinearIssueSyncTarget[];
};

type LinearIssueSyncTarget = {
  issueId: string;
  mappingId: string;
};

type FetchedLinearIssues = {
  issuesByMappingId: Map<string, LinearIssue>;
  missingMappingIds: Set<string>;
  targetMappingIds: Set<string>;
};

type LinearSyncApplyResult = {
  missing: number;
  skipped: number;
  synced: number;
};

export function canConfigureLinearIntegrationSyncWorker(tokenVault: IntegrationTokenVault) {
  return tokenVault.status === "ready";
}

export function createLinearIntegrationSyncWorker({
  integrationStore,
  linearApiClient,
  now = () => new Date(),
  runIntegrationMutationExclusive,
  store,
  tokenVault
}: LinearIntegrationSyncWorkerOptions): IntegrationSyncWorker {
  return {
    async process(job) {
      if (job.provider !== "linear") {
        return fatalResult("Linear sync worker cannot process this provider.");
      }

      try {
        const plan = await runIntegrationMutationExclusive(async () =>
          createLinearSyncPlan((await integrationStore.load()).state, job, tokenVault, now().toISOString())
        );

        if (plan.targets.length === 0) {
          return successResult(`No active Linear issue mappings to sync for installation ${plan.installation.id}.`);
        }

        const fetchedIssues = await fetchMappedLinearIssues(linearApiClient, plan);
        const applied = await runIntegrationMutationExclusive(async () =>
          applyLinearIssueSync({
            credentialId: plan.credentialId,
            fetchedIssues,
            integrationStore,
            job,
            now: now().toISOString(),
            store
          })
        );

        return successResult(
          `Synced ${applied.synced} Linear issue mapping${applied.synced === 1 ? "" : "s"}; ${applied.missing} missing from live response; ${applied.skipped} skipped.`
        );
      } catch (error) {
        return mapLinearSyncError(error);
      }
    }
  };
}

function createLinearSyncPlan(
  state: IntegrationState,
  job: IntegrationSyncJob,
  tokenVault: IntegrationTokenVault,
  now: string
): LinearSyncPlan {
  const installation = findActiveLinearInstallation(state, job);
  const credential = findActiveLinearCredential(state, installation, now);
  const mappings = findLinearIssueMappings(state, job, installation);

  if (job.mappingId && mappings.length === 0) {
    throw new LinearSyncWorkerError(
      "fatal-error",
      "Linear sync mapping was not found or is not active."
    );
  }

  return {
    credential: openLinearCredential(tokenVault, credential),
    credentialId: credential.id,
    installation,
    targets: mappings.map(getIssueSyncTarget)
  };
}

async function fetchMappedLinearIssues(
  linearApiClient: LinearApiClient,
  plan: LinearSyncPlan
): Promise<FetchedLinearIssues> {
  const issuesByMappingId = new Map<string, LinearIssue>();
  const missingMappingIds = new Set<string>();
  const targetMappingIds = new Set(plan.targets.map((target) => target.mappingId));

  for (const target of plan.targets) {
    try {
      issuesByMappingId.set(
        target.mappingId,
        await linearApiClient.getIssue({
          credential: plan.credential,
          issueId: target.issueId
        })
      );
    } catch (error) {
      if (error instanceof LinearApiClientError && (error.code === "not_found" || error.status === 404)) {
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

async function applyLinearIssueSync({
  credentialId,
  fetchedIssues,
  integrationStore,
  job,
  now,
  store
}: {
  credentialId: string;
  fetchedIssues: FetchedLinearIssues;
  integrationStore: IntegrationStore;
  job: IntegrationSyncJob;
  now: string;
  store: OpenRoadStore;
}): Promise<LinearSyncApplyResult> {
  const [openRoadResult, integrationResult] = await Promise.all([
    store.load(),
    integrationStore.load()
  ]);
  const installation = findActiveLinearInstallation(integrationResult.state, job);
  findActiveLinearCredential(integrationResult.state, installation, now, credentialId);
  const mappings = findLinearIssueMappings(integrationResult.state, job, installation).filter((mapping) =>
    fetchedIssues.targetMappingIds.has(mapping.id)
  );

  if (job.mappingId && mappings.length === 0) {
    throw new LinearSyncWorkerError(
      "fatal-error",
      "Linear sync mapping changed before it could be updated."
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
        request: syncOpenRoadRequestFromLinearIssue(request, issue, now),
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

function findActiveLinearInstallation(state: IntegrationState, job: IntegrationSyncJob) {
  const installation = state.installations.find(
    (item) =>
      item.provider === "linear" &&
      item.workspaceId === job.workspaceId &&
      item.id === job.installationId
  );

  if (!installation) {
    throw new LinearSyncWorkerError("fatal-error", "Linear installation was not found.");
  }

  if (installation.status !== "active") {
    throw new LinearSyncWorkerError("fatal-error", "Linear installation is not active.");
  }

  if (!installation.permissions.includes("read:external")) {
    throw new LinearSyncWorkerError("fatal-error", "Linear installation cannot read issues.");
  }

  return installation;
}

function findActiveLinearCredential(
  state: IntegrationState,
  installation: IntegrationInstallation,
  now: string,
  credentialId?: string
) {
  const credential = state.credentials.find(
    (item) =>
      item.provider === "linear" &&
      item.workspaceId === installation.workspaceId &&
      item.installationId === installation.id &&
      item.status === "active" &&
      (!credentialId || item.id === credentialId)
  );

  if (!credential) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential was not found.");
  }

  if (!credential.permissions.includes("read:external")) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential cannot read issues.");
  }

  if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.parse(now)) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential is expired.");
  }

  if (!credential.encryptedSecret) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential secret is not available.");
  }

  return credential;
}

function findLinearIssueMappings(
  state: IntegrationState,
  job: IntegrationSyncJob,
  installation: IntegrationInstallation
) {
  return state.mappings.filter(
    (mapping) =>
      mapping.status === "active" &&
      mapping.external.provider === "linear" &&
      mapping.external.type === "issue" &&
      mapping.openRoad.workspaceId === job.workspaceId &&
      mapping.installationId === installation.id &&
      (!job.mappingId || mapping.id === job.mappingId)
  );
}

function openLinearCredential(
  tokenVault: IntegrationTokenVault,
  credential: IntegrationCredential
): LinearApiCredential {
  if (tokenVault.status !== "ready") {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential vault is not configured.");
  }

  if (!credential.encryptedSecret) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential secret is not available.");
  }

  try {
    const secret = tokenVault.open(credential.encryptedSecret, {
      associatedData: createIntegrationCredentialSecretContext(credential)
    });

    return {
      accessToken: secret.accessToken,
      authorizationMode: getLinearAuthorizationMode(credential)
    };
  } catch (error) {
    if (error instanceof IntegrationTokenVaultError) {
      throw new LinearSyncWorkerError("fatal-error", "Linear credential could not be opened.");
    }

    throw error;
  }
}

function getLinearAuthorizationMode(
  credential: Pick<IntegrationCredential, "providerScopes" | "tokenType">
): LinearApiCredential["authorizationMode"] {
  const tokenType = credential.tokenType?.toLowerCase();
  const scopes = credential.providerScopes.map((scope) => scope.toLowerCase());

  if (
    tokenType === "api-key" ||
    tokenType === "personal-api-key" ||
    tokenType === "personal-api" ||
    scopes.includes("personal-api-key")
  ) {
    return "api-key";
  }

  return "bearer";
}

function findWorkspace(state: OpenRoadState, mapping: ExternalObjectMapping): Workspace | undefined {
  return state.workspaces.find((workspace) => workspace.id === mapping.openRoad.workspaceId);
}

function getIssueSyncTarget(mapping: ExternalObjectMapping): LinearIssueSyncTarget {
  const issueId = mapping.external.id || mapping.external.key;

  if (!issueId) {
    throw new LinearSyncWorkerError(
      "fatal-error",
      "Linear issue mapping does not include an issue id."
    );
  }

  return { issueId, mappingId: mapping.id };
}

function mapLinearSyncError(error: unknown): IntegrationSyncWorkerResult {
  if (error instanceof LinearSyncWorkerError) {
    return {
      error: error.message,
      kind: error.kind
    };
  }

  if (error instanceof LinearApiClientError) {
    if (error.code === "invalid_response") {
      return fatalResult("Linear API response was invalid.");
    }

    if (error.code === "graphql_error") {
      return fatalResult("Linear GraphQL request failed.");
    }

    if (isRetryableLinearStatus(error.status)) {
      return {
        error: error.status
          ? `Linear API request failed with retryable status ${error.status}.`
          : "Linear API request failed before response.",
        kind: "retryable-error",
        retryAfterSeconds: getRetryAfterSeconds(error.status)
      };
    }

    return fatalResult(`Linear API request failed with status ${error.status ?? "unknown"}.`);
  }

  return {
    error: "Linear sync worker failed before updating OpenRoad.",
    kind: "retryable-error"
  };
}

function isRetryableLinearStatus(status: number | undefined) {
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

class LinearSyncWorkerError extends Error {
  constructor(
    readonly kind: "fatal-error" | "retryable-error",
    message: string
  ) {
    super(message);
  }
}
