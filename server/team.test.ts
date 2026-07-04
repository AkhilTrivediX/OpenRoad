// @vitest-environment node

import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createInitialOpenRoadState } from "../src/domain/openroad";
import {
  FileTeamStore,
  TeamStoreError,
  openRoadTeamSchemaVersion
} from "./team";

describe("FileTeamStore", () => {
  it("seeds owner memberships for every OpenRoad workspace", async () => {
    const teamFile = await createTempTeamFile();
    const result = await new FileTeamStore(teamFile, {
      ownerEmail: "akhil@example.com",
      ownerName: "Akhil"
    }).load(createInitialOpenRoadState());

    expect(result.status).toBe("seeded");
    expect(result.state.schemaVersion).toBe(openRoadTeamSchemaVersion);
    expect(result.state.users[0]).toMatchObject({
      email: "akhil@example.com",
      id: "local-owner",
      name: "Akhil"
    });
    expect(result.state.memberships.map((membership) => membership.workspaceId)).toEqual([
      "acme",
      "maintainer"
    ]);
  });

  it("persists audit events and reloads them from disk", async () => {
    const teamFile = await createTempTeamFile();
    const openRoadState = createInitialOpenRoadState();
    const store = new FileTeamStore(teamFile);
    await store.load(openRoadState);

    const auditEvent = await store.recordAuditEvent(openRoadState, {
      actorId: "local-owner",
      actorType: "local-owner",
      requestId: "request-1",
      summary: "Replaced OpenRoad state.",
      type: "state.replace",
      workspaceId: "acme"
    });
    const result = await store.load(openRoadState);

    expect(auditEvent.id).toContain("audit-");
    expect(result.state.auditEvents[0]).toMatchObject({
      requestId: "request-1",
      type: "state.replace",
      workspaceId: "acme"
    });
  });

  it("rejects future schema versions", async () => {
    const teamFile = await createTempTeamFile();
    await writeFile(
      teamFile,
      JSON.stringify({
        auditEvents: [],
        memberships: [],
        schemaVersion: openRoadTeamSchemaVersion + 1,
        users: []
      }),
      "utf8"
    );

    await expect(
      new FileTeamStore(teamFile).load(createInitialOpenRoadState())
    ).rejects.toBeInstanceOf(TeamStoreError);
  });

  it("backs up corrupt team metadata and reseeds", async () => {
    const teamFile = await createTempTeamFile();
    await writeFile(teamFile, "{not-json", "utf8");

    const result = await new FileTeamStore(teamFile).load(createInitialOpenRoadState());
    const files = await readdir(join(teamFile, ".."));
    const persisted = JSON.parse(await readFile(teamFile, "utf8")) as {
      schemaVersion: number;
    };

    expect(result.status).toBe("recovered");
    expect(result.backupPath).toContain(".corrupt-");
    expect(files.some((file) => file.includes(".corrupt-"))).toBe(true);
    expect(persisted.schemaVersion).toBe(openRoadTeamSchemaVersion);
  });
});

async function createTempTeamFile() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-team-"));
  return join(directory, "team.json");
}
