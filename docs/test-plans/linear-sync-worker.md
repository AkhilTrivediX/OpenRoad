# Feature Test Plan: Linear Sync Worker

Branch: `feat/linear-sync-worker`

## Objective

Add a production-safe Linear live sync worker on top of the provider-neutral background sync queue. The worker should refresh already-linked Linear issue mappings from Linear GraphQL using server-only encrypted credentials, without implementing OAuth callback exchange, importing surprise issues, or exposing Linear tokens.

## User Story

As a self-host operator or workspace owner, I can store a server-side Linear credential for an active Linear installation, enqueue a Linear sync job, run the private sync runner, and have OpenRoad update linked Linear-backed requests from the live Linear API while preserving retry behavior, workspace boundaries, and standalone use.

## Scope

- Server-side Linear GraphQL client boundary with a testable fetch implementation.
- Server-side Linear integration sync worker for provider `linear`.
- Production server auto-wiring for provider sync workers through a provider-aware dispatcher.
- Linear worker activation only when an integration store and token vault are available.
- Active Linear credential lookup by provider, workspace, and installation.
- Credential decryption through `IntegrationTokenVault` with existing associated data.
- OAuth bearer token and personal API key authorization modes using credential metadata.
- Installation-wide jobs syncing active Linear issue mappings already linked to the installation.
- Mapping-scoped jobs syncing only the selected active Linear issue mapping.
- Live issue fetch by mapped Linear issue id, with identifier fallback only where safe.
- Request updates through the established Linear mapper and mapping `lastSyncedAt` updates.
- Retryable and fatal worker result mapping with bounded, redacted summaries.
- Settings integration status/manual sync capability updates so Linear no longer says live sync is unavailable when the worker and credentials are ready.
- Documentation updates for Linear, background sync, production readiness, and the build plan.

## Not In Scope

- Linear OAuth callback exchange or refresh-token rotation.
- Browser credential management UI.
- Linear webhook ingestion or signature verification.
- Importing unmapped Linear issues from a workspace/team.
- Provider write-back from OpenRoad to Linear.
- Conflict detection or resolution UI.
- Scheduler/cron packaging.
- Distributed queues or multi-process locks.
- Jira live sync worker.

## Acceptance Criteria

- Standalone OpenRoad still works when no integration store, token vault, or Linear credentials exist.
- The private sync runner continues returning `503 not_configured` when no provider worker can be configured.
- GitHub sync behavior remains unchanged when GitHub App credentials are present.
- Linear sync jobs are processed when token vault is configured, an active Linear installation exists, and at least one active readable credential exists for that installation.
- The worker rejects non-Linear jobs safely or dispatches them to the correct provider worker when multiple workers are configured.
- Missing token vault, missing credential, expired credential, revoked credential, missing encrypted secret, inactive installation, or missing `read:external` permission fail safely without leaking secrets.
- Installation-wide sync only processes active Linear issue mappings for the requested workspace and installation.
- Mapping-scoped sync only processes the requested active mapping and rejects cross-installation or cross-workspace mappings.
- The worker fetches each mapped Linear issue through GraphQL and never persists raw GraphQL payloads, access tokens, refresh tokens, authorization headers, or encrypted credential payload internals.
- Synced Linear issues update existing OpenRoad requests through `syncOpenRoadRequestFromLinearIssue`.
- Unmapped live Linear issues are ignored and do not create OpenRoad requests.
- Missing mapped Linear issues are reported in the sanitized summary without deleting requests or mappings.
- Linear API 408, 409, 429, and 5xx failures become retryable job failures with bounded retry delay.
- Linear GraphQL validation/auth/not-found/invalid-response failures become fatal job failures where appropriate.
- Worker summaries/errors are bounded and redacted before persistence, API responses, backup, restore, and release evidence.
- Settings shows Linear manual sync capability only when the status endpoint reports worker and credential readiness.
- Settings keeps Jira visible but honest as no live worker yet.
- Existing GitHub import/live fetch/webhook/disconnect, GitHub worker, Linear import/link, Jira import/link, credential storage, backup/restore, release, API auth, and standalone app tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Linear GraphQL client sends requests to the configured endpoint with OAuth bearer authorization.
- Linear GraphQL client supports personal API key authorization when credential metadata requests it.
- Linear GraphQL client parses issue data into the existing Linear issue payload shape.
- Linear GraphQL client treats GraphQL `data.issue: null` as a not-found provider error.
- Linear GraphQL client treats invalid JSON or malformed issue data as an invalid-response fatal error.
- Linear GraphQL client maps HTTP 408, 409, 429, and 5xx responses to retryable provider errors.
- Linear worker returns fatal result for non-Linear jobs when used directly.
- Linear worker processes an installation-wide job with multiple active issue mappings.
- Linear worker updates existing OpenRoad request title, owner, status, tags, description, and Linear sync comment from live issue data.
- Linear worker updates mapping `lastSyncedAt` for synced issue mappings.
- Linear worker ignores unmapped live issues and does not create new requests.
- Linear worker returns a success summary with synced, missing, and skipped counts.
- Linear worker revalidates installation, credential, and mappings after live fetch before applying updates.
- Mapping-scoped sync fetches and updates only the selected mapping.
- Cross-workspace, cross-installation, disconnected, non-issue, and missing mappings fail safely.
- Missing active Linear credential fails without calling the Linear API.
- Revoked or expired Linear credentials fail without calling the Linear API.
- Token vault decrypt failure fails with a generic fatal error and no ciphertext/token detail.
- Private runner uses a provider dispatcher when GitHub and Linear workers are both configured.
- Private runner still processes GitHub jobs after Linear worker is added.
- Private runner remains `503 not_configured` when neither GitHub nor Linear workers can be configured.
- Integration status endpoint reports Linear manual sync false until active installation, active issue mapping, active credential, and worker readiness are all present.
- Integration status endpoint reports Linear manual sync true when all readiness conditions are met.
- Settings UI enables Linear manual sync only in the ready state and still disables Jira live sync.
- Browser-rendered Settings never contains token-shaped text, encrypted credential payloads, GraphQL payloads, or raw authorization headers.
- Existing background sync queue tests still pass.
- Existing Linear import/link tests still pass.
- Existing GitHub sync worker tests still pass.
- Existing ops backup/restore and release tests still pass.

