// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createSafeLinearOAuthSetup, decodeLinearOAuthState, linearOAuthConfigFromEnv } from "./linear";

describe("Linear OAuth setup helpers", () => {
  it("creates safe OAuth setup output without leaking secrets", () => {
    const config = linearOAuthConfigFromEnv({
      OPENROAD_LINEAR_CLIENT_ID: "lin_client",
      OPENROAD_LINEAR_CLIENT_SECRET: "linear-secret",
      OPENROAD_LINEAR_REDIRECT_URI: "https://openroad.test/api/linear/callback"
    });
    const setup = createSafeLinearOAuthSetup(
      config,
      "acme",
      new Date("2026-07-04T00:00:00.000Z"),
      { installationId: "linear-install" }
    );
    const state = new URL(setup.authorizeUrl ?? "").searchParams.get("state");
    const text = JSON.stringify(setup);

    expect(config.clientSecret).toBe("linear-secret");
    expect(setup).toMatchObject({
      configured: true,
      missing: [],
      requiredScopes: ["read"]
    });
    expect(setup.authorizeUrl).toContain("https://linear.app/oauth/authorize");
    expect(setup.authorizeUrl).toContain("client_id=lin_client");
    expect(setup.authorizeUrl).toContain("response_type=code");
    expect(setup.authorizeUrl).toContain("scope=read");
    expect(decodeLinearOAuthState(state ?? "", config)).toMatchObject({
      createdAt: "2026-07-04T00:00:00.000Z",
      installationId: "linear-install",
      provider: "linear",
      workspaceId: "acme"
    });
    expect(() => decodeLinearOAuthState(`${state ?? ""}x`, config)).toThrow("signature");
    expect(text).not.toContain("linear-secret");
  });

  it("reports missing setup keys without blocking standalone mode", () => {
    const setup = createSafeLinearOAuthSetup(linearOAuthConfigFromEnv({}), "acme");

    expect(setup.configured).toBe(false);
    expect(setup.authorizeUrl).toBeUndefined();
    expect(setup.missing).toEqual([
      "OPENROAD_LINEAR_CLIENT_ID",
      "OPENROAD_LINEAR_CLIENT_SECRET",
      "OPENROAD_LINEAR_REDIRECT_URI"
    ]);
  });
});
