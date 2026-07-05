import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialOpenRoadState } from "../domain/openroad";
import { loadServerOpenRoadState, saveServerOpenRoadState } from "./openroadServer";

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
