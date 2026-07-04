import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";

export const openRoadApiVersion = "2026-07-04";

export const actorTypes = [
  "local-owner",
  "workspace-member",
  "public-visitor",
  "requester",
  "integration",
  "service-account"
] as const;

export const workspaceRoles = ["Owner", "Maintainer", "Contributor", "Viewer"] as const;

export const permissions = [
  "contract:read",
  "integration:manage",
  "integration:sync",
  "portal:interact",
  "portal:read",
  "state:read",
  "state:write",
  "workspace:read",
  "workspace:write"
] as const;

export type ActorType = (typeof actorTypes)[number];
export type WorkspaceRole = (typeof workspaceRoles)[number];
export type Permission = (typeof permissions)[number];

export type OpenRoadActor =
  | {
      id: "local-owner";
      source: "admin-token" | "single-user";
      type: "local-owner";
    }
  | {
      id: string;
      role: WorkspaceRole;
      type: "workspace-member";
      workspaceId: string;
    }
  | {
      id: "public-visitor";
      type: "public-visitor";
    }
  | {
      id: string;
      type: "requester";
      workspaceId: string;
    }
  | {
      id: string;
      type: "integration";
      workspaceId: string;
    }
  | {
      id: string;
      role: WorkspaceRole;
      type: "service-account";
      workspaceId?: string;
    };

export type AccessContext = {
  actor: OpenRoadActor;
  requestId: string;
};

export type AuthOptions = {
  adminToken?: string;
  singleUserMode?: boolean;
  trustProxyHeaders?: boolean;
};

export type RouteProtection = {
  methods: string[];
  path: string;
  permission: Permission;
  scope: "global" | "provider-signature" | "public" | "workspace";
};

export class AccessDeniedError extends Error {
  code: "forbidden";
  status = 403;

  constructor(message = "Actor does not have permission to access this OpenRoad resource.") {
    super(message);
    this.code = "forbidden";
  }
}

