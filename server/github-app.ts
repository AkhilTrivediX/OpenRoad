import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  createGitHubInstallation,
  type GitHubInstallationInput
} from "../src/integrations/github.js";
import type { IntegrationInstallation, IntegrationPermission } from "../src/integrations/adapter.js";

export type GitHubAppConfig = {
  apiBaseUrl: string;
  appBaseUrl: string;
  appId?: string;
  clientId?: string;
  privateKey?: string;
  privateKeyFile?: string;
  slug?: string;
  webhookSecretConfigured: boolean;
};

export type SafeGitHubAppSetup = {
  configured: boolean;
  installUrl?: string;
  missing: string[];
  requiredEvents: string[];
  requiredPermissions: Record<string, "read" | "write">;
  state?: string;
};

export type GitHubAppInstallationApiPayload = {
  account?: {
    id?: number | string;
    login?: string;
    name?: string;
    type?: string;
  };
  html_url?: string;
  id?: number | string;
  permissions?: Record<string, string>;
  repository_selection?: string;
  target_type?: string;
};

export type GitHubAppClient = {
  getInstallation(installationId: string): Promise<GitHubAppInstallationApiPayload>;
};

export type GitHubAppJwtOptions = {
  appId: string;
  nowSeconds?: number;
  privateKey: string;
};

export const githubAppRequiredPermissions = {
  issues: "read",
  pull_requests: "read"
} as const;

export const githubAppRequiredEvents = ["issues", "pull_request"] as const;

