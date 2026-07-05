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
