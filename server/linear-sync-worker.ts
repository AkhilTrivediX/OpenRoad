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
  type IntegrationTokenVaultReady,
  type IntegrationCredentialSecretPayload,
  IntegrationTokenVaultError
} from "./token-vault.js";
import type { IntegrationSyncWorker, IntegrationSyncWorkerResult } from "./sync-jobs.js";
import {
  LinearApiClientError,
  type LinearApiClient,
  type LinearApiCredential
} from "./linear-api.js";
import type { LinearOAuthConfig } from "./linear.js";
import {
  OAuthExchangeClientError,
  type LinearOAuthExchangeClient,
  type OAuthTokenExchangeResult
} from "./oauth-clients.js";

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;
const refreshLeadTimeMs = 5 * 60 * 1000;

export type LinearIntegrationSyncWorkerOptions = {
  integrationStore: IntegrationStore;
  linearApiClient: LinearApiClient;
  linearOAuthConfig: LinearOAuthConfig;
  linearOAuthExchangeClient: LinearOAuthExchangeClient;
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
  linearOAuthConfig,
  linearOAuthExchangeClient,
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
          createLinearSyncPlan({
            integrationStore,
            job,
            linearOAuthConfig,
            linearOAuthExchangeClient,
            now: now().toISOString(),
            tokenVault
          })
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

async function createLinearSyncPlan({
  integrationStore,
  job,
  linearOAuthConfig,
  linearOAuthExchangeClient,
  now,
  tokenVault
}: {
  integrationStore: IntegrationStore;
  job: IntegrationSyncJob;
  linearOAuthConfig: LinearOAuthConfig;
  linearOAuthExchangeClient: LinearOAuthExchangeClient;
  now: string;
  tokenVault: IntegrationTokenVault;
}): Promise<LinearSyncPlan> {
  const result = await integrationStore.load();
  const state = result.state;
  const installation = findActiveLinearInstallation(state, job);
  const credential = findActiveLinearCredential(state, installation, now, undefined, {
    allowExpired: true
  });
  const resolvedCredential = await openOrRefreshLinearCredential({
    credential,
    integrationStore,
    linearOAuthConfig,
    linearOAuthExchangeClient,
    now,
    state,
    tokenVault
  });
  const mappings = findLinearIssueMappings(state, job, installation);

  if (job.mappingId && mappings.length === 0) {
    throw new LinearSyncWorkerError(
      "fatal-error",
      "Linear sync mapping was not found or is not active."
    );
  }

  return {
    credential: resolvedCredential.apiCredential,
    credentialId: resolvedCredential.credential.id,
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
  credentialId?: string,
  options: { allowExpired?: boolean } = {}
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

  if (!options.allowExpired && isCredentialExpired(credential, now)) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential is expired.");
  }

  if (!credential.encryptedSecret) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential secret is not available.");
  }

  return credential;
}

async function openOrRefreshLinearCredential({
  credential,
  integrationStore,
  linearOAuthConfig,
  linearOAuthExchangeClient,
  now,
  state,
  tokenVault
}: {
  credential: IntegrationCredential;
  integrationStore: IntegrationStore;
  linearOAuthConfig: LinearOAuthConfig;
  linearOAuthExchangeClient: LinearOAuthExchangeClient;
  now: string;
  state: IntegrationState;
  tokenVault: IntegrationTokenVault;
}) {
  const readyVault = requireLinearTokenVault(tokenVault);
  const secret = openLinearCredentialSecret(readyVault, credential);

  if (!shouldRefreshCredential(credential, now)) {
    return {
      apiCredential: createLinearApiCredential(credential, secret.accessToken),
      credential
    };
  }

  if (!credential.secretTypes.includes("refresh-token") || !secret.refreshToken) {
    throw new LinearSyncWorkerError(
      "fatal-error",
      "Linear credential is expired or near expiry and does not include a refresh token."
    );
  }

  const refreshed = await linearOAuthExchangeClient.refreshToken({
    config: requireLinearRefreshConfig(linearOAuthConfig),
    refreshToken: secret.refreshToken
  });
  const rotated = rotateLinearCredentialSecret({
    credential,
    now,
    refreshed,
    tokenVault: readyVault
  });

  await integrationStore.replaceState(
    parseIntegrationState({
      ...state,
      credentials: state.credentials.map((item) => (item.id === rotated.id ? rotated : item))
    })
  );

  return {
    apiCredential: createLinearApiCredential(rotated, refreshed.accessToken),
    credential: rotated
  };
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
  const readyVault = requireLinearTokenVault(tokenVault);
  const secret = openLinearCredentialSecret(readyVault, credential);
  return createLinearApiCredential(credential, secret.accessToken);
}

