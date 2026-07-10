import type { JiraOAuthConfig } from "./jira.js";
import type { LinearOAuthConfig } from "./linear.js";

export type OAuthTokenExchangeResult = {
  accessToken: string;
  account?: {
    id: string;
    name: string;
  };
  expiresAt?: string;
  providerScopes: string[];
  refreshToken?: string;
  tokenType?: string;
};

export type JiraAccessibleResource = {
  id: string;
  name: string;
  scopes: string[];
  url?: string;
};

export type LinearOAuthExchangeClient = {
  exchangeCode(options: OAuthCodeExchangeOptions): Promise<OAuthTokenExchangeResult>;
};

export type JiraOAuthExchangeClient = {
  exchangeCode(options: OAuthCodeExchangeOptions): Promise<
    OAuthTokenExchangeResult & { resources: JiraAccessibleResource[] }
  >;
};

export type OAuthCodeExchangeOptions = {
  code: string;
  config: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
};

export class OAuthExchangeClientError extends Error {
  constructor(
    readonly code: "invalid_response" | "oauth_exchange_failed" | "resource_check_failed",
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export class FetchLinearOAuthExchangeClient implements LinearOAuthExchangeClient {
  constructor(
    private readonly config: Pick<LinearOAuthConfig, "apiUrl" | "tokenUrl">,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async exchangeCode(options: OAuthCodeExchangeOptions) {
    const body = new URLSearchParams({
      client_id: options.config.clientId,
      client_secret: options.config.clientSecret,
      code: options.code,
      grant_type: "authorization_code",
      redirect_uri: options.config.redirectUri
    });
    let response: Response;

    try {
      response = await this.fetchImpl(this.config.tokenUrl ?? "https://api.linear.app/oauth/token", {
        body: body.toString(),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        method: "POST"
      });
    } catch {
      throw new OAuthExchangeClientError(
        "oauth_exchange_failed",
        "Linear OAuth token exchange failed before response."
      );
    }

    if (!response.ok) {
      throw new OAuthExchangeClientError(
        "oauth_exchange_failed",
        `Linear OAuth token exchange failed with status ${response.status}.`,
        response.status
      );
    }

    const token = parseOAuthTokenResponse(await readJson(response), "Linear");
    return {
      ...token,
      account: await this.loadAccount(token.accessToken)
    };
  }

  private async loadAccount(accessToken: string) {
    let response: Response;

    try {
      response = await this.fetchImpl(this.config.apiUrl ?? "https://api.linear.app/graphql", {
        body: JSON.stringify({
          query: `
            query OpenRoadOAuthViewer {
              viewer {
                id
                name
                displayName
                organization {
                  id
                  name
                  urlKey
                }
              }
            }
          `
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      });
    } catch {
      throw new OAuthExchangeClientError(
        "resource_check_failed",
        "Linear OAuth account lookup failed before response."
      );
    }

    if (!response.ok) {
      throw new OAuthExchangeClientError(
        "resource_check_failed",
        `Linear OAuth account lookup failed with status ${response.status}.`,
        response.status
      );
    }

    return parseLinearOAuthAccount(await readJson(response));
  }
}

export class FetchJiraOAuthExchangeClient implements JiraOAuthExchangeClient {
  constructor(
    private readonly config: Pick<JiraOAuthConfig, "authBaseUrl" | "resourceBaseUrl">,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async exchangeCode(options: OAuthCodeExchangeOptions) {
    let tokenResponse: Response;

    try {
      tokenResponse = await this.fetchImpl(new URL("/oauth/token", this.config.authBaseUrl).toString(), {
        body: JSON.stringify({
          client_id: options.config.clientId,
          client_secret: options.config.clientSecret,
          code: options.code,
          grant_type: "authorization_code",
          redirect_uri: options.config.redirectUri
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        method: "POST"
      });
    } catch {
      throw new OAuthExchangeClientError(
        "oauth_exchange_failed",
        "Jira OAuth token exchange failed before response."
      );
    }

    if (!tokenResponse.ok) {
      throw new OAuthExchangeClientError(
        "oauth_exchange_failed",
        `Jira OAuth token exchange failed with status ${tokenResponse.status}.`,
        tokenResponse.status
      );
    }

    const token = parseOAuthTokenResponse(await readJson(tokenResponse), "Jira");
    const resources = await this.loadAccessibleResources(token.accessToken);
    return { ...token, resources };
  }

  private async loadAccessibleResources(accessToken: string) {
    let response: Response;

    try {
      response = await this.fetchImpl(
        new URL("/oauth/token/accessible-resources", this.config.resourceBaseUrl).toString(),
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`
          },
          method: "GET"
        }
      );
    } catch {
      throw new OAuthExchangeClientError(
        "resource_check_failed",
        "Jira accessible resource check failed before response."
      );
    }

    if (!response.ok) {
      throw new OAuthExchangeClientError(
        "resource_check_failed",
        `Jira accessible resource check failed with status ${response.status}.`,
        response.status
      );
    }

    return parseJiraAccessibleResources(await readJson(response));
  }
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new OAuthExchangeClientError("invalid_response", "OAuth provider response was not valid JSON.");
  }
}

function parseOAuthTokenResponse(value: unknown, providerLabel: string): OAuthTokenExchangeResult {
  if (!isRecord(value)) {
    throw new OAuthExchangeClientError("invalid_response", `${providerLabel} OAuth response was invalid.`);
  }

  const accessToken = getSecretText(value.access_token);
  if (!accessToken) {
    throw new OAuthExchangeClientError("invalid_response", `${providerLabel} OAuth response did not include an access token.`);
  }

  return {
    accessToken,
    expiresAt: parseExpiresAt(value.expires_in),
    providerScopes: parseScopes(value.scope),
    refreshToken: getSecretText(value.refresh_token),
    tokenType: getText(value.token_type, 80)?.toLowerCase()
  };
}

function parseJiraAccessibleResources(value: unknown): JiraAccessibleResource[] {
  if (!Array.isArray(value)) {
    throw new OAuthExchangeClientError("invalid_response", "Jira accessible resources response was invalid.");
  }

  return value
    .map((item) => {
      if (!isRecord(item)) return undefined;
      const id = getText(item.id, 160);
      const name = getText(item.name, 160);
      if (!id || !name) return undefined;
      const url = getText(item.url, 500);

      return {
        id,
        name,
        scopes: Array.isArray(item.scopes)
          ? item.scopes.map((scope) => getText(scope, 160)).filter((scope): scope is string => Boolean(scope))
          : [],
        ...(url ? { url } : {})
      };
    })
    .filter((item): item is JiraAccessibleResource => Boolean(item));
}

function parseLinearOAuthAccount(value: unknown) {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.viewer)) {
    throw new OAuthExchangeClientError("invalid_response", "Linear OAuth account response was invalid.");
  }

  const organization = isRecord(value.data.viewer.organization)
    ? value.data.viewer.organization
    : undefined;
  const id = getText(organization?.id, 160) ?? getText(value.data.viewer.id, 160);
  const name =
    getText(organization?.name, 160) ??
    getText(organization?.urlKey, 160) ??
    getText(value.data.viewer.displayName, 160) ??
    getText(value.data.viewer.name, 160);

  if (!id || !name) {
    throw new OAuthExchangeClientError("invalid_response", "Linear OAuth account response was invalid.");
  }

  return { id, name };
}

function parseScopes(value: unknown) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean))];
}

function parseExpiresAt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(Date.now() + Math.round(value) * 1000).toISOString();
}

function getSecretText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > 20_000) return undefined;
  return text;
}

function getText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
