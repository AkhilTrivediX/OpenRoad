// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createSafeJiraOAuthSetup, decodeJiraOAuthState, jiraOAuthConfigFromEnv } from "./jira";

describe("Jira OAuth setup helpers", () => {
  it("creates safe OAuth setup output without leaking secrets", () => {
    const config = jiraOAuthConfigFromEnv({
      OPENROAD_JIRA_AUTH_BASE_URL: "https://auth.atlassian.test",
      OPENROAD_JIRA_CLIENT_ID: "jira-client",
      OPENROAD_JIRA_CLIENT_SECRET: "jira-secret",
      OPENROAD_JIRA_REDIRECT_URI: "https://openroad.test/api/jira/callback"
    });
    const setup = createSafeJiraOAuthSetup(
      config,
      "acme",
      new Date("2026-07-04T00:00:00.000Z"),
      { installationId: "jira-install-jira-cloud" }
    );
    const state = new URL(setup.authorizeUrl ?? "").searchParams.get("state");
    const text = JSON.stringify(setup);

    expect(config.clientSecret).toBe("jira-secret");
    expect(setup).toMatchObject({
      configured: true,
      missing: [],
      requiredScopes: ["read:jira-work", "read:jira-user", "write:jira-work"]
    });
    expect(setup.authorizeUrl).toContain("https://auth.atlassian.test/authorize");
    expect(setup.authorizeUrl).toContain("audience=api.atlassian.com");
    expect(setup.authorizeUrl).toContain("client_id=jira-client");
    expect(setup.authorizeUrl).toContain("response_type=code");
    expect(setup.authorizeUrl).toContain("prompt=consent");
    expect(new URL(setup.authorizeUrl ?? "").searchParams.get("scope")).toBe(
      "read:jira-work read:jira-user write:jira-work"
    );
    expect(decodeJiraOAuthState(state ?? "", config)).toMatchObject({
      createdAt: "2026-07-04T00:00:00.000Z",
      installationId: "jira-install-jira-cloud",
      provider: "jira",
      workspaceId: "acme"
    });
    expect(() => decodeJiraOAuthState(`${state ?? ""}x`, config)).toThrow("signature");
    expect(text).not.toContain("jira-secret");
  });

  it("reports missing setup keys without blocking standalone mode", () => {
    const setup = createSafeJiraOAuthSetup(jiraOAuthConfigFromEnv({}), "acme");

    expect(setup.configured).toBe(false);
    expect(setup.authorizeUrl).toBeUndefined();
    expect(setup.missing).toEqual([
      "OPENROAD_JIRA_CLIENT_ID",
      "OPENROAD_JIRA_CLIENT_SECRET",
      "OPENROAD_JIRA_REDIRECT_URI"
    ]);
  });
});
