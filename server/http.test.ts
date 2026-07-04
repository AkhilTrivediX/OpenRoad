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
import { FileTeamStore } from "./team";
import type { AuthOptions } from "./access";

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
    expect(health.body).toMatchObject({
      apiVersion: "2026-07-04",
      ok: true,
      schemaVersion: openRoadSchemaVersion
    });
    expect(health.body.requestId).toBeTruthy();
    expect(state.status).toBe(200);
    expect(state.body.state.schemaVersion).toBe(openRoadSchemaVersion);
    expect(state.body.state.workspaces[0].id).toBe("acme");
  });

  it("publishes the API auth and tenancy contract", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });

    const response = await fetchJson(`${url}/api/openroad/contract`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      apiVersion: "2026-07-04",
      contract: {
        auth: {
          adminTokenConfigured: true,
          singleUserMode: false,
          trustedProxyHeadersEnabled: true
        },
        workspaceRoles: ["Owner", "Maintainer", "Contributor", "Viewer"]
      }
    });
    expect(response.body.contract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/state",
        permission: "state:read"
      })
    );
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
    expect(invalidJson.body.error).toMatchObject({
      code: "invalid_json",
      status: 400
    });
    expect(invalidJson.body.error.requestId).toBe(invalidJson.body.requestId);
    expect(invalidState.status).toBe(422);
    expect(invalidState.body.error.code).toBe("invalid_state");
    expect(futureState.status).toBe(409);
    expect(futureState.body.error.code).toBe("future_schema");
    expect(after).toBe(before);
  });

  it("protects private state APIs when an admin token is configured", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false }
    });
    const state = createInitialOpenRoadState();

    const missing = await fetchJson(`${url}/api/openroad/state`);
    const invalid = await fetchJson(`${url}/api/openroad/state`, {
      headers: { Authorization: "Bearer wrong" }
    });
    const allowed = await fetchJson(`${url}/api/openroad/state`, {
      headers: { Authorization: "Bearer secret" }
    });
    const deniedWrite = await fetchJson(`${url}/api/openroad/state`, {
      body: JSON.stringify({ state }),
      headers: { "Content-Type": "application/json" },
      method: "PUT"
    });

    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("forbidden");
    expect(invalid.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(allowed.body.state.schemaVersion).toBe(openRoadSchemaVersion);
    expect(deniedWrite.status).toBe(403);
  });

  it("allows configured admin token to replace state", async () => {
    const { dataFile, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false }
    });
    const state = createInitialOpenRoadState();
    const nextState = {
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          name: "Admin Workspace"
        },
        ...state.workspaces.slice(1)
      ]
    };

    const response = await fetchJson(`${url}/api/openroad/state`, {
      body: JSON.stringify({ state: nextState }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "PUT"
    });
    const persisted = JSON.parse(await readFile(dataFile, "utf8")) as {
      workspaces: Array<{ name: string }>;
    };

    expect(response.status).toBe(200);
    expect(persisted.workspaces[0].name).toBe("Admin Workspace");
  });

  it("enforces workspace-scoped reads for trusted member actors", async () => {
    const { url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true }
    });

    const ownWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const otherWorkspace = await fetchJson(`${url}/api/openroad/workspaces/maintainer`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });

    expect(ownWorkspace.status).toBe(200);
    expect(ownWorkspace.body.workspace.id).toBe("acme");
    expect(otherWorkspace.status).toBe(403);
    expect(otherWorkspace.body.error.code).toBe("forbidden");
  });

  it("enforces action permissions by role and workspace scope without full-state leaks", async () => {
    const { store, url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true }
    });
    const state = createInitialOpenRoadState();
    const request = {
      ...state.workspaces[0].requests[0],
      id: "contract-created-request",
      title: "Contract-created request"
    };

    const globalMemberWrite = await fetchJson(`${url}/api/openroad/actions`, {
      body: JSON.stringify({
        action: { request, type: "create-request", workspaceId: "acme" }
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Contributor"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const viewerWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: { request, type: "create-request", workspaceId: "acme" }
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Viewer"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const contributorCrossWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: { request, type: "create-request", workspaceId: "maintainer" }
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Contributor"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const contributorWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: { request, type: "create-request", workspaceId: "acme" }
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Contributor"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const nextState = await store.load();

    expect(globalMemberWrite.status).toBe(403);
    expect(viewerWrite.status).toBe(403);
    expect(contributorCrossWorkspace.status).toBe(403);
    expect(contributorWrite.status).toBe(200);
    expect(contributorWrite.body.workspace.id).toBe("acme");
    expect(contributorWrite.body.revision).toBeTruthy();
    expect(contributorWrite.body.state).toBeUndefined();
    expect(contributorWrite.body.workspace.name).not.toBe("Maintainer Lab");
    expect(
      nextState.state.workspaces[0].requests.some((item) => item.id === request.id)
    ).toBe(true);
  });

  it("requires owner/admin permission for replace-state actions", async () => {
    const { url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true }
    });
    const state = createInitialOpenRoadState();

    const response = await fetchJson(`${url}/api/openroad/actions`, {
      body: JSON.stringify({
        action: { state, type: "replace-state" }
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
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

  it("returns session and workspace lists filtered to the current actor", async () => {
    const { url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true }
    });

    const session = await fetchJson(`${url}/api/openroad/session`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const workspaces = await fetchJson(`${url}/api/openroad/workspaces`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const publicVisitor = await fetchJson(`${url}/api/openroad/workspaces`, {
      headers: { "x-openroad-actor-type": "public-visitor" }
    });

    expect(session.status).toBe(200);
    expect(session.body.actor).toMatchObject({
      type: "workspace-member",
      workspaceId: "acme"
    });
    expect(session.body.memberships.every((item: { workspaceId: string }) => item.workspaceId === "acme")).toBe(true);
    expect(workspaces.status).toBe(200);
    expect(workspaces.body.workspaces).toHaveLength(1);
    expect(workspaces.body.workspaces[0]).toMatchObject({
      id: "acme",
      name: "Acme OSS"
    });
    expect(JSON.stringify(workspaces.body)).not.toContain("Maintainer Lab");
    expect(publicVisitor.status).toBe(403);
  });

  it("records and filters audit events for state and workspace mutations", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });
    const state = createInitialOpenRoadState();
    const request = {
      ...state.workspaces[0].requests[0],
      id: "audit-request",
      title: "Audit request"
    };
    await fetchJson(`${url}/api/openroad/state`, {
      body: JSON.stringify({ state }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "PUT"
    });
    const workspaceAction = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: { request, type: "create-request", workspaceId: "acme" }
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Contributor"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const ownAudit = await fetchJson(`${url}/api/openroad/audit-events?workspaceId=acme`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const crossWorkspaceAudit = await fetchJson(
      `${url}/api/openroad/audit-events?workspaceId=maintainer`,
      {
        headers: workspaceActorHeaders("acme", "Viewer")
      }
    );

    expect(workspaceAction.status).toBe(200);
    expect(ownAudit.status).toBe(200);
    expect(ownAudit.body.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: expect.any(String),
          type: "action.create-request",
          workspaceId: "acme"
        })
      ])
    );
    expect(JSON.stringify(ownAudit.body.auditEvents)).not.toContain("Users cannot tell");
    expect(crossWorkspaceAudit.status).toBe(403);
  });

  it("keeps ops status private", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false }
    });

    const denied = await fetchJson(`${url}/api/openroad/ops/status`);
    const allowed = await fetchJson(`${url}/api/openroad/ops/status`, {
      headers: { Authorization: "Bearer secret" }
    });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({
      status: "ok",
      stores: {
        openRoad: expect.any(String),
        team: expect.any(String)
      },
      totals: {
        workspaces: 2
      }
    });
    expect(JSON.stringify(allowed.body)).not.toContain("secret");
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
    expect(response.body.error.status).toBe(405);
    expect(response.body.error.requestId).toBe(response.body.requestId);
  });
});

async function startTestServer(options: { auth?: AuthOptions } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openroad-server-"));
  const distDir = join(directory, "dist");
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<main>OpenRoad production shell</main>", "utf8");
  await writeFile(join(distDir, "assets", "app.js"), "console.log('asset-loaded')", "utf8");
  await writeFile(join(directory, "secret.txt"), "secret", "utf8");

  const dataFile = join(directory, "state.json");
  const teamFile = join(directory, "team.json");
  const store = new FileOpenRoadStore(dataFile);
  const teamStore = new FileTeamStore(teamFile);
  await store.load();
  const server = createOpenRoadServer({
    auth: options.auth,
    distDir,
    logger: { error: vi.fn(), log: vi.fn() },
    store,
    teamStore
  });
  const url = await listen(server);
  openServers.push(server);

  return { dataFile, store, teamFile, teamStore, url };
}

function workspaceActorHeaders(workspaceId: string, role: string) {
  return {
    "x-openroad-actor-id": `${workspaceId}-${role.toLowerCase()}`,
    "x-openroad-actor-type": "workspace-member",
    "x-openroad-workspace-id": workspaceId,
    "x-openroad-workspace-role": role
  };
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
