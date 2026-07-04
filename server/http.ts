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
  createEntityId,
  openRoadReducer,
  openRoadSchemaVersion,
  type OpenRoadAction,
  type OpenRoadState,
  type RequestItem,
  type Workspace
} from "../src/domain/openroad.js";
import {
  createExternalObjectKey,
  type ExternalObjectMapping,
  type IntegrationInstallation,
  type IntegrationPermission
} from "../src/integrations/adapter.js";
import {
  createGitHubInstallation,
  createGitHubIssueExternalRef,
  createGitHubIssueMapping,
  createGitHubPullRequestMapping,
  createOpenRoadRequestFromGitHubIssue,
  getGitHubInstallationCapabilities,
  githubRequiredInstallationPermissions,
  parseGitHubIssuePayload,
  parseGitHubPullRequestPayload,
  syncOpenRoadRequestFromGitHubIssue,
  type GitHubIssue,
  type GitHubInstallationInput,
  type GitHubPullRequest
} from "../src/integrations/github.js";
import {
  OpenRoadStoreError,
  parseOpenRoadState,
  type OpenRoadStore
} from "./store.js";
import {
  IntegrationStoreError,
  parseIntegrationState,
  type IntegrationState,
  type IntegrationStore
} from "./integrations.js";
import type { AuditEvent, TeamStore } from "./team.js";

type CreateOpenRoadServerOptions = {
  auth?: AuthOptions;
  distDir?: string;
  integrationStore?: IntegrationStore;
  logger?: Pick<Console, "error" | "log">;
  portalRateLimiter?: PortalRateLimiter;
  store: OpenRoadStore;
  teamStore?: TeamStore;
};

type ApiErrorCode =
  | "corrupt_state"
  | "forbidden"
  | "invalid_json"
  | "invalid_method"
  | "invalid_request"
  | "invalid_state"
  | "future_schema"
  | "not_configured"
  | "not_found"
  | "payload_too_large"
  | "rate_limited"
  | "server_error";

export type PortalRateLimitOptions = {
  maxRequests: number;
  windowMs: number;
};

export type PortalRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type PortalRateLimiter = {
  consume(key: string): PortalRateLimitResult;
};

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

type PortalActionKind = "comment" | "vote";

type PortalRequester = {
  id: string;
  name: string;
  rateLimitKey: string;
};

export class InMemoryPortalRateLimiter implements PortalRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly options: PortalRateLimitOptions) {}

  consume(key: string): PortalRateLimitResult {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return { allowed: true };
    }

    if (existing.count >= this.options.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      };
    }

    existing.count += 1;
    return { allowed: true };
  }
}

export function createPortalRateLimiterFromEnv(env = process.env): PortalRateLimiter {
  return new InMemoryPortalRateLimiter({
    maxRequests: positiveInteger(env.OPENROAD_PORTAL_RATE_LIMIT_MAX, 30),
    windowMs: positiveInteger(env.OPENROAD_PORTAL_RATE_LIMIT_WINDOW_MS, 60_000)
  });
}

export function createOpenRoadServer({
  auth,
  distDir = resolve("dist"),
  integrationStore,
  logger = console,
  portalRateLimiter = createPortalRateLimiterFromEnv(),
  store,
  teamStore
}: CreateOpenRoadServerOptions): Server {
  const resolvedDistDir = resolve(distDir);

  return createServer(async (request, response) => {
    const access = createAccessContext(request, auth);

    try {
      const requestUrl = new URL(request.url ?? "/", "http://openroad.local");

      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApiRequest(
          request,
          response,
          requestUrl,
          store,
          access,
          auth,
          integrationStore,
          teamStore,
          portalRateLimiter
        );
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
  integrationStore: IntegrationStore | undefined,
  teamStore: TeamStore | undefined,
  portalRateLimiter: PortalRateLimiter
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
    await handleOpsStatusRequest(request, response, store, access, teamStore, integrationStore);
    return;
  }

  const portalMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/portal$/
  );

  if (portalMatch) {
    await handlePortalRequest(request, response, requestUrl, store, access, portalMatch[1]);
    return;
  }

  const portalVoteMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/portal\/requests\/([^/]+)\/vote$/
  );

  if (portalVoteMatch) {
    await handlePortalVoteRequest(
      request,
      response,
      store,
      access,
      teamStore,
      portalRateLimiter,
      portalVoteMatch[1],
      portalVoteMatch[2]
    );
    return;
  }

  const portalCommentMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/portal\/requests\/([^/]+)\/comments$/
  );

  if (portalCommentMatch) {
    await handlePortalCommentRequest(
      request,
      response,
      store,
      access,
      teamStore,
      portalRateLimiter,
      portalCommentMatch[1],
      portalCommentMatch[2]
    );
    return;
  }

  const githubIssueImportMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/github\/issues\/import$/
  );

  if (githubIssueImportMatch) {
    await handleGitHubIssueImportRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      githubIssueImportMatch[1]
    );
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

