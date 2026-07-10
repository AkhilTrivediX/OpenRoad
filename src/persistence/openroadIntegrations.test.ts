import { describe, expect, it, vi } from "vitest";

import {
  createProviderInstallation,
  disconnectProviderInstallation,
  listProviderCredentials,
  listProviderInstallations,
  loadWorkspaceIntegrationStatus,
  registerProviderWebhook,
  revokeProviderCredential,
  runGitHubManualSync,
  runProviderManualSync,
  resolveProviderConflict,
  storeProviderCredential,
  verifyGitHubAppInstallation,
  writeBackProviderIssue
} from "./openroadIntegrations";

describe("OpenRoad integration status client", () => {
  it("normalizes provider status and redacts token-shaped text", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        integrationMetadata: {
          recovered: false,
          schemaVersion: 4,
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
              registerWebhook: true,
              resolveConflicts: true,
              setup: true,
              webhooks: true,
              writeBack: true
            },
            connection: "connected",
            conflictedMappings: 1,
            conflicts: [
              {
                connectedAt: "2026-07-04T00:00:00Z",
                external: {
                  id: "I_kwDOGH123",
                  key: "AkhilTrivediX/OpenRoad#42",
                  type: "issue",
                  url: "https://github.com/AkhilTrivediX/OpenRoad/issues/42?token=raw-secret"
                },
                installationId: "github-install",
                mappingId: "mapping-github",
                openRoad: {
                  id: "request-1",
                  status: "Needs decision",
                  title: "Conflict request",
                  type: "request"
                },
                providerAccountName: "AkhilTrivediX"
              }
            ],
            disconnectedAccounts: [
              {
                createdAt: "2026-07-03T00:00:00Z",
                id: "old-install",
                providerAccountName: "Old token-secret",
                status: "disconnected"
              }
            ],
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
            totalInstallations: 1,
            webhookRegistrations: [
              {
                attempt: 1,
                createdAt: "2026-07-04T00:00:00Z",
                events: ["issues", "pull_request"],
                externalId: "github-app-hook",
                id: "webhook-registration-1",
                installationId: "github-install",
                lastAttemptAt: "2026-07-04T00:00:00Z",
                lastError: "Bearer raw-token-should-not-render",
                provider: "github",
                providerAccountName: "GitHub token-secret",
                status: "active",
                targetUrl:
                  "https://openroad.example.com/api/openroad/integrations/github/webhook?access_token=raw-secret",
                updatedAt: "2026-07-04T00:00:00Z",
                workspaceId: "acme"
              }
            ]
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
      provider: "github",
      capabilities: {
        registerWebhook: true,
        resolveConflicts: true,
        writeBack: true
      },
      conflictedMappings: 1
    });
    expect(status.providers[0]?.conflicts[0]).toMatchObject({
      mappingId: "mapping-github",
      openRoad: { title: "Conflict request" }
    });
    expect(status.providers[0]?.disconnectedAccounts[0]?.providerAccountName).toBe("Old [redacted]");
    expect(status.providers[0]?.webhookRegistrations[0]).toMatchObject({
      id: "webhook-registration-1",
      providerAccountName: "GitHub [redacted]",
      status: "active"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme/integrations/status",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(serialized).not.toContain("raw-token-should-not-render");
    expect(serialized).not.toContain("raw-secret");
    expect(serialized).not.toContain("encryptedSecret");
  });

  it("registers provider webhook deliveries with a minimal request body", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: "Registered GitHub App webhook delivery for this OpenRoad deployment.",
        provider: "github",
        registration: {
          attempt: 1,
          createdAt: "2026-07-04T00:00:00Z",
          events: ["issues"],
          id: "webhook-registration-1",
          installationId: "github-install",
          provider: "github",
          providerAccountName: "AkhilTrivediX",
          status: "active",
          targetUrl:
            "https://openroad.example.com/api/openroad/integrations/github/webhook?access_token=raw-secret",
          updatedAt: "2026-07-04T00:00:00Z",
          workspaceId: "acme"
        },
        status: "active"
      })
    );

    const result = await registerProviderWebhook(
      "github",
      "acme",
      "github-install",
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toMatchObject({
      provider: "github",
      registration: {
        installationId: "github-install",
        status: "active"
      },
      status: "active"
    });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme/integrations/github/webhooks/register",
      expect.objectContaining({
        body: JSON.stringify({ installationId: "github-install" }),
        credentials: "same-origin",
        method: "POST"
      })
    );
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

  it("queues and runs Jira manual sync", async () => {
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
      "jira",
      "acme",
      "jira-install",
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toEqual({
      jobStatus: "succeeded",
      message: "Jira linked issue sync completed.",
      status: "succeeded"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/workspaces/acme/integrations/jira/sync/jobs",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/openroad/integrations/sync/run",
      expect.objectContaining({
        body: JSON.stringify({ limit: 5, provider: "jira", workspaceId: "acme" }),
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

  it("writes provider issues back with a compact same-origin request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        external: {
          id: "lin-issue-123",
          key: "OPEN-42",
          type: "issue",
          url: "https://linear.app/openroad/issue/OPEN-42/write-back"
        },
        installationId: "linear-install",
        mappingId: "mapping-linear",
        message: "Wrote Linear issue from OpenRoad request.",
        provider: "linear",
        requestId: "request-123",
        status: "written",
        writtenAt: "2026-07-04T01:00:00.000Z"
      })
    );

    const result = await writeBackProviderIssue(
      "linear",
      "acme",
      "request-123",
      "mapping-linear",
      fetchImpl as typeof fetch
    );

    expect(result).toEqual({
      external: {
        id: "lin-issue-123",
        key: "OPEN-42",
        type: "issue",
        url: "https://linear.app/openroad/issue/OPEN-42/write-back"
      },
      installationId: "linear-install",
      mappingId: "mapping-linear",
      message: "Wrote Linear issue from OpenRoad request.",
      provider: "linear",
      requestId: "request-123",
      status: "written",
      writtenAt: "2026-07-04T01:00:00.000Z"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme/integrations/linear/write-back",
      expect.objectContaining({
        body: JSON.stringify({ mappingId: "mapping-linear", requestId: "request-123" }),
        credentials: "same-origin",
        method: "POST"
      })
    );
  });

  it("redacts provider write-back action failures", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "upstream_error",
            message: "Linear token=raw-secret failed."
          }
        },
        502
      )
    );

    const result = await writeBackProviderIssue(
      "linear",
      "acme",
      "request-123",
      undefined,
      fetchImpl as typeof fetch
    );

    expect(result).toEqual({
      message: "Linear [redacted]=[redacted] failed.",
      provider: "linear",
      requestId: "request-123",
      status: "unavailable"
    });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
  });

  it("resolves provider conflicts with a compact same-origin request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        external: {
          id: "I_kwDOGH123",
          key: "AkhilTrivediX/OpenRoad#42",
          type: "issue"
        },
        installationId: "github-install",
        mappingId: "mapping-github",
        message: "Resolved GitHub conflict by keeping the OpenRoad request.",
        provider: "github",
        requestId: "request-123",
        resolution: "keep-openroad",
        resolvedAt: "2026-07-04T01:00:00.000Z",
        status: "resolved"
      })
    );

    const result = await resolveProviderConflict(
      "github",
      "acme",
      "mapping-github",
      "keep-openroad",
      fetchImpl as typeof fetch
    );

    expect(result).toEqual({
      external: {
        id: "I_kwDOGH123",
        key: "AkhilTrivediX/OpenRoad#42",
        type: "issue",
        url: undefined
      },
      installationId: "github-install",
      mappingId: "mapping-github",
      message: "Resolved GitHub conflict by keeping the OpenRoad request.",
      provider: "github",
      requestId: "request-123",
      resolution: "keep-openroad",
      resolvedAt: "2026-07-04T01:00:00.000Z",
      status: "resolved"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/openroad/workspaces/acme/integrations/github/conflicts/mapping-github/resolve",
      expect.objectContaining({
        body: JSON.stringify({ resolution: "keep-openroad" }),
        credentials: "same-origin",
        method: "POST"
      })
    );
  });

  it("redacts provider conflict resolution failures", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "upstream_error",
            message: "GitHub authorization=raw-secret failed."
          }
        },
        502
      )
    );

    const result = await resolveProviderConflict(
      "github",
      "acme",
      "mapping-github",
      "accept-provider",
      fetchImpl as typeof fetch
    );

    expect(result).toEqual({
      message: "GitHub [redacted]=[redacted] failed.",
      provider: "github",
      resolution: "accept-provider",
      status: "unavailable"
    });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
  });

  it("manages provider setup metadata with same-origin credentials and redacted results", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          installations: [
            {
              createdAt: "2026-07-04T00:00:00Z",
              id: "linear-install",
              permissions: ["read:external", "read:openroad", "write:openroad"],
              provider: "linear",
              providerAccountId: "linear-team",
              providerAccountName: "Linear Team",
              status: "active",
              workspaceId: "acme"
            }
          ],
          status: "listed"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            installation: {
              createdAt: "2026-07-04T00:00:00Z",
              id: "manual-linear",
              permissions: ["read:external", "read:openroad", "write:openroad"],
              provider: "linear",
              providerAccountId: "manual-team",
              providerAccountName: "Manual Linear",
              status: "active",
              workspaceId: "acme"
            },
            status: "connected"
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          credentials: [
            {
              createdAt: "2026-07-04T00:00:00Z",
              encryptedSecret: "ciphertext-must-not-enter-client-state",
              id: "credential-linear",
              installationId: "manual-linear",
              label: "Production token",
              permissions: ["read:external"],
              provider: "linear",
              providerScopes: ["read:issues"],
              secretTypes: ["access-token"],
              status: "active",
              updatedAt: "2026-07-04T00:00:00Z",
              workspaceId: "acme"
            }
          ],
          status: "listed"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            credential: {
              createdAt: "2026-07-04T00:00:00Z",
              encryptedSecret: "ciphertext-must-not-enter-client-state",
              id: "credential-linear",
              installationId: "manual-linear",
              label: "Production token",
              permissions: ["read:external"],
              provider: "linear",
              providerScopes: ["read:issues"],
              secretTypes: ["access-token", "refresh-token"],
              status: "active",
              updatedAt: "2026-07-04T00:00:00Z",
              workspaceId: "acme"
            },
            status: "stored"
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changed: true,
          installation: {
            createdAt: "2026-07-04T00:00:00Z",
            id: "manual-linear",
            permissions: ["read:external"],
            provider: "linear",
            providerAccountId: "manual-team",
            providerAccountName: "Manual Linear",
            status: "disconnected",
            workspaceId: "acme"
          },
          revokedCredentials: 1,
          status: "disconnected"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          credential: {
            createdAt: "2026-07-04T00:00:00Z",
            id: "credential-linear",
            installationId: "manual-linear",
            permissions: ["read:external"],
            provider: "linear",
            providerScopes: ["read:issues"],
            secretTypes: ["access-token"],
            status: "revoked",
            updatedAt: "2026-07-04T00:00:00Z",
            workspaceId: "acme"
          },
          status: "revoked"
        })
      );

    const listed = await listProviderInstallations("linear", "acme", fetchImpl as typeof fetch);
    const created = await createProviderInstallation(
      "linear",
      "acme",
      {
        installationId: "manual-linear",
        providerAccountId: "manual-team",
        providerAccountName: "Manual Linear"
      },
      fetchImpl as typeof fetch
    );
    const credentials = await listProviderCredentials("linear", "acme", fetchImpl as typeof fetch);
    const stored = await storeProviderCredential(
      "linear",
      "acme",
      {
        accessToken: "linear-access-secret",
        installationId: "manual-linear",
        label: "Production token",
        providerScopes: ["read:issues"],
        refreshToken: "linear-refresh-secret"
      },
      fetchImpl as typeof fetch
    );
    const disconnected = await disconnectProviderInstallation(
      "linear",
      "acme",
      "manual-linear",
      fetchImpl as typeof fetch
    );
    const revoked = await revokeProviderCredential(
      "linear",
      "acme",
      "credential-linear",
      fetchImpl as typeof fetch
    );
    const serialized = JSON.stringify([listed, created, credentials, stored, disconnected, revoked]);

    expect(listed.installations).toHaveLength(1);
    expect(created.installation).toMatchObject({ id: "manual-linear", provider: "linear" });
    expect(credentials.credentials?.[0]).toMatchObject({ id: "credential-linear", status: "active" });
    expect(stored.credential).toMatchObject({
      id: "credential-linear",
      secretTypes: ["access-token", "refresh-token"]
    });
    expect(disconnected).toMatchObject({
      changed: true,
      revokedCredentials: 1,
      status: "disconnected"
    });
    expect(revoked.credential).toMatchObject({ id: "credential-linear", status: "revoked" });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/workspaces/acme/integrations/linear/installations",
      expect.objectContaining({ credentials: "same-origin" })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "/api/openroad/workspaces/acme/integrations/linear/credentials",
      expect.objectContaining({
        body: JSON.stringify({
          accessToken: "linear-access-secret",
          installationId: "manual-linear",
          label: "Production token",
          providerScopes: ["read:issues"],
          refreshToken: "linear-refresh-secret"
        }),
        credentials: "same-origin",
        method: "POST"
      })
    );
    expect(serialized).not.toContain("linear-access-secret");
    expect(serialized).not.toContain("linear-refresh-secret");
    expect(serialized).not.toContain("ciphertext");
  });

  it("verifies GitHub App installations and redacts action errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          installation: {
            createdAt: "2026-07-04T00:00:00Z",
            id: "github-install",
            permissions: ["read:external", "read:openroad", "write:openroad"],
            provider: "github",
            providerAccountId: "123",
            providerAccountName: "AkhilTrivediX",
            status: "active",
            workspaceId: "acme"
          },
          status: "verified"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "forbidden",
              message: "Forbidden with access_token=raw-secret"
            }
          },
          403
        )
      );

    const verified = await verifyGitHubAppInstallation("acme", "98765", fetchImpl as typeof fetch);
    const forbidden = await verifyGitHubAppInstallation("acme", "98765", fetchImpl as typeof fetch);

    expect(verified).toMatchObject({
      installation: { id: "github-install", provider: "github" },
      status: "verified"
    });
    expect(forbidden).toEqual({
      message: "This integration action requires workspace owner access.",
      provider: "github",
      status: "forbidden"
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/openroad/workspaces/acme/integrations/github/app/installations/verify",
      expect.objectContaining({
        body: JSON.stringify({ installationId: "98765" }),
        credentials: "same-origin",
        method: "POST"
      })
    );
    expect(JSON.stringify(forbidden)).not.toContain("raw-secret");
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
