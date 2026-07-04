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
  createGitHubInstallation,
  createGitHubIssueMapping,
  createOpenRoadRequestFromGitHubIssue,
  type GitHubIssue
} from "../src/integrations/github";
import {
  canConfigureGitHubIntegrationSyncWorker,
  createGitHubIntegrationSyncWorker
} from "./github-sync-worker";
import { GitHubAppClientError, type GitHubAppClient } from "./github-app";
import {
  FileIntegrationStore,
  createInitialIntegrationState,
  type IntegrationSyncJob
} from "./integrations";
import { FileOpenRoadStore } from "./store";

describe("GitHub integration sync worker", () => {
  it("processes installation-wide jobs for already-linked GitHub issue mappings only", async () => {
    const { githubClient, integrationStore, store, worker, calls } = await createWorkerFixture();
    const firstIssue = githubIssue({ id: "I_one", number: 1, title: "Old title one" });
    const secondIssue = githubIssue({ id: "I_two", number: 2, title: "Old title two" });

    await seedLinkedIssues({ integrationStore, store }, [firstIssue, secondIssue]);
    githubClient.getRepositoryIssue = async (options) => {
      calls.push(options);
      if (options.issueNumber === 1) return { ...firstIssue, labels: ["planned"], title: "Updated title one" };
      if (options.issueNumber === 2) return { ...secondIssue, state: "closed", title: "Updated title two" };
      throw new GitHubAppClientError("github_api_error", "not found", 404);
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const workspace = openRoad.state.workspaces.find((item) => item.id === "acme");

    expect(result).toMatchObject({
      kind: "success",
      summary: "Synced 2 GitHub issue mappings; 0 missing from live response; 0 skipped."
    });
    expect(calls).toEqual([
      {
        installationId: "98765",
        issueNumber: 1,
        owner: "AkhilTrivediX",
        repo: "OpenRoad"
      },
      {
        installationId: "98765",
        issueNumber: 2,
        owner: "AkhilTrivediX",
        repo: "OpenRoad"
      }
    ]);
    expect(workspace?.requests.find((request) => request.id === "request-one")?.title).toBe(
      "Updated title one"
    );
    expect(workspace?.requests.find((request) => request.id === "request-two")?.status).toBe(
      "Shipping soon"
    );
    expect(workspace?.requests).toHaveLength(createInitialOpenRoadState().workspaces[0].requests.length + 2);
    expect(integrations.state.mappings.every((mapping) => mapping.lastSyncedAt)).toBe(true);
  });

  it("processes mapping-scoped jobs without updating sibling mappings", async () => {
    const { githubClient, integrationStore, store, worker } = await createWorkerFixture();
    const firstIssue = githubIssue({ id: "I_one", number: 1, title: "Old title one" });
    const secondIssue = githubIssue({ id: "I_two", number: 2, title: "Old title two" });
    const seeded = await seedLinkedIssues({ integrationStore, store }, [firstIssue, secondIssue]);
    githubClient.getRepositoryIssue = async () => ({ ...firstIssue, title: "Scoped update" });

    const result = await worker.process(syncJob({ mappingId: seeded.mappings[0].id }));
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);
    const workspace = openRoad.state.workspaces.find((item) => item.id === "acme");

    expect(result.kind).toBe("success");
    expect(workspace?.requests.find((request) => request.id === "request-one")?.title).toBe(
      "Scoped update"
    );
    expect(workspace?.requests.find((request) => request.id === "request-two")?.title).toBe(
      "Old title two"
    );
    expect(integrations.state.mappings.find((mapping) => mapping.id === seeded.mappings[0].id)?.lastSyncedAt).toBeTruthy();
    expect(integrations.state.mappings.find((mapping) => mapping.id === seeded.mappings[1].id)?.lastSyncedAt).toBeUndefined();
  });

  it("reports missing live issues without deleting OpenRoad requests or mappings", async () => {
    const { githubClient, integrationStore, store, worker } = await createWorkerFixture();
    const firstIssue = githubIssue({ id: "I_one", number: 1, title: "Old title one" });
    await seedLinkedIssues({ integrationStore, store }, [firstIssue]);
    githubClient.getRepositoryIssue = async () => {
      throw new GitHubAppClientError("github_api_error", "not found", 404);
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);

    expect(result).toMatchObject({
      kind: "success",
      summary: "Synced 0 GitHub issue mappings; 1 missing from live response; 0 skipped."
    });
    expect(openRoad.state.workspaces[0].requests.some((request) => request.id === "request-one")).toBe(true);
    expect(integrations.state.mappings).toHaveLength(1);
    expect(integrations.state.mappings[0].lastSyncedAt).toBeUndefined();
  });

  it("revalidates installation state after fetching before applying updates", async () => {
    const { githubClient, integrationStore, store, worker } = await createWorkerFixture();
    const firstIssue = githubIssue({ id: "I_one", number: 1, title: "Old title one" });
    await seedLinkedIssues({ integrationStore, store }, [firstIssue]);
    githubClient.getRepositoryIssue = async () => {
      const current = await integrationStore.load();
      await integrationStore.replaceState({
        ...current.state,
        installations: current.state.installations.map((installation) => ({
          ...installation,
          status: "disconnected"
        }))
      });
      return { ...firstIssue, title: "Should not apply" };
    };

    const result = await worker.process(syncJob());
    const [openRoad, integrations] = await Promise.all([store.load(), integrationStore.load()]);

    expect(result).toMatchObject({
      error: "GitHub installation is not active.",
      kind: "fatal-error"
    });
    expect(openRoad.state.workspaces[0].requests.find((request) => request.id === "request-one")?.title).toBe(
      "Old title one"
    );
    expect(integrations.state.mappings[0].lastSyncedAt).toBeUndefined();
  });

  it("maps unsupported jobs, mapping errors, and GitHub API failures safely", async () => {
    const { githubClient, integrationStore, store, worker } = await createWorkerFixture();
    const firstIssue = githubIssue({ id: "I_one", number: 1, title: "Old title one" });
    await seedLinkedIssues({ integrationStore, store }, [firstIssue]);

    const wrongProvider = await worker.process(syncJob({ provider: "linear" as const }));
    const missingMapping = await worker.process(syncJob({ mappingId: "missing" }));
    githubClient.getRepositoryIssue = async () => {
      throw new GitHubAppClientError("github_api_error", "Token secret leaked", 429);
    };
    const retryable = await worker.process(syncJob());
    githubClient.getRepositoryIssue = async () => {
      throw new GitHubAppClientError("invalid_response", "Token secret leaked");
    };
    const fatal = await worker.process(syncJob());

    expect(wrongProvider).toMatchObject({ kind: "fatal-error" });
    expect(missingMapping).toMatchObject({ kind: "fatal-error" });
    expect(retryable).toMatchObject({
      error: "GitHub API request failed with retryable status 429.",
      kind: "retryable-error",
      retryAfterSeconds: 300
    });
    expect(JSON.stringify(retryable)).not.toContain("secret");
    expect(fatal).toMatchObject({
      error: "GitHub API response was invalid.",
      kind: "fatal-error"
    });
  });

  it("only auto-configures when GitHub App credentials are available", () => {
    expect(
      canConfigureGitHubIntegrationSyncWorker({
        apiBaseUrl: "https://api.github.test",
        appBaseUrl: "https://github.test",
        appId: "123",
        privateKey: "private-key",
        webhookSecretConfigured: false
      })
    ).toBe(true);
    expect(
      canConfigureGitHubIntegrationSyncWorker({
        apiBaseUrl: "https://api.github.test",
        appBaseUrl: "https://github.test",
        appId: "123",
        webhookSecretConfigured: false
      })
    ).toBe(false);
  });
});

