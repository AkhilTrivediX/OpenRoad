import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  OpenRoadState,
  RequesterNotificationEvent,
  Workspace
} from "../src/domain/openroad.js";

const MAX_PROVIDER_RESPONSE_BYTES = 32_768;

export type NotificationDeliveryContext = {
  now: string;
  workspaceId: string;
  workspaceName: string;
};

export type NotificationDeliveryAdapterResult = {
  messageId?: string;
};

export type NotificationDeliveryAdapter = {
  channel: string;
  deliver(
    event: RequesterNotificationEvent,
    context: NotificationDeliveryContext
  ): Promise<NotificationDeliveryAdapterResult>;
};

export type NotificationDeliveryBatchOptions = {
  limit?: number;
  now?: string;
  workspaceId?: string;
};

export type NotificationDeliveryBatchResult = {
  attempted: number;
  changed: boolean;
  delivered: number;
  failed: number;
  remainingQueued: number;
  skipped: number;
  state: OpenRoadState;
};

export type NotificationDeliveryRunner = <T>(task: () => Promise<T>) => Promise<T>;

export class JsonlNotificationDeliveryAdapter implements NotificationDeliveryAdapter {
  readonly channel = "jsonl-file";
  private readonly resolvedFilePath: string;

  constructor(filePath: string) {
    this.resolvedFilePath = resolve(filePath);
  }

  async deliver(
    event: RequesterNotificationEvent,
    context: NotificationDeliveryContext
  ): Promise<NotificationDeliveryAdapterResult> {
    await mkdir(dirname(this.resolvedFilePath), { recursive: true });
    const record = {
      body: event.body,
      channel: this.channel,
      changelogId: event.changelogId,
      changelogTitle: event.changelogTitle,
      createdAt: event.createdAt,
      deliveredAt: context.now,
      dedupeKey: event.dedupeKey,
      eventId: event.id,
      requestId: event.requestId,
      requestTitle: event.requestTitle,
      requester: event.requester,
      title: event.title,
      type: event.type,
      workspaceId: context.workspaceId,
      workspaceName: context.workspaceName
    };

    await appendFile(this.resolvedFilePath, `${JSON.stringify(record)}\n`, "utf8");

    return {
      messageId: `jsonl:${event.id}:${context.now}`
    };
  }
}