async function handleGitHubIssueImportRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  encodedWorkspaceId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "workspace:write", workspaceId);

    if (!integrationStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad integration metadata store is not configured."
      );
    }

    const payload = await readJsonBody(request, 500_000);
    const gitHubPayload = parseGitHubIssueImportPayload(payload, workspaceId);
    const current = await store.load();
    const workspace = current.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    const integrationResult = await integrationStore.load();
    const importResult = createGitHubIssueImportState(
      workspace,
      integrationResult.state,
      gitHubPayload,
      new Date().toISOString()
    );

    const nextState = parseOpenRoadState(
      openRoadReducer(current.state, {
        request: importResult.request,
        type: importResult.created ? "create-request" : "replace-request",
        workspaceId
      })
    );
    const state = await store.replaceState(nextState);
    const integrationState = await integrationStore.replaceState(importResult.integrationState);
    const auditEvent = await recordAuditEvent(teamStore, state, access, {
      summary: `${importResult.created ? "Imported" : "Updated"} GitHub issue ${
        gitHubPayload.issue.repository.fullName
      }#${gitHubPayload.issue.number}.`,
      type: importResult.created ? "integration.github.issue.import" : "integration.github.issue.sync",
      workspaceId
    });

    writeJson(
      response,
      importResult.created ? 201 : 200,
      {
        installation: sanitizeInstallation(importResult.installation),
        mappings: importResult.mappings,
        request: importResult.request,
        revision: auditEvent?.id ?? `github-import-${Date.now()}`,
        status: importResult.created ? "created" : "updated",
        totals: {
          installations: integrationState.installations.length,
          mappings: integrationState.mappings.length
        }
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

type GitHubIssueImportPayload = {
  installation: IntegrationInstallation;
  issue: GitHubIssue;
  pullRequests: GitHubPullRequest[];
  requestId?: string;
  workspaceId: string;
};

type GitHubIssueImportStateResult = {
  created: boolean;
  installation: IntegrationInstallation;
  integrationState: IntegrationState;
  mappings: ExternalObjectMapping[];
  request: RequestItem;
};

function parseGitHubIssueImportPayload(
  payload: unknown,
  workspaceId: string
): GitHubIssueImportPayload {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "GitHub import payload must be an object.");
  }

  try {
    const issue = parseGitHubIssuePayload(payload.issue);
    const installation = createGitHubInstallation(
      parseGitHubInstallationPayload(payload.installation, workspaceId)
    );
    const pullRequests = Array.isArray(payload.pullRequests)
      ? payload.pullRequests.map(parseGitHubPullRequestPayload)
      : [];
    const requestId = getBoundedText(payload.requestId, 120);

    return {
      installation,
      issue,
      pullRequests,
      requestId,
      workspaceId
    };
  } catch (error) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      error instanceof Error ? error.message : "GitHub import payload is invalid."
    );
  }
}

