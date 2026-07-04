// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createGitHubInstallation,
  createGitHubIssueMapping,
  parseGitHubIssuePayload
} from "../src/integrations/github";
import {
  FileIntegrationStore,
  IntegrationStoreError,
  createInitialIntegrationState,
  openRoadIntegrationSchemaVersion,
  parseIntegrationState,
  revokeIntegrationCredential,
  sanitizeIntegrationCredentialMetadata,
  type IntegrationCredential
} from "./integrations";

describe("OpenRoad integration metadata store", () => {
  it("seeds an empty integration state when no file exists", async () => {
    const integrationFile = await temporaryIntegrationFile();
    const result = await new FileIntegrationStore(integrationFile).load();

    expect(result.status).toBe("seeded");
    expect(result.state).toEqual(createInitialIntegrationState());
    expect(JSON.parse(await readFile(integrationFile, "utf8"))).toMatchObject({
      installations: [],
      mappings: [],
      schemaVersion: openRoadIntegrationSchemaVersion,
      syncEvents: [],
      credentials: []
    });
  });

  it("persists installations and mappings without OpenRoad core state", async () => {
    const store = new FileIntegrationStore(await temporaryIntegrationFile());
    const installation = createInstallation();
    const issue = parseGitHubIssuePayload(gitHubIssuePayload());
    const mapping = createGitHubIssueMapping(
      installation,
      issue,
      {
        id: "request-1",
        type: "request",
        workspaceId: "acme"
      },
      "2026-07-04T00:00:00.000Z"
    );

    await store.upsertInstallation(installation);
    await store.upsertMapping(mapping);
    await store.upsertMapping({ ...mapping, lastSyncedAt: "2026-07-04T01:00:00.000Z" });

    const result = await store.load();
    expect(result.state.installations).toHaveLength(1);
    expect(result.state.mappings).toHaveLength(1);
    expect(result.state.mappings[0]).toMatchObject({
      external: {
        provider: "github",
        type: "issue"
      },
      lastSyncedAt: "2026-07-04T01:00:00.000Z",
      openRoad: {
        id: "request-1",
        type: "request",
        workspaceId: "acme"
      }
    });
  });

  it("keeps installation records scoped by provider, workspace, and installation id", async () => {
    const store = new FileIntegrationStore(await temporaryIntegrationFile());
    const installation = createInstallation();

    await store.upsertInstallation(installation);
    await store.upsertInstallation({ ...installation, workspaceId: "maintainer" });

    const result = await store.load();
    expect(result.state.installations).toHaveLength(2);
    expect(new Set(result.state.installations.map((item) => item.workspaceId))).toEqual(
      new Set(["acme", "maintainer"])
    );
  });

  it("drops unknown secret-like fields from integration metadata", () => {
    const state = parseIntegrationState({
      installations: [
        {
          ...createInstallation(),
          privateKey: "secret",
          token: "secret",
          webhookSecret: "secret"
        }
      ],
      credentials: [],
      mappings: [],
      schemaVersion: openRoadIntegrationSchemaVersion,
      syncEvents: [
        {
          createdAt: "2026-07-04T00:00:00.000Z",
          deliveryId: "delivery-1",
          event: "issues",
          headers: { authorization: "secret" },
          id: "github-webhook-delivery-1",
          installationId: "github-install",
          payload: { token: "secret" },
          provider: "github",
          result: "synced",
          secret: "secret",
          summary: "Synced one issue.",
          workspaceId: "acme"
        }
      ]
    });

    expect(JSON.stringify(state)).not.toContain("secret");
    expect(Object.keys(state.installations[0])).toEqual([
      "createdAt",
      "id",
      "permissions",
      "provider",
      "providerAccountId",
      "providerAccountName",
      "status",
      "workspaceId"
    ]);
    expect(Object.keys(state.syncEvents[0])).toEqual([
      "createdAt",
      "deliveryId",
      "event",
      "id",
      "installationId",
      "provider",
      "result",
      "summary",
      "workspaceId"
    ]);
  });

  it("loads version one integration metadata that has no sync event log yet", () => {
    const state = parseIntegrationState({
      installations: [],
      mappings: [],
      schemaVersion: 1
    });

    expect(state.syncEvents).toEqual([]);
    expect(state.credentials).toEqual([]);
    expect(state.schemaVersion).toBe(openRoadIntegrationSchemaVersion);
  });

  it("stores credential metadata while redacting encrypted secret payloads from API metadata", () => {
    const credential = createCredential();
    const state = parseIntegrationState({
      credentials: [
        {
          ...credential,
          accessToken: "secret",
          token: "secret"
        }
      ],
      installations: [createInstallation()],
      mappings: [],
      schemaVersion: openRoadIntegrationSchemaVersion,
      syncEvents: []
    });
    const metadata = sanitizeIntegrationCredentialMetadata(state.credentials[0]);

    expect(state.credentials).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain("accessToken");
    expect(JSON.stringify(metadata)).not.toContain("ciphertext");
    expect(metadata).toMatchObject({
      id: "credential-github-install",
      installationId: "github-install",
      provider: "github",
      providerScopes: ["repo", "read:issues"],
      secretTypes: ["access-token", "refresh-token"],
      status: "active",
      workspaceId: "acme"
    });
  });

  it("revokes credential records by clearing encrypted secret material", () => {
    const revoked = revokeIntegrationCredential(
      createCredential(),
      "2026-07-04T02:00:00.000Z"
    );

    expect(revoked).toMatchObject({
      id: "credential-github-install",
      revokedAt: "2026-07-04T02:00:00.000Z",
      status: "revoked",
      updatedAt: "2026-07-04T02:00:00.000Z"
    });
    expect(revoked.encryptedSecret).toBeUndefined();
  });

  it("rewrites current-schema metadata after sanitizing unknown secret-like fields", async () => {
    const integrationFile = await temporaryIntegrationFile();
    await mkdir(dirname(integrationFile), { recursive: true });
    await writeFile(
      integrationFile,
      JSON.stringify(
        {
          credentials: [
            {
              ...createCredential(),
              accessToken: "raw-access-token",
              refreshToken: "raw-refresh-token"
            }
          ],
          installations: [
            {
              ...createInstallation(),
              token: "raw-installation-token"
            }
          ],
          mappings: [],
          schemaVersion: openRoadIntegrationSchemaVersion,
          syncEvents: []
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await new FileIntegrationStore(integrationFile).load();
    const persisted = await readFile(integrationFile, "utf8");

    expect(result.status).toBe("ready");
    expect(result.state.credentials).toHaveLength(1);
    expect(persisted).not.toContain("raw-access-token");
    expect(persisted).not.toContain("raw-refresh-token");
    expect(persisted).not.toContain("raw-installation-token");
    expect(persisted).toContain("ciphertext");
  });

  it("recovers corrupt metadata and rejects future schemas", async () => {
    const corruptFile = await temporaryIntegrationFile();
    await mkdir(dirname(corruptFile), { recursive: true });
    await writeFile(corruptFile, "{", "utf8");

    const recovered = await new FileIntegrationStore(corruptFile).load();

    expect(recovered.status).toBe("recovered");
    expect(recovered.backupPath).toBeTruthy();
    expect(recovered.state).toEqual(createInitialIntegrationState());
    expect(() =>
      parseIntegrationState({
        installations: [],
        credentials: [],
        mappings: [],
        schemaVersion: openRoadIntegrationSchemaVersion + 1,
        syncEvents: []
      })
    ).toThrow(IntegrationStoreError);
  });

  it("rejects malformed installation and mapping state", () => {
    expect(() =>
      parseIntegrationState({
        installations: [{ id: "broken" }],
        credentials: [],
        mappings: [],
        schemaVersion: openRoadIntegrationSchemaVersion
      })
    ).toThrow("invalid");
    expect(() =>
      parseIntegrationState({
        installations: [],
        credentials: [],
        mappings: [{ id: "broken" }],
        schemaVersion: openRoadIntegrationSchemaVersion
      })
    ).toThrow("invalid");
    expect(() =>
      parseIntegrationState({
        credentials: [{ id: "broken" }],
        installations: [],
        mappings: [],
        schemaVersion: openRoadIntegrationSchemaVersion,
        syncEvents: []
      })
    ).toThrow("invalid");
  });
});

async function temporaryIntegrationFile() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-integrations-"));
  return join(directory, "integrations.json");
}

function createInstallation() {
  return createGitHubInstallation({
    accountId: "AkhilTrivediX",
    accountName: "AkhilTrivediX",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "github-install",
    workspaceId: "acme"
  });
}

function createCredential(): IntegrationCredential {
  return {
    createdAt: "2026-07-04T00:00:00.000Z",
    encryptedSecret: {
      alg: "aes-256-gcm" as const,
      ciphertext: "ciphertext",
      iv: "iv",
      keyId: "primary",
      tag: "tag"
    },
    expiresAt: "2026-07-04T12:00:00.000Z",
    id: "credential-github-install",
    installationId: "github-install",
    label: "GitHub sync",
    permissions: ["read:external", "read:openroad"],
    provider: "github" as const,
    providerScopes: ["repo", "read:issues", "repo"],
    secretTypes: ["access-token", "refresh-token"],
    status: "active" as const,
    tokenType: "bearer",
    updatedAt: "2026-07-04T00:00:00.000Z",
    workspaceId: "acme"
  };
}

function gitHubIssuePayload() {
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
    user: { login: "akhil" }
  };
}
