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
  parseIntegrationState
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
      schemaVersion: openRoadIntegrationSchemaVersion
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
      mappings: [],
      schemaVersion: openRoadIntegrationSchemaVersion
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
        mappings: [],
        schemaVersion: openRoadIntegrationSchemaVersion + 1
      })
    ).toThrow(IntegrationStoreError);
  });

  it("rejects malformed installation and mapping state", () => {
    expect(() =>
      parseIntegrationState({
        installations: [{ id: "broken" }],
        mappings: [],
        schemaVersion: openRoadIntegrationSchemaVersion
      })
    ).toThrow("invalid");
    expect(() =>
      parseIntegrationState({
        installations: [],
        mappings: [{ id: "broken" }],
        schemaVersion: openRoadIntegrationSchemaVersion
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
