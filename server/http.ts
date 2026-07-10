import { Buffer } from "node:buffer";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
  type AuthOptions,
  type WorkspaceRole
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
  integrationPermissions,
  integrationProviders,
  type ExternalObjectMapping,
  type IntegrationInstallation,
  type IntegrationPermission,
  type IntegrationProvider
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
  createIntegrationCredentialSecretContext,
  parseIntegrationState,
  revokeIntegrationCredential,
  revokeIntegrationCredentialsForInstallation,
  sanitizeIntegrationCredentialMetadata,
  sanitizeIntegrationInstallation,
  sanitizeIntegrationSyncEvent,
  type IntegrationCredential,
  type IntegrationState,
  type IntegrationStore,
  type IntegrationSyncJob,
  type IntegrationSyncJobReason,
  type IntegrationSyncEvent
} from "./integrations.js";
import {
  createIntegrationTokenVaultFromEnv,
  type IntegrationTokenVault
} from "./token-vault.js";
import {
  createExclusiveRunner,
  createNotificationDeliveryAdapterFromEnv,
  deliverRequesterNotifications,
  mergeNotificationDeliveryState,
  type NotificationDeliveryRunner,
  type NotificationDeliveryAdapter
} from "./notifications.js";
import {
  createAccountRecoveryDeliveryAdapterFromEnv,
  resolveAccountRecoveryPublicBaseUrl,
  type AccountRecoveryDeliveryAdapter,
  type AccountRecoveryDeliveryAttemptSummary
} from "./account-recovery-delivery.js";
import {
  createInvitationDeliveryAdapterFromEnv,
  resolveInvitationDeliveryPublicBaseUrl,
  type InvitationDeliveryAdapter,
  type InvitationDeliveryAttemptSummary
} from "./invitation-delivery.js";
import {
  IntegrationSyncJobError,
  claimDueIntegrationSyncJobs,
  completeIntegrationSyncJob,
  enqueueIntegrationSyncJob,
  failIntegrationSyncJob,
  mergeIntegrationSyncJobUpdates,
  type IntegrationSyncWorker
} from "./sync-jobs.js";
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
  canConfigureGitHubIntegrationSyncWorker,
  createGitHubIntegrationSyncWorker
} from "./github-sync-worker.js";
import {
  FetchLinearApiClient,
  type LinearApiClient
} from "./linear-api.js";
import {
  canConfigureLinearIntegrationSyncWorker,
  createLinearIntegrationSyncWorker
} from "./linear-sync-worker.js";
import {
  createProviderIntegrationSyncWorker,
  type ProviderIntegrationSyncWorkers
} from "./provider-sync-worker.js";
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
import {
  FetchJiraApiClient,
  type JiraApiClient
} from "./jira-api.js";
import {
  canConfigureJiraIntegrationSyncWorker,
  createJiraIntegrationSyncWorker
} from "./jira-sync-worker.js";
import {
  TeamStoreError,
  type AuditEvent,
  type TeamAccountRecoverySummary,
  type TeamInvitationSummary,
  type TeamWorkspaceMemberSummary,
  type TeamStore
} from "./team.js";
import {
  SessionStoreError,
  getSessionCookieValue,
  sessionCookieName,
  type SessionStore
} from "./session-store.js";

