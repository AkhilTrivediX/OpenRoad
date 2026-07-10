import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { TeamAccountRecoverySummary } from "./team.js";

export type AccountRecoveryDeliveryContext = {
  baseUrl: string;
  deliveredAt: string;
  recoveryToken: string;
  workspaceId: string;
  workspaceName: string;
};

export type AccountRecoveryDeliveryAdapterResult = {
  messageId?: string;
};

export type AccountRecoveryDeliveryAdapter = {
  channel: string;
  deliver(
    recovery: TeamAccountRecoverySummary,
    context: AccountRecoveryDeliveryContext
  ): Promise<AccountRecoveryDeliveryAdapterResult>;
};

export type AccountRecoveryDeliveryAttemptSummary = {
  attemptedAt?: string;
  channel?: string;
  error?: string;
  messageId?: string;
  status: "failed" | "not_configured" | "sent";
};

export class JsonlAccountRecoveryDeliveryAdapter implements AccountRecoveryDeliveryAdapter {
  readonly channel = "jsonl-file";
  private readonly resolvedFilePath: string;

  constructor(filePath: string) {
    this.resolvedFilePath = resolve(filePath);
  }

  async deliver(
    recovery: TeamAccountRecoverySummary,
    context: AccountRecoveryDeliveryContext
  ): Promise<AccountRecoveryDeliveryAdapterResult> {
    await mkdir(dirname(this.resolvedFilePath), { recursive: true });
    const recoveryUrl = buildAccountRecoveryUrl(context.baseUrl, context.recoveryToken);
    const subject = `OpenRoad password reset for ${context.workspaceName}`;
    const body = [
      `A password reset was requested for ${recovery.email} in ${context.workspaceName}.`,
      `Open the reset link to set a new password: ${recoveryUrl}`,
      `This recovery link expires at ${recovery.expiresAt}.`
    ].join("\n\n");
    const record = {
      body,
      channel: this.channel,
      deliveredAt: context.deliveredAt,
      email: recovery.email,
      expiresAt: recovery.expiresAt,
      recoveryId: recovery.id,
      recoveryToken: context.recoveryToken,
      recoveryUrl,
      subject,
      userId: recovery.userId,
      workspaceId: context.workspaceId,
      workspaceName: context.workspaceName
    };

    await appendFile(this.resolvedFilePath, `${JSON.stringify(record)}\n`, "utf8");

    return {
      messageId: `jsonl:${recovery.id}:${context.deliveredAt}`
    };
  }
}

export function createAccountRecoveryDeliveryAdapterFromEnv(env = process.env) {
  const mode = normalizeEnvValue(env.OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE);
  if (!mode || mode === "disabled") return undefined;

  if (mode === "file") {
    const filePath = normalizeEnvValue(env.OPENROAD_ACCOUNT_RECOVERY_DELIVERY_FILE);
    return filePath ? new JsonlAccountRecoveryDeliveryAdapter(filePath) : undefined;
  }

  return undefined;
}

export function resolveAccountRecoveryPublicBaseUrl(env = process.env) {
  return (
    normalizePublicBaseUrl(normalizeEnvValue(env.OPENROAD_ACCOUNT_RECOVERY_PUBLIC_BASE_URL)) ??
    normalizePublicBaseUrl(normalizeEnvValue(env.OPENROAD_PUBLIC_APP_URL))
  );
}

export function buildAccountRecoveryUrl(baseUrl: string, recoveryToken: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("recovery", recoveryToken);
  return url.toString();
}

function normalizePublicBaseUrl(value: string | undefined) {
  if (!value) return undefined;

  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function normalizeEnvValue(value: string | undefined) {
  return value && value.trim() ? value.trim() : undefined;
}
