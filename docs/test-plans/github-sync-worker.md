# Feature Test Plan: GitHub Sync Worker

Branch: `feat/github-sync-worker`

## Objective

Add the first production-safe live provider sync worker on top of the background sync job foundation. The worker should refresh already-linked GitHub issue mappings through the private sync runner without exposing GitHub tokens, importing surprise issues, or breaking standalone OpenRoad usage.

## User Story

As a self-host operator or workspace owner, I can verify a GitHub App installation, enqueue a GitHub sync job, run the private sync runner, and have OpenRoad update linked GitHub-backed requests from the live GitHub API while preserving retry behavior and secret boundaries.

## Scope

- Server-side GitHub integration sync worker for provider `github`.
- Production server auto-configures the worker only when GitHub App credentials and integration stores are available.
- Installation-wide jobs sync active GitHub issue mappings already linked to the installation.
- Mapping-scoped jobs sync only the selected active GitHub issue mapping.
- Live issue fetch uses short-lived GitHub App installation tokens through the existing `GitHubAppClient` boundary.
- Worker mutates OpenRoad requests and mapping `lastSyncedAt` through the existing server-side integration mutation lane.
- Worker returns sanitized success, retryable failure, and fatal failure summaries to the background sync runner.
- Runner keeps existing queue semantics: claim, lease, retry backoff, redacted errors, completion metadata, and audit event.
- Documentation and release/runbook notes explain the worker capability and remaining limits.

## Not In Scope

- Browser Settings UI for manual sync buttons or sync logs.
- Importing every unmapped issue in a repository or installation.
- Repository discovery for a GitHub installation.
- Pull request sync beyond preserving existing pull request mappings during import.
- Provider write-back from OpenRoad to GitHub.
- Conflict detection/resolution UI.
- OAuth setup callback.
- Distributed queues or multi-process locks.
- Scheduling/cron packaging.

## Acceptance Criteria

- Standalone OpenRoad still works when no integration store or GitHub App config exists.
- Private sync runner continues returning `503 not_configured` when no worker can be configured.
- With GitHub App config present, the private runner processes due GitHub sync jobs through the GitHub worker.
- The worker rejects non-GitHub jobs and inactive/missing/disconnected installations safely.
- Installation-wide sync only processes active GitHub issue mappings for the requested workspace/installation.
- Mapping-scoped sync only processes the requested active mapping and rejects cross-installation/cross-workspace mappings.
- The worker fetches GitHub issues by repository using short-lived installation tokens and never persists or returns those tokens.
- Synced GitHub issues update existing OpenRoad requests through the established GitHub mapper.
- Unmapped live GitHub issues are ignored by the worker and do not create surprise OpenRoad requests.
- Missing mapped issues in the live GitHub response are reported in the sanitized summary without deleting requests or mappings.
- GitHub API rate limit or transient upstream errors become retryable job failures.
- Missing config, invalid responses, inactive installations, or unsupported mapping types become fatal job failures where appropriate.
- Worker summaries/errors are bounded and redacted before persistence, API responses, backup, and restore.
- Concurrent runner calls do not double-process the same GitHub sync job.
- Existing GitHub import, live issue fetch, webhooks, disconnect, credential storage, backup/restore, release, and standalone app tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- GitHub worker factory returns no worker when GitHub App setup is incomplete.
- GitHub worker processes an installation-wide job with two active issue mappings in one repository.
- GitHub worker groups mapped issue fetches by repository and calls `listRepositoryIssues` with the GitHub installation id.
- GitHub worker updates existing OpenRoad request title/status/tags/comments from live GitHub issue data.
- GitHub worker updates mapping `lastSyncedAt` for synced issue mappings.
- GitHub worker ignores unmapped live issues and does not create new requests.
- GitHub worker returns a success summary with synced and missing counts.
- Mapping-scoped sync fetches and updates only the selected mapping.
- Cross-workspace, cross-installation, disconnected, non-issue, and missing mappings fail safely.
- GitHub API upstream errors map to retryable worker results without leaking token-shaped text.
- Invalid GitHub API responses map to fatal worker results.
- Private runner uses the auto-configured GitHub worker when config is complete.
- Private runner remains `503 not_configured` when config is incomplete.
- Sync runner tests cover retryable and fatal GitHub worker outcomes.
- Existing background sync queue tests still pass.
- Existing GitHub import/live fetch/webhook/disconnect tests still pass.
- Existing token vault, ops backup/restore, release, and API auth tests still pass.
- `pnpm check` passes.

## Regression Checklist

- Provider tokens remain server-only and are never written to OpenRoad state, integration metadata, audit events, responses, backups, or release manifests.
- Signed GitHub webhook processing remains idempotent.
- GitHub installation disconnect still revokes credentials and disconnects mappings.
- Live issue fetch endpoint still works independently of background sync.
- Provider-neutral sync jobs still support Linear and Jira jobs without a live worker yet.
- Requester notification delivery remains independent from integration sync jobs.
- Public portal snapshots still exclude integration internals.
- File-backed backup/restore keeps state, integration, and team metadata consistent.

## Security And Privacy Checks

- No GitHub App private key, installation token, webhook secret, or admin token is committed.
- Worker receives scoped job metadata only and obtains live GitHub access through the server-side GitHub App client.
- Worker summaries must include counts and scoped ids, not raw provider payloads.
- Worker errors must be generic or redacted before persistence.
- API responses must not include GitHub tokens, authorization headers, raw GitHub payloads, or encrypted credential payloads.
- Backups containing encrypted credentials and sync job history remain documented as sensitive data.

## Migration And Rollback

- No new persistence schema version is expected in this slice.
- Rollback: stop the worker by downgrading to the prior build or removing GitHub App config, restore a pre-branch backup if live sync changed data unexpectedly, and rerun `pnpm ops:smoke`.
- Existing schema `7` OpenRoad state and integration metadata schema `3` remain the active persistence versions.

## Manual QA Checklist

- Run focused GitHub worker, HTTP, integration, access, ops, and release tests.
- Run `pnpm check`.
- Start the built server with temporary state files and complete GitHub App test config.
- Verify/import a GitHub installation, create or import a linked GitHub issue, enqueue a GitHub sync job, run the private sync runner, and confirm the linked request updates.
- Re-run the private sync runner and confirm succeeded jobs are not duplicated.
- Run a missing-config built-server smoke and confirm the runner stays `503 not_configured`.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/github-sync-worker`
- Implementation commit SHA: Pending.
- Date: Pending.
- Acceptance criteria status: Pending.
- Commands run: Pending.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending.
- Known unresolved risks: Browser Settings UI, repository discovery, unmapped issue import policy, pull request sync, provider write-back, conflict UI, OAuth callback, distributed locks, and scheduler packaging remain later production slices.
- Rollback notes: Pending.
