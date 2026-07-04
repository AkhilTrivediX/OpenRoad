# Feature Test Plan: GitHub Webhook And Disconnect Hardening

Branch: `feat/github-webhook-disconnect`

## Objective

Receive GitHub App webhook deliveries safely, process linked issue updates idempotently, and disconnect GitHub installations without deleting OpenRoad workspace data.

## User Story

As a workspace owner, I can trust OpenRoad to accept GitHub webhooks only from GitHub, keep linked requests fresh, and stop sync cleanly when an installation is removed or disconnected.

## Scope

- GitHub App webhook endpoint with `X-Hub-Signature-256` verification.
- Raw body HMAC verification before JSON parsing.
- Idempotent delivery tracking in integration metadata.
- Linked GitHub issue webhook sync for already-imported requests.
- GitHub installation delete/suspend/unsuspend webhook handling.
- Manual installation disconnect API.
- Sync event metadata for hidden operational/audit visibility.
- Docs for webhook URL, event requirements, disconnect behavior, and rollback.

## Not In Scope

- Browser Settings UI.
- Automatic background polling.
- Creating new OpenRoad requests from webhooks.
- Writing updates back to GitHub.
- GitHub Marketplace or billing events.
- Linear or Jira webhooks.

## Acceptance Criteria

- Unsigned webhook deliveries cannot mutate OpenRoad or integration metadata.
- Invalid `X-Hub-Signature-256` deliveries fail closed.
- Valid webhook deliveries are verified against the raw request body.
- Duplicate GitHub delivery IDs are treated as idempotent no-ops.
- Issue webhooks update already-linked OpenRoad requests only.
- Unmapped issue webhooks are accepted as no-ops and logged without creating requests.
- Installation `deleted` webhooks mark matching installations and mappings disconnected.
- Installation `suspend` and `unsuspend` webhooks mark matching installations suspended or active.
- Manual disconnect marks the installation and mappings disconnected without deleting requests.
- Live fetch and manual import reject disconnected installations and still pass for active installations.
- Webhook secrets are never returned, persisted, audited, or exposed to browser code.
- `pnpm check` passes after the feature.

## Automated Test Checklist

- Signature helper accepts valid SHA-256 signatures.
- Signature helper rejects missing, malformed, and wrong signatures.
- Webhook route returns not configured when no webhook secret exists.
- Webhook route rejects unsigned payloads before parsing JSON.
- Webhook route rejects invalid signatures without writing integration events.
- Webhook route records one sync event for a valid delivery.
- Replaying the same delivery ID returns duplicate/no-op and does not rewrite requests.
- Linked issue webhook updates title/status/tags through existing GitHub issue sync mapper.
- Unmapped issue webhook does not create a request.
- Installation delete webhook disconnects matching installation and mappings.
- Installation suspend/unsuspend webhook updates matching installation status.
- Manual disconnect route requires `integration:manage`.
- Manual disconnect preserves OpenRoad request objects.
- Existing GitHub import, live fetch, backup/restore, access contract, and standalone smoke tests still pass.

## Regression Checklist

- Existing payload-backed imports still create mappings.
- Existing live fetch still uses short-lived installation tokens and rejects disconnected metadata.
- Public portal responses stay integration-free.
- `OPENROAD_INTEGRATION_FILE` remains optional until integration use or backup.
- Existing version-1 integration metadata without sync events still loads.
- Backup/restore includes sync event metadata when present.
- No provider secrets enter OpenRoad core state, integration state, team audit state, logs, or API responses.

## Security And Privacy Checks

- Verify webhook signatures with HMAC-SHA256 and timing-safe comparison.
- Verify against the raw bytes exactly as received.
- Bound webhook payload size.
- Do not process legacy SHA-1 signatures.
- Do not echo webhook secrets, signatures, request headers, or raw payloads in errors.
- Store only delivery ID, event name, installation ID, workspace ID, result, and summary.

## Migration And Rollback

- Integration metadata keeps schema version `1`; `syncEvents` is additive and defaults to an empty array for older files.
- Rollback by reverting this branch; existing `syncEvents` can remain ignored by older code because older parsers drop unknown fields.
- If webhook processing misbehaves, unset `OPENROAD_GITHUB_APP_WEBHOOK_SECRET` or remove the GitHub App webhook URL, then restore from the latest OpenRoad backup if needed.

## Manual QA Checklist

- Run focused webhook/integration/access/ops tests.
- Run `pnpm check`.
- Run built-server smoke with GitHub App env unset.
- Inspect integration metadata after webhook tests for secret leakage.
- Inspect OpenRoad state after disconnect to confirm requests remain.

## Evidence

- Branch: `feat/github-webhook-disconnect`
- Commit SHAs: pending.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for signed GitHub webhook ingestion, idempotent linked issue sync, installation webhook state changes, and manual disconnect without OpenRoad request deletion.
- Commands run:
  - `pnpm vitest run server/github-app.test.ts server/integrations.test.ts server/access.test.ts server/http.test.ts scripts/openroad-ops.test.mjs` - 74 tests passed.
  - `pnpm check` - 165 tests passed; production client and server builds passed.
  - Built-server smoke with GitHub App env unset and admin-token mode - passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Official GitHub docs confirmed `X-Hub-Signature-256` HMAC-SHA256 verification, raw payload integrity requirements, GitHub App webhook delivery shape, and `issues`/`installation` events.
- Known unresolved risks: Browser Settings UI, background polling, conflict UI, and hosted observability remain later production slices.
- Rollback notes: Revert this branch; if webhook processing caused bad sync state, unset `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`, remove the GitHub App webhook URL, and restore `OPENROAD_DATA_FILE`, `OPENROAD_INTEGRATION_FILE`, and `OPENROAD_TEAM_FILE` from the latest backup.
