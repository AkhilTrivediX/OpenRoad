import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import {
  AccessDeniedError,
  createAccessContext,
  openRoadApiContract,
  openRoadApiVersion,
  requirePermission,
  type AccessContext,
  type AuthOptions
} from "./access.js";
import {
  createPublicPortalSnapshot,
  openRoadReducer,
  openRoadSchemaVersion,
  type OpenRoadAction
} from "../src/domain/openroad.js";
import {
  OpenRoadStoreError,
  parseOpenRoadState,
  type OpenRoadStore
} from "./store.js";
import type { AuditEvent, TeamStore } from "./team.js";

type CreateOpenRoadServerOptions = {
  auth?: AuthOptions;
  distDir?: string;
  logger?: Pick<Console, "error" | "log">;
  store: OpenRoadStore;
  teamStore?: TeamStore;
};

type ApiErrorCode =
  | "corrupt_state"
  | "forbidden"
  | "invalid_json"
  | "invalid_method"
  | "invalid_state"
  | "future_schema"
  | "not_found"
  | "payload_too_large"
  | "server_error";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};

const staticMimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

const openRoadActionTypes = new Set([
  "create-workspace",
  "create-request",
  "replace-request",
  "create-work-item",
  "replace-work-item",
  "create-roadmap-item",
  "replace-roadmap-item",
  "delete-roadmap-item",
  "create-changelog-item",
  "replace-changelog-item",
  "delete-changelog-item",
  "replace-portal-settings",
  "replace-workspace",
  "replace-state"
]);

