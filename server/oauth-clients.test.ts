// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  FetchJiraOAuthExchangeClient,
  FetchLinearOAuthExchangeClient,
  OAuthExchangeClientError
} from "./oauth-clients";

describe("OAuth exchange clients", () => {
  it("exchanges Linear codes with form encoding and resolves the Linear account", async () => {
    const calls: Array<{ body?: unknown; headers?: Headers; method?: string; url: string }> = [];
    const client = new FetchLinearOAuthExchangeClient(
      {
        apiUrl: "https://api.linear.test/graphql",
        tokenUrl: "https://api.linear.test/oauth/token"
      },
      (async (input, init) => {
        const url = String(input);
        calls.push({
          body: init?.body,
          headers: new Headers(init?.headers),
          method: init?.method,
          url
        });

        if (url === "https://api.linear.test/oauth/token") {
          return jsonResponse({
            access_token: "linear-access",
            expires_in: 3600,
            refresh_token: "linear-refresh",
            scope: "read admin",
            token_type: "Bearer"
          });
        }

        return jsonResponse({
          data: {
            viewer: {
              displayName: "Akhil Trivedi",
              id: "linear-user",
              organization: {
                id: "linear-team",
                name: "OpenRoad Linear"
              }
            }
          }
        });
      }) as typeof fetch
    );

    const result = await client.exchangeCode({
      code: "linear-code",
      config: {
        clientId: "lin-client",
        clientSecret: "linear-secret",
        redirectUri: "https://openroad.test/api/openroad/integrations/linear/oauth/callback"
      }
    });
    const tokenBody = new URLSearchParams(calls[0].body as string);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.linear.test/oauth/token"
    });
    expect(calls[0].headers?.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("client_id")).toBe("lin-client");
    expect(tokenBody.get("client_secret")).toBe("linear-secret");
    expect(tokenBody.get("code")).toBe("linear-code");
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://api.linear.test/graphql"
    });
    expect(calls[1].headers?.get("authorization")).toBe("Bearer linear-access");
    expect(result).toMatchObject({
      accessToken: "linear-access",
      account: { id: "linear-team", name: "OpenRoad Linear" },
      providerScopes: ["read", "admin"],
      refreshToken: "linear-refresh",
      tokenType: "bearer"
    });
    expect(Date.parse(result.expiresAt ?? "")).toBeGreaterThan(Date.now());
  });

  it("exchanges Jira codes and loads accessible resources with bearer auth", async () => {
    const calls: Array<{ body?: unknown; headers?: Headers; method?: string; url: string }> = [];
    const client = new FetchJiraOAuthExchangeClient(
      {
        authBaseUrl: "https://auth.atlassian.test",
        resourceBaseUrl: "https://api.atlassian.test"
      },
      (async (input, init) => {
        const url = String(input);
        calls.push({
          body: init?.body,
          headers: new Headers(init?.headers),
          method: init?.method,
          url
        });

        if (url === "https://auth.atlassian.test/oauth/token") {
          return jsonResponse({
            access_token: "jira-access",
            expires_in: 1800,
            refresh_token: "jira-refresh",
            scope: "read:jira-work read:jira-user",
            token_type: "Bearer"
          });
        }

        return jsonResponse([
          {
            id: "jira-cloud",
            name: "OpenRoad Jira",
            scopes: ["read:jira-work", "read:jira-user"],
            url: "https://openroad.atlassian.net"
          }
        ]);
      }) as typeof fetch
    );

    const result = await client.exchangeCode({
      code: "jira-code",
      config: {
        clientId: "jira-client",
        clientSecret: "jira-secret",
        redirectUri: "https://openroad.test/api/openroad/integrations/jira/oauth/callback"
      }
    });
    const tokenBody = JSON.parse(calls[0].body as string) as Record<string, string>;

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://auth.atlassian.test/oauth/token"
    });
    expect(calls[0].headers?.get("content-type")).toBe("application/json");
    expect(tokenBody).toMatchObject({
      client_id: "jira-client",
      client_secret: "jira-secret",
      code: "jira-code",
      grant_type: "authorization_code"
    });
    expect(calls[1]).toMatchObject({
      method: "GET",
      url: "https://api.atlassian.test/oauth/token/accessible-resources"
    });
    expect(calls[1].headers?.get("authorization")).toBe("Bearer jira-access");
    expect(result).toMatchObject({
      accessToken: "jira-access",
      providerScopes: ["read:jira-work", "read:jira-user"],
      refreshToken: "jira-refresh",
      resources: [
        {
          id: "jira-cloud",
          name: "OpenRoad Jira",
          scopes: ["read:jira-work", "read:jira-user"],
          url: "https://openroad.atlassian.net"
        }
      ],
      tokenType: "bearer"
    });
  });

  it("returns typed upstream failures without provider body leakage", async () => {
    const client = new FetchLinearOAuthExchangeClient(
      { tokenUrl: "https://api.linear.test/oauth/token" },
      (async () => new Response("invalid_grant: linear-secret", { status: 401 })) as typeof fetch
    );

    await expect(
      client.exchangeCode({
        code: "bad-code",
        config: {
          clientId: "lin-client",
          clientSecret: "linear-secret",
          redirectUri: "https://openroad.test/callback"
        }
      })
    ).rejects.toMatchObject<Partial<OAuthExchangeClientError>>({
      code: "oauth_exchange_failed",
      message: "Linear OAuth token exchange failed with status 401.",
      status: 401
    });
  });
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}
