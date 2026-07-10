import { randomUUID } from "node:crypto";

import {
  openRoadReducer,
  type OpenRoadState,
  type RequestItem,
  type Workspace
} from "../src/domain/openroad.js";
import type {
  ExternalObjectMapping,
  IntegrationInstallation,
  IntegrationProvider
} from "../src/integrations/adapter.js";
import {
  disconnectMapping
} from "../src/integrations/adapter.js";
import {
  syncOpenRoadRequestFromGitHubIssue,
  type GitHubIssue
} from "../src/integrations/github.js";
import {
  syncOpenRoadRequestFromJiraIssue,
  type JiraIssue
} from "../src/integrations/jira.js";
import {
  syncOpenRoadRequestFromLinearIssue,
  type LinearIssue
} from "../src/integrations/linear.js";
import type { GitHubAppClient } from "./github-app.js";
import type {
  IntegrationCredential,
  IntegrationState,
  IntegrationStore
} from "./integrations.js";
import {
  createIntegrationCredentialSecretContext,
  parseIntegrationState
} from "./integrations.js";
import type { JiraOAuthConfig } from "./jira.js";
import type { JiraApiClient, JiraApiCredential } from "./jira-api.js";
import type { LinearOAuthConfig } from "./linear.js";
import type {
  LinearApiClient,
  LinearApiCredential
} from "./linear-api.js";
import {
  OAuthExchangeClientError,
  type JiraOAuthExchangeClient,
  type LinearOAuthExchangeClient,
  type OAuthTokenExchangeResult
} from "./oauth-clients.js";
import { parseOpenRoadState, type OpenRoadStore } from "./store.js";
import {
  IntegrationTokenVaultError,
  type IntegrationTokenVault,
  type IntegrationTokenVaultReady
} from "./token-vault.js";

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type ProviderConflictResolution = "accept-provider" | "disconnect-mapping" | "keep-openroad";

export type ProviderConflictResolutionInput = {
  mappingId: string;
  provider: IntegrationProvider;
  resolution: ProviderConflictResolution;
  workspaceId: string;
};

export type ProviderConflictResolutionResult = {
  external: {
    id: string;
    key?: string;
    type: "issue";
    url?: string;
  };
  installationId: string;
  mappingId: string;
  message: string;
  provider: IntegrationProvider;
  requestId: string;
  resolvedAt: string;
  resolution: ProviderConflictResolution;
  status: "resolved";
};

export type ProviderConflictResolutionOptions = {
  githubAppClient: GitHubAppClient;
  integrationStore: IntegrationStore;
  jiraApiClient: JiraApiClient;
  jiraOAuthConfig: JiraOAuthConfig;
  jiraOAuthExchangeClient: JiraOAuthExchangeClient;
  linearApiClient: LinearApiClient;
  linearOAuthConfig: LinearOAuthConfig;
  linearOAuthExchangeClient: LinearOAuthExchangeClient;
  now?: () => Date;
  runIntegrationMutationExclusive: ExclusiveRunner;
  store: OpenRoadStore;
  tokenVault: IntegrationTokenVault;
};

type ProviderConflictPlan = {
  installation: IntegrationInstallation;
  jiraCredential?: JiraApiCredential;
  linearCredential?: LinearApiCredential;
  mapping: ExternalObjectMapping;
  request: RequestItem;
  workspace: Workspace;
};

type ProviderIssueSnapshot =
  | { issue: GitHubIssue; provider: "github" }
  | { issue: JiraIssue; provider: "jira" }
  | { issue: LinearIssue; provider: "linear" };

const refreshLeadTimeMs = 5 * 60 * 1000;