## Regression Checklist

- GitHub App worker auto-wiring remains compatible with the provider dispatcher.
- GitHub worker does not receive Linear jobs when Linear worker is configured.
- Linear import/re-import remains payload-backed and independent of live worker configuration.
- Credential create/list/revoke APIs still return metadata only.
- Revoking a Linear credential prevents future live sync without deleting OpenRoad requests or mappings.
- Public portal snapshots still exclude integration metadata, credentials, and sync jobs.
- Backup/restore continues sanitizing integration metadata and sync job history.
- Release manifests do not include provider tokens, token vault keys, encrypted payloads, or smoke-state paths.
- Settings remains usable in standalone/local mode.

## Security And Privacy Checks

- No Linear client secret, access token, refresh token, personal API key, token vault key, admin token, GraphQL authorization header, or encrypted credential payload is committed.
- Worker receives scoped job metadata only and obtains Linear access through the server-side credential vault.
- Worker summaries include counts and scoped ids only, not raw provider payloads.
- Worker errors are generic or redacted before persistence.
- API responses do not include Linear tokens, authorization headers, raw GraphQL payloads, or encrypted credential payloads.
- Built-server smoke uses temporary state files and fake Linear API tokens only.

## UX And Accessibility Checks

- Settings keeps the same default navigation and does not add Sync logs.
- Linear provider row uses the same flat control surface as GitHub.
- Linear manual sync action uses the existing icon/text button treatment and remains keyboard reachable.
- Disabled Jira live sync keeps clear nearby copy.
- Mobile Settings still has no horizontal overflow and provider action touch targets remain at least 44px.
- Status copy remains short, operational, and text-based.

## Manual QA Checklist

- Start app in standalone/local mode and confirm Settings still shows optional integrations without errors.
- Start built server with token vault missing and confirm Linear jobs cannot run and Settings does not enable Linear manual sync.
- Start built server with temporary state, integration metadata, token vault key, a Linear installation, a stored Linear credential, and a fake Linear GraphQL API.
- Import/link a Linear issue, enqueue a Linear sync job, run the private sync runner, and confirm the linked request updates.
- Confirm fake Linear API receives exactly the expected issue query and no surprise list/import query.
- Confirm response bodies, persisted OpenRoad state, persisted integration metadata, and backup output do not contain fake Linear token values.
- Run `pnpm check`.
- Run `pnpm release:verify`.
- Run built-server smoke with `pnpm ops:smoke` and the Linear manual sync path.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch or remove `OPENROAD_TOKEN_ENCRYPTION_KEY` to disable the auto-configured Linear worker.
- If live sync changed request data unexpectedly, restore a pre-branch backup and rerun `pnpm ops:smoke`.
- Existing OpenRoad state schema `7` and integration metadata schema `3` remain active.

## Evidence

- Branch: `feat/linear-sync-worker`
- Implementation commit SHA: Pending.
- Date: Pending.
- Acceptance criteria status: Pending.
- Commands run: Pending.
- Browser/viewports tested: Pending.
- Accessibility checks: Pending.
- Reviewer notes: Pending.
- Known unresolved risks: OAuth callback exchange, token refresh, Linear webhooks, provider write-back, conflict UI, scheduler packaging, distributed locks, Jira live worker, and browser credential management remain later production slices.
- Rollback notes: Pending.
