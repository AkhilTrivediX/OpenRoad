// @vitest-environment node

import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createInitialOpenRoadState } from "../src/domain/openroad";
import {
  FileTeamStore,
  TeamStoreError,
  openRoadTeamSchemaVersion,
  parseTeamState
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

  it("migrates schema v1 team metadata with empty invitations", async () => {
    const teamFile = await createTempTeamFile();
    const openRoadState = createInitialOpenRoadState();
    await writeFile(
      teamFile,
      JSON.stringify({
        auditEvents: [],
        memberships: [
          {
            createdAt: "seed",
            id: "membership-local-owner-acme",
            role: "Owner",
            userId: "local-owner",
            workspaceId: "acme"
          }
        ],
        schemaVersion: 1,
        users: [
          {
            createdAt: "seed",
            email: "owner@openroad.local",
            id: "local-owner",
            name: "Local owner"
          }
        ]
      }),
      "utf8"
    );

    const result = await new FileTeamStore(teamFile).load(openRoadState);
    const persisted = JSON.parse(await readFile(teamFile, "utf8")) as {
      invitations: unknown[];
      schemaVersion: number;
    };

    expect(result.status).toBe("migrated");
    expect(result.state.invitations).toEqual([]);
    expect(persisted.schemaVersion).toBe(openRoadTeamSchemaVersion);
    expect(persisted.invitations).toEqual([]);
  });

  it("migrates schema v2 team metadata and preserves invitation records", async () => {
    const teamFile = await createTempTeamFile();
    const openRoadState = createInitialOpenRoadState();
    await writeFile(
      teamFile,
      JSON.stringify({
        auditEvents: [],
        invitations: [
          {
            createdAt: "2026-07-05T00:00:00.000Z",
            createdByActorId: "local-owner",
            email: "teammate@example.com",
            expiresAt: "2999-07-19T00:00:00.000Z",
            id: "invitation-1",
            role: "Viewer",
            tokenHash: "a".repeat(64),
            workspaceId: "acme"
          }
        ],
        memberships: [],
        schemaVersion: 2,
        users: []
      }),
      "utf8"
    );

    const result = await new FileTeamStore(teamFile).load(openRoadState);
    const persisted = JSON.parse(await readFile(teamFile, "utf8")) as {
      invitations: Array<{ id: string }>;
      schemaVersion: number;
    };

    expect(result.status).toBe("migrated");
    expect(result.state.schemaVersion).toBe(openRoadTeamSchemaVersion);
    expect(result.state.invitations[0]).toMatchObject({
      email: "teammate@example.com",
      id: "invitation-1"
    });
    expect(persisted.schemaVersion).toBe(openRoadTeamSchemaVersion);
    expect(persisted.invitations[0].id).toBe("invitation-1");
  });

  it("creates invitations without persisting or listing raw accept tokens", async () => {
    const teamFile = await createTempTeamFile();
    const openRoadState = createInitialOpenRoadState();
    const store = new FileTeamStore(teamFile);
    await store.load(openRoadState);

    const created = await store.createInvitation(openRoadState, {
      createdByActorId: "local-owner",
      email: "Teammate@Example.COM",
      invitedName: "Roadmap teammate",
      role: "Maintainer",
      workspaceId: "acme"
    });
    const persistedText = await readFile(teamFile, "utf8");
    const persisted = JSON.parse(persistedText) as {
      invitations: Array<{ email: string; tokenHash: string }>;
    };
    const listed = await store.listInvitations(openRoadState, "acme");

    expect(created.acceptToken).toMatch(/^oinv_/);
    expect("tokenHash" in created.invitation).toBe(false);
    expect(created.invitation).toMatchObject({
      email: "teammate@example.com",
      invitedName: "Roadmap teammate",
      role: "Maintainer",
      status: "pending",
      workspaceId: "acme"
    });
    expect(persisted.invitations[0]).toMatchObject({
      email: "teammate@example.com"
    });
    expect(persisted.invitations[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedText).not.toContain(created.acceptToken);
    expect(listed[0]).toMatchObject({
      email: "teammate@example.com",
      status: "pending"
    });
    expect("tokenHash" in listed[0]).toBe(false);
  });

  it("records invitation delivery metadata without exposing token hashes in summaries", async () => {
    const teamFile = await createTempTeamFile();
    const openRoadState = createInitialOpenRoadState();
    const store = new FileTeamStore(teamFile);
    await store.load(openRoadState);
    const created = await store.createInvitation(openRoadState, {
      createdByActorId: "local-owner",
      email: "delivery@example.com",
      role: "Contributor",
      workspaceId: "acme"
    });

    const sent = await store.recordInvitationDelivery(openRoadState, {
      deliveryAttemptedAt: "2026-07-10T10:00:00.000Z",
      deliveryChannel: "jsonl-file",
      deliveryMessageId: "jsonl:invitation:1",
      deliveryStatus: "sent",
      invitationId: created.invitation.id,
      workspaceId: "acme"
    });
    const failed = await store.recordInvitationDelivery(openRoadState, {
      deliveryAttemptedAt: "2026-07-10T10:01:00.000Z",
      deliveryChannel: "jsonl-file",
      deliveryError: "x".repeat(300),
      deliveryStatus: "failed",
      invitationId: created.invitation.id,
      workspaceId: "acme"
    });
    const persistedText = await readFile(teamFile, "utf8");
    const listed = await store.listInvitations(openRoadState, "acme");

    expect(sent).toMatchObject({
      deliveryAttemptedAt: "2026-07-10T10:00:00.000Z",
      deliveryChannel: "jsonl-file",
      deliveryMessageId: "jsonl:invitation:1",
      deliveryStatus: "sent"
    });
    expect(failed).toMatchObject({
      deliveryAttemptedAt: "2026-07-10T10:01:00.000Z",
      deliveryChannel: "jsonl-file",
      deliveryStatus: "failed"
    });
    expect(failed.deliveryError).toHaveLength(240);
    expect(listed[0]).toMatchObject({
      deliveryStatus: "failed",
      email: "delivery@example.com"
    });
    expect("tokenHash" in listed[0]).toBe(false);
    expect(persistedText).not.toContain(created.acceptToken);
  });

  it("rejects malformed invitation delivery metadata", () => {
    expect(() =>
      parseTeamState({
        auditEvents: [],
        invitations: [
          {
            createdAt: "2026-07-05T00:00:00.000Z",
            createdByActorId: "local-owner",
            deliveryStatus: "sent-now",
            email: "bad@example.com",
            expiresAt: "2999-07-19T00:00:00.000Z",
            id: "invitation-bad",
            role: "Viewer",
            tokenHash: "a".repeat(64),
            workspaceId: "acme"
          }
        ],
        memberships: [],
        schemaVersion: openRoadTeamSchemaVersion,
        users: []
      })
    ).toThrow(TeamStoreError);
  });

  it("accepts invitations once and creates durable users and memberships", async () => {
    const teamFile = await createTempTeamFile();
    const openRoadState = createInitialOpenRoadState();
    const store = new FileTeamStore(teamFile);
    await store.load(openRoadState);
    const created = await store.createInvitation(openRoadState, {
      createdByActorId: "local-owner",
      email: "builder@example.com",
      role: "Contributor",
      workspaceId: "maintainer"
    });

    const accepted = await store.acceptInvitation(openRoadState, {
      acceptedName: "Product builder",
      token: created.acceptToken
    });
    const reloaded = await store.load(openRoadState);

    expect(accepted).toMatchObject({
      createdMembership: true,
      createdUser: true,
      invitation: {
        email: "builder@example.com",
        status: "accepted",
        workspaceId: "maintainer"
      },
      membership: {
        role: "Contributor",
        workspaceId: "maintainer"
      },
      user: {
        email: "builder@example.com",
        name: "Product builder"
      }
    });
    expect(reloaded.state.users.some((user) => user.email === "builder@example.com")).toBe(true);
    expect(
      reloaded.state.memberships.some(
        (membership) =>
          membership.userId === accepted.user.id && membership.workspaceId === "maintainer"
      )
    ).toBe(true);
    await expect(
      store.acceptInvitation(openRoadState, { token: created.acceptToken })
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("revokes pending invitations and rejects revoked tokens", async () => {
    const teamFile = await createTempTeamFile();
    const openRoadState = createInitialOpenRoadState();
    const store = new FileTeamStore(teamFile);
    await store.load(openRoadState);
    const created = await store.createInvitation(openRoadState, {
      createdByActorId: "local-owner",
      email: "viewer@example.com",
      role: "Viewer",
      workspaceId: "acme"
    });

    const revoked = await store.revokeInvitation(openRoadState, {
      invitationId: created.invitation.id,
      revokedByActorId: "local-owner",
      workspaceId: "acme"
    });
    const listed = await store.listInvitations(openRoadState, "acme");

    expect(revoked).toMatchObject({
      email: "viewer@example.com",
      status: "revoked"
    });
    expect(listed[0]).toMatchObject({
      id: created.invitation.id,
      status: "revoked"
    });
    await expect(
      store.acceptInvitation(openRoadState, { token: created.acceptToken })
    ).rejects.toMatchObject({ code: "invalid_request" });
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