function requireLinearTokenVault(tokenVault: IntegrationTokenVault): IntegrationTokenVaultReady {
  if (tokenVault.status !== "ready") {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential vault is not configured.");
  }

  return tokenVault;
}

function openLinearCredentialSecret(
  tokenVault: IntegrationTokenVaultReady,
  credential: IntegrationCredential
): IntegrationCredentialSecretPayload {
  if (!credential.encryptedSecret) {
    throw new LinearSyncWorkerError("fatal-error", "Linear credential secret is not available.");
  }

  try {
    return tokenVault.open(credential.encryptedSecret, {
      associatedData: createIntegrationCredentialSecretContext(credential)
    });
  } catch (error) {
    if (error instanceof IntegrationTokenVaultError) {
      throw new LinearSyncWorkerError("fatal-error", "Linear credential could not be opened.");
    }

    throw error;
  }
}

function createLinearApiCredential(
  credential: IntegrationCredential,
  accessToken: string
): LinearApiCredential {
  return {
    accessToken,
    authorizationMode: getLinearAuthorizationMode(credential)
  };
}

function shouldRefreshCredential(credential: IntegrationCredential, now: string) {
  const expiresAtMs = credential.expiresAt ? Date.parse(credential.expiresAt) : Number.NaN;
  const nowMs = Date.parse(now);

  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs + refreshLeadTimeMs;
}

function isCredentialExpired(credential: IntegrationCredential, now: string) {
  const expiresAtMs = credential.expiresAt ? Date.parse(credential.expiresAt) : Number.NaN;
  const nowMs = Date.parse(now);

  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs;
}

function requireLinearRefreshConfig(config: LinearOAuthConfig) {
  if (!config.clientId || !config.clientSecret) {
    throw new LinearSyncWorkerError("fatal-error", "Linear OAuth refresh is not configured.");
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret
  };
}

function rotateLinearCredentialSecret({
  credential,
  now,
  refreshed,
  tokenVault
}: {
  credential: IntegrationCredential;
  now: string;
  refreshed: OAuthTokenExchangeResult;
  tokenVault: IntegrationTokenVaultReady;
}): IntegrationCredential {
  if (!refreshed.refreshToken) {
    throw new LinearSyncWorkerError("fatal-error", "Linear OAuth refresh response did not include a refresh token.");
  }

  if (!refreshed.expiresAt) {
    throw new LinearSyncWorkerError("fatal-error", "Linear OAuth refresh response did not include an expiry.");
  }

  const rotated: IntegrationCredential = {
    ...credential,
    expiresAt: refreshed.expiresAt,
    providerScopes: refreshed.providerScopes.length > 0 ? refreshed.providerScopes : credential.providerScopes,
    secretTypes: ["access-token", "refresh-token"],
    tokenType: refreshed.tokenType ?? credential.tokenType ?? "bearer",
    updatedAt: now
  };

  return {
    ...rotated,
    encryptedSecret: tokenVault.seal(
      {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken
      },
      { associatedData: createIntegrationCredentialSecretContext(rotated) }
    )
  };
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

  if (error instanceof OAuthExchangeClientError) {
    if (error.code === "invalid_response") {
      return fatalResult("Linear OAuth refresh response was invalid.");
    }

    if (isRetryableLinearStatus(error.status)) {
      return {
        error: error.status
          ? `Linear OAuth refresh failed with retryable status ${error.status}.`
          : "Linear OAuth refresh failed before response.",
        kind: "retryable-error",
        retryAfterSeconds: getRetryAfterSeconds(error.status)
      };
    }

    return fatalResult(`Linear OAuth refresh failed with status ${error.status ?? "unknown"}.`);
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
