import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { EncryptedIntegrationCredentialSecret } from "./integrations.js";

export type IntegrationCredentialSecretPayload = {
  accessToken: string;
  refreshToken?: string;
};

export type IntegrationTokenVaultReady = {
  keyId?: string;
  open(
    secret: EncryptedIntegrationCredentialSecret,
    options?: IntegrationTokenVaultCryptoOptions
  ): IntegrationCredentialSecretPayload;
  seal(
    payload: IntegrationCredentialSecretPayload,
    options?: IntegrationTokenVaultCryptoOptions
  ): EncryptedIntegrationCredentialSecret;
  status: "ready";
};

export type IntegrationTokenVaultUnavailable = {
  reason: string;
  status: "not_configured";
};

export type IntegrationTokenVault = IntegrationTokenVaultReady | IntegrationTokenVaultUnavailable;

export type IntegrationTokenVaultCryptoOptions = {
  associatedData?: string;
};

export class IntegrationTokenVaultError extends Error {
  code: "invalid_secret";

  constructor(message: string) {
    super(message);
    this.code = "invalid_secret";
  }
}

const algorithm = "aes-256-gcm";
const minimumEncryptionKeyLength = 32;

export function createIntegrationTokenVaultFromEnv(env = process.env): IntegrationTokenVault {
  return createIntegrationTokenVault({
    encryptionKey: env.OPENROAD_TOKEN_ENCRYPTION_KEY,
    keyId: env.OPENROAD_TOKEN_ENCRYPTION_KEY_ID
  });
}

export function createIntegrationTokenVault({
  encryptionKey,
  keyId
}: {
  encryptionKey?: string;
  keyId?: string;
}): IntegrationTokenVault {
  const normalizedKey = encryptionKey?.trim();

  if (!normalizedKey) {
    return {
      reason: "OPENROAD_TOKEN_ENCRYPTION_KEY is not configured.",
      status: "not_configured"
    };
  }

  if (normalizedKey.length < minimumEncryptionKeyLength) {
    return {
      reason: "OPENROAD_TOKEN_ENCRYPTION_KEY must be at least 32 characters.",
      status: "not_configured"
    };
  }

  const key = createHash("sha256").update(normalizedKey, "utf8").digest();
  const normalizedKeyId = normalizeOptionalText(keyId, 80);

  return {
    ...(normalizedKeyId ? { keyId: normalizedKeyId } : {}),
    open(secret, options = {}) {
      if (secret.alg !== algorithm) {
        throw new IntegrationTokenVaultError("Integration credential secret uses an unsupported algorithm.");
      }

      try {
        const decipher = createDecipheriv(algorithm, key, Buffer.from(secret.iv, "base64"));
        const associatedData = normalizeAssociatedData(options.associatedData);
        if (associatedData) {
          decipher.setAAD(Buffer.from(associatedData, "utf8"));
        }
        decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(secret.ciphertext, "base64")),
          decipher.final()
        ]).toString("utf8");

        return parseSecretPayload(JSON.parse(plaintext) as unknown);
      } catch (error) {
        if (error instanceof IntegrationTokenVaultError) throw error;
        throw new IntegrationTokenVaultError("Integration credential secret could not be decrypted.");
      }
    },
    seal(payload, options = {}) {
      const secretPayload = parseSecretPayload(payload);
      const iv = randomBytes(12);
      const cipher = createCipheriv(algorithm, key, iv);
      const associatedData = normalizeAssociatedData(options.associatedData);
      if (associatedData) {
        cipher.setAAD(Buffer.from(associatedData, "utf8"));
      }
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(secretPayload), "utf8"),
        cipher.final()
      ]);

      return {
        alg: algorithm,
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        ...(normalizedKeyId ? { keyId: normalizedKeyId } : {}),
        tag: cipher.getAuthTag().toString("base64")
      };
    },
    status: "ready"
  };
}

function parseSecretPayload(value: unknown): IntegrationCredentialSecretPayload {
  if (!isRecord(value)) {
    throw new IntegrationTokenVaultError("Integration credential secret payload is invalid.");
  }

  const accessToken = normalizeSecretText(value.accessToken);
  const refreshToken = normalizeSecretText(value.refreshToken);

  if (!accessToken) {
    throw new IntegrationTokenVaultError("Integration credential access token is required.");
  }

  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {})
  };
}

function normalizeSecretText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 20_000) {
    throw new IntegrationTokenVaultError("Integration credential secret value is too long.");
  }
  return normalized;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function normalizeAssociatedData(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 2000) {
    throw new IntegrationTokenVaultError("Integration credential associated data is too long.");
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
