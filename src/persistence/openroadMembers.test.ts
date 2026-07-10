import { describe, expect, it, vi } from "vitest";

import {
  createStandaloneMemberAccess,
  deactivateWorkspaceMember,
  loadWorkspaceMembers,
  updateWorkspaceMemberRole
} from "./openroadMembers";

describe("openroad member persistence client", () => {
  it("loads workspace members with same-origin credentials and parses safe fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        members: [
          {
            accountPasswordSet: true,
            createdAt: "2026-07-05T00:00:00.000Z",
            email: "member@example.com",
            id: "membership-user-member-acme",
            isLocalOwner: false,
            name: "Member User",
            passwordHash: "should-not-parse",
            role: "Contributor",
            salt: "should-not-parse",
            sessionTokenHash: "should-not-parse",
            userId: "user-member",
            workspaceId: "acme"
          }
        ]
      })
    ) as unknown as typeof fetch;

    const result = await loadWorkspaceMembers("acme", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("/api/openroad/workspaces/acme/members", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    expect(result.status).toBe("ready");
    expect(result.members[0]).toMatchObject({
      accountPasswordSet: true,
      email: "member@example.com",
      role: "Contributor",
      userId: "user-member"
    });
    expect("passwordHash" in result.members[0]).toBe(false);
    expect("salt" in result.members[0]).toBe(false);
    expect("sessionTokenHash" in result.members[0]).toBe(false);
  });

  it("returns bounded unavailable states for forbidden and network failures", async () => {
    const forbiddenFetch = vi.fn(async () =>
      jsonResponse({ error: { message: "Nope password=raw-secret" } }, 403)
    ) as unknown as typeof fetch;
    const failingFetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const forbidden = await loadWorkspaceMembers("acme", forbiddenFetch);
    const unavailable = await loadWorkspaceMembers("acme", failingFetch);

    expect(forbidden).toMatchObject({
      members: [],
      status: "forbidden"
    });
    expect(forbidden.message).not.toContain("raw-secret");
    expect(unavailable).toEqual(
      createStandaloneMemberAccess(
        "acme",
        "Team member metadata is unavailable in this browser session."
      )
    );
  });

  it("updates roles and deactivates members through JSON APIs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          member: memberPayload({ role: "Viewer" }),
          revokedSessions: 2,
          status: "updated"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          member: memberPayload({ role: "Viewer" }),
          revokedSessions: 1,
          status: "deactivated"
        })
      ) as unknown as typeof fetch;

    const updated = await updateWorkspaceMemberRole("acme", "membership-1", "Viewer", fetchImpl);
    const deactivated = await deactivateWorkspaceMember("acme", "membership-1", fetchImpl);

    expect(updated).toMatchObject({
      member: { email: "member@example.com", role: "Viewer" },
      revokedSessions: 2,
      status: "updated"
    });
    expect(deactivated).toMatchObject({
      member: { email: "member@example.com" },
      revokedSessions: 1,
      status: "deactivated"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/workspaces/acme/members/membership-1",
      expect.objectContaining({
        body: JSON.stringify({ role: "Viewer" }),
        credentials: "same-origin",
        method: "PATCH"
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/openroad/workspaces/acme/members/membership-1/deactivate",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST"
      })
    );
  });
});

function memberPayload(overrides: Record<string, unknown> = {}) {
  return {
    accountPasswordSet: true,
    createdAt: "2026-07-05T00:00:00.000Z",
    email: "member@example.com",
    id: "membership-1",
    isLocalOwner: false,
    name: "Member User",
    role: "Contributor",
    userId: "user-member",
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
