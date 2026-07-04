import { Buffer } from "node:buffer";
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
  disconnectMapping,
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
  createLinearInstallation,
  createLinearIssueExternalRef,
  createLinearIssueMapping,
  createOpenRoadRequestFromLinearIssue,
  getLinearInstallationCapabilities,
  linearRequiredInstallationPermissions,
  parseLinearIssuePayload,
  syncOpenRoadRequestFromLinearIssue,
  type LinearInstallationInput,
  type LinearIssue
} from "../src/integrations/linear.js";
import {
  createJiraInstallation,
  createJiraIssueExternalRef,
  createJiraIssueMapping,
  createOpenRoadRequestFromJiraIssue,
  getJiraInstallationCapabilities,
  jiraRequiredInstallationPermissions,
  parseJiraIssuePayload,
  scopeJiraIssueToCloudId,
  syncOpenRoadRequestFromJiraIssue,
  type JiraInstallationInput,
  type JiraIssue
} from "../src/integrations/jira.js";
import {
  OpenRoadStoreError,
  parseOpenRoadState,
  type OpenRoadStore
} from "./store.js";
import {
  IntegrationStoreError,
  parseIntegrationState,
  sanitizeIntegrationInstallation,
  sanitizeIntegrationSyncEvent,
  type IntegrationState,
  type IntegrationStore,
  type IntegrationSyncEvent
} from "./integrations.js";
import {
  FetchGitHubAppClient,
  GitHubAppClientError,
  createSafeGitHubAppSetup,
  githubAppConfigFromEnv,
  normalizeGitHubAppInstallation,
  verifyGitHubWebhookSignature,
  type GitHubAppClient,
  type GitHubAppConfig
} from "./github-app.js";
import {
  createSafeLinearOAuthSetup,
  linearOAuthConfigFromEnv,
  type LinearOAuthConfig
} from "./linear.js";
import {
  createSafeJiraOAuthSetup,
  jiraOAuthConfigFromEnv,
  type JiraOAuthConfig
} from "./jira.js";
import type { AuditEvent, TeamStore } from "./team.js";

