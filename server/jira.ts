import {
  decodeProviderOAuthState,
  encodeProviderOAuthState,
  type ProviderOAuthState
} from "./oauth-state.js";

export type JiraOAuthConfig = {
  authBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  resourceBaseUrl: string;
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

export type JiraOAuthState = ProviderOAuthState;

export const jiraRequiredOAuthScopes = ["read:jira-work", "read:jira-user"] as const;

export function jiraOAuthConfigFromEnv(env = process.env): JiraOAuthConfig {
  return {
    authBaseUrl: normalizeUrl(env.OPENROAD_JIRA_AUTH_BASE_URL ?? "https://auth.atlassian.com"),
    clientId: normalizeEnvValue(env.OPENROAD_JIRA_CLIENT_ID),
    clientSecret: normalizeEnvValue(env.OPENROAD_JIRA_CLIENT_SECRET),
    redirectUri: normalizeEnvValue(env.OPENROAD_JIRA_REDIRECT_URI),
    resourceBaseUrl: normalizeUrl(env.OPENROAD_JIRA_RESOURCE_BASE_URL ?? "https://api.atlassian.com")
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
  now = new Date(),
  options: { installationId?: string } = {}
): SafeJiraOAuthSetup {
  const missing = getMissingJiraOAuthSetupKeys(config);
  const configured = missing.length === 0;
  const state =
    configured && config.clientSecret
      ? encodeProviderOAuthState(
          {
            createdAt: now.toISOString(),
            ...(options.installationId ? { installationId: options.installationId } : {}),
            provider: "jira",
            workspaceId
          },
          config.clientSecret
        )
      : undefined;

  return {
    authorizeUrl: configured && state ? createJiraAuthorizeUrl(config, state) : undefined,
    configured,
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

export function decodeJiraOAuthState(value: string, config: JiraOAuthConfig): JiraOAuthState {
  if (!config.clientSecret) throw new Error("OPENROAD_JIRA_CLIENT_SECRET is required.");
  return decodeProviderOAuthState(value, config.clientSecret, "jira");
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeEnvValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
