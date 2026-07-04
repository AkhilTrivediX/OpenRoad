// @vitest-environment node

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
  JsonlNotificationDeliveryAdapter,
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
