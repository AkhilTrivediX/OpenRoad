import { describe, expect, it, vi } from "vitest";

import {
  acceptWorkspaceInvitationToken,
  createStandaloneInvitationAccess,
  createWorkspaceInvitation,
  loadWorkspaceInvitations,
  revokeWorkspaceInvitation
} from "./openroadInvitations";

describe("openroad invitation persistence client", () => {
  it("loads workspace invitations with same-origin credentials", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        invitations: [
          {
            createdAt: "2026-07-05T00:00:00.000Z",
            createdByActorId: "local-owner",
            deliveryAttemptedAt: "2026-07-10T10:00:00.000Z",
            deliveryChannel: "jsonl-file",
            deliveryError: "token=should-redact",
            deliveryMessageId: "jsonl:invitation-1",
            deliveryStatus: "sent",
            email: "teammate@example.com",
            expiresAt: "2026-07-19T00:00:00.000Z",
            id: "invitation-1",
            role: "Maintainer",
            status: "pending",
            tokenHash: "should-not-parse",
            workspaceId: "acme"
          }
        ]
      })
    ) as unknown as typeof fetch;

    const result = await loadWorkspaceInvitations("acme", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("/api/openroad/workspaces/acme/invitations", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    expect(result.status).toBe("ready");
    expect(result.invitations[0]).toMatchObject({
      email: "teammate@example.com",
      deliveryChannel: "jsonl-file",
      deliveryError: "token=[redacted]",
      deliveryStatus: "sent",
      role: "Maintainer",
      status: "pending"
    });
    expect("tokenHash" in result.invitations[0]).toBe(false);
  });

  it("returns bounded unavailable states for forbidden and network failures", async () => {
    const forbiddenFetch = vi.fn(async () =>
      jsonResponse({ error: { message: "Nope token=raw-secret" } }, 403)
    ) as unknown as typeof fetch;
    const failingFetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const forbidden = await loadWorkspaceInvitations("acme", forbiddenFetch);
    const unavailable = await loadWorkspaceInvitations("acme", failingFetch);

    expect(forbidden).toMatchObject({
      invitations: [],
      status: "forbidden"
    });
    expect(forbidden.message).not.toContain("raw-secret");
    expect(unavailable).toEqual(
      createStandaloneInvitationAccess(
        "acme",
        "Team invitation metadata is unavailable in this browser session."
      )
    );
  });

  it("creates, revokes, and accepts invitations through JSON APIs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          acceptToken: "oinv_one-time-token",
          invitation: invitationPayload({ email: "new@example.com" }),
          status: "pending"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          invitation: invitationPayload({ email: "new@example.com", status: "revoked" }),
          status: "revoked"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          invitation: invitationPayload({ email: "accepted@example.com", status: "accepted" }),
          status: "accepted"
        })
      ) as unknown as typeof fetch;

    const created = await createWorkspaceInvitation(
      "acme",
      { email: "new@example.com", name: "New teammate", role: "Viewer" },
      fetchImpl
    );
    const revoked = await revokeWorkspaceInvitation("acme", "invitation-1", fetchImpl);
    const accepted = await acceptWorkspaceInvitationToken("oinv_one-time-token", "Accepted", fetchImpl);

    expect(created).toMatchObject({
      acceptToken: "oinv_one-time-token",
      invitation: { email: "new@example.com" },
      status: "created"
    });
    expect(revoked).toMatchObject({
      invitation: { status: "revoked" },
      status: "revoked"
    });
    expect(accepted).toMatchObject({
      invitation: { status: "accepted" },
      status: "accepted"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/workspaces/acme/invitations",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST"
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/openroad/workspaces/acme/invitations/invitation-1/revoke",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST"
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "/api/openroad/invitations/accept",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST"
      })
    );
  });
});

function invitationPayload(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-07-05T00:00:00.000Z",
    createdByActorId: "local-owner",
    email: "teammate@example.com",
    expiresAt: "2026-07-19T00:00:00.000Z",
    id: "invitation-1",
    role: "Viewer",
    status: "pending",
    workspaceId: "acme",
    ...overrides
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