export class GitHubAppClientError extends Error {
  constructor(
    readonly code: "missing_config" | "github_api_error" | "invalid_response",
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export class FetchGitHubAppClient implements GitHubAppClient {
  constructor(
    private readonly config: GitHubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getInstallation(installationId: string) {
    if (!this.config.appId) {
      throw new GitHubAppClientError("missing_config", "OPENROAD_GITHUB_APP_ID is required.");
    }

    const privateKey = await readGitHubAppPrivateKey(this.config);
    const jwt = createGitHubAppJwt({
      appId: this.config.appId,
      privateKey
    });
    const response = await this.fetchImpl(
      `${this.config.apiBaseUrl}/app/installations/${encodeURIComponent(installationId)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_api_error",
        `GitHub installation verification failed with status ${response.status}.`,
        response.status
      );
    }

    const body = (await response.json()) as unknown;
    if (!isRecord(body)) {
      throw new GitHubAppClientError("invalid_response", "GitHub installation response was invalid.");
    }

    return body as GitHubAppInstallationApiPayload;
  }
}

export function githubAppConfigFromEnv(env = process.env): GitHubAppConfig {
  return {
    apiBaseUrl: normalizeUrl(env.OPENROAD_GITHUB_API_BASE_URL ?? "https://api.github.com"),
    appBaseUrl: normalizeUrl(env.OPENROAD_GITHUB_APP_BASE_URL ?? "https://github.com"),
    appId: normalizeEnvValue(env.OPENROAD_GITHUB_APP_ID),
    clientId: normalizeEnvValue(env.OPENROAD_GITHUB_APP_CLIENT_ID),
    privateKey: normalizePrivateKey(env.OPENROAD_GITHUB_APP_PRIVATE_KEY),
    privateKeyFile: normalizeEnvValue(env.OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE),
    slug: normalizeSlug(env.OPENROAD_GITHUB_APP_SLUG),
    webhookSecretConfigured: Boolean(normalizeEnvValue(env.OPENROAD_GITHUB_APP_WEBHOOK_SECRET))
  };
}

export function createSafeGitHubAppSetup(
  config: GitHubAppConfig,
  workspaceId: string,
  now = new Date()
): SafeGitHubAppSetup {
  const missing = getMissingGitHubAppSetupKeys(config);
  const state = encodeGitHubAppState({
    createdAt: now.toISOString(),
    workspaceId
  });

  return {
    configured: missing.length === 0,
    installUrl: config.slug ? createGitHubAppInstallUrl(config, state) : undefined,
    missing,
    requiredEvents: [...githubAppRequiredEvents],
    requiredPermissions: { ...githubAppRequiredPermissions },
    state
  };
}

export function getMissingGitHubAppSetupKeys(config: GitHubAppConfig) {
  const missing: string[] = [];
  if (!config.slug) missing.push("OPENROAD_GITHUB_APP_SLUG");
  if (!config.appId) missing.push("OPENROAD_GITHUB_APP_ID");
  if (!config.privateKey && !config.privateKeyFile) {
    missing.push("OPENROAD_GITHUB_APP_PRIVATE_KEY or OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE");
  }
  return missing;
}

export function createGitHubAppInstallUrl(config: GitHubAppConfig, state: string) {
  if (!config.slug) {
    throw new Error("OPENROAD_GITHUB_APP_SLUG is required to create an install URL.");
  }

  const url = new URL(`/apps/${config.slug}/installations/new`, config.appBaseUrl);
  url.searchParams.set("state", state);
  return url.toString();
}

export function createGitHubAppJwt({
  appId,
  nowSeconds = Math.floor(Date.now() / 1000),
  privateKey
}: GitHubAppJwtOptions) {
  const header = base64UrlJson({
    alg: "RS256",
    typ: "JWT"
  });
  const payload = base64UrlJson({
    exp: nowSeconds + 540,
    iat: nowSeconds - 60,
    iss: appId
  });
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${base64Url(signer.sign(privateKey))}`;
}

export function decodeGitHubAppJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  if (!payload) throw new Error("GitHub App JWT is invalid.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

export function normalizeGitHubAppInstallation(
  payload: GitHubAppInstallationApiPayload,
  workspaceId: string
): IntegrationInstallation {
  const account = isRecord(payload.account) ? payload.account : {};
  const accountId = stringifyId(account.id);
  const accountName = normalizeEnvValue(
    typeof account.login === "string" ? account.login : account.name
  );
  const installationId = stringifyId(payload.id);

  if (!installationId) {
    throw new Error("GitHub installation id is required.");
  }

  if (!accountId || !accountName) {
    throw new Error("GitHub installation account id and name are required.");
  }

  const input: GitHubInstallationInput = {
    accountId,
    accountName,
    createdAt: new Date().toISOString(),
    id: `github-installation-${installationId}`,
    permissions: mapGitHubAppPermissions(payload.permissions),
    workspaceId
  };

  return createGitHubInstallation(input);
}

export async function readGitHubAppPrivateKey(config: GitHubAppConfig) {
  if (config.privateKey) return config.privateKey;
  if (!config.privateKeyFile) {
    throw new GitHubAppClientError(
      "missing_config",
      "OPENROAD_GITHUB_APP_PRIVATE_KEY or OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE is required."
    );
  }
  return normalizePrivateKey(await readFile(config.privateKeyFile, "utf8")) ?? "";
}

function mapGitHubAppPermissions(
  permissions: GitHubAppInstallationApiPayload["permissions"] = {}
): IntegrationPermission[] {
  const openRoadPermissions: IntegrationPermission[] = [
    "read:openroad",
    "write:openroad"
  ];
  const canReadIssues = permissions.issues === "read" || permissions.issues === "write";
  const canReadPullRequests =
    permissions.pull_requests === "read" || permissions.pull_requests === "write";

  if (canReadIssues || canReadPullRequests) {
    openRoadPermissions.push("read:external");
  }

  if (permissions.issues === "write" || permissions.pull_requests === "write") {
    openRoadPermissions.push("write:external");
  }

  return [...new Set(openRoadPermissions)];
}

function encodeGitHubAppState(value: { createdAt: string; workspaceId: string }) {
  return base64UrlJson(value);
}

function base64UrlJson(value: unknown) {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(value: Buffer) {
  return value.toString("base64url");
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeSlug(value: string | undefined) {
  const normalized = normalizeEnvValue(value);
  return normalized?.replace(/^@+/, "");
}

function normalizePrivateKey(value: string | undefined) {
  const normalized = normalizeEnvValue(value);
  return normalized?.replace(/\\n/g, "\n");
}

function normalizeEnvValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringifyId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return normalizeEnvValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
