import { randomUUID } from "node:crypto";

import type { RequestItem } from "../src/domain/openroad.js";
import type {
  ExternalObjectMapping,
  IntegrationInstallation,
  IntegrationProvider
} from "../src/integrations/adapter.js";
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
import type { OpenRoadStore } from "./store.js";
import {
  IntegrationTokenVaultError,
  type IntegrationTokenVault,
  type IntegrationTokenVaultReady
} from "./token-vault.js";

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type ProviderWriteBackInput = {
  mappingId?: string;
  provider: IntegrationProvider;
  requestId: string;
  workspaceId: string;
};

export type ProviderWriteBackResult = {
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
  status: "written";
  writtenAt: string;
};

export type ProviderWriteBackOptions = {
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

type ProviderWriteBackPlan = {
  body: string;
  installation: IntegrationInstallation;
  jiraCredential?: JiraApiCredential;
  linearCredential?: LinearApiCredential;
  mapping: ExternalObjectMapping;
  request: RequestItem;
  title: string;
};

const refreshLeadTimeMs = 5 * 60 * 1000;
const maxTitleLength = 240;
const maxBodyLength = 16_000;

export class ProviderWriteBackError extends Error {
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

export async function writeBackOpenRoadRequestToProvider(
  options: ProviderWriteBackOptions,
  input: ProviderWriteBackInput
): Promise<ProviderWriteBackResult> {
  const provider = normalizeProvider(input.provider);
  const writtenAt = (options.now ?? (() => new Date()))().toISOString();
  const plan = await createProviderWriteBackPlan(options, { ...input, provider }, writtenAt);

  await executeProviderWriteBack(options, provider, plan);

  await options.runIntegrationMutationExclusive(async () => {
    const integrationResult = await options.integrationStore.load();
    const mapping = integrationResult.state.mappings.find((item) => item.id === plan.mapping.id);
    if (!mapping || mapping.status !== "active") {
      throw new ProviderWriteBackError("not_found", 404, "Integration mapping was not found.");
    }

    await options.integrationStore.replaceState(
      parseIntegrationState({
        ...integrationResult.state,
        mappings: integrationResult.state.mappings.map((item) =>
          item.id === plan.mapping.id ? { ...item, lastSyncedAt: writtenAt } : item
        ),
        syncEvents: [
          {
            createdAt: writtenAt,
            deliveryId: `write-back:${provider}:${plan.mapping.id}:${writtenAt}`,
            event: "write_back",
            id: `sync-event-write-back-${provider}-${randomUUID()}`,
            installationId: plan.installation.id,
            provider,
            result: "synced",
            summary: `Wrote OpenRoad request ${plan.request.id} to ${getProviderIssueLabel(provider, plan.mapping)}.`,
            workspaceId: input.workspaceId
          },
          ...integrationResult.state.syncEvents
        ].slice(0, 1000)
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
    message: `Wrote ${integrationProviderLabels[provider]} issue from OpenRoad request.`,
    provider,
    requestId: plan.request.id,
    status: "written",
    writtenAt
  };
}

async function createProviderWriteBackPlan(
  options: ProviderWriteBackOptions,
  input: ProviderWriteBackInput,
  now: string
): Promise<ProviderWriteBackPlan> {
  const [openRoadResult, integrationResult] = await Promise.all([
    options.store.load(),
    options.integrationStore.load()
  ]);
  const workspace = openRoadResult.state.workspaces.find((item) => item.id === input.workspaceId);
  const request = workspace?.requests.find((item) => item.id === input.requestId);

  if (!workspace) {
    throw new ProviderWriteBackError("not_found", 404, "Workspace was not found.");
  }

  if (!request) {
    throw new ProviderWriteBackError("not_found", 404, "OpenRoad request was not found.");
  }

  if (request.archived) {
    throw new ProviderWriteBackError("invalid_state", 422, "Archived requests cannot be written back.");
  }

  const mapping = findWriteBackMapping(integrationResult.state, input);
  const installation = findWriteBackInstallation(integrationResult.state, mapping, input.provider);
  const body = createWriteBackBody(request);
  const title = boundText(request.title, maxTitleLength, "Untitled OpenRoad request");

  if (input.provider === "github") {
    return { body, installation, mapping, request, title };
  }

  const credential = await openOrRefreshProviderCredential(options, {
    installation,
    integrationState: integrationResult.state,
    now,
    provider: input.provider
  });

  if (input.provider === "linear") {
    return {
      body,
      installation,
      linearCredential: createLinearCredential(credential.credential, credential.accessToken),
      mapping,
      request,
      title
    };
  }

  return {
    body,
    installation,
    jiraCredential: { accessToken: credential.accessToken },
    mapping,
    request,
    title
  };
}

async function executeProviderWriteBack(
  options: ProviderWriteBackOptions,
  provider: IntegrationProvider,
  plan: ProviderWriteBackPlan
) {
  if (provider === "github") {
    const target = parseGitHubIssueTarget(plan.mapping);
    await options.githubAppClient.updateRepositoryIssue({
      body: plan.body,
      installationId: stripGitHubInstallationPrefix(plan.installation.id),
      issueNumber: target.issueNumber,
      owner: target.owner,
      repo: target.repo,
      title: plan.title
    });
    return;
  }

  if (provider === "linear") {
    if (!plan.linearCredential) {
      throw new ProviderWriteBackError("invalid_state", 422, "Linear credential was not resolved.");
    }

    await options.linearApiClient.updateIssue({
      credential: plan.linearCredential,
      description: plan.body,
      issueId: plan.mapping.external.id || plan.mapping.external.key || "",
      title: plan.title
    });
    return;
  }

  if (!plan.jiraCredential) {
    throw new ProviderWriteBackError("invalid_state", 422, "Jira credential was not resolved.");
  }
  const target = parseJiraIssueTarget(plan.mapping, plan.installation);
  await options.jiraApiClient.updateIssue({
    cloudId: target.cloudId,
    credential: plan.jiraCredential,
    description: plan.body,
    issueIdOrKey: target.issueIdOrKey,
    title: plan.title
  });
}

function findWriteBackMapping(state: IntegrationState, input: ProviderWriteBackInput) {
  const mappings = state.mappings.filter(
    (mapping) =>
      mapping.openRoad.workspaceId === input.workspaceId &&
      mapping.openRoad.type === "request" &&
      mapping.openRoad.id === input.requestId &&
      mapping.external.provider === input.provider &&
      mapping.external.type === "issue" &&
      mapping.status === "active" &&
      (!input.mappingId || mapping.id === input.mappingId)
  );

  if (mappings.length === 0) {
    throw new ProviderWriteBackError("not_found", 404, "Integration issue mapping was not found.");
  }

  if (!input.mappingId && mappings.length > 1) {
    throw new ProviderWriteBackError(
      "invalid_request",
      400,
      "Multiple provider issue mappings exist for this request. Choose a mapping id."
    );
  }

  return mappings[0];
}

function findWriteBackInstallation(
  state: IntegrationState,
  mapping: ExternalObjectMapping,
  provider: IntegrationProvider
) {
  const installation = state.installations.find(
    (item) =>
      item.id === mapping.installationId &&
      item.provider === provider &&
      item.workspaceId === mapping.openRoad.workspaceId
  );

  if (!installation) {
    throw new ProviderWriteBackError("not_found", 404, "Integration installation was not found.");
  }

  if (installation.status !== "active") {
    throw new ProviderWriteBackError("invalid_state", 422, "Integration installation is disconnected or suspended.");
  }

  if (!installation.permissions.includes("write:external")) {
    throw new ProviderWriteBackError("invalid_state", 422, "Integration installation cannot write provider issues.");
  }

  return installation;
}

async function openOrRefreshProviderCredential(
  options: ProviderWriteBackOptions,
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
      item.permissions.includes("write:external")
  );

  if (!credential) {
    throw new ProviderWriteBackError("not_found", 404, "Writable provider credential was not found.");
  }

  if (!credential.encryptedSecret) {
    throw new ProviderWriteBackError("invalid_state", 422, "Provider credential secret is not available.");
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
    throw new ProviderWriteBackError(
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
        throw new ProviderWriteBackError("not_found", 404, "Writable provider credential was not found.");
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
    if (error instanceof ProviderWriteBackError) throw error;
    if (error instanceof OAuthExchangeClientError) {
      throw new ProviderWriteBackError(
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
    throw new ProviderWriteBackError("not_configured", 503, "Provider credential vault is not configured.");
  }

  return tokenVault;
}

function openCredentialSecret(tokenVault: IntegrationTokenVaultReady, credential: IntegrationCredential) {
  if (!credential.encryptedSecret) {
    throw new ProviderWriteBackError("invalid_state", 422, "Provider credential secret is not available.");
  }

  try {
    return tokenVault.open(credential.encryptedSecret, {
      associatedData: createIntegrationCredentialSecretContext(credential)
    });
  } catch (error) {
    if (error instanceof IntegrationTokenVaultError) {
      throw new ProviderWriteBackError("invalid_state", 422, "Provider credential could not be opened.");
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
    throw new ProviderWriteBackError(
      "upstream_error",
      502,
      `${integrationProviderLabels[provider]} OAuth refresh response did not include a refresh token.`
    );
  }

  if (!refreshed.expiresAt) {
    throw new ProviderWriteBackError(
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
    throw new ProviderWriteBackError("not_configured", 503, "Linear OAuth refresh is not configured.");
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret
  };
}

function requireJiraRefreshConfig(config: JiraOAuthConfig) {
  if (!config.clientId || !config.clientSecret) {
    throw new ProviderWriteBackError("not_configured", 503, "Jira OAuth refresh is not configured.");
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

  throw new ProviderWriteBackError("invalid_state", 422, "GitHub issue mapping does not include a repository issue reference.");
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
    throw new ProviderWriteBackError("invalid_state", 422, "Jira issue mapping does not include a cloud id.");
  }

  if (!issueIdOrKey) {
    throw new ProviderWriteBackError("invalid_state", 422, "Jira issue mapping does not include an issue id or key.");
  }

  return { cloudId, issueIdOrKey };
}

function splitCompositeJiraIssueId(value: string) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return [undefined, undefined] as const;

  return [value.slice(0, separator), value.slice(separator + 1)] as const;
}

function createWriteBackBody(request: RequestItem) {
  return boundText(stripImportedProviderPrefix(request.description), maxBodyLength, request.title);
}

function stripImportedProviderPrefix(value: string) {
  return value.replace(/^Imported from (?:GitHub|Linear|Jira) issue [^\n]+\nSource: [^\n]+\n\n/i, "");
}

function boundText(value: string, maxLength: number, fallback: string) {
  const normalized = value.trim();
  return (normalized || fallback).slice(0, maxLength);
}

function stripGitHubInstallationPrefix(value: string) {
  return value.replace(/^github-installation-/, "");
}

function normalizeProvider(provider: IntegrationProvider) {
  if (provider === "github" || provider === "linear" || provider === "jira") return provider;
  throw new ProviderWriteBackError("invalid_request", 400, "Integration provider is not supported.");
}

function getProviderIssueLabel(provider: IntegrationProvider, mapping: ExternalObjectMapping) {
  return `${integrationProviderLabels[provider]} issue ${mapping.external.key ?? mapping.external.id}`;
}

const integrationProviderLabels: Record<IntegrationProvider, string> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear"
};
