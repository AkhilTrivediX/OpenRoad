// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
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
import { InMemoryPortalRateLimiter, createOpenRoadServer, type PortalRateLimiter } from "./http";
import { FileIntegrationStore } from "./integrations";
import { FileOpenRoadStore } from "./store";
import { FileTeamStore } from "./team";
import type { AuthOptions } from "./access";
import type { GitHubAppClient, GitHubAppConfig } from "./github-app";
import type { LinearOAuthConfig } from "./linear";

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

  it("imports GitHub issues into requests and persists mappings outside core state", async () => {
    const { dataFile, integrationFile, teamFile, url } = await startTestServer();

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const coreStateText = await readFile(dataFile, "utf8");
    const integrationState = JSON.parse(await readFile(integrationFile, "utf8")) as {
      installations: unknown[];
      mappings: Array<{ external: { type: string }; openRoad: { id: string } }>;
    };
    const teamState = JSON.parse(await readFile(teamFile, "utf8")) as {
      auditEvents: Array<{ type: string; workspaceId: string }>;
    };

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("created");
    expect(response.body.request).toMatchObject({
      requester: "akhil",
      source: "GitHub",
      title: "Import GitHub issues",
      visibility: "Private"
    });
    expect(response.body.mappings).toHaveLength(2);
    expect(integrationState.installations).toHaveLength(1);
    expect(integrationState.mappings).toHaveLength(2);
    expect(integrationState.mappings.map((mapping) => mapping.external.type).sort()).toEqual([
      "issue",
      "pull-request"
    ]);
    expect(integrationState.mappings[0].openRoad.id).toBe(response.body.request.id);
    expect(coreStateText).not.toContain("providerAccountId");
    expect(teamState.auditEvents[0]).toMatchObject({
      type: "integration.github.issue.import",
      workspaceId: "acme"
    });
  });

  it("re-imports the same GitHub issue by updating the mapped request", async () => {
    const { store, url } = await startTestServer();

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const updated = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(
        gitHubImportPayload({
          issue: gitHubIssuePayload({
            labels: [{ name: "planned" }],
            title: "Updated GitHub issue"
          })
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const persisted = await store.load();
    const workspace = persisted.state.workspaces.find((item) => item.id === "acme");
    const matchingRequests = workspace?.requests.filter(
      (request) => request.id === created.body.request.id
    );

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(updated.body.request.id).toBe(created.body.request.id);
    expect(updated.body.request.title).toBe("Updated GitHub issue");
    expect(matchingRequests).toHaveLength(1);
  });

  it("keeps GitHub duplicate detection scoped to workspace and installation", async () => {
    const { integrationStore, url } = await startTestServer();

    const acmeImport = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const maintainerImport = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/issues/import`,
      {
        body: JSON.stringify(gitHubImportPayload()),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();
    const issueMappings = integrations.state.mappings.filter(
      (mapping) => mapping.external.type === "issue"
    );

    expect(acmeImport.status).toBe(201);
    expect(maintainerImport.status).toBe(201);
    expect(issueMappings).toHaveLength(2);
    expect(new Set(issueMappings.map((mapping) => mapping.id))).toHaveLength(2);
    expect(new Set(issueMappings.map((mapping) => mapping.openRoad.workspaceId))).toEqual(
      new Set(["acme", "maintainer"])
    );
  });

  it("links a GitHub issue to an existing request without creating a duplicate request", async () => {
    const { store, url } = await startTestServer();
    const before = await store.load();
    const existingRequest = before.state.workspaces[0].requests[0];

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload({ requestId: existingRequest.id })),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const after = await store.load();
    const workspace = after.state.workspaces.find((item) => item.id === "acme");

    expect(response.status).toBe(200);
    expect(response.body.request.id).toBe(existingRequest.id);
    expect(workspace?.requests).toHaveLength(before.state.workspaces[0].requests.length);
    expect(workspace?.requests.find((request) => request.id === existingRequest.id)?.title).toBe(
      "Import GitHub issues"
    );
  });

  it("protects GitHub import from public and viewer actors while allowing contributor and integration actors", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });

    const publicWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const viewerWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        ...workspaceActorHeaders("acme", "Viewer"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const contributorWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/import`,
      {
        body: JSON.stringify(
          gitHubImportPayload({
            issue: gitHubIssuePayload({ node_id: "I_kwDOGH124", number: 43 })
          })
        ),
        headers: {
          ...workspaceActorHeaders("acme", "Contributor"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/import`,
      {
        body: JSON.stringify(
          gitHubImportPayload({
            issue: gitHubIssuePayload({ node_id: "I_kwDOGH125", number: 44 })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "github:github-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationCrossWorkspace = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/issues/import`,
      {
        body: JSON.stringify(
          gitHubImportPayload({
            issue: gitHubIssuePayload({ node_id: "I_kwDOGH126", number: 45 })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "github:github-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const wrongProviderIntegration = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/import`,
      {
        body: JSON.stringify(
          gitHubImportPayload({
            issue: gitHubIssuePayload({ node_id: "I_kwDOGH127", number: 46 })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "linear:linear-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    expect(publicWrite.status).toBe(403);
    expect(viewerWrite.status).toBe(403);
    expect(contributorWrite.status).toBe(201);
    expect(integrationWrite.status).toBe(201);
    expect(integrationCrossWorkspace.status).toBe(403);
    expect(wrongProviderIntegration.status).toBe(403);
  });

  it("rejects invalid GitHub imports without mutating state or integration metadata", async () => {
    const { dataFile, integrationFile, integrationStore, url } = await startTestServer();
    await integrationStore.load();
    const beforeState = await readFile(dataFile, "utf8");
    const beforeIntegrations = await readFile(integrationFile, "utf8");

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(
        gitHubImportPayload({
          issue: { ...gitHubIssuePayload(), node_id: "", id: "", title: "" }
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
    expect(await readFile(dataFile, "utf8")).toBe(beforeState);
    expect(await readFile(integrationFile, "utf8")).toBe(beforeIntegrations);
  });

  it("returns safe GitHub App setup state without exposing secrets", async () => {
    const { url } = await startTestServer({
      githubAppConfig: {
        apiBaseUrl: "https://api.github.com",
        appBaseUrl: "https://github.com",
        appId: "12345",
        privateKey: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
        slug: "openroad-test",
        webhookSecretConfigured: true
      }
    });

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/app/setup`);
    const text = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.body.githubApp).toMatchObject({
      configured: true,
      missing: [],
      requiredEvents: ["issues", "pull_request"]
    });
    expect(response.body.githubApp.installUrl).toContain(
      "https://github.com/apps/openroad-test/installations/new"
    );
    expect(text).not.toContain("secret");
    expect(text).not.toContain("PRIVATE KEY");
  });

  it("reports missing GitHub App setup without blocking standalone mode", async () => {
    const { url } = await startTestServer();

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/app/setup`);

    expect(response.status).toBe(200);
    expect(response.body.githubApp).toMatchObject({
      configured: false,
      missing: [
        "OPENROAD_GITHUB_APP_SLUG",
        "OPENROAD_GITHUB_APP_ID",
        "OPENROAD_GITHUB_APP_PRIVATE_KEY or OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE"
      ]
    });
  });

  it("verifies GitHub App installations into integration metadata", async () => {
    const { integrationStore, teamFile, url } = await startTestServer({
      githubAppClient: fakeGitHubAppClient()
    });

    const response = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();
    const teamState = JSON.parse(await readFile(teamFile, "utf8")) as {
      auditEvents: Array<{ summary: string; type: string; workspaceId: string }>;
    };
    const text = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      installation: {
        id: "github-installation-98765",
        provider: "github",
        providerAccountName: "AkhilTrivediX",
        workspaceId: "acme"
      },
      status: "verified"
    });
    expect(integrations.state.installations).toHaveLength(1);
    expect(teamState.auditEvents[0]).toMatchObject({
      type: "integration.github.app.verify",
      workspaceId: "acme"
    });
    expect(text).not.toContain("token");
    expect(text).not.toContain("PRIVATE KEY");
  });

  it("keeps verified GitHub App installations scoped to each OpenRoad workspace", async () => {
    const { integrationStore, url } = await startTestServer({
      githubAppClient: fakeGitHubAppClient()
    });

    const acme = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const maintainer = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();

    expect(acme.status).toBe(200);
    expect(maintainer.status).toBe(200);
    expect(integrations.state.installations).toHaveLength(2);
    expect(new Set(integrations.state.installations.map((item) => item.workspaceId))).toEqual(
      new Set(["acme", "maintainer"])
    );
  });

  it("protects GitHub App setup and verification with owner-only integration management", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      githubAppClient: fakeGitHubAppClient()
    });

    const publicSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/setup`
    );
    const contributorSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/setup`,
      {
        headers: workspaceActorHeaders("acme", "Contributor")
      }
    );
    const ownerSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/setup`,
      {
        headers: workspaceActorHeaders("acme", "Owner")
      }
    );
    const publicWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const viewerWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: {
          ...workspaceActorHeaders("acme", "Viewer"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const contributorWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: {
          ...workspaceActorHeaders("acme", "Contributor"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: {
          ...integrationActorHeaders("acme", "github-installation-98765"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const ownerWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationCrossWorkspace = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "98765" }),
        headers: {
          ...integrationActorHeaders("acme", "github-installation-98765"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    expect(publicSetup.status).toBe(403);
    expect(contributorSetup.status).toBe(403);
    expect(ownerSetup.status).toBe(200);
    expect(publicWrite.status).toBe(403);
    expect(viewerWrite.status).toBe(403);
    expect(contributorWrite.status).toBe(403);
    expect(integrationWrite.status).toBe(403);
    expect(ownerWrite.status).toBe(200);
    expect(integrationCrossWorkspace.status).toBe(403);
  });

  it("rejects invalid GitHub App verification requests", async () => {
    const { integrationStore, url } = await startTestServer({
      githubAppClient: fakeGitHubAppClient()
    });
    await integrationStore.load();

    const response = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/verify`,
      {
        body: JSON.stringify({ installationId: "" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
    expect(integrations.state.installations).toHaveLength(0);
  });

  it("fetches live GitHub issues from verified installations without returning tokens", async () => {
    const fetches: Array<{ installationId: string; owner: string; repo: string; state?: string }> = [];
    const { url } = await startTestServer({
      githubAppClient: {
        ...fakeGitHubAppClient(),
        async listRepositoryIssues(options) {
          fetches.push(options);
          return fakeGitHubAppClient().listRepositoryIssues(options);
        }
      }
    });

    await verifyGitHubInstallation(url, "acme");
    const response = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad&state=open`
    );
    const text = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(fetches).toEqual([
      {
        installationId: "98765",
        owner: "AkhilTrivediX",
        perPage: 30,
        repo: "OpenRoad",
        state: "open"
      }
    ]);
    expect(response.body).toMatchObject({
      repository: "AkhilTrivediX/OpenRoad",
      status: "fetched"
    });
    expect(response.body.issues).toHaveLength(1);
    expect(response.body.issues[0]).toMatchObject({
      importPayload: {
        node_id: "I_kwDOGH123",
        number: 42
      },
      title: "Import GitHub issues"
    });
    expect(text).not.toContain("installation-token");
    expect(text).not.toContain("PRIVATE KEY");
  });

  it("imports a selected live GitHub issue through the existing import route", async () => {
    const { store, url } = await startTestServer({
      githubAppClient: fakeGitHubAppClient()
    });

    await verifyGitHubInstallation(url, "acme");
    const liveIssues = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`
    );
    const imported = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(
        gitHubImportPayload({
          issue: liveIssues.body.issues[0].importPayload,
          pullRequests: []
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const state = await store.load();

    expect(liveIssues.status).toBe(200);
    expect(imported.status).toBe(201);
    expect(
      state.state.workspaces[0].requests.some(
        (request) => request.title === "Import GitHub issues" && request.source === "GitHub"
      )
    ).toBe(true);
  });

  it("protects live GitHub issue fetch by workspace scope and installation metadata", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      githubAppClient: fakeGitHubAppClient()
    });

    await verifyGitHubInstallation(url, "acme", { Authorization: "Bearer secret" });
    const publicFetch = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`
    );
    const viewerFetch = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`,
      {
        headers: workspaceActorHeaders("acme", "Viewer")
      }
    );
    const contributorFetch = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`,
      {
        headers: workspaceActorHeaders("acme", "Contributor")
      }
    );
    const integrationFetch = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`,
      {
        headers: integrationActorHeaders("acme", "github-installation-98765")
      }
    );
    const crossWorkspaceFetch = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`,
      {
        headers: workspaceActorHeaders("maintainer", "Contributor")
      }
    );

    expect(publicFetch.status).toBe(403);
    expect(viewerFetch.status).toBe(403);
    expect(contributorFetch.status).toBe(200);
    expect(integrationFetch.status).toBe(200);
    expect(crossWorkspaceFetch.status).toBe(404);
  });

  it("rejects invalid live GitHub issue fetch requests without calling GitHub", async () => {
    let fetchCount = 0;
    const { integrationStore, url } = await startTestServer({
      githubAppClient: {
        ...fakeGitHubAppClient(),
        async listRepositoryIssues(options) {
          fetchCount += 1;
          return fakeGitHubAppClient().listRepositoryIssues(options);
        }
      }
    });

    await verifyGitHubInstallation(url, "acme");
    const integrationState = await integrationStore.load();
    await integrationStore.replaceState({
      ...integrationState.state,
      installations: integrationState.state.installations.map((installation) => ({
        ...installation,
        status: "disconnected" as const
      }))
    });
    const missingRepository = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765`
    );
    const missingInstallation = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=missing&repository=AkhilTrivediX/OpenRoad`
    );
    const disconnectedInstallation = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`
    );

    expect(missingRepository.status).toBe(400);
    expect(missingRepository.body.error.code).toBe("invalid_request");
    expect(missingInstallation.status).toBe(404);
    expect(disconnectedInstallation.status).toBe(422);
    expect(disconnectedInstallation.body.error.code).toBe("invalid_state");
    expect(fetchCount).toBe(0);
  });

  it("imports Linear issues into requests and persists mappings outside core state", async () => {
    const { dataFile, integrationFile, teamFile, url } = await startTestServer();

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(linearImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const coreStateText = await readFile(dataFile, "utf8");
    const integrationState = JSON.parse(await readFile(integrationFile, "utf8")) as {
      installations: Array<{ provider: string; workspaceId: string }>;
      mappings: Array<{ external: { provider: string; type: string }; openRoad: { id: string } }>;
    };
    const teamState = JSON.parse(await readFile(teamFile, "utf8")) as {
      auditEvents: Array<{ type: string; workspaceId: string }>;
    };

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("created");
    expect(response.body.request).toMatchObject({
      owner: "Maintainer",
      requester: "Customer Ops",
      source: "Linear",
      title: "Import Linear issues",
      visibility: "Private"
    });
    expect(response.body.mapping).toMatchObject({
      external: {
        provider: "linear",
        type: "issue"
      }
    });
    expect(integrationState.installations).toEqual([
      expect.objectContaining({ provider: "linear", workspaceId: "acme" })
    ]);
    expect(integrationState.mappings).toHaveLength(1);
    expect(integrationState.mappings[0].openRoad.id).toBe(response.body.request.id);
    expect(coreStateText).not.toContain("providerAccountId");
    expect(teamState.auditEvents[0]).toMatchObject({
      type: "integration.linear.issue.import",
      workspaceId: "acme"
    });
  });

  it("re-imports the same Linear issue by updating the mapped request", async () => {
    const { store, url } = await startTestServer();

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(linearImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const updated = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(
        linearImportPayload({
          issue: linearIssuePayload({
            labels: { nodes: [{ name: "planned" }] },
            state: { id: "state-started", name: "Started", type: "started" },
            title: "Updated Linear issue"
          })
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const persisted = await store.load();
    const workspace = persisted.state.workspaces.find((item) => item.id === "acme");
    const matchingRequests = workspace?.requests.filter(
      (request) => request.id === created.body.request.id
    );

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(updated.body.request.id).toBe(created.body.request.id);
    expect(updated.body.request.title).toBe("Updated Linear issue");
    expect(updated.body.request.status).toBe("Planned");
    expect(matchingRequests).toHaveLength(1);
  });

  it("keeps Linear installation records scoped by workspace", async () => {
    const { integrationStore, url } = await startTestServer();

    const acmeImport = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(linearImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const maintainerImport = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/linear/issues/import`,
      {
        body: JSON.stringify(
          linearImportPayload({
            issue: linearIssuePayload({
              id: "lin-issue-maintainer",
              identifier: "OPEN-43",
              title: "Maintainer Linear issue"
            })
          })
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();
    const linearInstallations = integrations.state.installations.filter(
      (installation) => installation.provider === "linear"
    );

    expect(acmeImport.status).toBe(201);
    expect(maintainerImport.status).toBe(201);
    expect(linearInstallations).toHaveLength(2);
    expect(new Set(linearInstallations.map((installation) => installation.workspaceId))).toEqual(
      new Set(["acme", "maintainer"])
    );
  });

  it("protects Linear import and OAuth setup by workspace role", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      linearOAuthConfig: testLinearOAuthConfig()
    });

    const publicSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/linear/oauth/setup`
    );
    const contributorSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/linear/oauth/setup`,
      {
        headers: workspaceActorHeaders("acme", "Contributor")
      }
    );
    const ownerSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/linear/oauth/setup`,
      {
        headers: workspaceActorHeaders("acme", "Owner")
      }
    );
    const publicWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(linearImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const viewerWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(linearImportPayload()),
      headers: {
        ...workspaceActorHeaders("acme", "Viewer"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const contributorWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`,
      {
        body: JSON.stringify(
          linearImportPayload({
            issue: linearIssuePayload({ id: "lin-issue-124", identifier: "OPEN-44" })
          })
        ),
        headers: {
          ...workspaceActorHeaders("acme", "Contributor"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`,
      {
        body: JSON.stringify(
          linearImportPayload({
            issue: linearIssuePayload({ id: "lin-issue-125", identifier: "OPEN-45" })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "linear:linear-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationCrossWorkspace = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/linear/issues/import`,
      {
        body: JSON.stringify(
          linearImportPayload({
            issue: linearIssuePayload({ id: "lin-issue-126", identifier: "OPEN-46" })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "linear:linear-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const wrongProviderIntegration = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`,
      {
        body: JSON.stringify(
          linearImportPayload({
            issue: linearIssuePayload({ id: "lin-issue-127", identifier: "OPEN-47" })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "github:github-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    expect(publicSetup.status).toBe(403);
    expect(contributorSetup.status).toBe(403);
    expect(ownerSetup.status).toBe(200);
    expect(JSON.stringify(ownerSetup.body)).not.toContain("linear-secret");
    expect(publicWrite.status).toBe(403);
    expect(viewerWrite.status).toBe(403);
    expect(contributorWrite.status).toBe(201);
    expect(integrationWrite.status).toBe(201);
    expect(integrationCrossWorkspace.status).toBe(403);
    expect(wrongProviderIntegration.status).toBe(403);
  });

  it("reports safe Linear OAuth setup without blocking standalone mode", async () => {
    const configured = await startTestServer({
      linearOAuthConfig: testLinearOAuthConfig()
    });
    const missing = await startTestServer();

    const configuredSetup = await fetchJson(
      `${configured.url}/api/openroad/workspaces/acme/integrations/linear/oauth/setup`
    );
    const missingSetup = await fetchJson(
      `${missing.url}/api/openroad/workspaces/acme/integrations/linear/oauth/setup`
    );

    expect(configuredSetup.status).toBe(200);
    expect(configuredSetup.body.linearOAuth).toMatchObject({
      configured: true,
      missing: [],
      requiredScopes: ["read"]
    });
    expect(configuredSetup.body.linearOAuth.authorizeUrl).toContain("https://linear.test/oauth/authorize");
    expect(JSON.stringify(configuredSetup.body)).not.toContain("linear-secret");
    expect(missingSetup.status).toBe(200);
    expect(missingSetup.body.linearOAuth).toMatchObject({
      configured: false,
      missing: [
        "OPENROAD_LINEAR_CLIENT_ID",
        "OPENROAD_LINEAR_CLIENT_SECRET",
        "OPENROAD_LINEAR_REDIRECT_URI"
      ]
    });
  });

  it("rejects invalid or disconnected Linear imports without mutating core state", async () => {
    const { dataFile, integrationFile, integrationStore, url } = await startTestServer();
    await integrationStore.load();
    const beforeState = await readFile(dataFile, "utf8");
    const beforeIntegrations = await readFile(integrationFile, "utf8");

    const invalid = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(
        linearImportPayload({
          issue: { ...linearIssuePayload(), id: "", title: "" }
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("invalid_request");
    expect(await readFile(dataFile, "utf8")).toBe(beforeState);
    expect(await readFile(integrationFile, "utf8")).toBe(beforeIntegrations);

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(linearImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const integrationState = await integrationStore.load();
    await integrationStore.replaceState({
      ...integrationState.state,
      installations: integrationState.state.installations.map((installation) => ({
        ...installation,
        status: "disconnected" as const
      }))
    });
    const disconnected = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(linearImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    expect(created.status).toBe(201);
    expect(disconnected.status).toBe(422);
    expect(disconnected.body.error.code).toBe("invalid_state");
  });

  it("rejects GitHub webhooks without configured secrets or valid signatures", async () => {
    const unconfigured = await startTestServer();
    const configured = await startTestServer({
      githubAppConfig: testGitHubWebhookConfig()
    });
    await configured.integrationStore.load();
    const beforeState = await readFile(configured.dataFile, "utf8");
    const beforeIntegrations = await readFile(configured.integrationFile, "utf8");

    const missingSecret = await fetchJson(`${unconfigured.url}/api/openroad/integrations/github/webhook`, {
      body: JSON.stringify(gitHubWebhookPayload()),
      headers: {
        "Content-Type": "application/json",
        "x-github-delivery": "delivery-missing-secret",
        "x-github-event": "issues"
      },
      method: "POST"
    });
    const unsignedInvalidJson = await fetchJson(`${configured.url}/api/openroad/integrations/github/webhook`, {
      body: "{",
      headers: {
        "Content-Type": "application/json",
        "x-github-delivery": "delivery-unsigned",
        "x-github-event": "issues"
      },
      method: "POST"
    });
    const invalidSignature = await fetchJson(
      `${configured.url}/api/openroad/integrations/github/webhook`,
      signedGitHubWebhookRequest(gitHubWebhookPayload(), {
        deliveryId: "delivery-invalid-signature",
        signature: "sha256=bad"
      })
    );

    expect(missingSecret.status).toBe(503);
    expect(missingSecret.body.error.code).toBe("not_configured");
    expect(unsignedInvalidJson.status).toBe(403);
    expect(unsignedInvalidJson.body.error.code).toBe("forbidden");
    expect(invalidSignature.status).toBe(403);
    expect(invalidSignature.body.error.code).toBe("forbidden");
    expect(await readFile(configured.dataFile, "utf8")).toBe(beforeState);
    expect(await readFile(configured.integrationFile, "utf8")).toBe(beforeIntegrations);
  });

  it("processes linked GitHub issue webhooks idempotently without exposing secrets", async () => {
    const { integrationStore, store, teamFile, url } = await startTestServer({
      githubAppConfig: testGitHubWebhookConfig()
    });
    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const first = await fetchJson(
      `${url}/api/openroad/integrations/github/webhook`,
      signedGitHubWebhookRequest(
        gitHubWebhookPayload({
          action: "edited",
          issue: gitHubIssuePayload({
            closed_at: "2026-07-04T02:00:00Z",
            labels: [{ name: "planned" }],
            state: "closed",
            title: "Webhook updated GitHub issue"
          })
        }),
        { deliveryId: "delivery-issue-sync" }
      )
    );
    const duplicate = await fetchJson(
      `${url}/api/openroad/integrations/github/webhook`,
      signedGitHubWebhookRequest(
        gitHubWebhookPayload({
          action: "edited",
          issue: gitHubIssuePayload({
            title: "Duplicate should not win"
          })
        }),
        { deliveryId: "delivery-issue-sync" }
      )
    );
    const persisted = await store.load();
    const integrations = await integrationStore.load();
    const teamState = JSON.parse(await readFile(teamFile, "utf8")) as {
      auditEvents: Array<{ actorType: string; summary: string; type: string; workspaceId: string }>;
    };
    const request = persisted.state.workspaces[0].requests.find(
      (item) => item.id === created.body.request.id
    );

    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({
      event: {
        deliveryId: "delivery-issue-sync",
        event: "issues",
        result: "synced",
        workspaceId: "acme"
      },
      status: "synced"
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.status).toBe("duplicate");
    expect(request).toMatchObject({
      status: "Shipping soon",
      title: "Webhook updated GitHub issue"
    });
    expect(JSON.stringify(request)).not.toContain("Duplicate should not win");
    expect(integrations.state.syncEvents).toHaveLength(1);
    expect(integrations.state.mappings.find((mapping) => mapping.external.type === "issue")?.lastSyncedAt).toBeTruthy();
    expect(teamState.auditEvents[0]).toMatchObject({
      actorType: "integration",
      type: "integration.github.webhook.issue",
      workspaceId: "acme"
    });
    expect(JSON.stringify(first.body)).not.toContain("webhook-secret");
  });

  it("accepts unmapped GitHub issue webhooks as logged no-ops", async () => {
    const { integrationStore, store, url } = await startTestServer({
      githubAppConfig: testGitHubWebhookConfig()
    });
    const before = await store.load();

    const response = await fetchJson(
      `${url}/api/openroad/integrations/github/webhook`,
      signedGitHubWebhookRequest(
        gitHubWebhookPayload({
          issue: gitHubIssuePayload({
            node_id: "I_unmapped",
            number: 100,
            title: "Unmapped provider issue"
          })
        }),
        { deliveryId: "delivery-unmapped-issue" }
      )
    );
    const after = await store.load();
    const integrations = await integrationStore.load();

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("ignored");
    expect(after.state.workspaces[0].requests).toHaveLength(before.state.workspaces[0].requests.length);
    expect(integrations.state.syncEvents[0]).toMatchObject({
      deliveryId: "delivery-unmapped-issue",
      result: "ignored"
    });
  });

  it("disconnects GitHub installations from signed installation webhooks without deleting requests", async () => {
    const { integrationStore, store, url } = await startTestServer({
      githubAppConfig: testGitHubWebhookConfig()
    });
    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const beforeWebhook = await integrationStore.load();
    await integrationStore.replaceState({
      ...beforeWebhook.state,
      installations: [
        ...beforeWebhook.state.installations,
        {
          createdAt: "2026-07-04T00:00:00.000Z",
          id: "github-install",
          permissions: ["read:external", "read:openroad", "write:openroad"],
          provider: "linear",
          providerAccountId: "linear-team",
          providerAccountName: "Linear Team",
          status: "active",
          workspaceId: "acme"
        }
      ],
      mappings: [
        ...beforeWebhook.state.mappings,
        {
          connectedAt: "2026-07-04T00:00:00.000Z",
          external: {
            id: "LIN_issue_1",
            key: "LIN-1",
            provider: "linear",
            type: "issue",
            url: "https://linear.app/openroad/issue/LIN-1"
          },
          id: "linear-colliding-installation-id",
          installationId: "github-install",
          openRoad: {
            id: created.body.request.id,
            type: "request",
            workspaceId: "acme"
          },
          status: "active"
        }
      ]
    });

    const response = await fetchJson(
      `${url}/api/openroad/integrations/github/webhook`,
      signedGitHubWebhookRequest(
        gitHubInstallationWebhookPayload({
          action: "deleted",
          installationId: "github-install"
        }),
        {
          deliveryId: "delivery-installation-deleted",
          eventName: "installation"
        }
      )
    );
    const integrations = await integrationStore.load();
    const state = await store.load();
    const request = state.state.workspaces[0].requests.find(
      (item) => item.id === created.body.request.id
    );
    const rejectedImport = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const unsuspend = await fetchJson(
      `${url}/api/openroad/integrations/github/webhook`,
      signedGitHubWebhookRequest(
        gitHubInstallationWebhookPayload({
          action: "unsuspend",
          installationId: "github-install"
        }),
        {
          deliveryId: "delivery-installation-unsuspend-after-disconnect",
          eventName: "installation"
        }
      )
    );
    const afterUnsuspend = await integrationStore.load();
    const githubInstallation = afterUnsuspend.state.installations.find(
      (installation) => installation.provider === "github"
    );
    const linearInstallation = afterUnsuspend.state.installations.find(
      (installation) => installation.provider === "linear"
    );
    const linearMapping = afterUnsuspend.state.mappings.find(
      (mapping) => mapping.external.provider === "linear"
    );

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("synced");
    expect(integrations.state.installations.find((installation) => installation.provider === "github")).toMatchObject({
      id: "github-install",
      status: "disconnected"
    });
    expect(
      integrations.state.mappings
        .filter((mapping) => mapping.external.provider === "github")
        .every((mapping) => mapping.status === "disconnected")
    ).toBe(true);
    expect(linearInstallation).toMatchObject({ provider: "linear", status: "active" });
    expect(linearMapping).toMatchObject({ status: "active" });
    expect(unsuspend.status).toBe(202);
    expect(unsuspend.body.status).toBe("ignored");
    expect(githubInstallation).toMatchObject({ status: "disconnected" });
    expect(request).toBeTruthy();
    expect(rejectedImport.status).toBe(422);
    expect(rejectedImport.body.error.code).toBe("invalid_state");
  });

  it("supports manual GitHub disconnect with owner-only integration management", async () => {
    const { integrationStore, store, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });
    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const maintainerCreated = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/issues/import`,
      {
        body: JSON.stringify(
          gitHubImportPayload({
            issue: gitHubIssuePayload({
              node_id: "I_maintainer",
              number: 101,
              title: "Maintainer workspace issue"
            })
          })
        ),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const viewer = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/github-install/disconnect`,
      {
        headers: workspaceActorHeaders("acme", "Viewer"),
        method: "POST"
      }
    );
    const owner = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/github-install/disconnect`,
      {
        headers: workspaceActorHeaders("acme", "Owner"),
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();
    const state = await store.load();

    expect(created.status).toBe(201);
    expect(maintainerCreated.status).toBe(201);
    expect(viewer.status).toBe(403);
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({
      disconnectedMappings: 2,
      installation: {
        id: "github-install",
        status: "disconnected"
      },
      status: "disconnected"
    });
    expect(integrations.state.installations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "github-install", status: "disconnected", workspaceId: "acme" }),
        expect.objectContaining({ id: "github-install", status: "active", workspaceId: "maintainer" })
      ])
    );
    expect(
      integrations.state.mappings
        .filter((mapping) => mapping.openRoad.workspaceId === "acme")
        .every((mapping) => mapping.status === "disconnected")
    ).toBe(true);
    expect(
      integrations.state.mappings
        .filter((mapping) => mapping.openRoad.workspaceId === "maintainer")
        .every((mapping) => mapping.status === "active")
    ).toBe(true);
    expect(
      state.state.workspaces[0].requests.some((request) => request.id === created.body.request.id)
    ).toBe(true);
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

  it("records public portal votes through a public-only response projection", async () => {
    const { store, url } = await startTestServer();
    const state = createStateWithPrivatePortalData();
    await store.replaceState(state);

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`, {
      body: JSON.stringify({ requester: { id: "visitor-1", name: "Visitor One" } }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const persisted = await store.load();
    const request = persisted.state.workspaces[0].requests.find((item) => item.id === "public-request");

    expect(response.status).toBe(200);
    expect(response.body.request).toMatchObject({
      id: "public-request",
      votes: state.workspaces[0].requests[0].votes + 1
    });
    expect(JSON.stringify(response.body)).not.toContain("Internal comment");
    expect(JSON.stringify(response.body)).not.toContain("Hidden comment");
    expect(JSON.stringify(response.body)).not.toContain("Secret requester");
    expect(request?.votes).toBe(state.workspaces[0].requests[0].votes + 1);
  });

  it("records public portal comments without exposing private comments", async () => {
    const { store, url } = await startTestServer();
    await store.replaceState(createStateWithPrivatePortalData());

    const response = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/comments`,
      {
        body: JSON.stringify({
          body: "This would help our support team.",
          requester: { id: "visitor-2", name: "Customer lead" }
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const persisted = await store.load();
    const request = persisted.state.workspaces[0].requests.find((item) => item.id === "public-request");
    const comment = request?.comments.find((item) => item.body === "This would help our support team.");

    expect(response.status).toBe(201);
    expect(response.body.request.comments).toContainEqual(
      expect.objectContaining({
        author: "Customer lead",
        body: "This would help our support team."
      })
    );
    expect(JSON.stringify(response.body)).not.toContain("Internal comment");
    expect(JSON.stringify(response.body)).not.toContain("Hidden comment");
    expect(comment).toMatchObject({
      author: "Customer lead",
      visibility: "Public"
    });
  });

  it("rejects public portal writes for private, archived, or disabled targets", async () => {
    const { store, url } = await startTestServer();
    const state = createStateWithPrivatePortalData();
    await store.replaceState(state);

    const privateRequest = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/private-request/vote`,
      {
        body: JSON.stringify({ requester: { id: "visitor" } }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );

    await store.replaceState({
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          requests: state.workspaces[0].requests.map((request) =>
            request.id === "public-request" ? { ...request, archived: true } : request
          )
        },
        ...state.workspaces.slice(1)
      ]
    });
    const archivedRequest = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`,
      {
        body: JSON.stringify({ requester: { id: "visitor" } }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );

    await store.replaceState({
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          portal: { ...state.workspaces[0].portal, allowVoting: false }
        },
        ...state.workspaces.slice(1)
      ]
    });
    const disabledVoting = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`,
      {
        body: JSON.stringify({ requester: { id: "visitor" } }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );

    expect(privateRequest.status).toBe(404);
    expect(archivedRequest.status).toBe(404);
    expect(disabledVoting.status).toBe(403);
  });

  it("validates public portal comments and honors disabled commenting", async () => {
    const { store, url } = await startTestServer();
    const state = createStateWithPrivatePortalData();
    await store.replaceState(state);

    const blank = await fetchJson(`${url}/api/openroad/workspaces/acme/portal/requests/public-request/comments`, {
      body: JSON.stringify({ body: "   ", requester: { id: "visitor" } }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const oversized = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/comments`,
      {
        body: JSON.stringify({ body: "x".repeat(1_201), requester: { id: "visitor" } }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );

    await store.replaceState({
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          portal: { ...state.workspaces[0].portal, allowComments: false }
        },
        ...state.workspaces.slice(1)
      ]
    });
    const disabled = await fetchJson(`${url}/api/openroad/workspaces/acme/portal/requests/public-request/comments`, {
      body: JSON.stringify({ body: "Valid but disabled", requester: { id: "visitor" } }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    expect(blank.status).toBe(400);
    expect(blank.body.error.code).toBe("invalid_request");
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.code).toBe("invalid_request");
    expect(disabled.status).toBe(403);
  });

  it("rate limits public portal writes before persistence", async () => {
    const { store, url } = await startTestServer({
      portalRateLimiter: new InMemoryPortalRateLimiter({ maxRequests: 1, windowMs: 60_000 })
    });
    const state = createStateWithPrivatePortalData();
    await store.replaceState(state);
    const vote = {
      body: JSON.stringify({ requester: { id: "visitor-rate-limit" } }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    };

    const first = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`,
      vote
    );
    const second = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`,
      vote
    );
    const persisted = await store.load();
    const request = persisted.state.workspaces[0].requests.find((item) => item.id === "public-request");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("rate_limited");
    expect(request?.votes).toBe(state.workspaces[0].requests[0].votes + 1);
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
        integration: expect.any(String),
        openRoad: expect.any(String),
        team: expect.any(String)
      },
      totals: {
        integrationInstallations: expect.any(Number),
        integrationMappings: expect.any(Number),
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

async function startTestServer(
  options: {
    auth?: AuthOptions;
    githubAppClient?: GitHubAppClient;
    githubAppConfig?: GitHubAppConfig;
    linearOAuthConfig?: LinearOAuthConfig;
    portalRateLimiter?: PortalRateLimiter;
  } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "openroad-server-"));
  const distDir = join(directory, "dist");
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<main>OpenRoad production shell</main>", "utf8");
  await writeFile(join(distDir, "assets", "app.js"), "console.log('asset-loaded')", "utf8");
  await writeFile(join(directory, "secret.txt"), "secret", "utf8");

  const dataFile = join(directory, "state.json");
  const integrationFile = join(directory, "integrations.json");
  const teamFile = join(directory, "team.json");
  const store = new FileOpenRoadStore(dataFile);
  const integrationStore = new FileIntegrationStore(integrationFile);
  const teamStore = new FileTeamStore(teamFile);
  await store.load();
  const server = createOpenRoadServer({
    auth: options.auth,
    distDir,
    githubAppClient: options.githubAppClient,
    githubAppConfig: options.githubAppConfig,
    integrationStore,
    linearOAuthConfig: options.linearOAuthConfig,
    logger: { error: vi.fn(), log: vi.fn() },
    portalRateLimiter: options.portalRateLimiter,
    store,
    teamStore
  });
  const url = await listen(server);
  openServers.push(server);

  return { dataFile, integrationFile, integrationStore, store, teamFile, teamStore, url };
}

function workspaceActorHeaders(workspaceId: string, role: string) {
  return {
    "x-openroad-actor-id": `${workspaceId}-${role.toLowerCase()}`,
    "x-openroad-actor-type": "workspace-member",
    "x-openroad-workspace-id": workspaceId,
    "x-openroad-workspace-role": role
  };
}

function integrationActorHeaders(workspaceId: string, integrationId: string) {
  return {
    "x-openroad-actor-type": "integration",
    "x-openroad-integration-id": integrationId,
    "x-openroad-workspace-id": workspaceId
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

function gitHubImportPayload(overrides: Record<string, unknown> = {}) {
  return {
    installation: {
      accountId: "AkhilTrivediX",
      accountName: "AkhilTrivediX",
      id: "github-install",
      permissions: ["read:external", "read:openroad", "write:openroad"]
    },
    issue: gitHubIssuePayload(),
    pullRequests: [gitHubPullRequestPayload()],
    ...overrides
  };
}

function gitHubIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    body: "Expose GitHub issue context.",
    html_url: "https://github.com/AkhilTrivediX/OpenRoad/issues/42",
    labels: [{ name: "needs-decision" }],
    node_id: "I_kwDOGH123",
    number: 42,
    repository: gitHubRepositoryPayload(),
    state: "open",
    title: "Import GitHub issues",
    user: { login: "akhil" },
    ...overrides
  };
}

function gitHubPullRequestPayload() {
  return {
    html_url: "https://github.com/AkhilTrivediX/OpenRoad/pull/7",
    node_id: "PR_kwDOPR123",
    number: 7,
    repository: gitHubRepositoryPayload(),
    state: "open",
    title: "Implement GitHub import",
    user: { login: "akhil" }
  };
}

function gitHubRepositoryPayload() {
  return {
    full_name: "AkhilTrivediX/OpenRoad",
    html_url: "https://github.com/AkhilTrivediX/OpenRoad",
    name: "OpenRoad",
    node_id: "R_kwDOR123",
    owner: { login: "AkhilTrivediX" },
    private: false
  };
}

function linearImportPayload(overrides: Record<string, unknown> = {}) {
  return {
    installation: {
      accountId: "linear-team",
      accountName: "OpenRoad",
      id: "linear-install",
      permissions: ["read:external", "read:openroad", "write:openroad"]
    },
    issue: linearIssuePayload(),
    ...overrides
  };
}

function linearIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    assignee: { displayName: "Akhil Trivedi", id: "user-akhil" },
    creator: { displayName: "Customer Ops", id: "user-ops" },
    description: "Users want Linear issue context.",
    id: "lin-issue-123",
    identifier: "OPEN-42",
    labels: { nodes: [{ name: "needs-decision" }, { name: "ux" }] },
    priority: 2,
    project: { id: "project-beta", name: "OpenRoad Beta" },
    state: { id: "state-triage", name: "Triage", type: "triage" },
    team: { id: "team-open", key: "OPEN", name: "OpenRoad" },
    title: "Import Linear issues",
    updatedAt: "2026-07-04T00:00:00Z",
    url: "https://linear.app/openroad/issue/OPEN-42/import-linear-issues",
    ...overrides
  };
}

function testLinearOAuthConfig(): LinearOAuthConfig {
  return {
    appBaseUrl: "https://linear.test",
    clientId: "lin_client",
    clientSecret: "linear-secret",
    redirectUri: "https://openroad.test/api/openroad/integrations/linear/oauth/callback"
  };
}

function testGitHubWebhookConfig(): GitHubAppConfig {
  return {
    apiBaseUrl: "https://api.github.test",
    appBaseUrl: "https://github.test",
    webhookSecret: "webhook-secret",
    webhookSecretConfigured: true
  };
}

function signedGitHubWebhookRequest(
  payload: Record<string, unknown>,
  {
    deliveryId = "delivery-1",
    eventName = "issues",
    secret = "webhook-secret",
    signature
  }: {
    deliveryId?: string;
    eventName?: string;
    secret?: string;
    signature?: string;
  } = {}
): RequestInit {
  const body = JSON.stringify(payload);
  const resolvedSignature =
    signature ?? `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": eventName,
      "x-hub-signature-256": resolvedSignature
    },
    method: "POST"
  };
}

function gitHubWebhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "edited",
    installation: { id: "github-install" },
    issue: gitHubIssuePayload(),
    repository: gitHubRepositoryPayload(),
    sender: { login: "akhil" },
    ...overrides
  };
}

function gitHubInstallationWebhookPayload({
  action,
  installationId
}: {
  action: string;
  installationId: string;
}) {
  return {
    action,
    installation: { id: installationId },
    repositories: [gitHubRepositoryPayload()],
    sender: { login: "akhil" }
  };
}

function fakeGitHubAppClient(): GitHubAppClient {
  return {
    async createInstallationAccessToken() {
      return {
        expiresAt: "2026-07-04T01:00:00Z",
        token: "installation-token"
      };
    },
    async getInstallation(installationId: string) {
      return {
        account: {
          id: 118957648,
          login: "AkhilTrivediX",
          type: "User"
        },
        id: installationId,
        permissions: {
          issues: "read",
          pull_requests: "read"
        },
        repository_selection: "selected"
      };
    },
    async listRepositoryIssues() {
      return [
        {
          assignees: ["maintainer"],
          author: "akhil",
          body: "Expose GitHub issue context.",
          createdAt: "2026-07-04T00:00:00Z",
          id: "I_kwDOGH123",
          labels: ["planned"],
          number: 42,
          repository: {
            fullName: "AkhilTrivediX/OpenRoad",
            id: "R_kwDOR123",
            name: "OpenRoad",
            owner: "AkhilTrivediX",
            url: "https://github.com/AkhilTrivediX/OpenRoad",
            visibility: "public"
          },
          state: "open",
          title: "Import GitHub issues",
          updatedAt: "2026-07-04T00:30:00Z",
          url: "https://github.com/AkhilTrivediX/OpenRoad/issues/42"
        }
      ];
    }
  };
}

async function verifyGitHubInstallation(
  url: string,
  workspaceId: string,
  headers: Record<string, string> = {}
) {
  return fetchJson(
    `${url}/api/openroad/workspaces/${workspaceId}/integrations/github/app/installations/verify`,
    {
      body: JSON.stringify({ installationId: "98765" }),
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      method: "POST"
    }
  );
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