type CreateOpenRoadServerOptions = {
  auth?: AuthOptions;
  distDir?: string;
  githubAppClient?: GitHubAppClient;
  githubAppConfig?: GitHubAppConfig;
  integrationStore?: IntegrationStore;
  jiraOAuthConfig?: JiraOAuthConfig;
  linearOAuthConfig?: LinearOAuthConfig;
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
  | "server_error"
  | "upstream_error";

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
  "replace-notification-settings",
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
  githubAppConfig = githubAppConfigFromEnv(),
  githubAppClient = new FetchGitHubAppClient(githubAppConfig),
  integrationStore,
  jiraOAuthConfig = jiraOAuthConfigFromEnv(),
  linearOAuthConfig = linearOAuthConfigFromEnv(),
  logger = console,
  portalRateLimiter = createPortalRateLimiterFromEnv(),
  store,
  teamStore
}: CreateOpenRoadServerOptions): Server {
  const resolvedDistDir = resolve(distDir);
  const activeGitHubWebhookDeliveries = new Set<string>();

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
          githubAppClient,
          githubAppConfig,
          integrationStore,
          jiraOAuthConfig,
          linearOAuthConfig,
          teamStore,
          portalRateLimiter,
          activeGitHubWebhookDeliveries
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
  githubAppClient: GitHubAppClient,
  githubAppConfig: GitHubAppConfig,
  integrationStore: IntegrationStore | undefined,
  jiraOAuthConfig: JiraOAuthConfig,
  linearOAuthConfig: LinearOAuthConfig,
  teamStore: TeamStore | undefined,
  portalRateLimiter: PortalRateLimiter,
  activeGitHubWebhookDeliveries: Set<string>
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

  const linearIssueImportMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/linear\/issues\/import$/
  );

  if (linearIssueImportMatch) {
    await handleLinearIssueImportRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      linearIssueImportMatch[1]
    );
    return;
  }

  const jiraIssueImportMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/jira\/issues\/import$/
  );

  if (jiraIssueImportMatch) {
    await handleJiraIssueImportRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      jiraIssueImportMatch[1]
    );
    return;
  }

  const linearOAuthSetupMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/linear\/oauth\/setup$/
  );

  if (linearOAuthSetupMatch) {
    await handleLinearOAuthSetupRequest(
      request,
      response,
      store,
      access,
      linearOAuthConfig,
      linearOAuthSetupMatch[1]
    );
    return;
  }

  const jiraOAuthSetupMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/jira\/oauth\/setup$/
  );

  if (jiraOAuthSetupMatch) {
    await handleJiraOAuthSetupRequest(
      request,
      response,
      store,
      access,
      jiraOAuthConfig,
      jiraOAuthSetupMatch[1]
    );
    return;
  }

  const githubAppSetupMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/github\/app\/setup$/
  );

  if (githubAppSetupMatch) {
    await handleGitHubAppSetupRequest(
      request,
      response,
      store,
      access,
      githubAppConfig,
      githubAppSetupMatch[1]
    );
    return;
  }

  const githubAppVerifyMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/github\/app\/installations\/verify$/
  );

  if (githubAppVerifyMatch) {
    await handleGitHubAppInstallationVerifyRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      githubAppClient,
      githubAppVerifyMatch[1]
    );
    return;
  }

  const githubLiveIssueFetchMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/github\/issues\/live$/
  );

  if (githubLiveIssueFetchMatch) {
    await handleGitHubLiveIssueFetchRequest(
      request,
      response,
      requestUrl,
      store,
      access,
      integrationStore,
      githubAppClient,
      githubLiveIssueFetchMatch[1]
    );
    return;
  }

  if (requestUrl.pathname === "/api/openroad/integrations/github/webhook") {
    await handleGitHubWebhookRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      githubAppConfig,
      activeGitHubWebhookDeliveries
    );
    return;
  }

  const githubInstallationDisconnectMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/github\/app\/installations\/([^/]+)\/disconnect$/
  );

  if (githubInstallationDisconnectMatch) {
    await handleGitHubInstallationDisconnectRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      githubInstallationDisconnectMatch[1],
      githubInstallationDisconnectMatch[2]
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
    requireIntegrationActorForInstallation(access, gitHubPayload.installation);
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

type LinearIssueImportPayload = {
  installation: IntegrationInstallation;
  issue: LinearIssue;
  requestId?: string;
  workspaceId: string;
};

type LinearIssueImportStateResult = {
  created: boolean;
  installation: IntegrationInstallation;
  integrationState: IntegrationState;
  mapping: ExternalObjectMapping;
  request: RequestItem;
};

type JiraIssueImportPayload = {
  installation: IntegrationInstallation;
  issue: JiraIssue;
  requestId?: string;
  workspaceId: string;
};

type JiraIssueImportStateResult = {
  created: boolean;
  installation: IntegrationInstallation;
  integrationState: IntegrationState;
  mapping: ExternalObjectMapping;
  request: RequestItem;
};

async function handleLinearIssueImportRequest(
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
    const linearPayload = parseLinearIssueImportPayload(payload, workspaceId);
    requireIntegrationActorForInstallation(access, linearPayload.installation);
    const current = await store.load();
    const workspace = current.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    const integrationResult = await integrationStore.load();
    const importResult = createLinearIssueImportState(
      workspace,
      integrationResult.state,
      linearPayload,
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
      summary: `${importResult.created ? "Imported" : "Updated"} Linear issue ${
        linearPayload.issue.identifier
      }.`,
      type: importResult.created ? "integration.linear.issue.import" : "integration.linear.issue.sync",
      workspaceId
    });

    writeJson(
      response,
      importResult.created ? 201 : 200,
      {
        installation: sanitizeInstallation(importResult.installation),
        mapping: importResult.mapping,
        request: importResult.request,
        revision: auditEvent?.id ?? `linear-import-${Date.now()}`,
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

async function handleJiraIssueImportRequest(
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
    const jiraPayload = parseJiraIssueImportPayload(payload, workspaceId);
    requireIntegrationActorForInstallation(access, jiraPayload.installation);
    const current = await store.load();
    const workspace = current.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    const integrationResult = await integrationStore.load();
    const importResult = createJiraIssueImportState(
      workspace,
      integrationResult.state,
      jiraPayload,
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
      summary: `${importResult.created ? "Imported" : "Updated"} Jira issue ${
        jiraPayload.issue.key
      }.`,
      type: importResult.created ? "integration.jira.issue.import" : "integration.jira.issue.sync",
      workspaceId
    });

    writeJson(
      response,
      importResult.created ? 201 : 200,
      {
        installation: sanitizeInstallation(importResult.installation),
        mapping: importResult.mapping,
        request: importResult.request,
        revision: auditEvent?.id ?? `jira-import-${Date.now()}`,
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

function parseLinearIssueImportPayload(
  payload: unknown,
  workspaceId: string
): LinearIssueImportPayload {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Linear import payload must be an object.");
  }

  try {
    const issue = parseLinearIssuePayload(payload.issue);
    const installation = createLinearInstallation(
      parseLinearInstallationPayload(payload.installation, workspaceId)
    );
    const requestId = getBoundedText(payload.requestId, 120);

    return {
      installation,
      issue,
      requestId,
      workspaceId
    };
  } catch (error) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      error instanceof Error ? error.message : "Linear import payload is invalid."
    );
  }
}

function parseLinearInstallationPayload(
  value: unknown,
  workspaceId: string
): LinearInstallationInput {
  if (!isRecord(value)) {
    throw new Error("Linear installation payload must be an object.");
  }

  const accountId =
    getBoundedText(value.accountId, 160) ??
    getBoundedText(value.providerAccountId, 160) ??
    getBoundedText(value.organizationId, 160) ??
    getBoundedText(value.teamId, 160) ??
    getBoundedText(value.accountName, 160);
  const accountName =
    getBoundedText(value.accountName, 160) ??
    getBoundedText(value.providerAccountName, 160) ??
    getBoundedText(value.organizationName, 160) ??
    getBoundedText(value.teamName, 160) ??
    getBoundedText(value.accountId, 160);
  const id = getBoundedText(value.id, 160);

  if (!id) throw new Error("Linear installation id is required.");
  if (!accountId) throw new Error("Linear account id is required.");
  if (!accountName) throw new Error("Linear account name is required.");

  return {
    accountId,
    accountName,
    createdAt: getBoundedText(value.createdAt, 80),
    id,
    permissions: parseLinearIntegrationPermissions(value.permissions),
    status: parseIntegrationInstallationStatus(value.status),
    workspaceId
  };
}

function parseJiraIssueImportPayload(
  payload: unknown,
  workspaceId: string
): JiraIssueImportPayload {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Jira import payload must be an object.");
  }

  try {
    const installation = createJiraInstallation(
      parseJiraInstallationPayload(payload.installation, workspaceId)
    );
    const issue = scopeJiraIssueToCloudId(
      parseJiraIssuePayload(payload.issue),
      installation.providerAccountId
    );
    const requestId = getBoundedText(payload.requestId, 120);

    return {
      installation,
      issue,
      requestId,
      workspaceId
    };
  } catch (error) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      error instanceof Error ? error.message : "Jira import payload is invalid."
    );
  }
}