async function createWorkerFixture() {
  const root = await mkdtemp(join(tmpdir(), "openroad-github-sync-worker-"));
  const store = new FileOpenRoadStore(join(root, "openroad-state.json"));
  const integrationStore = new FileIntegrationStore(join(root, "openroad-integrations.json"));
  const calls: Parameters<GitHubAppClient["getRepositoryIssue"]>[0][] = [];
  const githubClient: GitHubAppClient = {
    async createInstallationAccessToken() {
      return { token: "unused" };
    },
    async getInstallation() {
      return {};
    },
    async getRepositoryIssue(options) {
      calls.push(options);
      throw new GitHubAppClientError("github_api_error", "not found", 404);
    },
    async listRepositoryIssues(options) {
      return [];
    }
  };
  const worker = createGitHubIntegrationSyncWorker({
    githubAppClient: githubClient,
    integrationStore,
    now: () => new Date("2026-07-04T12:00:00.000Z"),
    runIntegrationMutationExclusive: (task) => task(),
    store
  });

  return { calls, githubClient, integrationStore, store, worker };
}

async function seedLinkedIssues(
  stores: { integrationStore: FileIntegrationStore; store: FileOpenRoadStore },
  issues: GitHubIssue[]
) {
  const installation = createGitHubInstallation({
    accountId: "AkhilTrivediX",
    accountName: "AkhilTrivediX",
    createdAt: "2026-07-04T00:00:00.000Z",
    id: "github-installation-98765",
    workspaceId: "acme"
  });
  const requests = issues.map((issue, index) =>
    createOpenRoadRequestFromGitHubIssue(issue, {
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
    createGitHubIssueMapping(
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
    installations: [installation],
    mappings
  });

  return { installation, mappings, requests };
}

function syncJob(overrides: Partial<IntegrationSyncJob> = {}): IntegrationSyncJob {
  return {
    attempt: 1,
    claimedAt: "2026-07-04T11:59:00.000Z",
    createdAt: "2026-07-04T11:58:00.000Z",
    dedupeKey: "github:acme:github-installation-98765:manual:installation",
    id: "sync-job-github-acme",
    installationId: "github-installation-98765",
    leaseExpiresAt: "2026-07-04T12:14:00.000Z",
    provider: "github",
    reason: "manual",
    status: "running",
    updatedAt: "2026-07-04T11:59:00.000Z",
    workspaceId: "acme",
    ...overrides
  };
}

function githubIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  const number = overrides.number ?? 1;
  const id = overrides.id ?? `I_${number}`;

  return {
    assignees: [],
    author: "akhil",
    body: "Track live GitHub issue state.",
    id,
    labels: ["needs-decision"],
    number,
    repository: {
      fullName: "AkhilTrivediX/OpenRoad",
      id: "R_openroad",
      name: "OpenRoad",
      owner: "AkhilTrivediX",
      url: "https://github.com/AkhilTrivediX/OpenRoad",
      visibility: "public"
    },
    state: "open",
    title: `GitHub issue ${number}`,
    url: `https://github.com/AkhilTrivediX/OpenRoad/issues/${number}`,
    ...overrides
  };
}
