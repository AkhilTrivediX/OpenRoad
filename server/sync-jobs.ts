import { randomUUID } from "node:crypto";

import type {
  ExternalObjectMapping,
  IntegrationInstallation,
  IntegrationProvider
} from "../src/integrations/adapter.js";
import {
  parseIntegrationState,
  sanitizeIntegrationSyncJob,
  type IntegrationState,
  type IntegrationSyncJob,
  type IntegrationSyncJobReason
} from "./integrations.js";

export type EnqueueIntegrationSyncJobInput = {
  installationId: string;
  mappingId?: string;
  provider: IntegrationProvider;
  reason: IntegrationSyncJobReason;
  runAfter?: string;
  workspaceId: string;
};

export type EnqueueIntegrationSyncJobResult = {
  enqueued: boolean;
  job: IntegrationSyncJob;
  state: IntegrationState;
};

export type ClaimIntegrationSyncJobsOptions = {
  leaseSeconds?: number;
  limit?: number;
  now: string;
  provider?: IntegrationProvider;
  workspaceId?: string;
};

export type ClaimedIntegrationSyncJobs = {
  jobs: IntegrationSyncJob[];
  state: IntegrationState;
};

export type CompleteIntegrationSyncJobOptions = {
  jobId: string;
  now: string;
  resultSummary?: string;
};

export type FailIntegrationSyncJobOptions = {
  error?: string;
  jobId: string;
  now: string;
  retryAfterSeconds?: number;
  retryable: boolean;
};

export type IntegrationSyncWorkerResult = {
  error?: string;
  kind: "success" | "retryable-error" | "fatal-error";
  retryAfterSeconds?: number;
  summary?: string;
};

export type IntegrationSyncWorker = {
  process(job: IntegrationSyncJob): Promise<IntegrationSyncWorkerResult>;
};

const defaultBatchLimit = 10;
const maxBatchLimit = 100;
const defaultLeaseSeconds = 15 * 60;
const maxAttempts = 5;
const historyLimit = 1000;
const maxActiveJobs = 1000;

export function enqueueIntegrationSyncJob(
  state: IntegrationState,
  input: EnqueueIntegrationSyncJobInput,
  now: string
): EnqueueIntegrationSyncJobResult {
  const installation = findActiveInstallation(state.installations, input);
  const mapping = input.mappingId
    ? findMappingForInstallation(state.mappings, installation, input.mappingId)
    : undefined;
  const dedupeKey = createIntegrationSyncJobDedupeKey({
    installationId: installation.id,
    mappingId: mapping?.id,
    provider: input.provider,
    reason: input.reason,
    workspaceId: input.workspaceId
  });
  const existing = state.syncJobs.find(
    (job) =>
      job.dedupeKey === dedupeKey &&
      (job.status === "queued" || job.status === "running")
  );

  if (existing) {
    return {
      enqueued: false,
      job: sanitizeIntegrationSyncJob(existing),
      state
    };
  }

  if (countActiveJobs(state.syncJobs) >= maxActiveJobs) {
    throw new IntegrationSyncJobError(
      "queue_full",
      "Integration sync queue is full. Wait for jobs to finish before enqueueing more work."
    );
  }

  const job = sanitizeIntegrationSyncJob({
    attempt: 0,
    createdAt: now,
    dedupeKey,
    id: `sync-job-${input.provider}-${normalizeIdentifier(input.workspaceId)}-${randomUUID()}`,
    installationId: installation.id,
    ...(mapping ? { mappingId: mapping.id } : {}),
    ...(input.runAfter ? { nextRunAt: input.runAfter } : {}),
    provider: input.provider,
    reason: input.reason,
    status: "queued",
    updatedAt: now,
    workspaceId: input.workspaceId
  });

  return {
    enqueued: true,
    job,
    state: parseIntegrationState({
      ...state,
      syncJobs: trimIntegrationSyncJobs([...state.syncJobs, job])
    })
  };
}

export function claimDueIntegrationSyncJobs(
  state: IntegrationState,
  options: ClaimIntegrationSyncJobsOptions
): ClaimedIntegrationSyncJobs {
  const limit = normalizeBatchLimit(options.limit);
  const nowMs = Date.parse(options.now);
  const leaseExpiresAt = new Date(
    nowMs + normalizeLeaseSeconds(options.leaseSeconds) * 1000
  ).toISOString();
  const dueJobs = state.syncJobs
    .filter((job) => isJobDue(job, nowMs, options))
    .sort(compareJobsForClaim)
    .slice(0, limit);

  if (dueJobs.length === 0) {
    return { jobs: [], state };
  }

  const dueJobIds = new Set(dueJobs.map((job) => job.id));
  const syncJobs = state.syncJobs.map((job) => {
    if (!dueJobIds.has(job.id)) return job;

    return sanitizeIntegrationSyncJob({
      ...job,
      attempt: job.attempt + 1,
      claimedAt: options.now,
      lastRunAt: options.now,
      leaseExpiresAt,
      status: "running",
      updatedAt: options.now
    });
  });
  const nextState = parseIntegrationState({ ...state, syncJobs });

  return {
    jobs: nextState.syncJobs.filter((job) => dueJobIds.has(job.id)),
    state: nextState
  };
}

