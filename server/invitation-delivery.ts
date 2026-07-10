import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { WorkspaceRole } from "./access.js";
import type { TeamInvitationSummary } from "./team.js";

const MAX_PROVIDER_RESPONSE_BYTES = 32_768;

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

export class HttpInvitationDeliveryAdapter implements InvitationDeliveryAdapter {
  readonly channel = "http-provider";
  private readonly bearerToken?: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    endpoint: string,
    options: { bearerToken?: string; timeoutMs?: number } = {}
  ) {
    const normalized = normalizeHttpProviderUrl(endpoint);
    if (!normalized) {
      throw new Error("Invitation HTTP provider URL must be HTTPS, except localhost or loopback.");
    }

    this.bearerToken = normalizeEnvValue(options.bearerToken);
    this.endpoint = normalized;
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  }

  async deliver(
    invitation: TeamInvitationSummary,
    context: InvitationDeliveryContext
  ): Promise<InvitationDeliveryAdapterResult> {
    const acceptUrl = buildInvitationAcceptUrl(context.baseUrl, context.acceptToken);
    const subject = `OpenRoad invitation to ${context.workspaceName}`;
    const body = [
      `You have been invited to ${context.workspaceName} in OpenRoad as ${invitation.role}.`,
      `Open the invitation link to join: ${acceptUrl}`,
      `This invitation expires at ${invitation.expiresAt}.`
    ].join("\n\n");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        body: JSON.stringify({
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
        }),
        headers: {
          Accept: "application/json",
          ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
          "Content-Type": "application/json"
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal
      });
      const responseText = await readBoundedResponseText(response, MAX_PROVIDER_RESPONSE_BYTES);

      if (!response.ok) {
        throw new Error(
          `Invitation provider responded ${response.status}: ${redactDeliverySecretText(responseText)}`
        );
      }

      return {
        messageId: readProviderMessageId(responseText, response.headers)
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error("Invitation provider delivery timed out.");
      }

      if (error instanceof Error) {
        throw new Error(redactDeliverySecretText(error.message));
      }

      throw new Error(redactDeliverySecretText(String(error)));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createInvitationDeliveryAdapterFromEnv(env = process.env) {
  const mode = normalizeEnvValue(env.OPENROAD_INVITATION_DELIVERY_MODE);
  if (!mode || mode === "disabled") return undefined;

  if (mode === "file") {
    const filePath = normalizeEnvValue(env.OPENROAD_INVITATION_DELIVERY_FILE);
    return filePath ? new JsonlInvitationDeliveryAdapter(filePath) : undefined;
  }

  if (mode === "http") {
    const endpoint = normalizeEnvValue(env.OPENROAD_INVITATION_DELIVERY_HTTP_URL);
    if (!endpoint || !normalizeHttpProviderUrl(endpoint)) return undefined;

    return new HttpInvitationDeliveryAdapter(endpoint, {
      bearerToken: env.OPENROAD_INVITATION_DELIVERY_HTTP_BEARER_TOKEN,
      timeoutMs: getPositiveInteger(env.OPENROAD_INVITATION_DELIVERY_HTTP_TIMEOUT_MS, 10_000)
    });
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

function normalizeHttpProviderUrl(value: string | undefined) {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol !== "http:") return undefined;

    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      return url.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function normalizeTimeoutMs(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return 10_000;
  return Math.max(500, Math.min(60_000, Math.round(value)));
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readProviderMessageId(responseText: string, headers: Headers) {
  const headerMessageId = sanitizeProviderMessageId(headers.get("x-message-id"));
  if (headerMessageId) return headerMessageId;

  if (!responseText.trim()) return undefined;

  try {
    const payload = JSON.parse(responseText) as unknown;
    if (!isRecord(payload)) {
      throw new Error("Invitation provider returned an invalid success response.");
    }

    return (
      sanitizeProviderMessageId(payload.messageId) ??
      sanitizeProviderMessageId(payload.message_id) ??
      sanitizeProviderMessageId(payload.id)
    );
  } catch {
    throw new Error("Invitation provider returned a non-JSON success response.");
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const value = result.value;
    const remaining = maxBytes - bytesRead;

    if (value.byteLength > remaining) {
      text += decoder.decode(value.slice(0, Math.max(0, remaining)), { stream: true });
      await reader.cancel();
      return `${text}${decoder.decode()} [truncated]`;
    }

    bytesRead += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }

  return `${text}${decoder.decode()}`;
}

function sanitizeProviderMessageId(value: unknown) {
  const bounded = boundText(value, 500);
  if (!bounded) return undefined;
  const redacted = redactDeliverySecretText(bounded);
  if (redacted !== bounded) return "[redacted]";
  return boundText(redacted, 240);
}

function redactDeliverySecretText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:accept_token|access_token|refresh_token|invite|token|jwt|secret|client_secret|authorization)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /((?:accept[_-]?token|access[_-]?token|refresh[_-]?token|invite|token|secret|client[_-]?secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .replace(/\b[\w.-]*(?:token|secret|password|credential|authorization)[\w.-]*\b/gi, "[redacted]")
    .slice(0, 500);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeEnvValue(value: string | undefined) {
  return value && value.trim() ? value.trim() : undefined;
}
