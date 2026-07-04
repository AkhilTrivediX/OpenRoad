# Feature Test Plan: Background Sync Foundation

Branch: `feat/background-sync-foundation`

## Objective

Add a production-safe background sync job foundation for GitHub, Linear, and Jira integrations so future live fetch/write-back slices can run through durable, auditable, bounded server-side work instead of ad hoc request handlers.

## User Story

As a self-host operator or workspace owner, I can enqueue integration sync jobs for an active installation, run a private sync worker endpoint, see sanitized job metadata, and rely on retries/backoff without exposing provider secrets or breaking standalone OpenRoad usage.

## Scope

- Integration metadata schema migration from version `2` to version `3`.
- Durable `syncJobs` collection in `OPENROAD_INTEGRATION_FILE`.
- Provider/workspace/installation-scoped sync job model.
- Job enqueue helper with dedupe keys for repeated manual/scheduled/webhook requests.
- Due-job claim helper with bounded batch size and process-local serialization.
- Job completion, retryable failure, fatal failure, backoff, and attempt metadata.
- Private sync runner endpoint guarded by global owner/admin access.
- Workspace/provider enqueue endpoint guarded by integration management access.
- Sanitized job list/response metadata with no provider tokens, encrypted secrets, raw payloads, request bodies, or webhook headers.
- Backup/restore/release/runbook updates for integration metadata schema `3`.
- Tests for migration, enqueue scope validation, auth, retry/backoff, serialization, redaction, backup/restore, and existing integration regressions.

## Not In Scope

- Live GitHub/Linear/Jira API fetch.
- Provider write-back.
- OAuth callback token exchange.
- Conflict resolution UI.
- Browser Settings UI for manual sync buttons.
- External queue systems.
- Distributed locks across multiple Node processes.
- Cron packaging or hosted scheduler infrastructure.

## Acceptance Criteria

- Schema `2` integration metadata migrates automatically to schema `3` with `syncJobs: []`.
- Standalone mode still works with zero installations, zero credentials, and no sync adapter.
- Sync jobs can be enqueued only for active installations in the same provider/workspace scope.
- Enqueue dedupes queued/running jobs with the same dedupe key instead of flooding the queue.
- Job metadata stores provider, workspace, installation, reason, status, attempts, timestamps, and bounded error/result summaries.
- Private sync runner endpoint is disabled with `503 not_configured` until a server-side sync worker adapter is configured.
- Public visitors, requesters, viewers, contributors, and integration actors cannot enqueue or run sync jobs unless an explicit future route grants that capability.
- Local owners/admins and workspace owners can enqueue jobs for their workspace.
- The worker endpoint claims due queued jobs, marks them running, records success/failure, and keeps retryable failures queued with backoff.
- Fatal failures mark jobs failed without deleting job history.
- Concurrent worker calls do not process the same job twice inside one Node process.
- Responses and audit events never include provider tokens, encrypted secrets, raw provider payloads, webhook signatures, or request bodies.
- Job history is trimmed without dropping queued/running work.
- Existing provider token storage, GitHub import/live/webhook/disconnect, Linear/Jira import/setup, notification delivery, public portal, ops, release, and app tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Integration store seeds schema `3` with `syncJobs: []`.
- Parser migrates schema `2` metadata with credentials to schema `3`.
- Parser rejects future schema versions and malformed sync job records.
- Current-schema load sanitizes unknown secret-like fields from jobs and rewrites the integration file.
- Enqueue helper rejects unknown provider, missing installation, cross-workspace installation, and disconnected/suspended installations.
- Enqueue helper dedupes active jobs by provider/workspace/installation/reason/mapping scope.
- Enqueue helper preserves existing credential metadata without exposing encrypted secrets in responses.
- Claim helper respects due time, batch limit, queued status, and provider/workspace filters.
- Completion helper marks jobs succeeded with bounded result summary.
- Retryable failure increments attempts, records bounded error text, and schedules a future run.
- Fatal failure marks jobs failed and removes queued eligibility.
- Job trimming preserves queued/running jobs ahead of old succeeded/failed history.
- Enqueue endpoint requires `integration:manage`.
- Runner endpoint requires global owner/admin write access.
- Runner endpoint returns `503 not_configured` when no worker adapter is configured.
- Runner endpoint serializes concurrent calls in process.
- Runner endpoint responses are sanitized and bounded.
- Backup/restore sanitizes credential-bearing and job-bearing integration metadata.
- Release manifest reports integration metadata schema `3`.
- Existing credential storage tests still pass.
- Existing server, domain, app, ops, and release tests still pass.
- `pnpm check` passes.

## Regression Checklist

- Provider token storage remains encrypted, AAD-bound, and metadata-only in API responses.
- Manual GitHub disconnect and signed installation deletion still revoke credentials.
- GitHub live issue fetch still uses short-lived installation tokens without persistence.
- Linear/Jira OAuth setup still returns safe setup metadata only.
- Requester notification delivery remains independent from integration sync jobs.
- Public portal snapshots still exclude integrations, credentials, sync jobs, and delivery internals.
- Backup/restore keeps product, integration, and team files as one logical snapshot.
- Release verification remains secret-free and records schema rollback notes.

## Security And Privacy Checks

- No provider tokens, encryption keys, webhook secrets, private keys, admin tokens, or real credentials are committed.
- Sync job APIs never echo tokens, encrypted credential payloads, raw provider payloads, webhook signatures, request headers, or request bodies.
- Job errors and summaries are bounded before persistence and response.
- Worker endpoint is server-side only and private by default.
- Sync adapter input receives only scoped job metadata; future provider calls must explicitly fetch/decrypt credentials server-side.
- Audit events contain provider/workspace/installation/job ids only, not secrets or provider payloads.
- Backups containing integration jobs and encrypted credentials are documented as sensitive production data.

## Migration And Rollback

- Migration: schema `2` integration metadata loads as schema `3` and receives `syncJobs: []`.
- Rollback: before downgrading to a schema `2` build, drain/remove sync jobs or restore a pre-schema-3 integration backup.
- Existing OpenRoad core state schema remains unchanged in this slice.

## Manual QA Checklist

- Run focused integration, sync job, HTTP, access, ops, and release tests.
- Run `pnpm check`.
- Start the built server with a temporary state directory and admin token.
- Create an active provider installation, enqueue a sync job, run the private worker with a test adapter, and confirm sanitized responses.
- Re-run the worker and verify already succeeded jobs are not duplicated.
- Enqueue a retryable failure job and confirm backoff/attempt metadata.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/background-sync-foundation`
- Implementation commit SHA: Pending.
- Date: Pending.
- Acceptance criteria status: Pending.
- Commands run: Pending.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending.
- Known unresolved risks: Live provider fetch, provider write-back, OAuth callback exchange, conflict UI, browser Settings UI, external queue systems, distributed locks, and scheduler packaging remain later production slices.
- Rollback notes: Pending.
