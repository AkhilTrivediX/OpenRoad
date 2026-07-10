export type LinearOAuthConfig = {
  appBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
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

export const linearRequiredOAuthScopes = ["read"] as const;

export function linearOAuthConfigFromEnv(env = process.env): LinearOAuthConfig {
  return {
    appBaseUrl: normalizeUrl(env.OPENROAD_LINEAR_APP_BASE_URL ?? "https://linear.app"),
    clientId: normalizeEnvValue(env.OPENROAD_LINEAR_CLIENT_ID),
    clientSecret: normalizeEnvValue(env.OPENROAD_LINEAR_CLIENT_SECRET),
    redirectUri: normalizeEnvValue(env.OPENROAD_LINEAR_REDIRECT_URI)
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
  now = new Date()
): SafeLinearOAuthSetup {
  const missing = getMissingLinearOAuthSetupKeys(config);
  const state = encodeLinearOAuthState({
    createdAt: now.toISOString(),
    workspaceId
  });

  return {
    authorizeUrl: missing.length === 0 ? createLinearAuthorizeUrl(config, state) : undefined,
    configured: missing.length === 0,
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

function encodeLinearOAuthState(value: { createdAt: string; workspaceId: string }) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeEnvValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
