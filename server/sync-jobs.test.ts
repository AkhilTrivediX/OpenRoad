// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createGitHubInstallation } from "../src/integrations/github";
import {
  claimDueIntegrationSyncJobs,
  completeIntegrationSyncJob,
  enqueueIntegrationSyncJob,
  failIntegrationSyncJob,
  mergeIntegrationSyncJobUpdates,
  trimIntegrationSyncJobs
} from "./sync-jobs";
import { createInitialIntegrationState, type IntegrationState } from "./integrations";

describe("OpenRoad integration sync jobs", () => {
  it("enqueues active installation jobs and dedupes active work", () => {
    const state = stateWithInstallation();
    const first = enqueueIntegrationSyncJob(
      state,
      {
        installationId: "github-install",
        provider: "github",
        reason: "manual",
        workspaceId: "acme"
      },
      "2026-07-04T00:00:00.000Z"
    );
    const duplicate = enqueueIntegrationSyncJob(
      first.state,
      {
        installationId: "github-install",
        provider: "github",
        reason: "manual",
        workspaceId: "acme"
      },
      "2026-07-04T00:01:00.000Z"
    );

    expect(first.enqueued).toBe(true);
    expect(first.job).toMatchObject({
      attempt: 0,
      installationId: "github-install",
      provider: "github",
      reason: "manual",
      status: "queued",
      workspaceId: "acme"
    });
    expect(duplicate.enqueued).toBe(false);
    expect(duplicate.job.id).toBe(first.job.id);
    expect(duplicate.state.syncJobs).toHaveLength(1);
  });

  it("rejects missing, cross-provider, and disconnected installations", () => {
    const state = stateWithInstallation({
      status: "disconnected"
    });

    expect(() =>
      enqueueIntegrationSyncJob(
        state,
        {
          installationId: "github-install",
          provider: "github",
          reason: "manual",
          workspaceId: "acme"
        },
        "2026-07-04T00:00:00.000Z"
      )
    ).toThrow("disconnected");
    expect(() =>
      enqueueIntegrationSyncJob(
        state,
        {
          installationId: "github-install",
          provider: "linear",
          reason: "manual",
          workspaceId: "acme"
        },
        "2026-07-04T00:00:00.000Z"
      )
    ).toThrow("not found");
  });

  it("claims due jobs and completes successful work", () => {
    const queued = enqueueJob();
    const claimed = claimDueIntegrationSyncJobs(queued.state, {
      limit: 1,
      now: "2026-07-04T00:01:00.000Z"
    });
    const completed = completeIntegrationSyncJob(claimed.state, {
      jobId: claimed.jobs[0].id,
      now: "2026-07-04T00:02:00.000Z",
      resultSummary: "Synced one mapped issue."
    });

    expect(claimed.jobs).toHaveLength(1);
    expect(claimed.jobs[0]).toMatchObject({
      attempt: 1,
      status: "running"
    });
    expect(completed.syncJobs[0]).toMatchObject({
      completedAt: "2026-07-04T00:02:00.000Z",
      resultSummary: "Synced one mapped issue.",
      status: "succeeded"
    });
    expect(completed.syncJobs[0].leaseExpiresAt).toBeUndefined();
  });

  it("claims queued jobs in FIFO order and reclaims stale running jobs after their lease", () => {
    const first = enqueueJob();
    const second = enqueueIntegrationSyncJob(
      first.state,
      {
        installationId: "github-install",
        provider: "github",
        reason: "scheduled",
        workspaceId: "acme"
      },
      "2026-07-04T00:00:10.000Z"
    );
    const firstClaim = claimDueIntegrationSyncJobs(second.state, {
      leaseSeconds: 60,
      limit: 1,
      now: "2026-07-04T00:01:00.000Z"
    });
    const stillLeased = claimDueIntegrationSyncJobs(firstClaim.state, {
      leaseSeconds: 60,
      limit: 2,
      now: "2026-07-04T00:01:30.000Z"
    });
    const reclaimed = claimDueIntegrationSyncJobs(firstClaim.state, {
      leaseSeconds: 60,
      limit: 2,
      now: "2026-07-04T00:02:01.000Z"
    });

    expect(firstClaim.jobs).toHaveLength(1);
    expect(firstClaim.jobs[0]).toMatchObject({
      attempt: 1,
      id: first.job.id,
      leaseExpiresAt: "2026-07-04T00:02:00.000Z",
      status: "running"
    });
    expect(stillLeased.jobs).toHaveLength(1);
    expect(stillLeased.jobs[0].id).toBe(second.job.id);
    expect(reclaimed.jobs.map((job) => job.id)).toEqual([first.job.id, second.job.id]);
    expect(reclaimed.jobs.find((job) => job.id === first.job.id)).toMatchObject({
      attempt: 2,
      leaseExpiresAt: "2026-07-04T00:03:01.000Z",
      status: "running"
    });
  });

  it("keeps retryable failures queued with backoff and marks fatal failures failed", () => {
    const queued = enqueueJob();
    const claimed = claimDueIntegrationSyncJobs(queued.state, {
      now: "2026-07-04T00:01:00.000Z"
    });
    const retryable = failIntegrationSyncJob(claimed.state, {
      error: "Provider rate limited request.",
      jobId: claimed.jobs[0].id,
      now: "2026-07-04T00:02:00.000Z",
      retryAfterSeconds: 90,
      retryable: true
    });
    const reclaimed = claimDueIntegrationSyncJobs(retryable, {
      now: "2026-07-04T00:03:30.000Z"
    });
    const fatal = failIntegrationSyncJob(reclaimed.state, {
      error: "Provider installation missing permission.",
      jobId: reclaimed.jobs[0].id,
      now: "2026-07-04T00:04:00.000Z",
      retryable: false
    });

    expect(retryable.syncJobs[0]).toMatchObject({
      attempt: 1,
      reason: "retry",
      status: "queued"
    });
    expect(retryable.syncJobs[0].nextRunAt).toBe("2026-07-04T00:03:30.000Z");
    expect(reclaimed.jobs[0]).toMatchObject({ attempt: 2, status: "running" });
    expect(fatal.syncJobs[0]).toMatchObject({
      completedAt: "2026-07-04T00:04:00.000Z",
      status: "failed"
    });
    expect(fatal.syncJobs[0].leaseExpiresAt).toBeUndefined();
  });

  it("merges completed job updates without dropping unrelated integration metadata", () => {
    const queued = enqueueJob();
    const claimed = claimDueIntegrationSyncJobs(queued.state, {
      now: "2026-07-04T00:01:00.000Z"
    });
    const completed = completeIntegrationSyncJob(claimed.state, {
      jobId: claimed.jobs[0].id,
      now: "2026-07-04T00:02:00.000Z"
    });
    const unrelated = enqueueIntegrationSyncJob(
      claimed.state,
      {
        installationId: "github-install",
        provider: "github",
        reason: "scheduled",
        workspaceId: "acme"
      },
      "2026-07-04T00:01:30.000Z"
    );
    const merged = mergeIntegrationSyncJobUpdates(unrelated.state, [
      completed.syncJobs.find((job) => job.id === claimed.jobs[0].id)!
    ]);

    expect(merged.syncJobs).toHaveLength(2);
    expect(merged.syncJobs.find((job) => job.id === claimed.jobs[0].id)).toMatchObject({
      status: "succeeded"
    });
    expect(merged.syncJobs.find((job) => job.id === unrelated.job.id)).toMatchObject({
      status: "queued"
    });
  });

  it("trims historical jobs while preserving queued work", () => {
    const queued = enqueueJob().job;
    const history = Array.from({ length: 1005 }, (_, index) => ({
      ...queued,
      completedAt: new Date(Date.parse("2026-07-04T00:02:00.000Z") + index * 1000).toISOString(),
      id: `history-${index}`,
      status: "succeeded" as const
    }));
    const trimmed = trimIntegrationSyncJobs([queued, ...history]);

    expect(trimmed).toHaveLength(1000);
    expect(trimmed[0].id).toBe(queued.id);
    expect(trimmed.some((job) => job.id === "history-0")).toBe(false);
    expect(trimmed.some((job) => job.id === "history-1004")).toBe(true);
  });
});

function enqueueJob() {
  return enqueueIntegrationSyncJob(
    stateWithInstallation(),
    {
      installationId: "github-install",
      provider: "github",
      reason: "manual",
      workspaceId: "acme"
    },
    "2026-07-04T00:00:00.000Z"
  );
}

function stateWithInstallation(
  overrides: Partial<ReturnType<typeof createGitHubInstallation>> = {}
): IntegrationState {
  const installation = createGitHubInstallation({
    accountId: "AkhilTrivediX",
    accountName: "AkhilTrivediX",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "github-install",
    workspaceId: "acme"
  });

  return {
    ...createInitialIntegrationState(),
    installations: [{ ...installation, ...overrides }]
  };
}
