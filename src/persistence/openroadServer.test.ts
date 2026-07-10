import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialOpenRoadState } from "../domain/openroad";
import {
  OpenRoadServerAuthRequiredError,
  acceptOpenRoadInvitationSession,
  loadServerOpenRoadSession,
  loadServerOpenRoadState,
  loginOpenRoadAccount,
  loginOpenRoadOwner,
  saveServerOpenRoadState,
  setOpenRoadAccountPassword
} from "./openroadServer";

describe("server OpenRoad persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads server state with same-origin credentials", async () => {
    const state = createInitialOpenRoadState();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ state }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadServerOpenRoadState();

    expect(result.state.schemaVersion).toBe(state.schemaVersion);
    expect(result.serverScope).toBe("owner");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/state",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      })
    );
  });

  it("loads workspace-scoped state for accepted member sessions", async () => {
    const state = createInitialOpenRoadState();
    const memberWorkspace = {
      ...state.workspaces[0],
      name: "Member Workspace"
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/openroad/state") {
        return jsonResponse(
          {
            error: {
              code: "forbidden",
              message: "Actor does not have permission to access this OpenRoad resource."
            }
          },
          403
        );
      }

      if (url === "/api/openroad/session") {
        return jsonResponse({
          actor: {
            id: "user-member@example.com",
            role: "Contributor",
            type: "workspace-member",
            workspaceId: "acme"
          },
          authenticated: true,
          memberships: [{ role: "Contributor", workspaceId: "acme" }]
        });
      }

      if (url === "/api/openroad/workspaces") {
        return jsonResponse({
          workspaces: [{ id: "acme", name: "Member Workspace" }]
        });
      }

      if (url === "/api/openroad/workspaces/acme") {
        return jsonResponse({ workspace: memberWorkspace });
      }

      return jsonResponse({ error: { message: "Unhandled test request." } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadServerOpenRoadState();

    expect(result.serverScope).toBe("workspace-member");
    expect(result.state.workspaces).toHaveLength(1);
    expect(result.state.workspaces[0].name).toBe("Member Workspace");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      })
    );
  });

  it("throws typed auth-required errors for forbidden server state", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "forbidden",
            message: "Actor does not have permission to access this OpenRoad resource."
          }
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 403
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadServerOpenRoadState()).rejects.toBeInstanceOf(
      OpenRoadServerAuthRequiredError
    );
  });

  it("loads server session metadata with same-origin credentials", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authenticated: false, loginRequired: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await loadServerOpenRoadSession();

    expect(session.loginRequired).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/session",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      })
    );
  });

  it("posts owner login with same-origin credentials", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authenticated: true, status: "authenticated" }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const login = await loginOpenRoadOwner("admin-token");

    expect(login.authenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/auth/login",
      expect.objectContaining({
        body: JSON.stringify({ adminToken: "admin-token" }),
        credentials: "same-origin",
        method: "POST"
      })
    );
  });

  it("accepts invitations as browser sessions with same-origin credentials", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authenticated: true, status: "authenticated" }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await acceptOpenRoadInvitationSession("oinv_secret-token", "Member User");

    expect(session.authenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/invitations/session",
      expect.objectContaining({
        body: JSON.stringify({ name: "Member User", token: "oinv_secret-token" }),
        credentials: "same-origin",
        method: "POST"
      })
    );
  });

  it("logs in account passwords and sets account passwords with same-origin credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, status: "authenticated" }))
      .mockResolvedValueOnce(jsonResponse({ status: "password_set" }));
    vi.stubGlobal("fetch", fetchMock);

    const login = await loginOpenRoadAccount("member@example.com", "member password value", "acme");
    const passwordSet = await setOpenRoadAccountPassword(
      "member password value next",
      "member password value"
    );

    expect(login.authenticated).toBe(true);
    expect(passwordSet.status).toBe("password_set");
    const loginInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const passwordSetInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/auth/password/login",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/openroad/account/password",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST"
      })
    );
    expect(JSON.parse(String(loginInit.body))).toEqual({
      email: "member@example.com",
      password: "member password value",
      workspaceId: "acme"
    });
    expect(JSON.parse(String(passwordSetInit.body))).toEqual({
      currentPassword: "member password value",
      password: "member password value next"
    });
  });

  it("saves server state with same-origin credentials", async () => {
    const state = createInitialOpenRoadState();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ state }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveServerOpenRoadState(state);

    expect(saved.schemaVersion).toBe(state.schemaVersion);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/state",
      expect.objectContaining({
        credentials: "same-origin",
        method: "PUT"
      })
    );
  });

  it("falls back to workspace-scoped saves when full-state saves are forbidden", async () => {
    const state = {
      ...createInitialOpenRoadState(),
      workspaces: [createInitialOpenRoadState().workspaces[0]]
    };
    const savedWorkspace = {
      ...state.workspaces[0],
      summary: "Member saved workspace"
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/openroad/state" && method === "PUT") {
        return jsonResponse(
          {
            error: {
              code: "forbidden",
              message: "Actor does not have permission to access this OpenRoad resource."
            }
          },
          403
        );
      }

      if (url === "/api/openroad/workspaces/acme" && method === "PUT") {
        return jsonResponse({
          status: "saved",
          workspace: savedWorkspace
        });
      }

      return jsonResponse({ error: { message: "Unhandled test request." } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveServerOpenRoadState(state);

    expect(saved.workspaces).toHaveLength(1);
    expect(saved.workspaces[0].summary).toBe("Member saved workspace");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme",
      expect.objectContaining({
        body: JSON.stringify({ workspace: state.workspaces[0] }),
        credentials: "same-origin",
        method: "PUT"
      })
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
