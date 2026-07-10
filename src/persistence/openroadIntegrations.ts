import type {
  IntegrationInstallation,
  IntegrationPermission,
  IntegrationProvider
} from "../integrations/adapter";

export type IntegrationConnectionState = "attention" | "connected" | "optional" | "ready";
export type IntegrationStatusState = "forbidden" | "ready" | "unavailable";

export type IntegrationStatusJobSummary = {
  attempt: number;
  completedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  installationId: string;
  lastRunAt?: string;
  nextRunAt?: string;
  provider: IntegrationProvider;
  reason: "manual" | "retry" | "scheduled" | "webhook";
  resultSummary?: string;
  status: "failed" | "queued" | "running" | "succeeded";
  updatedAt: string;
  workspaceId: string;
};

export type IntegrationStatusAccountSummary = {
  createdAt: string;
  id: string;
  providerAccountName: string;
  status: "active" | "disconnected" | "suspended";
};

export type IntegrationConflictSummary = {
  connectedAt: string;
  external: {
    id: string;
    key?: string;
    type: "issue";
    url?: string;
  };
  installationId: string;
  lastSyncedAt?: string;
  mappingId: string;
  openRoad: {
    id: string;
    status: string;
    title: string;
    type: "request";
  };
  providerAccountName: string;
};

export type IntegrationProviderStatus = {
  accounts: IntegrationStatusAccountSummary[];
  activeCredentials: number;
  activeInstallations: number;
  capabilities: {
    disconnect: boolean;
    import: boolean;
    liveSync: boolean;
    manualSync: boolean;
    resolveConflicts: boolean;
    setup: boolean;
    webhooks: boolean;
    writeBack: boolean;
  };
  conflictedMappings: number;
  conflicts: IntegrationConflictSummary[];
  connection: IntegrationConnectionState;
  disconnectedAccounts: IntegrationStatusAccountSummary[];
  label: string;
  lastJobStatus?: IntegrationStatusJobSummary["status"];
  lastJobUpdatedAt?: string;
  lastSyncedAt?: string;
  linkedIssueMappings: number;
  linkedMappings: number;
  provider: IntegrationProvider;
  queuedSyncJobs: number;
  recentJobs: IntegrationStatusJobSummary[];
  runningSyncJobs: number;
  setupConfigured: boolean;
  statusText: string;
  syncWorkerConfigured: boolean;
  totalInstallations: number;
};

export type WorkspaceIntegrationStatus = {
  integrationMetadata?: {
    recovered: boolean;
    schemaVersion: number;
    status: string;
  };
  message?: string;
  providers: IntegrationProviderStatus[];
  status: IntegrationStatusState;
  workspaceId: string;
};

export type ProviderManualSyncResult = {
  jobStatus?: IntegrationStatusJobSummary["status"];
  message: string;
  status: "deduped" | "failed" | "forbidden" | "queued" | "succeeded" | "unavailable";
};

export type ProviderWriteBackResult = {
  external?: {
    id: string;
    key?: string;
    type: "issue";
    url?: string;
  };
  installationId?: string;
  mappingId?: string;
  message: string;
  provider: IntegrationProvider;
  requestId?: string;
  status: "forbidden" | "unavailable" | "written";
  writtenAt?: string;
};

export type ProviderConflictResolution = "accept-provider" | "disconnect-mapping" | "keep-openroad";

export type ProviderConflictResolutionResult = {
  external?: {
    id: string;
    key?: string;
    type: "issue";
    url?: string;
  };
  installationId?: string;
  mappingId?: string;
  message: string;
  provider: IntegrationProvider;
  requestId?: string;
  resolution: ProviderConflictResolution;
  resolvedAt?: string;
  status: "forbidden" | "resolved" | "unavailable";
};

export type IntegrationCredentialSecretType = "access-token" | "refresh-token";