function parseJiraInstallationPayload(
  value: unknown,
  workspaceId: string
): JiraInstallationInput {
  if (!isRecord(value)) {
    throw new Error("Jira installation payload must be an object.");
  }

  const accountId =
    getBoundedText(value.accountId, 160) ??
    getBoundedText(value.providerAccountId, 160) ??
    getBoundedText(value.cloudId, 160) ??
    getBoundedText(value.siteId, 160) ??
    getBoundedText(value.accountName, 160);
  const accountName =
    getBoundedText(value.accountName, 160) ??
    getBoundedText(value.providerAccountName, 160) ??
    getBoundedText(value.siteName, 160) ??
    getBoundedText(value.baseUrl, 160) ??
    getBoundedText(value.accountId, 160);
  const id = getBoundedText(value.id, 160);

  if (!id) throw new Error("Jira installation id is required.");
  if (!accountId) throw new Error("Jira account id is required.");
  if (!accountName) throw new Error("Jira account name is required.");

  return {
    accountId,
    accountName,
    createdAt: getBoundedText(value.createdAt, 80),
    id,
    permissions: parseJiraIntegrationPermissions(value.permissions),
    status: parseIntegrationInstallationStatus(value.status),
    workspaceId
  };
}

function createLinearIssueImportState(
  workspace: Workspace,
  integrationState: IntegrationState,
  payload: LinearIssueImportPayload,
  now: string
): LinearIssueImportStateResult {
  if (payload.installation.status !== "active") {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "Linear installation must be active before importing issues."
    );
  }

  if (!getLinearInstallationCapabilities(payload.installation).canImportIssues) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "Linear installation does not have enough permissions to import issues."
    );
  }

  const existingInstallation = integrationState.installations.find((installation) =>
    isSameInstallationScope(installation, payload.installation)
  );

  if (existingInstallation && existingInstallation.status !== "active") {
    throw new ApiRequestError(
      "invalid_state",
      422,
      "Linear installation is disconnected or suspended."
    );
  }

  const issueRef = createLinearIssueExternalRef(payload.issue);
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
      "Linear issue mapping points to a missing OpenRoad request."
    );
  }

  const request = existingRequest
    ? syncOpenRoadRequestFromLinearIssue(existingRequest, payload.issue, now)
    : createOpenRoadRequestFromLinearIssue(payload.issue, {
        existingRequestIds: workspace.requests.map((item) => item.id),
        now
      });
  const openRoad = {
    id: request.id,
    type: "request" as const,
    workspaceId: payload.workspaceId
  };
  const mapping = createLinearIssueMapping(payload.installation, payload.issue, openRoad, now);
  const nextIntegrationState = parseIntegrationState({
    ...integrationState,
    installations: upsertInstallationByScope(integrationState.installations, payload.installation),
    mappings: upsertById(integrationState.mappings, mapping)
  });

  return {
    created: !existingRequest,
    installation: payload.installation,
    integrationState: nextIntegrationState,
    mapping,
    request
  };
}

function createJiraIssueImportState(
  workspace: Workspace,
  integrationState: IntegrationState,
  payload: JiraIssueImportPayload,
  now: string
): JiraIssueImportStateResult {
  if (payload.installation.status !== "active") {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "Jira installation must be active before importing issues."
    );
  }

  if (!getJiraInstallationCapabilities(payload.installation).canImportIssues) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "Jira installation does not have enough permissions to import issues."
    );
  }

  const existingInstallation = integrationState.installations.find((installation) =>
    isSameInstallationScope(installation, payload.installation)
  );

  if (existingInstallation && existingInstallation.status !== "active") {
    throw new ApiRequestError(
      "invalid_state",
      422,
      "Jira installation is disconnected or suspended."
    );
  }

  const issueRef = createJiraIssueExternalRef(payload.issue);
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
      "Jira issue mapping points to a missing OpenRoad request."
    );
  }

  const request = existingRequest
    ? syncOpenRoadRequestFromJiraIssue(existingRequest, payload.issue, now)
    : createOpenRoadRequestFromJiraIssue(payload.issue, {
        existingRequestIds: workspace.requests.map((item) => item.id),
        now
      });
  const openRoad = {
    id: request.id,
    type: "request" as const,
    workspaceId: payload.workspaceId
  };
  const mapping = createJiraIssueMapping(payload.installation, payload.issue, openRoad, now);
  const nextIntegrationState = parseIntegrationState({
    ...integrationState,
    installations: upsertInstallationByScope(integrationState.installations, payload.installation),
    mappings: upsertById(integrationState.mappings, mapping)
  });

  return {
    created: !existingRequest,
    installation: payload.installation,
    integrationState: nextIntegrationState,
    mapping,
    request
  };
}

async function handleLinearOAuthSetupRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  linearOAuthConfig: LinearOAuthConfig,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const result = await store.load();
    const workspace = result.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    writeJson(
      response,
      200,
      {
        linearOAuth: createSafeLinearOAuthSetup(linearOAuthConfig, workspaceId),
        workspace: {
          id: workspace.id,
          name: workspace.name
        }
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleJiraOAuthSetupRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  jiraOAuthConfig: JiraOAuthConfig,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const result = await store.load();
    const workspace = result.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    writeJson(
      response,
      200,
      {
        jiraOAuth: createSafeJiraOAuthSetup(jiraOAuthConfig, workspaceId),
        workspace: {
          id: workspace.id,
          name: workspace.name
        }
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

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

  const existingInstallation = integrationState.installations.find(
    (installation) =>
      installation.provider === payload.installation.provider &&
      installation.workspaceId === payload.workspaceId &&
      doesGitHubInstallationIdMatch(installation.id, payload.installation.id)
  );

  if (existingInstallation && existingInstallation.status !== "active") {
    throw new ApiRequestError(
      "invalid_state",
      422,
      "GitHub installation is disconnected or suspended."
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
    installations: upsertInstallationByScope(integrationState.installations, payload.installation),
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

function parseLinearIntegrationPermissions(value: unknown): IntegrationPermission[] {
  if (!Array.isArray(value)) return linearRequiredInstallationPermissions;

  return value
    .map((permission) => getBoundedText(permission, 80))
    .filter((permission): permission is IntegrationPermission =>
      linearRequiredInstallationPermissions.includes(permission as IntegrationPermission) ||
      permission === "write:external" ||
      permission === "webhook:receive"
    );
}

function parseJiraIntegrationPermissions(value: unknown): IntegrationPermission[] {
  if (!Array.isArray(value)) return jiraRequiredInstallationPermissions;

  return value
    .map((permission) => getBoundedText(permission, 80))
    .filter((permission): permission is IntegrationPermission =>
      jiraRequiredInstallationPermissions.includes(permission as IntegrationPermission)
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
  ref: ExternalObjectMapping["external"]
) {
  return (
    mapping.status !== "disconnected" &&
    createExternalObjectKey(mapping.external) === createExternalObjectKey(ref)
  );
}

function sanitizeInstallation(installation: IntegrationInstallation) {
  return sanitizeIntegrationInstallation(installation);
}

function upsertManyById<T extends { id: string }>(items: T[], nextItems: T[]) {
  return nextItems.reduce((currentItems, nextItem) => upsertById(currentItems, nextItem), items);
}

function upsertInstallationByScope(
  items: IntegrationInstallation[],
  nextItem: IntegrationInstallation
) {
  return [nextItem, ...items.filter((item) => !isSameInstallationScope(item, nextItem))];
}

function replaceInstallationByScope(
  items: IntegrationInstallation[],
  nextItem: IntegrationInstallation
) {
  return items.map((item) => (isSameInstallationScope(item, nextItem) ? nextItem : item));
}

function isSameInstallationScope(
  first: IntegrationInstallation,
  second: IntegrationInstallation
) {
  return (
    first.provider === second.provider &&
    first.workspaceId === second.workspaceId &&
    first.id === second.id
  );
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  return [nextItem, ...items.filter((item) => item.id !== nextItem.id)];
}

async function handleGitHubAppSetupRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  githubAppConfig: GitHubAppConfig,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const result = await store.load();
    const workspace = result.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    writeJson(
      response,
      200,
      {
        githubApp: createSafeGitHubAppSetup(githubAppConfig, workspaceId),
        workspace: {
          id: workspace.id,
          name: workspace.name
        }
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleGitHubAppInstallationVerifyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  githubAppClient: GitHubAppClient,
  encodedWorkspaceId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "integration:manage", workspaceId);

    if (!integrationStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad integration metadata store is not configured."
      );
    }

    const payload = await readJsonBody(request, 50_000);
    const installationId = getGitHubInstallationIdPayload(payload);
    const current = await store.load();
    const workspace = current.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    const githubInstallation = await githubAppClient.getInstallation(installationId);
    let installation;

    try {
      installation = normalizeGitHubAppInstallation(githubInstallation, workspaceId);
    } catch (error) {
      throw new ApiRequestError(
        "upstream_error",
        502,
        error instanceof Error ? error.message : "GitHub installation response was invalid."
      );
    }

    await integrationStore.upsertInstallation(installation);
    const auditEvent = await recordAuditEvent(teamStore, current.state, access, {
      summary: `Verified GitHub App installation ${installation.providerAccountName}.`,
      type: "integration.github.app.verify",
      workspaceId
    });

    writeJson(
      response,
      200,
      {
        installation: sanitizeInstallation(installation),
        revision: auditEvent?.id ?? `github-app-installation-${Date.now()}`,
        status: "verified"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

function getGitHubInstallationIdPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "GitHub installation payload must be an object.");
  }

  const installationId =
    getBoundedText(payload.installationId, 80) ?? getBoundedText(payload.installation_id, 80);

  if (!installationId) {
    throw new ApiRequestError("invalid_request", 400, "GitHub installation id is required.");
  }

  return installationId;
}

async function handleGitHubLiveIssueFetchRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  store: OpenRoadStore,
  access: AccessContext,
  integrationStore: IntegrationStore | undefined,
  githubAppClient: GitHubAppClient,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requireWorkspaceWriteOrIntegrationSync(access, workspaceId);

    if (!integrationStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad integration metadata store is not configured."
      );
    }

    const installationId = getRequiredQueryText(
      requestUrl,
      "installationId",
      "GitHub installation id is required."
    );
    const repository = parseGitHubRepositoryQuery(requestUrl.searchParams.get("repository"));
    const state = parseGitHubIssueStateQuery(requestUrl.searchParams.get("state"));
    const perPage = parsePerPageQuery(requestUrl.searchParams.get("perPage"));
    const current = await store.load();
    const workspace = current.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    const integrationState = await integrationStore.load();
    const installation = getVerifiedGitHubInstallation(
      integrationState.state,
      workspaceId,
      installationId
    );
    const issues = await githubAppClient.listRepositoryIssues({
      installationId: getGitHubApiInstallationId(installation.id),
      owner: repository.owner,
      perPage,
      repo: repository.repo,
      state
    });

    writeJson(
      response,
      200,
      {
        installation: sanitizeInstallation(installation),
        issues: issues.map(createGitHubLiveIssuePreview),
        repository: repository.fullName,
        status: "fetched"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

function requireWorkspaceWriteOrIntegrationSync(access: AccessContext, workspaceId: string) {
  try {
    requirePermission(access, "workspace:write", workspaceId);
  } catch {
    requirePermission(access, "integration:sync", workspaceId);
  }
}

function requireIntegrationActorForInstallation(
  access: AccessContext,
  installation: IntegrationInstallation
) {
  if (access.actor.type !== "integration") return;

  const normalizedActorId = normalizeProviderActorId(access.actor.id);
  const normalizedInstallationId = normalizeProviderActorId(installation.id);
  const expectedPrefix = `${installation.provider}:`;

  if (
    access.actor.workspaceId !== installation.workspaceId ||
    normalizedActorId !== normalizedInstallationId ||
    !normalizedActorId.startsWith(expectedPrefix)
  ) {
    throw new AccessDeniedError(
      "Integration actor is not allowed to write for this provider installation."
    );
  }
}

function normalizeProviderActorId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes(":")) return normalized;
  if (normalized.startsWith("github-")) return `github:${normalized}`;
  if (normalized.startsWith("linear-")) return `linear:${normalized}`;
  if (normalized.startsWith("jira-")) return `jira:${normalized}`;
  return normalized;
}

function getVerifiedGitHubInstallation(
  integrationState: IntegrationState,
  workspaceId: string,
  installationId: string
) {
  const normalizedId = normalizeGitHubInstallationId(installationId);
  const installation = integrationState.installations.find(
    (item) =>
      item.provider === "github" &&
      item.workspaceId === workspaceId &&
      (item.id === normalizedId || item.id === installationId)
  );

  if (!installation) {
    throw new ApiRequestError("not_found", 404, "Verified GitHub installation was not found.");
  }

  if (installation.status !== "active" || !installation.permissions.includes("read:external")) {
    throw new ApiRequestError(
      "invalid_state",
      422,
      "GitHub installation cannot read external issues."
    );
  }

  return installation;
}

function normalizeGitHubInstallationId(value: string) {
  return value.startsWith("github-installation-") ? value : `github-installation-${value}`;
}

function getGitHubApiInstallationId(value: string) {
  return value.replace(/^github-installation-/, "");
}

function parseGitHubRepositoryQuery(value: string | null) {
  const repository = getBoundedText(value, 200);
  const parts = repository?.split("/") ?? [];

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "GitHub repository must use owner/repo format."
    );
  }

  return {
    fullName: `${parts[0]}/${parts[1]}`,
    owner: parts[0],
    repo: parts[1]
  };
}

function parseGitHubIssueStateQuery(value: string | null): "all" | "closed" | "open" {
  if (value === "all" || value === "closed" || value === "open") return value;
  return "open";
}

function parsePerPageQuery(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(100, Math.max(1, parsed));
}

function getRequiredQueryText(requestUrl: URL, key: string, message: string) {
  const value = getBoundedText(requestUrl.searchParams.get(key), 160);
  if (!value) throw new ApiRequestError("invalid_request", 400, message);
  return value;
}

function createGitHubLiveIssuePreview(issue: GitHubIssue) {
  return {
    author: issue.author,
    id: issue.id,
    importPayload: {
      assignees: issue.assignees.map((login) => ({ login })),
      body: issue.body,
      closed_at: issue.closedAt,
      created_at: issue.createdAt,
      html_url: issue.url,
      labels: issue.labels.map((name) => ({ name })),
      milestone: issue.milestone ? { title: issue.milestone } : null,
      node_id: issue.id,
      number: issue.number,
      repository: {
        full_name: issue.repository.fullName,
        html_url: issue.repository.url,
        name: issue.repository.name,
        node_id: issue.repository.id,
        owner: { login: issue.repository.owner },
        private: issue.repository.visibility === "private"
      },
      state: issue.state,
      state_reason: issue.stateReason,
      title: issue.title,
      updated_at: issue.updatedAt,
      user: { login: issue.author }
    },
    labels: issue.labels,
    number: issue.number,
    repository: issue.repository.fullName,
    state: issue.state,
    title: issue.title,
    updatedAt: issue.updatedAt,
    url: issue.url
  };
}

async function handleGitHubWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  githubAppConfig: GitHubAppConfig,
  activeGitHubWebhookDeliveries: Set<string>
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  try {
    if (!integrationStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad integration metadata store is not configured."
      );
    }

    if (!githubAppConfig.webhookSecret) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OPENROAD_GITHUB_APP_WEBHOOK_SECRET is required before receiving webhooks."
      );
    }

    const rawBody = await readRawBody(request, 2_000_000);
    const signatureHeader = getSingleHeader(request.headers, "x-hub-signature-256");
    const deliveryId = getRequiredHeaderText(
      request,
      "x-github-delivery",
      "GitHub delivery id is required."
    );
    const eventName = getRequiredHeaderText(
      request,
      "x-github-event",
      "GitHub webhook event is required."
    );

    if (
      !verifyGitHubWebhookSignature({
        payload: rawBody,
        secret: githubAppConfig.webhookSecret,
        signatureHeader
      })
    ) {
      throw new AccessDeniedError("GitHub webhook signature is invalid.");
    }

    if (activeGitHubWebhookDeliveries.has(deliveryId)) {
      writeJson(
        response,
        200,
        {
          event: createIntegrationSyncEvent({
            deliveryId,
            eventName,
            now: new Date().toISOString(),
            result: "duplicate",
            summary: `Duplicate GitHub delivery ${deliveryId} is already processing.`
          }),
          status: "duplicate"
        },
        access
      );
      return;
    }

    activeGitHubWebhookDeliveries.add(deliveryId);

    try {
      const payload = parseJsonBuffer(rawBody);
      const current = await store.load();
      const integrationResult = await integrationStore.load();
      const duplicateEvent = integrationResult.state.syncEvents.find(
        (item) => item.provider === "github" && item.deliveryId === deliveryId
      );

      if (duplicateEvent) {
        writeJson(
          response,
          200,
          {
            event: sanitizeIntegrationSyncEvent({
              ...duplicateEvent,
              result: "duplicate",
              summary: `Duplicate GitHub delivery ${deliveryId} ignored.`
            }),
            status: "duplicate"
          },
          access
        );
        return;
      }

      const result = processGitHubWebhookDelivery({
        deliveryId,
        eventName,
        integrationState: integrationResult.state,
        now: new Date().toISOString(),
        openRoadState: current.state,
        payload
      });
      const state =
        result.openRoadState === current.state
          ? current.state
          : await store.replaceState(result.openRoadState);
      const integrationState = await integrationStore.replaceState(result.integrationState);

      if (result.audit && result.audit.workspaceId) {
        await recordAuditEvent(
          teamStore,
          state,
          createIntegrationAccess(access, result.audit.workspaceId, result.audit.installationId),
          result.audit
        );
      }

      writeJson(
        response,
        202,
        {
          event: sanitizeIntegrationSyncEvent(result.event),
          status: result.event.result,
          totals: {
            installations: integrationState.installations.length,
            mappings: integrationState.mappings.length,
            syncEvents: integrationState.syncEvents.length
          }
        },
        access
      );
    } finally {
      activeGitHubWebhookDeliveries.delete(deliveryId);
    }
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleGitHubInstallationDisconnectRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  encodedWorkspaceId: string,
  encodedInstallationId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const installationId = decodeURIComponent(encodedInstallationId);

  try {
    requirePermission(access, "integration:manage", workspaceId);

    if (!integrationStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad integration metadata store is not configured."
      );
    }

    const current = await store.load();
    const workspace = current.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    const integrationResult = await integrationStore.load();
    const disconnected = disconnectGitHubInstallationState(
      integrationResult.state,
      workspaceId,
      installationId,
      new Date().toISOString()
    );
    const integrationState = await integrationStore.replaceState(disconnected.integrationState);
    const auditEvent = await recordAuditEvent(teamStore, current.state, access, {
      summary: `Disconnected GitHub installation ${disconnected.installation.providerAccountName}.`,
      type: "integration.github.app.disconnect",
      workspaceId
    });

    writeJson(
      response,
      200,
      {
        disconnectedMappings: disconnected.disconnectedMappings,
        installation: sanitizeInstallation(disconnected.installation),
        revision: auditEvent?.id ?? `github-disconnect-${Date.now()}`,
        status: "disconnected",
        totals: {
          installations: integrationState.installations.length,
          mappings: integrationState.mappings.length,
          syncEvents: integrationState.syncEvents.length
        }
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

type GitHubWebhookProcessInput = {
  deliveryId: string;
  eventName: string;
  integrationState: IntegrationState;
  now: string;
  openRoadState: OpenRoadState;
  payload: unknown;
};

type GitHubWebhookProcessResult = {
  audit?: Pick<AuditEvent, "summary" | "type" | "workspaceId"> & { installationId: string };
  event: IntegrationSyncEvent;
  integrationState: IntegrationState;
  openRoadState: OpenRoadState;
};

function processGitHubWebhookDelivery({
  deliveryId,
  eventName,
  integrationState,
  now,
  openRoadState,
  payload
}: GitHubWebhookProcessInput): GitHubWebhookProcessResult {
  if (eventName === "issues") {
    return processGitHubIssueWebhook({
      deliveryId,
      eventName,
      integrationState,
      now,
      openRoadState,
      payload
    });
  }

  if (eventName === "installation") {
    return processGitHubInstallationWebhook({
      deliveryId,
      eventName,
      integrationState,
      now,
      openRoadState,
      payload
    });
  }

  const event = createIntegrationSyncEvent({
    deliveryId,
    eventName,
    now,
    result: "ignored",
    summary: `GitHub webhook event ${eventName} is not handled yet.`
  });

  return {
    event,
    integrationState: appendIntegrationSyncEvent(integrationState, event),
    openRoadState
  };
}

function processGitHubIssueWebhook(input: GitHubWebhookProcessInput): GitHubWebhookProcessResult {
  const { deliveryId, eventName, integrationState, now, openRoadState, payload } = input;
  const installationId = getGitHubWebhookInstallationId(payload);
  const issue = parseGitHubWebhookIssue(payload);
  const issueRef = createGitHubIssueExternalRef(issue);
  const activeInstallations = integrationState.installations.filter(
    (installation) =>
      installation.provider === "github" &&
      installation.status === "active" &&
      doesGitHubInstallationIdMatch(installation.id, installationId)
  );
  const eligibleMappings = integrationState.mappings.filter((mapping) =>
    activeInstallations.some(
      (installation) =>
        mapping.status !== "disconnected" &&
        mapping.installationId === installation.id &&
        mapping.openRoad.workspaceId === installation.workspaceId &&
        isSameExternalObject(mapping, issueRef)
    )
  );

  if (eligibleMappings.length === 0) {
    const event = createIntegrationSyncEvent({
      deliveryId,
      eventName,
      installationId: normalizeGitHubInstallationId(installationId),
      now,
      result: "ignored",
      summary: `No linked OpenRoad request for GitHub issue ${issue.repository.fullName}#${issue.number}.`
    });

    return {
      event,
      integrationState: appendIntegrationSyncEvent(integrationState, event),
      openRoadState
    };
  }

  let nextOpenRoadState = openRoadState;
  let nextMappings = integrationState.mappings;
  const workspaceIds = new Set<string>();
  let syncedCount = 0;

  for (const mapping of eligibleMappings) {
    const workspace = nextOpenRoadState.workspaces.find(
      (item) => item.id === mapping.openRoad.workspaceId
    );
    const request = workspace?.requests.find((item) => item.id === mapping.openRoad.id);

    if (!workspace || !request || mapping.openRoad.type !== "request") {
      continue;
    }

    const nextRequest = syncOpenRoadRequestFromGitHubIssue(request, issue, now);
    nextOpenRoadState = parseOpenRoadState(
      openRoadReducer(nextOpenRoadState, {
        request: nextRequest,
        type: "replace-request",
        workspaceId: workspace.id
      })
    );
    nextMappings = upsertById(nextMappings, { ...mapping, lastSyncedAt: now });
    workspaceIds.add(workspace.id);
    syncedCount += 1;
  }

  const result = syncedCount > 0 ? "synced" : "ignored";
  const summary =
    syncedCount > 0
      ? `Synced GitHub issue ${issue.repository.fullName}#${issue.number} to ${syncedCount} OpenRoad request${syncedCount === 1 ? "" : "s"}.`
      : `Linked GitHub issue ${issue.repository.fullName}#${issue.number} had no matching request to update.`;
  const event = createIntegrationSyncEvent({
    deliveryId,
    eventName,
    installationId: normalizeGitHubInstallationId(installationId),
    now,
    result,
    summary,
    workspaceId: [...workspaceIds][0]
  });

  return {
    audit:
      syncedCount > 0
        ? {
            installationId: normalizeGitHubInstallationId(installationId),
            summary,
            type: "integration.github.webhook.issue",
            workspaceId: [...workspaceIds][0]
          }
        : undefined,
    event,
    integrationState: appendIntegrationSyncEvent(
      parseIntegrationState({
        ...integrationState,
        mappings: nextMappings
      }),
      event
    ),
    openRoadState: nextOpenRoadState
  };
}

function processGitHubInstallationWebhook(
  input: GitHubWebhookProcessInput
): GitHubWebhookProcessResult {
  const { deliveryId, eventName, integrationState, now, openRoadState, payload } = input;
  const installationId = getGitHubWebhookInstallationId(payload);
  const action = getGitHubWebhookAction(payload);
  const nextStatus =
    action === "deleted"
      ? "disconnected"
      : action === "suspend"
        ? "suspended"
        : action === "unsuspend"
          ? "active"
          : undefined;

  if (!nextStatus) {
    const event = createIntegrationSyncEvent({
      deliveryId,
      eventName,
      installationId: normalizeGitHubInstallationId(installationId),
      now,
      result: "ignored",
      summary: `GitHub installation action ${action ?? "unknown"} is not handled yet.`
    });

    return {
      event,
      integrationState: appendIntegrationSyncEvent(integrationState, event),
      openRoadState
    };
  }

  const matchingInstallations = integrationState.installations.filter(
    (installation) =>
      installation.provider === "github" &&
      doesGitHubInstallationIdMatch(installation.id, installationId)
  );

  if (matchingInstallations.length === 0) {
    const event = createIntegrationSyncEvent({
      deliveryId,
      eventName,
      installationId: normalizeGitHubInstallationId(installationId),
      now,
      result: "ignored",
      summary: `No OpenRoad workspace is connected to GitHub installation ${installationId}.`
    });

    return {
      event,
      integrationState: appendIntegrationSyncEvent(integrationState, event),
      openRoadState
    };
  }

  const affectedInstallations = matchingInstallations.filter((installation) =>
    shouldApplyGitHubInstallationWebhookStatus(installation, nextStatus)
  );

  if (affectedInstallations.length === 0) {
    const event = createIntegrationSyncEvent({
      deliveryId,
      eventName,
      installationId: normalizeGitHubInstallationId(installationId),
      now,
      result: "ignored",
      summary: `GitHub installation ${installationId} had no ${action} state change to apply.`
    });

    return {
      event,
      integrationState: appendIntegrationSyncEvent(integrationState, event),
      openRoadState
    };
  }

  const nextInstallations = integrationState.installations.map((installation) =>
    affectedInstallations.some((affected) => isSameInstallationScope(installation, affected))
      ? { ...installation, status: nextStatus }
      : installation
  );
  const nextMappings =
    nextStatus === "disconnected"
      ? integrationState.mappings.map((mapping) =>
          isMappingForAnyInstallation(mapping, affectedInstallations) &&
          mapping.status !== "disconnected"
            ? disconnectMapping(mapping, now)
            : mapping
        )
      : integrationState.mappings;
  const workspaceIds = [...new Set(affectedInstallations.map((installation) => installation.workspaceId))];
  const disconnectedMappings =
    nextStatus === "disconnected"
      ? integrationState.mappings.filter(
          (mapping) =>
            isMappingForAnyInstallation(mapping, affectedInstallations) &&
            mapping.status !== "disconnected"
        ).length
      : 0;
  const summary =
    nextStatus === "disconnected"
      ? `Disconnected GitHub installation ${installationId} from ${affectedInstallations.length} OpenRoad workspace${affectedInstallations.length === 1 ? "" : "s"}.`
      : `Marked GitHub installation ${installationId} as ${nextStatus}.`;
  const event = createIntegrationSyncEvent({
    deliveryId,
    eventName,
    installationId: normalizeGitHubInstallationId(installationId),
    now,
    result: "synced",
    summary,
    workspaceId: workspaceIds[0]
  });

  return {
    audit: {
      installationId: normalizeGitHubInstallationId(installationId),
      summary:
        nextStatus === "disconnected"
          ? `${summary} ${disconnectedMappings} mapping${disconnectedMappings === 1 ? "" : "s"} marked disconnected.`
          : summary,
      type: `integration.github.webhook.installation.${nextStatus}`,
      workspaceId: workspaceIds[0]
    },
    event,
    integrationState: appendIntegrationSyncEvent(
      parseIntegrationState({
        ...integrationState,
        installations: nextInstallations,
        mappings: nextMappings
      }),
      event
    ),
    openRoadState
  };
}

function disconnectGitHubInstallationState(
  integrationState: IntegrationState,
  workspaceId: string,
  installationId: string,
  now: string
) {
  const installation = integrationState.installations.find(
    (item) =>
      item.provider === "github" &&
      item.workspaceId === workspaceId &&
      doesGitHubInstallationIdMatch(item.id, installationId)
  );

  if (!installation) {
    throw new ApiRequestError("not_found", 404, "GitHub installation was not found.");
  }

  const nextInstallation = { ...installation, status: "disconnected" as const };
  let disconnectedMappings = 0;
  const mappings = integrationState.mappings.map((mapping) => {
    if (
      mapping.installationId === installation.id &&
      mapping.openRoad.workspaceId === workspaceId &&
      mapping.status !== "disconnected"
    ) {
      disconnectedMappings += 1;
      return disconnectMapping(mapping, now);
    }

    return mapping;
  });

  return {
    disconnectedMappings,
    installation: nextInstallation,
    integrationState: parseIntegrationState({
      ...integrationState,
      installations: replaceInstallationByScope(integrationState.installations, nextInstallation),
      mappings
    })
  };
}

function shouldApplyGitHubInstallationWebhookStatus(
  installation: IntegrationInstallation,
  nextStatus: IntegrationInstallation["status"]
) {
  if (nextStatus === "disconnected") return installation.status !== "disconnected";
  if (nextStatus === "suspended") return installation.status === "active";
  return installation.status === "suspended";
}

function isMappingForAnyInstallation(
  mapping: ExternalObjectMapping,
  installations: IntegrationInstallation[]
) {
  return installations.some(
    (installation) =>
      mapping.external.provider === installation.provider &&
      mapping.installationId === installation.id &&
      mapping.openRoad.workspaceId === installation.workspaceId
  );
}

function parseGitHubWebhookIssue(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.issue)) {
    throw new ApiRequestError("invalid_request", 400, "GitHub issue webhook payload is invalid.");
  }

  try {
    return parseGitHubIssuePayload({
      ...payload.issue,
      repository: payload.repository
    });
  } catch (error) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      error instanceof Error ? error.message : "GitHub issue webhook payload is invalid."
    );
  }
}

