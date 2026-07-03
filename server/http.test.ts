// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInitialOpenRoadState,
  openRoadSchemaVersion,
  type ChangelogItem,
  type RequestItem,
  type RoadmapItem
} from "../src/domain/openroad";
import { createOpenRoadServer } from "./http";
import { FileOpenRoadStore } from "./store";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
});

describe("OpenRoad production server", () => {
  it("serves health and current state APIs", async () => {
    const { url } = await startTestServer();

    const health = await fetchJson(`${url}/api/health`);
    const state = await fetchJson(`${url}/api/openroad/state`);

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, schemaVersion: openRoadSchemaVersion });
    expect(state.status).toBe(200);
    expect(state.body.state.schemaVersion).toBe(openRoadSchemaVersion);
    expect(state.body.state.workspaces[0].id).toBe("acme");
  });

  it("persists valid state replacements", async () => {
    const { dataFile, url } = await startTestServer();
    const state = createInitialOpenRoadState();
    const nextState = {
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          name: "Hosted Workspace"
        },
        ...state.workspaces.slice(1)
      ]
    };

    const response = await fetchJson(`${url}/api/openroad/state`, {
      body: JSON.stringify({ state: nextState }),
      headers: { "Content-Type": "application/json" },
      method: "PUT"
    });
    const persisted = JSON.parse(await readFile(dataFile, "utf8")) as {
      workspaces: Array<{ name: string }>;
    };

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("saved");
    expect(persisted.workspaces[0].name).toBe("Hosted Workspace");
  });

  it("rejects invalid JSON and invalid states without mutating persisted data", async () => {
    const { dataFile, url } = await startTestServer();
    const before = await readFile(dataFile, "utf8");

    const invalidJson = await fetchJson(`${url}/api/openroad/state`, {
      body: "{",
      headers: { "Content-Type": "application/json" },
      method: "PUT"
    });
    const invalidState = await fetchJson(`${url}/api/openroad/state`, {
      body: JSON.stringify({
        state: {
          schemaVersion: openRoadSchemaVersion,
          workspaces: [{ id: "broken" }]
        }
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT"
    });
    const futureState = await fetchJson(`${url}/api/openroad/state`, {
      body: JSON.stringify({
        state: {
          schemaVersion: openRoadSchemaVersion + 1,
          workspaces: []
        }
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT"
    });
    const after = await readFile(dataFile, "utf8");

    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body.error.code).toBe("invalid_json");
    expect(invalidState.status).toBe(422);
    expect(invalidState.body.error.code).toBe("invalid_state");
    expect(futureState.status).toBe(409);
    expect(futureState.body.error.code).toBe("future_schema");
    expect(after).toBe(before);
  });

  it("returns public portal data without private workspace details", async () => {
    const { store, url } = await startTestServer();
    const state = createStateWithPrivatePortalData();
    await store.replaceState(state);

    const response = await fetch(`${url}/api/openroad/workspaces/acme/portal?query=public`);
    const text = await response.text();
    const body = JSON.parse(text) as {
      changelog: Array<{ publicSummary: string }>;
      requests: Array<{ title: string }>;
      roadmap: { Now: Array<{ title: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.requests[0].title).toBe("Public request");
    expect(body.roadmap.Now[0].title).toBe("Public roadmap");
    expect(body.changelog[0].publicSummary).toBe("Public release wording.");
    expect(text).not.toContain("Private request");
    expect(text).not.toContain("Internal comment");
    expect(text).not.toContain("Hidden comment");
    expect(text).not.toContain("Secret requester");
    expect(text).not.toContain("Private roadmap");
    expect(text).not.toContain("Draft release");
    expect(text).not.toContain("Private release");
    expect(text).not.toContain("Secret private notes");
  });

  it("returns 404 for unknown public portal workspaces", async () => {
    const { url } = await startTestServer();

    const response = await fetchJson(`${url}/api/openroad/workspaces/missing/portal`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("serves app routes, assets, and blocks static path traversal", async () => {
    const { url } = await startTestServer();

    const appRoute = await fetch(`${url}/roadmap`);
    const asset = await fetch(`${url}/assets/app.js`);
    const traversal = await fetchJson(`${url}/%2e%2e%2fsecret.txt`);

    expect(appRoute.status).toBe(200);
    expect(await appRoute.text()).toContain("OpenRoad production shell");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("asset-loaded");
    expect(traversal.status).toBe(403);
    expect(traversal.body.error.code).toBe("not_found");
  });

  it("returns structured API errors for unsupported methods", async () => {
    const { url } = await startTestServer();

    const response = await fetchJson(`${url}/api/health`, { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.body.error.code).toBe("invalid_method");
  });
});

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-server-"));
  const distDir = join(directory, "dist");
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<main>OpenRoad production shell</main>", "utf8");
  await writeFile(join(distDir, "assets", "app.js"), "console.log('asset-loaded')", "utf8");
  await writeFile(join(directory, "secret.txt"), "secret", "utf8");

  const dataFile = join(directory, "state.json");
  const store = new FileOpenRoadStore(dataFile);
  await store.load();
  const server = createOpenRoadServer({
    distDir,
    logger: { error: vi.fn(), log: vi.fn() },
    store
  });
  const url = await listen(server);
  openServers.push(server);

  return { dataFile, store, url };
}

function listen(server: Server) {
  return new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  return {
    body: (await response.json()) as Record<string, any>,
    status: response.status
  };
}

function createStateWithPrivatePortalData() {
  const state = createInitialOpenRoadState();
  const workspace = state.workspaces[0];
  const requestBase = workspace.requests[0];
  const privateRequestBase = workspace.requests[1] ?? requestBase;
  const roadmapBase =
    workspace.roadmap.Now[0] ?? workspace.roadmap.Next[0] ?? workspace.roadmap.Later[0];
  const changelogBase = workspace.changelog[0];
  const publicRequest: RequestItem = {
    ...requestBase,
    archived: false,
    comments: [
      {
        age: "today",
        author: "Visitor",
        body: "Public comment",
        id: "public-comment",
        visibility: "Public"
      },
      {
        age: "today",
        author: "Internal",
        body: "Internal comment",
        id: "internal-comment",
        visibility: "Internal"
      },
      {
        age: "today",
        author: "Moderator",
        body: "Hidden comment",
        id: "hidden-comment",
        visibility: "Hidden"
      }
    ],
    description: "Public description",
    id: "public-request",
    requester: "Secret requester",
    source: "Secret source",
    title: "Public request",
    visibility: "Public"
  };
  const privateRequest: RequestItem = {
    ...privateRequestBase,
    archived: false,
    id: "private-request",
    title: "Private request",
    visibility: "Private"
  };
  const publicRoadmap: RoadmapItem = {
    ...roadmapBase,
    id: "public-roadmap",
    lane: "Now",
    title: "Public roadmap",
    visibility: "Public"
  };
  const privateRoadmap: RoadmapItem = {
    ...roadmapBase,
    id: "private-roadmap",
    lane: "Now",
    title: "Private roadmap",
    visibility: "Private"
  };
  const publicChangelog: ChangelogItem = {
    ...changelogBase,
    id: "public-release",
    privateNotes: "Secret private notes",
    publicSummary: "Public release wording.",
    state: "Ready",
    title: "Public release",
    visibility: "Public"
  };
  const privateChangelog: ChangelogItem = {
    ...publicChangelog,
    id: "private-release",
    publicSummary: "Private release",
    title: "Private release",
    visibility: "Private"
  };
  const draftChangelog: ChangelogItem = {
    ...publicChangelog,
    id: "draft-release",
    publicSummary: "Draft release",
    state: "Draft",
    title: "Draft release"
  };

  return {
    ...state,
    workspaces: [
      {
        ...workspace,
        changelog: [publicChangelog, privateChangelog, draftChangelog],
        requests: [publicRequest, privateRequest],
        roadmap: {
          Later: [],
          Next: [],
          Now: [publicRoadmap, privateRoadmap]
        }
      },
      ...state.workspaces.slice(1)
    ]
  };
}
