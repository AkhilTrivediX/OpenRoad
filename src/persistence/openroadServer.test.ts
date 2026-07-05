import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialOpenRoadState } from "../domain/openroad";
import {
  OpenRoadServerAuthRequiredError,
  loadServerOpenRoadSession,
  loadServerOpenRoadState,
  loginOpenRoadOwner,
  saveServerOpenRoadState
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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openroad/state",
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
});
