import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { WorkspaceRole } from "./access.js";
import type { TeamInvitationSummary } from "./team.js";

export type InvitationDeliveryContext = {
  acceptToken: string;
  baseUrl: string;
  deliveredAt: string;
  workspaceId: string;
  workspaceName: string;
};

export type InvitationDeliveryAdapterResult = {
  messageId?: string;
};

export type InvitationDeliveryAdapter = {
  channel: string;
  deliver(
    invitation: TeamInvitationSummary,
    context: InvitationDeliveryContext
  ): Promise<InvitationDeliveryAdapterResult>;
};

export type InvitationDeliveryAttemptSummary = {
  acceptUrl?: string;
  attemptedAt?: string;
  channel?: string;
  error?: string;
  messageId?: string;
  status: "failed" | "not_configured" | "sent";
};

export class JsonlInvitationDeliveryAdapter implements InvitationDeliveryAdapter {
  readonly channel = "jsonl-file";
  private readonly resolvedFilePath: string;

  constructor(filePath: string) {
    this.resolvedFilePath = resolve(filePath);
  }

  async deliver(
    invitation: TeamInvitationSummary,
    context: InvitationDeliveryContext
  ): Promise<InvitationDeliveryAdapterResult> {
    await mkdir(dirname(this.resolvedFilePath), { recursive: true });
    const acceptUrl = buildInvitationAcceptUrl(context.baseUrl, context.acceptToken);
    const subject = `OpenRoad invitation to ${context.workspaceName}`;
    const body = [
      `You have been invited to ${context.workspaceName} in OpenRoad as ${invitation.role}.`,
      `Open the invitation link to join: ${acceptUrl}`,
      `This invitation expires at ${invitation.expiresAt}.`
    ].join("\n\n");
    const record = {
      acceptToken: context.acceptToken,
      acceptUrl,
      body,
      channel: this.channel,
      deliveredAt: context.deliveredAt,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      invitationId: invitation.id,
      ...(invitation.invitedName ? { invitedName: invitation.invitedName } : {}),
      role: invitation.role satisfies WorkspaceRole,
      subject,
      workspaceId: context.workspaceId,
      workspaceName: context.workspaceName
    };

    await appendFile(this.resolvedFilePath, `${JSON.stringify(record)}\n`, "utf8");

    return {
      messageId: `jsonl:${invitation.id}:${context.deliveredAt}`
    };
  }
}

export function createInvitationDeliveryAdapterFromEnv(env = process.env) {
  const mode = normalizeEnvValue(env.OPENROAD_INVITATION_DELIVERY_MODE);
  if (!mode || mode === "disabled") return undefined;

  if (mode === "file") {
    const filePath = normalizeEnvValue(env.OPENROAD_INVITATION_DELIVERY_FILE);
    return filePath ? new JsonlInvitationDeliveryAdapter(filePath) : undefined;
  }

  return undefined;
}

export function resolveInvitationDeliveryPublicBaseUrl(env = process.env) {
  return (
    normalizePublicBaseUrl(normalizeEnvValue(env.OPENROAD_PUBLIC_APP_URL)) ??
    normalizePublicBaseUrl(normalizeEnvValue(env.OPENROAD_INVITATION_PUBLIC_BASE_URL))
  );
}

export function buildInvitationAcceptUrl(baseUrl: string, acceptToken: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("invite", acceptToken);
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
