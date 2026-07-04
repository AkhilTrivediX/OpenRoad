import { describe, expect, it } from "vitest";

import {
  assertMappingMatchesInstallation,
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
  it("creates stable external object and mapping keys from provider ids", () => {
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

    expect(createExternalObjectKey(external)).toBe("jira:issue:id=123");
    expect(createMappingKey(" install-1 ", external, openRoad)).toBe(
      "install-1|jira:issue:id=123|acme|work-item|work-123"
    );
  });

  it("does not let blank display keys or normalized key collisions change identity", () => {
    const keyless = {
      id: " repo one#42 ",
      key: "   ",
      provider: "github" as const,
      type: "issue" as const
    };
    const visuallySimilar = {
      id: " repo-one#42 ",
      key: "repo one#42",
      provider: "github" as const,
      type: "issue" as const
    };

    expect(createExternalObjectKey(keyless)).toBe("github:issue:id=repo%20one%2342");
    expect(createExternalObjectKey(visuallySimilar)).toBe("github:issue:id=repo-one%2342");
    expect(createExternalObjectKey(keyless)).not.toBe(createExternalObjectKey(visuallySimilar));
  });

  it("rejects external refs without provider ids", () => {
    expect(() =>
      createExternalObjectKey({
        id: "   ",
        key: "GH-42",
        provider: "github",
        type: "issue"
      })
    ).toThrow("external object id is required");
  });

  it("disconnects mappings without changing source object references", () => {
    const fixture = createFixture("github", "issue", "GH-42");
    const mapping = createMapping(
      fixture.installation,
      fixture.external,
      fixture.openRoad,
      "2026-07-04T00:00:00.000Z"
    );

    const disconnected = disconnectMapping(mapping, "2026-07-04T01:00:00.000Z");

    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.external).toEqual(mapping.external);
    expect(disconnected.openRoad).toEqual(mapping.openRoad);
  });

  it("creates mappings only when installation, provider, and workspace match", () => {
    const fixture = createFixture("github", "issue", "GH-42");
    const mapping = createMapping(
      fixture.installation,
      fixture.external,
      fixture.openRoad,
      "2026-07-04T00:00:00.000Z"
    );

    expect(assertMappingMatchesInstallation(fixture.installation, mapping)).toBe(mapping);
    expect(mapping.installationId).toBe("github-install");

    expect(() =>
      createMapping(
        { ...fixture.installation, provider: "jira" },
        fixture.external,
        fixture.openRoad,
        "2026-07-04T00:00:00.000Z"
      )
    ).toThrow("provider must match");
    expect(() =>
      createMapping(
        { ...fixture.installation, workspaceId: "other" },
        fixture.external,
        fixture.openRoad,
        "2026-07-04T00:00:00.000Z"
      )
    ).toThrow("workspace must match");
    expect(() =>
      createMapping(
        { ...fixture.installation, status: "disconnected" },
        fixture.external,
        fixture.openRoad,
        "2026-07-04T00:00:00.000Z"
      )
    ).toThrow("must be active");
  });

  it("rejects mappings that no longer match their installation", () => {
    const fixture = createFixture("github", "issue", "GH-42");
    const mapping = createMapping(
      fixture.installation,
      fixture.external,
      fixture.openRoad,
      "2026-07-04T00:00:00.000Z"
    );

    expect(() =>
      assertMappingMatchesInstallation(
        { ...fixture.installation, id: "other-install" },
        mapping
      )
    ).toThrow("installation id must match");
    expect(() =>
      assertMappingMatchesInstallation(
        { ...fixture.installation, provider: "jira" },
        mapping
      )
    ).toThrow("provider must match");
    expect(() =>
      assertMappingMatchesInstallation(
        { ...fixture.installation, workspaceId: "other" },
        mapping
      )
    ).toThrow("workspace must match");
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