export function completeIntegrationSyncJob(
  state: IntegrationState,
  options: CompleteIntegrationSyncJobOptions
) {
  return replaceSyncJob(state, options.jobId, (job) =>
    sanitizeIntegrationSyncJob({
      ...job,
      completedAt: options.now,
      error: undefined,
      leaseExpiresAt: undefined,
      resultSummary: boundText(options.resultSummary ?? "Sync job completed."),
      status: "succeeded",
      updatedAt: options.now
    })
  );
}

export function failIntegrationSyncJob(
  state: IntegrationState,
  options: FailIntegrationSyncJobOptions
) {
  return replaceSyncJob(state, options.jobId, (job) => {
    const error = boundText(options.error ?? "Sync job failed.");
    const shouldRetry = options.retryable && job.attempt < maxAttempts;

    if (!shouldRetry) {
      return sanitizeIntegrationSyncJob({
        ...job,
        completedAt: options.now,
        error,
        leaseExpiresAt: undefined,
        status: "failed",
        updatedAt: options.now
      });
    }

    return sanitizeIntegrationSyncJob({
      ...job,
      error,
      leaseExpiresAt: undefined,
      nextRunAt: new Date(
        Date.parse(options.now) + normalizeRetryAfterSeconds(options.retryAfterSeconds, job.attempt) * 1000
      ).toISOString(),
      reason: "retry",
      status: "queued",
      updatedAt: options.now
    });
  });
}

export function trimIntegrationSyncJobs(jobs: IntegrationSyncJob[]) {
  const activeJobs = jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .sort(compareActiveJobs);
  const historyJobs = jobs
    .filter((job) => job.status !== "queued" && job.status !== "running")
    .sort(compareHistoryJobs);
  const retainedActiveJobs = activeJobs.slice(0, historyLimit);
  const retainedHistoryLimit = Math.max(0, historyLimit - retainedActiveJobs.length);
  return [...retainedActiveJobs, ...historyJobs.slice(0, retainedHistoryLimit)];
}

export function mergeIntegrationSyncJobUpdates(
  state: IntegrationState,
  updatedJobs: IntegrationSyncJob[]
) {
  const updates = new Map(updatedJobs.map((job) => [job.id, sanitizeIntegrationSyncJob(job)]));
  const seen = new Set<string>();
  const syncJobs = state.syncJobs.map((job) => {
    const update = updates.get(job.id);
    if (!update) return job;
    seen.add(job.id);
    return update;
  });
  const missingUpdates = [...updates.values()].filter((job) => !seen.has(job.id));

  return parseIntegrationState({
    ...state,
    syncJobs: trimIntegrationSyncJobs([...syncJobs, ...missingUpdates])
  });
}

export function createIntegrationSyncJobDedupeKey(
  input: Pick<
    EnqueueIntegrationSyncJobInput,
    "installationId" | "mappingId" | "provider" | "reason" | "workspaceId"
  >
) {
  return [
    input.provider,
    encodeURIComponent(input.workspaceId),
    encodeURIComponent(input.installationId),
    input.reason,
    input.mappingId ? encodeURIComponent(input.mappingId) : "installation"
  ].join(":");
}

function findActiveInstallation(
  installations: IntegrationInstallation[],
  input: EnqueueIntegrationSyncJobInput
) {
  const installation = installations.find(
    (item) =>
      item.id === input.installationId &&
      item.provider === input.provider &&
      item.workspaceId === input.workspaceId
  );

  if (!installation) {
    throw new IntegrationSyncJobError("not_found", "Integration installation was not found.");
  }

  if (installation.status !== "active") {
    throw new IntegrationSyncJobError(
      "invalid_state",
      "Integration installation is disconnected or suspended."
    );
  }

  return installation;
}