type CreateOpenRoadServerOptions = {
  accountRecoveryDeliveryAdapter?: AccountRecoveryDeliveryAdapter;
  accountRecoveryPublicBaseUrl?: string;
  auth?: AuthOptions;
  distDir?: string;
  githubAppClient?: GitHubAppClient;
  githubAppConfig?: GitHubAppConfig;
  integrationStore?: IntegrationStore;
  integrationSyncWorker?: IntegrationSyncWorker;
  invitationDeliveryAdapter?: InvitationDeliveryAdapter;
  invitationDeliveryPublicBaseUrl?: string;
  jiraApiClient?: JiraApiClient;
  jiraOAuthConfig?: JiraOAuthConfig;
  linearApiClient?: LinearApiClient;
  linearOAuthConfig?: LinearOAuthConfig;
  logger?: Pick<Console, "error" | "log">;
  notificationDeliveryAdapter?: NotificationDeliveryAdapter;
  portalRateLimiter?: PortalRateLimiter;
  sessionStore?: SessionStore;
  store: OpenRoadStore;
  teamStore?: TeamStore;
  tokenVault?: IntegrationTokenVault;
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
  | "queue_full"
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

const portalVisitorCookieName = "openroad_portal_visitor";
const portalVisitorCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

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
  cookieHeaders: Record<string, string>;
  id: string;
  name: string;
  rateLimitKey: string;
  visitorId: string;
  voterKey: string;
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
  accountRecoveryDeliveryAdapter = createAccountRecoveryDeliveryAdapterFromEnv(),
  accountRecoveryPublicBaseUrl = resolveAccountRecoveryPublicBaseUrl(),
  auth,
  distDir = resolve("dist"),
  githubAppConfig = githubAppConfigFromEnv(),
  githubAppClient = new FetchGitHubAppClient(githubAppConfig),
  integrationStore,
  integrationSyncWorker,
  invitationDeliveryAdapter = createInvitationDeliveryAdapterFromEnv(),
  invitationDeliveryPublicBaseUrl = resolveInvitationDeliveryPublicBaseUrl(),
  jiraApiClient = new FetchJiraApiClient(),
  jiraOAuthConfig = jiraOAuthConfigFromEnv(),
  linearApiClient = new FetchLinearApiClient(),
  linearOAuthConfig = linearOAuthConfigFromEnv(),
  logger = console,
  notificationDeliveryAdapter = createNotificationDeliveryAdapterFromEnv(),
  portalRateLimiter = createPortalRateLimiterFromEnv(),
  sessionStore,
  store,
  teamStore,
  tokenVault = createIntegrationTokenVaultFromEnv()
}: CreateOpenRoadServerOptions): Server {
  const resolvedDistDir = resolve(distDir);
  const activeGitHubWebhookDeliveries = new Set<string>();
  const runNotificationDeliveryExclusive = createExclusiveRunner();
  const runIntegrationMutationExclusive = createExclusiveRunner();
  const runIntegrationSyncExclusive = createExclusiveRunner();
  const configuredIntegrationSyncWorkers = createConfiguredIntegrationSyncWorkers({
    githubAppClient,
    githubAppConfig,
    integrationStore,
    jiraApiClient,
    linearApiClient,
    runIntegrationMutationExclusive,
    store,
    tokenVault
  });
  const resolvedIntegrationSyncWorker =
    integrationSyncWorker ?? createProviderIntegrationSyncWorker(configuredIntegrationSyncWorkers);
  const configuredIntegrationSyncProviders = new Set<IntegrationProvider>(
    integrationSyncWorker
      ? ["github", "jira", "linear"]
      : (Object.keys(configuredIntegrationSyncWorkers) as IntegrationProvider[])
  );

  return createServer(async (request, response) => {
    let access = createAccessContext(request, auth);

    try {
      const sessionActor = await resolveSessionActorForRequest(request, auth, sessionStore);
      access = createAccessContext(request, { ...(auth ?? {}), sessionActor });
      const requestUrl = new URL(request.url ?? "/", "http://openroad.local");

      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApiRequest(
          request,
          response,
          requestUrl,
          store,
          access,
          auth,
          sessionStore,
          githubAppClient,
          githubAppConfig,
          integrationStore,
          resolvedIntegrationSyncWorker,
          configuredIntegrationSyncProviders,
          jiraOAuthConfig,
          linearOAuthConfig,
          accountRecoveryDeliveryAdapter,
          accountRecoveryPublicBaseUrl,
          invitationDeliveryAdapter,
          invitationDeliveryPublicBaseUrl,
          notificationDeliveryAdapter,
          runNotificationDeliveryExclusive,
          runIntegrationMutationExclusive,
          runIntegrationSyncExclusive,
          teamStore,
          portalRateLimiter,
          activeGitHubWebhookDeliveries,
          tokenVault
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

function createConfiguredIntegrationSyncWorkers({
  githubAppClient,
  githubAppConfig,
  integrationStore,
  jiraApiClient,
  linearApiClient,
  runIntegrationMutationExclusive,
  store,
  tokenVault
}: {
  githubAppClient: GitHubAppClient;
  githubAppConfig: GitHubAppConfig;
  integrationStore: IntegrationStore | undefined;
  jiraApiClient: JiraApiClient;
  linearApiClient: LinearApiClient;
  runIntegrationMutationExclusive: NotificationDeliveryRunner;
  store: OpenRoadStore;
  tokenVault: IntegrationTokenVault;
}): ProviderIntegrationSyncWorkers {
  if (!integrationStore) return {};

  return {
    ...(canConfigureGitHubIntegrationSyncWorker(githubAppConfig)
      ? {
          github: createGitHubIntegrationSyncWorker({
            githubAppClient,
            integrationStore,
            runIntegrationMutationExclusive,
            store
          })
        }
      : {}),
    ...(canConfigureJiraIntegrationSyncWorker(tokenVault)
      ? {
          jira: createJiraIntegrationSyncWorker({
            integrationStore,
            jiraApiClient,
            runIntegrationMutationExclusive,
            store,
            tokenVault
          })
        }
      : {}),
    ...(canConfigureLinearIntegrationSyncWorker(tokenVault)
      ? {
          linear: createLinearIntegrationSyncWorker({
            integrationStore,
            linearApiClient,
            runIntegrationMutationExclusive,
            store,
            tokenVault
          })
        }
      : {})
  };
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined,
  githubAppClient: GitHubAppClient,
  githubAppConfig: GitHubAppConfig,
  integrationStore: IntegrationStore | undefined,
  integrationSyncWorker: IntegrationSyncWorker | undefined,
  configuredIntegrationSyncProviders: Set<IntegrationProvider>,
  jiraOAuthConfig: JiraOAuthConfig,
  linearOAuthConfig: LinearOAuthConfig,
  accountRecoveryDeliveryAdapter: AccountRecoveryDeliveryAdapter | undefined,
  accountRecoveryPublicBaseUrl: string | undefined,
  invitationDeliveryAdapter: InvitationDeliveryAdapter | undefined,
  invitationDeliveryPublicBaseUrl: string | undefined,
  notificationDeliveryAdapter: NotificationDeliveryAdapter | undefined,
  runNotificationDeliveryExclusive: NotificationDeliveryRunner,
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
  runIntegrationSyncExclusive: NotificationDeliveryRunner,
  teamStore: TeamStore | undefined,
  portalRateLimiter: PortalRateLimiter,
  activeGitHubWebhookDeliveries: Set<string>,
  tokenVault: IntegrationTokenVault
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
          sessionCookieEnabled: Boolean(sessionStore),
          singleUserMode: isSingleUserAuthEnabled(auth),
          trustedProxyHeadersEnabled: Boolean(auth?.trustProxyHeaders)
        }
      }
    }, access);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/auth/login") {
    await handleLoginRequest(request, response, store, access, auth, sessionStore, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/auth/password/login") {
    await handlePasswordLoginRequest(request, response, store, access, auth, sessionStore, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/account/recovery/request") {
    await handleAccountRecoveryRequest(
      request,
      response,
      store,
      access,
      teamStore,
      accountRecoveryDeliveryAdapter,
      accountRecoveryPublicBaseUrl
    );
    return;
  }

  if (requestUrl.pathname === "/api/openroad/account/recovery/confirm") {
    await handleAccountRecoveryConfirmRequest(
      request,
      response,
      store,
      access,
      auth,
      sessionStore,
      teamStore
    );
    return;
  }

  if (requestUrl.pathname === "/api/openroad/auth/logout") {
    await handleLogoutRequest(request, response, store, access, auth, sessionStore, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/account/password") {
    await handleAccountPasswordRequest(request, response, store, access, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/invitations/accept") {
    await handleInvitationAcceptRequest(request, response, store, access, teamStore);
    return;
  }

  if (requestUrl.pathname === "/api/openroad/invitations/session") {
    await handleInvitationSessionRequest(
      request,
      response,
      store,
      access,
      auth,
      sessionStore,
      teamStore
    );
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
    await handleSessionRequest(request, response, store, access, auth, sessionStore, teamStore);
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

  if (requestUrl.pathname === "/api/openroad/notifications/deliver") {
    await handleNotificationDeliveryRequest(
      request,
      response,
      store,
      access,
      teamStore,
      notificationDeliveryAdapter,
      runNotificationDeliveryExclusive
    );
    return;
  }

  if (requestUrl.pathname === "/api/openroad/integrations/sync/run") {
    await handleIntegrationSyncRunRequest(
      request,
      response,
      access,
      teamStore,
      store,
      integrationStore,
      integrationSyncWorker,
      runIntegrationMutationExclusive,
      runIntegrationSyncExclusive
    );
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
      runIntegrationMutationExclusive,
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
      runIntegrationMutationExclusive,
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
      runIntegrationMutationExclusive,
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
      runIntegrationMutationExclusive,
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
      runIntegrationMutationExclusive,
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
      runIntegrationMutationExclusive,
      githubInstallationDisconnectMatch[1],
      githubInstallationDisconnectMatch[2]
    );
    return;
  }

  const integrationStatusMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/status$/
  );

  if (integrationStatusMatch) {
    await handleIntegrationStatusRequest(
      request,
      response,
      store,
      access,
      integrationStore,
      integrationSyncWorker,
      configuredIntegrationSyncProviders,
      githubAppConfig,
      linearOAuthConfig,
      jiraOAuthConfig,
      integrationStatusMatch[1]
    );
    return;
  }

  const integrationInstallationsMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/([^/]+)\/installations$/
  );

  if (integrationInstallationsMatch) {
    await handleIntegrationInstallationCollectionRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      runIntegrationMutationExclusive,
      integrationInstallationsMatch[1],
      integrationInstallationsMatch[2]
    );
    return;
  }

  const integrationInstallationDisconnectMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/([^/]+)\/installations\/([^/]+)\/disconnect$/
  );

  if (integrationInstallationDisconnectMatch) {
    await handleIntegrationInstallationDisconnectRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      runIntegrationMutationExclusive,
      integrationInstallationDisconnectMatch[1],
      integrationInstallationDisconnectMatch[2],
      integrationInstallationDisconnectMatch[3]
    );
    return;
  }

  const integrationCredentialsMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/([^/]+)\/credentials$/
  );

  if (integrationCredentialsMatch) {
    await handleIntegrationCredentialCollectionRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      runIntegrationMutationExclusive,
      tokenVault,
      integrationCredentialsMatch[1],
      integrationCredentialsMatch[2]
    );
    return;
  }

  const integrationCredentialRevokeMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/([^/]+)\/credentials\/([^/]+)\/revoke$/
  );

  if (integrationCredentialRevokeMatch) {
    await handleIntegrationCredentialRevokeRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      runIntegrationMutationExclusive,
      integrationCredentialRevokeMatch[1],
      integrationCredentialRevokeMatch[2],
      integrationCredentialRevokeMatch[3]
    );
    return;
  }

  const integrationSyncJobMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/integrations\/([^/]+)\/sync\/jobs$/
  );

  if (integrationSyncJobMatch) {
    await handleIntegrationSyncJobEnqueueRequest(
      request,
      response,
      store,
      access,
      teamStore,
      integrationStore,
      runIntegrationMutationExclusive,
      integrationSyncJobMatch[1],
      integrationSyncJobMatch[2]
    );
    return;
  }

  const workspaceMembersMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/members$/
  );

  if (workspaceMembersMatch) {
    await handleWorkspaceMemberCollectionRequest(
      request,
      response,
      store,
      access,
      teamStore,
      workspaceMembersMatch[1]
    );
    return;
  }

  const workspaceMemberDeactivateMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/members\/([^/]+)\/deactivate$/
  );

  if (workspaceMemberDeactivateMatch) {
    await handleWorkspaceMemberDeactivateRequest(
      request,
      response,
      store,
      access,
      teamStore,
      sessionStore,
      workspaceMemberDeactivateMatch[1],
      workspaceMemberDeactivateMatch[2]
    );
    return;
  }

  const workspaceMemberMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/members\/([^/]+)$/
  );

  if (workspaceMemberMatch) {
    await handleWorkspaceMemberRequest(
      request,
      response,
      store,
      access,
      teamStore,
      sessionStore,
      workspaceMemberMatch[1],
      workspaceMemberMatch[2]
    );
    return;
  }

  const workspaceInvitationsMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/invitations$/
  );

  if (workspaceInvitationsMatch) {
    await handleWorkspaceInvitationCollectionRequest(
      request,
      response,
      store,
      access,
      auth,
      teamStore,
      invitationDeliveryAdapter,
      invitationDeliveryPublicBaseUrl,
      workspaceInvitationsMatch[1]
    );
    return;
  }

  const workspaceInvitationRevokeMatch = requestUrl.pathname.match(
    /^\/api\/openroad\/workspaces\/([^/]+)\/invitations\/([^/]+)\/revoke$/
  );

  if (workspaceInvitationRevokeMatch) {
    await handleWorkspaceInvitationRevokeRequest(
      request,
      response,
      store,
      access,
      teamStore,
      workspaceInvitationRevokeMatch[1],
      workspaceInvitationRevokeMatch[2]
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
    await handleWorkspaceRequest(request, response, store, access, teamStore, workspaceMatch[1]);
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

async function handleLoginRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  try {
    if (!auth?.adminToken) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "Admin-token login is not configured for this OpenRoad server."
      );
    }

    if (!sessionStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad session storage is not configured."
      );
    }

    const payload = await readJsonBody(request, 8192);
    const adminToken = getAdminTokenLoginPayload(payload);

    if (!safeSecretEqual(adminToken, auth.adminToken)) {
      throw new AccessDeniedError("Admin token is invalid.");
    }

    const session = await sessionStore.createSession({
      adminToken: auth.adminToken,
      ipAddress: request.socket.remoteAddress,
      userAgent: getSingleHeader(request.headers, "user-agent")
    });
    const loginAccess: AccessContext = {
      ...access,
      actor: { id: "local-owner", source: "admin-token", type: "local-owner" }
    };
    const current = await store.load();
    await recordAuditEvent(teamStore, current.state, loginAccess, {
      summary: "Created an owner browser session.",
      type: "auth.login"
    });

    writeJson(
      response,
      200,
      {
        authenticated: true,
        actor: sanitizeActor(session.session.actor),
        expiresAt: session.session.expiresAt,
        status: "authenticated"
      },
      access,
      {
        "Set-Cookie": createSessionCookie(
          session.cookieValue,
          session.maxAgeSeconds,
          request,
          auth
        )
      }
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handlePasswordLoginRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  if (!sessionStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad session storage is not configured."),
      access
    );
    return;
  }

  try {
    const payload = await readJsonBody(request, 8192);
    const loginPayload = getPasswordLoginPayload(payload);
    const current = await store.load();
    const result = await teamStore.authenticateAccountPassword(current.state, loginPayload);
    const memberActor: AccessContext["actor"] = {
      id: result.user.id,
      role: result.membership.role,
      type: "workspace-member",
      workspaceId: result.membership.workspaceId
    };
    const session = await sessionStore.createMemberSession({
      actor: memberActor,
      ipAddress: request.socket.remoteAddress,
      userAgent: getSingleHeader(request.headers, "user-agent")
    });
    const memberAccess: AccessContext = {
      ...access,
      actor: memberActor
    };

    await recordAuditEvent(teamStore, current.state, memberAccess, {
      summary: `Created an account password session for ${result.user.email}.`,
      type: "auth.password.login",
      workspaceId: result.membership.workspaceId
    });

    writeJson(
      response,
      200,
      {
        actor: sanitizeActor(session.session.actor),
        authenticated: true,
        expiresAt: session.session.expiresAt,
        membership: sanitizeMembership(result.membership),
        status: "authenticated",
        user: sanitizeTeamUser(result.user)
      },
      memberAccess,
      {
        "Set-Cookie": createSessionCookie(
          session.cookieValue,
          session.maxAgeSeconds,
          request,
          auth
        )
      }
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleAccountRecoveryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  accountRecoveryDeliveryAdapter: AccountRecoveryDeliveryAdapter | undefined,
  accountRecoveryPublicBaseUrl: string | undefined
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  try {
    const payload = await readJsonBody(request, 8192);
    const recoveryPayload = getAccountRecoveryRequestPayload(payload);

    if (!teamStore || !accountRecoveryDeliveryAdapter || !accountRecoveryPublicBaseUrl) {
      writeAccountRecoveryRequested(response, access);
      return;
    }

    const current = await store.load();
    let created: Awaited<ReturnType<TeamStore["createAccountRecoveryRequest"]>>;

    try {
      created = await teamStore.createAccountRecoveryRequest(current.state, recoveryPayload);
    } catch (error) {
      if (
        error instanceof TeamStoreError &&
        (error.code === "invalid_request" || error.code === "not_found")
      ) {
        writeAccountRecoveryRequested(response, access);
        return;
      }

      throw error;
    }

    const delivery = await deliverAccountRecoveryAfterCreate({
      adapter: accountRecoveryDeliveryAdapter,
      configuredPublicBaseUrl: accountRecoveryPublicBaseUrl,
      currentState: current.state,
      recovery: created.recovery,
      recoveryToken: created.recoveryToken,
      teamStore,
      workspaceId: created.membership.workspaceId
    });

    await recordAuditEvent(teamStore, current.state, access, {
      summary: `Created account recovery request for ${created.user.email}.`,
      type: "auth.account.recovery.request",
      workspaceId: created.membership.workspaceId
    });

    if (delivery.status === "failed") {
      await recordAuditEvent(teamStore, current.state, access, {
        summary: `Account recovery delivery failed for ${created.user.email}.`,
        type: "auth.account.recovery.delivery.failed",
        workspaceId: created.membership.workspaceId
      });
    }

    writeAccountRecoveryRequested(response, access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleAccountRecoveryConfirmRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  if (!sessionStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad session storage is not configured."),
      access
    );
    return;
  }

  try {
    const payload = await readJsonBody(request, 8192);
    const recoveryPayload = getAccountRecoveryConfirmPayload(payload);
    const current = await store.load();
    const result = await teamStore.completeAccountRecovery(current.state, recoveryPayload);
    const revokedSessions = await sessionStore.revokeMemberSessionsForUser({
      userId: result.user.id
    });
    const memberActor: AccessContext["actor"] = {
      id: result.user.id,
      role: result.membership.role,
      type: "workspace-member",
      workspaceId: result.membership.workspaceId
    };
    const session = await sessionStore.createMemberSession({
      actor: memberActor,
      ipAddress: request.socket.remoteAddress,
      userAgent: getSingleHeader(request.headers, "user-agent")
    });
    const memberAccess: AccessContext = {
      ...access,
      actor: memberActor
    };

    await recordAuditEvent(teamStore, current.state, memberAccess, {
      summary: `Completed account recovery for ${result.user.email}.`,
      type: "auth.account.recovery.complete",
      workspaceId: result.membership.workspaceId
    });

    writeJson(
      response,
      200,
      {
        actor: sanitizeActor(session.session.actor),
        authenticated: true,
        expiresAt: session.session.expiresAt,
        membership: sanitizeMembership(result.membership),
        recovery: sanitizeAccountRecoveryForJson(result.recovery),
        revokedSessions,
        status: "authenticated",
        user: sanitizeTeamUser(result.user)
      },
      memberAccess,
      {
        "Set-Cookie": createSessionCookie(
          session.cookieValue,
          session.maxAgeSeconds,
          request,
          auth
        )
      }
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleAccountPasswordRequest(
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

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  try {
    const userId = getAccountPasswordActorUserId(access);
    const payload = await readJsonBody(request, 8192);
    const passwordPayload = getAccountPasswordPayload(payload);
    const current = await store.load();
    const result = await teamStore.setAccountPassword(current.state, {
      currentPassword: passwordPayload.currentPassword,
      password: passwordPayload.password,
      requireCurrentPassword: access.actor.type === "local-owner" ? false : undefined,
      userId
    });

    await recordAuditEvent(teamStore, current.state, access, {
      summary: `Updated account password for ${result.user.email}.`,
      type: "auth.password.set",
      workspaceId: access.actor.type === "workspace-member" ? access.actor.workspaceId : undefined
    });

    writeJson(
      response,
      200,
      {
        credential: result.credential,
        status: "password_set",
        user: sanitizeTeamUser(result.user)
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleLogoutRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  try {
    const cookieValue = getSessionCookieValue(getSingleHeader(request.headers, "cookie"));
    const revoked = sessionStore ? await sessionStore.revokeSession(cookieValue) : false;

    if (revoked) {
      const current = await store.load();
      await recordAuditEvent(teamStore, current.state, access, {
        summary: "Revoked an owner browser session.",
        type: "auth.logout"
      });
    }

    writeJson(
      response,
      200,
      {
        revoked,
        status: "signed_out"
      },
      access,
      {
        "Set-Cookie": createExpiredSessionCookie(request, auth)
      }
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined,
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
      authenticated: access.actor.type !== "public-visitor",
      auth: {
        adminTokenConfigured: Boolean(auth?.adminToken),
        sessionCookieEnabled: Boolean(sessionStore),
        singleUserMode: isSingleUserAuthEnabled(auth),
        trustedProxyHeadersEnabled: Boolean(auth?.trustProxyHeaders)
      },
      loginRequired:
        Boolean(auth?.adminToken) &&
        !isSingleUserAuthEnabled(auth) &&
        access.actor.type === "public-visitor",
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

async function handleWorkspaceInvitationCollectionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  teamStore: TeamStore | undefined,
  invitationDeliveryAdapter: InvitationDeliveryAdapter | undefined,
  invitationDeliveryPublicBaseUrl: string | undefined,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET" && request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET and POST.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const current = await store.load();

    if (request.method === "GET") {
      const invitations = await teamStore.listInvitations(current.state, workspaceId);
      writeJson(response, 200, { invitations: invitations.map(sanitizeInvitationForJson) }, access);
      return;
    }

    const payload = await readJsonBody(request, 8192);
    const invitationPayload = getInvitationCreatePayload(payload);
    const result = await teamStore.createInvitation(current.state, {
      ...invitationPayload,
      createdByActorId: access.actor.id,
      workspaceId
    });
    const deliveryResult = await deliverInvitationAfterCreate({
      acceptToken: result.acceptToken,
      adapter: invitationDeliveryAdapter,
      configuredPublicBaseUrl: invitationDeliveryPublicBaseUrl,
      currentState: current.state,
      invitation: result.invitation,
      request,
      auth,
      teamStore,
      workspaceId
    });
    const { invitation, ...delivery } = deliveryResult;

    await recordAuditEvent(teamStore, current.state, access, {
      summary: `Created invitation for ${result.invitation.email} as ${result.invitation.role}.`,
      type: "team.invitation.create",
      workspaceId
    });

    writeJson(
      response,
      201,
      {
        acceptToken: result.acceptToken,
        delivery,
        invitation: sanitizeInvitationForJson(invitation),
        status: "pending"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function deliverInvitationAfterCreate({
  acceptToken,
  adapter,
  configuredPublicBaseUrl,
  currentState,
  invitation,
  request,
  auth,
  teamStore,
  workspaceId
}: {
  acceptToken: string;
  adapter: InvitationDeliveryAdapter | undefined;
  configuredPublicBaseUrl: string | undefined;
  currentState: OpenRoadState;
  invitation: TeamInvitationSummary;
  request: IncomingMessage;
  auth: AuthOptions | undefined;
  teamStore: TeamStore;
  workspaceId: string;
}): Promise<InvitationDeliveryAttemptSummary & { invitation: TeamInvitationSummary }> {
  if (!adapter) {
    return {
      invitation,
      status: "not_configured"
    };
  }

  const attemptedAt = new Date().toISOString();
  const workspaceName =
    currentState.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId;
  const baseUrl = configuredPublicBaseUrl ?? resolveRequestOrigin(request, auth);

  try {
    if (adapter.channel === "http-provider" && !configuredPublicBaseUrl) {
      throw new Error("Invitation HTTP provider delivery requires OPENROAD_PUBLIC_APP_URL.");
    }

    const result = await adapter.deliver(invitation, {
      acceptToken,
      baseUrl,
      deliveredAt: attemptedAt,
      workspaceId,
      workspaceName
    });
    const recorded = await teamStore.recordInvitationDelivery(currentState, {
      deliveryAttemptedAt: attemptedAt,
      deliveryChannel: adapter.channel,
      deliveryMessageId: sanitizeDeliveryMessageId(result.messageId),
      deliveryStatus: "sent",
      invitationId: invitation.id,
      workspaceId
    });

    return {
      attemptedAt,
      channel: adapter.channel,
      invitation: recorded,
      messageId: sanitizeDeliveryMessageId(result.messageId),
      status: "sent"
    };
  } catch (error) {
    const message = safeExternalErrorMessage(error, "Invitation delivery failed.");
    const recorded = await teamStore.recordInvitationDelivery(currentState, {
      deliveryAttemptedAt: attemptedAt,
      deliveryChannel: adapter.channel,
      deliveryError: message,
      deliveryStatus: "failed",
      invitationId: invitation.id,
      workspaceId
    });

    return {
      attemptedAt,
      channel: adapter.channel,
      error: message,
      invitation: recorded,
      status: "failed"
    };
  }
}

async function deliverAccountRecoveryAfterCreate({
  adapter,
  configuredPublicBaseUrl,
  currentState,
  recovery,
  recoveryToken,
  teamStore,
  workspaceId
}: {
  adapter: AccountRecoveryDeliveryAdapter | undefined;
  configuredPublicBaseUrl: string | undefined;
  currentState: OpenRoadState;
  recovery: TeamAccountRecoverySummary;
  recoveryToken: string;
  teamStore: TeamStore;
  workspaceId: string;
}): Promise<AccountRecoveryDeliveryAttemptSummary & { recovery: TeamAccountRecoverySummary }> {
  if (!adapter || !configuredPublicBaseUrl) {
    return {
      recovery,
      status: "not_configured"
    };
  }

  const attemptedAt = new Date().toISOString();
  const workspaceName =
    currentState.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId;

  try {
    const result = await adapter.deliver(recovery, {
      baseUrl: configuredPublicBaseUrl,
      deliveredAt: attemptedAt,
      recoveryToken,
      workspaceId,
      workspaceName
    });
    const recorded = await teamStore.recordAccountRecoveryDelivery(currentState, {
      deliveryAttemptedAt: attemptedAt,
      deliveryChannel: adapter.channel,
      deliveryMessageId: sanitizeDeliveryMessageId(result.messageId),
      deliveryStatus: "sent",
      recoveryRequestId: recovery.id
    });

    return {
      attemptedAt,
      channel: adapter.channel,
      messageId: sanitizeDeliveryMessageId(result.messageId),
      recovery: recorded,
      status: "sent"
    };
  } catch (error) {
    const message = safeExternalErrorMessage(error, "Account recovery delivery failed.");
    const recorded = await teamStore.recordAccountRecoveryDelivery(currentState, {
      deliveryAttemptedAt: attemptedAt,
      deliveryChannel: adapter.channel,
      deliveryError: message,
      deliveryStatus: "failed",
      recoveryRequestId: recovery.id
    });

    return {
      attemptedAt,
      channel: adapter.channel,
      error: message,
      recovery: recorded,
      status: "failed"
    };
  }
}

async function handleWorkspaceInvitationRevokeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  encodedWorkspaceId: string,
  encodedInvitationId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const invitationId = decodeURIComponent(encodedInvitationId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const current = await store.load();
    const invitation = await teamStore.revokeInvitation(current.state, {
      invitationId,
      revokedByActorId: access.actor.id,
      workspaceId
    });

    await recordAuditEvent(teamStore, current.state, access, {
      summary: `Revoked invitation for ${invitation.email}.`,
      type: "team.invitation.revoke",
      workspaceId
    });

    writeJson(
      response,
      200,
      { invitation: sanitizeInvitationForJson(invitation), status: "revoked" },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleWorkspaceMemberCollectionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const current = await store.load();
    const members = await teamStore.listWorkspaceMembers(current.state, workspaceId);
    writeJson(response, 200, { members: members.map(sanitizeWorkspaceMemberForJson) }, access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleWorkspaceMemberRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  sessionStore: SessionStore | undefined,
  encodedWorkspaceId: string,
  encodedMembershipId: string
) {
  if (request.method !== "PATCH") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports PATCH.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const membershipId = decodeURIComponent(encodedMembershipId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const payload = await readJsonBody(request, 8192);
    const role = getWorkspaceMemberRolePayload(payload);
    const current = await store.load();
    const result = await teamStore.updateWorkspaceMemberRole(current.state, {
      membershipId,
      role,
      workspaceId
    });
    const revokedSessions = sessionStore
      ? await sessionStore.revokeMemberSessions({
          userId: result.member.userId,
          workspaceId
        })
      : 0;

    await recordAuditEvent(teamStore, current.state, access, {
      summary: `Updated ${result.member.email} role to ${result.member.role}.`,
      type: "team.member.role.update",
      workspaceId
    });

    writeJson(
      response,
      200,
      {
        member: sanitizeWorkspaceMemberForJson(result.member),
        revokedSessions,
        status: "updated"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleWorkspaceMemberDeactivateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  sessionStore: SessionStore | undefined,
  encodedWorkspaceId: string,
  encodedMembershipId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const membershipId = decodeURIComponent(encodedMembershipId);

  try {
    requirePermission(access, "integration:manage", workspaceId);
    const current = await store.load();
    const result = await teamStore.deactivateWorkspaceMember(current.state, {
      membershipId,
      workspaceId
    });
    const revokedSessions = sessionStore
      ? await sessionStore.revokeMemberSessions({
          userId: result.member.userId,
          workspaceId
        })
      : 0;

    await recordAuditEvent(teamStore, current.state, access, {
      summary: `Deactivated workspace access for ${result.member.email}.`,
      type: "team.member.deactivate",
      workspaceId
    });

    writeJson(
      response,
      200,
      {
        member: sanitizeWorkspaceMemberForJson(result.member),
        revokedSessions,
        status: "deactivated"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleInvitationAcceptRequest(
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

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  try {
    const payload = await readJsonBody(request, 8192);
    const invitationPayload = getInvitationAcceptPayload(payload);
    const current = await store.load();
    const result = await teamStore.acceptInvitation(current.state, invitationPayload);

    await recordAuditEvent(teamStore, current.state, access, {
      summary: `Accepted invitation for ${result.invitation.email}.`,
      type: "team.invitation.accept",
      workspaceId: result.invitation.workspaceId
    });

    writeJson(
      response,
      200,
      {
        createdMembership: result.createdMembership,
        createdUser: result.createdUser,
        invitation: sanitizeInvitationForJson(result.invitation),
        membership: sanitizeMembership(result.membership),
        status: "accepted",
        user: sanitizeTeamUser(result.user)
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleInvitationSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined,
  teamStore: TeamStore | undefined
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  if (!teamStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad team metadata store is not configured."),
      access
    );
    return;
  }

  if (!sessionStore) {
    writeKnownApiError(
      response,
      new ApiRequestError("not_configured", 503, "OpenRoad session storage is not configured."),
      access
    );
    return;
  }

  try {
    const payload = await readJsonBody(request, 8192);
    const invitationPayload = getInvitationAcceptPayload(payload);
    const current = await store.load();
    const result = await teamStore.acceptInvitation(current.state, invitationPayload);
    const memberActor: AccessContext["actor"] = {
      id: result.user.id,
      role: result.membership.role,
      type: "workspace-member",
      workspaceId: result.membership.workspaceId
    };
    const session = await sessionStore.createMemberSession({
      actor: memberActor,
      ipAddress: request.socket.remoteAddress,
      userAgent: getSingleHeader(request.headers, "user-agent")
    });
    const memberAccess: AccessContext = {
      ...access,
      actor: memberActor
    };

    await recordAuditEvent(teamStore, current.state, memberAccess, {
      summary: `Accepted invitation for ${result.invitation.email} and created a member session.`,
      type: "team.invitation.session",
      workspaceId: result.invitation.workspaceId
    });

    writeJson(
      response,
      200,
      {
        actor: sanitizeActor(session.session.actor),
        authenticated: true,
        createdMembership: result.createdMembership,
        createdUser: result.createdUser,
        expiresAt: session.session.expiresAt,
        invitation: sanitizeInvitationForJson(result.invitation),
        membership: sanitizeMembership(result.membership),
        status: "authenticated",
        user: sanitizeTeamUser(result.user)
      },
      memberAccess,
      {
        "Set-Cookie": createSessionCookie(
          session.cookieValue,
          session.maxAgeSeconds,
          request,
          auth
        )
      }
    );
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
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
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

    const { auditEvent, importResult, integrationState } = await runIntegrationMutationExclusive(
      async () => {
        const latest = await store.load();
        const latestWorkspace = latest.state.workspaces.find((item) => item.id === workspaceId);

        if (!latestWorkspace) {
          throw new ApiRequestError("not_found", 404, "Workspace was not found.");
        }

        const integrationResult = await integrationStore.load();
        const importResult = createGitHubIssueImportState(
          latestWorkspace,
          integrationResult.state,
          gitHubPayload,
          new Date().toISOString()
        );

        const nextState = parseOpenRoadState(
          openRoadReducer(latest.state, {
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

        return { auditEvent, importResult, integrationState };
      }
    );

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
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
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

    const { auditEvent, importResult, integrationState } = await runIntegrationMutationExclusive(
      async () => {
        const latest = await store.load();
        const latestWorkspace = latest.state.workspaces.find((item) => item.id === workspaceId);

        if (!latestWorkspace) {
          throw new ApiRequestError("not_found", 404, "Workspace was not found.");
        }

        const integrationResult = await integrationStore.load();
        const importResult = createLinearIssueImportState(
          latestWorkspace,
          integrationResult.state,
          linearPayload,
          new Date().toISOString()
        );
        const nextState = parseOpenRoadState(
          openRoadReducer(latest.state, {
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

        return { auditEvent, importResult, integrationState };
      }
    );

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
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
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

    const { auditEvent, importResult, integrationState } = await runIntegrationMutationExclusive(
      async () => {
        const latest = await store.load();
        const latestWorkspace = latest.state.workspaces.find((item) => item.id === workspaceId);

        if (!latestWorkspace) {
          throw new ApiRequestError("not_found", 404, "Workspace was not found.");
        }

        const integrationResult = await integrationStore.load();
        const importResult = createJiraIssueImportState(
          latestWorkspace,
          integrationResult.state,
          jiraPayload,
          new Date().toISOString()
        );
        const nextState = parseOpenRoadState(
          openRoadReducer(latest.state, {
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

        return { auditEvent, importResult, integrationState };
      }
    );

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

async function handleIntegrationInstallationCollectionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
  encodedWorkspaceId: string,
  encodedProvider: string
) {
  if (request.method !== "GET" && request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint supports GET and POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    const provider = parseIntegrationProviderPath(encodedProvider);
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

    if (request.method === "GET") {
      const integrationResult = await integrationStore.load();
      const installations = integrationResult.state.installations
        .filter((installation) => installation.provider === provider && installation.workspaceId === workspaceId)
        .map(sanitizeInstallation);

      writeJson(
        response,
        200,
        {
          installations,
          provider,
          status: "listed",
          workspace: {
            id: workspace.id,
            name: workspace.name
          }
        },
        access
      );
      return;
    }

    const payload = await readJsonBody(request, 50_000);
    const { auditEvent, installation, integrationState } = await runIntegrationMutationExclusive(async () => {
      const integrationResult = await integrationStore.load();
      const installation = createManualIntegrationInstallationFromPayload({
        payload,
        provider,
        workspaceId
      });
      const nextIntegrationState = parseIntegrationState({
        ...integrationResult.state,
        installations: upsertInstallationByScope(integrationResult.state.installations, installation)
      });
      const integrationState = await integrationStore.replaceState(nextIntegrationState);
      const auditEvent = await recordAuditEvent(teamStore, current.state, access, {
        summary: `Connected ${provider} installation ${installation.providerAccountName}.`,
        type: "integration.installation.connect",
        workspaceId
      });

      return { auditEvent, installation, integrationState };
    });

    writeJson(
      response,
      201,
      {
        installation: sanitizeInstallation(installation),
        provider,
        revision: auditEvent?.id ?? `integration-installation-${Date.now()}`,
        status: "connected",
        totals: {
          credentials: integrationState.credentials.length,
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

async function handleIntegrationInstallationDisconnectRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
  encodedWorkspaceId: string,
  encodedProvider: string,
  encodedInstallationId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const installationId = decodeURIComponent(encodedInstallationId);

  try {
    const provider = parseIntegrationProviderPath(encodedProvider);
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

    const { auditEvent, disconnected, integrationState } = await runIntegrationMutationExclusive(async () => {
      const integrationResult = await integrationStore.load();
      const disconnected = disconnectProviderInstallationState({
        integrationState: integrationResult.state,
        installationId,
        now: new Date().toISOString(),
        provider,
        workspaceId
      });
      const integrationState = await integrationStore.replaceState(disconnected.integrationState);
      const auditEvent =
        disconnected.changed
          ? await recordAuditEvent(teamStore, current.state, access, {
              summary: `Disconnected ${provider} installation ${disconnected.installation.providerAccountName}.`,
              type: "integration.installation.disconnect",
              workspaceId
            })
          : undefined;

      return { auditEvent, disconnected, integrationState };
    });

    writeJson(
      response,
      200,
      {
        changed: disconnected.changed,
        disconnectedMappings: disconnected.disconnectedMappings,
        installation: sanitizeInstallation(disconnected.installation),
        provider,
        revision: auditEvent?.id ?? `integration-disconnect-${Date.now()}`,
        revokedCredentials: disconnected.revokedCredentials,
        status: "disconnected",
        totals: {
          credentials: integrationState.credentials.length,
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

async function handleIntegrationCredentialCollectionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
  tokenVault: IntegrationTokenVault,
  encodedWorkspaceId: string,
  encodedProvider: string
) {
  if (request.method !== "GET" && request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint supports GET and POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    const provider = parseIntegrationProviderPath(encodedProvider);
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

    if (request.method === "GET") {
      const integrationResult = await integrationStore.load();
      writeJson(
        response,
        200,
        {
          credentials: integrationResult.state.credentials
            .filter(
              (credential) =>
                credential.provider === provider && credential.workspaceId === workspaceId
            )
            .map(sanitizeIntegrationCredentialMetadata),
          provider,
          status: "listed",
          workspace: {
            id: workspace.id,
            name: workspace.name
          }
        },
        access
      );
      return;
    }

    if (tokenVault.status !== "ready") {
      throw new ApiRequestError("not_configured", 503, tokenVault.reason);
    }

    const payload = await readJsonBody(request, 50_000);
    const { auditEvent, credential } = await runIntegrationMutationExclusive(async () => {
      const integrationResult = await integrationStore.load();
      const now = new Date().toISOString();
      const { credential, installation } = createIntegrationCredentialFromPayload({
        integrationState: integrationResult.state,
        now,
        payload,
        provider,
        tokenVault,
        workspaceId
      });
      const nextIntegrationState = parseIntegrationState({
        ...integrationResult.state,
        credentials: upsertById(integrationResult.state.credentials, credential)
      });
      await integrationStore.replaceState(nextIntegrationState);
      const auditEvent = await recordAuditEvent(teamStore, current.state, access, {
        summary: `Stored ${provider} credential for installation ${installation.id}.`,
        type: "integration.credentials.create",
        workspaceId
      });

      return { auditEvent, credential };
    });

    writeJson(
      response,
      201,
      {
        credential: sanitizeIntegrationCredentialMetadata(credential),
        provider,
        revision: auditEvent?.id ?? `integration-credential-${Date.now()}`,
        status: "stored"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleIntegrationSyncJobEnqueueRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
  encodedWorkspaceId: string,
  encodedProvider: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    const provider = parseIntegrationProviderPath(encodedProvider);
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

    const payload = await readJsonBody(request, 20_000);
    const enqueue = await runIntegrationMutationExclusive(async () => {
      const integrationResult = await integrationStore.load();
      const enqueue = enqueueIntegrationSyncJob(
        integrationResult.state,
        parseIntegrationSyncJobPayload(payload, provider, workspaceId),
        new Date().toISOString()
      );

      if (enqueue.enqueued) {
        await integrationStore.replaceState(enqueue.state);
        await recordAuditEvent(teamStore, current.state, access, {
          summary: `Queued ${provider} sync job for installation ${enqueue.job.installationId}.`,
          type: "integration.sync.job.enqueue",
          workspaceId
        });
      }

      return enqueue;
    });

    writeJson(
      response,
      enqueue.enqueued ? 201 : 200,
      {
        job: sanitizeSyncJobForApi(enqueue.job),
        provider,
        status: enqueue.enqueued ? "queued" : "deduped"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleIntegrationStatusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  integrationStore: IntegrationStore | undefined,
  integrationSyncWorker: IntegrationSyncWorker | undefined,
  configuredIntegrationSyncProviders: Set<IntegrationProvider>,
  githubAppConfig: GitHubAppConfig,
  linearOAuthConfig: LinearOAuthConfig,
  jiraOAuthConfig: JiraOAuthConfig,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    requirePermission(access, "workspace:read", workspaceId);

    if (!integrationStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad integration metadata store is not configured."
      );
    }

    const [openRoadResult, integrationResult] = await Promise.all([
      store.load(),
      integrationStore.load()
    ]);
    const workspace = openRoadResult.state.workspaces.find((item) => item.id === workspaceId);

    if (!workspace) {
      throw new ApiRequestError("not_found", 404, "Workspace was not found.");
    }

    writeJson(
      response,
      200,
      {
        integrationMetadata: {
          recovered: Boolean(integrationResult.backupPath),
          schemaVersion: integrationResult.state.schemaVersion,
          status: integrationResult.status
        },
        providers: integrationProviders.map((provider) =>
          createIntegrationStatusProviderSummary({
            githubAppConfig,
            integrationState: integrationResult.state,
            syncWorkerConfigured: configuredIntegrationSyncProviders.has(provider),
            jiraOAuthConfig,
            linearOAuthConfig,
            provider,
            workspaceId
          })
        ),
        status: "ready",
        workspaceId
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

function createIntegrationStatusProviderSummary({
  githubAppConfig,
  integrationState,
  syncWorkerConfigured,
  jiraOAuthConfig,
  linearOAuthConfig,
  provider,
  workspaceId
}: {
  githubAppConfig: GitHubAppConfig;
  integrationState: IntegrationState;
  syncWorkerConfigured: boolean;
  jiraOAuthConfig: JiraOAuthConfig;
  linearOAuthConfig: LinearOAuthConfig;
  provider: IntegrationProvider;
  workspaceId: string;
}) {
  const installations = integrationState.installations.filter(
    (installation) => installation.workspaceId === workspaceId && installation.provider === provider
  );
  const activeInstallations = installations.filter((installation) => installation.status === "active");
  const disconnectedInstallations = installations.filter(
    (installation) => installation.status === "disconnected"
  );
  const mappings = integrationState.mappings.filter(
    (mapping) => mapping.openRoad.workspaceId === workspaceId && mapping.external.provider === provider
  );
  const activeMappings = mappings.filter((mapping) => mapping.status === "active");
  const linkedIssueMappings = activeMappings.filter((mapping) => mapping.external.type === "issue");
  const activeCredentials = integrationState.credentials.filter(
    (credential) =>
      credential.provider === provider &&
      credential.workspaceId === workspaceId &&
      credential.status === "active" &&
      credential.permissions.includes("read:external") &&
      activeInstallations.some((installation) => installation.id === credential.installationId) &&
      !isExpiredTimestamp(credential.expiresAt)
  );
  const jobs = integrationState.syncJobs
    .filter((job) => job.workspaceId === workspaceId && job.provider === provider)
    .sort((left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt));
  const setupConfigured = isIntegrationSetupConfigured({
    githubAppConfig,
    jiraOAuthConfig,
    linearOAuthConfig,
    provider,
    workspaceId
  });
  const canManualSync =
    canProviderManualSync({
      activeCredentials: activeCredentials.length,
      activeInstallations: activeInstallations.length,
      linkedIssueMappings: linkedIssueMappings.length,
      provider,
      setupConfigured,
      syncWorkerConfigured
    });
  const connection = getIntegrationConnectionState({
    activeInstallations: activeInstallations.length,
    setupConfigured,
    totalInstallations: installations.length
  });

  return {
    accounts: activeInstallations.slice(0, 5).map(sanitizeIntegrationStatusAccount),
    activeCredentials: activeCredentials.length,
    activeInstallations: activeInstallations.length,
    capabilities: {
      disconnect: activeInstallations.length > 0,
      import: activeInstallations.length > 0,
      liveSync: canProviderLiveSync({
        activeCredentials: activeCredentials.length,
        activeInstallations: activeInstallations.length,
        provider,
        setupConfigured,
        syncWorkerConfigured
      }),
      manualSync: canManualSync,
      setup: setupConfigured,
      webhooks: provider === "github" && activeInstallations.length > 0
    },
    connection,
    disconnectedAccounts: disconnectedInstallations
      .slice(0, 5)
      .map(sanitizeIntegrationStatusAccount),
    label: integrationProviderLabels[provider],
    lastJobStatus: jobs[0]?.status,
    lastJobUpdatedAt: jobs[0]?.updatedAt,
    lastSyncedAt: newestTimestamp(activeMappings.map((mapping) => mapping.lastSyncedAt)),
    linkedIssueMappings: linkedIssueMappings.length,
    linkedMappings: activeMappings.length,
    provider,
    queuedSyncJobs: jobs.filter((job) => job.status === "queued").length,
    recentJobs: jobs.slice(0, 5).map(sanitizeIntegrationStatusJob),
    runningSyncJobs: jobs.filter((job) => job.status === "running").length,
    setupConfigured,
    statusText: getIntegrationStatusText({
      activeInstallations: activeInstallations.length,
      activeCredentials: activeCredentials.length,
      canManualSync,
      connection,
      linkedIssueMappings: linkedIssueMappings.length,
      provider,
      setupConfigured,
      syncWorkerConfigured
    }),
    syncWorkerConfigured,
    totalInstallations: installations.length
  };
}

const integrationProviderLabels: Record<IntegrationProvider, string> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear"
};

function sanitizeIntegrationStatusAccount(installation: IntegrationInstallation) {
  return {
    createdAt: installation.createdAt,
    id: installation.id,
    providerAccountName: installation.providerAccountName,
    status: installation.status
  };
}

function sanitizeIntegrationStatusJob(job: IntegrationSyncJob) {
  return {
    attempt: job.attempt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    createdAt: job.createdAt,
    ...(job.error ? { error: redactSensitiveText(job.error) } : {}),
    id: job.id,
    installationId: job.installationId,
    ...(job.lastRunAt ? { lastRunAt: job.lastRunAt } : {}),
    ...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}),
    provider: job.provider,
    reason: job.reason,
    ...(job.resultSummary ? { resultSummary: redactSensitiveText(job.resultSummary) } : {}),
    status: job.status,
    updatedAt: job.updatedAt,
    workspaceId: job.workspaceId
  };
}

function isIntegrationSetupConfigured({
  githubAppConfig,
  jiraOAuthConfig,
  linearOAuthConfig,
  provider,
  workspaceId
}: {
  githubAppConfig: GitHubAppConfig;
  jiraOAuthConfig: JiraOAuthConfig;
  linearOAuthConfig: LinearOAuthConfig;
  provider: IntegrationProvider;
  workspaceId: string;
}) {
  if (provider === "github") {
    return createSafeGitHubAppSetup(githubAppConfig, workspaceId).configured;
  }

  if (provider === "linear") {
    return createSafeLinearOAuthSetup(linearOAuthConfig, workspaceId).configured;
  }

  return createSafeJiraOAuthSetup(jiraOAuthConfig, workspaceId).configured;
}

function getIntegrationConnectionState({
  activeInstallations,
  setupConfigured,
  totalInstallations
}: {
  activeInstallations: number;
  setupConfigured: boolean;
  totalInstallations: number;
}) {
  if (activeInstallations > 0) return "connected";
  if (totalInstallations > 0) return "attention";
  if (setupConfigured) return "ready";
  return "optional";
}

function canProviderLiveSync({
  activeCredentials,
  activeInstallations,
  provider,
  setupConfigured,
  syncWorkerConfigured
}: {
  activeCredentials: number;
  activeInstallations: number;
  provider: IntegrationProvider;
  setupConfigured: boolean;
  syncWorkerConfigured: boolean;
}) {
  if (provider === "github") {
    return syncWorkerConfigured && activeInstallations > 0 && setupConfigured;
  }

  if (provider === "linear") {
    return syncWorkerConfigured && activeInstallations > 0 && activeCredentials > 0;
  }

  return syncWorkerConfigured && activeInstallations > 0 && activeCredentials > 0;
}

function canProviderManualSync({
  activeCredentials,
  activeInstallations,
  linkedIssueMappings,
  provider,
  setupConfigured,
  syncWorkerConfigured
}: {
  activeCredentials: number;
  activeInstallations: number;
  linkedIssueMappings: number;
  provider: IntegrationProvider;
  setupConfigured: boolean;
  syncWorkerConfigured: boolean;
}) {
  if (provider === "github") {
    return syncWorkerConfigured && activeInstallations > 0 && setupConfigured && linkedIssueMappings > 0;
  }

  if (provider === "linear") {
    return syncWorkerConfigured && activeInstallations > 0 && activeCredentials > 0 && linkedIssueMappings > 0;
  }

  return syncWorkerConfigured && activeInstallations > 0 && activeCredentials > 0 && linkedIssueMappings > 0;
}

function getIntegrationStatusText({
  activeCredentials,
  activeInstallations,
  canManualSync,
  connection,
  linkedIssueMappings,
  provider,
  setupConfigured,
  syncWorkerConfigured
}: {
  activeCredentials: number;
  activeInstallations: number;
  canManualSync: boolean;
  connection: string;
  linkedIssueMappings: number;
  provider: IntegrationProvider;
  setupConfigured: boolean;
  syncWorkerConfigured: boolean;
}) {
  if (provider === "github" && canManualSync) {
    return `Connected. ${linkedIssueMappings} linked issue mapping${linkedIssueMappings === 1 ? "" : "s"} ready for manual sync.`;
  }

  if (provider === "github" && activeInstallations > 0 && !syncWorkerConfigured) {
    return "Connected. The GitHub sync worker is not configured for this deployment.";
  }

  if (provider === "github" && activeInstallations > 0) {
    return "Connected. Link a GitHub issue before running manual sync.";
  }

  if (provider === "linear" && canManualSync) {
    return `Connected. ${linkedIssueMappings} linked issue mapping${linkedIssueMappings === 1 ? "" : "s"} ready for manual sync.`;
  }

  if (provider === "linear" && activeInstallations > 0 && !syncWorkerConfigured) {
    return "Connected. The Linear sync worker is not configured for this deployment.";
  }

  if (provider === "linear" && activeInstallations > 0 && activeCredentials === 0) {
    return "Connected. Store a Linear credential before running live sync.";
  }

  if (provider === "linear" && activeInstallations > 0) {
    return "Connected. Link a Linear issue before running manual sync.";
  }

  if (provider === "jira" && canManualSync) {
    return `Connected. ${linkedIssueMappings} linked issue mapping${linkedIssueMappings === 1 ? "" : "s"} ready for manual sync.`;
  }

  if (provider === "jira" && activeInstallations > 0 && !syncWorkerConfigured) {
    return "Connected. The Jira sync worker is not configured for this deployment.";
  }

  if (provider === "jira" && activeInstallations > 0 && activeCredentials === 0) {
    return "Connected. Store a Jira credential before running live sync.";
  }

  if (provider === "jira" && activeInstallations > 0) {
    return "Connected. Link a Jira issue before running manual sync.";
  }

  if (connection === "attention") {
    return "Previous installation exists, but no active connection is available.";
  }

  if (setupConfigured) {
    return "Server setup is configured. Verify an installation to connect.";
  }

  return "Optional. Server setup is not configured yet.";
}

function newestTimestamp(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => timestampMs(right) - timestampMs(left))[0];
}

function timestampMs(value: string | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function isExpiredTimestamp(value: string | undefined) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

async function handleIntegrationSyncRunRequest(
  request: IncomingMessage,
  response: ServerResponse,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  store: OpenRoadStore,
  integrationStore: IntegrationStore | undefined,
  integrationSyncWorker: IntegrationSyncWorker | undefined,
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
  runIntegrationSyncExclusive: NotificationDeliveryRunner
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  try {
    requirePermission(access, "state:write");

    if (!integrationStore) {
      throw new ApiRequestError(
        "not_configured",
        503,
        "OpenRoad integration metadata store is not configured."
      );
    }

    if (!integrationSyncWorker) {
      throw new ApiRequestError("not_configured", 503, "OpenRoad integration sync worker is not configured.");
    }

    const payload = await readJsonBody(request, 20_000);
    const runOptions = parseIntegrationSyncRunPayload(payload);
    const openRoadResult = await store.load();
    const runResult = await runIntegrationSyncExclusive(async () => {
      const claimed = await runIntegrationMutationExclusive(async () => {
        const integrationResult = await integrationStore.load();
        const now = new Date().toISOString();
        const claimed = claimDueIntegrationSyncJobs(integrationResult.state, {
          limit: runOptions.limit,
          now,
          provider: runOptions.provider,
          workspaceId: runOptions.workspaceId
        });
        const state =
          claimed.jobs.length > 0
            ? await integrationStore.replaceState(claimed.state)
            : claimed.state;

        return { jobs: claimed.jobs, state };
      });
      let state = claimed.state;

      const processed: Array<{ id: string; kind: string; status: IntegrationSyncJob["status"] }> = [];

      for (const job of claimed.jobs) {
        try {
          const result = await integrationSyncWorker.process(job);

          if (result.kind === "success") {
            state = completeIntegrationSyncJob(state, {
              jobId: job.id,
              now: new Date().toISOString(),
              resultSummary: sanitizeIntegrationWorkerSummary(result.summary)
            });
          } else {
            state = failIntegrationSyncJob(state, {
              error: sanitizeIntegrationWorkerFailure(result.error ?? result.summary, result.kind),
              jobId: job.id,
              now: new Date().toISOString(),
              retryAfterSeconds: result.retryAfterSeconds,
              retryable: result.kind === "retryable-error"
            });
          }
        } catch {
          state = failIntegrationSyncJob(state, {
            error: "Integration sync worker failed.",
            jobId: job.id,
            now: new Date().toISOString(),
            retryable: true
          });
        }

        const updatedJob = state.syncJobs.find((item) => item.id === job.id);
        if (updatedJob) {
          processed.push({
            id: updatedJob.id,
            kind: updatedJob.status === "succeeded" ? "success" : updatedJob.status,
            status: updatedJob.status
          });
        }
      }

      if (claimed.jobs.length > 0) {
        const updatedJobs = claimed.jobs
          .map((job) => state.syncJobs.find((item) => item.id === job.id))
          .filter((job): job is IntegrationSyncJob => Boolean(job));
        state = await runIntegrationMutationExclusive(async () => {
          const latest = await integrationStore.load();
          const merged = mergeIntegrationSyncJobUpdates(latest.state, updatedJobs);
          return integrationStore.replaceState(merged);
        });
      }

      await recordAuditEvent(teamStore, openRoadResult.state, access, {
        summary: `Integration sync worker processed ${claimed.jobs.length} job(s).`,
        type: "integration.sync.run",
        workspaceId: runOptions.workspaceId
      });

      return {
        claimed: claimed.jobs.length,
        processed,
        remainingQueued: countQueuedSyncJobs(state, runOptions),
        status: "processed"
      };
    });

    writeJson(response, 200, runResult, access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleIntegrationCredentialRevokeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  integrationStore: IntegrationStore | undefined,
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
  encodedWorkspaceId: string,
  encodedProvider: string,
  encodedCredentialId: string
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);
  const credentialId = decodeURIComponent(encodedCredentialId);

  try {
    const provider = parseIntegrationProviderPath(encodedProvider);
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

    const revoked = await runIntegrationMutationExclusive(async () => {
      const integrationResult = await integrationStore.load();
      const credential = integrationResult.state.credentials.find(
        (item) =>
          item.id === credentialId &&
          item.provider === provider &&
          item.workspaceId === workspaceId
      );

      if (!credential) {
        throw new ApiRequestError("not_found", 404, "Integration credential was not found.");
      }

      const revoked =
        credential.status === "revoked"
          ? credential
          : revokeIntegrationCredential(credential, new Date().toISOString());

      if (revoked !== credential) {
        await integrationStore.replaceState(
          parseIntegrationState({
            ...integrationResult.state,
            credentials: upsertById(integrationResult.state.credentials, revoked)
          })
        );
        await recordAuditEvent(teamStore, current.state, access, {
          summary: `Revoked ${provider} credential for installation ${credential.installationId}.`,
          type: "integration.credentials.revoke",
          workspaceId
        });
      }

      return revoked;
    });

    writeJson(
      response,
      200,
      {
        credential: sanitizeIntegrationCredentialMetadata(revoked),
        provider,
        status: "revoked"
      },
      access
    );
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

function createIntegrationCredentialFromPayload({
  integrationState,
  now,
  payload,
  provider,
  tokenVault,
  workspaceId
}: {
  integrationState: IntegrationState;
  now: string;
  payload: unknown;
  provider: IntegrationProvider;
  tokenVault: Extract<IntegrationTokenVault, { status: "ready" }>;
  workspaceId: string;
}) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Integration credential payload must be an object.");
  }

  const installationId = getBoundedIdentifier(payload.installationId, 160);

  if (!installationId) {
    throw new ApiRequestError("invalid_request", 400, "Integration installation id is required.");
  }

  const installation = integrationState.installations.find(
    (item) =>
      item.provider === provider &&
      item.workspaceId === workspaceId &&
      doesProviderInstallationIdMatch(provider, item.id, installationId)
  );

  if (!installation) {
    throw new ApiRequestError("not_found", 404, "Integration installation was not found.");
  }

  if (installation.status !== "active") {
    throw new ApiRequestError(
      "invalid_state",
      422,
      "Integration installation is disconnected or suspended."
    );
  }

  const accessToken = getRequiredSecretText(payload.accessToken, "accessToken");
  const refreshToken = getOptionalSecretText(payload.refreshToken, "refreshToken");
  const permissions = parseCredentialPermissions(payload.permissions, installation);
  const providerScopes = parseCredentialProviderScopes(payload.providerScopes);
  const expiresAt = parseOptionalTimestamp(payload.expiresAt, "expiresAt");
  const label = getBoundedText(payload.label, 120);
  const tokenType = getBoundedText(payload.tokenType, 80);
  const credentialId = createIntegrationCredentialId(provider, installation.id);
  const credential: IntegrationCredential = {
    createdAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    id: credentialId,
    installationId: installation.id,
    ...(label ? { label } : {}),
    permissions,
    provider,
    providerScopes,
    secretTypes: refreshToken ? ["access-token", "refresh-token"] : ["access-token"],
    status: "active",
    ...(tokenType ? { tokenType } : {}),
    updatedAt: now,
    workspaceId
  };
  credential.encryptedSecret = tokenVault.seal(
    {
      accessToken,
      ...(refreshToken ? { refreshToken } : {})
    },
    {
      associatedData: createIntegrationCredentialSecretContext(credential)
    }
  );

  return { credential, installation };
}

function createManualIntegrationInstallationFromPayload({
  payload,
  provider,
  workspaceId
}: {
  payload: unknown;
  provider: IntegrationProvider;
  workspaceId: string;
}) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Integration installation payload must be an object.");
  }

  const installationId =
    getBoundedIdentifier(payload.installationId, 160) ?? getBoundedIdentifier(payload.id, 160);
  const accountId =
    getBoundedText(payload.providerAccountId, 160) ?? getBoundedText(payload.accountId, 160);
  const accountName =
    getBoundedText(payload.providerAccountName, 160) ??
    getBoundedText(payload.accountName, 160) ??
    getBoundedText(payload.name, 160);

  if (!installationId) {
    throw new ApiRequestError("invalid_request", 400, "Integration installation id is required.");
  }

  if (!accountId) {
    throw new ApiRequestError("invalid_request", 400, "Integration provider account id is required.");
  }

  if (!accountName) {
    throw new ApiRequestError("invalid_request", 400, "Integration provider account name is required.");
  }

  const installationInput = {
    accountId,
    accountName,
    id: installationId,
    permissions: parseManualIntegrationInstallationPermissions(payload.permissions, provider),
    status: parseManualIntegrationInstallationStatus(payload.status),
    workspaceId
  };

  try {
    if (provider === "github") {
      return sanitizeInstallation(createGitHubInstallation(installationInput as GitHubInstallationInput));
    }

    if (provider === "linear") {
      return sanitizeInstallation(createLinearInstallation(installationInput as LinearInstallationInput));
    }

    return sanitizeInstallation(createJiraInstallation(installationInput as JiraInstallationInput));
  } catch (error) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      error instanceof Error ? error.message : "Integration installation payload is invalid."
    );
  }
}

function parseManualIntegrationInstallationStatus(value: unknown): IntegrationInstallation["status"] {
  if (value === undefined) return "active";
  if (value === "active") return "active";
  throw new ApiRequestError("invalid_request", 400, "Manual integration installation status must be active.");
}

function parseManualIntegrationInstallationPermissions(
  value: unknown,
  provider: IntegrationProvider
): IntegrationPermission[] {
  const required =
    provider === "github"
      ? githubRequiredInstallationPermissions
      : provider === "linear"
        ? linearRequiredInstallationPermissions
        : jiraRequiredInstallationPermissions;

  if (value === undefined) return [...required];

  if (!Array.isArray(value)) {
    throw new ApiRequestError("invalid_request", 400, "Integration installation permissions must be an array.");
  }

  const optional: IntegrationPermission[] =
    provider === "jira" ? [] : ["write:external", "webhook:receive"];
  const allowed = new Set<IntegrationPermission>([...required, ...optional]);
  const permissions = value.map((item) => {
    const permission = getBoundedText(item, 80);
    if (!permission || !integrationPermissions.includes(permission as IntegrationPermission)) {
      throw new ApiRequestError("invalid_request", 400, "Integration installation permission is not supported.");
    }

    if (!allowed.has(permission as IntegrationPermission)) {
      throw new ApiRequestError(
        "invalid_request",
        400,
        "Integration installation permission is not supported for this provider."
      );
    }

    return permission as IntegrationPermission;
  });
  const uniquePermissions = [...new Set(permissions)];

  for (const permission of required) {
    if (!uniquePermissions.includes(permission)) {
      throw new ApiRequestError(
        "invalid_request",
        400,
        "Integration installation permissions must include required provider permissions."
      );
    }
  }

  return uniquePermissions;
}

function parseIntegrationSyncJobPayload(
  payload: unknown,
  provider: IntegrationProvider,
  workspaceId: string
) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Integration sync job payload must be an object.");
  }

  const installationId = getBoundedIdentifier(payload.installationId, 160);

  if (!installationId) {
    throw new ApiRequestError("invalid_request", 400, "Integration installation id is required.");
  }

  return {
    installationId,
    mappingId: getBoundedText(payload.mappingId, 300),
    provider,
    reason: parseIntegrationSyncReason(payload.reason),
    runAfter: parseOptionalTimestamp(payload.runAfter, "runAfter"),
    workspaceId
  };
}

function parseIntegrationSyncRunPayload(payload: unknown) {
  if (payload === undefined || payload === null) {
    return {};
  }

  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Integration sync run payload must be an object.");
  }

  return {
    limit: getPositiveInteger(payload.limit, 10),
    provider: payload.provider === undefined ? undefined : parseIntegrationProviderValue(payload.provider),
    workspaceId: getBoundedText(payload.workspaceId, 120)
  };
}

function parseIntegrationSyncReason(value: unknown): IntegrationSyncJobReason {
  const reason = getBoundedText(value, 40) ?? "manual";

  if (reason === "manual" || reason === "scheduled" || reason === "webhook" || reason === "retry") {
    return reason;
  }

  throw new ApiRequestError("invalid_request", 400, "Integration sync job reason is not supported.");
}

function parseIntegrationProviderValue(value: unknown): IntegrationProvider {
  const provider = getBoundedText(value, 40);
  if (provider && integrationProviders.includes(provider as IntegrationProvider)) {
    return provider as IntegrationProvider;
  }

  throw new ApiRequestError("invalid_request", 400, "Integration provider is not supported.");
}

function sanitizeSyncJobForApi(job: IntegrationSyncJob) {
  return {
    attempt: job.attempt,
    ...(job.claimedAt ? { claimedAt: job.claimedAt } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    createdAt: job.createdAt,
    dedupeKey: job.dedupeKey,
    ...(job.error ? { error: job.error } : {}),
    id: job.id,
    installationId: job.installationId,
    ...(job.lastRunAt ? { lastRunAt: job.lastRunAt } : {}),
    ...(job.mappingId ? { mappingId: job.mappingId } : {}),
    ...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}),
    provider: job.provider,
    reason: job.reason,
    ...(job.resultSummary ? { resultSummary: job.resultSummary } : {}),
    status: job.status,
    updatedAt: job.updatedAt,
    workspaceId: job.workspaceId
  };
}

function countQueuedSyncJobs(
  state: IntegrationState,
  filters: { provider?: IntegrationProvider; workspaceId?: string }
) {
  return state.syncJobs.filter(
    (job) =>
      job.status === "queued" &&
      (!filters.provider || job.provider === filters.provider) &&
      (!filters.workspaceId || job.workspaceId === filters.workspaceId)
  ).length;
}

function sanitizeIntegrationWorkerSummary(value: unknown) {
  const text = getBoundedText(value, 500);
  return text ? redactSensitiveText(text) : undefined;
}

function sanitizeIntegrationWorkerFailure(
  value: unknown,
  kind: "retryable-error" | "fatal-error"
) {
  const fallback =
    kind === "retryable-error"
      ? "Integration sync worker reported a retryable error."
      : "Integration sync worker reported a fatal error.";
  return redactSensitiveText(getBoundedText(value, 500) ?? fallback);
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:accept_token|access_token|recovery|reset|refresh_token|invite|token|jwt|secret|client_secret|authorization)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /((?:accept[_-]?token|access[_-]?token|recovery|reset|refresh[_-]?token|invite|token|secret|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .replace(/\b[\w.-]*(?:token|secret|password|credential|authorization)[\w.-]*\b/gi, "[redacted]")
    .slice(0, 500);
}

function parseIntegrationProviderPath(encodedProvider: string): IntegrationProvider {
  const provider = decodeURIComponent(encodedProvider);
  if (integrationProviders.includes(provider as IntegrationProvider)) {
    return provider as IntegrationProvider;
  }

  throw new ApiRequestError("invalid_request", 400, "Integration provider is not supported.");
}

function parseCredentialPermissions(
  value: unknown,
  installation: IntegrationInstallation
): IntegrationPermission[] {
  if (value === undefined) return [...installation.permissions];

  if (!Array.isArray(value)) {
    throw new ApiRequestError("invalid_request", 400, "Credential permissions must be an array.");
  }

  const permissions = value.map((item) => {
    const permission = getBoundedText(item, 80);
    if (!permission || !integrationPermissions.includes(permission as IntegrationPermission)) {
      throw new ApiRequestError("invalid_request", 400, "Credential permission is not supported.");
    }

    if (!installation.permissions.includes(permission as IntegrationPermission)) {
      throw new ApiRequestError(
        "invalid_request",
        400,
        "Credential permissions must stay within the installation permissions."
      );
    }

    return permission as IntegrationPermission;
  });

  return [...new Set(permissions)];
}

function parseCredentialProviderScopes(value: unknown) {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    throw new ApiRequestError("invalid_request", 400, "Credential provider scopes must be an array.");
  }

  const scopes = value.map((item) => {
    const scope = getBoundedText(item, 160);
    if (!scope) {
      throw new ApiRequestError("invalid_request", 400, "Credential provider scope is invalid.");
    }
    return scope;
  });

  return [...new Set(scopes)];
}

function parseOptionalTimestamp(value: unknown, field: string) {
  const text = getBoundedText(value, 80);
  if (!text) return undefined;
  const timestamp = Date.parse(text);

  if (!Number.isFinite(timestamp)) {
    throw new ApiRequestError("invalid_request", 400, `${field} must be a valid timestamp.`);
  }

  return new Date(timestamp).toISOString();
}

function getRequiredSecretText(value: unknown, field: string) {
  const text = getOptionalSecretText(value, field);
  if (!text) {
    throw new ApiRequestError("invalid_request", 400, `${field} is required.`);
  }
  return text;
}

function getOptionalSecretText(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiRequestError("invalid_request", 400, `${field} must be a string.`);
  }

  const text = value.trim();
  if (!text) return undefined;

  if (text.length > 20_000) {
    throw new ApiRequestError("invalid_request", 400, `${field} is too long.`);
  }

  return text;
}

function createIntegrationCredentialId(provider: IntegrationProvider, installationId: string) {
  return `credential-${provider}-${normalizeIdentifier(installationId)}-${randomUUID()}`;
}

function doesProviderInstallationIdMatch(
  provider: IntegrationProvider,
  storedId: string,
  candidateId: string
) {
  if (provider === "github") return doesGitHubInstallationIdMatch(storedId, candidateId);
  return storedId === candidateId;
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
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
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

    const auditEvent = await runIntegrationMutationExclusive(async () => {
      const integrationResult = await integrationStore.load();
      await integrationStore.replaceState(
        parseIntegrationState({
          ...integrationResult.state,
          installations: upsertInstallationByScope(integrationResult.state.installations, installation)
        })
      );
      return recordAuditEvent(teamStore, current.state, access, {
        summary: `Verified GitHub App installation ${installation.providerAccountName}.`,
        type: "integration.github.app.verify",
        workspaceId
      });
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
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
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
      const webhookResponse = await runIntegrationMutationExclusive(async () => {
        const current = await store.load();
        const integrationResult = await integrationStore.load();
        const duplicateEvent = integrationResult.state.syncEvents.find(
          (item) => item.provider === "github" && item.deliveryId === deliveryId
        );

        if (duplicateEvent) {
          return {
            body: {
              event: sanitizeIntegrationSyncEvent({
                ...duplicateEvent,
                result: "duplicate",
                summary: `Duplicate GitHub delivery ${deliveryId} ignored.`
              }),
              status: "duplicate"
            },
            statusCode: 200
          };
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

        return {
          body: {
            event: sanitizeIntegrationSyncEvent(result.event),
            status: result.event.result,
            totals: {
              installations: integrationState.installations.length,
              mappings: integrationState.mappings.length,
              syncEvents: integrationState.syncEvents.length
            }
          },
          statusCode: 202
        };
      });

      writeJson(response, webhookResponse.statusCode, webhookResponse.body, access);
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
  runIntegrationMutationExclusive: NotificationDeliveryRunner,
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

    const { auditEvent, disconnected, integrationState } = await runIntegrationMutationExclusive(
      async () => {
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

        return { auditEvent, disconnected, integrationState };
      }
    );

    writeJson(
      response,
      200,
      {
        disconnectedMappings: disconnected.disconnectedMappings,
        installation: sanitizeInstallation(disconnected.installation),
        revision: auditEvent?.id ?? `github-disconnect-${Date.now()}`,
        revokedCredentials: disconnected.revokedCredentials,
        status: "disconnected",
        totals: {
          credentials: integrationState.credentials.length,
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
  const credentialRevocation =
    nextStatus === "disconnected"
      ? revokeCredentialsForInstallations(
          integrationState.credentials,
          affectedInstallations,
          now
        )
      : { credentials: integrationState.credentials, revokedCredentials: [] };
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
        credentials: credentialRevocation.credentials,
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
  return disconnectProviderInstallationState({
    integrationState,
    installationId,
    now,
    provider: "github",
    workspaceId
  });
}

function disconnectProviderInstallationState({
  integrationState,
  installationId,
  now,
  provider,
  workspaceId
}: {
  integrationState: IntegrationState;
  installationId: string;
  now: string;
  provider: IntegrationProvider;
  workspaceId: string;
}) {
  const installation = integrationState.installations.find(
    (item) =>
      item.provider === provider &&
      item.workspaceId === workspaceId &&
      doesProviderInstallationIdMatch(provider, item.id, installationId)
  );

  if (!installation) {
    throw new ApiRequestError("not_found", 404, "Integration installation was not found.");
  }

  const nextInstallation =
    installation.status === "disconnected"
      ? installation
      : { ...installation, status: "disconnected" as const };
  let disconnectedMappings = 0;
  const mappings = integrationState.mappings.map((mapping) => {
    if (
      mapping.external.provider === provider &&
      mapping.installationId === installation.id &&
      mapping.openRoad.workspaceId === workspaceId &&
      mapping.status !== "disconnected"
    ) {
      disconnectedMappings += 1;
      return disconnectMapping(mapping, now);
    }

    return mapping;
  });
  const credentialRevocation = revokeIntegrationCredentialsForInstallation(
    integrationState.credentials,
    installation,
    now
  );
  const changed =
    installation.status !== "disconnected" ||
    disconnectedMappings > 0 ||
    credentialRevocation.revokedCredentials.length > 0;

  return {
    changed,
    disconnectedMappings,
    installation: nextInstallation,
    integrationState: parseIntegrationState({
      ...integrationState,
      credentials: credentialRevocation.credentials,
      installations: replaceInstallationByScope(integrationState.installations, nextInstallation),
      mappings
    }),
    revokedCredentials: credentialRevocation.revokedCredentials.length
  };
}

function revokeCredentialsForInstallations(
  credentials: IntegrationCredential[],
  installations: IntegrationInstallation[],
  revokedAt: string
) {
  return installations.reduce(
    (result, installation) => {
      const nextResult = revokeIntegrationCredentialsForInstallation(
        result.credentials,
        installation,
        revokedAt
      );

      return {
        credentials: nextResult.credentials,
        revokedCredentials: [...result.revokedCredentials, ...nextResult.revokedCredentials]
      };
    },
    { credentials, revokedCredentials: [] as IntegrationCredential[] }
  );
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
          integrationCredentials: integrations?.state.credentials.length ?? 0,
          integrationInstallations: integrations?.state.installations.length ?? 0,
          integrationMappings: integrations?.state.mappings.length ?? 0,
          integrationSyncEvents: integrations?.state.syncEvents.length ?? 0,
          integrationSyncJobs: integrations?.state.syncJobs.length ?? 0,
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

async function handleNotificationDeliveryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  notificationDeliveryAdapter: NotificationDeliveryAdapter | undefined,
  runNotificationDeliveryExclusive: NotificationDeliveryRunner
) {
  if (request.method !== "POST") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports POST.", access);
    return;
  }

  try {
    requirePermission(access, "state:write");

    if (!notificationDeliveryAdapter) {
      writeApiError(
        response,
        503,
        "not_configured",
        "Requester notification delivery is not configured.",
        access
      );
      return;
    }

    const payload = await readJsonBody(request, 20_000);
    const workspaceId = isRecord(payload) ? getBoundedText(payload.workspaceId, 120) : undefined;
    const limit = isRecord(payload) ? getPositiveInteger(payload.limit, 100) : 100;
    const deliveryResponse = await runNotificationDeliveryExclusive(async () => {
      const result = await store.load();

      if (workspaceId && !result.state.workspaces.some((workspace) => workspace.id === workspaceId)) {
        throw new ApiRequestError("not_found", 404, "Workspace was not found.");
      }

      const delivery = await deliverRequesterNotifications(result.state, notificationDeliveryAdapter, {
        limit,
        workspaceId
      });
      let state = result.state;

      if (delivery.changed) {
        const latest = await store.load();
        const merged = mergeNotificationDeliveryState(latest.state, delivery.state);
        state = merged === latest.state ? latest.state : await store.replaceState(merged);
      }

      await recordAuditEvent(teamStore, state, access, {
        summary: `Requester notification delivery processed ${delivery.attempted} event(s).`,
        type: "notifications.deliver",
        workspaceId
      });

      return {
        attempted: delivery.attempted,
        delivered: delivery.delivered,
        failed: delivery.failed,
        remainingQueued: countQueuedNotifications(state, workspaceId),
        skipped: delivery.skipped,
        status: "processed",
        workspaceId: workspaceId ?? null
      };
    });

    writeJson(response, 200, deliveryResponse, access);
  } catch (error) {
    writeKnownApiError(response, error, access);
  }
}

async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: OpenRoadStore,
  access: AccessContext,
  teamStore: TeamStore | undefined,
  encodedWorkspaceId: string
) {
  if (request.method !== "GET" && request.method !== "PUT") {
    writeApiError(response, 405, "invalid_method", "This endpoint only supports GET and PUT.", access);
    return;
  }

  const workspaceId = decodeURIComponent(encodedWorkspaceId);

  try {
    if (request.method === "GET") {
      requirePermission(access, "workspace:read", workspaceId);
      const result = await store.load();
      const workspace = result.state.workspaces.find((item) => item.id === workspaceId);

      if (!workspace) {
        writeApiError(response, 404, "not_found", "Workspace was not found.", access);
        return;
      }

      writeJson(response, 200, { workspace }, access);
      return;
    }

    requirePermission(access, "workspace:write", workspaceId);
    const payload = await readJsonBody(request);
    const workspacePayload = getWorkspacePayload(payload);

    if (!isRecord(workspacePayload) || workspacePayload.id !== workspaceId) {
      throw new OpenRoadStoreError(
        "invalid_state",
        "Workspace payload must match the requested workspace."
      );
    }

    const current = await store.load();
    if (!current.state.workspaces.some((item) => item.id === workspaceId)) {
      writeApiError(response, 404, "not_found", "Workspace was not found.", access);
      return;
    }

    const nextState = parseOpenRoadState({
      ...current.state,
      workspaces: current.state.workspaces.map((workspace) =>
        workspace.id === workspaceId ? workspacePayload : workspace
      )
    });
    const state = await store.replaceState(nextState);
    const auditEvent = await recordAuditEvent(teamStore, state, access, {
      summary: "Replaced workspace data.",
      type: "workspace.replace",
      workspaceId
    });
    const workspace = state.workspaces.find((item) => item.id === workspaceId);

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

  const requester = getPortalRequester(undefined, request, workspaceId);

  writeJson(
    response,
    200,
    createPublicPortalSnapshot(workspace, requestUrl.searchParams.get("query") ?? "", {
      exposeLocalVoteState: false,
      publicVoterKey: requester.voterKey
    }),
    access,
    requester.cookieHeaders
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
    const currentRequest = getPublicPortalActionTarget(
      result.state,
      workspaceId,
      requestId,
      "vote"
    );
    consumePortalRateLimit(portalRateLimiter, requester.rateLimitKey);

    if (currentRequest.publicVoterKeys.includes(requester.voterKey)) {
      writeJson(
        response,
        200,
        getPublicPortalRequestPayload(
          result.state,
          workspaceId,
          requestId,
          requester.voterKey,
          "already_saved"
        ),
        access,
        requester.cookieHeaders
      );
      return;
    }

    const nextState = updatePublicPortalRequest(
      result.state,
      workspaceId,
      requestId,
      "vote",
      (requestItem) => ({
        ...requestItem,
        hasCurrentUserVote: true,
        publicVoterKeys: [...requestItem.publicVoterKeys, requester.voterKey],
        votes: requestItem.votes + 1
      })
    );
    const state = await store.replaceState(nextState);
    await recordAuditEvent(teamStore, state, requesterAccess, {
      summary: `Public portal vote recorded for ${requestId}.`,
      type: "portal.vote",
      workspaceId
    });
    writeJson(
      response,
      200,
      getPublicPortalRequestPayload(state, workspaceId, requestId, requester.voterKey, "saved"),
      access,
      requester.cookieHeaders
    );
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
    getPublicPortalActionTarget(result.state, workspaceId, requestId, "comment");
    consumePortalRateLimit(portalRateLimiter, requester.rateLimitKey);
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
    const state = await store.replaceState(nextState);
    await recordAuditEvent(teamStore, state, requesterAccess, {
      summary: `Public portal comment recorded for ${requestId}.`,
      type: "portal.comment",
      workspaceId
    });
    writeJson(
      response,
      201,
      getPublicPortalRequestPayload(state, workspaceId, requestId, requester.voterKey, "saved"),
      access,
      requester.cookieHeaders
    );
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

function getWorkspacePayload(payload: unknown) {
  if (isRecord(payload) && "workspace" in payload) {
    return payload.workspace;
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

  getPublicPortalActionTargetFromWorkspace(workspace, requestId, actionKind);

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

function getPublicPortalActionTarget(
  state: OpenRoadState,
  workspaceId: string,
  requestId: string,
  actionKind: PortalActionKind
) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new PortalActionError("not_found", 404, "Workspace was not found.");
  }

  return getPublicPortalActionTargetFromWorkspace(workspace, requestId, actionKind);
}

function getPublicPortalActionTargetFromWorkspace(
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

  return requestItem;
}

function getPublicPortalRequestPayload(
  state: OpenRoadState,
  workspaceId: string,
  requestId: string,
  publicVoterKey: string,
  status: "already_saved" | "saved"
) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  const request = workspace
    ? createPublicPortalSnapshot(workspace, "", {
        exposeLocalVoteState: false,
        publicVoterKey
      }).requests.find((item) => item.id === requestId)
    : undefined;

  if (!request) {
    throw new PortalActionError("not_found", 404, "Public request was not found.");
  }

  return { request, status };
}

function getPortalRequester(
  payload: unknown,
  request: IncomingMessage,
  workspaceId: string
): PortalRequester {
  const requester = isRecord(payload) && isRecord(payload.requester) ? payload.requester : {};
  const remoteAddress = request.socket.remoteAddress ?? "unknown";
  const cookieVisitorId = getPortalVisitorCookie(request);
  const headerVisitorId = getSingleHeader(request.headers, "x-openroad-visitor-id");
  const headerRequesterId = getSingleHeader(request.headers, "x-openroad-requester-id");
  const rawRequesterId =
    getBoundedText(requester.id, 120) ??
    getBoundedText(headerRequesterId, 120);
  const visitorId =
    normalizePortalVisitorId(cookieVisitorId) ??
    normalizePortalVisitorId(headerVisitorId) ??
    normalizePortalVisitorId(rawRequesterId) ??
    createPortalVisitorId();
  const normalizedId =
    normalizeIdentifier(rawRequesterId ?? visitorId) || normalizeIdentifier(visitorId);
  const name =
    getBoundedText(requester.name, 80) ??
    getBoundedText(isRecord(payload) ? payload.author : undefined, 80) ??
    "Portal visitor";

  return {
    cookieHeaders: {
      "Set-Cookie": createPortalVisitorCookie(visitorId),
      "X-OpenRoad-Visitor-Id": visitorId
    },
    id: normalizedId,
    name,
    rateLimitKey: `${workspaceId}:${remoteAddress}`,
    visitorId,
    voterKey: `public-visitor:${visitorId}`
  };
}

function createPortalVisitorId() {
  return `opv_${randomUUID().replace(/-/g, "").slice(0, 32)}`;
}

function normalizePortalVisitorId(value: unknown) {
  const normalized = getBoundedText(value, 120);
  if (!normalized) return undefined;
  const visitorId = normalizeIdentifier(normalized);
  return visitorId.length >= 8 ? visitorId : undefined;
}

function createPortalVisitorCookie(visitorId: string) {
  return [
    `${portalVisitorCookieName}=${encodeURIComponent(visitorId)}`,
    "HttpOnly",
    `Max-Age=${portalVisitorCookieMaxAgeSeconds}`,
    "Path=/api/openroad",
    "SameSite=Lax"
  ].join("; ");
}

function getPortalVisitorCookie(request: IncomingMessage) {
  const cookieHeader = getSingleHeader(request.headers, "cookie");
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = pair.split("=");
    if (rawName.trim() !== portalVisitorCookieName) continue;

    const value = rawValue.join("=").trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
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

function countQueuedNotifications(state: OpenRoadState, workspaceId?: string) {
  return state.workspaces.reduce((count, workspace) => {
    if (workspaceId && workspace.id !== workspaceId) return count;
    return count + workspace.notifications.outbox.filter((event) => event.status === "queued").length;
  }, 0);
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

  if (error instanceof SessionStoreError) {
    const status = error.code === "future_schema" ? 409 : 422;
    writeApiError(response, status, error.code, error.message, access);
    return;
  }

  if (error instanceof TeamStoreError) {
    const status =
      error.code === "future_schema"
        ? 409
        : error.code === "not_found"
          ? 404
          : error.code === "invalid_request"
            ? 400
            : 422;
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

  if (error instanceof IntegrationSyncJobError) {
    const status = error.code === "not_found" ? 404 : error.code === "queue_full" ? 429 : 422;
    writeApiError(response, status, error.code, error.message, access);
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
  access: AccessContext,
  headers: Record<string, string> = {}
) {
  response.writeHead(status, { ...jsonHeaders, ...headers });
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

async function resolveSessionActorForRequest(
  request: IncomingMessage,
  auth: AuthOptions | undefined,
  sessionStore: SessionStore | undefined
) {
  if (!auth?.adminToken || !sessionStore) return undefined;

  const session = await sessionStore.resolveSession({
    adminToken: auth.adminToken,
    cookieValue: getSessionCookieValue(getSingleHeader(request.headers, "cookie"))
  });

  return session?.actor;
}

function getAdminTokenLoginPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Login payload must be an object.");
  }

  const adminToken = getBoundedText(payload.adminToken, 4096) ?? getBoundedText(payload.token, 4096);
  if (!adminToken) {
    throw new ApiRequestError("invalid_request", 400, "Admin token is required.");
  }

  return adminToken;
}

function getPasswordLoginPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Password login payload must be an object.");
  }

  const email = getBoundedText(payload.email, 254);
  const password = getPasswordText(payload.password);
  if (!email || !password) {
    throw new ApiRequestError("invalid_request", 400, "Email and password are required.");
  }

  return {
    email,
    password,
    workspaceId: getBoundedText(payload.workspaceId, 160)
  };
}

function getAccountRecoveryRequestPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Account recovery payload must be an object.");
  }

  const email = getBoundedText(payload.email, 254);
  if (!email) {
    throw new ApiRequestError("invalid_request", 400, "Email is required.");
  }

  return {
    email,
    workspaceId: getBoundedText(payload.workspaceId, 160)
  };
}

function getAccountRecoveryConfirmPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError(
      "invalid_request",
      400,
      "Account recovery confirmation payload must be an object."
    );
  }

  const token = getBoundedText(payload.token, 512) ?? getBoundedText(payload.recoveryToken, 512);
  const password = getPasswordText(payload.password);
  if (!token || !password) {
    throw new ApiRequestError("invalid_request", 400, "Recovery token and password are required.");
  }

  return {
    password,
    token,
    workspaceId: getBoundedText(payload.workspaceId, 160)
  };
}

function getAccountPasswordPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Account password payload must be an object.");
  }

  const password = getPasswordText(payload.password);
  if (!password) {
    throw new ApiRequestError("invalid_request", 400, "Password is required.");
  }

  return {
    currentPassword: getPasswordText(payload.currentPassword),
    password
  };
}

function getAccountPasswordActorUserId(access: AccessContext) {
  if (access.actor.type === "local-owner") return "local-owner";
  if (access.actor.type === "workspace-member") return access.actor.id;
  throw new AccessDeniedError("Account password updates require an authenticated OpenRoad user.");
}

function getInvitationCreatePayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Invitation payload must be an object.");
  }

  const email = getBoundedText(payload.email, 254);
  if (!email) {
    throw new ApiRequestError("invalid_request", 400, "Invitation email is required.");
  }

  const role = getWorkspaceRolePayload(payload.role);
  if (!role) {
    throw new ApiRequestError("invalid_request", 400, "Invitation role is required.");
  }

  return {
    email,
    expiresAt: getBoundedText(payload.expiresAt, 80),
    invitedName: getBoundedText(payload.name, 120) ?? getBoundedText(payload.invitedName, 120),
    role
  };
}

function getInvitationAcceptPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Invitation acceptance payload must be an object.");
  }

  const token = getBoundedText(payload.token, 512) ?? getBoundedText(payload.acceptToken, 512);
  if (!token) {
    throw new ApiRequestError("invalid_request", 400, "Invitation token is required.");
  }

  return {
    acceptedName: getBoundedText(payload.name, 120) ?? getBoundedText(payload.acceptedName, 120),
    token
  };
}

function getWorkspaceMemberRolePayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new ApiRequestError("invalid_request", 400, "Workspace member payload must be an object.");
  }

  const role = getWorkspaceRolePayload(payload.role);
  if (!role) {
    throw new ApiRequestError("invalid_request", 400, "Workspace member role is required.");
  }

  return role;
}

function getWorkspaceRolePayload(value: unknown): WorkspaceRole | undefined {
  return value === "Owner" ||
    value === "Maintainer" ||
    value === "Contributor" ||
    value === "Viewer"
    ? value
    : undefined;
}

function sanitizeInvitationForJson(invitation: TeamInvitationSummary) {
  return { ...invitation };
}

function sanitizeAccountRecoveryForJson(recovery: TeamAccountRecoverySummary) {
  return { ...recovery };
}

function sanitizeWorkspaceMemberForJson(member: TeamWorkspaceMemberSummary) {
  return { ...member };
}

function sanitizeMembership(membership: { id: string; role: WorkspaceRole; userId: string; workspaceId: string }) {
  return {
    id: membership.id,
    role: membership.role,
    userId: membership.userId,
    workspaceId: membership.workspaceId
  };
}

function sanitizeTeamUser(user: { email: string; id: string; name: string }) {
  return {
    email: user.email,
    id: user.id,
    name: user.name
  };
}

function writeAccountRecoveryRequested(response: ServerResponse, access: AccessContext) {
  writeJson(
    response,
    200,
    {
      message:
        "If this account can be recovered, OpenRoad will send password reset instructions.",
      status: "requested"
    },
    access
  );
}

function createSessionCookie(
  cookieValue: string,
  maxAgeSeconds: number,
  request: IncomingMessage,
  auth: AuthOptions | undefined
) {
  return [
    `${sessionCookieName}=${encodeURIComponent(cookieValue)}`,
    "HttpOnly",
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "SameSite=Lax",
    ...(isSecureRequest(request, auth) ? ["Secure"] : [])
  ].join("; ");
}

function createExpiredSessionCookie(
  request: IncomingMessage,
  auth: AuthOptions | undefined
) {
  return [
    `${sessionCookieName}=`,
    "HttpOnly",
    "Max-Age=0",
    "Path=/",
    "SameSite=Lax",
    ...(isSecureRequest(request, auth) ? ["Secure"] : [])
  ].join("; ");
}

function isSecureRequest(request: IncomingMessage, auth: AuthOptions | undefined) {
  const socket = request.socket as typeof request.socket & { encrypted?: boolean };
  if (socket.encrypted) return true;
  if (!auth?.trustProxyHeaders) return false;

  const forwardedProto = getSingleHeader(request.headers, "x-forwarded-proto");
  return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https";
}

function resolveRequestOrigin(request: IncomingMessage, auth: AuthOptions | undefined) {
  const forwardedHost = auth?.trustProxyHeaders
    ? getFirstHeaderValue(getSingleHeader(request.headers, "x-forwarded-host"))
    : undefined;
  const host =
    forwardedHost ??
    getFirstHeaderValue(getSingleHeader(request.headers, "host")) ??
    "openroad.local";
  const forwardedProto = auth?.trustProxyHeaders
    ? getFirstHeaderValue(getSingleHeader(request.headers, "x-forwarded-proto"))
    : undefined;
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : isSecureRequest(request, auth)
        ? "https"
        : "http";

  return `${protocol}://${host}`;
}

function getFirstHeaderValue(value: string | undefined) {
  return value?.split(",")[0]?.trim() || undefined;
}

function safeSecretEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isSingleUserAuthEnabled(auth: AuthOptions | undefined) {
  return Boolean(auth?.singleUserMode || (!auth?.adminToken && auth?.singleUserMode !== false));
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

function getPasswordText(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.slice(0, 256);
}

function safeExternalErrorMessage(error: unknown, fallback: string) {
  const text = error instanceof Error ? error.message : String(error);
  return getBoundedText(redactSensitiveText(text), 240) ?? fallback;
}

function sanitizeDeliveryMessageId(value: unknown) {
  const bounded = getBoundedText(value, 500);
  if (!bounded) return undefined;
  const redacted = redactSensitiveText(bounded);
  if (redacted !== bounded) return "[redacted]";
  return getBoundedText(redacted, 240);
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

function getPositiveInteger(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  return fallback;
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
