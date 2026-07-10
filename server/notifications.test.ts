// @vitest-environment node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createInitialOpenRoadState,
  openRoadReducer,
  type OpenRoadState,
  type RequesterNotificationEvent
} from "../src/domain/openroad";
import {
  HttpNotificationDeliveryAdapter,
  JsonlNotificationDeliveryAdapter,
  createNotificationDeliveryAdapterFromEnv,
  deliverRequesterNotifications,
  mergeNotificationDeliveryState,
  type NotificationDeliveryAdapter
} from "./notifications";

describe("requester notification delivery", () => {
  it("writes queued notifications to JSONL and marks them delivered", async () => {
    const state = createStateWithQueuedNotification();
    const deliveryFile = await createTempDeliveryFile();
    const adapter = new JsonlNotificationDeliveryAdapter(deliveryFile);

    const result = await deliverRequesterNotifications(state, adapter, {
      now: "2026-07-04T10:00:00.000Z"
    });
    const delivered = result.state.workspaces[0].notifications.outbox[0];
    const lines = (await readFile(deliveryFile, "utf8")).trim().split("\n");
    const record = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(result).toMatchObject({
      attempted: 1,
      delivered: 1,
      failed: 0,
      remainingQueued: 0
    });
    expect(delivered).toMatchObject({
      deliveredAt: "2026-07-04T10:00:00.000Z",
      deliveryAttempts: 1,
      deliveryChannel: "jsonl-file",
      status: "delivered"
    });
    expect(record).toMatchObject({
      body: "Dark mode for docs site moved from New to Planned.",
      eventId: delivered.id,
      requestId: "dark-mode-docs",
      type: "request-status-change",
      workspaceId: "acme"
    });
    expect(JSON.stringify(record)).not.toContain("privateNotes");
    expect(JSON.stringify(record)).not.toContain("Internal comment");
  });

  it("creates HTTP notification adapters from safe environment configuration", () => {
    const fileAdapter = createNotificationDeliveryAdapterFromEnv({
      OPENROAD_NOTIFICATION_DELIVERY_FILE: "notifications.jsonl",
      OPENROAD_NOTIFICATION_DELIVERY_MODE: "file"
    });
    const httpAdapter = createNotificationDeliveryAdapterFromEnv({
      OPENROAD_NOTIFICATION_DELIVERY_HTTP_BEARER_TOKEN: "provider-secret",
      OPENROAD_NOTIFICATION_DELIVERY_HTTP_TIMEOUT_MS: "2500",
      OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL: "http://127.0.0.1:43210/deliver",
      OPENROAD_NOTIFICATION_DELIVERY_MODE: "http"
    });
    const disabled = createNotificationDeliveryAdapterFromEnv({
      OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL: "https://notify.example.com/deliver",
      OPENROAD_NOTIFICATION_DELIVERY_MODE: "disabled"
    });
    const insecureHttp = createNotificationDeliveryAdapterFromEnv({
      OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL: "http://notify.example.com/deliver",
      OPENROAD_NOTIFICATION_DELIVERY_MODE: "http"
    });
    const credentialedHttp = createNotificationDeliveryAdapterFromEnv({
      OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL: "http://user:pass@127.0.0.1:43210/deliver",
      OPENROAD_NOTIFICATION_DELIVERY_MODE: "http"
    });
    const ipv6Loopback = createNotificationDeliveryAdapterFromEnv({
      OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL: "http://[::1]:43210/deliver",
      OPENROAD_NOTIFICATION_DELIVERY_MODE: "http"
    });
    const invalidMode = createNotificationDeliveryAdapterFromEnv({
      OPENROAD_NOTIFICATION_DELIVERY_FILE: "notifications.jsonl",
      OPENROAD_NOTIFICATION_DELIVERY_MODE: "smtp"
    });

    expect(fileAdapter).toBeInstanceOf(JsonlNotificationDeliveryAdapter);
    expect(httpAdapter).toBeInstanceOf(HttpNotificationDeliveryAdapter);
    expect(disabled).toBeUndefined();
    expect(insecureHttp).toBeUndefined();
    expect(credentialedHttp).toBeUndefined();
    expect(ipv6Loopback).toBeInstanceOf(HttpNotificationDeliveryAdapter);
    expect(invalidMode).toBeUndefined();
  });

  it("posts public-safe notification payloads to an HTTP provider with server-only bearer auth", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: IncomingMessage["headers"] }> = [];
    const provider = await createProviderServer(async (request, response) => {
      const body = await readRequestJson(request);
      received.push({ body, headers: request.headers });
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message_id: "provider-notification-1" }));
    });
    const adapter = new HttpNotificationDeliveryAdapter(provider.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });
    const state = createStateWithQueuedNotification();

    try {
      const result = await deliverRequesterNotifications(state, adapter, {
        now: "2026-07-04T10:00:00.000Z"
      });
      const delivered = result.state.workspaces[0].notifications.outbox[0];

      expect(result).toMatchObject({
        attempted: 1,
        delivered: 1,
        failed: 0,
        remainingQueued: 0
      });
      expect(delivered).toMatchObject({
        deliveryAttempts: 1,
        deliveryChannel: "http-provider",
        deliveryMessageId: "provider-notification-1",
        status: "delivered"
      });
      expect(received).toHaveLength(1);
      expect(received[0].headers.authorization).toBe("Bearer provider-secret-token");
      expect(received[0].body).toMatchObject({
        body: "Dark mode for docs site moved from New to Planned.",
        channel: "http-provider",
        eventId: delivered.id,
        requestId: "dark-mode-docs",
        requestTitle: "Dark mode for docs site",
        requester: "Docs feedback",
        title: "Planned: Dark mode for docs site",
        type: "request-status-change",
        workspaceId: "acme",
        workspaceName: "Acme OSS"
      });
      expect(JSON.stringify(received[0].body)).not.toContain("provider-secret-token");
      expect(JSON.stringify(received[0].body)).not.toContain("deliveryAttempts");
      expect(JSON.stringify(received[0].body)).not.toContain("deliveryError");
      expect(JSON.stringify(received[0].body)).not.toContain("preferences");
      expect(JSON.stringify(received[0].body)).not.toContain("privateNotes");
      expect(JSON.stringify(received[0].body)).not.toContain("Internal comment");
    } finally {
      await provider.close();
    }
  });

  it("sanitizes HTTP provider message ids before delivery metadata is persisted", async () => {
    const cases: Array<{ body?: Record<string, unknown>; header?: string }> = [
      { body: { messageId: "Bearer provider-secret-token" } },
      { body: { message_id: "https://notify.example.com/deliver?token=provider-secret-token" } },
      { body: { id: "password=raw-password" } },
      { body: {}, header: "authorization=provider-secret-token" }
    ];

    for (const item of cases) {
      const provider = await createProviderServer(async (_request, response) => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          ...(item.header ? { "x-message-id": item.header } : {})
        });
        response.end(JSON.stringify(item.body ?? {}));
      });
      const adapter = new HttpNotificationDeliveryAdapter(provider.url);

      try {
        const result = await adapter.deliver(createQueuedEvent("event-1", "dark-mode-docs"), {
          now: "2026-07-04T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        });

        expect(result.messageId).toBe("[redacted]");
      } finally {
        await provider.close();
      }
    }
  });

  it("redacts HTTP provider failures before they can be persisted", async () => {
    const provider = await createProviderServer(async (_request, response) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(
        "failed url=https://notify.example.com/deliver?token=provider-secret-token Bearer provider-secret-token password=raw-password"
      );
    });
    const adapter = new HttpNotificationDeliveryAdapter(provider.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });
    const state = createStateWithQueuedNotification();

    try {
      const result = await deliverRequesterNotifications(state, adapter, {
        now: "2026-07-04T10:00:00.000Z"
      });
      const failed = result.state.workspaces[0].notifications.outbox[0];

      expect(result).toMatchObject({
        attempted: 1,
        delivered: 0,
        failed: 1,
        remainingQueued: 1
      });
      expect(failed).toMatchObject({
        deliveryAttempts: 1,
        deliveryChannel: "http-provider",
        status: "queued"
      });
      expect(failed.deliveryError).toContain("Notification provider responded 500");
      expect(failed.deliveryError).toContain("[redacted]");
      expect(failed.deliveryError).not.toContain("provider-secret-token");
      expect(failed.deliveryError).not.toContain("raw-password");
    } finally {
      await provider.close();
    }
  });

  it("blocks HTTP provider redirects so payloads and bearer auth are not resent", async () => {
    let redirectedRequests = 0;
    const redirectTarget = await createProviderServer((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ messageId: "redirected" }));
    });
    const redirector = await createProviderServer((_request, response) => {
      response.writeHead(307, { Location: redirectTarget.url });
      response.end();
    });
    const adapter = new HttpNotificationDeliveryAdapter(redirector.url, {
      bearerToken: "provider-secret-token",
      timeoutMs: 2_500
    });

    try {
      await expect(
        adapter.deliver(createQueuedEvent("event-1", "dark-mode-docs"), {
          now: "2026-07-04T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        })
      ).rejects.toThrow();
      expect(redirectedRequests).toBe(0);
    } finally {
      await redirector.close();
      await redirectTarget.close();
    }
  });

  it("times out hanging HTTP provider requests with a safe error", async () => {
    const provider = await createProviderServer((_request, _response) => {
      // Keep the request open so the adapter's abort path is exercised.
    });
    const adapter = new HttpNotificationDeliveryAdapter(provider.url, { timeoutMs: 1 });

    try {
      await expect(
        adapter.deliver(createQueuedEvent("event-1", "dark-mode-docs"), {
          now: "2026-07-04T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        })
      ).rejects.toThrow("Notification provider delivery timed out.");
    } finally {
      await provider.close();
    }
  });

  it("fails malformed HTTP success bodies and bounds oversized provider errors", async () => {
    const invalidSuccess = await createProviderServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    });
    const hugeFailure = await createProviderServer((_request, response) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(`${"x".repeat(100_000)} password=raw-password`);
    });

    try {
      const invalidAdapter = new HttpNotificationDeliveryAdapter(invalidSuccess.url);
      await expect(
        invalidAdapter.deliver(createQueuedEvent("event-1", "dark-mode-docs"), {
          now: "2026-07-04T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        })
      ).rejects.toThrow("non-JSON success response");

      const failureAdapter = new HttpNotificationDeliveryAdapter(hugeFailure.url);
      let failureMessage = "";
      try {
        await failureAdapter.deliver(createQueuedEvent("event-1", "dark-mode-docs"), {
          now: "2026-07-04T10:00:00.000Z",
          workspaceId: "acme",
          workspaceName: "Acme OSS"
        });
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : String(error);
      }

      expect(failureMessage.length).toBeLessThanOrEqual(620);
      expect(failureMessage).not.toContain("raw-password");
    } finally {
      await invalidSuccess.close();
      await hugeFailure.close();
    }
  });

  it("does not redeliver events that are already delivered", async () => {
    const state = createStateWithQueuedNotification();
    const deliveryFile = await createTempDeliveryFile();
    const adapter = new JsonlNotificationDeliveryAdapter(deliveryFile);

    const first = await deliverRequesterNotifications(state, adapter, {
      now: "2026-07-04T10:00:00.000Z"
    });
    const second = await deliverRequesterNotifications(first.state, adapter, {
      now: "2026-07-04T10:01:00.000Z"
    });
    const lines = (await readFile(deliveryFile, "utf8")).trim().split("\n");

    expect(second).toMatchObject({
      attempted: 0,
      delivered: 0,
      skipped: 1
    });
    expect(lines).toHaveLength(1);
  });

  it("keeps adapter failures retryable without dropping the event", async () => {
    const state = createStateWithQueuedNotification();
    const failingAdapter: NotificationDeliveryAdapter = {
      channel: "test-failing",
      async deliver() {
        throw new Error("Mailbox provider refused the message because configuration is missing.");
      }
    };

    const result = await deliverRequesterNotifications(state, failingAdapter, {
      now: "2026-07-04T10:00:00.000Z"
    });
    const failed = result.state.workspaces[0].notifications.outbox[0];

    expect(result).toMatchObject({
      attempted: 1,
      delivered: 0,
      failed: 1,
      remainingQueued: 1
    });
    expect(failed).toMatchObject({
      deliveryAttempts: 1,
      deliveryChannel: "test-failing",
      lastDeliveryAttemptAt: "2026-07-04T10:00:00.000Z",
      status: "queued"
    });
    expect(failed.deliveryError).toContain("configuration is missing");
  });

  it("can limit delivery to one workspace", async () => {
    const state = createStateWithQueuedNotification();
    const secondWorkspace = {
      ...state.workspaces[1],
      notifications: {
        ...state.workspaces[1].notifications,
        outbox: [createQueuedEvent("maintainer-event", "contributor-guide-checklist")]
      }
    };
    const scopedState: OpenRoadState = {
      ...state,
      workspaces: [state.workspaces[0], secondWorkspace]
    };
    const deliveredIds: string[] = [];
    const adapter: NotificationDeliveryAdapter = {
      channel: "test",
      async deliver(event) {
        deliveredIds.push(event.id);
        return { messageId: `test:${event.id}` };
      }
    };

    const result = await deliverRequesterNotifications(scopedState, adapter, {
      now: "2026-07-04T10:00:00.000Z",
      workspaceId: "maintainer"
    });

    expect(deliveredIds).toEqual(["maintainer-event"]);
    expect(result.remainingQueued).toBe(0);
    expect(result.state.workspaces[0].notifications.outbox[0].status).toBe("queued");
    expect(result.state.workspaces[1].notifications.outbox[0].status).toBe("delivered");
  });

  it("merges delivery metadata into the latest state without clobbering newer edits", async () => {
    const state = createStateWithQueuedNotification();
    const adapter: NotificationDeliveryAdapter = {
      channel: "test",
      async deliver(event) {
        return { messageId: `test:${event.id}` };
      }
    };
    const delivery = await deliverRequesterNotifications(state, adapter, {
      now: "2026-07-04T10:00:00.000Z"
    });
    const latestState = {
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          requests: state.workspaces[0].requests.map((request) =>
            request.id === "dark-mode-docs" ? { ...request, title: "Newer title" } : request
          )
        },
        ...state.workspaces.slice(1)
      ]
    };

    const merged = mergeNotificationDeliveryState(latestState, delivery.state);

    expect(merged.workspaces[0].requests.find((request) => request.id === "dark-mode-docs")?.title).toBe(
      "Newer title"
    );
    expect(merged.workspaces[0].notifications.outbox[0]).toMatchObject({
      deliveryAttempts: 1,
      deliveryMessageId: expect.stringContaining("test:"),
      status: "delivered"
    });
  });
});

