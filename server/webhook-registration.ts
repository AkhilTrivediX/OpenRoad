import { randomUUID } from "node:crypto";

import type {
  IntegrationInstallation,
  IntegrationProvider
} from "../src/integrations/adapter.js";
import type { GitHubAppClient, GitHubAppConfig } from "./github-app.js";
import type {
  IntegrationState,
  IntegrationStore,
  IntegrationWebhookRegistration
} from "./integrations.js";
import {
  parseIntegrationState,
  sanitizeIntegrationWebhookRegistration
} from "./integrations.js";

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type ProviderWebhookRegistrationInput = {
  installationId: string;
  provider: IntegrationProvider;
  workspaceId: string;
};

export type ProviderWebhookRegistrationResult = {
  message: string;
  provider: IntegrationProvider;
  registration: IntegrationWebhookRegistration;
  status: "active" | "blocked" | "failed";
};

export type ProviderWebhookRegistrationOptions = {
  githubAppClient: GitHubAppClient;
  githubAppConfig: GitHubAppConfig;
  integrationStore: IntegrationStore;
  now?: () => Date;
  publicBaseUrl?: string;
  runIntegrationMutationExclusive: ExclusiveRunner;
};

export class ProviderWebhookRegistrationError extends Error {
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

export async function registerProviderWebhook(
  options: ProviderWebhookRegistrationOptions,
  input: ProviderWebhookRegistrationInput
): Promise<ProviderWebhookRegistrationResult> {
  const provider = normalizeProvider(input.provider);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const publicBaseUrl = normalizeWebhookPublicBaseUrl(options.publicBaseUrl);
  if (!publicBaseUrl) {
    throw new ProviderWebhookRegistrationError(
      "not_configured",
      503,
      "OPENROAD_PUBLIC_APP_URL is required before hosted webhook registration."
    );
  }

  const targetUrl = createProviderWebhookUrl(publicBaseUrl, provider);
  const integrationResult = await options.integrationStore.load();
  const installation = validateWebhookRegistrationInstallation(integrationResult.state, {
    ...input,
    provider
  });

  if (provider !== "github") {
    const registration = createBlockedRegistration({
      installation,
      now,
      provider,
      targetUrl
    });
    const persisted = await upsertRegistration(options, registration);

    return {
      message: `${providerLabels[provider]} webhook registration is blocked until OpenRoad can verify provider-created deliveries with a server-known secret.`,
      provider,
      registration: persisted,
      status: "blocked"
    };
  }

  const secret = options.githubAppConfig.webhookSecret;
  if (!secret) {
    throw new ProviderWebhookRegistrationError(
      "not_configured",
      503,
      "OPENROAD_GITHUB_APP_WEBHOOK_SECRET is required before GitHub webhook registration."
    );
  }

  try {
    const config = await options.githubAppClient.updateAppWebhookConfig({
      contentType: "json",
      insecureSsl: "0",
      secret,
      url: targetUrl
    });
    const registration = createActiveRegistration({
      externalId: "github-app-hook",
      installation,
      now,
      provider,
      targetUrl: config.url || targetUrl
    });
    const persisted = await upsertRegistration(options, registration);

    return {
      message: "Registered GitHub App webhook delivery for this OpenRoad deployment.",
      provider,
      registration: persisted,
      status: "active"
    };
  } catch (error) {
    const failure = createFailedRegistration({
      error,
      installation,
      now,
      provider,
      targetUrl
    });
    const persisted = await upsertRegistration(options, failure);

    if (error instanceof ProviderWebhookRegistrationError) {
      throw error;
    }

    throw new ProviderWebhookRegistrationError(
      "upstream_error",
      getProviderErrorStatus(error),
      "GitHub App webhook registration failed."
    );
  }
}

function validateWebhookRegistrationInstallation(
  state: IntegrationState,
  input: ProviderWebhookRegistrationInput
) {
  const installation = state.installations.find(
    (item) =>
      item.id === input.installationId &&
      item.provider === input.provider &&
      item.workspaceId === input.workspaceId
  );

  if (!installation) {
    throw new ProviderWebhookRegistrationError("not_found", 404, "Integration installation was not found.");
  }

  if (installation.status !== "active") {
    throw new ProviderWebhookRegistrationError(
      "invalid_state",
      422,
      "Integration installation is disconnected or suspended."
    );
  }

  if (!installation.permissions.includes("webhook:receive")) {
    throw new ProviderWebhookRegistrationError(
      "invalid_state",
      422,
      "Integration installation cannot receive webhooks."
    );
  }

  return installation;
}

async function upsertRegistration(
  options: ProviderWebhookRegistrationOptions,
  registration: IntegrationWebhookRegistration
) {
  let persisted = sanitizeIntegrationWebhookRegistration(registration);

  await options.runIntegrationMutationExclusive(async () => {
    const latest = await options.integrationStore.load();
    const existing = latest.state.webhookRegistrations.find(
      (item) =>
        item.provider === persisted.provider &&
        item.workspaceId === persisted.workspaceId &&
        item.installationId === persisted.installationId &&
        item.targetUrl === persisted.targetUrl
    );
    persisted = sanitizeIntegrationWebhookRegistration({
      ...persisted,
      attempt: (existing?.attempt ?? 0) + 1,
      createdAt: existing?.createdAt ?? persisted.createdAt,
      id: existing?.id ?? persisted.id
    });

    await options.integrationStore.replaceState(
      parseIntegrationState({
        ...latest.state,
        syncEvents: [
          createWebhookRegistrationEvent(persisted),
          ...latest.state.syncEvents
        ].slice(0, 1000),
        webhookRegistrations: [
          persisted,
          ...latest.state.webhookRegistrations.filter((item) => item.id !== persisted.id)
        ].slice(0, 1000)
      })
    );
  });

  return persisted;
}

function createActiveRegistration({
  externalId,
  installation,
  now,
  provider,
  targetUrl
}: {
  externalId: string;
  installation: IntegrationInstallation;
  now: string;
  provider: IntegrationProvider;
  targetUrl: string;
}): IntegrationWebhookRegistration {
  return {
    attempt: 1,
    createdAt: now,
    events: getRegistrationEvents(provider),
    externalId,
    id: createWebhookRegistrationId(provider, installation),
    installationId: installation.id,
    lastAttemptAt: now,
    provider,
    status: "active",
    targetUrl,
    updatedAt: now,
    workspaceId: installation.workspaceId
  };
}

function createBlockedRegistration({
  installation,
  now,
  provider,
  targetUrl
}: {
  installation: IntegrationInstallation;
  now: string;
  provider: IntegrationProvider;
  targetUrl: string;
}): IntegrationWebhookRegistration {
  return {
    attempt: 1,
    createdAt: now,
    events: getRegistrationEvents(provider),
    id: createWebhookRegistrationId(provider, installation),
    installationId: installation.id,
    lastAttemptAt: now,
    lastError:
      "Provider webhook registration is blocked because OpenRoad cannot verify provider-created deliveries with a server-known secret.",
    provider,
    status: "blocked",
    targetUrl,
    updatedAt: now,
    workspaceId: installation.workspaceId
  };
}

function createFailedRegistration({
  error,
  installation,
  now,
  provider,
  targetUrl
}: {
  error: unknown;
  installation: IntegrationInstallation;
  now: string;
  provider: IntegrationProvider;
  targetUrl: string;
}): IntegrationWebhookRegistration {
  return {
    attempt: 1,
    createdAt: now,
    events: getRegistrationEvents(provider),
    id: createWebhookRegistrationId(provider, installation),
    installationId: installation.id,
    lastAttemptAt: now,
    lastError: sanitizeProviderError(error, `${providerLabels[provider]} webhook registration failed.`),
    provider,
    status: "failed",
    targetUrl,
    updatedAt: now,
    workspaceId: installation.workspaceId
  };
}

function createWebhookRegistrationEvent(registration: IntegrationWebhookRegistration) {
  return {
    createdAt: registration.updatedAt,
    deliveryId: `webhook-registration:${registration.provider}:${registration.id}:${registration.updatedAt}`,
    event: "webhook_registration",
    id: `sync-event-webhook-registration-${registration.provider}-${randomUUID()}`,
    installationId: registration.installationId,
    provider: registration.provider,
    result: registration.status === "active" ? "synced" as const : "ignored" as const,
    summary:
      registration.status === "active"
        ? `Registered ${providerLabels[registration.provider]} webhook delivery.`
        : `${providerLabels[registration.provider]} webhook registration ${registration.status}.`,
    workspaceId: registration.workspaceId
  };
}

function createWebhookRegistrationId(provider: IntegrationProvider, installation: IntegrationInstallation) {
  return [
    "webhook-registration",
    provider,
    encodeURIComponent(installation.workspaceId),
    encodeURIComponent(installation.id)
  ].join(":");
}

function getRegistrationEvents(provider: IntegrationProvider) {
  if (provider === "github") return ["issues", "pull_request", "installation"];
  if (provider === "linear") return ["Issue"];
  return ["jira:issue_created", "jira:issue_updated", "jira:issue_deleted"];
}

function createProviderWebhookUrl(publicBaseUrl: string, provider: IntegrationProvider) {
  const url = new URL(publicBaseUrl);
  url.pathname = `/api/openroad/integrations/${provider}/webhook`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolveWebhookRegistrationPublicBaseUrl(env = process.env) {
  return normalizeWebhookPublicBaseUrl(env.OPENROAD_WEBHOOK_PUBLIC_BASE_URL ?? env.OPENROAD_PUBLIC_APP_URL);
}

function normalizeWebhookPublicBaseUrl(value: string | undefined) {
  const text = value?.trim();
  if (!text) return undefined;

  try {
    const url = new URL(text);
    if (url.username || url.password) return undefined;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol !== "http:") return undefined;

    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      return url.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function normalizeProvider(provider: IntegrationProvider) {
  if (provider === "github" || provider === "linear" || provider === "jira") return provider;
  throw new ProviderWebhookRegistrationError("invalid_request", 400, "Integration provider is not supported.");
}

function getProviderErrorStatus(error: unknown) {
  if (isRecord(error) && typeof error.status === "number" && Number.isFinite(error.status)) {
    return Math.max(400, Math.min(599, Math.floor(error.status)));
  }

  return 502;
}

function sanitizeProviderError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  return error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:access_token|refresh_token|token|jwt|secret|client_secret|authorization)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .replace(/\b[\w.-]*(?:token|secret|password|credential|authorization)[\w.-]*\b/gi, "[redacted]")
    .slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const providerLabels: Record<IntegrationProvider, string> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear"
};