export class ProviderConflictResolutionError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "invalid_state"
      | "not_configured"
      | "not_found"
      | "upstream_error",
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function resolveProviderMappingConflict(
  options: ProviderConflictResolutionOptions,
  input: ProviderConflictResolutionInput
): Promise<ProviderConflictResolutionResult> {
  const provider = normalizeProvider(input.provider);
  const resolution = normalizeResolution(input.resolution);
  const resolvedAt = (options.now ?? (() => new Date()))().toISOString();
  const plan = await createProviderConflictPlan(options, { ...input, provider, resolution }, resolvedAt);
  const providerIssue =
    resolution === "accept-provider"
      ? await fetchProviderIssue(options, provider, plan)
      : undefined;

  await options.runIntegrationMutationExclusive(async () => {
    const [openRoadResult, integrationResult] = await Promise.all([
      options.store.load(),
      options.integrationStore.load()
    ]);
    const latestPlan = validateProviderConflictState(
      openRoadResult.state,
      integrationResult.state,
      {
        mappingId: plan.mapping.id,
        provider,
        resolution,
        workspaceId: input.workspaceId
      }
    );
    const nextOpenRoadState = providerIssue
      ? applyProviderIssueToRequest(openRoadResult.state, latestPlan, providerIssue, resolvedAt)
      : openRoadResult.state;
    const nextMapping = createResolvedMapping(latestPlan.mapping, resolution, resolvedAt);
    const event = createConflictResolutionEvent({
      mapping: latestPlan.mapping,
      provider,
      requestId: latestPlan.request.id,
      resolution,
      resolvedAt,
      workspaceId: input.workspaceId
    });

    if (nextOpenRoadState !== openRoadResult.state) {
      await options.store.replaceState(nextOpenRoadState);
    }

    await options.integrationStore.replaceState(
      parseIntegrationState({
        ...integrationResult.state,
        mappings: integrationResult.state.mappings.map((item) =>
          item.id === latestPlan.mapping.id ? nextMapping : item
        ),
        syncEvents: [event, ...integrationResult.state.syncEvents].slice(0, 1000)
      })
    );
  });

  return {
    external: {
      id: plan.mapping.external.id,
      ...(plan.mapping.external.key ? { key: plan.mapping.external.key } : {}),
      type: "issue",
      ...(plan.mapping.external.url ? { url: plan.mapping.external.url } : {})
    },
    installationId: plan.installation.id,
    mappingId: plan.mapping.id,
    message: getResolutionMessage(provider, resolution),
    provider,
    requestId: plan.request.id,
    resolvedAt,
    resolution,
    status: "resolved"
  };
}

async function createProviderConflictPlan(
  options: ProviderConflictResolutionOptions,
  input: ProviderConflictResolutionInput,
  now: string
): Promise<ProviderConflictPlan> {
  const [openRoadResult, integrationResult] = await Promise.all([
    options.store.load(),
    options.integrationStore.load()
  ]);
  const plan = validateProviderConflictState(openRoadResult.state, integrationResult.state, input);

  if (input.resolution !== "accept-provider") {
    return plan;
  }

  if (input.provider === "github") {
    return plan;
  }

  const credential = await openOrRefreshReadableProviderCredential(options, {
    installation: plan.installation,
    integrationState: integrationResult.state,
    now,
    provider: input.provider
  });

  if (input.provider === "linear") {
    return {
      ...plan,
      linearCredential: createLinearCredential(credential.credential, credential.accessToken)
    };
  }

  return {
    ...plan,
    jiraCredential: { accessToken: credential.accessToken }
  };
}

function validateProviderConflictState(
  openRoadState: OpenRoadState,
  integrationState: IntegrationState,
  input: ProviderConflictResolutionInput
): ProviderConflictPlan {
  const workspace = openRoadState.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) {
    throw new ProviderConflictResolutionError("not_found", 404, "Workspace was not found.");
  }

  const mapping = integrationState.mappings.find(
    (item) =>
      item.id === input.mappingId &&
      item.openRoad.workspaceId === input.workspaceId &&
      item.external.provider === input.provider
  );

  if (!mapping) {
    throw new ProviderConflictResolutionError("not_found", 404, "Integration conflict was not found.");
  }

  if (mapping.status !== "conflicted") {
    throw new ProviderConflictResolutionError(
      "invalid_state",
      422,
      "Integration mapping is not conflicted."
    );
  }

  if (mapping.openRoad.type !== "request" || mapping.external.type !== "issue") {
    throw new ProviderConflictResolutionError(
      "invalid_state",
      422,
      "Only linked issue request conflicts can be resolved here."
    );
  }

  const request = workspace.requests.find((item) => item.id === mapping.openRoad.id);
  if (!request) {
    throw new ProviderConflictResolutionError("not_found", 404, "OpenRoad request was not found.");
  }

  const installation = integrationState.installations.find(
    (item) =>
      item.id === mapping.installationId &&
      item.provider === input.provider &&
      item.workspaceId === input.workspaceId
  );

  if (!installation) {
    throw new ProviderConflictResolutionError("not_found", 404, "Integration installation was not found.");
  }

  if (input.resolution !== "disconnect-mapping") {
    if (installation.status !== "active") {
      throw new ProviderConflictResolutionError(
        "invalid_state",
        422,
        "Integration installation is disconnected or suspended."
      );
    }

    if (input.resolution === "accept-provider" && !installation.permissions.includes("read:external")) {
      throw new ProviderConflictResolutionError(
        "invalid_state",
        422,
        "Integration installation cannot read provider issues."
      );
    }
  }

  return { installation, mapping, request, workspace };
}

