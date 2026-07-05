import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBackup, restoreBackup, smokeOpenRoad } from "./openroad-ops.mjs";

const tempRoots = [];

describe("openroad ops", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async (root) => {
        await import("node:fs/promises").then(({ rm }) => rm(root, { force: true, recursive: true }));
      })
    );
  });

  it("creates a backup with state, team metadata, integration metadata, session metadata, and manifest", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const { dataFile, integrationFile, sessionFile, teamFile } = await writeOpenRoadPair(root);

    const result = await createBackup({
      dataFile,
      integrationFile,
      name: "snapshot",
      outputDir: join(root, "backups"),
      sessionFile,
      teamFile
    });

    const manifest = JSON.parse(await readFile(join(result.backupDir, "manifest.json"), "utf8"));
    expect(manifest.type).toBe("openroad-file-snapshot");
    expect(manifest.files.data.schemaVersion).toBe(2);
    expect(manifest.files.integration.schemaVersion).toBe(3);
    expect(manifest.files.session.schemaVersion).toBe(1);
    expect(manifest.files.team.schemaVersion).toBe(1);
    await expect(readFile(join(result.backupDir, "openroad-state.json"), "utf8")).resolves.toContain("acme");
    await expect(readFile(join(result.backupDir, "openroad-integrations.json"), "utf8")).resolves.toContain(
      "installations"
    );
    await expect(readFile(join(result.backupDir, "openroad-integrations.json"), "utf8")).resolves.toContain(
      "delivery-1"
    );
    await expect(readFile(join(result.backupDir, "openroad-sessions.json"), "utf8")).resolves.toContain(
      "session-test"
    );
    await expect(readFile(join(result.backupDir, "openroad-team.json"), "utf8")).resolves.toContain("owner");
  });

  it("backs up an empty integration snapshot when the integration file does not exist yet", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const { dataFile, sessionFile, teamFile } = await writeOpenRoadPair(root);

    const result = await createBackup({
      dataFile,
      integrationFile: join(root, "missing-integrations.json"),
      name: "snapshot",
      outputDir: join(root, "backups"),
      sessionFile,
      teamFile
    });
    const manifest = JSON.parse(await readFile(join(result.backupDir, "manifest.json"), "utf8"));

    expect(manifest.files.integration.sourceStatus).toBe("default-empty");
    await expect(readFile(join(result.backupDir, "openroad-integrations.json"), "utf8")).resolves.toContain(
      "mappings"
    );
  });

  it("sanitizes credential-bearing integration metadata during backup and restore", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const source = join(root, "source");
    const target = join(root, "target");
    const { dataFile, integrationFile, sessionFile, teamFile } = await writeOpenRoadPair(source);
    const rawIntegration = JSON.parse(await readFile(integrationFile, "utf8"));
    await writeFile(
      integrationFile,
      JSON.stringify(
        {
          ...rawIntegration,
          credentials: [
            {
              createdAt: "2026-07-04T00:00:00.000Z",
              encryptedSecret: {
                alg: "aes-256-gcm",
                ciphertext: "ciphertext",
                iv: "iv",
                keyId: "primary",
                tag: "tag"
              },
              id: "credential-github-install",
              installationId: "github-install",
              permissions: ["read:external"],
              provider: "github",
              providerScopes: ["repo"],
              rawAccessToken: "raw-access-token",
              refreshToken: "raw-refresh-token",
              secretTypes: ["access-token", "refresh-token"],
              status: "active",
              token: "raw-token",
              updatedAt: "2026-07-04T00:00:00.000Z",
              workspaceId: "acme"
            }
          ],
          installations: [
            {
              createdAt: "2026-07-04T00:00:00.000Z",
              id: "github-install",
              permissions: ["read:external"],
              provider: "github",
              providerAccountId: "AkhilTrivediX",
              providerAccountName: "AkhilTrivediX",
              status: "active",
              token: "raw-installation-token",
              workspaceId: "acme"
            }
          ],
          schemaVersion: 3,
          syncJobs: [
            {
              attempt: 0,
              createdAt: "2026-07-04T00:00:00.000Z",
              dedupeKey: "github:acme:github-install:manual:installation",
              error: "Provider failed token=raw-sync-error-token",
              id: "sync-job-github-acme",
              installationId: "github-install",
              leaseExpiresAt: "2026-07-04T00:15:00.000Z",
              provider: "github",
              rawPayload: { token: "raw-sync-token" },
              reason: "manual",
              resultSummary: "Retried with Bearer raw-sync-summary-token",
              status: "queued",
              updatedAt: "2026-07-04T00:00:00.000Z",
              workspaceId: "acme"
            }
          ]
        },
        null,
        2
      )
    );

    const backup = await createBackup({
      dataFile,
      integrationFile,
      name: "snapshot",
      outputDir: join(root, "backups"),
      sessionFile,
      teamFile
    });
    const archivedIntegration = await readFile(join(backup.backupDir, "openroad-integrations.json"), "utf8");
    const targetPair = await writeOpenRoadPair(target, "old-workspace");

    await restoreBackup({
      dataFile: targetPair.dataFile,
      inputDir: backup.backupDir,
      integrationFile: targetPair.integrationFile,
      safetyDir: join(root, "safety"),
      sessionFile: targetPair.sessionFile,
      teamFile: targetPair.teamFile
    });
    const restoredIntegration = await readFile(targetPair.integrationFile, "utf8");

    expect(archivedIntegration).toContain("ciphertext");
    expect(archivedIntegration).toContain("credential-github-install");
    expect(archivedIntegration).not.toContain("raw-access-token");
    expect(archivedIntegration).not.toContain("raw-refresh-token");
    expect(archivedIntegration).not.toContain("raw-installation-token");
    expect(archivedIntegration).not.toContain("raw-sync-token");
    expect(archivedIntegration).not.toContain("raw-sync-error-token");
    expect(archivedIntegration).not.toContain("raw-sync-summary-token");
    expect(archivedIntegration).toContain("leaseExpiresAt");
    expect(restoredIntegration).toContain("ciphertext");
    expect(restoredIntegration).not.toContain("raw-access-token");
    expect(restoredIntegration).not.toContain("raw-refresh-token");
    expect(restoredIntegration).not.toContain("raw-token");
    expect(restoredIntegration).not.toContain("raw-sync-token");
    expect(restoredIntegration).not.toContain("raw-sync-error-token");
    expect(restoredIntegration).not.toContain("raw-sync-summary-token");
  });

  it("fails backup when a required source file is missing", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const { dataFile, sessionFile } = await writeOpenRoadPair(root);

    await expect(
      createBackup({
        dataFile,
        outputDir: join(root, "backups"),
        sessionFile,
        teamFile: join(root, "missing-team.json")
      })
    ).rejects.toMatchObject({ code: "missing_file" });
  });

  it("restores a validated backup and preserves active files first", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const source = join(root, "source");
    const target = join(root, "target");
    const { dataFile, integrationFile, sessionFile, teamFile } = await writeOpenRoadPair(source, "acme");
    const backup = await createBackup({
      dataFile,
      integrationFile,
      name: "snapshot",
      outputDir: join(root, "backups"),
      sessionFile,
      teamFile
    });
    const targetPair = await writeOpenRoadPair(target, "old-workspace");

    const result = await restoreBackup({
      dataFile: targetPair.dataFile,
      inputDir: backup.backupDir,
      integrationFile: targetPair.integrationFile,
      safetyDir: join(root, "safety"),
      sessionFile: targetPair.sessionFile,
      teamFile: targetPair.teamFile
    });

    await expect(readFile(targetPair.dataFile, "utf8")).resolves.toContain("acme");
    await expect(readFile(targetPair.integrationFile, "utf8")).resolves.toContain("installations");
    await expect(readFile(targetPair.sessionFile, "utf8")).resolves.toContain("session-test");
    await expect(readFile(join(result.safetyDir, "openroad-state.json"), "utf8")).resolves.toContain(
      "old-workspace"
    );
  });

  it("rejects an invalid backup during restore", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const backup = join(root, "bad-backup");
    await mkdir(backup, { recursive: true });
    await writeFile(join(backup, "manifest.json"), JSON.stringify({ manifestVersion: 1, type: "openroad-file-pair" }));
    await writeFile(join(backup, "openroad-state.json"), JSON.stringify({ schemaVersion: 2 }));
    await writeFile(
      join(backup, "openroad-integrations.json"),
      JSON.stringify({ installations: [], mappings: [], schemaVersion: 1, syncEvents: [] })
    );
    await writeFile(
      join(backup, "openroad-team.json"),
      JSON.stringify({ auditEvents: [], memberships: [], schemaVersion: 1, users: [] })
    );

    await expect(
      restoreBackup({
        dataFile: join(root, "target", "openroad-state.json"),
        inputDir: backup,
        sessionFile: join(root, "target", "openroad-sessions.json"),
        teamFile: join(root, "target", "openroad-team.json")
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("rejects a backup missing required files even when forced", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const backup = join(root, "missing-files-backup");
    await mkdir(backup, { recursive: true });
    await writeFile(join(backup, "openroad-state.json"), JSON.stringify({ schemaVersion: 2, workspaces: [] }));

    await expect(
      restoreBackup({
        dataFile: join(root, "target", "openroad-state.json"),
        force: true,
        inputDir: backup,
        sessionFile: join(root, "target", "openroad-sessions.json"),
        teamFile: join(root, "target", "openroad-team.json")
      })
    ).rejects.toMatchObject({ code: "missing_file" });
  });

  it("passes smoke checks in single-user mode", async () => {
    const server = await startSmokeServer({ tokenMode: false });
    try {
      await expect(
        smokeOpenRoad({ baseUrl: server.baseUrl, workspaceId: "acme" })
      ).resolves.toMatchObject({
        checks: ["health", "contract", "portal", "private-single-user"]
      });
    } finally {
      await server.close();
    }
  });

  it("verifies private denial and token access in admin-token mode", async () => {
    const server = await startSmokeServer({ token: "secret", tokenMode: true });
    try {
      await expect(
        smokeOpenRoad({ adminToken: "secret", baseUrl: server.baseUrl, workspaceId: "acme" })
      ).resolves.toMatchObject({
        checks: ["health", "contract", "portal", "private-denied", "private-token"]
      });
    } finally {
      await server.close();
    }
  });
});

async function createTempRoot(name) {
  const root = join(process.env.TMP ?? process.env.TEMP ?? ".", `openroad-ops-${Date.now()}-${slug(name)}`);
  tempRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

async function writeOpenRoadPair(root, workspaceId = "acme") {
  await mkdir(root, { recursive: true });
  const dataFile = join(root, "openroad-state.json");
  const integrationFile = join(root, "openroad-integrations.json");
  const sessionFile = join(root, "openroad-sessions.json");
  const teamFile = join(root, "openroad-team.json");
  await writeFile(
    dataFile,
    JSON.stringify(
      {
        changelog: [],
        requests: [],
        roadmapItems: [],
        schemaVersion: 2,
        workItems: [],
        workspaces: [{ id: workspaceId, name: workspaceId }]
      },
      null,
      2
    )
  );
  await writeFile(
    integrationFile,
    JSON.stringify(
      {
        installations: [],
        credentials: [],
        mappings: [],
        schemaVersion: 3,
        syncEvents: [
          {
            createdAt: "2026-07-04T00:00:00.000Z",
            deliveryId: "delivery-1",
            event: "issues",
            id: "github-webhook-delivery-1",
            provider: "github",
            result: "synced",
            summary: "Synced one issue.",
            workspaceId
          }
        ],
        syncJobs: []
      },
      null,
      2
    )
  );
  await writeFile(
    teamFile,
    JSON.stringify(
      {
        auditEvents: [],
        memberships: [],
        schemaVersion: 1,
        users: [{ createdAt: "seed", email: "owner@example.com", id: "owner", name: "Owner" }]
      },
      null,
      2
    )
  );
  await writeFile(
    sessionFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        sessions: [
          {
            adminTokenHash: "admin-hash",
            createdAt: "2026-07-04T00:00:00.000Z",
            expiresAt: "2026-07-11T00:00:00.000Z",
            id: "session-test",
            tokenHash: "token-hash"
          }
        ]
      },
      null,
      2
    )
  );
  return { dataFile, integrationFile, sessionFile, teamFile };
}

async function startSmokeServer({ token, tokenMode }) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");

    if (url.pathname === "/api/health") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/openroad/contract") {
      response.end(JSON.stringify({ contract: { version: "2026-07-04" } }));
      return;
    }

    if (url.pathname === "/api/openroad/workspaces/acme/portal") {
      response.end(JSON.stringify({ enabled: true, requests: [], roadmap: {} }));
      return;
    }

    if (url.pathname === "/api/openroad/ops/status") {
      if (tokenMode && request.headers.authorization !== `Bearer ${token}`) {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: { code: "forbidden" } }));
        return;
      }
      response.end(JSON.stringify({ status: "ok", stores: { openRoad: "ready", team: "ready" } }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
