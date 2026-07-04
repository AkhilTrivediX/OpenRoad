import { describe, expect, it, vi } from "vitest";

import {
  loadWorkspaceIntegrationStatus,
  runGitHubManualSync,
  runProviderManualSync
} from "./openroadIntegrations";

describe("OpenRoad integration status client", () => {
  it("normalizes provider status and redacts token-shaped text", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        integrationMetadata: {
          recovered: false,
          schemaVersion: 3,
          status: "ready"
        },
        providers: [
          {
            accounts: [
              {
                createdAt: "2026-07-04T00:00:00Z",
                id: "github-install",
                providerAccountName: "AkhilTrivediX",
                status: "active"
              }
            ],
            activeInstallations: 1,
            capabilities: {
              disconnect: true,
              import: true,
              liveSync: true,
              manualSync: true,
              setup: true,
              webhooks: true
            },
            connection: "connected",
            encryptedSecret: "server-must-not-send-this",
            label: "GitHub",
            linkedIssueMappings: 2,
            linkedMappings: 2,
            provider: "github",
            queuedSyncJobs: 1,
            recentJobs: [
              {
                attempt: 1,
                createdAt: "2026-07-04T00:00:00Z",
                error: "Bearer raw-token-should-not-render",
                id: "sync-job-1",
                installationId: "github-install",
                provider: "github",
                reason: "manual",
                resultSummary: "access_token=raw-secret",
                status: "queued",
                updatedAt: "2026-07-04T00:01:00Z",
                workspaceId: "acme"
              }
            ],
            runningSyncJobs: 0,
            setupConfigured: true,
            statusText: "Connected with token=raw-secret",
            syncWorkerConfigured: true,
            totalInstallations: 1
          }
        ],
        status: "ready",
        workspaceId: "acme"
      })
    );

    const status = await loadWorkspaceIntegrationStatus("acme", fetchImpl as typeof fetch);
    const serialized = JSON.stringify(status);

    expect(status.status).toBe("ready");
    expect(status.providers[0]).toMatchObject({
      activeInstallations: 1,
      connection: "connected",
      linkedIssueMappings: 2,
      provider: "github"
    });
    expect(serialized).not.toContain("raw-token-should-not-render");
    expect(serialized).not.toContain("raw-secret");
    expect(serialized).not.toContain("encryptedSecret");
  });

  it("returns a forbidden fallback without throwing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "forbidden",
            message: "Actor does not have permission with access_token=raw-secret."
          }
        },
        403
      )
    );

    const status = await loadWorkspaceIntegrationStatus("acme", fetchImpl as typeof fetch);

    expect(status.status).toBe("forbidden");
    expect(status.message).toBe("Integration status requires workspace access in this deployment.");
    expect(status.providers).toHaveLength(3);
  });

  it("falls back when the status endpoint is unavailable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const status = await loadWorkspaceIntegrationStatus("acme", fetchImpl as typeof fetch);

    expect(status.status).toBe("unavailable");
    expect(status.message).toBe("Integration metadata is unavailable in this browser session.");
  });

  it("queues and runs GitHub manual sync", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "queued" }, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          processed: [{ id: "sync-job-1", kind: "success", status: "succeeded" }],
          status: "processed"
        })
      );

    const result = await runGitHubManualSync(
      "acme",
      "github-install",
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toEqual({
      jobStatus: "succeeded",
      message: "GitHub linked issue sync completed.",
      status: "succeeded"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/workspaces/acme/integrations/github/sync/jobs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/openroad/integrations/sync/run",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("queues and runs Linear manual sync", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "queued" }, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          processed: [{ id: "sync-job-1", kind: "success", status: "succeeded" }],
          status: "processed"
        })
      );

    const result = await runProviderManualSync(
      "linear",
      "acme",
      "linear-install",
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toEqual({
      jobStatus: "succeeded",
      message: "Linear linked issue sync completed.",
      status: "succeeded"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/workspaces/acme/integrations/linear/sync/jobs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/openroad/integrations/sync/run",
      expect.objectContaining({
        body: JSON.stringify({ limit: 5, provider: "linear", workspaceId: "acme" }),
        method: "POST"
      })
    );
  });

  it("keeps a queued result when the private runner is unavailable", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "deduped" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "not_configured",
              message: "OpenRoad integration sync worker is not configured."
            }
          },
          503
        )
      );

    const result = await runGitHubManualSync(
      "acme",
      "github-install",
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toEqual({
      message: "A GitHub sync job is already queued. The private runner is unavailable in this session.",
      status: "deduped"
    });
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