async function fetchProviderIssue(
  options: ProviderConflictResolutionOptions,
  provider: IntegrationProvider,
  plan: ProviderConflictPlan
): Promise<ProviderIssueSnapshot> {
  if (provider === "github") {
    const target = parseGitHubIssueTarget(plan.mapping);
    const issue = await options.githubAppClient.getRepositoryIssue({
      installationId: stripGitHubInstallationPrefix(plan.installation.id),
      issueNumber: target.issueNumber,
      owner: target.owner,
      repo: target.repo
    });
    return { issue, provider };
  }

  if (provider === "linear") {
    if (!plan.linearCredential) {
      throw new ProviderConflictResolutionError("invalid_state", 422, "Linear credential was not resolved.");
    }

    const issue = await options.linearApiClient.getIssue({
      credential: plan.linearCredential,
      issueId: plan.mapping.external.id || plan.mapping.external.key || ""
    });
    return { issue, provider };
  }

  if (!plan.jiraCredential) {
    throw new ProviderConflictResolutionError("invalid_state", 422, "Jira credential was not resolved.");
  }

  const target = parseJiraIssueTarget(plan.mapping, plan.installation);
  const issue = await options.jiraApiClient.getIssue({
    cloudId: target.cloudId,
    credential: plan.jiraCredential,
    issueIdOrKey: target.issueIdOrKey
  });
  return { issue, provider };
}

function applyProviderIssueToRequest(
  openRoadState: OpenRoadState,
  plan: ProviderConflictPlan,
  providerIssue: ProviderIssueSnapshot,
  now: string
) {
  const nextRequest =
    providerIssue.provider === "github"
      ? syncOpenRoadRequestFromGitHubIssue(plan.request, providerIssue.issue, now)
      : providerIssue.provider === "linear"
        ? syncOpenRoadRequestFromLinearIssue(plan.request, providerIssue.issue, now)
        : syncOpenRoadRequestFromJiraIssue(plan.request, providerIssue.issue, now);

  return parseOpenRoadState(
    openRoadReducer(openRoadState, {
      request: nextRequest,
      type: "replace-request",
      workspaceId: plan.workspace.id
    })
  );
}

function createResolvedMapping(
  mapping: ExternalObjectMapping,
  resolution: ProviderConflictResolution,
  resolvedAt: string
) {
  if (resolution === "disconnect-mapping") {
    return disconnectMapping(mapping, resolvedAt);
  }

  return {
    ...mapping,
    lastSyncedAt: resolution === "accept-provider" ? resolvedAt : mapping.lastSyncedAt,
    status: "active" as const
  };
}

function createConflictResolutionEvent({
  mapping,
  provider,
  requestId,
  resolution,
  resolvedAt,
  workspaceId
}: {
  mapping: ExternalObjectMapping;
  provider: IntegrationProvider;
  requestId: string;
  resolution: ProviderConflictResolution;
  resolvedAt: string;
  workspaceId: string;
}) {
  return {
    createdAt: resolvedAt,
    deliveryId: `conflict-resolution:${provider}:${mapping.id}:${resolvedAt}`,
    event: "conflict_resolved",
    id: `sync-event-conflict-resolution-${provider}-${randomUUID()}`,
    installationId: mapping.installationId,
    provider,
    result: "synced" as const,
    summary: `Resolved ${integrationProviderLabels[provider]} issue conflict for OpenRoad request ${requestId} with ${resolution}.`,
    workspaceId
  };
}