export function createOpenRoadServer({
  auth,
  distDir = resolve("dist"),
  logger = console,
  store,
  teamStore
}: CreateOpenRoadServerOptions): Server {
  const resolvedDistDir = resolve(distDir);

  return createServer(async (request, response) => {
    const access = createAccessContext(request, auth);

    try {
      const requestUrl = new URL(request.url ?? "/", "http://openroad.local");

      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApiRequest(request, response, requestUrl, store, access, auth, teamStore);
        return;
      }

      await serveStaticAsset(request, response, requestUrl, resolvedDistDir, access);
    } catch (error) {
      logger.error(error);
      writeApiError(
        response,
        500,
        "server_error",
        "OpenRoad server failed to handle the request.",
        access
      );
    }
  });
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  teamStore: TeamStore | undefined
) {
  if (requestUrl.pathname === "/api/health") {
    if (request.method !== "GET") {
      writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
      return;
    }

    writeJson(response, 200, {
      ok: true,
      schemaVersion: openRoadSchemaVersion
    }, access);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/contract") {
    if (request.method !== "GET") {
      writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
      return;
    }

    writeJson(response, 200, {
      contract: {
        ...openRoadApiContract,
        auth: {
          adminTokenConfigured: Boolean(auth?.adminToken),
          singleUserMode: auth?.singleUserMode !== false,
          trustedProxyHeadersEnabled: Boolean(auth?.trustProxyHeaders)
        }
      }
    }, access);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/state") {
    await handleStateRequest(request, response, store, access, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/actions") {
    await handleActionRequest(request, response, store, access, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/session") {
    await handleSessionRequest(request, response, store, access, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/workspaces") {
    await handleWorkspaceListRequest(request, response, store, access, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/audit-events") {
    await handleAuditEventsRequest(request, response, requestUrl, store, access, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/ops/status") {
    await handleOpsStatusRequest(request, response, store, access, teamStore);
    return;
  }

  const portalMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/portal$/
  );

  if (portalMatch) {
    await handlePortalRequest(request, response, requestUrl, store, access, portalMatch[1]);
    return;
  }

  const workspaceActionMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/actions$/
  );

  if (workspaceActionMatch) {
    await handleWorkspaceActionRequest(
      request,
      response,
      store,
      access,
      teamStore,
      workspaceActionMatch[1]
    );
    return;
  }

  const workspaceMatch = requestUrl.pathname.match(/^\/api\/openroad\/workspaces\/([^/]+)$/);

  if (workspaceMatch) {
    await handleWorkspaceRequest(request, response, store, access, workspaceMatch[1]);
    return;
  }

  writeApiError(response, 404, "not_found", "OpenRoad API route was not found.", access);
}

async function handleStateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined
) {
  if (request.method === "GET") {
    try {
      requirePermission(access, "state:read");
      const result = await store.load();
      writeJson(response, 200, result, access);
    } catch (error) {
      writeKnownApiError(response, error, access);
    }
    return;
  }

  if (request.method === "PUT") {
    try {
      requirePermission(access, "state:write");
      const payload = await readJsonBody(request);
      const statePayload = getStatePayload(payload);
      const state = await store.replaceState(statePayload);
      await recordAuditEvent(teamStore, state, access, {
        summary: "Replaced OpenRoad state.",
        type: "state.replace"
      });
      writeJson(response, 200, { state, status: "saved" }, access);
    } catch (error) {
      writeKnownApiError(response, error, access);
    }
    return;
  }

  writeApiError(response, 405, "invalid_method", "This endpoint only supports GET and PUT.", access);
}

async function handleActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  try {
    const payload = await readJsonBody(request);

    if (!isOpenRoadActionPayload(payload)) {
      writeApiError(
        response,
        400,
        "invalid_state",
        "Request must include an OpenRoad action.",
        access
      );
      return;
    }

    requirePermission(access, "state:write");
    const current = await store.load();
    let nextState;

    try {
      nextState = parseOpenRoadState(openRoadReducer(current.state, payload.action));
    } catch (error) {
      if (error instanceof OpenRoadStoreError) throw error;
      throw new OpenRoadStoreError("invalid_state", "OpenRoad action could not be applied.");
    }

    const state = await store.replaceState(nextState);
    await recordAuditEvent(teamStore, state, access, {
      summary: `Applied OpenRoad action ${payload.action.type}.`,
      type: `action.${payload.action.type}`,
      workspaceId: getActionWorkspaceId(payload.action)
    });
    writeJson(response, 200, { state, status: "saved" }, access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const result = await store.load();
  const team = teamStore ? await teamStore.load(result.state) : undefined;

  writeJson(
    response,
    200,
    {
      actor: sanitizeActor(access.actor),
      memberships: team
        ? filterMembershipsForActor(team.state.memberships, access.actor)
        : []
    },
    access
  );
}

async function handleWorkspaceListRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const result = await store.load();
  const team = teamStore ? await teamStore.load(result.state) : undefined;
  const readableWorkspaces = result.state.workspaces.filter((workspace) =>
    canReadWorkspace(access, workspace.id)
  );

  if (readableWorkspaces.length === 0 && access.actor.type === "public-visitor") {
    writeKnownApiError(response, new AccessDeniedError(), access);
    return;
  }

  writeJson(
    response,
    200,
    {
      memberships: team
        ? filterMembershipsForActor(team.state.memberships, access.actor)
        : [],
      workspaces: readableWorkspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
        requestCount: workspace.requests.length,
        summary: workspace.summary,
        workItemCount: workspace.workItems.length
      }))
    },
    access
  );
}

