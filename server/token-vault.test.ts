// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  IntegrationTokenVaultError,
  createIntegrationTokenVault
} from "./token-vault";

describe("OpenRoad integration token vault", () => {
  it("stays disabled until a long encryption key is configured", () => {
    expect(createIntegrationTokenVault({})).toMatchObject({
      status: "not_configured"
    });
    expect(createIntegrationTokenVault({ encryptionKey: "short" })).toMatchObject({
      status: "not_configured"
    });
  });

  it("seals and opens credential payloads without deterministic ciphertext", () => {
    const vault = createReadyVault();
    const first = vault.seal({
      accessToken: "github-access-token",
      refreshToken: "github-refresh-token"
    }, { associatedData: "credential:github:acme:1" });
    const second = vault.seal({
      accessToken: "github-access-token",
      refreshToken: "github-refresh-token"
    }, { associatedData: "credential:github:acme:1" });

    expect(first).toMatchObject({
      alg: "aes-256-gcm",
      keyId: "primary"
    });
    expect(first.ciphertext).not.toContain("github-access-token");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(vault.open(first, { associatedData: "credential:github:acme:1" })).toEqual({
      accessToken: "github-access-token",
      refreshToken: "github-refresh-token"
    });
    expect(() =>
      vault.open(first, { associatedData: "credential:github:other-workspace:1" })
    ).toThrow(IntegrationTokenVaultError);
  });

  it("rejects tampered encrypted credential payloads", () => {
    const vault = createReadyVault();
    const secret = vault.seal({ accessToken: "linear-access-token" });

    expect(() =>
      vault.open({
        ...secret,
        ciphertext: `${secret.ciphertext.slice(0, -2)}aa`
      })
    ).toThrow(IntegrationTokenVaultError);
  });
});

function createReadyVault() {
  const vault = createIntegrationTokenVault({
    encryptionKey: "0123456789abcdef0123456789abcdef",
    keyId: "primary"
  });

  if (vault.status !== "ready") {
    throw new Error("Expected token vault to be ready.");
  }

  return vault;
}