async function openOrRefreshReadableProviderCredential(
  options: ProviderConflictResolutionOptions,
  {
    installation,
    integrationState,
    now,
    provider
  }: {
    installation: IntegrationInstallation;
    integrationState: IntegrationState;
    now: string;
    provider: "jira" | "linear";
  }
) {
  const credential = integrationState.credentials.find(
    (item) =>
      item.provider === provider &&
      item.workspaceId === installation.workspaceId &&
      item.installationId === installation.id &&
      item.status === "active" &&
      item.permissions.includes("read:external")
  );

  if (!credential) {
    throw new ProviderConflictResolutionError("not_found", 404, "Readable provider credential was not found.");
  }

  if (!credential.encryptedSecret) {
    throw new ProviderConflictResolutionError("invalid_state", 422, "Provider credential secret is not available.");
  }

  const readyVault = requireTokenVault(options.tokenVault);
  const secret = openCredentialSecret(readyVault, credential);

  if (!shouldRefreshCredential(credential, now)) {
    return {
      accessToken: secret.accessToken,
      credential
    };
  }

  if (!credential.secretTypes.includes("refresh-token") || !secret.refreshToken) {
    throw new ProviderConflictResolutionError(
      "invalid_state",
      422,
      "Provider credential is expired or near expiry and does not include a refresh token."
    );
  }

  try {
    const refreshed =
      provider === "linear"
        ? await options.linearOAuthExchangeClient.refreshToken({
            config: requireLinearRefreshConfig(options.linearOAuthConfig),
            refreshToken: secret.refreshToken
          })
        : await options.jiraOAuthExchangeClient.refreshToken({
            config: requireJiraRefreshConfig(options.jiraOAuthConfig),
            refreshToken: secret.refreshToken
          });
    const rotated = rotateCredentialSecret({
      credential,
      now,
      provider,
      refreshed,
      tokenVault: readyVault
    });

    await options.runIntegrationMutationExclusive(async () => {
      const latest = await options.integrationStore.load();
      const latestCredential = latest.state.credentials.find((item) => item.id === rotated.id);

      if (!latestCredential || latestCredential.status !== "active") {
        throw new ProviderConflictResolutionError("not_found", 404, "Readable provider credential was not found.");
      }

      await options.integrationStore.replaceState(
        parseIntegrationState({
          ...latest.state,
          credentials: latest.state.credentials.map((item) => (item.id === rotated.id ? rotated : item))
        })
      );
    });

    return {
      accessToken: refreshed.accessToken,
      credential: rotated
    };
  } catch (error) {
    if (error instanceof ProviderConflictResolutionError) throw error;
    if (error instanceof OAuthExchangeClientError) {
      throw new ProviderConflictResolutionError(
        "upstream_error",
        error.status ?? 502,
        `${integrationProviderLabels[provider]} OAuth refresh failed.`
      );
    }

    throw error;
  }
}

function requireTokenVault(tokenVault: IntegrationTokenVault): IntegrationTokenVaultReady {
  if (tokenVault.status !== "ready") {
    throw new ProviderConflictResolutionError("not_configured", 503, "Provider credential vault is not configured.");
  }

  return tokenVault;
}

function openCredentialSecret(tokenVault: IntegrationTokenVaultReady, credential: IntegrationCredential) {
  if (!credential.encryptedSecret) {
    throw new ProviderConflictResolutionError("invalid_state", 422, "Provider credential secret is not available.");
  }

  try {
    return tokenVault.open(credential.encryptedSecret, {
      associatedData: createIntegrationCredentialSecretContext(credential)
    });
  } catch (error) {
    if (error instanceof IntegrationTokenVaultError) {
      throw new ProviderConflictResolutionError("invalid_state", 422, "Provider credential could not be opened.");
    }

    throw error;
  }
}