function parseGitHubInstallationPayload(
  value: unknown,
  workspaceId: string
): GitHubInstallationInput {
  if (!isRecord(value)) {
    throw new Error("GitHub installation payload must be an object.");
  }

  const accountId =
    getBoundedText(value.accountId, 160) ??
    getBoundedText(value.providerAccountId, 160) ??
    getBoundedText(value.accountName, 160);
  const accountName =
    getBoundedText(value.accountName, 160) ??
    getBoundedText(value.providerAccountName, 160) ??
    getBoundedText(value.accountId, 160);
  const id = getBoundedText(value.id, 160);

  if (!id) throw new Error("GitHub installation id is required.");
  if (!accountId) throw new Error("GitHub account id is required.");
  if (!accountName) throw new Error("GitHub account name is required.");

  return {
    accountId,
    accountName,
    createdAt: getBoundedText(value.createdAt, 80),
    id,
    permissions: parseIntegrationPermissions(value.permissions),
    status: parseIntegrationInstallationStatus(value.status),
    workspaceId
  };
}

function createGitHubIssueImportState(
  workspace: Workspace,
  integrationState: IntegrationState,
  payload: GitHubIssueImportPayload,
  now: string
): GitHubIssueImportStateResult {
  if (payload.installation.status !== "active") {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "GitHub installation must be active before importing issues."
    );
  }

  if (!getGitHubInstallationCapabilities(payload.installation).canImportIssues) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "GitHub installation does not have enough permissions to import issues."
    );
  }

  const issueRef = createGitHubIssueExternalRef(payload.issue);
  const existingMapping = integrationState.mappings.find((mapping) =>
    mapping.installationId === payload.installation.id &&
    mapping.openRoad.workspaceId === payload.workspaceId &&
    isSameExternalObject(mapping, issueRef)
  );
  const targetRequestId = payload.requestId ?? existingMapping?.openRoad.id;
  const existingRequest = targetRequestId
    ? workspace.requests.find((item) => item.id === targetRequestId)
    : undefined;

  if (payload.requestId && !existingRequest) {
    throw new ApiRequestError("not_found", 404, "OpenRoad request was not found.");
  }

  if (existingMapping && !existingRequest && !payload.requestId) {
    throw new ApiRequestError(
      "invalid_state",
      422,
      "GitHub issue mapping points to a missing OpenRoad request."
    );
  }

  const request = existingRequest
    ? syncOpenRoadRequestFromGitHubIssue(existingRequest, payload.issue, now)
    : createOpenRoadRequestFromGitHubIssue(payload.issue, {
        existingRequestIds: workspace.requests.map((item) => item.id),
        now
      });
  const openRoad = {
    id: request.id,
    type: "request" as const,
    workspaceId: payload.workspaceId
  };
  const mappings = [
    createGitHubIssueMapping(payload.installation, payload.issue, openRoad, now),
    ...payload.pullRequests.map((pullRequest) =>
      createGitHubPullRequestMapping(payload.installation, pullRequest, openRoad, now)
    )
  ];
  const nextIntegrationState = parseIntegrationState({
    ...integrationState,
    installations: upsertById(integrationState.installations, payload.installation),
    mappings: upsertManyById(integrationState.mappings, mappings)
  });

  return {
    created: !existingRequest,
    installation: payload.installation,
    integrationState: nextIntegrationState,
    mappings,
    request
  };
}

function parseIntegrationPermissions(value: unknown): IntegrationPermission[] {
  if (!Array.isArray(value)) return githubRequiredInstallationPermissions;

  return value
    .map((permission) => getBoundedText(permission, 80))
    .filter((permission): permission is IntegrationPermission =>
      githubRequiredInstallationPermissions.includes(permission as IntegrationPermission) ||
      permission === "write:external" ||
      permission === "webhook:receive"
    );
}

function parseIntegrationInstallationStatus(value: unknown) {
  if (value === "active" || value === "disconnected" || value === "suspended") {
    return value;
  }

  return undefined;
}

function isSameExternalObject(
  mapping: ExternalObjectMapping,
  ref: ReturnType<typeof createGitHubIssueExternalRef>
) {
  return (
    mapping.status !== "disconnected" &&
    createExternalObjectKey(mapping.external) === createExternalObjectKey(ref)
  );
}

function sanitizeInstallation(installation: IntegrationInstallation) {
  return { ...installation };
}