async function handleAuditEventsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  if (!teamStore) {
    writeJson(response, 200, { auditEvents: [] }, access);
    return;
  }

  const workspaceId = requestUrl.searchParams.get("workspaceId") ?? undefined;

  try {
    if (workspaceId) requirePermission(access, "workspace:read", workspaceId);
    else requirePermission(access, "state:read");

    const result = await store.load();
    const team = await teamStore.load(result.state);
    const auditEvents = team.state.auditEvents.filter((event) => {
      if (workspaceId) return event.workspaceId === workspaceId;
      return true;
    });

    writeJson(response, 200, { auditEvents }, access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleWorkspaceActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  encodedWorkspaceId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "workspace:write", workspaceId);
    const payload = await readJsonBody(request);

    if (!isOpenRoadActionPayload(payload)) {
      writeApiError(
        response,
        400,
        "invalid_state",
        "Request must include an OpenRoad action.",
        access
      );
      return;
    }

    if (isGlobalAction(payload.action) || getActionWorkspaceId(payload.action) !== workspaceId) {
      writeKnownApiError(
        response,
        new AccessDeniedError("OpenRoad action is outside the requested workspace scope."),
        access
      );
      return;
    }

    const current = await store.load();
    let nextState;

    try {
      nextState = parseOpenRoadState(openRoadReducer(current.state, payload.action));
    } catch (error) {
      if (error instanceof OpenRoadStoreError) throw error;
      throw new OpenRoadStoreError("invalid_state", "OpenRoad action could not be applied.");
    }

    const state = await store.replaceState(nextState);
    const auditEvent = await recordAuditEvent(teamStore, state, access, {
      summary: `Applied OpenRoad action ${payload.action.type}.`,
      type: `action.${payload.action.type}`,
      workspaceId
    });
    const workspace = state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      writeApiError(response, 404, "not_found", "Workspace was not found.", access);
      return;
    }

    writeJson(
      response,
      200,
      {
        revision: auditEvent?.id ?? `workspace-${Date.now()}`,
        status: "saved",
        workspace
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleOpsStatusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  try {
    requirePermission(access, "state:read");
    const result = await store.load();
    const team = teamStore ? await teamStore.load(result.state) : undefined;

    writeJson(
      response,
      200,
      {
        status: "ok",
        stores: {
          openRoad: result.status,
          team: team?.status ?? "not_configured"
        },
        totals: {
          auditEvents: team?.state.auditEvents.length ?? 0,
          memberships: team?.state.memberships.length ?? 0,
          users: team?.state.users.length ?? 0,
          workspaces: result.state.workspaces.length
        },
        uptimeSeconds: Math.round(process.uptime())
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "workspace:read", workspaceId);
    const result = await store.load();
    const workspace = result.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      writeApiError(response, 404, "not_found", "Workspace was not found.", access);
      return;
    }

    writeJson(response, 200, { workspace }, access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handlePortalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  store: OpenRoadStore,
  access: AccessContext,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  requirePermission(access, "portal:read", decodeURIComponent(encodedWorkspaceId));
  const result = await store.load();
  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const workspace = result.state.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    writeApiError(response, 404, "not_found", "Workspace was not found.", access);
    return;
  }

  writeJson(
    response,
    200,
    createPublicPortalSnapshot(workspace, requestUrl.searchParams.get("query") ?? "")
    ,
    access
  );
}

async function serveStaticAsset(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  distDir: string,
  access: AccessContext
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    writeApiError(response, 405, "invalid_method", "Static assets only support GET and HEAD.", access);
    return;
  }

  const pathname = decodeURIComponent(requestUrl.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const assetPath = resolve(join(distDir, requestedPath));

  if (!isPathInside(assetPath, distDir)) {
    writeApiError(response, 403, "not_found", "Static asset was not found.", access);
    return;
  }

  const resolvedAssetPath = await resolveStaticPath(assetPath, distDir);

  if (!resolvedAssetPath) {
    writeApiError(response, 404, "not_found", "Static asset was not found.", access);
    return;
  }

  const contentType = staticMimeTypes[extname(resolvedAssetPath)] ?? "application/octet-stream";
  const cacheControl = resolvedAssetPath.includes(`${sep}assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  response.writeHead(200, {
    "Cache-Control": cacheControl,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(resolvedAssetPath).pipe(response);
}

async function resolveStaticPath(assetPath: string, distDir: string) {
  try {
    const assetStats = await stat(assetPath);
    if (assetStats.isFile()) return assetPath;
  } catch {
    // Fall through to app-route fallback.
  }

  const indexPath = resolve(join(distDir, "index.html"));
  if (!isPathInside(indexPath, distDir)) return undefined;

  try {
    const indexStats = await stat(indexPath);
    return indexStats.isFile() ? indexPath : undefined;
  } catch {
    return undefined;
  }
}

function getStatePayload(payload: unknown) {
  if (isRecord(payload) && "state" in payload) {
    return payload.state;
  }

  return payload;
}

async function readJsonBody(request: IncomingMessage, maxBytes = 2_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxBytes) {
      throw new ApiBodyError("payload_too_large", "Request body is too large.");
    }

    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiBodyError("invalid_json", "Request body must be valid JSON.");
  }
}

function writeKnownApiError(
  response: ServerResponse,
  error: unknown,
  access: AccessContext
) {
  if (error instanceof ApiBodyError) {
    const status = error.code === "payload_too_large" ? 413 : 400;
    writeApiError(response, status, error.code, error.message, access);
    return;
  }

  if (error instanceof OpenRoadStoreError) {
    const status = error.code === "future_schema" ? 409 : 422;
    writeApiError(response, status, error.code, error.message, access);
    return;
  }

  if (error instanceof AccessDeniedError) {
    writeApiError(response, error.status, error.code, error.message, access);
    return;
  }

  throw error;
}

function writeJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  access: AccessContext
) {
  response.writeHead(status, jsonHeaders);
  response.end(
    JSON.stringify({
      apiVersion: openRoadApiVersion,
      requestId: access.requestId,
      ...(isRecord(payload) ? payload : { data: payload })
    })
  );
}

function writeApiError(
  response: ServerResponse,
  status: number,
  code: ApiErrorCode,
  message: string,
  access: AccessContext
) {
  writeJson(response, status, {
    error: {
      code,
      message,
      requestId: access.requestId,
      status
    }
  }, access);
}

function isPathInside(targetPath: string, parentPath: string) {
  const relativePath = targetPath.slice(parentPath.length);
  return targetPath === parentPath || (targetPath.startsWith(parentPath) && relativePath.startsWith(sep));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpenRoadActionPayload(value: unknown): value is { action: OpenRoadAction } {
  return (
    isRecord(value) &&
    isRecord(value.action) &&
    typeof value.action.type === "string" &&
    openRoadActionTypes.has(value.action.type)
  );
}

function requireActionPermission(access: AccessContext, action: OpenRoadAction) {
  if (
    action.type === "create-workspace" ||
    action.type === "replace-workspace" ||
    action.type === "replace-state"
  ) {
    requirePermission(access, "state:write");
    return;
  }

  const workspaceId = getActionWorkspaceId(action);

  if (!workspaceId) {
    throw new AccessDeniedError("OpenRoad action is missing a workspace scope.");
  }

  requirePermission(access, "workspace:write", workspaceId);
}

function getActionWorkspaceId(action: OpenRoadAction) {
  return "workspaceId" in action ? action.workspaceId : undefined;
}

async function recordAuditEvent(
  teamStore: TeamStore | undefined,
  openRoadState: Parameters<TeamStore["load"]>[0],
  access: AccessContext,
  event: Pick<AuditEvent, "summary" | "type" | "workspaceId">
) {
  if (!teamStore) return undefined;

  return teamStore.recordAuditEvent(openRoadState, {
    actorId: access.actor.id,
    actorType: access.actor.type,
    requestId: access.requestId,
    summary: event.summary,
    type: event.type,
    workspaceId: event.workspaceId
  });
}

function canReadWorkspace(access: AccessContext, workspaceId: string) {
  try {
    requirePermission(access, "workspace:read", workspaceId);
    return true;
  } catch {
    return false;
  }
}

function filterMembershipsForActor(
  memberships: Array<{ userId: string; workspaceId: string }>,
  actor: AccessContext["actor"]
) {
  if (actor.type === "local-owner") return memberships;
  if ("workspaceId" in actor) {
    return memberships.filter((membership) => membership.workspaceId === actor.workspaceId);
  }
  return [];
}

function sanitizeActor(actor: AccessContext["actor"]) {
  return { ...actor };
}

function isGlobalAction(action: OpenRoadAction) {
  return (
    action.type === "create-workspace" ||
    action.type === "replace-state" ||
    action.type === "replace-workspace"
  );
}

class ApiBodyError extends Error {
  constructor(
    readonly code: Extract<ApiErrorCode, "invalid_json" | "payload_too_large">,
    message: string
  ) {
    super(message);
  }
}
