// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInitialOpenRoadState,
  openRoadReducer,
  openRoadSchemaVersion,
  type ChangelogItem,
  type RequestItem,
  type RoadmapItem
} from "../src/domain/openroad";
import { InMemoryPortalRateLimiter, createOpenRoadServer, type PortalRateLimiter } from "./http";
import {
  FileIntegrationStore,
  createIntegrationCredentialSecretContext
} from "./integrations";
import { FileSessionStore, type SessionStore } from "./session-store";
import { FileOpenRoadStore } from "./store";
import { FileTeamStore } from "./team";
import type { AuthOptions } from "./access";
import { GitHubAppClientError, type GitHubAppClient, type GitHubAppConfig } from "./github-app";
import type { JiraApiClient } from "./jira-api";
import type { LinearApiClient } from "./linear-api";
import type { LinearOAuthConfig } from "./linear";
import type { JiraOAuthConfig } from "./jira";
import {
  HttpInvitationDeliveryAdapter,
  type InvitationDeliveryAdapter
} from "./invitation-delivery";
import type { NotificationDeliveryAdapter } from "./notifications";
import { createIntegrationTokenVault, type IntegrationTokenVault } from "./token-vault";
import type { IntegrationSyncWorker } from "./sync-jobs";

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
      apiVersion: "2026-07-05",
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
      apiVersion: "2026-07-05",
      contract: {
        auth: {
          adminTokenConfigured: true,
          sessionCookieEnabled: true,
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

  it("creates and revokes browser owner sessions without exposing token material", async () => {
    const { sessionFile, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false }
    });

    const beforeSession = await fetchJson(`${url}/api/openroad/session`);
    const wrongLogin = await fetchJson(`${url}/api/openroad/auth/login`, {
      body: JSON.stringify({ adminToken: "wrong" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const login = await fetchJson(`${url}/api/openroad/auth/login`, {
      body: JSON.stringify({ adminToken: "secret" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = cookiePair(setCookie);
    const cookieValue = cookie.split("=").slice(1).join("=");
    const rawSessionSecret = decodeURIComponent(cookieValue).split(".")[1];
    const persistedSessions = await readFile(sessionFile, "utf8");
    const stateWithCookie = await fetchJson(`${url}/api/openroad/state`, {
      headers: { Cookie: cookie }
    });
    const sessionWithCookie = await fetchJson(`${url}/api/openroad/session`, {
      headers: { Cookie: cookie }
    });
    const audit = await fetchJson(`${url}/api/openroad/audit-events`, {
      headers: { Authorization: "Bearer secret" }
    });
    const logout = await fetchJson(`${url}/api/openroad/auth/logout`, {
      headers: { Cookie: cookie },
      method: "POST"
    });
    const stateAfterLogout = await fetchJson(`${url}/api/openroad/state`, {
      headers: { Cookie: cookie }
    });
    const bearerStillWorks = await fetchJson(`${url}/api/openroad/state`, {
      headers: { Authorization: "Bearer secret" }
    });

    expect(beforeSession.status).toBe(200);
    expect(beforeSession.body).toMatchObject({
      actor: { type: "public-visitor" },
      authenticated: false,
      loginRequired: true
    });
    expect(wrongLogin.status).toBe(403);
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({
      actor: { source: "session", type: "local-owner" },
      authenticated: true,
      status: "authenticated"
    });
    expect(setCookie).toContain("openroad_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=");
    expect(persistedSessions).not.toContain("secret");
    expect(persistedSessions).not.toContain(rawSessionSecret);
    expect(stateWithCookie.status).toBe(200);
    expect(stateWithCookie.body.state.schemaVersion).toBe(openRoadSchemaVersion);
    expect(sessionWithCookie.body).toMatchObject({
      actor: { source: "session", type: "local-owner" },
      authenticated: true,
      loginRequired: false
    });
    expect(audit.body.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "local-owner",
          actorType: "local-owner",
          type: "auth.login"
        })
      ])
    );
    expect(logout.status).toBe(200);
    expect(logout.body).toMatchObject({
      revoked: true,
      status: "signed_out"
    });
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(stateAfterLogout.status).toBe(403);
    expect(bearerStillWorks.status).toBe(200);
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

  it("rejects broad notification settings replacement over workspace actions", async () => {
    const { url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true }
    });
    const workspace = createInitialOpenRoadState().workspaces[0];

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: {
          notifications: {
            ...workspace.notifications,
            outbox: [
              {
                body: "Untrusted injected delivery body.",
                createdAt: "2026-07-04T00:00:00.000Z",
                dedupeKey: "request-status-change:dark-mode-docs:Planned",
                deliveryAttempts: 0,
                id: "injected-event",
                nextStatus: "Planned",
                previousStatus: "New",
                requestId: "dark-mode-docs",
                requestTitle: "Dark mode for docs site",
                requester: "Docs feedback",
                status: "queued",
                title: "Injected event",
                type: "request-status-change"
              }
            ]
          },
          type: "replace-notification-settings",
          workspaceId: "acme"
        }
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Contributor"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_state");
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

  it("creates and accepts workspace invitations without exposing token hashes", async () => {
    const { teamFile, url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true }
    });

    const publicCreate = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "beta@example.com", role: "Viewer" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const contributorCreate = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "beta@example.com", role: "Viewer" }),
      headers: {
        ...workspaceActorHeaders("acme", "Contributor"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const ownerCreate = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({
        email: "Beta@Example.COM",
        name: "Beta maintainer",
        role: "Maintainer"
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const acceptToken = ownerCreate.body.acceptToken as string;
    const teamStateAfterCreate = await readFile(teamFile, "utf8");
    const ownerList = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      headers: workspaceActorHeaders("acme", "Owner")
    });
    const viewerList = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const accepted = await fetchJson(`${url}/api/openroad/invitations/accept`, {
      body: JSON.stringify({ name: "Beta operator", token: acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const acceptedAgain = await fetchJson(`${url}/api/openroad/invitations/accept`, {
      body: JSON.stringify({ token: acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const audit = await fetchJson(`${url}/api/openroad/audit-events?workspaceId=acme`, {
      headers: workspaceActorHeaders("acme", "Owner")
    });

    expect(publicCreate.status).toBe(403);
    expect(contributorCreate.status).toBe(403);
    expect(ownerCreate.status).toBe(201);
    expect(ownerCreate.body).toMatchObject({
      invitation: {
        email: "beta@example.com",
        role: "Maintainer",
        status: "pending",
        workspaceId: "acme"
      },
      status: "pending"
    });
    expect(acceptToken).toMatch(/^oinv_/);
    expect(JSON.stringify(ownerCreate.body)).not.toContain("tokenHash");
    expect(teamStateAfterCreate).not.toContain(acceptToken);
    expect(teamStateAfterCreate).toContain("tokenHash");
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.invitations[0]).toMatchObject({
      email: "beta@example.com",
      status: "pending"
    });
    expect(JSON.stringify(ownerList.body)).not.toContain("tokenHash");
    expect(viewerList.status).toBe(403);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      createdMembership: true,
      createdUser: true,
      invitation: {
        email: "beta@example.com",
        status: "accepted"
      },
      membership: {
        role: "Maintainer",
        workspaceId: "acme"
      },
      status: "accepted",
      user: {
        email: "beta@example.com",
        name: "Beta operator"
      }
    });
    expect(JSON.stringify(accepted.body)).not.toContain("tokenHash");
    expect(JSON.stringify(accepted.body)).not.toContain(acceptToken);
    expect(acceptedAgain.status).toBe(400);
    expect(acceptedAgain.body.error.code).toBe("invalid_request");
    expect(audit.body.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "team.invitation.create", workspaceId: "acme" }),
        expect.objectContaining({ type: "team.invitation.accept", workspaceId: "acme" })
      ])
    );
    expect(JSON.stringify(audit.body)).not.toContain(acceptToken);
  });

  it("delivers created workspace invitations through a configured adapter", async () => {
    const deliveries: Array<{ acceptToken: string; baseUrl: string; email: string; workspaceName: string }> = [];
    const adapter: InvitationDeliveryAdapter = {
      channel: "test-invite",
      async deliver(invitation, context) {
        deliveries.push({
          acceptToken: context.acceptToken,
          baseUrl: context.baseUrl,
          email: invitation.email,
          workspaceName: context.workspaceName
        });
        return { messageId: `test:${invitation.id}` };
      }
    };
    const { teamFile, url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true },
      invitationDeliveryAdapter: adapter,
      invitationDeliveryPublicBaseUrl: "https://openroad.example.com/join"
    });

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({
        email: "Delivery@Example.COM",
        name: "Delivery User",
        role: "Contributor"
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const acceptToken = created.body.acceptToken as string;
    const teamStateAfterCreate = await readFile(teamFile, "utf8");
    const listed = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      headers: workspaceActorHeaders("acme", "Owner")
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      delivery: {
        channel: "test-invite",
        messageId: expect.stringContaining("test:"),
        status: "sent"
      },
      invitation: {
        deliveryChannel: "test-invite",
        deliveryStatus: "sent",
        email: "delivery@example.com",
        status: "pending"
      }
    });
    expect(deliveries).toEqual([
      {
        acceptToken,
        baseUrl: "https://openroad.example.com/join",
        email: "delivery@example.com",
        workspaceName: "Acme OSS"
      }
    ]);
    expect(listed.body.invitations[0]).toMatchObject({
      deliveryChannel: "test-invite",
      deliveryStatus: "sent",
      email: "delivery@example.com"
    });
    expect(teamStateAfterCreate).not.toContain(acceptToken);
    expect(JSON.stringify(created.body)).not.toContain("tokenHash");
    expect(JSON.stringify(created.body.delivery)).not.toContain(acceptToken);
    expect(JSON.stringify(listed.body)).not.toContain("tokenHash");
  });

  it("delivers invitations through the HTTP provider adapter without exposing provider secrets", async () => {
    const providerRequests: Array<{ body: Record<string, unknown>; headers: IncomingMessage["headers"] }> = [];
    const provider = await createProviderServer(async (request, response) => {
      providerRequests.push({
        body: await readRequestJson(request),
        headers: request.headers
      });
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ messageId: "http-provider-message-1" }));
    });
    const adapter = new HttpInvitationDeliveryAdapter(provider.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });
    const { teamFile, url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true },
      invitationDeliveryAdapter: adapter,
      invitationDeliveryPublicBaseUrl: "https://openroad.example.com/join"
    });

    try {
      const created = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
        body: JSON.stringify({
          email: "Provider@Example.COM",
          name: "Provider User",
          role: "Contributor"
        }),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const acceptToken = created.body.acceptToken as string;
      const teamStateAfterCreate = await readFile(teamFile, "utf8");
      const listed = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
        headers: workspaceActorHeaders("acme", "Owner")
      });
      const audit = await fetchJson(`${url}/api/openroad/audit-events`, {
        headers: workspaceActorHeaders("acme", "Owner")
      });

      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        delivery: {
          channel: "http-provider",
          messageId: "http-provider-message-1",
          status: "sent"
        },
        invitation: {
          deliveryChannel: "http-provider",
          deliveryMessageId: "http-provider-message-1",
          deliveryStatus: "sent",
          email: "provider@example.com",
          status: "pending"
        }
      });
      expect(providerRequests).toHaveLength(1);
      expect(providerRequests[0].headers.authorization).toBe("Bearer provider-secret-token");
      expect(providerRequests[0].body).toMatchObject({
        acceptUrl: `https://openroad.example.com/join?invite=${acceptToken}`,
        email: "provider@example.com",
        role: "Contributor",
        workspaceId: "acme",
        workspaceName: "Acme OSS"
      });
      expect(JSON.stringify(providerRequests[0].body)).not.toContain("acceptToken");
      expect(teamStateAfterCreate).not.toContain(acceptToken);
      expect(teamStateAfterCreate).not.toContain("provider-secret-token");
      expect(JSON.stringify(created.body.delivery)).not.toContain(acceptToken);
      expect(JSON.stringify(created.body)).not.toContain("provider-secret-token");
      expect(JSON.stringify(listed.body)).not.toContain(acceptToken);
      expect(JSON.stringify(audit.body)).not.toContain(acceptToken);
    } finally {
      await provider.close();
    }
  });

  it("keeps HTTP provider invitations pending and unsent when the public app URL is missing", async () => {
    let providerRequests = 0;
    const provider = await createProviderServer((_request, response) => {
      providerRequests += 1;
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ messageId: "should-not-send" }));
    });
    const adapter = new HttpInvitationDeliveryAdapter(provider.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });
    const { teamFile, url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true },
      invitationDeliveryAdapter: adapter
    });

    try {
      const created = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
        body: JSON.stringify({ email: "missing-base@example.com", role: "Viewer" }),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const acceptToken = created.body.acceptToken as string;
      const accepted = await fetchJson(`${url}/api/openroad/invitations/accept`, {
        body: JSON.stringify({ token: acceptToken }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const teamStateAfterCreate = await readFile(teamFile, "utf8");

      expect(created.status).toBe(201);
      expect(providerRequests).toBe(0);
      expect(created.body).toMatchObject({
        delivery: {
          channel: "http-provider",
          status: "failed"
        },
        invitation: {
          deliveryChannel: "http-provider",
          deliveryStatus: "failed",
          email: "missing-base@example.com",
          status: "pending"
        }
      });
      expect(created.body.delivery.error).toContain("OPENROAD_PUBLIC_APP_URL");
      expect(teamStateAfterCreate).not.toContain(acceptToken);
      expect(teamStateAfterCreate).not.toContain("provider-secret-token");
      expect(accepted.status).toBe(200);
      expect(accepted.body.invitation).toMatchObject({
        email: "missing-base@example.com",
        status: "accepted"
      });
    } finally {
      await provider.close();
    }
  });

  it("keeps invitations usable when configured invitation delivery fails", async () => {
    const adapter: InvitationDeliveryAdapter = {
      channel: "failing-invite",
      async deliver() {
        throw new Error(`Provider rejected message secret=${"x".repeat(260)}`);
      }
    };
    const { teamFile, url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true },
      invitationDeliveryAdapter: adapter
    });

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "fallback@example.com", role: "Viewer" }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const acceptToken = created.body.acceptToken as string;
    const accepted = await fetchJson(`${url}/api/openroad/invitations/accept`, {
      body: JSON.stringify({ token: acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const persisted = JSON.parse(await readFile(teamFile, "utf8")) as {
      invitations: Array<{ deliveryError?: string; deliveryStatus?: string }>;
    };

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      delivery: {
        channel: "failing-invite",
        status: "failed"
      },
      invitation: {
        deliveryChannel: "failing-invite",
        deliveryStatus: "failed",
        email: "fallback@example.com",
        status: "pending"
      }
    });
    expect(created.body.delivery.error).not.toContain("x".repeat(80));
    expect(persisted.invitations[0].deliveryError).not.toContain("x".repeat(80));
    expect(accepted.status).toBe(200);
    expect(accepted.body.invitation).toMatchObject({
      email: "fallback@example.com",
      status: "accepted"
    });
  });

  it("creates member browser sessions from accepted invitations", async () => {
    const { sessionFile, teamFile, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });

    const contributorInvite = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({
        email: "member@example.com",
        name: "Member User",
        role: "Contributor"
      }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const contributorToken = contributorInvite.body.acceptToken as string;
    const memberSession = await fetchJson(`${url}/api/openroad/invitations/session`, {
      body: JSON.stringify({ name: "Member User", token: contributorToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const memberCookie = cookiePair(memberSession.headers.get("set-cookie") ?? "");
    const session = await fetchJson(`${url}/api/openroad/session`, {
      headers: { Cookie: memberCookie }
    });
    const fullState = await fetchJson(`${url}/api/openroad/state`, {
      headers: { Cookie: memberCookie }
    });
    const ownWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      headers: { Cookie: memberCookie }
    });
    const otherWorkspace = await fetchJson(`${url}/api/openroad/workspaces/maintainer`, {
      headers: { Cookie: memberCookie }
    });
    const replacedWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      body: JSON.stringify({
        workspace: {
          ...ownWorkspace.body.workspace,
          summary: "Member scoped replacement"
        }
      }),
      headers: { Cookie: memberCookie, "Content-Type": "application/json" },
      method: "PUT"
    });
    const createdRequest = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: {
          request: {
            ...createInitialOpenRoadState().workspaces[0].requests[0],
            id: "member-created-request",
            title: "Member created request"
          },
          type: "create-request",
          workspaceId: "acme"
        }
      }),
      headers: { Cookie: memberCookie, "Content-Type": "application/json" },
      method: "POST"
    });
    const acceptedAgain = await fetchJson(`${url}/api/openroad/invitations/session`, {
      body: JSON.stringify({ token: contributorToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const persistedSessions = await readFile(sessionFile, "utf8");
    const persistedTeam = await readFile(teamFile, "utf8");

    expect(contributorInvite.status).toBe(201);
    expect(memberSession.status).toBe(200);
    expect(memberSession.headers.get("set-cookie")).toContain("openroad_session=");
    expect(memberSession.headers.get("set-cookie")).toContain("HttpOnly");
    expect(memberSession.body).toMatchObject({
      actor: {
        id: "user-member@example.com",
        role: "Contributor",
        type: "workspace-member",
        workspaceId: "acme"
      },
      authenticated: true,
      membership: {
        role: "Contributor",
        workspaceId: "acme"
      },
      status: "authenticated",
      user: {
        email: "member@example.com",
        name: "Member User"
      }
    });
    expect(JSON.stringify(memberSession.body)).not.toContain(contributorToken);
    expect(session.body.actor).toMatchObject({
      role: "Contributor",
      type: "workspace-member",
      workspaceId: "acme"
    });
    expect(fullState.status).toBe(403);
    expect(ownWorkspace.status).toBe(200);
    expect(ownWorkspace.body.workspace.id).toBe("acme");
    expect(otherWorkspace.status).toBe(403);
    expect(replacedWorkspace.status).toBe(200);
    expect(replacedWorkspace.body.workspace.summary).toBe("Member scoped replacement");
    expect(createdRequest.status).toBe(200);
    expect(createdRequest.body.workspace.requests.some((request: { id: string }) => request.id === "member-created-request")).toBe(true);
    expect(acceptedAgain.status).toBe(400);
    expect(persistedSessions).not.toContain(contributorToken);
    expect(persistedSessions).not.toContain(memberCookie.split(".")[1]);
    expect(persistedSessions).toContain('"type": "workspace-member"');
    expect(persistedTeam).not.toContain(contributorToken);
  });

  it("sets account passwords and creates scoped member sessions from password login", async () => {
    const { sessionFile, teamFile, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });
    const invite = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "account@example.com", name: "Account User", role: "Contributor" }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const invitationSession = await fetchJson(`${url}/api/openroad/invitations/session`, {
      body: JSON.stringify({ name: "Account User", token: invite.body.acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const invitationCookie = cookiePair(invitationSession.headers.get("set-cookie") ?? "");

    const deniedSet = await fetchJson(`${url}/api/openroad/account/password`, {
      body: JSON.stringify({ password: "member password value" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const passwordSet = await fetchJson(`${url}/api/openroad/account/password`, {
      body: JSON.stringify({ password: "member password value" }),
      headers: { Cookie: invitationCookie, "Content-Type": "application/json" },
      method: "POST"
    });
    const wrongPassword = await fetchJson(`${url}/api/openroad/auth/password/login`, {
      body: JSON.stringify({ email: "account@example.com", password: "wrong password value" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const passwordLogin = await fetchJson(`${url}/api/openroad/auth/password/login`, {
      body: JSON.stringify({ email: "ACCOUNT@example.com", password: "member password value" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const passwordCookie = cookiePair(passwordLogin.headers.get("set-cookie") ?? "");
    const fullState = await fetchJson(`${url}/api/openroad/state`, {
      headers: { Cookie: passwordCookie }
    });
    const ownWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      headers: { Cookie: passwordCookie }
    });
    const createdRequest = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: {
          request: {
            ...createInitialOpenRoadState().workspaces[0].requests[0],
            id: "password-login-request",
            title: "Password login request"
          },
          type: "create-request",
          workspaceId: "acme"
        }
      }),
      headers: { Cookie: passwordCookie, "Content-Type": "application/json" },
      method: "POST"
    });
    const persistedTeam = await readFile(teamFile, "utf8");
    const persistedSessions = await readFile(sessionFile, "utf8");

    expect(deniedSet.status).toBe(403);
    expect(passwordSet.status).toBe(200);
    expect(passwordSet.body).toMatchObject({
      credential: { userId: "user-account@example.com" },
      status: "password_set",
      user: { email: "account@example.com" }
    });
    expect(JSON.stringify(passwordSet.body)).not.toContain("passwordHash");
    expect(wrongPassword.status).toBe(400);
    expect(wrongPassword.body.error.message).toBe("Email or password is invalid.");
    expect(passwordLogin.status).toBe(200);
    expect(passwordLogin.headers.get("set-cookie")).toContain("HttpOnly");
    expect(passwordLogin.body).toMatchObject({
      actor: {
        role: "Contributor",
        type: "workspace-member",
        workspaceId: "acme"
      },
      authenticated: true,
      status: "authenticated",
      user: { email: "account@example.com" }
    });
    expect(fullState.status).toBe(403);
    expect(ownWorkspace.status).toBe(200);
    expect(createdRequest.status).toBe(200);
    expect(persistedTeam).toContain('"credentials"');
    expect(persistedTeam).not.toContain("member password value");
    expect(persistedSessions).not.toContain("member password value");
  });

  it("requires a workspace for password login when the account has multiple memberships", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false }
    });

    const setOwnerPassword = await fetchJson(`${url}/api/openroad/account/password`, {
      body: JSON.stringify({ password: "owner password value" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const ambiguous = await fetchJson(`${url}/api/openroad/auth/password/login`, {
      body: JSON.stringify({ email: "owner@openroad.local", password: "owner password value" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const scoped = await fetchJson(`${url}/api/openroad/auth/password/login`, {
      body: JSON.stringify({
        email: "owner@openroad.local",
        password: "owner password value",
        workspaceId: "maintainer"
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    expect(setOwnerPassword.status).toBe(200);
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error.message).toBe("Workspace id is required for this account.");
    expect(scoped.status).toBe(200);
    expect(scoped.body.actor).toMatchObject({
      role: "Owner",
      type: "workspace-member",
      workspaceId: "maintainer"
    });
  });

  it("manages workspace members with owner-only access and secret-free responses", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });
    const invite = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "managed@example.com", name: "Managed User", role: "Contributor" }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const memberSession = await fetchJson(`${url}/api/openroad/invitations/session`, {
      body: JSON.stringify({ name: "Managed User", token: invite.body.acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const memberCookie = cookiePair(memberSession.headers.get("set-cookie") ?? "");
    await fetchJson(`${url}/api/openroad/account/password`, {
      body: JSON.stringify({ password: "managed password value" }),
      headers: { Cookie: memberCookie, "Content-Type": "application/json" },
      method: "POST"
    });

    const ownerList = await fetchJson(`${url}/api/openroad/workspaces/acme/members`, {
      headers: workspaceActorHeaders("acme", "Owner")
    });
    const maintainerList = await fetchJson(`${url}/api/openroad/workspaces/acme/members`, {
      headers: workspaceActorHeaders("acme", "Maintainer")
    });
    const memberList = await fetchJson(`${url}/api/openroad/workspaces/acme/members`, {
      headers: { Cookie: memberCookie }
    });
    const crossWorkspaceList = await fetchJson(`${url}/api/openroad/workspaces/acme/members`, {
      headers: workspaceActorHeaders("maintainer", "Owner")
    });
    const responseText = JSON.stringify(ownerList.body);

    expect(invite.status).toBe(201);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountPasswordSet: true,
          email: "managed@example.com",
          isLocalOwner: false,
          name: "Managed User",
          role: "Contributor",
          workspaceId: "acme"
        }),
        expect.objectContaining({
          accountPasswordSet: false,
          email: "owner@openroad.local",
          isLocalOwner: true,
          role: "Owner",
          userId: "local-owner"
        })
      ])
    );
    expect(responseText).not.toContain("passwordHash");
    expect(responseText).not.toContain("salt");
    expect(responseText).not.toContain("managed password value");
    expect(responseText).not.toContain("tokenHash");
    expect(maintainerList.status).toBe(403);
    expect(memberList.status).toBe(403);
    expect(crossWorkspaceList.status).toBe(403);
  });

  it("updates member roles, revokes stale sessions, and deactivates memberships", async () => {
    const { teamFile, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });
    const invite = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "managed-role@example.com", name: "Managed Role", role: "Contributor" }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const invitationSession = await fetchJson(`${url}/api/openroad/invitations/session`, {
      body: JSON.stringify({ name: "Managed Role", token: invite.body.acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const invitationCookie = cookiePair(invitationSession.headers.get("set-cookie") ?? "");
    await fetchJson(`${url}/api/openroad/account/password`, {
      body: JSON.stringify({ password: "managed role password" }),
      headers: { Cookie: invitationCookie, "Content-Type": "application/json" },
      method: "POST"
    });
    const passwordLogin = await fetchJson(`${url}/api/openroad/auth/password/login`, {
      body: JSON.stringify({ email: "managed-role@example.com", password: "managed role password" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const passwordCookie = cookiePair(passwordLogin.headers.get("set-cookie") ?? "");
    const members = await fetchJson(`${url}/api/openroad/workspaces/acme/members`, {
      headers: workspaceActorHeaders("acme", "Owner")
    });
    const managedMember = (members.body.members as Array<{ email: string; id: string }>).find(
      (member) => member.email === "managed-role@example.com"
    );

    const roleUpdate = await fetchJson(
      `${url}/api/openroad/workspaces/acme/members/${encodeURIComponent(managedMember?.id ?? "")}`,
      {
        body: JSON.stringify({ role: "Viewer" }),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );
    const staleRead = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      headers: { Cookie: passwordCookie }
    });
    const viewerLogin = await fetchJson(`${url}/api/openroad/auth/password/login`, {
      body: JSON.stringify({ email: "managed-role@example.com", password: "managed role password" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const viewerCookie = cookiePair(viewerLogin.headers.get("set-cookie") ?? "");
    const viewerWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: {
          request: {
            ...createInitialOpenRoadState().workspaces[0].requests[0],
            id: "viewer-after-role-update",
            title: "Viewer after role update"
          },
          type: "create-request",
          workspaceId: "acme"
        }
      }),
      headers: { Cookie: viewerCookie, "Content-Type": "application/json" },
      method: "POST"
    });
    const deactivated = await fetchJson(
      `${url}/api/openroad/workspaces/acme/members/${encodeURIComponent(managedMember?.id ?? "")}/deactivate`,
      {
        headers: workspaceActorHeaders("acme", "Owner"),
        method: "POST"
      }
    );
    const deactivatedRead = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      headers: { Cookie: viewerCookie }
    });
    const removedLogin = await fetchJson(`${url}/api/openroad/auth/password/login`, {
      body: JSON.stringify({ email: "managed-role@example.com", password: "managed role password" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const persistedTeam = await readFile(teamFile, "utf8");

    expect(passwordLogin.status).toBe(200);
    expect(roleUpdate.status).toBe(200);
    expect(roleUpdate.body).toMatchObject({
      member: {
        email: "managed-role@example.com",
        role: "Viewer"
      },
      status: "updated"
    });
    expect(roleUpdate.body.revokedSessions).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(roleUpdate.body)).not.toContain("passwordHash");
    expect(staleRead.status).toBe(403);
    expect(viewerLogin.status).toBe(200);
    expect(viewerLogin.body.actor).toMatchObject({ role: "Viewer" });
    expect(viewerWrite.status).toBe(403);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({
      member: {
        accountPasswordSet: true,
        email: "managed-role@example.com",
        role: "Viewer"
      },
      status: "deactivated"
    });
    expect(deactivated.body.revokedSessions).toBeGreaterThanOrEqual(1);
    expect(deactivatedRead.status).toBe(403);
    expect(removedLogin.status).toBe(400);
    expect(persistedTeam).toContain('"email": "managed-role@example.com"');
    expect(persistedTeam).toContain('"credentials"');
    expect(persistedTeam).not.toContain("managed role password");
  });

  it("blocks unsafe member mutations for the local owner membership", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });

    const demoteLocalOwner = await fetchJson(
      `${url}/api/openroad/workspaces/acme/members/membership-local-owner-acme`,
      {
        body: JSON.stringify({ role: "Viewer" }),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );
    const deactivateLocalOwner = await fetchJson(
      `${url}/api/openroad/workspaces/acme/members/membership-local-owner-acme/deactivate`,
      {
        headers: workspaceActorHeaders("acme", "Owner"),
        method: "POST"
      }
    );

    expect(demoteLocalOwner.status).toBe(400);
    expect(demoteLocalOwner.body.error.message).toBe(
      "The local owner membership role cannot be changed."
    );
    expect(deactivateLocalOwner.status).toBe(400);
    expect(deactivateLocalOwner.body.error.message).toBe(
      "The local owner membership cannot be deactivated."
    );
  });

  it("prevents viewer member sessions from writing workspace data", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });

    const viewerInvite = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "viewer-session@example.com", role: "Viewer" }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const viewerSession = await fetchJson(`${url}/api/openroad/invitations/session`, {
      body: JSON.stringify({ token: viewerInvite.body.acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const viewerCookie = cookiePair(viewerSession.headers.get("set-cookie") ?? "");
    const readWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      headers: { Cookie: viewerCookie }
    });
    const writeWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme/actions`, {
      body: JSON.stringify({
        action: {
          request: {
            ...createInitialOpenRoadState().workspaces[0].requests[0],
            id: "viewer-created-request",
            title: "Viewer created request"
          },
          type: "create-request",
          workspaceId: "acme"
        }
      }),
      headers: { Cookie: viewerCookie, "Content-Type": "application/json" },
      method: "POST"
    });
    const replaceWorkspace = await fetchJson(`${url}/api/openroad/workspaces/acme`, {
      body: JSON.stringify({
        workspace: {
          ...readWorkspace.body.workspace,
          summary: "Viewer replacement"
        }
      }),
      headers: { Cookie: viewerCookie, "Content-Type": "application/json" },
      method: "PUT"
    });

    expect(viewerInvite.status).toBe(201);
    expect(viewerSession.status).toBe(200);
    expect(readWorkspace.status).toBe(200);
    expect(writeWorkspace.status).toBe(403);
    expect(replaceWorkspace.status).toBe(403);
  });

  it("revokes pending invitations without creating memberships", async () => {
    const { teamFile, url } = await startTestServer({
      auth: { singleUserMode: false, trustProxyHeaders: true }
    });

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/invitations`, {
      body: JSON.stringify({ email: "viewer@example.com", role: "Viewer" }),
      headers: {
        ...workspaceActorHeaders("acme", "Owner"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const invitationId = created.body.invitation.id as string;
    const acceptToken = created.body.acceptToken as string;
    const viewerRevoke = await fetchJson(
      `${url}/api/openroad/workspaces/acme/invitations/${encodeURIComponent(invitationId)}/revoke`,
      {
        headers: workspaceActorHeaders("acme", "Viewer"),
        method: "POST"
      }
    );
    const ownerRevoke = await fetchJson(
      `${url}/api/openroad/workspaces/acme/invitations/${encodeURIComponent(invitationId)}/revoke`,
      {
        headers: workspaceActorHeaders("acme", "Owner"),
        method: "POST"
      }
    );
    const accepted = await fetchJson(`${url}/api/openroad/invitations/accept`, {
      body: JSON.stringify({ token: acceptToken }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const teamState = JSON.parse(await readFile(teamFile, "utf8")) as {
      memberships: Array<{ userId: string }>;
      users: Array<{ email: string }>;
    };

    expect(created.status).toBe(201);
    expect(viewerRevoke.status).toBe(403);
    expect(ownerRevoke.status).toBe(200);
    expect(ownerRevoke.body).toMatchObject({
      invitation: {
        email: "viewer@example.com",
        status: "revoked"
      },
      status: "revoked"
    });
    expect(JSON.stringify(ownerRevoke.body)).not.toContain("tokenHash");
    expect(accepted.status).toBe(400);
    expect(teamState.users.some((user) => user.email === "viewer@example.com")).toBe(false);
    expect(teamState.memberships.some((membership) => membership.userId.includes("viewer"))).toBe(false);
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

  it("stores, lists, and revokes provider credentials without exposing secrets", async () => {
    const tokenVault = testTokenVault();
    const { integrationFile, teamFile, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      tokenVault
    });

    const imported = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const publicList = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials`
    );
    const viewerCreate = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: {
          ...workspaceActorHeaders("acme", "Viewer"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationCreate = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: {
          ...integrationActorHeaders("acme", "github:github-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const ownerCreate = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const ownerList = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        headers: workspaceActorHeaders("acme", "Owner")
      }
    );
    const createText = JSON.stringify(ownerCreate.body);
    const listText = JSON.stringify(ownerList.body);
    const integrationStateText = await readFile(integrationFile, "utf8");
    const teamStateText = await readFile(teamFile, "utf8");
    const integrationState = JSON.parse(integrationStateText) as {
      credentials: Array<{
        encryptedSecret?: unknown;
        id: string;
        status: string;
      }>;
    };
    const persistedCredential = integrationState.credentials[0];
    const openedSecret = tokenVault.open(persistedCredential.encryptedSecret as any, {
      associatedData: createIntegrationCredentialSecretContext({
        ...ownerCreate.body.credential,
        id: persistedCredential.id
      })
    });
    const revoked = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials/${encodeURIComponent(
        ownerCreate.body.credential.id
      )}/revoke`,
      {
        headers: workspaceActorHeaders("acme", "Owner"),
        method: "POST"
      }
    );
    const revokedState = JSON.parse(await readFile(integrationFile, "utf8")) as {
      credentials: Array<{ encryptedSecret?: unknown; status: string }>;
    };

    expect(imported.status).toBe(201);
    expect(publicList.status).toBe(403);
    expect(viewerCreate.status).toBe(403);
    expect(integrationCreate.status).toBe(403);
    expect(ownerCreate.status).toBe(201);
    expect(ownerCreate.body).toMatchObject({
      credential: {
        installationId: "github-install",
        permissions: ["read:external"],
        provider: "github",
        providerScopes: ["repo", "issues:read"],
        secretTypes: ["access-token", "refresh-token"],
        status: "active",
        workspaceId: "acme"
      },
      status: "stored"
    });
    expect(ownerCreate.body.credential.encryptedSecret).toBeUndefined();
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.credentials).toHaveLength(1);
    expect(createText).not.toContain("github-access-secret");
    expect(createText).not.toContain("github-refresh-secret");
    expect(createText).not.toContain("ciphertext");
    expect(listText).not.toContain("github-access-secret");
    expect(listText).not.toContain("github-refresh-secret");
    expect(listText).not.toContain("ciphertext");
    expect(integrationStateText).not.toContain("github-access-secret");
    expect(integrationStateText).not.toContain("github-refresh-secret");
    expect(teamStateText).not.toContain("github-access-secret");
    expect(openedSecret).toEqual({
      accessToken: "github-access-secret",
      refreshToken: "github-refresh-secret"
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.credential).toMatchObject({ status: "revoked" });
    expect(JSON.stringify(revoked.body)).not.toContain("ciphertext");
    expect(revokedState.credentials[0]).toMatchObject({ status: "revoked" });
    expect(revokedState.credentials[0].encryptedSecret).toBeUndefined();
  });

  it("keeps credential storage configuration-gated and installation-scoped", async () => {
    const disabled = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      tokenVault: { reason: "Token vault disabled for test.", status: "not_configured" }
    });
    await fetchJson(`${disabled.url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    const notConfigured = await fetchJson(
      `${disabled.url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const configured = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      tokenVault: testTokenVault()
    });
    await fetchJson(`${configured.url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const missingInstallation = await fetchJson(
      `${configured.url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload({ installationId: "missing" })),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const overScoped = await fetchJson(
      `${configured.url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload({ permissions: ["write:external"] })),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const beforeDisconnect = await configured.integrationStore.load();
    await configured.integrationStore.replaceState({
      ...beforeDisconnect.state,
      installations: beforeDisconnect.state.installations.map((installation) => ({
        ...installation,
        status: "disconnected" as const
      }))
    });
    const disconnected = await fetchJson(
      `${configured.url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    expect(notConfigured.status).toBe(503);
    expect(notConfigured.body.error.code).toBe("not_configured");
    expect(missingInstallation.status).toBe(404);
    expect(overScoped.status).toBe(400);
    expect(disconnected.status).toBe(422);
    expect(disconnected.body.error.code).toBe("invalid_state");
  });

  it("revokes matching provider credentials when GitHub installations disconnect", async () => {
    const { integrationStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      tokenVault: testTokenVault()
    });

    const acmeImport = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const maintainerImport = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/issues/import`,
      {
        body: JSON.stringify(
          gitHubImportPayload({
            issue: gitHubIssuePayload({
              node_id: "I_maintainer_credentials",
              number: 102,
              title: "Maintainer credential issue"
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
    const acmeCredential = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const maintainerCredential = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const disconnected = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/app/installations/github-install/disconnect`,
      {
        headers: workspaceActorHeaders("acme", "Owner"),
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();
    const acmeStoredCredential = integrations.state.credentials.find(
      (credential) => credential.id === acmeCredential.body.credential.id
    );
    const maintainerStoredCredential = integrations.state.credentials.find(
      (credential) => credential.id === maintainerCredential.body.credential.id
    );

    expect(acmeImport.status).toBe(201);
    expect(maintainerImport.status).toBe(201);
    expect(acmeCredential.status).toBe(201);
    expect(maintainerCredential.status).toBe(201);
    expect(disconnected.status).toBe(200);
    expect(disconnected.body).toMatchObject({
      revokedCredentials: 1,
      status: "disconnected"
    });
    expect(acmeStoredCredential).toMatchObject({ status: "revoked", workspaceId: "acme" });
    expect(acmeStoredCredential?.encryptedSecret).toBeUndefined();
    expect(maintainerStoredCredential).toMatchObject({
      status: "active",
      workspaceId: "maintainer"
    });
    expect(maintainerStoredCredential?.encryptedSecret).toBeTruthy();
  });

  it("queues integration sync jobs with owner-only management and dedupe", async () => {
    const { integrationStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      tokenVault: testTokenVault()
    });

    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    const publicEnqueue = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`,
      {
        body: JSON.stringify({ installationId: "github-install" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const viewerEnqueue = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`,
      {
        body: JSON.stringify({ installationId: "github-install" }),
        headers: {
          ...workspaceActorHeaders("acme", "Viewer"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const ownerEnqueue = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`,
      {
        body: JSON.stringify({ installationId: "github-install", reason: "manual" }),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const duplicate = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`,
      {
        body: JSON.stringify({ installationId: "github-install", reason: "manual" }),
        headers: {
          ...workspaceActorHeaders("acme", "Owner"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();
    const responseText = JSON.stringify(ownerEnqueue.body);

    expect(publicEnqueue.status).toBe(403);
    expect(viewerEnqueue.status).toBe(403);
    expect(ownerEnqueue.status).toBe(201);
    expect(ownerEnqueue.body).toMatchObject({
      job: {
        attempt: 0,
        installationId: "github-install",
        provider: "github",
        reason: "manual",
        status: "queued",
        workspaceId: "acme"
      },
      status: "queued"
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({
      job: {
        id: ownerEnqueue.body.job.id,
        status: "queued"
      },
      status: "deduped"
    });
    expect(integrations.state.syncJobs).toHaveLength(1);
    expect(responseText).not.toContain("ciphertext");
    expect(responseText).not.toContain("github-access-secret");
  });

  it("serializes concurrent integration sync job enqueues without dropping jobs", async () => {
    const { integrationStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true }
    });

    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    const [manual, scheduled] = await Promise.all([
      fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
        body: JSON.stringify({ installationId: "github-install", reason: "manual" }),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }),
      fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
        body: JSON.stringify({ installationId: "github-install", reason: "scheduled" }),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    ]);
    const integrations = await integrationStore.load();

    expect([manual.status, scheduled.status].sort()).toEqual([201, 201]);
    expect(integrations.state.syncJobs).toHaveLength(2);
    expect(integrations.state.syncJobs.map((job) => job.reason).sort()).toEqual(["manual", "scheduled"]);
  });

  it("returns sanitized workspace integration status for settings", async () => {
    const worker: IntegrationSyncWorker = {
      async process() {
        return { kind: "success", summary: "Worker synced installation." };
      }
    };
    const { integrationStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      githubAppConfig: completeGitHubAppConfig(),
      integrationSyncWorker: worker
    });

    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const queued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
      body: JSON.stringify({ installationId: "github-install", reason: "manual" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const current = await integrationStore.load();
    await integrationStore.replaceState({
      ...current.state,
      syncJobs: current.state.syncJobs.map((job) =>
        job.id === queued.body.job.id
          ? {
              ...job,
              error: "Bearer raw-token-should-not-leak",
              resultSummary: "access_token=raw-secret",
              status: "failed"
            }
          : job
      )
    });

    const publicStatus = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/status`
    );
    const acmeStatus = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/status`,
      {
        headers: workspaceActorHeaders("acme", "Viewer")
      }
    );
    const maintainerStatus = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/status`,
      {
        headers: workspaceActorHeaders("maintainer", "Viewer")
      }
    );
    const github = acmeStatus.body.providers.find(
      (provider: { provider: string }) => provider.provider === "github"
    );
    const maintainerGithub = maintainerStatus.body.providers.find(
      (provider: { provider: string }) => provider.provider === "github"
    );
    const responseText = JSON.stringify(acmeStatus.body);

    expect(publicStatus.status).toBe(403);
    expect(acmeStatus.status).toBe(200);
    expect(github).toMatchObject({
      activeInstallations: 1,
      capabilities: {
        manualSync: true
      },
      connection: "connected",
      linkedIssueMappings: 1,
      provider: "github",
      recentJobs: [
        {
          error: "Bearer [redacted]",
          status: "failed"
        }
      ],
      syncWorkerConfigured: true
    });
    expect(maintainerStatus.status).toBe(200);
    expect(maintainerGithub).toMatchObject({
      activeInstallations: 0,
      linkedIssueMappings: 0
    });
    expect(responseText).not.toContain("raw-token-should-not-leak");
    expect(responseText).not.toContain("raw-secret");
    expect(responseText).not.toContain("encryptedSecret");
    expect(responseText).not.toContain("github-access-secret");
  });

  it("runs integration sync jobs through a private configured worker", async () => {
    const noWorker = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      githubAppConfig: incompleteGitHubAppConfig()
    });
    const notConfigured = await fetchJson(`${noWorker.url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({}),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const workerResults: IntegrationSyncWorker["process"][] = [];
    const processedJobIds: string[] = [];
    const worker: IntegrationSyncWorker = {
      async process(job) {
        processedJobIds.push(job.id);
        const next = workerResults.shift();
        if (next) return next(job);
        return { kind: "success", summary: "Worker synced installation." };
      }
    };
    const { integrationStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      integrationSyncWorker: worker
    });

    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const queued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
      body: JSON.stringify({ installationId: "github-install" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const publicRun = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const firstRun = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const repeated = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    workerResults.push(async () => ({
      error: "Provider rate limit token=github-access-secret",
      kind: "retryable-error",
      retryAfterSeconds: 60
    }));
    const retryQueued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
      body: JSON.stringify({ installationId: "github-install", reason: "scheduled" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const retryRun = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    workerResults.push(async () => {
      throw new Error("github-access-secret leaked from provider client");
    });
    const thrownQueued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
      body: JSON.stringify({ installationId: "github-install", reason: "webhook" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const thrownRun = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const integrations = await integrationStore.load();
    const succeeded = integrations.state.syncJobs.find((job) => job.id === queued.body.job.id);
    const retryable = integrations.state.syncJobs.find((job) => job.id === retryQueued.body.job.id);
    const thrown = integrations.state.syncJobs.find((job) => job.id === thrownQueued.body.job.id);

    expect(notConfigured.status).toBe(503);
    expect(publicRun.status).toBe(403);
    expect(firstRun.status).toBe(200);
    expect(firstRun.body).toMatchObject({
      claimed: 1,
      processed: [{ id: queued.body.job.id, kind: "success", status: "succeeded" }],
      status: "processed"
    });
    expect(repeated.body).toMatchObject({ claimed: 0, remainingQueued: 0 });
    expect(retryRun.body).toMatchObject({
      claimed: 1,
      remainingQueued: 1,
      status: "processed"
    });
    expect(thrownRun.body).toMatchObject({
      claimed: 1,
      status: "processed"
    });
    expect(processedJobIds).toEqual([queued.body.job.id, retryQueued.body.job.id, thrownQueued.body.job.id]);
    expect(succeeded).toMatchObject({ status: "succeeded" });
    expect(retryable).toMatchObject({
      attempt: 1,
      reason: "retry",
      status: "queued"
    });
    expect(retryable?.error).toContain("[redacted]");
    expect(thrown).toMatchObject({
      error: "Integration sync worker failed.",
      reason: "retry",
      status: "queued"
    });
    expect(retryable?.nextRunAt).toBeTruthy();
    expect(JSON.stringify(retryRun.body)).not.toContain("ciphertext");
    expect(JSON.stringify(retryable)).not.toContain("github-access-secret");
    expect(JSON.stringify(thrownRun.body)).not.toContain("github-access-secret");
    expect(JSON.stringify(thrown)).not.toContain("github-access-secret");
  });

  it("auto-configures the GitHub sync worker when GitHub App config is complete", async () => {
    const githubIssueFetches: Parameters<GitHubAppClient["getRepositoryIssue"]>[0][] = [];
    const { integrationStore, store, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      githubAppClient: {
        ...fakeGitHubAppClient(),
        async getRepositoryIssue(options) {
          githubIssueFetches.push(options);
          return {
            ...(await fakeGitHubAppClient().getRepositoryIssue(options)),
            labels: ["planned"],
            title: "Updated from live GitHub"
          };
        }
      },
      githubAppConfig: completeGitHubAppConfig()
    });

    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(
        gitHubImportPayload({
          issue: gitHubIssuePayload({ title: "Original imported title" })
        })
      ),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const queued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
      body: JSON.stringify({ installationId: "github-install", reason: "manual" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const run = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const request = openRoad.state.workspaces[0].requests.find(
      (item) => item.id === "github-akhiltrivedix-openroad-42"
    );
    const issueMapping = integrations.state.mappings.find((mapping) => mapping.external.type === "issue");
    const syncJob = integrations.state.syncJobs.find((job) => job.id === queued.body.job.id);

    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      claimed: 1,
      processed: [{ id: queued.body.job.id, kind: "success", status: "succeeded" }],
      status: "processed"
    });
    expect(githubIssueFetches).toEqual([
      {
        installationId: "github-install",
        issueNumber: 42,
        owner: "AkhilTrivediX",
        repo: "OpenRoad"
      }
    ]);
    expect(request?.title).toBe("Updated from live GitHub");
    expect(issueMapping?.lastSyncedAt).toBeTruthy();
    expect(syncJob).toMatchObject({ status: "succeeded" });
    expect(JSON.stringify(run.body)).not.toContain("installation-token");
  });

  it("auto-configures the Linear sync worker when the token vault and credentials are ready", async () => {
    const linearIssueFetches: Array<{ issueId: string; token: string }> = [];
    const tokenVault = testTokenVault();
    const { integrationStore, store, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      linearApiClient: {
        async getIssue(options) {
          linearIssueFetches.push({
            issueId: options.issueId,
            token: options.credential.accessToken
          });
          return {
            assignee: "Akhil Trivedi",
            body: "Updated by live Linear sync.",
            creator: "Customer Ops",
            id: "lin-issue-123",
            identifier: "OPEN-42",
            labels: ["planned"],
            project: "OpenRoad Beta",
            state: { id: "state-started", name: "Started", type: "started" },
            team: { id: "team-open", key: "OPEN", name: "OpenRoad" },
            title: "Updated from live Linear",
            updatedAt: "2026-07-04T01:00:00Z",
            url: "https://linear.app/openroad/issue/OPEN-42/import-linear-issues"
          };
        }
      },
      tokenVault
    });

    const imported = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/issues/import`, {
      body: JSON.stringify(
        linearImportPayload({
          issue: linearIssuePayload({ title: "Original Linear title" })
        })
      ),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/credentials`, {
      body: JSON.stringify(linearCredentialPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const statusBefore = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/status`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const queued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/linear/sync/jobs`, {
      body: JSON.stringify({ installationId: "linear-install", reason: "manual" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const run = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, provider: "linear", workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const statusAfter = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/status`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const request = openRoad.state.workspaces[0].requests.find(
      (item) => item.id === imported.body.request.id
    );
    const issueMapping = integrations.state.mappings.find((mapping) => mapping.external.provider === "linear");
    const syncJob = integrations.state.syncJobs.find((job) => job.id === queued.body.job.id);
    const linearBefore = statusBefore.body.providers.find(
      (provider: { provider: string }) => provider.provider === "linear"
    );
    const linearAfter = statusAfter.body.providers.find(
      (provider: { provider: string }) => provider.provider === "linear"
    );
    const responseText = JSON.stringify([run.body, statusAfter.body]);

    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      claimed: 1,
      processed: [{ id: queued.body.job.id, kind: "success", status: "succeeded" }],
      status: "processed"
    });
    expect(linearBefore).toMatchObject({
      activeCredentials: 1,
      capabilities: {
        manualSync: true
      },
      syncWorkerConfigured: true
    });
    expect(linearAfter).toMatchObject({
      lastJobStatus: "succeeded",
      linkedIssueMappings: 1,
      syncWorkerConfigured: true
    });
    expect(linearIssueFetches).toEqual([{ issueId: "lin-issue-123", token: "linear-access-secret" }]);
    expect(request?.title).toBe("Updated from live Linear");
    expect(issueMapping?.lastSyncedAt).toBeTruthy();
    expect(syncJob).toMatchObject({ status: "succeeded" });
    expect(responseText).not.toContain("linear-access-secret");
    expect(responseText).not.toContain("ciphertext");
  });

  it("auto-configures the Jira sync worker when the token vault and credentials are ready", async () => {
    const jiraIssueFetches: Array<{ cloudId: string; issueIdOrKey: string; token: string }> = [];
    const tokenVault = testTokenVault();
    const { integrationStore, store, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      jiraApiClient: {
        async getIssue(options) {
          jiraIssueFetches.push({
            cloudId: options.cloudId,
            issueIdOrKey: options.issueIdOrKey,
            token: options.credential.accessToken
          });
          return {
            assignee: "Akhil Trivedi",
            body: "Updated by live Jira sync.",
            cloudId: "jira-cloud",
            id: "10042",
            issueType: "Story",
            key: "OPEN-42",
            labels: ["planned"],
            priority: "High",
            project: { id: "project-open", key: "OPEN", name: "OpenRoad" },
            reporter: "Customer Ops",
            self: "https://api.atlassian.com/ex/jira/jira-cloud/rest/api/2/issue/10042",
            status: { category: { key: "indeterminate", name: "In Progress" }, id: "4", name: "In Progress" },
            title: "Updated from live Jira",
            updatedAt: "2026-07-04T01:00:00.000+0000",
            url: "https://openroad.atlassian.net/browse/OPEN-42"
          };
        }
      },
      tokenVault
    });

    const imported = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(
        jiraImportPayload({
          issue: jiraIssuePayload({
            fields: jiraFieldsPayload({ summary: "Original Jira title" }),
            self: "https://api.atlassian.com/ex/jira/jira-cloud/rest/api/3/issue/10042"
          })
        })
      ),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/credentials`, {
      body: JSON.stringify(jiraCredentialPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const statusBefore = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/status`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const queued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/sync/jobs`, {
      body: JSON.stringify({ installationId: "jira-install-jira-cloud", reason: "manual" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const run = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, provider: "jira", workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const statusAfter = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/status`, {
      headers: workspaceActorHeaders("acme", "Viewer")
    });
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const request = openRoad.state.workspaces[0].requests.find(
      (item) => item.id === imported.body.request.id
    );
    const issueMapping = integrations.state.mappings.find((mapping) => mapping.external.provider === "jira");
    const syncJob = integrations.state.syncJobs.find((job) => job.id === queued.body.job.id);
    const jiraBefore = statusBefore.body.providers.find(
      (provider: { provider: string }) => provider.provider === "jira"
    );
    const jiraAfter = statusAfter.body.providers.find(
      (provider: { provider: string }) => provider.provider === "jira"
    );
    const responseText = JSON.stringify([run.body, statusAfter.body]);

    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      claimed: 1,
      processed: [{ id: queued.body.job.id, kind: "success", status: "succeeded" }],
      status: "processed"
    });
    expect(jiraBefore).toMatchObject({
      activeCredentials: 1,
      capabilities: {
        manualSync: true
      },
      syncWorkerConfigured: true
    });
    expect(jiraAfter).toMatchObject({
      lastJobStatus: "succeeded",
      linkedIssueMappings: 1,
      syncWorkerConfigured: true
    });
    expect(jiraIssueFetches).toEqual([
      { cloudId: "jira-cloud", issueIdOrKey: "10042", token: "jira-access-secret" }
    ]);
    expect(request?.title).toBe("Updated from live Jira");
    expect(issueMapping?.lastSyncedAt).toBeTruthy();
    expect(syncJob).toMatchObject({ status: "succeeded" });
    expect(responseText).not.toContain("jira-access-secret");
    expect(responseText).not.toContain("ciphertext");
  });

  it("maps auto-configured GitHub sync worker failures through the private runner", async () => {
    const failures = [
      new GitHubAppClientError("github_api_error", "raw-token-should-not-leak", 429),
      new GitHubAppClientError("invalid_response", "raw-token-should-not-leak")
    ];
    const { integrationStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      githubAppClient: {
        ...fakeGitHubAppClient(),
        async getRepositoryIssue() {
          throw failures.shift() ?? new GitHubAppClientError("invalid_response", "unexpected");
        }
      },
      githubAppConfig: completeGitHubAppConfig()
    });

    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const retryQueued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
      body: JSON.stringify({ installationId: "github-install", reason: "manual" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const retryRun = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const fatalQueued = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
      body: JSON.stringify({ installationId: "github-install", reason: "scheduled" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const fatalRun = await fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 5, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const integrations = await integrationStore.load();
    const retryJob = integrations.state.syncJobs.find((job) => job.id === retryQueued.body.job.id);
    const fatalJob = integrations.state.syncJobs.find((job) => job.id === fatalQueued.body.job.id);

    expect(retryRun.body).toMatchObject({
      claimed: 1,
      remainingQueued: 1,
      status: "processed"
    });
    expect(fatalRun.body).toMatchObject({
      claimed: 1,
      status: "processed"
    });
    expect(retryJob).toMatchObject({
      error: "GitHub API request failed with retryable status 429.",
      reason: "retry",
      status: "queued"
    });
    expect(fatalJob).toMatchObject({
      error: "GitHub API response was invalid.",
      status: "failed"
    });
    expect(JSON.stringify({ fatalJob, fatalRun: fatalRun.body, retryJob, retryRun: retryRun.body })).not.toContain(
      "raw-token-should-not-leak"
    );
  });

  it("serializes concurrent integration sync runs without double-processing jobs", async () => {
    const processedJobIds: string[] = [];
    let releaseFirstSync: () => void = () => undefined;
    let markFirstSyncStarted: () => void = () => undefined;
    const firstSyncStarted = new Promise<void>((resolve) => {
      markFirstSyncStarted = resolve;
    });
    const worker: IntegrationSyncWorker = {
      async process(job) {
        processedJobIds.push(job.id);

        if (processedJobIds.length === 1) {
          markFirstSyncStarted();
          await new Promise<void>((release) => {
            releaseFirstSync = release;
          });
        }

        return { kind: "success", summary: "Worker synced installation." };
      }
    };
    const { integrationStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      integrationSyncWorker: worker
    });

    await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/issues/import`, {
      body: JSON.stringify(gitHubImportPayload()),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const [manual, scheduled] = await Promise.all([
      fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
        body: JSON.stringify({ installationId: "github-install", reason: "manual" }),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      }),
      fetchJson(`${url}/api/openroad/workspaces/acme/integrations/github/sync/jobs`, {
        body: JSON.stringify({ installationId: "github-install", reason: "scheduled" }),
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    ]);

    const first = fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 1, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    await firstSyncStarted;
    const second = fetchJson(`${url}/api/openroad/integrations/sync/run`, {
      body: JSON.stringify({ limit: 1, workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    releaseFirstSync();
    const results = await Promise.all([first, second]);
    const integrations = await integrationStore.load();

    expect(results.reduce((count, result) => count + result.body.claimed, 0)).toBe(2);
    expect(new Set(processedJobIds)).toEqual(new Set([manual.body.job.id, scheduled.body.job.id]));
    expect(integrations.state.syncJobs.every((job) => job.status === "succeeded")).toBe(true);
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

  it("imports Jira issues into requests and persists mappings outside core state", async () => {
    const { dataFile, integrationFile, teamFile, url } = await startTestServer();

    const response = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
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
      source: "Jira",
      title: "Import Jira issues",
      visibility: "Private"
    });
    expect(response.body.mapping).toMatchObject({
      external: {
        id: "cloud-123:10042",
        provider: "jira",
        type: "issue"
      }
    });
    expect(response.body.installation.permissions).toEqual([
      "read:external",
      "read:openroad",
      "write:openroad"
    ]);
    expect(integrationState.installations).toEqual([
      expect.objectContaining({ provider: "jira", workspaceId: "acme" })
    ]);
    expect(integrationState.mappings).toHaveLength(1);
    expect(integrationState.mappings[0].openRoad.id).toBe(response.body.request.id);
    expect(coreStateText).not.toContain("providerAccountId");
    expect(teamState.auditEvents[0]).toMatchObject({
      type: "integration.jira.issue.import",
      workspaceId: "acme"
    });
  });

  it("re-imports the same Jira issue by updating the mapped request", async () => {
    const { store, url } = await startTestServer();

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const updated = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(
        jiraImportPayload({
          issue: jiraIssuePayload({
            fields: jiraFieldsPayload({
              labels: ["planned"],
              status: {
                id: "4",
                name: "In Progress",
                statusCategory: { key: "indeterminate", name: "In Progress" }
              },
              summary: "Updated Jira issue"
            })
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
    expect(updated.body.request.title).toBe("Updated Jira issue");
    expect(updated.body.request.status).toBe("Planned");
    expect(matchingRequests).toHaveLength(1);
  });

  it("keeps Jira installation records scoped by workspace", async () => {
    const { integrationStore, url } = await startTestServer();

    const acmeImport = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const maintainerImport = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/jira/issues/import`,
      {
        body: JSON.stringify(
          jiraImportPayload({
            issue: jiraIssuePayload({
              fields: jiraFieldsPayload({
                summary: "Maintainer Jira issue"
              }),
              id: "10043",
              key: "OPEN-43"
            })
          })
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const integrations = await integrationStore.load();
    const jiraInstallations = integrations.state.installations.filter(
      (installation) => installation.provider === "jira"
    );

    expect(acmeImport.status).toBe(201);
    expect(maintainerImport.status).toBe(201);
    expect(jiraInstallations).toHaveLength(2);
    expect(new Set(jiraInstallations.map((installation) => installation.workspaceId))).toEqual(
      new Set(["acme", "maintainer"])
    );
  });

  it("protects Jira import and OAuth setup by workspace role", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false, trustProxyHeaders: true },
      jiraOAuthConfig: testJiraOAuthConfig()
    });

    const publicSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/jira/oauth/setup`
    );
    const contributorSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/jira/oauth/setup`,
      {
        headers: workspaceActorHeaders("acme", "Contributor")
      }
    );
    const ownerSetup = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/jira/oauth/setup`,
      {
        headers: workspaceActorHeaders("acme", "Owner")
      }
    );
    const publicWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const viewerWrite = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
      headers: {
        ...workspaceActorHeaders("acme", "Viewer"),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const contributorWrite = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`,
      {
        body: JSON.stringify(
          jiraImportPayload({
            issue: jiraIssuePayload({ id: "10044", key: "OPEN-44" })
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
      `${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`,
      {
        body: JSON.stringify(
          jiraImportPayload({
            issue: jiraIssuePayload({ id: "10045", key: "OPEN-45" })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "jira:jira-install-jira-cloud"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const integrationCrossWorkspace = await fetchJson(
      `${url}/api/openroad/workspaces/maintainer/integrations/jira/issues/import`,
      {
        body: JSON.stringify(
          jiraImportPayload({
            issue: jiraIssuePayload({ id: "10046", key: "OPEN-46" })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "jira:jira-install-jira-cloud"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );
    const wrongProviderIntegration = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`,
      {
        body: JSON.stringify(
          jiraImportPayload({
            issue: jiraIssuePayload({ id: "10047", key: "OPEN-47" })
          })
        ),
        headers: {
          ...integrationActorHeaders("acme", "linear:linear-install"),
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    expect(publicSetup.status).toBe(403);
    expect(contributorSetup.status).toBe(403);
    expect(ownerSetup.status).toBe(200);
    expect(JSON.stringify(ownerSetup.body)).not.toContain("jira-secret");
    expect(publicWrite.status).toBe(403);
    expect(viewerWrite.status).toBe(403);
    expect(contributorWrite.status).toBe(201);
    expect(integrationWrite.status).toBe(201);
    expect(integrationCrossWorkspace.status).toBe(403);
    expect(wrongProviderIntegration.status).toBe(403);
  });

  it("reports safe Jira OAuth setup without blocking standalone mode", async () => {
    const configured = await startTestServer({
      jiraOAuthConfig: testJiraOAuthConfig()
    });
    const missing = await startTestServer();

    const configuredSetup = await fetchJson(
      `${configured.url}/api/openroad/workspaces/acme/integrations/jira/oauth/setup`
    );
    const missingSetup = await fetchJson(
      `${missing.url}/api/openroad/workspaces/acme/integrations/jira/oauth/setup`
    );

    expect(configuredSetup.status).toBe(200);
    expect(configuredSetup.body.jiraOAuth).toMatchObject({
      configured: true,
      missing: [],
      requiredScopes: ["read:jira-work", "read:jira-user"]
    });
    expect(configuredSetup.body.jiraOAuth.authorizeUrl).toContain("https://auth.atlassian.test/authorize");
    expect(JSON.stringify(configuredSetup.body)).not.toContain("jira-secret");
    expect(missingSetup.status).toBe(200);
    expect(missingSetup.body.jiraOAuth).toMatchObject({
      configured: false,
      missing: [
        "OPENROAD_JIRA_CLIENT_ID",
        "OPENROAD_JIRA_CLIENT_SECRET",
        "OPENROAD_JIRA_REDIRECT_URI"
      ]
    });
  });

  it("keeps Jira issue identity scoped to the Atlassian cloud site", async () => {
    const { integrationStore, url } = await startTestServer();

    const first = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const second = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(
        jiraImportPayload({
          installation: {
            accountId: "jira-cloud-other",
            accountName: "Other OpenRoad Jira",
            id: "jira-install",
            permissions: [
              "read:external",
              "read:openroad",
              "write:openroad",
              "write:external",
              "webhook:receive"
            ]
          },
          issue: jiraIssuePayload({
            id: "10042",
            self: "https://api.atlassian.com/ex/jira/cloud-other/rest/api/3/issue/10042",
            url: "https://other.atlassian.net/browse/OPEN-42"
          })
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const integrations = await integrationStore.load();
    const jiraInstallations = integrations.state.installations.filter(
      (installation) => installation.provider === "jira"
    );
    const jiraMappings = integrations.state.mappings.filter(
      (mapping) => mapping.external.provider === "jira"
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.request.id).not.toBe(first.body.request.id);
    expect(jiraInstallations.map((installation) => installation.id).sort()).toEqual([
      "jira-install-jira-cloud",
      "jira-install-jira-cloud-other"
    ]);
    expect(jiraMappings.map((mapping) => mapping.external.id).sort()).toEqual([
      "cloud-123:10042",
      "cloud-other:10042"
    ]);
    expect(second.body.installation.permissions).not.toContain("write:external");
    expect(second.body.installation.permissions).not.toContain("webhook:receive");
  });

  it("rejects invalid or disconnected Jira imports without mutating core state", async () => {
    const { dataFile, integrationFile, integrationStore, url } = await startTestServer();
    await integrationStore.load();
    const beforeState = await readFile(dataFile, "utf8");
    const beforeIntegrations = await readFile(integrationFile, "utf8");

    const invalid = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(
        jiraImportPayload({
          issue: { ...jiraIssuePayload(), id: "", key: "" }
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("invalid_request");
    expect(await readFile(dataFile, "utf8")).toBe(beforeState);
    expect(await readFile(integrationFile, "utf8")).toBe(beforeIntegrations);

    const created = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
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
    const disconnected = await fetchJson(`${url}/api/openroad/workspaces/acme/integrations/jira/issues/import`, {
      body: JSON.stringify(jiraImportPayload()),
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
      githubAppConfig: testGitHubWebhookConfig(),
      tokenVault: testTokenVault()
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
    const credential = await fetchJson(
      `${url}/api/openroad/workspaces/acme/integrations/github/credentials`,
      {
        body: JSON.stringify(gitHubCredentialPayload()),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );

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
    const storedCredential = afterUnsuspend.state.credentials.find(
      (item) => item.id === credential.body.credential.id
    );

    expect(credential.status).toBe(201);
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
    expect(storedCredential).toMatchObject({ status: "revoked" });
    expect(storedCredential?.encryptedSecret).toBeUndefined();
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
    expect(response.headers.get("set-cookie")).toContain("openroad_portal_visitor=visitor-1");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/openroad");
    expect(response.body.request).toMatchObject({
      hasCurrentUserVote: true,
      id: "public-request",
      votes: state.workspaces[0].requests[0].votes + 1
    });
    expect(JSON.stringify(response.body)).not.toContain("Internal comment");
    expect(JSON.stringify(response.body)).not.toContain("Hidden comment");
    expect(JSON.stringify(response.body)).not.toContain("Secret requester");
    expect(JSON.stringify(response.body)).not.toContain("publicVoterKeys");
    expect(request?.votes).toBe(state.workspaces[0].requests[0].votes + 1);
    expect(request?.publicVoterKeys).toEqual(["public-visitor:visitor-1"]);
  });

  it("keeps public portal vote writes idempotent per visitor", async () => {
    const { store, url } = await startTestServer();
    const state = createStateWithPrivatePortalData();
    await store.replaceState(state);
    const vote = {
      body: JSON.stringify({ requester: { id: "repeat-visitor", name: "Repeat visitor" } }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    };

    const first = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`,
      vote
    );
    const cookie = cookiePair(first.headers.get("set-cookie") ?? "");
    const repeated = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`,
      {
        body: JSON.stringify({ requester: { id: "spoofed-repeat", name: "Repeat visitor" } }),
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const persisted = await store.load();
    const request = persisted.state.workspaces[0].requests.find((item) => item.id === "public-request");

    expect(first.status).toBe(200);
    expect(first.body.status).toBe("saved");
    expect(repeated.status).toBe(200);
    expect(repeated.body.status).toBe("already_saved");
    expect(repeated.body.request.hasCurrentUserVote).toBe(true);
    expect(repeated.body.request.votes).toBe(state.workspaces[0].requests[0].votes + 1);
    expect(request?.votes).toBe(state.workspaces[0].requests[0].votes + 1);
    expect(request?.publicVoterKeys).toEqual(["public-visitor:repeat-visitor"]);
  });

  it("uses public visitor headers for API clients and public read vote state", async () => {
    const { store, url } = await startTestServer();
    const state = createStateWithPrivatePortalData();
    await store.replaceState({
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          requests: state.workspaces[0].requests.map((request) =>
            request.id === "public-request"
              ? {
                  ...request,
                  hasCurrentUserVote: true,
                  publicVoterKeys: ["public-visitor:known-visitor"]
                }
              : request
          )
        },
        ...state.workspaces.slice(1)
      ]
    });

    const anonymous = await fetchJson(`${url}/api/openroad/workspaces/acme/portal?query=public`);
    const known = await fetchJson(`${url}/api/openroad/workspaces/acme/portal?query=public`, {
      headers: { "x-openroad-visitor-id": "known-visitor" }
    });
    const headerVote = await fetchJson(
      `${url}/api/openroad/workspaces/acme/portal/requests/public-request/vote`,
      {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          "x-openroad-visitor-id": "api-visitor-123"
        },
        method: "POST"
      }
    );
    const persisted = await store.load();
    const request = persisted.state.workspaces[0].requests.find((item) => item.id === "public-request");

    expect(anonymous.status).toBe(200);
    expect(anonymous.body.requests[0].hasCurrentUserVote).toBe(false);
    expect(anonymous.headers.get("set-cookie")).toContain("openroad_portal_visitor=");
    expect(JSON.stringify(anonymous.body)).not.toContain("publicVoterKeys");
    expect(known.body.requests[0].hasCurrentUserVote).toBe(true);
    expect(headerVote.status).toBe(200);
    expect(headerVote.body.request.hasCurrentUserVote).toBe(true);
    expect(request?.publicVoterKeys).toEqual(
      expect.arrayContaining(["public-visitor:known-visitor", "public-visitor:api-visitor-123"])
    );
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

  it("keeps requester notification delivery private and configuration-gated", async () => {
    const { url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false }
    });

    const method = await fetchJson(`${url}/api/openroad/notifications/deliver`, {
      headers: { Authorization: "Bearer secret" },
      method: "GET"
    });
    const denied = await fetchJson(`${url}/api/openroad/notifications/deliver`, {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const notConfigured = await fetchJson(`${url}/api/openroad/notifications/deliver`, {
      body: JSON.stringify({}),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    expect(method.status).toBe(405);
    expect(denied.status).toBe(403);
    expect(notConfigured.status).toBe(503);
    expect(notConfigured.body.error.code).toBe("not_configured");
  });

  it("delivers queued requester notifications through a configured adapter", async () => {
    const deliveries: string[] = [];
    const adapter: NotificationDeliveryAdapter = {
      channel: "test",
      async deliver(event) {
        deliveries.push(event.id);
        return { messageId: `test:${event.id}` };
      }
    };
    const { store, teamStore, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false },
      notificationDeliveryAdapter: adapter
    });
    await store.replaceState(createStateWithQueuedNotification());

    const delivered = await fetchJson(`${url}/api/openroad/notifications/deliver`, {
      body: JSON.stringify({ workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const repeated = await fetchJson(`${url}/api/openroad/notifications/deliver`, {
      body: JSON.stringify({ workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const persisted = await store.load();
    const team = await teamStore.load(persisted.state);
    const event = persisted.state.workspaces[0].notifications.outbox[0];

    expect(delivered.status).toBe(200);
    expect(delivered.body).toMatchObject({
      attempted: 1,
      delivered: 1,
      failed: 0,
      remainingQueued: 0,
      status: "processed",
      workspaceId: "acme"
    });
    expect(JSON.stringify(delivered.body)).not.toContain("Dark mode for docs site moved");
    expect(repeated.body).toMatchObject({
      attempted: 0,
      delivered: 0,
      skipped: 1
    });
    expect(deliveries).toHaveLength(1);
    expect(event).toMatchObject({
      deliveryAttempts: 1,
      deliveryChannel: "test",
      deliveryMessageId: `test:${event.id}`,
      status: "delivered"
    });
    expect(team.state.auditEvents[0]).toMatchObject({
      type: "notifications.deliver",
      workspaceId: "acme"
    });
  });

  it("serializes concurrent requester notification delivery requests", async () => {
    const deliveries: string[] = [];
    let releaseFirstDelivery: () => void = () => undefined;
    let markFirstDeliveryStarted: () => void = () => undefined;
    const firstDeliveryStarted = new Promise<void>((resolve) => {
      markFirstDeliveryStarted = resolve;
    });
    const adapter: NotificationDeliveryAdapter = {
      channel: "test",
      async deliver(event) {
        deliveries.push(event.id);
        markFirstDeliveryStarted();
        await new Promise<void>((release) => {
          releaseFirstDelivery = release;
        });
        return { messageId: `test:${event.id}` };
      }
    };
    const { store, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false },
      notificationDeliveryAdapter: adapter
    });
    await store.replaceState(createStateWithQueuedNotification());

    const first = fetchJson(`${url}/api/openroad/notifications/deliver`, {
      body: JSON.stringify({ workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    await firstDeliveryStarted;
    const second = fetchJson(`${url}/api/openroad/notifications/deliver`, {
      body: JSON.stringify({ workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    releaseFirstDelivery();
    const results = await Promise.all([first, second]);
    const deliveredCount = results.reduce((count, result) => count + result.body.delivered, 0);

    expect(deliveredCount).toBe(1);
    expect(deliveries).toHaveLength(1);
    expect(results.some((result) => result.body.skipped === 1)).toBe(true);
  });

  it("keeps requester notification delivery failures retryable without dropping events", async () => {
    const adapter: NotificationDeliveryAdapter = {
      channel: "failing-test",
      async deliver() {
        throw new Error("Delivery provider missing file permissions");
      }
    };
    const { store, url } = await startTestServer({
      auth: { adminToken: "secret", singleUserMode: false },
      notificationDeliveryAdapter: adapter
    });
    await store.replaceState(createStateWithQueuedNotification());

    const response = await fetchJson(`${url}/api/openroad/notifications/deliver`, {
      body: JSON.stringify({ workspaceId: "acme" }),
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const persisted = await store.load();
    const event = persisted.state.workspaces[0].notifications.outbox[0];

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      attempted: 1,
      delivered: 0,
      failed: 1,
      remainingQueued: 1
    });
    expect(event).toMatchObject({
      deliveryAttempts: 1,
      deliveryChannel: "failing-test",
      status: "queued"
    });
    expect(event.deliveryError).toContain("missing file permissions");
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
    integrationSyncWorker?: IntegrationSyncWorker;
    invitationDeliveryAdapter?: InvitationDeliveryAdapter;
    invitationDeliveryPublicBaseUrl?: string;
    jiraApiClient?: JiraApiClient;
    jiraOAuthConfig?: JiraOAuthConfig;
    linearApiClient?: LinearApiClient;
    linearOAuthConfig?: LinearOAuthConfig;
    notificationDeliveryAdapter?: NotificationDeliveryAdapter;
    portalRateLimiter?: PortalRateLimiter;
    sessionStore?: SessionStore;
    tokenVault?: IntegrationTokenVault;
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
  const sessionFile = join(directory, "sessions.json");
  const teamFile = join(directory, "team.json");
  const store = new FileOpenRoadStore(dataFile);
  const integrationStore = new FileIntegrationStore(integrationFile);
  const sessionStore = options.sessionStore ?? new FileSessionStore(sessionFile);
  const teamStore = new FileTeamStore(teamFile);
  await store.load();
  const server = createOpenRoadServer({
    auth: options.auth,
    distDir,
    githubAppClient: options.githubAppClient,
    githubAppConfig: options.githubAppConfig,
    integrationStore,
    integrationSyncWorker: options.integrationSyncWorker,
    invitationDeliveryAdapter: options.invitationDeliveryAdapter,
    invitationDeliveryPublicBaseUrl: options.invitationDeliveryPublicBaseUrl,
    jiraApiClient: options.jiraApiClient,
    jiraOAuthConfig: options.jiraOAuthConfig,
    linearApiClient: options.linearApiClient,
    linearOAuthConfig: options.linearOAuthConfig,
    logger: { error: vi.fn(), log: vi.fn() },
    notificationDeliveryAdapter: options.notificationDeliveryAdapter,
    portalRateLimiter: options.portalRateLimiter,
    sessionStore,
    store,
    teamStore,
    tokenVault: options.tokenVault
  });
  const url = await listen(server);
  openServers.push(server);

  return {
    dataFile,
    integrationFile,
    integrationStore,
    sessionFile,
    sessionStore,
    store,
    teamFile,
    teamStore,
    url
  };
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

async function createProviderServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse
  ) => Promise<void> | void
) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  const url = await listen(server);

  return {
    close: () => closeServer(server),
    url
  };
}

async function readRequestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
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
    headers: response.headers,
    status: response.status
  };
}

function cookiePair(value: string) {
  return value.split(";")[0];
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

function gitHubCredentialPayload(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "github-access-secret",
    expiresAt: "2026-07-05T00:00:00.000Z",
    installationId: "github-install",
    label: "GitHub sync",
    permissions: ["read:external"],
    providerScopes: ["repo", "issues:read"],
    refreshToken: "github-refresh-secret",
    tokenType: "bearer",
    ...overrides
  };
}

function linearCredentialPayload(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "linear-access-secret",
    expiresAt: "2999-07-05T00:00:00.000Z",
    installationId: "linear-install",
    label: "Linear sync",
    permissions: ["read:external"],
    providerScopes: ["issues:read"],
    tokenType: "bearer",
    ...overrides
  };
}

function jiraCredentialPayload(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "jira-access-secret",
    expiresAt: "2999-07-05T00:00:00.000Z",
    installationId: "jira-install-jira-cloud",
    label: "Jira sync",
    permissions: ["read:external"],
    providerScopes: ["read:jira-work"],
    tokenType: "bearer",
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

function jiraImportPayload(overrides: Record<string, unknown> = {}) {
  return {
    installation: {
      accountId: "jira-cloud",
      accountName: "OpenRoad Jira",
      id: "jira-install",
      permissions: ["read:external", "read:openroad", "write:openroad"]
    },
    issue: jiraIssuePayload(),
    ...overrides
  };
}

function jiraIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    fields: jiraFieldsPayload(),
    id: "10042",
    key: "OPEN-42",
    self: "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/10042",
    url: "https://openroad.atlassian.net/browse/OPEN-42",
    ...overrides
  };
}

function jiraFieldsPayload(overrides: Record<string, unknown> = {}) {
  return {
    assignee: { accountId: "acct-akhil", displayName: "Akhil Trivedi" },
    description: {
      content: [
        {
          content: [{ text: "Users need Jira issue context.", type: "text" }],
          type: "paragraph"
        }
      ],
      type: "doc",
      version: 1
    },
    issuetype: { id: "10001", name: "Story" },
    labels: ["needs-decision", "ux"],
    priority: { id: "2", name: "High" },
    project: { id: "project-open", key: "OPEN", name: "OpenRoad" },
    reporter: { accountId: "acct-ops", displayName: "Customer Ops" },
    status: {
      id: "3",
      name: "Triage",
      statusCategory: { key: "new", name: "To Do" }
    },
    summary: "Import Jira issues",
    updated: "2026-07-04T00:00:00.000+0000",
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

function testJiraOAuthConfig(): JiraOAuthConfig {
  return {
    authBaseUrl: "https://auth.atlassian.test",
    clientId: "jira-client",
    clientSecret: "jira-secret",
    redirectUri: "https://openroad.test/api/openroad/integrations/jira/oauth/callback"
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

function testTokenVault() {
  const vault = createIntegrationTokenVault({
    encryptionKey: "0123456789abcdef0123456789abcdef",
    keyId: "primary"
  });

  if (vault.status !== "ready") {
    throw new Error("Expected test token vault to be ready.");
  }

  return vault;
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
    async getRepositoryIssue() {
      return {
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

function completeGitHubAppConfig(): GitHubAppConfig {
  return {
    apiBaseUrl: "https://api.github.test",
    appBaseUrl: "https://github.test",
    appId: "12345",
    privateKey: "test-private-key",
    slug: "openroad-test",
    webhookSecretConfigured: false
  };
}

function incompleteGitHubAppConfig(): GitHubAppConfig {
  return {
    apiBaseUrl: "https://api.github.test",
    appBaseUrl: "https://github.test",
    webhookSecretConfigured: false
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

function createStateWithQueuedNotification() {
  const state = createInitialOpenRoadState();
  const workspace = state.workspaces[0];
  const request = workspace.requests.find((item) => item.id === "dark-mode-docs");
  if (!request) throw new Error("Fixture request missing.");

  return openRoadReducer(state, {
    request: {
      ...request,
      status: "Planned"
    },
    type: "replace-request",
    workspaceId: workspace.id
  });
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