function upsertManyById<T extends { id: string }>(items: T[], nextItems: T[]) {
  return nextItems.reduce((currentItems, nextItem) => upsertById(currentItems, nextItem), items);
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  return [nextItem, ...items.filter((item) => item.id !== nextItem.id)];
}

async function handleOpsStatusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  try {
    requirePermission(access, "state:read");
    const result = await store.load();
    const team = teamStore ? await teamStore.load(result.state) : undefined;
    const integrations = integrationStore ? await integrationStore.load() : undefined;

    writeJson(
      response,
      200,
      {
        status: "ok",
        stores: {
          integration: integrations?.status ?? "not_configured",
          openRoad: result.status,
          team: team?.status ?? "not_configured"
        },
        totals: {
          auditEvents: team?.state.auditEvents.length ?? 0,
          integrationInstallations: integrations?.state.installations.length ?? 0,
          integrationMappings: integrations?.state.mappings.length ?? 0,
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

async function handlePortalVoteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  portalRateLimiter: PortalRateLimiter,
  encodedWorkspaceId: string,
  encodedRequestId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const requestId = decodeURIComponent(encodedRequestId);

  try {
    const payload = await readJsonBody(request, 10_000);
    const requester = getPortalRequester(payload, request, workspaceId);
    const requesterAccess = createRequesterAccess(access, workspaceId, requester.id);
    requirePermission(requesterAccess, "portal:interact", workspaceId);

    const result = await store.load();
    const nextState = updatePublicPortalRequest(
      result.state,
      workspaceId,
      requestId,
      "vote",
      (requestItem) => ({
        ...requestItem,
        hasCurrentUserVote: true,
        votes: requestItem.votes + 1
      })
    );
    consumePortalRateLimit(portalRateLimiter, requester.rateLimitKey);
    const state = await store.replaceState(nextState);
    await recordAuditEvent(teamStore, state, requesterAccess, {
      summary: `Public portal vote recorded for ${requestId}.`,
      type: "portal.vote",
      workspaceId
    });
    writeJson(response, 200, getPublicPortalRequestPayload(state, workspaceId, requestId), access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handlePortalCommentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  portalRateLimiter: PortalRateLimiter,
  encodedWorkspaceId: string,
  encodedRequestId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const requestId = decodeURIComponent(encodedRequestId);

  try {
    const payload = await readJsonBody(request, 20_000);
    const requester = getPortalRequester(payload, request, workspaceId);
    const body = getPortalCommentBody(payload);
    const requesterAccess = createRequesterAccess(access, workspaceId, requester.id);
    requirePermission(requesterAccess, "portal:interact", workspaceId);

    const result = await store.load();
    const nextState = updatePublicPortalRequest(
      result.state,
      workspaceId,
      requestId,
      "comment",
      (requestItem) => ({
        ...requestItem,
        comments: [
          ...requestItem.comments,
          {
            age: "just now",
            author: requester.name,
            body,
            id: createEntityId("portal-comment"),
            visibility: "Public"
          }
        ]
      })
    );
    consumePortalRateLimit(portalRateLimiter, requester.rateLimitKey);
    const state = await store.replaceState(nextState);
    await recordAuditEvent(teamStore, state, requesterAccess, {
      summary: `Public portal comment recorded for ${requestId}.`,
      type: "portal.comment",
      workspaceId
    });
    writeJson(response, 201, getPublicPortalRequestPayload(state, workspaceId, requestId), access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

function getStatePayload(payload: unknown) {
  if (isRecord(payload) && "state" in payload) {
    return payload.state;
  }

  return payload;
}

function updatePublicPortalRequest(
  state: OpenRoadState,
  workspaceId: string,
  requestId: string,
  actionKind: PortalActionKind,
  updater: (requestItem: RequestItem) => RequestItem
): OpenRoadState {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new PortalActionError("not_found", 404, "Workspace was not found.");
  }

  assertPortalActionAllowed(workspace, requestId, actionKind);

  return {
    ...state,
    workspaces: state.workspaces.map((item) =>
      item.id === workspaceId
        ? {
            ...item,
            requests: item.requests.map((requestItem) =>
              requestItem.id === requestId ? updater(requestItem) : requestItem
            )
          }
        : item
    )
  };
}

function assertPortalActionAllowed(
  workspace: Workspace,
  requestId: string,
  actionKind: PortalActionKind
) {
  if (!workspace.portal.enabled) {
    throw new PortalActionError("forbidden", 403, "This OpenRoad portal is not accepting public actions.");
  }

  if (actionKind === "vote" && !workspace.portal.allowVoting) {
    throw new PortalActionError("forbidden", 403, "This OpenRoad portal is not accepting votes.");
  }

  if (actionKind === "comment" && !workspace.portal.allowComments) {
    throw new PortalActionError("forbidden", 403, "This OpenRoad portal is not accepting comments.");
  }

  const requestItem = workspace.requests.find((item) => item.id === requestId);

  if (!requestItem || requestItem.visibility !== "Public" || requestItem.archived) {
    throw new PortalActionError("not_found", 404, "Public request was not found.");
  }
}

function getPublicPortalRequestPayload(
  state: OpenRoadState,
  workspaceId: string,
  requestId: string
) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  const request = workspace
    ? createPublicPortalSnapshot(workspace).requests.find((item) => item.id === requestId)
    : undefined;

  if (!request) {
    throw new PortalActionError("not_found", 404, "Public request was not found.");
  }

  return { request, status: "saved" };
}

function getPortalRequester(
  payload: unknown,
  request: IncomingMessage,
  workspaceId: string
): PortalRequester {
  const requester = isRecord(payload) && isRecord(payload.requester) ? payload.requester : {};
  const remoteAddress = request.socket.remoteAddress ?? "unknown";
  const headerRequesterId = getSingleHeader(request.headers, "x-openroad-requester-id");
  const rawId =
    getBoundedText(requester.id, 120) ??
    getBoundedText(headerRequesterId, 120) ??
    `anonymous-${remoteAddress}`;
  const normalizedId = normalizeIdentifier(rawId) || normalizeIdentifier(`anonymous-${remoteAddress}`);
  const name =
    getBoundedText(requester.name, 80) ??
    getBoundedText(isRecord(payload) ? payload.author : undefined, 80) ??
    "Portal visitor";

  return {
    id: normalizedId,
    name,
    rateLimitKey: `${workspaceId}:${remoteAddress}:${normalizedId}`
  };
}

function getPortalCommentBody(payload: unknown) {
  if (!isRecord(payload)) {
    throw new PortalActionError("invalid_request", 400, "Comment payload must be an object.");
  }

  if (typeof payload.body !== "string") {
    throw new PortalActionError("invalid_request", 400, "Comment body is required.");
  }

  const body = payload.body.trim();

  if (!body) {
    throw new PortalActionError("invalid_request", 400, "Comment body is required.");
  }

  if (body.length > 1_200) {
    throw new PortalActionError("invalid_request", 400, "Comment body is too long.");
  }

  return body;
}

function consumePortalRateLimit(
  portalRateLimiter: PortalRateLimiter,
  key: string
) {
  const result = portalRateLimiter.consume(key);

  if (result.allowed) return;

  throw new PortalActionError(
    "rate_limited",
    429,
    `Too many public portal actions. Retry after ${result.retryAfterSeconds ?? 1} seconds.`
  );
}

function createRequesterAccess(
  access: AccessContext,
  workspaceId: string,
  requesterId: string
): AccessContext {
  return {
    ...access,
    actor: {
      id: requesterId,
      type: "requester",
      workspaceId
    }
  };
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

  if (error instanceof IntegrationStoreError) {
    const status = error.code === "future_schema" ? 409 : 422;
    writeApiError(response, status, error.code, error.message, access);
    return;
  }

  if (error instanceof AccessDeniedError) {
    writeApiError(response, error.status, error.code, error.message, access);
    return;
  }

  if (error instanceof ApiRequestError) {
    writeApiError(response, error.status, error.code, error.message, access);
    return;
  }

  if (error instanceof PortalActionError) {
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

function getSingleHeader(headers: IncomingMessage["headers"], name: string) {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getBoundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:@-]+/g, "-").slice(0, 120);
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

class PortalActionError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
