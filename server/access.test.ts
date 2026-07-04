// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  authOptionsFromEnv,
  createAccessContext,
  hasPermission,
  openRoadApiContract,
  requirePermission
} from "./access";

describe("OpenRoad API access contract", () => {
  it("documents actor types, roles, permissions, and route protections", () => {
    expect(openRoadApiContract.version).toBe("2026-07-04");
    expect(openRoadApiContract.actorTypes).toContain("workspace-member");
    expect(openRoadApiContract.workspaceRoles).toEqual([
      "Owner",
      "Maintainer",
      "Contributor",
      "Viewer"
    ]);
    expect(openRoadApiContract.permissions).toContain("workspace:write");
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/state",
        permission: "state:read",
        scope: "global"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/portal/requests/:requestId/comments",
        permission: "portal:interact",
        scope: "public"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/github/issues/import",
        permission: "workspace:write",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/github/app/setup",
        permission: "integration:manage",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/github/app/installations/verify",
        permission: "integration:manage",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/github/issues/live",
        permission: "workspace:write",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/linear/issues/import",
        permission: "workspace:write",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup",
        permission: "integration:manage",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/jira/issues/import",
        permission: "workspace:write",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/jira/oauth/setup",
        permission: "integration:manage",
        scope: "workspace"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/integrations/github/webhook",
        permission: "integration:sync",
        scope: "provider-signature"
      })
    );
    expect(openRoadApiContract.routeProtections).toContainEqual(
      expect.objectContaining({
        path: "/api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect",
        permission: "integration:manage",
        scope: "workspace"
      })
    );
  });

  it("defaults to single-user owner mode when no admin token is configured", () => {
    const context = createAccessContext({ headers: {} }, authOptionsFromEnv({}));

    expect(context.actor).toMatchObject({
      source: "single-user",
      type: "local-owner"
    });
    expect(hasPermission(context.actor, "state:write")).toBe(true);
  });

  it("uses admin bearer token for owner access when configured", () => {
    const context = createAccessContext(
      { headers: { authorization: "Bearer secret" } },
      authOptionsFromEnv({ OPENROAD_ADMIN_TOKEN: "secret" })
    );

    expect(context.actor).toMatchObject({
      source: "admin-token",
      type: "local-owner"
    });
    expect(hasPermission(context.actor, "state:read")).toBe(true);
  });

  it("falls back to public visitor when an admin token is configured but absent", () => {
    const context = createAccessContext(
      { headers: {} },
      authOptionsFromEnv({ OPENROAD_ADMIN_TOKEN: "secret" })
    );

    expect(context.actor.type).toBe("public-visitor");
    expect(hasPermission(context.actor, "portal:read", "acme")).toBe(true);
    expect(hasPermission({ id: "requester-1", type: "requester", workspaceId: "acme" }, "portal:interact", "acme")).toBe(true);
    expect(hasPermission(context.actor, "state:read")).toBe(false);
  });

  it("only accepts member actor headers when trusted proxy mode is enabled", () => {
    const headers = {
      "x-openroad-actor-type": "workspace-member",
      "x-openroad-workspace-id": "acme",
      "x-openroad-workspace-role": "Viewer"
    };

    const untrusted = createAccessContext({ headers }, { singleUserMode: false });
    const trusted = createAccessContext(
      { headers },
      { singleUserMode: false, trustProxyHeaders: true }
    );

    expect(untrusted.actor.type).toBe("public-visitor");
    expect(trusted.actor).toMatchObject({
      role: "Viewer",
      type: "workspace-member",
      workspaceId: "acme"
    });
  });

  it("enforces workspace scope for members", () => {
    const context = createAccessContext(
      {
        headers: {
          "x-openroad-actor-type": "workspace-member",
          "x-openroad-workspace-id": "acme",
          "x-openroad-workspace-role": "Contributor"
        }
      },
      { singleUserMode: false, trustProxyHeaders: true }
    );

    expect(hasPermission(context.actor, "workspace:write", "acme")).toBe(true);
    expect(hasPermission(context.actor, "workspace:write", "maintainer")).toBe(false);
    expect(() => requirePermission(context, "workspace:write", "maintainer")).toThrow(
      "permission"
    );
  });

  it("keeps viewers read-only inside their workspace", () => {
    const context = createAccessContext(
      {
        headers: {
          "x-openroad-actor-type": "workspace-member",
          "x-openroad-workspace-id": "acme",
          "x-openroad-workspace-role": "Viewer"
        }
      },
      { singleUserMode: false, trustProxyHeaders: true }
    );

    expect(hasPermission(context.actor, "workspace:read", "acme")).toBe(true);
    expect(hasPermission(context.actor, "workspace:write", "acme")).toBe(false);
  });

  it("limits integration management to owners and local admins", () => {
    const owner = createAccessContext(
      {
        headers: {
          "x-openroad-actor-type": "workspace-member",
          "x-openroad-workspace-id": "acme",
          "x-openroad-workspace-role": "Owner"
        }
      },
      { singleUserMode: false, trustProxyHeaders: true }
    );
    const contributor = createAccessContext(
      {
        headers: {
          "x-openroad-actor-type": "workspace-member",
          "x-openroad-workspace-id": "acme",
          "x-openroad-workspace-role": "Contributor"
        }
      },
      { singleUserMode: false, trustProxyHeaders: true }
    );
    const integration = createAccessContext(
      {
        headers: {
          "x-openroad-actor-type": "integration",
          "x-openroad-integration-id": "github-install",
          "x-openroad-workspace-id": "acme"
        }
      },
      { singleUserMode: false, trustProxyHeaders: true }
    );
    const admin = createAccessContext(
      { headers: { authorization: "Bearer secret" } },
      { adminToken: "secret", singleUserMode: false }
    );

    expect(hasPermission(owner.actor, "integration:manage", "acme")).toBe(true);
    expect(hasPermission(admin.actor, "integration:manage", "acme")).toBe(true);
    expect(hasPermission(contributor.actor, "integration:manage", "acme")).toBe(false);
    expect(hasPermission(integration.actor, "integration:manage", "acme")).toBe(false);
  });
});
