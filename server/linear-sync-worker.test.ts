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
  createLinearInstallation,
  createLinearIssueMapping,
  createOpenRoadRequestFromLinearIssue,
  type LinearIssue
} from "../src/integrations/linear";
import {
  createIntegrationCredentialSecretContext,
  createInitialIntegrationState,
  type IntegrationCredential,
  type IntegrationSyncJob
} from "./integrations";
import {
  FetchLinearApiClient,
  LinearApiClientError,
  type LinearApiClient,
  type LinearIssueGetOptions
} from "./linear-api";
import {
  canConfigureLinearIntegrationSyncWorker,
  createLinearIntegrationSyncWorker
} from "./linear-sync-worker";
import { FileIntegrationStore } from "./integrations";
import { FileOpenRoadStore } from "./store";
import { createIntegrationTokenVault } from "./token-vault";

describe("Linear GraphQL API client", () => {
  it("fetches Linear issues with bearer credentials", async () => {
    const requests: Array<{ authorization: string | null; body: unknown }> = [];
    const client = new FetchLinearApiClient(
      { apiUrl: "https://linear.test/graphql" },
      async (_url, init) => {
        requests.push({
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body))
        });

        return Response.json({
          data: {
            issue: linearGraphQLIssuePayload({ title: "Fetched Linear issue" })
          }
        });
      }
    );

    const issue = await client.getIssue({
      credential: { accessToken: "linear-token", authorizationMode: "bearer" },
      issueId: "lin-issue-123"
    });

    expect(issue.title).toBe("Fetched Linear issue");
    expect(requests).toMatchObject([
      {
        authorization: "Bearer linear-token",
        body: {
          variables: { id: "lin-issue-123" }
        }
      }
    ]);
  });

  it("supports Linear personal API key authorization", async () => {
    const authorizations: string[] = [];
    const client = new FetchLinearApiClient(
      { apiUrl: "https://linear.test/graphql" },
      async (_url, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
        return Response.json({ data: { issue: linearGraphQLIssuePayload() } });
      }
    );

    await client.getIssue({
      credential: { accessToken: "linear-api-key", authorizationMode: "api-key" },
      issueId: "OPEN-42"
    });

    expect(authorizations).toEqual(["linear-api-key"]);
  });

  it("maps GraphQL errors, missing issues, and malformed payloads safely", async () => {
    const graphQLErrorClient = new FetchLinearApiClient(
      { apiUrl: "https://linear.test/graphql" },
      async () => Response.json({ errors: [{ message: "secret token leaked" }] })
    );
    const missingClient = new FetchLinearApiClient(
      { apiUrl: "https://linear.test/graphql" },
      async () => Response.json({ data: { issue: null } })
    );
    const malformedClient = new FetchLinearApiClient(
      { apiUrl: "https://linear.test/graphql" },
      async () => Response.json({ data: { issue: { id: "only-id" } } })
    );

    await expect(
      graphQLErrorClient.getIssue({
        credential: { accessToken: "linear-token" },
        issueId: "lin-issue-123"
      })
    ).rejects.toMatchObject({ code: "graphql_error" });
    await expect(
      missingClient.getIssue({
        credential: { accessToken: "linear-token" },
        issueId: "lin-issue-123"
      })
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      malformedClient.getIssue({
        credential: { accessToken: "linear-token" },
        issueId: "lin-issue-123"
      })
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("Linear integration sync worker", () => {
  it("processes installation-wide jobs for already-linked Linear issue mappings only", async () => {
    const { calls, integrationStore, linearClient, store, worker } = await createWorkerFixture();
    const firstIssue = linearIssue({ id: "lin-issue-one", identifier: "OPEN-1", title: "Old Linear one" });
    const secondIssue = linearIssue({ id: "lin-issue-two", identifier: "OPEN-2", title: "Old Linear two" });

    await seedLinkedIssues({ integrationStore, store }, [firstIssue, secondIssue]);
    linearClient.getIssue = async (options) => {
      calls.push(options);
      if (options.issueId === "lin-issue-one") {
        return { ...firstIssue, labels: ["planned"], state: { id: "state-started", name: "Started", type: "started" }, title: "Updated Linear one" };
      }
      if (options.issueId === "lin-issue-two") {
        return { ...secondIssue, state: { id: "state-done", name: "Done", type: "completed" }, title: "Updated Linear two" };
      }
      throw new LinearApiClientError("not_found", "not found", 404);
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const workspace = openRoad.state.workspaces.find((item) => item.id === "acme");

    expect(result).toMatchObject({
      kind: "success",
      summary: "Synced 2 Linear issue mappings; 0 missing from live response; 0 skipped."
    });
    expect(calls.map((call) => ({ issueId: call.issueId, token: call.credential.accessToken }))).toEqual([
      { issueId: "lin-issue-one", token: "linear-token" },
      { issueId: "lin-issue-two", token: "linear-token" }
    ]);
    expect(workspace?.requests.find((request) => request.id === "request-one")?.title).toBe(
      "Updated Linear one"
    );
    expect(workspace?.requests.find((request) => request.id === "request-two")?.status).toBe(
      "Shipping soon"
    );
    expect(workspace?.requests).toHaveLength(createInitialOpenRoadState().workspaces[0].requests.length + 2);
    expect(integrations.state.mappings.every((mapping) => mapping.lastSyncedAt)).toBe(true);
    expect(JSON.stringify(integrations.state)).not.toContain("linear-token");
    expect(JSON.stringify(openRoad.state)).not.toContain("linear-token");
  });

  it("processes mapping-scoped jobs without updating sibling mappings", async () => {
    const { integrationStore, linearClient, store, worker } = await createWorkerFixture();
    const firstIssue = linearIssue({ id: "lin-issue-one", identifier: "OPEN-1", title: "Old Linear one" });
    const secondIssue = linearIssue({ id: "lin-issue-two", identifier: "OPEN-2", title: "Old Linear two" });
    const seeded = await seedLinkedIssues({ integrationStore, store }, [firstIssue, secondIssue]);
    linearClient.getIssue = async () => ({ ...firstIssue, title: "Scoped Linear update" });

    const result = await worker.process(syncJob({ mappingId: seeded.mappings[0].id }));
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const workspace = openRoad.state.workspaces.find((item) => item.id === "acme");

    expect(result.kind).toBe("success");
    expect(workspace?.requests.find((request) => request.id === "request-one")?.title).toBe(
      "Scoped Linear update"
    );
    expect(workspace?.requests.find((request) => request.id === "request-two")?.title).toBe(
      "Old Linear two"
    );
    expect(integrations.state.mappings.find((mapping) => mapping.id === seeded.mappings[0].id)?.lastSyncedAt).toBeTruthy();
    expect(integrations.state.mappings.find((mapping) => mapping.id === seeded.mappings[1].id)?.lastSyncedAt).toBeUndefined();
  });

  it("reports missing live issues without deleting OpenRoad requests or mappings", async () => {
    const { integrationStore, linearClient, store, worker } = await createWorkerFixture();
    const issue = linearIssue({ id: "lin-issue-one", identifier: "OPEN-1", title: "Old Linear one" });
    await seedLinkedIssues({ integrationStore, store }, [issue]);
    linearClient.getIssue = async () => {
      throw new LinearApiClientError("not_found", "not found", 404);
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);

    expect(result).toMatchObject({
      kind: "success",
      summary: "Synced 0 Linear issue mappings; 1 missing from live response; 0 skipped."
    });
    expect(openRoad.state.workspaces[0].requests.some((request) => request.id === "request-one")).toBe(true);
    expect(integrations.state.mappings).toHaveLength(1);
    expect(integrations.state.mappings[0].lastSyncedAt).toBeUndefined();
  });

  it("revalidates credential and installation state after fetching before applying updates", async () => {
    const { integrationStore, linearClient, store, worker } = await createWorkerFixture();
    const issue = linearIssue({ id: "lin-issue-one", identifier: "OPEN-1", title: "Old Linear one" });
    await seedLinkedIssues({ integrationStore, store }, [issue]);
    linearClient.getIssue = async () => {
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
      error: "Linear credential was not found.",
      kind: "fatal-error"
    });
    expect(openRoad.state.workspaces[0].requests.find((request) => request.id === "request-one")?.title).toBe(
      "Old Linear one"
    );
    expect(integrations.state.mappings[0].lastSyncedAt).toBeUndefined();
  });

  it("maps unsupported jobs, credential problems, and Linear API failures safely", async () => {
    const { integrationStore, linearClient, store, worker } = await createWorkerFixture();
    const issue = linearIssue({ id: "lin-issue-one", identifier: "OPEN-1", title: "Old Linear one" });
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
    linearClient.getIssue = async () => {
      throw new LinearApiClientError("linear_api_error", "Token secret leaked", 429);
    };
    const retryable = await worker.process(syncJob());
    linearClient.getIssue = async () => {
      throw new LinearApiClientError("invalid_response", "Token secret leaked");
    };
    const fatal = await worker.process(syncJob());

    expect(wrongProvider).toMatchObject({ kind: "fatal-error" });
    expect(missingMapping).toMatchObject({ kind: "fatal-error" });
    expect(missingCredential).toMatchObject({
      error: "Linear credential was not found.",
      kind: "fatal-error"
    });
    expect(retryable).toMatchObject({
      error: "Linear API request failed with retryable status 429.",
      kind: "retryable-error",
      retryAfterSeconds: 300
    });
    expect(JSON.stringify(retryable)).not.toContain("secret");
    expect(fatal).toMatchObject({
      error: "Linear API response was invalid.",
      kind: "fatal-error"
    });
  });

  it("only auto-configures when the token vault is ready", () => {
    expect(
      canConfigureLinearIntegrationSyncWorker(
        createIntegrationTokenVault({ encryptionKey: "x".repeat(32) })
      )
    ).toBe(true);
    expect(canConfigureLinearIntegrationSyncWorker(createIntegrationTokenVault({}))).toBe(false);
  });
});

async function createWorkerFixture() {
  const root = await mkdtemp(join(tmpdir(), "openroad-linear-sync-worker-"));
  const store = new FileOpenRoadStore(join(root, "openroad-state.json"));
  const integrationStore = new FileIntegrationStore(join(root, "openroad-integrations.json"));
  const tokenVault = createIntegrationTokenVault({
    encryptionKey: "linear-sync-worker-test-key-000000",
    keyId: "primary"
  });
  const calls: LinearIssueGetOptions[] = [];
  const linearClient: LinearApiClient = {
    async getIssue(options) {
      calls.push(options);
      throw new LinearApiClientError("not_found", "not found", 404);
    }
  };
  const worker = createLinearIntegrationSyncWorker({
    integrationStore,
    linearApiClient: linearClient,
    now: () => new Date("2026-07-04T12:00:00.000Z"),
    runIntegrationMutationExclusive: (task) => task(),
    store,
    tokenVault
  });

  return { calls, integrationStore, linearClient, store, tokenVault, worker };
}

async function seedLinkedIssues(
  stores: { integrationStore: FileIntegrationStore; store: FileOpenRoadStore },
  issues: LinearIssue[]
) {
  const tokenVault = createIntegrationTokenVault({
    encryptionKey: "linear-sync-worker-test-key-000000",
    keyId: "primary"
  });
  const installation = createLinearInstallation({
    accountId: "linear-team",
    accountName: "OpenRoad",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "linear-install",
    workspaceId: "acme"
  });
  const credential = createCredential(tokenVault);
  const requests = issues.map((issue, index) =>
    createOpenRoadRequestFromLinearIssue(issue, {
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
    createLinearIssueMapping(
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
  tokenVault: Extract<ReturnType<typeof createIntegrationTokenVault>, { status: "ready" }>
): IntegrationCredential {
  const credential: IntegrationCredential = {
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "credential-linear-install",
    installationId: "linear-install",
    permissions: ["read:external", "read:openroad"],
    provider: "linear",
    providerScopes: ["issues:read"],
    secretTypes: ["access-token"],
    status: "active",
    tokenType: "bearer",
    updatedAt: "2026-07-04T00:00:00.000Z",
    workspaceId: "acme"
  };

  return {
    ...credential,
    encryptedSecret: tokenVault.seal(
      { accessToken: "linear-token" },
      { associatedData: createIntegrationCredentialSecretContext(credential) }
    )
  };
}

function syncJob(overrides: Partial<IntegrationSyncJob> = {}): IntegrationSyncJob {
  return {
    attempt: 1,
    claimedAt: "2026-07-04T11:59:00.000Z",
    createdAt: "2026-07-04T11:58:00.000Z",
    dedupeKey: "linear:acme:linear-install:manual:installation",
    id: "sync-job-linear-acme",
    installationId: "linear-install",
    leaseExpiresAt: "2026-07-04T12:14:00.000Z",
    provider: "linear",
    reason: "manual",
    status: "running",
    updatedAt: "2026-07-04T11:59:00.000Z",
    workspaceId: "acme",
    ...overrides
  };
}

function linearIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  const identifier = overrides.identifier ?? "OPEN-1";
  const id = overrides.id ?? "lin-issue-one";

  return {
    assignee: "Akhil Trivedi",
    body: "Track live Linear issue state.",
    creator: "Customer Ops",
    id,
    identifier,
    labels: ["needs-decision"],
    project: "OpenRoad Beta",
    state: { id: "state-triage", name: "Triage", type: "triage" },
    team: { id: "team-open", key: "OPEN", name: "OpenRoad" },
    title: `Linear issue ${identifier}`,
    updatedAt: "2026-07-04T00:00:00Z",
    url: `https://linear.app/openroad/issue/${identifier}/linear-issue`,
    ...overrides
  };
}

function linearGraphQLIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    assignee: { displayName: "Akhil Trivedi" },
    creator: { displayName: "Customer Ops" },
    description: "GraphQL issue body.",
    id: "lin-issue-123",
    identifier: "OPEN-42",
    labels: { nodes: [{ name: "planned" }] },
    priority: 2,
    project: { name: "OpenRoad Beta" },
    state: { id: "state-started", name: "Started", type: "started" },
    team: { id: "team-open", key: "OPEN", name: "OpenRoad" },
    title: "GraphQL Linear issue",
    updatedAt: "2026-07-04T00:00:00Z",
    url: "https://linear.app/openroad/issue/OPEN-42/graphql-linear-issue",
    ...overrides
  };
}