export class HttpNotificationDeliveryAdapter implements NotificationDeliveryAdapter {
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
      throw new Error("Notification HTTP provider URL must be HTTPS, except localhost or loopback.");
    }

    this.bearerToken = normalizeEnvValue(options.bearerToken);
    this.endpoint = normalized;
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  }

  async deliver(
    event: RequesterNotificationEvent,
    context: NotificationDeliveryContext
  ): Promise<NotificationDeliveryAdapterResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        body: JSON.stringify({
          body: event.body,
          channel: this.channel,
          changelogId: event.changelogId,
          changelogTitle: event.changelogTitle,
          createdAt: event.createdAt,
          deliveredAt: context.now,
          dedupeKey: event.dedupeKey,
          eventId: event.id,
          requestId: event.requestId,
          requestTitle: event.requestTitle,
          requester: event.requester,
          title: event.title,
          type: event.type,
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
          `Notification provider responded ${response.status}: ${redactDeliverySecretText(responseText)}`
        );
      }

      return {
        messageId: readProviderMessageId(responseText, response.headers)
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error("Notification provider delivery timed out.");
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

export function createNotificationDeliveryAdapterFromEnv(env = process.env) {
  const mode = normalizeEnvValue(env.OPENROAD_NOTIFICATION_DELIVERY_MODE);
  if (!mode || mode === "disabled") return undefined;

  if (mode === "file") {
    const filePath = normalizeEnvValue(env.OPENROAD_NOTIFICATION_DELIVERY_FILE);
    return filePath ? new JsonlNotificationDeliveryAdapter(filePath) : undefined;
  }

  if (mode === "http") {
    const endpoint = normalizeEnvValue(env.OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL);
    if (!endpoint || !normalizeHttpProviderUrl(endpoint)) return undefined;

    return new HttpNotificationDeliveryAdapter(endpoint, {
      bearerToken: env.OPENROAD_NOTIFICATION_DELIVERY_HTTP_BEARER_TOKEN,
      timeoutMs: getPositiveInteger(env.OPENROAD_NOTIFICATION_DELIVERY_HTTP_TIMEOUT_MS, 10_000)
    });
  }

  return undefined;
}

export async function deliverRequesterNotifications(
  state: OpenRoadState,
  adapter: NotificationDeliveryAdapter,
  options: NotificationDeliveryBatchOptions = {}
): Promise<NotificationDeliveryBatchResult> {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(0, Math.min(500, Math.round(options.limit ?? 100)));
  let attempted = 0;
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  let changed = false;

  const workspaces = [];

  for (const workspace of state.workspaces) {
    if (options.workspaceId && workspace.id !== options.workspaceId) {
      workspaces.push(workspace);
      continue;
    }

    const processed = await deliverWorkspaceNotifications(workspace, adapter, {
      limit,
      now,
      onAttempt() {
        attempted += 1;
      },
      onDelivered() {
        delivered += 1;
      },
      onFailed() {
        failed += 1;
      },
      onSkipped() {
        skipped += 1;
      },
      remainingAttempts() {
        return Math.max(0, limit - attempted);
      }
    });

    changed = changed || processed.changed;
    workspaces.push(processed.workspace);
  }

  const nextState = changed ? { ...state, workspaces } : state;

  return {
    attempted,
    changed,
    delivered,
    failed,
    remainingQueued: countQueuedNotificationEvents(nextState, options.workspaceId),
    skipped,
    state: nextState
  };
}

async function deliverWorkspaceNotifications(
  workspace: Workspace,
  adapter: NotificationDeliveryAdapter,
  options: {
    limit: number;
    now: string;
    onAttempt(): void;
    onDelivered(): void;
    onFailed(): void;
    onSkipped(): void;
    remainingAttempts(): number;
  }
) {
  let changed = false;
  const outbox: RequesterNotificationEvent[] = [];

  for (const event of workspace.notifications.outbox) {
    if (event.status !== "queued") {
      options.onSkipped();
      outbox.push(event);
      continue;
    }

    if (options.remainingAttempts() <= 0) {
      options.onSkipped();
      outbox.push(event);
      continue;
    }

    options.onAttempt();

    try {
      const result = await adapter.deliver(event, {
        now: options.now,
        workspaceId: workspace.id,
        workspaceName: workspace.name
      });
      options.onDelivered();
      changed = true;
      outbox.push({
        ...event,
        deliveredAt: options.now,
        deliveryAttempts: event.deliveryAttempts + 1,
        deliveryChannel: adapter.channel,
        deliveryError: undefined,
        deliveryMessageId: boundText(result.messageId, 240),
        lastDeliveryAttemptAt: options.now,
        status: "delivered"
      });
    } catch (error) {
      options.onFailed();
      changed = true;
      outbox.push({
        ...event,
        deliveryAttempts: event.deliveryAttempts + 1,
        deliveryChannel: adapter.channel,
        deliveryError: boundText(error instanceof Error ? error.message : String(error), 240),
        lastDeliveryAttemptAt: options.now,
        status: "queued"
      });
    }
  }

  return {
    changed,
    workspace: changed
      ? {
          ...workspace,
          notifications: {
            ...workspace.notifications,
            outbox
          }
        }
      : workspace
  };
}

export function mergeNotificationDeliveryState(
  latestState: OpenRoadState,
  deliveryState: OpenRoadState
): OpenRoadState {
  const deliveryWorkspaces = new Map(deliveryState.workspaces.map((workspace) => [workspace.id, workspace]));
  let stateChanged = false;
  const workspaces = latestState.workspaces.map((workspace) => {
    const deliveryWorkspace = deliveryWorkspaces.get(workspace.id);
    if (!deliveryWorkspace) return workspace;
    let workspaceChanged = false;

    const deliveredEvents = new Map(
      deliveryWorkspace.notifications.outbox.map((event) => [event.id, event])
    );
    const outbox = workspace.notifications.outbox.map((event) => {
      const deliveredEvent = deliveredEvents.get(event.id);
      if (!deliveredEvent || deliveredEvent.deliveryAttempts < event.deliveryAttempts) {
        return event;
      }

      const nextEvent = {
        ...event,
        deliveredAt: deliveredEvent.deliveredAt,
        deliveryAttempts: deliveredEvent.deliveryAttempts,
        deliveryChannel: deliveredEvent.deliveryChannel,
        deliveryError: deliveredEvent.deliveryError,
        deliveryMessageId: deliveredEvent.deliveryMessageId,
        lastDeliveryAttemptAt: deliveredEvent.lastDeliveryAttemptAt,
        status: deliveredEvent.status
      };
      workspaceChanged = workspaceChanged || notificationDeliveryFieldsChanged(event, nextEvent);
      return nextEvent;
    });

    if (!workspaceChanged) return workspace;
    stateChanged = true;
    return {
      ...workspace,
      notifications: {
        ...workspace.notifications,
        outbox
      }
    };
  });

  return stateChanged ? { ...latestState, workspaces } : latestState;
}

function notificationDeliveryFieldsChanged(
  previous: RequesterNotificationEvent,
  next: RequesterNotificationEvent
) {
  return (
    previous.deliveredAt !== next.deliveredAt ||
    previous.deliveryAttempts !== next.deliveryAttempts ||
    previous.deliveryChannel !== next.deliveryChannel ||
    previous.deliveryError !== next.deliveryError ||
    previous.deliveryMessageId !== next.deliveryMessageId ||
    previous.lastDeliveryAttemptAt !== next.lastDeliveryAttemptAt ||
    previous.status !== next.status
  );
}

export function createExclusiveRunner(): NotificationDeliveryRunner {
  let tail = Promise.resolve();

  return (task) => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

function countQueuedNotificationEvents(state: OpenRoadState, workspaceId?: string) {
  return state.workspaces.reduce((count, workspace) => {
    if (workspaceId && workspace.id !== workspaceId) return count;
    return count + workspace.notifications.outbox.filter((event) => event.status === "queued").length;
  }, 0);
}

function boundText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
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
      throw new Error("Notification provider returned an invalid success response.");
    }

    return (
      sanitizeProviderMessageId(payload.messageId) ??
      sanitizeProviderMessageId(payload.message_id) ??
      sanitizeProviderMessageId(payload.id)
    );
  } catch {
    throw new Error("Notification provider returned a non-JSON success response.");
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
      /([?&](?:access_token|refresh_token|invite|token|jwt|secret|client_secret|authorization)=)[^&\s]+/gi,
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

function normalizeEnvValue(value: string | undefined) {
  return value && value.trim() ? value.trim() : undefined;
}
