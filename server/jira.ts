export type JiraOAuthConfig = {
  authBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

export type JiraWebhookConfig = {
  webhookSecret?: string;
  webhookSecretConfigured: boolean;
};

export type SafeJiraOAuthSetup = {
  authorizeUrl?: string;
  configured: boolean;
  missing: string[];
  requiredScopes: string[];
  state?: string;
};

export const jiraRequiredOAuthScopes = ["read:jira-work", "read:jira-user"] as const;

export function jiraOAuthConfigFromEnv(env = process.env): JiraOAuthConfig {
  return {
    authBaseUrl: normalizeUrl(env.OPENROAD_JIRA_AUTH_BASE_URL ?? "https://auth.atlassian.com"),
    clientId: normalizeEnvValue(env.OPENROAD_JIRA_CLIENT_ID),
    clientSecret: normalizeEnvValue(env.OPENROAD_JIRA_CLIENT_SECRET),
    redirectUri: normalizeEnvValue(env.OPENROAD_JIRA_REDIRECT_URI)
  };
}

export function jiraWebhookConfigFromEnv(env = process.env): JiraWebhookConfig {
  const webhookSecret = normalizeEnvValue(env.OPENROAD_JIRA_WEBHOOK_SECRET);

  return {
    webhookSecret,
    webhookSecretConfigured: Boolean(webhookSecret)
  };
}

export function createSafeJiraOAuthSetup(
  config: JiraOAuthConfig,
  workspaceId: string,
  now = new Date()
): SafeJiraOAuthSetup {
  const missing = getMissingJiraOAuthSetupKeys(config);
  const state = encodeJiraOAuthState({
    createdAt: now.toISOString(),
    workspaceId
  });

  return {
    authorizeUrl: missing.length === 0 ? createJiraAuthorizeUrl(config, state) : undefined,
    configured: missing.length === 0,
    missing,
    requiredScopes: [...jiraRequiredOAuthScopes],
    state
  };
}

export function getMissingJiraOAuthSetupKeys(config: JiraOAuthConfig) {
  const missing: string[] = [];
  if (!config.clientId) missing.push("OPENROAD_JIRA_CLIENT_ID");
  if (!config.clientSecret) missing.push("OPENROAD_JIRA_CLIENT_SECRET");
  if (!config.redirectUri) missing.push("OPENROAD_JIRA_REDIRECT_URI");
  return missing;
}

function createJiraAuthorizeUrl(config: JiraOAuthConfig, state: string) {
  if (!config.clientId) throw new Error("OPENROAD_JIRA_CLIENT_ID is required.");
  if (!config.redirectUri) throw new Error("OPENROAD_JIRA_REDIRECT_URI is required.");

  const url = new URL("/authorize", config.authBaseUrl);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", jiraRequiredOAuthScopes.join(" "));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

function encodeJiraOAuthState(value: { createdAt: string; workspaceId: string }) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeEnvValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