export const routeProtections: RouteProtection[] = [
  {
    methods: ["GET"],
    path: "/api/health",
    permission: "contract:read",
    scope: "public"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/contract",
    permission: "contract:read",
    scope: "public"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/state",
    permission: "state:read",
    scope: "global"
  },
  {
    methods: ["PUT"],
    path: "/api/openroad/state",
    permission: "state:write",
    scope: "global"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/notifications/deliver",
    permission: "state:write",
    scope: "global"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/actions",
    permission: "workspace:write",
    scope: "workspace"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/workspaces/:workspaceId",
    permission: "workspace:read",
    scope: "workspace"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/workspaces/:workspaceId/portal",
    permission: "portal:read",
    scope: "public"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/portal/requests/:requestId/vote",
    permission: "portal:interact",
    scope: "public"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/portal/requests/:requestId/comments",
    permission: "portal:interact",
    scope: "public"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/github/issues/import",
    permission: "workspace:write",
    scope: "workspace"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/github/app/setup",
    permission: "integration:manage",
    scope: "workspace"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/github/app/installations/verify",
    permission: "integration:manage",
    scope: "workspace"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/github/issues/live",
    permission: "workspace:write",
    scope: "workspace"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/linear/issues/import",
    permission: "workspace:write",
    scope: "workspace"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup",
    permission: "integration:manage",
    scope: "workspace"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/jira/issues/import",
    permission: "workspace:write",
    scope: "workspace"
  },
  {
    methods: ["GET"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/jira/oauth/setup",
    permission: "integration:manage",
    scope: "workspace"
  },
  {
    methods: ["GET", "POST"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/:provider/credentials",
    permission: "integration:manage",
    scope: "workspace"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/:provider/credentials/:credentialId/revoke",
    permission: "integration:manage",
    scope: "workspace"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/integrations/github/webhook",
    permission: "integration:sync",
    scope: "provider-signature"
  },
  {
    methods: ["POST"],
    path: "/api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect",
    permission: "integration:manage",
    scope: "workspace"
  }
];

export const openRoadApiContract = {
  actorTypes,
  permissions,
  routeProtections,
  version: openRoadApiVersion,
  workspaceRoles
};

export function authOptionsFromEnv(env = process.env): AuthOptions {
  const adminToken = normalizeEnvValue(env.OPENROAD_ADMIN_TOKEN);

  return {
    adminToken,
    singleUserMode:
      env.OPENROAD_SINGLE_USER_MODE === "true" ||
      (!adminToken && env.OPENROAD_SINGLE_USER_MODE !== "false"),
    trustProxyHeaders: env.OPENROAD_TRUST_PROXY_HEADERS === "true"
  };
}

export function createAccessContext(
  request: Pick<IncomingMessage, "headers">,
  auth: AuthOptions = {}
): AccessContext {
  const requestId = getSingleHeader(request.headers, "x-openroad-request-id") ?? randomUUID();
  const authorization = getSingleHeader(request.headers, "authorization");

  if (auth.adminToken && authorization === `Bearer ${auth.adminToken}`) {
    return {
      actor: { id: "local-owner", source: "admin-token", type: "local-owner" },
      requestId
    };
  }

  if (auth.trustProxyHeaders) {
    const actor = actorFromTrustedHeaders(request.headers);
    if (actor) return { actor, requestId };
  }

  if (auth.singleUserMode || (!auth.adminToken && auth.singleUserMode !== false)) {
    return {
      actor: { id: "local-owner", source: "single-user", type: "local-owner" },
      requestId
    };
  }

  return {
    actor: { id: "public-visitor", type: "public-visitor" },
    requestId
  };
}

export function requirePermission(
  context: AccessContext,
  permission: Permission,
  workspaceId?: string
) {
  if (!hasPermission(context.actor, permission, workspaceId)) {
    throw new AccessDeniedError();
  }
}

export function hasPermission(
  actor: OpenRoadActor,
  permission: Permission,
  workspaceId?: string
) {
  if (permission === "contract:read") return true;

  if (actor.type === "local-owner") {
    return permission !== "integration:sync";
  }

  if (actor.type === "public-visitor") {
    return permission === "portal:read";
  }

  if (actor.type === "requester") {
    return (
      isActorScopedToWorkspace(actor, workspaceId) &&
      (permission === "portal:read" || permission === "portal:interact")
    );
  }

  if (!isActorScopedToWorkspace(actor, workspaceId)) {
    return false;
  }

  if (actor.type === "integration") {
    return (
      permission === "workspace:read" ||
      permission === "workspace:write" ||
      permission === "integration:sync"
    );
  }

  if (actor.type === "service-account") {
    return permissionsForRole(actor.role).has(permission);
  }

  return permissionsForRole(actor.role).has(permission);
}

function permissionsForRole(role: WorkspaceRole) {
  if (role === "Owner") {
    return new Set<Permission>([
      "contract:read",
      "integration:manage",
      "portal:read",
      "workspace:read",
      "workspace:write"
    ]);
  }

  if (role === "Maintainer" || role === "Contributor") {
    return new Set<Permission>([
      "contract:read",
      "portal:read",
      "workspace:read",
      "workspace:write"
    ]);
  }

  return new Set<Permission>(["contract:read", "portal:read", "workspace:read"]);
}

function isActorScopedToWorkspace(actor: OpenRoadActor, workspaceId?: string) {
  if (!workspaceId) return true;
  if (actor.type === "local-owner") return true;
  if (actor.type === "public-visitor") return false;
  if (actor.type === "service-account" && !actor.workspaceId) return true;
  return actor.workspaceId === workspaceId;
}

function actorFromTrustedHeaders(headers: IncomingHttpHeaders): OpenRoadActor | undefined {
  const type = getSingleHeader(headers, "x-openroad-actor-type");

  if (type === "workspace-member") {
    const role = getWorkspaceRoleHeader(headers);
    const workspaceId = getSingleHeader(headers, "x-openroad-workspace-id");
    const id = getSingleHeader(headers, "x-openroad-actor-id") ?? "workspace-member";
    if (!role || !workspaceId) return undefined;
    return { id, role, type, workspaceId };
  }

  if (type === "requester") {
    const workspaceId = getSingleHeader(headers, "x-openroad-workspace-id");
    const id = getSingleHeader(headers, "x-openroad-requester-id") ?? "requester";
    if (!workspaceId) return undefined;
    return { id, type, workspaceId };
  }

  if (type === "integration") {
    const workspaceId = getSingleHeader(headers, "x-openroad-workspace-id");
    const id = getSingleHeader(headers, "x-openroad-integration-id") ?? "integration";
    if (!workspaceId) return undefined;
    return { id, type, workspaceId };
  }

  if (type === "service-account") {
    const role = getWorkspaceRoleHeader(headers);
    const id = getSingleHeader(headers, "x-openroad-actor-id") ?? "service-account";
    if (!role) return undefined;
    return {
      id,
      role,
      type,
      workspaceId: getSingleHeader(headers, "x-openroad-workspace-id")
    };
  }

  if (type === "public-visitor") {
    return { id: "public-visitor", type };
  }

  return undefined;
}

function getWorkspaceRoleHeader(headers: IncomingHttpHeaders) {
  const role = getSingleHeader(headers, "x-openroad-workspace-role");
  return workspaceRoles.includes(role as WorkspaceRole) ? (role as WorkspaceRole) : undefined;
}

function getSingleHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeEnvValue(value: string | undefined) {
  return value && value.trim() ? value.trim() : undefined;
}
