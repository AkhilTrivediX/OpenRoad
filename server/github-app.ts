import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  createGitHubInstallation,
  parseGitHubIssuePayload,
  type GitHubInstallationInput,
  type GitHubIssue
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
  webhookSecret?: string;
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
  createInstallationAccessToken(installationId: string): Promise<GitHubInstallationAccessToken>;
  getInstallation(installationId: string): Promise<GitHubAppInstallationApiPayload>;
  getRepositoryIssue(options: GitHubRepositoryIssueGetOptions): Promise<GitHubIssue>;
  listRepositoryIssues(options: GitHubRepositoryIssueListOptions): Promise<GitHubIssue[]>;
  updateAppWebhookConfig(options: GitHubAppWebhookConfigUpdateOptions): Promise<GitHubAppWebhookConfig>;
  updateRepositoryIssue(options: GitHubRepositoryIssueUpdateOptions): Promise<GitHubIssue>;
};

export type GitHubInstallationAccessToken = {
  expiresAt?: string;
  token: string;
};

export type GitHubRepositoryIssueListOptions = {
  installationId: string;
  owner: string;
  perPage?: number;
  repo: string;
  state?: "all" | "closed" | "open";
};

export type GitHubRepositoryIssueGetOptions = {
  installationId: string;
  issueNumber: number;
  owner: string;
  repo: string;
};

export type GitHubRepositoryIssueUpdateOptions = GitHubRepositoryIssueGetOptions & {
  body: string;
  title: string;
};

export type GitHubAppWebhookConfig = {
  contentType: "json" | "form" | "unknown";
  insecureSsl: "0" | "1" | "unknown";
  secretConfigured: boolean;
  url: string;
};

export type GitHubAppWebhookConfigUpdateOptions = {
  contentType: "json";
  insecureSsl: "0";
  secret: string;
  url: string;
};

export type GitHubAppJwtOptions = {
  appId: string;
  nowSeconds?: number;
  privateKey: string;
};

export const githubAppRequiredPermissions = {
  issues: "write",
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
    const jwt = await this.createJwt();
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

  async createInstallationAccessToken(installationId: string): Promise<GitHubInstallationAccessToken> {
    const jwt = await this.createJwt();
    const response = await this.fetchImpl(
      `${this.config.apiBaseUrl}/app/installations/${encodeURIComponent(
        installationId
      )}/access_tokens`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        method: "POST"
      }
    );

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_api_error",
        `GitHub installation token request failed with status ${response.status}.`,
        response.status
      );
    }

    const body = (await response.json()) as unknown;
    if (!isRecord(body) || typeof body.token !== "string" || !body.token.trim()) {
      throw new GitHubAppClientError("invalid_response", "GitHub installation token response was invalid.");
    }

    return {
      expiresAt: typeof body.expires_at === "string" ? body.expires_at : undefined,
      token: body.token
    };
  }

  async listRepositoryIssues(options: GitHubRepositoryIssueListOptions) {
    const accessToken = await this.createInstallationAccessToken(options.installationId);
    const url = new URL(
      `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/issues`,
      this.config.apiBaseUrl
    );
    url.searchParams.set("state", options.state ?? "open");
    url.searchParams.set("per_page", String(options.perPage ?? 30));
    const response = await this.fetchImpl(url.toString(), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken.token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_api_error",
        `GitHub issue fetch failed with status ${response.status}.`,
        response.status
      );
    }

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      throw new GitHubAppClientError("invalid_response", "GitHub issue list response was invalid.");
    }

    return body
      .filter((item): item is Record<string, unknown> => isRecord(item) && !isRecord(item.pull_request))
      .map((item) => parseGitHubIssuePayload(item));
  }

  async getRepositoryIssue(options: GitHubRepositoryIssueGetOptions) {
    const accessToken = await this.createInstallationAccessToken(options.installationId);
    const response = await this.fetchImpl(
      `${this.config.apiBaseUrl}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(
        options.repo
      )}/issues/${encodeURIComponent(String(options.issueNumber))}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken.token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_api_error",
        `GitHub issue fetch failed with status ${response.status}.`,
        response.status
      );
    }

    const body = (await response.json()) as unknown;
    if (!isRecord(body)) {
      throw new GitHubAppClientError("invalid_response", "GitHub issue response was invalid.");
    }

    return parseGitHubIssuePayload(body);
  }

  async updateRepositoryIssue(options: GitHubRepositoryIssueUpdateOptions) {
    const accessToken = await this.createInstallationAccessToken(options.installationId);
    const response = await this.fetchImpl(
      `${this.config.apiBaseUrl}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(
        options.repo
      )}/issues/${encodeURIComponent(String(options.issueNumber))}`,
      {
        body: JSON.stringify({
          body: options.body,
          title: options.title
        }),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        method: "PATCH"
      }
    );

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_api_error",
        `GitHub issue update failed with status ${response.status}.`,
        response.status
      );
    }

    const body = (await response.json()) as unknown;
    if (!isRecord(body)) {
      throw new GitHubAppClientError("invalid_response", "GitHub issue update response was invalid.");
    }

    return parseGitHubIssuePayload(body);
  }

  async updateAppWebhookConfig(options: GitHubAppWebhookConfigUpdateOptions) {
    const jwt = await this.createJwt();
    const response = await this.fetchImpl(`${this.config.apiBaseUrl}/app/hook/config`, {
      body: JSON.stringify({
        content_type: options.contentType,
        insecure_ssl: options.insecureSsl,
        secret: options.secret,
        url: options.url
      }),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      method: "PATCH"
    });

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_api_error",
        `GitHub App webhook configuration update failed with status ${response.status}.`,
        response.status
      );
    }

    const body = (await response.json()) as unknown;
    if (!isRecord(body)) {
      throw new GitHubAppClientError(
        "invalid_response",
        "GitHub App webhook configuration response was invalid."
      );
    }

    const url = normalizeEnvValue(body.url);
    if (!url) {
      throw new GitHubAppClientError(
        "invalid_response",
        "GitHub App webhook configuration response did not include a URL."
      );
    }

    const contentType: GitHubAppWebhookConfig["contentType"] =
      body.content_type === "json" || body.content_type === "form" ? body.content_type : "unknown";
    const insecureSsl: GitHubAppWebhookConfig["insecureSsl"] =
      body.insecure_ssl === "0" || body.insecure_ssl === 0
        ? "0"
        : body.insecure_ssl === "1" || body.insecure_ssl === 1
          ? "1"
          : "unknown";

    return {
      contentType,
      insecureSsl,
      secretConfigured: Boolean(normalizeEnvValue(body.secret)),
      url
    };
  }

  private async createJwt() {
    if (!this.config.appId) {
      throw new GitHubAppClientError("missing_config", "OPENROAD_GITHUB_APP_ID is required.");
    }

    const privateKey = await readGitHubAppPrivateKey(this.config);
    return createGitHubAppJwt({
      appId: this.config.appId,
      privateKey
    });
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
    webhookSecret: normalizeEnvValue(env.OPENROAD_GITHUB_APP_WEBHOOK_SECRET),
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

export function verifyGitHubWebhookSignature({
  payload,
  secret,
  signatureHeader
}: {
  payload: Buffer;
  secret: string;
  signatureHeader: string | undefined;
}) {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const received = Buffer.from(signatureHeader, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
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