function rotateCredentialSecret({
  credential,
  now,
  provider,
  refreshed,
  tokenVault
}: {
  credential: IntegrationCredential;
  now: string;
  provider: "jira" | "linear";
  refreshed: OAuthTokenExchangeResult;
  tokenVault: IntegrationTokenVaultReady;
}): IntegrationCredential {
  if (!refreshed.refreshToken) {
    throw new ProviderConflictResolutionError(
      "upstream_error",
      502,
      `${integrationProviderLabels[provider]} OAuth refresh response did not include a refresh token.`
    );
  }

  if (!refreshed.expiresAt) {
    throw new ProviderConflictResolutionError(
      "upstream_error",
      502,
      `${integrationProviderLabels[provider]} OAuth refresh response did not include an expiry.`
    );
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

function createLinearCredential(
  credential: Pick<IntegrationCredential, "providerScopes" | "tokenType">,
  accessToken: string
): LinearApiCredential {
  return {
    accessToken,
    authorizationMode: getLinearAuthorizationMode(credential)
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

function shouldRefreshCredential(credential: IntegrationCredential, now: string) {
  const expiresAtMs = credential.expiresAt ? Date.parse(credential.expiresAt) : Number.NaN;
  const nowMs = Date.parse(now);

  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs + refreshLeadTimeMs;
}

function requireLinearRefreshConfig(config: LinearOAuthConfig) {
  if (!config.clientId || !config.clientSecret) {
    throw new ProviderConflictResolutionError("not_configured", 503, "Linear OAuth refresh is not configured.");
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret
  };
}

function requireJiraRefreshConfig(config: JiraOAuthConfig) {
  if (!config.clientId || !config.clientSecret) {
    throw new ProviderConflictResolutionError("not_configured", 503, "Jira OAuth refresh is not configured.");
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret
  };
}

function parseGitHubIssueTarget(mapping: ExternalObjectMapping) {
  const keyTarget = parseGitHubIssueTargetText(mapping.external.key);
  if (keyTarget) return keyTarget;

  const urlTarget = parseGitHubIssueTargetText(mapping.external.url);
  if (urlTarget) return urlTarget;

  throw new ProviderConflictResolutionError(
    "invalid_state",
    422,
    "GitHub issue mapping does not include a repository issue reference."
  );
}

function parseGitHubIssueTargetText(value: string | undefined) {
  const text = value?.trim();
  if (!text) return undefined;

  const keyMatch = text.match(/^([^/\s#]+)\/([^#\s]+)#(\d+)$/);
  if (keyMatch) {
    return {
      issueNumber: Number(keyMatch[3]),
      owner: keyMatch[1],
      repo: keyMatch[2]
    };
  }

  const urlMatch = text.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/i);
  if (urlMatch) {
    return {
      issueNumber: Number(urlMatch[3]),
      owner: urlMatch[1],
      repo: urlMatch[2]
    };
  }

  return undefined;
}

function parseJiraIssueTarget(mapping: ExternalObjectMapping, installation: IntegrationInstallation) {
  const externalId = mapping.external.id.trim();
  const [cloudIdFromExternalId, issueIdFromExternalId] = splitCompositeJiraIssueId(externalId);
  const cloudId = cloudIdFromExternalId || installation.providerAccountId;
  const issueIdOrKey = issueIdFromExternalId || externalId || mapping.external.key;

  if (!cloudId) {
    throw new ProviderConflictResolutionError("invalid_state", 422, "Jira issue mapping does not include a cloud id.");
  }

  if (!issueIdOrKey) {
    throw new ProviderConflictResolutionError("invalid_state", 422, "Jira issue mapping does not include an issue id or key.");
  }

  return { cloudId, issueIdOrKey };
}

function splitCompositeJiraIssueId(value: string) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return [undefined, undefined] as const;

  return [value.slice(0, separator), value.slice(separator + 1)] as const;
}

function stripGitHubInstallationPrefix(value: string) {
  return value.replace(/^github-installation-/, "");
}

function normalizeProvider(provider: IntegrationProvider) {
  if (provider === "github" || provider === "linear" || provider === "jira") return provider;
  throw new ProviderConflictResolutionError("invalid_request", 400, "Integration provider is not supported.");
}

function normalizeResolution(resolution: ProviderConflictResolution) {
  if (
    resolution === "accept-provider" ||
    resolution === "disconnect-mapping" ||
    resolution === "keep-openroad"
  ) {
    return resolution;
  }

  throw new ProviderConflictResolutionError("invalid_request", 400, "Conflict resolution is not supported.");
}

function getResolutionMessage(provider: IntegrationProvider, resolution: ProviderConflictResolution) {
  const label = integrationProviderLabels[provider];

  if (resolution === "accept-provider") {
    return `Resolved ${label} conflict by accepting the provider issue.`;
  }

  if (resolution === "disconnect-mapping") {
    return `Resolved ${label} conflict by disconnecting the issue mapping.`;
  }

  return `Resolved ${label} conflict by keeping the OpenRoad request.`;
}

const integrationProviderLabels: Record<IntegrationProvider, string> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear"
};