function findMappingForInstallation(
  mappings: ExternalObjectMapping[],
  installation: IntegrationInstallation,
  mappingId: string
) {
  const mapping = mappings.find(
    (item) =>
      item.id === mappingId &&
      item.installationId === installation.id &&
      item.external.provider === installation.provider &&
      item.openRoad.workspaceId === installation.workspaceId
  );

  if (!mapping) {
    throw new IntegrationSyncJobError("not_found", "Integration mapping was not found.");
  }

  if (mapping.status !== "active") {
    throw new IntegrationSyncJobError("invalid_state", "Integration mapping is disconnected.");
  }

  return mapping;
}

function replaceSyncJob(
  state: IntegrationState,
  jobId: string,
  update: (job: IntegrationSyncJob) => IntegrationSyncJob
) {
  const existing = state.syncJobs.find((job) => job.id === jobId);
  if (!existing) {
    throw new IntegrationSyncJobError("not_found", "Integration sync job was not found.");
  }

  return parseIntegrationState({
    ...state,
    syncJobs: trimIntegrationSyncJobs(
      state.syncJobs.map((job) => (job.id === jobId ? update(job) : job))
    )
  });
}

function isJobDue(
  job: IntegrationSyncJob,
  nowMs: number,
  options: ClaimIntegrationSyncJobsOptions
) {
  if (options.provider && job.provider !== options.provider) return false;
  if (options.workspaceId && job.workspaceId !== options.workspaceId) return false;

  if (job.status === "running") {
    return getRunningLeaseExpiryMs(job) <= nowMs;
  }

  if (job.status !== "queued") return false;
  if (!job.nextRunAt) return true;
  const nextRunAtMs = Date.parse(job.nextRunAt);
  return Number.isFinite(nextRunAtMs) && nextRunAtMs <= nowMs;
}

function normalizeBatchLimit(limit: number | undefined) {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return defaultBatchLimit;
  return Math.min(maxBatchLimit, Math.floor(limit));
}

function normalizeRetryAfterSeconds(value: number | undefined, attempt: number) {
  if (value && Number.isFinite(value) && value > 0) return Math.min(86_400, Math.ceil(value));
  return Math.min(86_400, Math.max(30, 30 * 2 ** Math.max(0, attempt - 1)));
}

function normalizeLeaseSeconds(value: number | undefined) {
  if (value && Number.isFinite(value) && value > 0) return Math.min(86_400, Math.ceil(value));
  return defaultLeaseSeconds;
}

function compareJobsForClaim(first: IntegrationSyncJob, second: IntegrationSyncJob) {
  return compareNumbers(getClaimSortMs(first), getClaimSortMs(second)) || compareStableJobOrder(first, second);
}

function compareActiveJobs(first: IntegrationSyncJob, second: IntegrationSyncJob) {
  return compareNumbers(getClaimSortMs(first), getClaimSortMs(second)) || compareStableJobOrder(first, second);
}

function compareHistoryJobs(first: IntegrationSyncJob, second: IntegrationSyncJob) {
  return (
    compareNumbers(getHistorySortMs(second), getHistorySortMs(first)) ||
    compareStableJobOrder(first, second)
  );
}

function compareStableJobOrder(first: IntegrationSyncJob, second: IntegrationSyncJob) {
  return compareNumbers(getTimestampMs(first.createdAt), getTimestampMs(second.createdAt)) ||
    first.id.localeCompare(second.id);
}

function compareNumbers(first: number, second: number) {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

function getClaimSortMs(job: IntegrationSyncJob) {
  if (job.status === "running") return getTimestampMs(job.createdAt);
  return getTimestampMs(job.nextRunAt ?? job.createdAt);
}

function getHistorySortMs(job: IntegrationSyncJob) {
  return getTimestampMs(job.completedAt ?? job.updatedAt ?? job.createdAt);
}

function getRunningLeaseExpiryMs(job: IntegrationSyncJob) {
  const explicitLeaseMs = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : Number.NaN;
  if (Number.isFinite(explicitLeaseMs)) return explicitLeaseMs;

  const claimedAtMs = job.claimedAt ? Date.parse(job.claimedAt) : Number.NaN;
  if (Number.isFinite(claimedAtMs)) return claimedAtMs + defaultLeaseSeconds * 1000;

  return 0;
}

function getTimestampMs(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:@-]+/g, "-").slice(0, 120);
}

function boundText(value: string) {
  return value.trim().slice(0, 500) || "Sync job updated.";
}

export class IntegrationSyncJobError extends Error {
  code: "invalid_state" | "not_found" | "queue_full";

  constructor(code: IntegrationSyncJobError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function countActiveJobs(jobs: IntegrationSyncJob[]) {
  return jobs.filter((job) => job.status === "queued" || job.status === "running").length;
}