function createStateWithQueuedNotification() {
  const state = createInitialOpenRoadState();
  const workspace = state.workspaces[0];
  const request = workspace.requests.find((item) => item.id === "dark-mode-docs");
  if (!request) throw new Error("Fixture request missing.");

  return openRoadReducer(state, {
    request: {
      ...request,
      status: "Planned"
    },
    type: "replace-request",
    workspaceId: workspace.id
  });
}

function createQueuedEvent(id: string, requestId: string): RequesterNotificationEvent {
  return {
    body: "Public-safe notification body.",
    createdAt: "2026-07-04T00:00:00.000Z",
    dedupeKey: `request-status-change:${requestId}:Planned`,
    deliveryAttempts: 0,
    id,
    nextStatus: "Planned",
    previousStatus: "New",
    requestId,
    requestTitle: "Maintainer request",
    requester: "Maintainer",
    status: "queued",
    title: "Planned: Maintainer request",
    type: "request-status-change"
  };
}

async function createTempDeliveryFile() {
  const directory = await mkdtemp(join(tmpdir(), "openroad-notifications-"));
  return join(directory, "deliveries.jsonl");
}

async function createProviderServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse
  ) => Promise<void> | void
) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Provider server did not bind to a TCP address.");
  }

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: `http://127.0.0.1:${address.port}/deliver`
  };
}

async function readRequestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
