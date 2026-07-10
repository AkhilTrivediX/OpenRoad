// @vitest-environment node

import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FileSessionStore,
  SessionStoreError,
  openRoadSessionSchemaVersion
} from "./session-store";

describe("FileSessionStore", () => {
  it("seeds session metadata and persists only hashed token material", async () => {
    const sessionFile = await createTempSessionFile();
    const store = new FileSessionStore(sessionFile);

    const seeded = await store.load();
    const created = await store.createSession({
      adminToken: "admin-secret",
      now: new Date("2026-07-05T00:00:00.000Z"),
      userAgent: "OpenRoad test"
    });
    const persisted = await readFile(sessionFile, "utf8");
    const rawSessionSecret = created.cookieValue.split(".")[1];
    const resolved = await store.resolveSession({
      adminToken: "admin-secret",
      cookieValue: created.cookieValue,
      now: new Date("2026-07-05T00:01:00.000Z")
    });

    expect(seeded.status).toBe("seeded");
    expect(created.cookieValue).toMatch(/^session-[^.]+\.[\w-]{32,}$/);
    expect(persisted).not.toContain("admin-secret");
    expect(persisted).not.toContain(rawSessionSecret);
    expect(JSON.parse(persisted)).toMatchObject({
      schemaVersion: openRoadSessionSchemaVersion,
      sessions: [
        expect.objectContaining({
          actor: { id: "local-owner", source: "session", type: "local-owner" },
          id: created.session.id,
          userAgent: "OpenRoad test"
        })
      ]
    });
    expect(resolved?.actor).toMatchObject({
      source: "session",
      type: "local-owner"
    });
  });

  it("creates workspace-member sessions without admin-token binding", async () => {
    const sessionFile = await createTempSessionFile();
    const store = new FileSessionStore(sessionFile);

    const created = await store.createMemberSession({
      actor: {
        id: "user-teammate@example.com",
        role: "Contributor",
        type: "workspace-member",
        workspaceId: "acme"
      },
      now: new Date("2026-07-05T00:00:00.000Z"),
      userAgent: "Member browser"
    });
    const persisted = await readFile(sessionFile, "utf8");
    const persistedState = JSON.parse(persisted) as {
      sessions: Array<{ adminTokenHash?: string }>;
    };
    const resolved = await store.resolveSession({
      cookieValue: created.cookieValue,
      now: new Date("2026-07-05T00:01:00.000Z")
    });

    expect(persisted).not.toContain(created.cookieValue.split(".")[1]);
    expect(persistedState).toMatchObject({
      schemaVersion: openRoadSessionSchemaVersion,
      sessions: [
        expect.objectContaining({
          actor: {
            id: "user-teammate@example.com",
            role: "Contributor",
            type: "workspace-member",
            workspaceId: "acme"
          },
          userAgent: "Member browser"
        })
      ]
    });
    expect(persistedState.sessions[0]).not.toHaveProperty("adminTokenHash");
    expect(resolved?.actor).toMatchObject({
      id: "user-teammate@example.com",
      role: "Contributor",
      type: "workspace-member",
      workspaceId: "acme"
    });
  });

  it("ignores expired sessions and prunes them when creating a new session", async () => {
    const sessionFile = await createTempSessionFile();
    const store = new FileSessionStore(sessionFile, { ttlMs: 1000 });
    const expired = await store.createSession({
      adminToken: "admin-secret",
      now: new Date("2026-07-05T00:00:00.000Z")
    });
    const resolvedExpired = await store.resolveSession({
      adminToken: "admin-secret",
      cookieValue: expired.cookieValue,
      now: new Date("2026-07-05T00:00:02.000Z")
    });

    await store.createSession({
      adminToken: "admin-secret",
      now: new Date("2026-07-05T00:00:02.000Z")
    });
    const persisted = JSON.parse(await readFile(sessionFile, "utf8")) as {
      sessions: Array<{ id: string }>;
    };

    expect(resolvedExpired).toBeUndefined();
    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0].id).not.toBe(expired.session.id);
  });

  it("revokes matching active sessions without accepting old cookies", async () => {
    const sessionFile = await createTempSessionFile();
    const store = new FileSessionStore(sessionFile);
    const created = await store.createSession({
      adminToken: "admin-secret",
      now: new Date("2026-07-05T00:00:00.000Z")
    });

    const revoked = await store.revokeSession(
      created.cookieValue,
      new Date("2026-07-05T00:01:00.000Z")
    );
    const resolved = await store.resolveSession({
      adminToken: "admin-secret",
      cookieValue: created.cookieValue,
      now: new Date("2026-07-05T00:02:00.000Z")
    });

    expect(revoked).toBe(true);
    expect(resolved).toBeUndefined();
  });

  it("revokes active member sessions by user and workspace only", async () => {
    const sessionFile = await createTempSessionFile();
    const store = new FileSessionStore(sessionFile);
    const matching = await store.createMemberSession({
      actor: {
        id: "user-member@example.com",
        role: "Contributor",
        type: "workspace-member",
        workspaceId: "acme"
      },
      now: new Date("2026-07-05T00:00:00.000Z")
    });
    const otherWorkspace = await store.createMemberSession({
      actor: {
        id: "user-member@example.com",
        role: "Contributor",
        type: "workspace-member",
        workspaceId: "other"
      },
      now: new Date("2026-07-05T00:00:00.000Z")
    });
    const owner = await store.createSession({
      adminToken: "admin-secret",
      now: new Date("2026-07-05T00:00:00.000Z")
    });

    const revoked = await store.revokeMemberSessions({
      now: new Date("2026-07-05T00:01:00.000Z"),
      userId: "user-member@example.com",
      workspaceId: "acme"
    });
    const matchingResolved = await store.resolveSession({
      cookieValue: matching.cookieValue,
      now: new Date("2026-07-05T00:02:00.000Z")
    });
    const otherResolved = await store.resolveSession({
      cookieValue: otherWorkspace.cookieValue,
      now: new Date("2026-07-05T00:02:00.000Z")
    });
    const ownerResolved = await store.resolveSession({
      adminToken: "admin-secret",
      cookieValue: owner.cookieValue,
      now: new Date("2026-07-05T00:02:00.000Z")
    });

    expect(revoked).toBe(1);
    expect(matchingResolved).toBeUndefined();
    expect(otherResolved?.actor).toMatchObject({ workspaceId: "other" });
    expect(ownerResolved?.actor).toMatchObject({ type: "local-owner" });
  });

  it("binds sessions to the active admin token", async () => {
    const sessionFile = await createTempSessionFile();
    const store = new FileSessionStore(sessionFile);
    const created = await store.createSession({
      adminToken: "admin-secret",
      now: new Date("2026-07-05T00:00:00.000Z")
    });

    await expect(
      store.resolveSession({
        adminToken: "rotated-secret",
        cookieValue: created.cookieValue,
        now: new Date("2026-07-05T00:01:00.000Z")
      })
    ).resolves.toBeUndefined();
  });

  it("migrates v1 owner session metadata to actor-aware records", async () => {
    const sessionFile = await createTempSessionFile();
    await writeFile(
      sessionFile,
      JSON.stringify(
        {
          schemaVersion: 1,
          sessions: [
            {
              adminTokenHash: "admin-hash",
              createdAt: "2026-07-05T00:00:00.000Z",
              expiresAt: "2026-07-12T00:00:00.000Z",
              id: "session-v1",
              tokenHash: "token-hash"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await new FileSessionStore(sessionFile).load();
    const persisted = JSON.parse(await readFile(sessionFile, "utf8")) as {
      schemaVersion: number;
      sessions: Array<{ actor?: unknown; id: string }>;
    };

    expect(result.status).toBe("migrated");
    expect(persisted.schemaVersion).toBe(openRoadSessionSchemaVersion);
    expect(persisted.sessions[0]).toMatchObject({
      actor: { id: "local-owner", source: "session", type: "local-owner" },
      id: "session-v1"
    });
  });

  it("rejects future schema versions", async () => {
    const sessionFile = await createTempSessionFile();
    await writeFile(
      sessionFile,
      JSON.stringify({
        schemaVersion: openRoadSessionSchemaVersion + 1,
        sessions: []
      }),
      "utf8"
    );

    await expect(new FileSessionStore(sessionFile).load()).rejects.toBeInstanceOf(
      SessionStoreError
    );
  });

  it("backs up corrupt session metadata and reseeds", async () => {
    const sessionFile = await createTempSessionFile();
    await writeFile(sessionFile, "{not-json", "utf8");

    const result = await new FileSessionStore(sessionFile).load();
    const files = await readdir(join(sessionFile, ".."));
    const persisted = JSON.parse(await readFile(sessionFile, "utf8")) as {
      schemaVersion: number;
    };

    expect(result.status).toBe("recovered");
    expect(result.backupPath).toContain(".corrupt-");
    expect(files.some((file) => file.includes(".corrupt-"))).toBe(true);
    expect(persisted.schemaVersion).toBe(openRoadSessionSchemaVersion);
  });
});

async function createTempSessionFile() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-sessions-"));
  return join(directory, "sessions.json");
}