export type IntegrationCredentialMetadata = {
  createdAt: string;
  expiresAt?: string;
  id: string;
  installationId: string;
  label?: string;
  permissions: IntegrationPermission[];
  provider: IntegrationProvider;
  providerScopes: string[];
  revokedAt?: string;
  secretTypes: IntegrationCredentialSecretType[];
  status: "active" | "revoked";
  tokenType?: string;
  updatedAt: string;
  workspaceId: string;
};

export type ProviderInstallationInput = {
  installationId: string;
  permissions?: IntegrationPermission[];
  providerAccountId: string;
  providerAccountName: string;
};

export type ProviderCredentialInput = {
  accessToken: string;
  expiresAt?: string;
  installationId: string;
  label?: string;
  permissions?: IntegrationPermission[];
  providerScopes?: string[];
  refreshToken?: string;
  tokenType?: string;
};

export type ProviderSetupResult = {
  changed?: boolean;
  credential?: IntegrationCredentialMetadata;
  credentials?: IntegrationCredentialMetadata[];
  installation?: IntegrationInstallation;
  installations?: IntegrationInstallation[];
  message: string;
  provider: IntegrationProvider;
  revokedCredentials?: number;
  status:
    | "connected"
    | "disconnected"
    | "forbidden"
    | "listed"
    | "revoked"
    | "stored"
    | "unavailable"
    | "verified";
};

const providerLabels: Record<IntegrationProvider, string> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear"
};

const integrationPermissionValues: IntegrationPermission[] = [
  "read:external",
  "write:external",
  "read:openroad",
  "write:openroad",
  "webhook:receive"
];

const credentialSecretTypeValues: IntegrationCredentialSecretType[] = [
  "access-token",
  "refresh-token"
];

export function createStandaloneIntegrationStatus(
  workspaceId: string,
  message = "Standalone mode is ready. Integrations are optional accelerators."
): WorkspaceIntegrationStatus {
  return {
    message,
    providers: (Object.keys(providerLabels) as IntegrationProvider[]).map((provider) => ({
      accounts: [],
      activeCredentials: 0,
      activeInstallations: 0,
      capabilities: {
        disconnect: false,
        import: false,
        liveSync: false,
        manualSync: false,
        resolveConflicts: false,
        setup: false,
        webhooks: false,
        writeBack: false
      },
      conflictedMappings: 0,
      conflicts: [],
      connection: "optional",
      disconnectedAccounts: [],
      label: providerLabels[provider],
      linkedIssueMappings: 0,
      linkedMappings: 0,
      provider,
      queuedSyncJobs: 0,
      recentJobs: [],
      runningSyncJobs: 0,
      setupConfigured: false,
      statusText: "Optional. Connect later when this workspace needs provider context.",
      syncWorkerConfigured: false,
      totalInstallations: 0
    })),
    status: "unavailable",
    workspaceId
  };
}

