// @vitest-environment node

import { createVerify, generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createGitHubAppJwt,
  createSafeGitHubAppSetup,
  decodeGitHubAppJwtPayload,
  githubAppConfigFromEnv,
  normalizeGitHubAppInstallation,
  readGitHubAppPrivateKey
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
