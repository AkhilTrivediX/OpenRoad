// @vitest-environment node

import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FetchGitHubAppClient,
  createGitHubAppJwt,
  createSafeGitHubAppSetup,
  decodeGitHubAppJwtPayload,
  githubAppConfigFromEnv,
  normalizeGitHubAppInstallation,
  readGitHubAppPrivateKey,
  verifyGitHubWebhookSignature
} from "./github-app";

describe("GitHub App installation helpers", () => {
  it("parses config without leaking secret values in safe setup output", () => {
    const config = githubAppConfigFromEnv({
      OPENROAD_GITHUB_APP_ID: "12345",
      OPENROAD_GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----",
      OPENROAD_GITHUB_APP_SLUG: "openroad-test",
      OPENROAD_GITHUB_APP_WEBHOOK_SECRET: "webhook-secret"
    });
    const setup = createSafeGitHubAppSetup(
      config,
      "acme",
      new Date("2026-07-04T00:00:00.000Z")
    );

    expect(config.privateKey).toContain("\nsecret\n");
    expect(config.webhookSecret).toBe("webhook-secret");
    expect(setup).toMatchObject({
      configured: true,
      missing: [],
      requiredEvents: ["issues", "pull_request"],
      requiredPermissions: {
        issues: "read",
        pull_requests: "read"
      }
    });
    expect(setup.installUrl).toContain("https://github.com/apps/openroad-test/installations/new");
    expect(JSON.stringify(setup)).not.toContain("secret");
    expect(JSON.stringify(setup)).not.toContain("PRIVATE KEY");
  });

  it("verifies GitHub webhook signatures with SHA-256 HMAC only", () => {
    const payload = Buffer.from(JSON.stringify({ action: "opened", issue: { id: 1 } }));
    const signature = `sha256=${createHmac("sha256", "webhook-secret").update(payload).digest("hex")}`;

    expect(
      verifyGitHubWebhookSignature({
        payload,
        secret: "webhook-secret",
        signatureHeader: signature
      })
    ).toBe(true);
    expect(
      verifyGitHubWebhookSignature({
        payload,
        secret: "webhook-secret",
        signatureHeader: `sha1=${createHmac("sha1", "webhook-secret").update(payload).digest("hex")}`
      })
    ).toBe(false);
    expect(
      verifyGitHubWebhookSignature({
        payload,
        secret: "wrong-secret",
        signatureHeader: signature
      })
    ).toBe(false);
    expect(
      verifyGitHubWebhookSignature({
        payload,
        secret: "webhook-secret",
        signatureHeader: undefined
      })
    ).toBe(false);
  });

  it("reports missing setup keys without failing local standalone mode", () => {
    const setup = createSafeGitHubAppSetup(githubAppConfigFromEnv({}), "acme");

    expect(setup.configured).toBe(false);
    expect(setup.missing).toEqual([
      "OPENROAD_GITHUB_APP_SLUG",
      "OPENROAD_GITHUB_APP_ID",
      "OPENROAD_GITHUB_APP_PRIVATE_KEY or OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE"
    ]);
    expect(setup.installUrl).toBeUndefined();
  });

  it("signs GitHub App JWTs with RS256 claims", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" }
    });
    const jwt = createGitHubAppJwt({
      appId: "12345",
      nowSeconds: 1783142400,
      privateKey
    });
    const [header, payload, signature] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();

    expect(decodeGitHubAppJwtPayload(jwt)).toMatchObject({
      exp: 1783142940,
      iat: 1783142340,
      iss: "12345"
    });
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("creates installation access tokens with a GitHub App JWT", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" }
    });
    const requests: Array<{ authorization?: string; method?: string; url: string }> = [];
    const client = new FetchGitHubAppClient(
      {
        apiBaseUrl: "https://api.github.test",
        appBaseUrl: "https://github.test",
        appId: "12345",
        privateKey,
        slug: "openroad-test",
        webhookSecretConfigured: false
      },
      async (url, init) => {
        requests.push({
          authorization: init?.headers
            ? new Headers(init.headers).get("authorization") ?? undefined
            : undefined,
          method: init?.method,
          url: String(url)
        });
        return new Response(
          JSON.stringify({
            expires_at: "2026-07-04T01:00:00Z",
            token: "installation-token"
          }),
          { status: 201 }
        );
      }
    );

    const token = await client.createInstallationAccessToken("98765");

    expect(token).toEqual({
      expiresAt: "2026-07-04T01:00:00Z",
      token: "installation-token"
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.github.test/app/installations/98765/access_tokens"
    });
    expect(requests[0].authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
  });

  it("fetches repository issues with installation tokens and filters pull requests", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" }
    });
    const authorizations: string[] = [];
    const client = new FetchGitHubAppClient(
      {
        apiBaseUrl: "https://api.github.test",
        appBaseUrl: "https://github.test",
        appId: "12345",
        privateKey,
        slug: "openroad-test",
        webhookSecretConfigured: false
      },
      async (url, init) => {
        const authorization = init?.headers
          ? new Headers(init.headers).get("authorization") ?? ""
          : "";
        authorizations.push(authorization);

        if (String(url).endsWith("/access_tokens")) {
          return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
        }

        expect(String(url)).toBe(
          "https://api.github.test/repos/AkhilTrivediX/OpenRoad/issues?state=open&per_page=30"
        );
        expect(authorization).toBe("Bearer installation-token");
        return new Response(
          JSON.stringify([
            gitHubIssuePayload({ node_id: "I_kwDOGH123", number: 42 }),
            {
              ...gitHubIssuePayload({ node_id: "PR_kwDOPR123", number: 7 }),
              pull_request: {
                html_url: "https://github.com/AkhilTrivediX/OpenRoad/pull/7"
              }
            }
          ]),
          { status: 200 }
        );
      }
    );

    const issues = await client.listRepositoryIssues({
      installationId: "98765",
      owner: "AkhilTrivediX",
      repo: "OpenRoad",
      state: "open"
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: "I_kwDOGH123",
      number: 42,
      repository: {
        fullName: "AkhilTrivediX/OpenRoad"
      }
    });
    expect(authorizations[0]).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(authorizations[1]).toBe("Bearer installation-token");
    expect(JSON.stringify(issues)).not.toContain("installation-token");
  });

  it("fetches a targeted repository issue with an installation token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" }
    });
    const urls: string[] = [];
    const client = new FetchGitHubAppClient(
      {
        apiBaseUrl: "https://api.github.test",
        appBaseUrl: "https://github.test",
        appId: "12345",
        privateKey,
        slug: "openroad-test",
        webhookSecretConfigured: false
      },
      async (url, init) => {
        urls.push(String(url));
        const authorization = init?.headers
          ? new Headers(init.headers).get("authorization") ?? ""
          : "";

        if (String(url).endsWith("/access_tokens")) {
          return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
        }

        expect(String(url)).toBe("https://api.github.test/repos/AkhilTrivediX/OpenRoad/issues/42");
        expect(authorization).toBe("Bearer installation-token");
        return new Response(JSON.stringify(gitHubIssuePayload({ node_id: "I_kwDOGH123", number: 42 })), {
          status: 200
        });
      }
    );

    const issue = await client.getRepositoryIssue({
      installationId: "98765",
      issueNumber: 42,
      owner: "AkhilTrivediX",
      repo: "OpenRoad"
    });

    expect(issue).toMatchObject({
      id: "I_kwDOGH123",
      number: 42,
      repository: {
        fullName: "AkhilTrivediX/OpenRoad"
      }
    });
    expect(urls).toContain("https://api.github.test/app/installations/98765/access_tokens");
    expect(JSON.stringify(issue)).not.toContain("installation-token");
  });

  it("reads private keys from file when env uses a file path", async ({ task }) => {
    const root = join(process.env.TMP ?? process.env.TEMP ?? ".", `openroad-github-app-${Date.now()}-${task.name}`);
    const privateKeyFile = join(root, "app.pem");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(root, { recursive: true }));
    await writeFile(privateKeyFile, "-----BEGIN PRIVATE KEY-----\\nfile-secret\\n-----END PRIVATE KEY-----", "utf8");

    await expect(
      readGitHubAppPrivateKey(githubAppConfigFromEnv({ OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE: privateKeyFile }))
    ).resolves.toContain("\nfile-secret\n");
  });

  it("normalizes GitHub installation API payloads into OpenRoad installations", () => {
    const installation = normalizeGitHubAppInstallation(
      {
        account: {
          id: 118957648,
          login: "AkhilTrivediX",
          type: "User"
        },
        id: 98765,
        permissions: {
          issues: "read",
          pull_requests: "read"
        },
        repository_selection: "selected"
      },
      "acme"
    );

    expect(installation).toMatchObject({
      id: "github-installation-98765",
      permissions: ["read:openroad", "write:openroad", "read:external"],
      provider: "github",
      providerAccountId: "118957648",
      providerAccountName: "AkhilTrivediX",
      status: "active",
      workspaceId: "acme"
    });
  });

  it("rejects GitHub installation payloads without issue or pull request read permission", () => {
    expect(() =>
      normalizeGitHubAppInstallation(
        {
          account: {
            id: 118957648,
            login: "AkhilTrivediX"
          },
          id: 98765,
          permissions: {}
        },
        "acme"
      )
    ).toThrow("read:external");
  });
});

function gitHubIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    body: "Expose GitHub issue context.",
    html_url: "https://github.com/AkhilTrivediX/OpenRoad/issues/42",
    labels: [{ name: "planned" }],
    node_id: "I_kwDOGH123",
    number: 42,
    repository: {
      full_name: "AkhilTrivediX/OpenRoad",
      html_url: "https://github.com/AkhilTrivediX/OpenRoad",
      name: "OpenRoad",
      node_id: "R_kwDOR123",
      owner: { login: "AkhilTrivediX" },
      private: false
    },
    state: "open",
    title: "Import GitHub issues",
    user: { login: "akhil" },
    ...overrides
  };
}