export async function loadWorkspaceIntegrationStatus(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceIntegrationStatus> {
  let response: Response;

  try {
    response = await fetchImpl(
      `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/integrations/status`,
      { credentials: "same-origin", headers: { Accept: "application/json" } }
    );
  } catch {
    return createStandaloneIntegrationStatus(
      workspaceId,
      "Integration metadata is unavailable in this browser session."
    );
  }

  const payload = await readJsonSafely(response);

  if (!response.ok) {
    return createUnavailableIntegrationStatus(
      workspaceId,
      response.status === 403 ? "forbidden" : "unavailable",
      safeIntegrationErrorMessage(response.status, payload, "status")
    );
  }

  return parseWorkspaceIntegrationStatus(payload, workspaceId);
}

function createUnavailableIntegrationStatus(
  workspaceId: string,
  status: IntegrationStatusState,
  message: string
) {
  return {
    ...createStandaloneIntegrationStatus(workspaceId, message),
    status
  };
}

export async function runProviderManualSync(
  provider: Extract<IntegrationProvider, "github" | "jira" | "linear">,
  workspaceId: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderManualSyncResult> {
  const providerLabel = providerLabels[provider];
  const enqueue = await postJsonSafely(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/integrations/${provider}/sync/jobs`,
    { installationId, reason: "manual" },
    fetchImpl
  );

  if (!enqueue.ok) {
    return {
      message: safeIntegrationErrorMessage(enqueue.status, enqueue.payload),
      status: enqueue.status === 403 ? "forbidden" : "unavailable"
    };
  }

  const enqueueStatus = getRecordText(enqueue.payload, "status");
  const runner = await postJsonSafely(
    "/api/openroad/integrations/sync/run",
    { limit: 5, provider, workspaceId },
    fetchImpl
  );

  if (!runner.ok) {
    return {
      message:
        enqueueStatus === "deduped"
          ? `A ${providerLabel} sync job is already queued. The private runner is unavailable in this session.`
          : `${providerLabel} sync was queued. The private runner is unavailable in this session.`,
      status: enqueueStatus === "deduped" ? "deduped" : "queued"
    };
  }

  const processed = Array.isArray((runner.payload as { processed?: unknown }).processed)
    ? ((runner.payload as { processed: unknown[] }).processed[0] as Record<string, unknown> | undefined)
    : undefined;
  const processedStatus = getRecordText(processed, "status") as ProviderManualSyncResult["jobStatus"];

  if (processedStatus === "succeeded") {
    return {
      jobStatus: processedStatus,
      message: `${providerLabel} linked issue sync completed.`,
      status: "succeeded"
    };
  }

  if (processedStatus === "queued" || processedStatus === "running") {
    return {
      jobStatus: processedStatus,
      message: `${providerLabel} sync is queued for retry.`,
      status: "queued"
    };
  }

  if (processedStatus === "failed") {
    return {
      jobStatus: processedStatus,
      message: `${providerLabel} sync ran and needs attention.`,
      status: "failed"
    };
  }

  return {
    message:
      enqueueStatus === "deduped"
        ? `A ${providerLabel} sync job is already queued.`
        : `${providerLabel} sync was queued.`,
    status: enqueueStatus === "deduped" ? "deduped" : "queued"
  };
}

export function runGitHubManualSync(
  workspaceId: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch
) {
  return runProviderManualSync("github", workspaceId, installationId, fetchImpl);
}

export async function writeBackProviderIssue(
  provider: Extract<IntegrationProvider, "github" | "jira" | "linear">,
  workspaceId: string,
  requestId: string,
  mappingId?: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderWriteBackResult> {
  const result = await postJsonSafely(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/integrations/${provider}/write-back`,
    compactBody({ mappingId, requestId }),
    fetchImpl
  );

  if (!result.ok) {
    return {
      message: safeIntegrationErrorMessage(result.status, result.payload),
      provider,
      requestId,
      status: result.status === 403 ? "forbidden" : "unavailable"
    };
  }

  return {
    external: parseWriteBackExternal(result.payload),
    installationId: getRecordIdentifier(result.payload, "installationId"),
    mappingId: getRecordIdentifier(result.payload, "mappingId"),
    message:
      getRecordText(result.payload, "message") ??
      `${providerLabels[provider]} issue updated from OpenRoad.`,
    provider,
    requestId: getRecordIdentifier(result.payload, "requestId") ?? requestId,
    status: "written",
    writtenAt: getRecordText(result.payload, "writtenAt")
  };
}

export async function resolveProviderConflict(
  provider: Extract<IntegrationProvider, "github" | "jira" | "linear">,
  workspaceId: string,
  mappingId: string,
  resolution: ProviderConflictResolution,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderConflictResolutionResult> {
  const result = await postJsonSafely(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/integrations/${provider}/conflicts/${encodeURIComponent(mappingId)}/resolve`,
    { resolution },
    fetchImpl
  );

  if (!result.ok) {
    return {
      message: safeIntegrationErrorMessage(result.status, result.payload),
      provider,
      resolution,
      status: result.status === 403 ? "forbidden" : "unavailable"
    };
  }

  return {
    external: parseIssueExternal(result.payload),
    installationId: getRecordIdentifier(result.payload, "installationId"),
    mappingId: getRecordIdentifier(result.payload, "mappingId") ?? mappingId,
    message:
      getRecordText(result.payload, "message") ??
      `${providerLabels[provider]} conflict resolved.`,
    provider,
    requestId: getRecordIdentifier(result.payload, "requestId"),
    resolution: parseConflictResolutionValue(result.payload, resolution),
    resolvedAt: getRecordText(result.payload, "resolvedAt"),
    status: "resolved"
  };
}

export async function listProviderInstallations(
  provider: IntegrationProvider,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSetupResult> {
  const result = await getJsonSafely(
    providerWorkspaceUrl(workspaceId, provider, "installations"),
    fetchImpl
  );

  if (!result.ok) {
    return providerActionFailure(provider, result.status, result.payload);
  }

  const installations = parseInstallationList(result.payload);

  return {
    installations,
    message: `${providerLabels[provider]} connection metadata loaded.`,
    provider,
    status: "listed"
  };
}

export async function createProviderInstallation(
  provider: IntegrationProvider,
  workspaceId: string,
  input: ProviderInstallationInput,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSetupResult> {
  const result = await postJsonSafely(
    providerWorkspaceUrl(workspaceId, provider, "installations"),
    compactBody(input),
    fetchImpl
  );

  if (!result.ok) {
    return providerActionFailure(provider, result.status, result.payload);
  }

  return {
    installation: parseInstallationFromPayload(result.payload),
    message: `${providerLabels[provider]} connection is active.`,
    provider,
    status: "connected"
  };
}

export async function verifyGitHubAppInstallation(
  workspaceId: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSetupResult> {
  const result = await postJsonSafely(
    `/api/openroad/workspaces/${encodeURIComponent(
      workspaceId
    )}/integrations/github/app/installations/verify`,
    { installationId },
    fetchImpl
  );

  if (!result.ok) {
    return providerActionFailure("github", result.status, result.payload);
  }

  return {
    installation: parseInstallationFromPayload(result.payload),
    message: "GitHub App installation verified.",
    provider: "github",
    status: "verified"
  };
}

export async function disconnectProviderInstallation(
  provider: IntegrationProvider,
  workspaceId: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSetupResult> {
  const result = await postJsonSafely(
    providerWorkspaceUrl(
      workspaceId,
      provider,
      `installations/${encodeURIComponent(installationId)}/disconnect`
    ),
    {},
    fetchImpl
  );

  if (!result.ok) {
    return providerActionFailure(provider, result.status, result.payload);
  }

  return {
    changed: getRecordBoolean(result.payload, "changed"),
    installation: parseInstallationFromPayload(result.payload),
    message: `${providerLabels[provider]} connection disconnected.`,
    provider,
    revokedCredentials: getRecordNumber(result.payload, "revokedCredentials"),
    status: "disconnected"
  };
}

export async function listProviderCredentials(
  provider: IntegrationProvider,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSetupResult> {
  const result = await getJsonSafely(
    providerWorkspaceUrl(workspaceId, provider, "credentials"),
    fetchImpl
  );

  if (!result.ok) {
    return providerActionFailure(provider, result.status, result.payload);
  }

  return {
    credentials: parseCredentialList(result.payload),
    message: `${providerLabels[provider]} credential metadata loaded.`,
    provider,
    status: "listed"
  };
}

export async function storeProviderCredential(
  provider: IntegrationProvider,
  workspaceId: string,
  input: ProviderCredentialInput,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSetupResult> {
  const result = await postJsonSafely(
    providerWorkspaceUrl(workspaceId, provider, "credentials"),
    compactBody(input),
    fetchImpl
  );

  if (!result.ok) {
    return providerActionFailure(provider, result.status, result.payload);
  }

  return {
    credential: parseCredentialFromPayload(result.payload),
    message: `${providerLabels[provider]} credential stored server-side.`,
    provider,
    status: "stored"
  };
}

export async function revokeProviderCredential(
  provider: IntegrationProvider,
  workspaceId: string,
  credentialId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderSetupResult> {
  const result = await postJsonSafely(
    providerWorkspaceUrl(
      workspaceId,
      provider,
      `credentials/${encodeURIComponent(credentialId)}/revoke`
    ),
    {},
    fetchImpl
  );

  if (!result.ok) {
    return providerActionFailure(provider, result.status, result.payload);
  }

  return {
    credential: parseCredentialFromPayload(result.payload),
    message: `${providerLabels[provider]} credential revoked.`,
    provider,
    status: "revoked"
  };
}

function parseWorkspaceIntegrationStatus(
  value: unknown,
  workspaceId: string
): WorkspaceIntegrationStatus {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return createStandaloneIntegrationStatus(workspaceId, "Integration metadata response was invalid.");
  }

  const providers = value.providers
    .map(parseProviderStatus)
    .filter((provider): provider is IntegrationProviderStatus => Boolean(provider));

  return {
    integrationMetadata: parseIntegrationMetadata(value.integrationMetadata),
    providers: mergeProviderFallbacks(workspaceId, providers),
    status: "ready",
    workspaceId: getRecordIdentifier(value, "workspaceId") ?? workspaceId
  };
}

async function postJsonSafely(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
) {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      method: "POST"
    });
  } catch {
    return { ok: false, payload: undefined, status: 0 };
  }

  return {
    ok: response.ok,
    payload: await readJsonSafely(response),
    status: response.status
  };
}

async function getJsonSafely(url: string, fetchImpl: typeof fetch) {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
  } catch {
    return { ok: false, payload: undefined, status: 0 };
  }

  return {
    ok: response.ok,
    payload: await readJsonSafely(response),
    status: response.status
  };
}

function providerWorkspaceUrl(
  workspaceId: string,
  provider: IntegrationProvider,
  path: string
) {
  return `/api/openroad/workspaces/${encodeURIComponent(
    workspaceId
  )}/integrations/${provider}/${path}`;
}

function compactBody(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) return false;
      if (typeof entry === "string") return Boolean(entry.trim());
      if (Array.isArray(entry)) return entry.length > 0;
      return true;
    })
  );
}

function providerActionFailure(
  provider: IntegrationProvider,
  status: number,
  payload: unknown
): ProviderSetupResult {
  return {
    message: safeIntegrationErrorMessage(status, payload, "action"),
    provider,
    status: status === 403 ? "forbidden" : "unavailable"
  };
}

async function readJsonSafely(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function parseProviderStatus(value: unknown): IntegrationProviderStatus | undefined {
  if (!isRecord(value)) return undefined;
  const provider = getProvider(value.provider);
  if (!provider) return undefined;

  return {
    accounts: Array.isArray(value.accounts)
      ? value.accounts
          .map(parseAccountSummary)
          .filter((account): account is IntegrationStatusAccountSummary => Boolean(account))
      : [],
    activeCredentials: getRecordNumber(value, "activeCredentials"),
    activeInstallations: getRecordNumber(value, "activeInstallations"),
    capabilities: parseCapabilities(value.capabilities),
    conflictedMappings: getRecordNumber(value, "conflictedMappings"),
    conflicts: Array.isArray(value.conflicts)
      ? value.conflicts
          .map(parseIntegrationConflictSummary)
          .filter((conflict): conflict is IntegrationConflictSummary => Boolean(conflict))
      : [],
    connection: getConnection(value.connection),
    disconnectedAccounts: Array.isArray(value.disconnectedAccounts)
      ? value.disconnectedAccounts
          .map(parseAccountSummary)
          .filter((account): account is IntegrationStatusAccountSummary => Boolean(account))
      : [],
    label: getRecordText(value, "label") ?? providerLabels[provider],
    lastJobStatus: getJobStatus(value.lastJobStatus),
    lastJobUpdatedAt: getRecordText(value, "lastJobUpdatedAt"),
    lastSyncedAt: getRecordText(value, "lastSyncedAt"),
    linkedIssueMappings: getRecordNumber(value, "linkedIssueMappings"),
    linkedMappings: getRecordNumber(value, "linkedMappings"),
    provider,
    queuedSyncJobs: getRecordNumber(value, "queuedSyncJobs"),
    recentJobs: Array.isArray(value.recentJobs)
      ? value.recentJobs
          .map(parseJobSummary)
          .filter((job): job is IntegrationStatusJobSummary => Boolean(job))
          .slice(0, 5)
      : [],
    runningSyncJobs: getRecordNumber(value, "runningSyncJobs"),
    setupConfigured: getRecordBoolean(value, "setupConfigured"),
    statusText: getRecordText(value, "statusText") ?? "Integration status is unavailable.",
    syncWorkerConfigured: getRecordBoolean(value, "syncWorkerConfigured"),
    totalInstallations: getRecordNumber(value, "totalInstallations")
  };
}

function parseIntegrationMetadata(value: unknown): WorkspaceIntegrationStatus["integrationMetadata"] {
  if (!isRecord(value)) return undefined;
  return {
    recovered: getRecordBoolean(value, "recovered"),
    schemaVersion: getRecordNumber(value, "schemaVersion"),
    status: getRecordText(value, "status") ?? "unknown"
  };
}

function parseAccountSummary(value: unknown): IntegrationStatusAccountSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = getRecordIdentifier(value, "id");
  const providerAccountName = getRecordText(value, "providerAccountName");
  const status = getInstallationStatus(value.status);
  if (!id || !providerAccountName || !status) return undefined;
  return {
    createdAt: getRecordText(value, "createdAt") ?? "",
    id,
    providerAccountName,
    status
  };
}

function parseInstallationList(value: unknown) {
  const installations = isRecord(value) && Array.isArray(value.installations) ? value.installations : [];
  return installations
    .map(parseInstallation)
    .filter((installation): installation is IntegrationInstallation => Boolean(installation));
}

function parseInstallationFromPayload(value: unknown) {
  return isRecord(value) ? parseInstallation(value.installation) : undefined;
}

function parseInstallation(value: unknown): IntegrationInstallation | undefined {
  if (!isRecord(value)) return undefined;
  const id = getRecordIdentifier(value, "id");
  const provider = getProvider(value.provider);
  const providerAccountId = getRecordIdentifier(value, "providerAccountId");
  const providerAccountName = getRecordText(value, "providerAccountName");
  const status = getInstallationStatus(value.status);
  const workspaceId = getRecordIdentifier(value, "workspaceId");

  if (!id || !provider || !providerAccountId || !providerAccountName || !status || !workspaceId) {
    return undefined;
  }

  return {
    createdAt: getRecordText(value, "createdAt") ?? "",
    id,
    permissions: parsePermissionList(value.permissions),
    provider,
    providerAccountId,
    providerAccountName,
    status,
    workspaceId
  };
}

function parseCredentialList(value: unknown) {
  const credentials = isRecord(value) && Array.isArray(value.credentials) ? value.credentials : [];
  return credentials
    .map(parseCredentialMetadata)
    .filter((credential): credential is IntegrationCredentialMetadata => Boolean(credential));
}

function parseCredentialFromPayload(value: unknown) {
  return isRecord(value) ? parseCredentialMetadata(value.credential) : undefined;
}

function parseCredentialMetadata(value: unknown): IntegrationCredentialMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const id = getRecordIdentifier(value, "id");
  const installationId = getRecordIdentifier(value, "installationId");
  const provider = getProvider(value.provider);
  const status = getCredentialStatus(value.status);
  const workspaceId = getRecordIdentifier(value, "workspaceId");

  if (!id || !installationId || !provider || !status || !workspaceId) return undefined;

  return {
    createdAt: getRecordText(value, "createdAt") ?? "",
    expiresAt: getRecordText(value, "expiresAt"),
    id,
    installationId,
    label: getRecordText(value, "label"),
    permissions: parsePermissionList(value.permissions),
    provider,
    providerScopes: parseTextList(value.providerScopes),
    revokedAt: getRecordText(value, "revokedAt"),
    secretTypes: parseSecretTypeList(value.secretTypes),
    status,
    tokenType: getRecordText(value, "tokenType"),
    updatedAt: getRecordText(value, "updatedAt") ?? "",
    workspaceId
  };
}

function parsePermissionList(value: unknown): IntegrationPermission[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(getPermission)
    .filter((permission): permission is IntegrationPermission => Boolean(permission));
}

function parseSecretTypeList(value: unknown): IntegrationCredentialSecretType[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(getCredentialSecretType)
    .filter((secretType): secretType is IntegrationCredentialSecretType => Boolean(secretType));
}

function parseTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = typeof item === "string" ? redactSensitiveText(item.trim()).slice(0, 120) : "";
    return text ? [text] : [];
  });
}

function parseJobSummary(value: unknown): IntegrationStatusJobSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = getRecordIdentifier(value, "id");
  const installationId = getRecordIdentifier(value, "installationId");
  const provider = getProvider(value.provider);
  const reason = getJobReason(value.reason);
  const status = getJobStatus(value.status);
  if (!id || !installationId || !provider || !reason || !status) return undefined;

  return {
    attempt: getRecordNumber(value, "attempt"),
    completedAt: getRecordText(value, "completedAt"),
    createdAt: getRecordText(value, "createdAt") ?? "",
    error: getRecordText(value, "error"),
    id,
    installationId,
    lastRunAt: getRecordText(value, "lastRunAt"),
    nextRunAt: getRecordText(value, "nextRunAt"),
    provider,
    reason,
    resultSummary: getRecordText(value, "resultSummary"),
    status,
    updatedAt: getRecordText(value, "updatedAt") ?? "",
    workspaceId: getRecordIdentifier(value, "workspaceId") ?? ""
  };
}

function parseCapabilities(value: unknown): IntegrationProviderStatus["capabilities"] {
  const record = isRecord(value) ? value : {};
  return {
    disconnect: getRecordBoolean(record, "disconnect"),
    import: getRecordBoolean(record, "import"),
    liveSync: getRecordBoolean(record, "liveSync"),
    manualSync: getRecordBoolean(record, "manualSync"),
    resolveConflicts: getRecordBoolean(record, "resolveConflicts"),
    setup: getRecordBoolean(record, "setup"),
    webhooks: getRecordBoolean(record, "webhooks"),
    writeBack: getRecordBoolean(record, "writeBack")
  };
}

function parseIntegrationConflictSummary(value: unknown): IntegrationConflictSummary | undefined {
  if (!isRecord(value) || !isRecord(value.external) || !isRecord(value.openRoad)) return undefined;

  const connectedAt = getRecordText(value, "connectedAt");
  const externalId = getRecordIdentifier(value.external, "id");
  const installationId = getRecordIdentifier(value, "installationId");
  const mappingId = getRecordIdentifier(value, "mappingId");
  const requestId = getRecordIdentifier(value.openRoad, "id");
  const requestTitle = getRecordText(value.openRoad, "title");

  if (!connectedAt || !externalId || !installationId || !mappingId || !requestId || !requestTitle) {
    return undefined;
  }

  return {
    connectedAt,
    external: {
      id: externalId,
      key: getRecordText(value.external, "key"),
      type: "issue",
      url: getRecordText(value.external, "url")
    },
    installationId,
    lastSyncedAt: getRecordText(value, "lastSyncedAt"),
    mappingId,
    openRoad: {
      id: requestId,
      status: getRecordText(value.openRoad, "status") ?? "Unknown",
      title: requestTitle,
      type: "request"
    },
    providerAccountName: getRecordText(value, "providerAccountName") ?? "Unknown account"
  };
}

function parseWriteBackExternal(value: unknown): ProviderWriteBackResult["external"] {
  return parseIssueExternal(value);
}

function parseConflictResolutionExternal(value: unknown): ProviderConflictResolutionResult["external"] {
  return parseIssueExternal(value);
}

function parseIssueExternal(value: unknown) {
  const external = isRecord(value) && isRecord(value.external) ? value.external : undefined;
  if (!external) return undefined;

  const id = getRecordIdentifier(external, "id");
  const type = getRecordText(external, "type");
  if (!id || type !== "issue") return undefined;

  return {
    id,
    key: getRecordText(external, "key"),
    type: "issue" as const,
    url: getRecordText(external, "url")
  };
}

function parseConflictResolutionValue(
  value: unknown,
  fallback: ProviderConflictResolution
): ProviderConflictResolution {
  const resolution = isRecord(value) ? value.resolution : undefined;
  return resolution === "accept-provider" ||
    resolution === "disconnect-mapping" ||
    resolution === "keep-openroad"
    ? resolution
    : fallback;
}

function mergeProviderFallbacks(
  workspaceId: string,
  providers: IntegrationProviderStatus[]
) {
  const fallback = createStandaloneIntegrationStatus(workspaceId).providers;
  return fallback.map(
    (fallbackProvider) =>
      providers.find((provider) => provider.provider === fallbackProvider.provider) ?? fallbackProvider
  );
}

function safeIntegrationErrorMessage(
  status: number,
  payload: unknown,
  context: "action" | "status" = "action"
) {
  if (status === 403) {
    return context === "status"
      ? "Integration status requires workspace access in this deployment."
      : "This integration action requires workspace owner access.";
  }

  if (status === 503) {
    return "Integration metadata is not configured on this server.";
  }

  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return redactSensitiveText(payload.error.message).slice(0, 180);
  }

  return "Integration metadata is unavailable in this browser session.";
}

function getProvider(value: unknown): IntegrationProvider | undefined {
  return value === "github" || value === "jira" || value === "linear" ? value : undefined;
}

function getConnection(value: unknown): IntegrationConnectionState {
  return value === "attention" || value === "connected" || value === "ready" || value === "optional"
    ? value
    : "optional";
}

function getInstallationStatus(value: unknown): IntegrationStatusAccountSummary["status"] | undefined {
  return value === "active" || value === "disconnected" || value === "suspended" ? value : undefined;
}

function getCredentialStatus(value: unknown): IntegrationCredentialMetadata["status"] | undefined {
  return value === "active" || value === "revoked" ? value : undefined;
}

function getPermission(value: unknown): IntegrationPermission | undefined {
  return typeof value === "string" &&
    integrationPermissionValues.includes(value as IntegrationPermission)
    ? (value as IntegrationPermission)
    : undefined;
}

function getCredentialSecretType(value: unknown): IntegrationCredentialSecretType | undefined {
  return typeof value === "string" &&
    credentialSecretTypeValues.includes(value as IntegrationCredentialSecretType)
    ? (value as IntegrationCredentialSecretType)
    : undefined;
}

function getJobStatus(value: unknown): IntegrationStatusJobSummary["status"] | undefined {
  return value === "failed" || value === "queued" || value === "running" || value === "succeeded"
    ? value
    : undefined;
}

function getJobReason(value: unknown): IntegrationStatusJobSummary["reason"] | undefined {
  return value === "manual" || value === "retry" || value === "scheduled" || value === "webhook"
    ? value
    : undefined;
}

function getRecordText(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "string" && next.trim()
    ? redactSensitiveText(next.trim()).slice(0, 500)
    : undefined;
}

function getRecordIdentifier(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "string" && next.trim() ? next.trim().slice(0, 160) : undefined;
}

function getRecordNumber(value: unknown, key: string) {
  if (!isRecord(value)) return 0;
  const next = value[key];
  return typeof next === "number" && Number.isFinite(next) && next > 0 ? next : 0;
}

function getRecordBoolean(value: unknown, key: string) {
  if (!isRecord(value)) return false;
  return value[key] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:access_token|refresh_token|token|jwt|secret|client_secret|authorization)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .replace(/\b[\w.-]*(?:token|secret|password|credential|authorization)[\w.-]*\b/gi, "[redacted]")
    .slice(0, 500);
}
