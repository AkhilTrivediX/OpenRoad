# Feature Test Plan: Observability Foundation

Branch: `feat/observability-foundation`

## Objective

Add a production-safe observability foundation so OpenRoad operators can inspect recent structured operational events for private server workflows without scraping process logs or exposing secrets, raw provider payloads, or workspace exports.

## User Story

As a self-host or hosted OpenRoad operator, I can call a private operations endpoint and see recent sanitized events for notification delivery, provider sync, webhook handling, hosted webhook registration, state/admin actions, and server errors, so I can diagnose production behavior without direct filesystem access or leaked secrets.

## Scope

- Team metadata schema migration for a durable bounded `operationalEvents` ledger.
- Sanitized operational event model with severity, category, type, summary, status, actor/request/workspace/provider identifiers when safe, and bounded metadata.
- Private `GET /api/openroad/ops/events` endpoint with limit, category, severity, workspace, and provider filters.
- `GET /api/openroad/ops/status` summary fields for recent operational event counts and latest error/warning timestamps.
- Server helper for recording operational events without failing the user workflow if observability persistence fails.
- Initial instrumentation for:
  - requester notification delivery,
  - integration sync runner,
  - hosted webhook registration,
  - provider webhook ingestion,
  - private state/workspace replacement,
  - unexpected top-level server errors.
- Backup, restore, release, deployment, API contract, and readiness documentation.

## Not In Scope

- Full metrics backend, OpenTelemetry exporter, tracing, Prometheus, dashboards, alerting, log shipping, or hosted analytics.
- Browser UI for ops events.
- Public requester-visible status pages.
- Persisting raw HTTP requests, response bodies, provider payloads, headers, authorization values, stack traces, environment dumps, file paths, or full workspace state.
- Distributed multi-process event aggregation beyond the current file-backed deployment shape.

## Acceptance Criteria

- Existing team metadata schemas migrate to include `operationalEvents: []` without changing users, memberships, audit events, invitations, credentials, or account recovery data.
- Operational events are bounded, trimmed, and validated; future schemas still fail safely.
- Operational events never store provider tokens, webhook secrets, bearer headers, session/admin tokens, password hashes, raw provider payloads, raw request bodies, raw response bodies, encrypted credential internals, private changelog notes, internal comments, stack traces, environment dumps, or full workspace exports.
- `GET /api/openroad/ops/events` requires private read permission and returns only sanitized events visible to the caller.
- Workspace-scoped members can read events for their own workspace only; local owners/admins can read global and workspace events.
- Ops status remains private and includes a compact recent operational-event summary without exposing event metadata bodies.
- Notification delivery, integration sync runner, hosted webhook registration, provider webhook ingestion, and state/workspace replacement record useful success/failure events.
- Observability write failures are logged but do not block the original product workflow.
- Existing audit events remain unchanged for user/action history.
- Backup/restore, release manifest validation, ops smoke, provider workflows, notification delivery, public portal, sessions, and app tests remain green.

## Automated Test Checklist

- Team store migrates schema `5` to schema `6` with `operationalEvents: []`.
- Team store validates, sanitizes, trims, and persists operational events.
- Team store rejects malformed operational event metadata and future schemas safely.
- Operational event redaction strips token-shaped text, bearer headers, ciphertext internals, raw payload fragments, authorization text, passwords, and stack-shaped details.
- `GET /api/openroad/ops/events` requires private read permission.
- Owner/admin can list recent events and filter by category, severity, provider, workspace, and limit.
- Workspace member can list only events for their own workspace and is denied cross-workspace filters.
- Public visitor and unauthenticated token-mode requests cannot read ops events.
- Ops status includes recent event counts and latest warning/error timestamps without leaking summaries or metadata.
- Notification delivery endpoint records processed/failure operational events.
- Integration sync runner records processed/not-configured/failure operational events.
- Hosted webhook registration records success/blocked/failure operational events.
- Provider webhook routes record accepted/ignored/duplicate/error operational events without raw payloads.
- State and workspace replacement record operational events alongside existing audit events.
- Backup/restore and release schema reporting include team metadata schema `6`.
- `pnpm check`, `pnpm release:verify`, and built-server smoke pass.

## Regression Checklist

- Existing audit events API behavior and filtering remain unchanged.
- Existing ops status smoke remains green for token and single-user mode.
- Existing notification delivery retry/dedupe behavior remains unchanged.
- Existing GitHub/Linear/Jira sync events remain in integration metadata and do not move into team metadata.
- Existing GitHub/Linear/Jira webhook signature verification still happens before JSON mutation.
- Existing provider token storage, conflict resolution, write-back, hosted webhook registration, and public portal tests remain green.
- No new primary navigation item or Settings clutter is introduced.

## Security And Privacy Checks

- Observability endpoints are private.
- Event metadata must be bounded and allowlisted.
- Raw error values must be converted to safe codes/summaries before persistence.
- Recording failures must not reveal filesystem paths or env values to API callers.
- Backups remain sensitive, but operational events must still be safe operational metadata, not secret storage.
- The release manifest should report team schema `6` rollback notes.

## Manual QA Checklist

- Run focused team, HTTP, notifications, integrations, ops, and release tests.
- Run `pnpm check`.
- Start the built server with admin token and temporary data files.
- Trigger notification delivery and fetch `/api/openroad/ops/events`; confirm one sanitized notification event appears.
- Trigger a not-configured integration sync run and confirm a warning/error event appears without secrets.
- Confirm unauthenticated ops events access is denied.
- Run `pnpm ops:smoke` and `pnpm release:verify`.

## Migration And Rollback

- Team metadata schema moves from `5` to `6` by initializing `operationalEvents: []`.
- Rollback: restore a pre-schema-6 team metadata backup before downgrading to a schema-5 build, or remove `operationalEvents` after backup if an operator intentionally downgrades.

## Evidence

- Branch: `feat/observability-foundation`
- Implementation commit SHA: Pending.
- Date: 2026-07-10.
- Commands run: Pending.
- Acceptance criteria status: Pending.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending.
- Rollback notes: Pending final implementation details.
