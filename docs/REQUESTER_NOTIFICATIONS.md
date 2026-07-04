# Requester Notifications

OpenRoad now includes a production-safe notification foundation: preferences plus a workspace outbox. It queues messages when request status changes or when linked work appears in a public changelog, but it does not send external email or provider messages yet.

## Implemented

- Workspace-level notification settings.
- Requester/request-level preferences for status and changelog updates.
- Outbox events stored in OpenRoad state.
- Status-change notifications for `Planned` and `Shipping soon`.
- Changelog-publish notifications when a changelog item transitions to `Ready` and `Public`.
- Quiet-window dedupe to avoid repeated events for the same request/status or request/changelog pair.
- Compact request inspector controls for the selected request.
- Schema migration from version `4` to version `5`.

## Privacy Boundary

Notification events are internal outbox records in this slice. They must not contain:

- Internal comments.
- Hidden portal comments.
- Private changelog notes.
- Integration tokens or provider secrets.
- Raw webhook payloads.

Public portal snapshots do not expose notification preferences or outbox events.

## Current Behavior

Status updates queue when:

- Workspace notifications are enabled.
- The selected request's status update preference is enabled.
- Status changes to `Planned` or `Shipping soon`.
- The same dedupe key has not been queued inside the quiet window.

Changelog updates queue when:

- Workspace notifications are enabled.
- The selected request's changelog update preference is enabled.
- A linked changelog item transitions from unpublished to `Ready` and `Public`.
- The same request/changelog pair has not been queued inside the quiet window.

## Deferred

- Email delivery.
- Slack, Discord, web push, SMS, or provider write-back delivery.
- Verified requester identity.
- Unsubscribe links and preference center.
- Background delivery workers.
- Delivery failure retry and bounce handling.
- Notification analytics.