function getGitHubWebhookInstallationId(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.installation)) {
    throw new ApiRequestError("invalid_request", 400, "GitHub installation payload is required.");
  }

  const installationId = getBoundedIdentifier(payload.installation.id, 160);
  if (!installationId) {
    throw new ApiRequestError("invalid_request", 400, "GitHub installation id is required.");
  }

  return installationId;
}

function getGitHubWebhookAction(payload: unknown) {
  if (!isRecord(payload)) return undefined;
  return getBoundedText(payload.action, 80);
}

function doesGitHubInstallationIdMatch(storedId: string, candidateId: string) {
  const normalizedCandidate = normalizeGitHubInstallationId(candidateId);
  return (
    storedId === candidateId ||
    storedId === normalizedCandidate ||
    normalizeGitHubInstallationId(storedId) === normalizedCandidate
  );
}

function appendIntegrationSyncEvent(
  integrationState: IntegrationState,
  event: IntegrationSyncEvent
) {
  return parseIntegrationState({
    ...integrationState,
    syncEvents: [
      event,
      ...integrationState.syncEvents.filter(
        (item) => !(item.provider === event.provider && item.deliveryId === event.deliveryId)
      )
    ].slice(0, 1000)
  });
}

function createIntegrationSyncEvent({
  deliveryId,
  eventName,
  installationId,
  now,
  result,
  summary,
  workspaceId
}: {
  deliveryId: string;
  eventName: string;
  installationId?: string;
  now: string;
  result: IntegrationSyncEvent["result"];
  summary: string;
  workspaceId?: string;
}): IntegrationSyncEvent {
  return {
    createdAt: now,
    deliveryId,
    event: eventName,
    id: `github-webhook-${normalizeIdentifier(deliveryId)}`,
    ...(installationId ? { installationId } : {}),
    provider: "github",
    result,
    summary: summary.slice(0, 500),
    ...(workspaceId ? { workspaceId } : {})
  };
}

function createIntegrationAccess(
  access: AccessContext,
  workspaceId: string,
  installationId: string
): AccessContext {
  return {
    ...access,
    actor: {
      id: installationId,
      type: "integration",
      workspaceId
    }
  };
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
          integrationSyncEvents: integrations?.state.syncEvents.length ?? 0,
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
  return parseJsonBuffer(await readRawBody(request, maxBytes));
}

async function readRawBody(request: IncomingMessage, maxBytes = 2_000_000) {
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

  return Buffer.concat(chunks);
}

function parseJsonBuffer(body: Buffer) {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
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

  if (error instanceof GitHubAppClientError) {
    const status = error.code === "missing_config" ? 503 : (error.status ?? 502);
    writeApiError(
      response,
      status,
      error.code === "missing_config" ? "not_configured" : "upstream_error",
      error.message,
      access
    );
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

function getRequiredHeaderText(request: IncomingMessage, name: string, message: string) {
  const value = getBoundedText(getSingleHeader(request.headers, name), 200);
  if (!value) throw new ApiRequestError("invalid_request", 400, message);
  return value;
}

function getBoundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function getBoundedIdentifier(value: unknown, maxLength: number) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, maxLength);
  return getBoundedText(value, maxLength);
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
