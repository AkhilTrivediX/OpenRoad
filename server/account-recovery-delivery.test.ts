// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  JsonlAccountRecoveryDeliveryAdapter,
  buildAccountRecoveryUrl,
  createAccountRecoveryDeliveryAdapterFromEnv,
  resolveAccountRecoveryPublicBaseUrl
} from "./account-recovery-delivery";
import type { TeamAccountRecoverySummary } from "./team";

describe("account recovery delivery", () => {
  it("creates disabled and file adapters from environment", () => {
    const adapter = createAccountRecoveryDeliveryAdapterFromEnv({
      OPENROAD_ACCOUNT_RECOVERY_DELIVERY_FILE: "recoveries.jsonl",
      OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE: "file"
    });
    const disabled = createAccountRecoveryDeliveryAdapterFromEnv({
      OPENROAD_ACCOUNT_RECOVERY_DELIVERY_FILE: "recoveries.jsonl",
      OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE: "disabled"
    });
    const invalid = createAccountRecoveryDeliveryAdapterFromEnv({
      OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE: "smtp"
    });

    expect(adapter).toBeInstanceOf(JsonlAccountRecoveryDeliveryAdapter);
    expect(disabled).toBeUndefined();
    expect(invalid).toBeUndefined();
    expect(
      resolveAccountRecoveryPublicBaseUrl({
        OPENROAD_ACCOUNT_RECOVERY_PUBLIC_BASE_URL: "https://openroad.example.com/recover",
        OPENROAD_PUBLIC_APP_URL: "https://fallback.example.com/"
      })
    ).toBe("https://openroad.example.com/recover");
    expect(buildAccountRecoveryUrl("https://openroad.example.com/app", "orec_token")).toBe(
      "https://openroad.example.com/app?recovery=orec_token"
    );
  });

  it("writes sensitive JSONL account recovery handoff records", async () => {
    const filePath = await createTempDeliveryFile();
    const adapter = new JsonlAccountRecoveryDeliveryAdapter(filePath);

    const result = await adapter.deliver(createRecoverySummary(), {
      baseUrl: "https://openroad.example.com/app",
      deliveredAt: "2026-07-10T10:00:00.000Z",
      recoveryToken: "orec_secret-recovery-token",
      workspaceId: "acme",
      workspaceName: "Acme OSS"
    });
    const line = (await readFile(filePath, "utf8")).trim();
    const record = JSON.parse(line) as Record<string, unknown>;

    expect(result.messageId).toBe("jsonl:recovery-1:2026-07-10T10:00:00.000Z");
    expect(record).toMatchObject({
      channel: "jsonl-file",
      email: "teammate@example.com",
      recoveryId: "recovery-1",
      recoveryToken: "orec_secret-recovery-token",
      recoveryUrl: "https://openroad.example.com/app?recovery=orec_secret-recovery-token",
      subject: "OpenRoad password reset for Acme OSS",
      userId: "user-teammate@example.com",
      workspaceId: "acme",
      workspaceName: "Acme OSS"
    });
    expect(JSON.stringify(record)).not.toContain("tokenHash");
    expect(JSON.stringify(record)).not.toContain("passwordHash");
    expect(JSON.stringify(record)).not.toContain("session");
  });
});

function createRecoverySummary(
  overrides: Partial<TeamAccountRecoverySummary> = {}
): TeamAccountRecoverySummary {
  return {
    createdAt: "2026-07-10T09:55:00.000Z",
    email: "teammate@example.com",
    expiresAt: "2999-07-19T00:00:00.000Z",
    id: "recovery-1",
    status: "pending",
    userId: "user-teammate@example.com",
    workspaceId: "acme",
    ...overrides
  };
}

async function createTempDeliveryFile() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-account-recovery-delivery-"));
  return join(directory, "recoveries.jsonl");
}
