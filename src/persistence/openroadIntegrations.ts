import type { IntegrationProvider } from "../integrations/adapter";

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

export type IntegrationProviderStatus = {
  accounts: IntegrationStatusAccountSummary[];
  activeInstallations: number;
  capabilities: {
    disconnect: boolean;
    import: boolean;
    liveSync: boolean;
    manualSync: boolean;
    setup: boolean;
    webhooks: boolean;
  };
  connection: IntegrationConnectionState;
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

export type GitHubManualSyncResult = {
  jobStatus?: IntegrationStatusJobSummary["status"];
  message: string;
  status: "deduped" | "failed" | "forbidden" | "queued" | "succeeded" | "unavailable";
};

const providerLabels: Record<IntegrationProvider, string> = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear"
};

export function createStandaloneIntegrationStatus(
  workspaceId: string,
  message = "Standalone mode is ready. Integrations are optional accelerators."
): WorkspaceIntegrationStatus {
  return {
    message,
    providers: (Object.keys(providerLabels) as IntegrationProvider[]).map((provider) => ({
      accounts: [],
      activeInstallations: 0,
      capabilities: {
        disconnect: false,
        import: false,
        liveSync: false,
        manualSync: false,
        setup: false,
        webhooks: false
      },
      connection: "optional",
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
      { headers: { Accept: "application/json" } }
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
      safeIntegrationErrorMessage(response.status, payload)
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

export async function runGitHubManualSync(
  workspaceId: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<GitHubManualSyncResult> {
  const enqueue = await postJsonSafely(
    `/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/integrations/github/sync/jobs`,
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
    { limit: 5, provider: "github", workspaceId },
    fetchImpl
  );

  if (!runner.ok) {
    return {
      message:
        enqueueStatus === "deduped"
          ? "A GitHub sync job is already queued. The private runner is unavailable in this session."
          : "GitHub sync was queued. The private runner is unavailable in this session.",
      status: enqueueStatus === "deduped" ? "deduped" : "queued"
    };
  }

  const processed = Array.isArray((runner.payload as { processed?: unknown }).processed)
    ? ((runner.payload as { processed: unknown[] }).processed[0] as Record<string, unknown> | undefined)
    : undefined;
  const processedStatus = getRecordText(processed, "status") as GitHubManualSyncResult["jobStatus"];

  if (processedStatus === "succeeded") {
    return {
      jobStatus: processedStatus,
      message: "GitHub linked issue sync completed.",
      status: "succeeded"
    };
  }

  if (processedStatus === "queued" || processedStatus === "running") {
    return {
      jobStatus: processedStatus,
      message: "GitHub sync is queued for retry.",
      status: "queued"
    };
  }

  if (processedStatus === "failed") {
    return {
      jobStatus: processedStatus,
      message: "GitHub sync ran and needs attention.",
      status: "failed"
    };
  }

  return {
    message:
      enqueueStatus === "deduped"
        ? "A GitHub sync job is already queued."
        : "GitHub sync was queued.",
    status: enqueueStatus === "deduped" ? "deduped" : "queued"
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
    workspaceId: getRecordText(value, "workspaceId") ?? workspaceId
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
    activeInstallations: getRecordNumber(value, "activeInstallations"),
    capabilities: parseCapabilities(value.capabilities),
    connection: getConnection(value.connection),
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
  const id = getRecordText(value, "id");
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

function parseJobSummary(value: unknown): IntegrationStatusJobSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = getRecordText(value, "id");
  const installationId = getRecordText(value, "installationId");
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
    workspaceId: getRecordText(value, "workspaceId") ?? ""
  };
}

function parseCapabilities(value: unknown): IntegrationProviderStatus["capabilities"] {
  const record = isRecord(value) ? value : {};
  return {
    disconnect: getRecordBoolean(record, "disconnect"),
    import: getRecordBoolean(record, "import"),
    liveSync: getRecordBoolean(record, "liveSync"),
    manualSync: getRecordBoolean(record, "manualSync"),
    setup: getRecordBoolean(record, "setup"),
    webhooks: getRecordBoolean(record, "webhooks")
  };
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

function safeIntegrationErrorMessage(status: number, payload: unknown) {
  if (status === 403) {
    return "Integration status requires workspace access in this deployment.";
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
