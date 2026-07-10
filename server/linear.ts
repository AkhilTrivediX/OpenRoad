import {
  decodeProviderOAuthState,
  encodeProviderOAuthState,
  type ProviderOAuthState
} from "./oauth-state.js";

export type LinearOAuthConfig = {
  apiUrl?: string;
  appBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenUrl?: string;
};

export type LinearWebhookConfig = {
  webhookSecret?: string;
  webhookSecretConfigured: boolean;
};

export type SafeLinearOAuthSetup = {
  authorizeUrl?: string;
  configured: boolean;
  missing: string[];
  requiredScopes: string[];
  state?: string;
};

export type LinearOAuthState = ProviderOAuthState;

export const linearRequiredOAuthScopes = ["read"] as const;

export function linearOAuthConfigFromEnv(env = process.env): LinearOAuthConfig {
  return {
    apiUrl: normalizeEnvValue(env.OPENROAD_LINEAR_API_URL) ?? "https://api.linear.app/graphql",
    appBaseUrl: normalizeUrl(env.OPENROAD_LINEAR_APP_BASE_URL ?? "https://linear.app"),
    clientId: normalizeEnvValue(env.OPENROAD_LINEAR_CLIENT_ID),
    clientSecret: normalizeEnvValue(env.OPENROAD_LINEAR_CLIENT_SECRET),
    redirectUri: normalizeEnvValue(env.OPENROAD_LINEAR_REDIRECT_URI),
    tokenUrl: normalizeEnvValue(env.OPENROAD_LINEAR_TOKEN_URL) ?? "https://api.linear.app/oauth/token"
  };
}

export function linearWebhookConfigFromEnv(env = process.env): LinearWebhookConfig {
  const webhookSecret = normalizeEnvValue(env.OPENROAD_LINEAR_WEBHOOK_SECRET);

  return {
    webhookSecret,
    webhookSecretConfigured: Boolean(webhookSecret)
  };
}

export function createSafeLinearOAuthSetup(
  config: LinearOAuthConfig,
  workspaceId: string,
  now = new Date(),
  options: { installationId?: string } = {}
): SafeLinearOAuthSetup {
  const missing = getMissingLinearOAuthSetupKeys(config);
  const configured = missing.length === 0;
  const state =
    configured && config.clientSecret
      ? encodeProviderOAuthState(
          {
            createdAt: now.toISOString(),
            ...(options.installationId ? { installationId: options.installationId } : {}),
            provider: "linear",
            workspaceId
          },
          config.clientSecret
        )
      : undefined;

  return {
    authorizeUrl: configured && state ? createLinearAuthorizeUrl(config, state) : undefined,
    configured,
    missing,
    requiredScopes: [...linearRequiredOAuthScopes],
    state
  };
}

export function getMissingLinearOAuthSetupKeys(config: LinearOAuthConfig) {
  const missing: string[] = [];
  if (!config.clientId) missing.push("OPENROAD_LINEAR_CLIENT_ID");
  if (!config.clientSecret) missing.push("OPENROAD_LINEAR_CLIENT_SECRET");
  if (!config.redirectUri) missing.push("OPENROAD_LINEAR_REDIRECT_URI");
  return missing;
}

function createLinearAuthorizeUrl(config: LinearOAuthConfig, state: string) {
  if (!config.clientId) throw new Error("OPENROAD_LINEAR_CLIENT_ID is required.");
  if (!config.redirectUri) throw new Error("OPENROAD_LINEAR_REDIRECT_URI is required.");

  const url = new URL("/oauth/authorize", config.appBaseUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", linearRequiredOAuthScopes.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export function decodeLinearOAuthState(value: string, config: LinearOAuthConfig): LinearOAuthState {
  if (!config.clientSecret) throw new Error("OPENROAD_LINEAR_CLIENT_SECRET is required.");
  return decodeProviderOAuthState(value, config.clientSecret, "linear");
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeEnvValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
