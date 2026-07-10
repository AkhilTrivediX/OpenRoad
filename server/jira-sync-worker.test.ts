// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createInitialOpenRoadState,
  openRoadReducer
} from "../src/domain/openroad";
import {
  createJiraInstallation,
  createJiraIssueMapping,
  createOpenRoadRequestFromJiraIssue,
  type JiraIssue
} from "../src/integrations/jira";
import {
  createIntegrationCredentialSecretContext,
  createInitialIntegrationState,
  type IntegrationCredential,
  type IntegrationSyncJob
} from "./integrations";
import {
  FetchJiraApiClient,
  JiraApiClientError,
  type JiraApiClient,
  type JiraIssueGetOptions
} from "./jira-api";
import type { JiraOAuthConfig } from "./jira";
import {
  canConfigureJiraIntegrationSyncWorker,
  createJiraIntegrationSyncWorker
} from "./jira-sync-worker";
import {
  OAuthExchangeClientError,
  type JiraOAuthExchangeClient
} from "./oauth-clients";
import { FileIntegrationStore } from "./integrations";
import { FileOpenRoadStore } from "./store";
import { createIntegrationTokenVault } from "./token-vault";

describe("Jira REST API client", () => {
  it("fetches Jira issues with bearer credentials and cloud-scoped URLs", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const client = new FetchJiraApiClient(
      { apiBaseUrl: "https://api.atlassian.test/ex/jira" },
      async (url, init) => {
        requests.push({
          authorization: new Headers(init?.headers).get("authorization"),
          url: String(url)
        });

        return Response.json(jiraRestIssuePayload({ fields: jiraFields({ summary: "Fetched Jira issue" }) }));
      }
    );

    const issue = await client.getIssue({
      cloudId: "cloud-123",
      credential: { accessToken: "jira-token" },
      issueIdOrKey: "10042"
    });

    expect(issue.title).toBe("Fetched Jira issue");
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe("Bearer jira-token");
    expect(requests[0].url).toContain("/cloud-123/rest/api/2/issue/10042");
    expect(requests[0].url).toContain("fields=summary%2Cdescription%2Cstatus");
    expect(requests[0].url).toContain("fieldsByKeys=false");
  });

  it("maps missing, malformed, and retryable Jira responses safely", async () => {
    const missingClient = new FetchJiraApiClient(
      { apiBaseUrl: "https://api.atlassian.test/ex/jira" },
      async () => Response.json({ errorMessages: ["not found"] }, { status: 404 })
    );
    const malformedClient = new FetchJiraApiClient(
      { apiBaseUrl: "https://api.atlassian.test/ex/jira" },
      async () => Response.json({ id: "10042" })
    );
    const retryableClient = new FetchJiraApiClient(
      { apiBaseUrl: "https://api.atlassian.test/ex/jira" },
      async () => Response.json({ errorMessages: ["slow down"] }, { status: 429 })
    );

    await expect(
      missingClient.getIssue({
        cloudId: "cloud-123",
        credential: { accessToken: "jira-token" },
        issueIdOrKey: "10042"
      })
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      malformedClient.getIssue({
        cloudId: "cloud-123",
        credential: { accessToken: "jira-token" },
        issueIdOrKey: "10042"
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
    await expect(
      retryableClient.getIssue({
        cloudId: "cloud-123",
        credential: { accessToken: "jira-token" },
        issueIdOrKey: "10042"
      })
    ).rejects.toMatchObject({ code: "jira_api_error", status: 429 });
  });

  it("updates Jira issues through the v3 edit endpoint with ADF description", async () => {
    const requests: Array<{ authorization: string | null; body: Record<string, unknown>; method?: string; url: string }> = [];
    const client = new FetchJiraApiClient(
      { apiBaseUrl: "https://api.atlassian.test/ex/jira" },
      async (url, init) => {
        requests.push({
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          method: init?.method,
          url: String(url)
        });

        return new Response(null, { status: 204 });
      }
    );

    await client.updateIssue({
      cloudId: "cloud-123",
      credential: { accessToken: "jira-token" },
      description: "First paragraph\n\nSecond paragraph",
      issueIdOrKey: "OPEN-42",
      title: "Updated Jira title"
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe("Bearer jira-token");
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url).toBe("https://api.atlassian.test/ex/jira/cloud-123/rest/api/3/issue/OPEN-42");
    expect(requests[0].body).toMatchObject({
      fields: {
        description: {
          content: [
            { content: [{ text: "First paragraph", type: "text" }], type: "paragraph" },
            { content: [{ text: "Second paragraph", type: "text" }], type: "paragraph" }
          ],
          type: "doc",
          version: 1
        },
        summary: "Updated Jira title"
      }
    });
  });
});

describe("Jira integration sync worker", () => {
  it("processes installation-wide jobs for already-linked Jira issue mappings only", async () => {
    const { calls, integrationStore, jiraClient, store, worker } = await createWorkerFixture();
    const firstIssue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    const secondIssue = jiraIssue({ id: "10042", key: "OPEN-2", title: "Old Jira two" });

    await seedLinkedIssues({ integrationStore, store }, [firstIssue, secondIssue]);
    jiraClient.getIssue = async (options) => {
      calls.push(options);
      if (options.issueIdOrKey === "10041") {
        return {
          ...firstIssue,
          labels: ["planned"],
          status: { category: { key: "indeterminate", name: "In Progress" }, id: "4", name: "In Progress" },
          title: "Updated Jira one"
        };
      }
      if (options.issueIdOrKey === "10042") {
        return {
          ...secondIssue,
          status: { category: { key: "done", name: "Done" }, id: "5", name: "Done" },
          title: "Updated Jira two"
        };
      }
      throw new JiraApiClientError("not_found", "not found", 404);
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const workspace = openRoad.state.workspaces.find((item) => item.id === "acme");

    expect(result).toMatchObject({
      kind: "success",
      summary: "Synced 2 Jira issue mappings; 0 missing from live response; 0 skipped."
    });
    expect(calls.map((call) => ({
      cloudId: call.cloudId,
      issueIdOrKey: call.issueIdOrKey,
      token: call.credential.accessToken
    }))).toEqual([
      { cloudId: "jira-cloud", issueIdOrKey: "10041", token: "jira-token" },
      { cloudId: "jira-cloud", issueIdOrKey: "10042", token: "jira-token" }
    ]);
    expect(workspace?.requests.find((request) => request.id === "request-one")?.title).toBe(
      "Updated Jira one"
    );
    expect(workspace?.requests.find((request) => request.id === "request-two")?.status).toBe(
      "Shipping soon"
    );
    expect(workspace?.requests).toHaveLength(createInitialOpenRoadState().workspaces[0].requests.length + 2);
    expect(integrations.state.mappings.every((mapping) => mapping.lastSyncedAt)).toBe(true);
    expect(JSON.stringify(integrations.state)).not.toContain("jira-token");
    expect(JSON.stringify(openRoad.state)).not.toContain("jira-token");
  });

  it("processes mapping-scoped jobs without updating sibling mappings", async () => {
    const { integrationStore, jiraClient, store, worker } = await createWorkerFixture();
    const firstIssue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    const secondIssue = jiraIssue({ id: "10042", key: "OPEN-2", title: "Old Jira two" });
    const seeded = await seedLinkedIssues({ integrationStore, store }, [firstIssue, secondIssue]);
    jiraClient.getIssue = async () => ({ ...firstIssue, title: "Scoped Jira update" });

    const result = await worker.process(syncJob({ mappingId: seeded.mappings[0].id }));
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const workspace = openRoad.state.workspaces.find((item) => item.id === "acme");

    expect(result.kind).toBe("success");
    expect(workspace?.requests.find((request) => request.id === "request-one")?.title).toBe(
      "Scoped Jira update"
    );
    expect(workspace?.requests.find((request) => request.id === "request-two")?.title).toBe(
      "Old Jira two"
    );
    expect(integrations.state.mappings.find((mapping) => mapping.id === seeded.mappings[0].id)?.lastSyncedAt).toBeTruthy();
    expect(integrations.state.mappings.find((mapping) => mapping.id === seeded.mappings[1].id)?.lastSyncedAt).toBeUndefined();
  });

  it("refreshes expired OAuth credentials before fetching Jira issues", async () => {
    const refreshes: string[] = [];
    const { calls, integrationStore, jiraClient, store, tokenVault, worker } = await createWorkerFixture({
      jiraOAuthExchangeClient: {
        async exchangeCode() {
          throw new Error("Unexpected Jira code exchange.");
        },
        async refreshToken(options) {
          refreshes.push(options.refreshToken);
          return {
            accessToken: "jira-token-new",
            expiresAt: "2026-07-04T13:00:00.000Z",
            providerScopes: ["read:jira-work"],
            refreshToken: "jira-refresh-new",
            tokenType: "bearer"
          };
        }
      }
    });
    const issue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    await seedLinkedIssues(
      { integrationStore, store },
      [issue],
      {
        credentialOverrides: {
          expiresAt: "2026-07-04T11:00:00.000Z",
          providerScopes: ["read:jira-work"],
          secretTypes: ["access-token", "refresh-token"]
        },
        secret: {
          accessToken: "jira-token-old",
          refreshToken: "jira-refresh-old"
        }
      }
    );
    jiraClient.getIssue = async (options) => {
      calls.push(options);
      return { ...issue, title: "Updated after Jira refresh" };
    };

    const result = await worker.process(syncJob());
    const integrations = await integrationStore.load();
    const persistedCredential = integrations.state.credentials[0];
    const opened = tokenVault.open(persistedCredential.encryptedSecret as any, {
      associatedData: createIntegrationCredentialSecretContext(persistedCredential)
    });

    expect(result).toMatchObject({ kind: "success" });
    expect(refreshes).toEqual(["jira-refresh-old"]);
    expect(calls.map((call) => call.credential.accessToken)).toEqual(["jira-token-new"]);
    expect(persistedCredential.expiresAt).toBe("2026-07-04T13:00:00.000Z");
    expect(opened).toEqual({
      accessToken: "jira-token-new",
      refreshToken: "jira-refresh-new"
    });
    expect(JSON.stringify(integrations.state)).not.toContain("jira-token-old");
    expect(JSON.stringify(integrations.state)).not.toContain("jira-token-new");
    expect(JSON.stringify(integrations.state)).not.toContain("jira-refresh-new");
  });

  it("refreshes near-expiry Jira OAuth credentials before provider calls", async () => {
    const refreshes: string[] = [];
    const { calls, integrationStore, jiraClient, store, worker } = await createWorkerFixture({
      jiraOAuthExchangeClient: {
        async exchangeCode() {
          throw new Error("Unexpected Jira code exchange.");
        },
        async refreshToken(options) {
          refreshes.push(options.refreshToken);
          return {
            accessToken: "jira-token-near-new",
            expiresAt: "2026-07-04T13:00:00.000Z",
            providerScopes: ["read:jira-work"],
            refreshToken: "jira-refresh-near-new",
            tokenType: "bearer"
          };
        }
      }
    });
    const issue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    await seedLinkedIssues(
      { integrationStore, store },
      [issue],
      {
        credentialOverrides: {
          expiresAt: "2026-07-04T12:04:00.000Z",
          secretTypes: ["access-token", "refresh-token"]
        },
        secret: {
          accessToken: "jira-token-near-old",
          refreshToken: "jira-refresh-near-old"
        }
      }
    );
    jiraClient.getIssue = async (options) => {
      calls.push(options);
      return { ...issue, title: "Updated after near-expiry refresh" };
    };

    const result = await worker.process(syncJob());

    expect(result).toMatchObject({ kind: "success" });
    expect(refreshes).toEqual(["jira-refresh-near-old"]);
    expect(calls.map((call) => call.credential.accessToken)).toEqual(["jira-token-near-new"]);
  });

  it("does not fetch Jira issues when an expired credential cannot refresh", async () => {
    const { calls, integrationStore, store, worker } = await createWorkerFixture();
    const issue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    await seedLinkedIssues(
      { integrationStore, store },
      [issue],
      {
        credentialOverrides: {
          expiresAt: "2026-07-04T11:00:00.000Z"
        },
        secret: {
          accessToken: "jira-token-old"
        }
      }
    );

    const result = await worker.process(syncJob());

    expect(result).toMatchObject({
      error: "Jira credential is expired or near expiry and does not include a refresh token.",
      kind: "fatal-error"
    });
    expect(calls).toEqual([]);
  });

  it("does not mutate Jira credentials when refresh is retryable", async () => {
    const { calls, integrationStore, store, tokenVault, worker } = await createWorkerFixture({
      jiraOAuthExchangeClient: {
        async exchangeCode() {
          throw new Error("Unexpected Jira code exchange.");
        },
        async refreshToken() {
          throw new OAuthExchangeClientError(
            "oauth_exchange_failed",
            "provider body mentioned jira-refresh-old",
            429
          );
        }
      }
    });
    const issue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    await seedLinkedIssues(
      { integrationStore, store },
      [issue],
      {
        credentialOverrides: {
          expiresAt: "2026-07-04T11:00:00.000Z",
          secretTypes: ["access-token", "refresh-token"]
        },
        secret: {
          accessToken: "jira-token-old",
          refreshToken: "jira-refresh-old"
        }
      }
    );

    const result = await worker.process(syncJob());
    const integrations = await integrationStore.load();
    const persistedCredential = integrations.state.credentials[0];
    const opened = tokenVault.open(persistedCredential.encryptedSecret as any, {
      associatedData: createIntegrationCredentialSecretContext(persistedCredential)
    });

    expect(result).toMatchObject({
      error: "Jira OAuth refresh failed with retryable status 429.",
      kind: "retryable-error",
      retryAfterSeconds: 300
    });
    expect(JSON.stringify(result)).not.toContain("jira-refresh-old");
    expect(calls).toEqual([]);
    expect(opened).toEqual({
      accessToken: "jira-token-old",
      refreshToken: "jira-refresh-old"
    });
  });

  it("reports missing live issues without deleting OpenRoad requests or mappings", async () => {
    const { integrationStore, jiraClient, store, worker } = await createWorkerFixture();
    const issue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    await seedLinkedIssues({ integrationStore, store }, [issue]);
    jiraClient.getIssue = async () => {
      throw new JiraApiClientError("not_found", "not found", 404);
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);

    expect(result).toMatchObject({
      kind: "success",
      summary: "Synced 0 Jira issue mappings; 1 missing from live response; 0 skipped."
    });
    expect(openRoad.state.workspaces[0].requests.some((request) => request.id === "request-one")).toBe(true);
    expect(integrations.state.mappings).toHaveLength(1);
    expect(integrations.state.mappings[0].lastSyncedAt).toBeUndefined();
  });

  it("revalidates credential and installation state after fetching before applying updates", async () => {
    const { integrationStore, jiraClient, store, worker } = await createWorkerFixture();
    const issue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    await seedLinkedIssues({ integrationStore, store }, [issue]);
    jiraClient.getIssue = async () => {
      const current = await integrationStore.load();
      await integrationStore.replaceState({
        ...current.state,
        credentials: current.state.credentials.map((credential) => ({
          ...credential,
          status: "revoked"
        }))
      });
      return { ...issue, title: "Should not apply" };
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);

    expect(result).toMatchObject({
      error: "Jira credential was not found.",
      kind: "fatal-error"
    });
    expect(openRoad.state.workspaces[0].requests.find((request) => request.id === "request-one")?.title).toBe(
      "Old Jira one"
    );
    expect(integrations.state.mappings[0].lastSyncedAt).toBeUndefined();
  });

  it("maps unsupported jobs, credential problems, and Jira API failures safely", async () => {
    const { integrationStore, jiraClient, store, worker } = await createWorkerFixture();
    const issue = jiraIssue({ id: "10041", key: "OPEN-1", title: "Old Jira one" });
    await seedLinkedIssues({ integrationStore, store }, [issue]);

    const wrongProvider = await worker.process(syncJob({ provider: "github" as const }));
    const missingMapping = await worker.process(syncJob({ mappingId: "missing" }));

    const current = await integrationStore.load();
    await integrationStore.replaceState({
      ...current.state,
      credentials: []
    });
    const missingCredential = await worker.process(syncJob());

    await seedLinkedIssues({ integrationStore, store }, [issue]);
    jiraClient.getIssue = async () => {
      throw new JiraApiClientError("jira_api_error", "Token secret leaked", 429);
    };
    const retryable = await worker.process(syncJob());
    jiraClient.getIssue = async () => {
      throw new JiraApiClientError("invalid_response", "Token secret leaked");
    };
    const fatal = await worker.process(syncJob());

    expect(wrongProvider).toMatchObject({ kind: "fatal-error" });
    expect(missingMapping).toMatchObject({ kind: "fatal-error" });
    expect(missingCredential).toMatchObject({
      error: "Jira credential was not found.",
      kind: "fatal-error"
    });
    expect(retryable).toMatchObject({
      error: "Jira API request failed with retryable status 429.",
      kind: "retryable-error",
      retryAfterSeconds: 300
    });
    expect(JSON.stringify(retryable)).not.toContain("secret");
    expect(fatal).toMatchObject({
      error: "Jira API response was invalid.",
      kind: "fatal-error"
    });
  });

  it("only auto-configures when the token vault is ready", () => {
    expect(
      canConfigureJiraIntegrationSyncWorker(
        createIntegrationTokenVault({ encryptionKey: "x".repeat(32) })
      )
    ).toBe(true);
    expect(canConfigureJiraIntegrationSyncWorker(createIntegrationTokenVault({}))).toBe(false);
  });
});

async function createWorkerFixture(
  options: {
    jiraOAuthConfig?: JiraOAuthConfig;
    jiraOAuthExchangeClient?: JiraOAuthExchangeClient;
  } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "openroad-jira-sync-worker-"));
  const store = new FileOpenRoadStore(join(root, "openroad-state.json"));
  const integrationStore = new FileIntegrationStore(join(root, "openroad-integrations.json"));
  const tokenVault = createIntegrationTokenVault({
    encryptionKey: "jira-sync-worker-test-key-0000000",
    keyId: "primary"
  });
  const calls: JiraIssueGetOptions[] = [];
  const jiraClient: JiraApiClient = {
    async getIssue(options) {
      calls.push(options);
      throw new JiraApiClientError("not_found", "not found", 404);
    }
  };
  const jiraOAuthExchangeClient =
    options.jiraOAuthExchangeClient ??
    ({
      async exchangeCode() {
        throw new Error("Unexpected Jira code exchange.");
      },
      async refreshToken() {
        throw new Error("Unexpected Jira token refresh.");
      }
    } satisfies JiraOAuthExchangeClient);
  const worker = createJiraIntegrationSyncWorker({
    integrationStore,
    jiraApiClient: jiraClient,
    jiraOAuthConfig: options.jiraOAuthConfig ?? testJiraOAuthConfig(),
    jiraOAuthExchangeClient,
    now: () => new Date("2026-07-04T12:00:00.000Z"),
    runIntegrationMutationExclusive: (task) => task(),
    store,
    tokenVault
  });

  return { calls, integrationStore, jiraClient, store, tokenVault, worker };
}

async function seedLinkedIssues(
  stores: { integrationStore: FileIntegrationStore; store: FileOpenRoadStore },
  issues: JiraIssue[],
  options: {
    credentialOverrides?: Partial<IntegrationCredential>;
    secret?: { accessToken: string; refreshToken?: string };
  } = {}
) {
  const tokenVault = createIntegrationTokenVault({
    encryptionKey: "jira-sync-worker-test-key-0000000",
    keyId: "primary"
  });
  const installation = createJiraInstallation({
    accountId: "jira-cloud",
    accountName: "OpenRoad Jira",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "jira-install",
    workspaceId: "acme"
  });
  const credential = createCredential(
    tokenVault,
    installation.id,
    options.credentialOverrides,
    options.secret
  );
  const requests = issues.map((issue, index) =>
    createOpenRoadRequestFromJiraIssue(issue, {
      now: "2026-07-04T00:00:00.000Z",
      requestId: index === 0 ? "request-one" : "request-two"
    })
  );
  let openRoadState = createInitialOpenRoadState();

  for (const request of requests) {
    openRoadState = openRoadReducer(openRoadState, {
      request,
      type: "create-request",
      workspaceId: "acme"
    });
  }

  const mappings = issues.map((issue, index) =>
    createJiraIssueMapping(
      installation,
      issue,
      {
        id: requests[index].id,
        type: "request",
        workspaceId: "acme"
      },
      "2026-07-04T00:00:00.000Z"
    )
  );

  await stores.store.replaceState(openRoadState);
  await stores.integrationStore.replaceState({
    ...createInitialIntegrationState(),
    credentials: [credential],
    installations: [installation],
    mappings
  });

  return { credential, installation, mappings, requests };
}

function createCredential(
  tokenVault: Extract<ReturnType<typeof createIntegrationTokenVault>, { status: "ready" }>,
  installationId: string,
  overrides: Partial<IntegrationCredential> = {},
  secret: { accessToken: string; refreshToken?: string } = { accessToken: "jira-token" }
): IntegrationCredential {
  const credential: IntegrationCredential = {
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "credential-jira-install",
    installationId,
    permissions: ["read:external", "read:openroad"],
    provider: "jira",
    providerScopes: ["read:jira-work"],
    secretTypes: ["access-token"],
    status: "active",
    tokenType: "bearer",
    updatedAt: "2026-07-04T00:00:00.000Z",
    workspaceId: "acme",
    ...overrides
  };

  return {
    ...credential,
    encryptedSecret: tokenVault.seal(
      secret,
      { associatedData: createIntegrationCredentialSecretContext(credential) }
    )
  };
}

function testJiraOAuthConfig(): JiraOAuthConfig {
  return {
    authBaseUrl: "https://auth.atlassian.test",
    clientId: "jira-client",
    clientSecret: "jira-secret",
    redirectUri: "https://openroad.test/api/openroad/integrations/jira/oauth/callback",
    resourceBaseUrl: "https://api.atlassian.test"
  };
}

function syncJob(overrides: Partial<IntegrationSyncJob> = {}): IntegrationSyncJob {
  return {
    attempt: 1,
    claimedAt: "2026-07-04T11:59:00.000Z",
    createdAt: "2026-07-04T11:58:00.000Z",
    dedupeKey: "jira:acme:jira-install-jira-cloud:manual:installation",
    id: "sync-job-jira-acme",
    installationId: "jira-install-jira-cloud",
    leaseExpiresAt: "2026-07-04T12:14:00.000Z",
    provider: "jira",
    reason: "manual",
    status: "running",
    updatedAt: "2026-07-04T11:59:00.000Z",
    workspaceId: "acme",
    ...overrides
  };
}

function jiraIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  const key = overrides.key ?? "OPEN-1";
  const id = overrides.id ?? "10041";

  return {
    assignee: "Akhil Trivedi",
    body: "Track live Jira issue state.",
    cloudId: "jira-cloud",
    id,
    issueType: "Story",
    key,
    labels: ["needs-decision"],
    priority: "High",
    project: { id: "project-open", key: "OPEN", name: "OpenRoad" },
    reporter: "Customer Ops",
    self: `https://api.atlassian.com/ex/jira/jira-cloud/rest/api/2/issue/${id}`,
    status: { category: { key: "new", name: "To Do" }, id: "3", name: "Triage" },
    title: `Jira issue ${key}`,
    updatedAt: "2026-07-04T00:00:00.000+0000",
    url: `https://openroad.atlassian.net/browse/${key}`,
    ...overrides
  };
}

function jiraRestIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    fields: jiraFields(),
    id: "10042",
    key: "OPEN-42",
    self: "https://api.atlassian.com/ex/jira/cloud-123/rest/api/2/issue/10042",
    url: "https://openroad.atlassian.net/browse/OPEN-42",
    ...overrides
  };
}

function jiraFields(overrides: Record<string, unknown> = {}) {
  return {
    assignee: { accountId: "acct-akhil", displayName: "Akhil Trivedi" },
    description: {
      content: [
        {
          content: [{ text: "Users need Jira context.", type: "text" }],
          type: "paragraph"
        }
      ],
      type: "doc",
      version: 1
    },
    issuetype: { id: "10001", name: "Story" },
    labels: ["needs-decision", "ux"],
    priority: { id: "2", name: "High" },
    project: { id: "project-open", key: "OPEN", name: "OpenRoad" },
    reporter: { accountId: "acct-ops", displayName: "Customer Ops" },
    status: {
      id: "3",
      name: "Triage",
      statusCategory: { key: "new", name: "To Do" }
    },
    summary: "Import Jira issues",
    updated: "2026-07-04T00:00:00.000+0000",
    ...overrides
  };
}
