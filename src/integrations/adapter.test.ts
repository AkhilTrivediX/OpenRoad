import { describe, expect, it } from "vitest";

import {
  createExternalObjectKey,
  createMapping,
  createMappingKey,
  disconnectMapping,
  shouldRetrySync,
  validateProviderFixture,
  type ProviderFixture,
  type SyncResult
} from "./adapter";

describe("integration adapter contract", () => {
  it("creates stable external object and mapping keys", () => {
    const external = {
      id: " 123 ",
      key: " OPEN-123 ",
      provider: "jira" as const,
      type: "issue" as const,
      url: "https://example.atlassian.net/browse/OPEN-123"
    };
    const openRoad = {
      id: "work-123",
      type: "work-item" as const,
      workspaceId: "acme"
    };

    expect(createExternalObjectKey(external)).toBe("jira:issue:open-123");
    expect(createMappingKey(" install-1 ", external, openRoad)).toBe(
      "install-1|jira:issue:open-123|acme|work-item|work-123"
    );
  });

  it("disconnects mappings without changing source object references", () => {
    const mapping = createMapping(
      "install-gh",
      {
        id: "42",
        provider: "github",
        type: "issue"
      },
      {
        id: "req-42",
        type: "request",
        workspaceId: "acme"
      },
      "2026-07-04T00:00:00.000Z"
    );

    const disconnected = disconnectMapping(mapping, "2026-07-04T01:00:00.000Z");

    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.external).toEqual(mapping.external);
    expect(disconnected.openRoad).toEqual(mapping.openRoad);
  });

  it("retries transient and rate-limited sync results only", () => {
    const retryable: SyncResult[] = [
      { kind: "retryable-error", message: "Provider unavailable." },
      { kind: "rate-limited", retryAfterSeconds: 60 }
    ];
    const terminal: SyncResult[] = [
      { kind: "success" },
      { kind: "noop" },
      { kind: "conflict" },
      { kind: "fatal-error", message: "Invalid field mapping." }
    ];

    expect(retryable.every(shouldRetrySync)).toBe(true);
    expect(terminal.some(shouldRetrySync)).toBe(false);
  });

  it("validates provider fixtures for GitHub, Linear, and Jira", () => {
    const fixtures = [
      createFixture("github", "issue", "GH-42"),
      createFixture("linear", "issue", "OPEN-42"),
      createFixture("jira", "issue", "OPEN-42")
    ];

    expect(fixtures.map(validateProviderFixture)).toHaveLength(3);
  });

  it("rejects fixtures that cross provider or workspace boundaries", () => {
    const fixture = createFixture("github", "issue", "GH-42");

    expect(() =>
      validateProviderFixture({
        ...fixture,
        external: { ...fixture.external, provider: "jira" }
      })
    ).toThrow("provider must match");
    expect(() =>
      validateProviderFixture({
        ...fixture,
        openRoad: { ...fixture.openRoad, workspaceId: "other" }
      })
    ).toThrow("workspace must match");
  });
});

function createFixture(
  provider: ProviderFixture["installation"]["provider"],
  type: ProviderFixture["external"]["type"],
  key: string
): ProviderFixture {
  return {
    external: {
      id: `${provider}-${key}`,
      key,
      provider,
      type,
      url: `https://example.com/${provider}/${key}`
    },
    fields: {
      status: "open",
      title: `${provider} issue`
    },
    installation: {
      createdAt: "2026-07-04T00:00:00.000Z",
      id: `${provider}-install`,
      permissions: ["read:external", "read:openroad", "write:openroad"],
      provider,
      providerAccountId: `${provider}-account`,
      providerAccountName: `${provider} workspace`,
      status: "active",
      workspaceId: "acme"
    },
    openRoad: {
      id: `${provider}-request`,
      type: "request",
      workspaceId: "acme"
    }
  };
}
