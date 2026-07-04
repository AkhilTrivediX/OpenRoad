# Requester Notifications

OpenRoad now includes a production-safe notification foundation: preferences, a workspace outbox, and an explicit server-side delivery handoff. It queues messages when request status changes or when linked work appears in a public changelog, and can hand those queued messages to a local JSONL file adapter without sending external email or provider messages itself.

## Implemented

- Workspace-level notification settings.
- Requester/request-level preferences for status and changelog updates.
- Outbox events stored in OpenRoad state.
- Status-change notifications for `Planned` and `Shipping soon`.
- Changelog-publish notifications when a changelog item transitions to `Ready` and `Public`.
- Quiet-window dedupe to avoid repeated events for the same request/status or request/changelog pair.
- Delivery status metadata for queued, delivered, failed, and held events.
- Private `POST /api/openroad/notifications/deliver` endpoint guarded by global write access.
- Disabled-by-default JSONL file adapter for self-host delivery handoff.
- Compact request inspector controls for the selected request.
- Schema migration through version `7`.

## Privacy Boundary

Notification events are internal outbox records in this slice. They must not contain:

- Internal comments.
- Hidden portal comments.
- Private changelog notes.
- Integration tokens or provider secrets.
- Raw webhook payloads.

Public portal snapshots do not expose notification preferences, outbox events, or delivery metadata.

The server workspace action API does not accept broad notification settings replacement in this slice. Until a narrower preference endpoint exists, outbox events should be treated as reducer-generated internal records.

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

Delivery processing:

- Requires private global write access.
- Requires `OPENROAD_NOTIFICATION_DELIVERY_MODE=file`.
- Appends one public-safe JSONL record per queued event to `OPENROAD_NOTIFICATION_DELIVERY_FILE`.
- Marks successful events `delivered` with attempt metadata.
- Keeps adapter failures queued with bounded error text so the next delivery run can retry them.
- Skips already delivered events on later runs.

## Deferred

- Email delivery.
- Slack, Discord, web push, SMS, or provider write-back delivery.
- Verified requester identity.
- Unsubscribe links and preference center.
- Background delivery workers or cron packaging.
- Delivery retry controls and bounce handling.
- Notification analytics.
