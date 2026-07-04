# Feature Test Plan: Requester Notification Delivery

Branch: `feat/requester-notification-delivery`

## Objective

Add a production-safe requester notification delivery boundary so queued requester notification events can be processed by an explicit server-side worker path without leaking private state or requiring email/provider secrets in the app.

## User Story

As a self-host operator, I can trigger delivery of queued requester notifications through a private API using a configured delivery adapter, see which events were delivered or failed, and avoid duplicate sends from repeated worker runs.

## Scope

- Server-side notification delivery adapter interface.
- A local JSONL file adapter for self-host handoff to an external mail/helpdesk worker.
- Environment configuration for delivery mode and delivery file path.
- Private delivery endpoint guarded by `state:write`.
- Delivery processing that marks queued events as delivered or failed with bounded metadata.
- OpenRoad schema migration for delivery status and attempt fields.
- Tests for successful delivery, adapter failure, disabled adapter behavior, auth boundaries, migration, and duplicate prevention.
- Docs for operator configuration, smoke usage, rollback, and current non-email delivery limits.

## Not In Scope

- Direct SMTP, SES, Slack, Discord, SMS, web push, or provider API sending.
- Requester identity verification.
- Unsubscribe link routing.
- Background scheduler/cron packaging.
- Notification analytics dashboard.
- Browser settings UI.

## Acceptance Criteria

- Existing outbox-only notification events migrate to the new schema with `deliveryAttempts: 0`.
- Notification event statuses support queued, held, delivered, and failed states.
- Delivery endpoint is unavailable to public visitors and workspace actors without global write access.
- Delivery endpoint returns a structured not-configured response when no adapter is enabled.
- Configured file adapter writes public-safe JSONL records and marks events delivered.
- Re-running delivery does not resend already delivered events.
- Adapter failures mark events failed with bounded error text and do not drop the event.
- Delivery responses summarize delivered, failed, skipped, and remaining queued counts.
- Public portal, workspace read APIs, and app UI do not expose delivery internals beyond existing private notification panels.
- Existing notification queueing, quiet-window dedupe, preferences, public/private redaction, and backup/restore behavior continue to pass.

## Automated Test Checklist

- Domain migration from schema 6 adds delivery metadata to existing notification events.
- Current-schema validation rejects malformed delivery metadata.
- File delivery adapter writes one JSONL record per queued event with public-safe fields only.
- Delivery processor marks queued events delivered after successful adapter writes.
- Delivery processor leaves delivered events untouched on later runs.
- Delivery processor marks failed attempts without losing the event.
- Delivery endpoint requires `POST`.
- Delivery endpoint requires `state:write` / local owner access.
- Delivery endpoint returns `503 not_configured` when delivery is disabled.
- Delivery endpoint processes all workspaces or a requested workspace scope without cross-workspace leakage.
- Existing requester notification domain tests still pass.
- Existing server auth, public portal, ops, release, and app tests still pass.
- `pnpm check` passes.

## Regression Checklist

- Status and changelog notification queueing still creates public-safe bodies.
- Quiet-window dedupe still prevents repeated queue entries.
- Requester preference toggles still work in the app.
- Public portal snapshots still exclude notification settings, outbox, and delivery metadata.
- Backup/restore stores delivery status in `openroad-state.json`; no new required mutable file is introduced unless the operator enables the JSONL delivery handoff.
- Release manifest reports the new OpenRoad state schema for rollback planning.

## Security And Privacy Checks

- Delivery endpoint is never public.
- File adapter output must not include private changelog notes, internal comments, hidden portal comments, provider tokens, raw integration payloads, audit logs, or full workspace state.
- Delivery file path is resolved and parent directories are created intentionally.
- Delivery errors are bounded before persistence.
- No delivery secrets are committed or read by the browser.
- Delivery adapter runs server-side only.

## Migration And Rollback

- Migration: schema 6 and older notification events receive delivery metadata and keep their queued/held state.
- Rollback: restore a pre-schema-7 backup before downgrading to an older build.
- JSONL delivery handoff files are append-only operational artifacts and are not required for OpenRoad state restore.

## Manual QA Checklist

- Run focused notification delivery, domain, server, and release tests.
- Run `pnpm check`.
- Start the built server with a temporary delivery JSONL path and admin token.
- Queue a notification, call the private delivery endpoint, verify JSONL output and delivered status.
- Re-run delivery and verify no duplicate JSONL line is appended.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/requester-notification-delivery`
- Implementation commit SHA: Pending.
- Date: 2026-07-04.
- Acceptance criteria status: Pending implementation.
- Commands run: Pending.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending implementation self-review and audit.
- Known unresolved risks: Direct email/provider delivery, unsubscribe routing, scheduler packaging, and notification analytics remain future production slices.
- Rollback notes: Pending final verification.
