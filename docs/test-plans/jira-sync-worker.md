# Feature Test Plan: Jira Sync Worker

Branch: `feat/jira-sync-worker`

## Objective

Add a production-safe Jira live sync worker on top of the provider-neutral background sync queue. The worker should refresh already-linked Jira issue mappings from Jira Cloud REST using server-only encrypted credentials, without implementing OAuth callback exchange, importing surprise issues, or exposing Atlassian tokens.

## User Story

As a self-host operator or workspace owner, I can store a server-side Jira credential for an active Jira installation, enqueue a Jira sync job, run the private sync runner, and have OpenRoad update linked Jira-backed requests from the live Jira REST API while preserving retry behavior, workspace boundaries, and standalone use.

## Official Platform References

- Atlassian OAuth 2.0 3LO apps: https://developer.atlassian.com/cloud/jira/software/oauth-2-3lo-apps/
- Jira Cloud REST API v2 Get issue: https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-issues/#api-rest-api-2-issue-issueidorkey-get
- Jira Cloud rate limiting: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/

## Scope

- Server-side Jira Cloud REST client boundary with a testable fetch implementation.
- Server-side Jira integration sync worker for provider `jira`.
- Production server auto-wiring through the existing provider sync dispatcher.
- Jira worker activation only when an integration store and token vault are available.
- Active Jira credential lookup by provider, workspace, and canonical installation id.
- Credential decryption through `IntegrationTokenVault` with existing associated data.
- OAuth bearer token authorization for Jira Cloud REST calls.
- API URL construction through `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2/issue/{issueIdOrKey}` by default, with an environment override for smoke/fake API tests.
- Installation-wide jobs syncing active Jira issue mappings already linked to the installation.
- Mapping-scoped jobs syncing only the selected active Jira issue mapping.
- Live issue fetch by mapped Jira issue id, with key fallback only where safe.
- Request updates through the established Jira mapper and mapping `lastSyncedAt` updates.
- Retryable and fatal worker result mapping with bounded, redacted summaries.
- Settings integration status/manual sync capability updates so Jira no longer says live sync is unavailable when the worker and credentials are ready.
- Documentation updates for Jira, background sync, production readiness, and the build plan.

## Not In Scope

- Jira OAuth callback exchange or refresh-token rotation.
- Browser credential management UI.
- Jira webhook ingestion or idempotency handling.
- Importing unmapped Jira issues from a site/project.
- Jira project discovery, field discovery, or JQL search.
- Provider write-back from OpenRoad to Jira.
- Conflict detection or resolution UI.
- Scheduler/cron packaging.
- Distributed queues or multi-process locks.

## Acceptance Criteria

- Standalone OpenRoad still works when no integration store, token vault, or Jira credentials exist.
- The private sync runner continues returning `503 not_configured` when no provider worker can be configured.
- GitHub and Linear sync behavior remain unchanged when their credentials are present.
- Jira sync jobs are processed when token vault is configured, an active Jira installation exists, and at least one active readable credential exists for that installation.
- The provider dispatcher routes GitHub, Linear, and Jira jobs to the correct worker.
- Missing token vault, missing credential, expired credential, revoked credential, missing encrypted secret, inactive installation, missing `read:external` permission, or missing Jira cloud id fail safely without leaking secrets.
- Installation-wide sync only processes active Jira issue mappings for the requested workspace and installation.
- Mapping-scoped sync only processes the requested active mapping and rejects cross-installation or cross-workspace mappings.
- The worker fetches each mapped Jira issue through REST and never persists raw REST payloads, access tokens, refresh tokens, authorization headers, or encrypted credential payload internals.
- Synced Jira issues update existing OpenRoad requests through `syncOpenRoadRequestFromJiraIssue`.
- Unmapped live Jira issues are ignored and do not create OpenRoad requests.
- Missing mapped Jira issues are reported in the sanitized summary without deleting requests or mappings.
- Jira API 408, 409, 429, and 5xx failures become retryable job failures with bounded retry delay.
- Jira auth/permission/not-found/invalid-response failures become fatal job failures where appropriate.
- Worker summaries/errors are bounded and redacted before persistence, API responses, backup, restore, and release evidence.
- Settings shows Jira manual sync capability only when the status endpoint reports worker and credential readiness.
- Existing GitHub import/live fetch/webhook/disconnect, GitHub worker, Linear import/link/worker, Jira import/link, credential storage, backup/restore, release, API auth, and standalone app tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Jira REST client sends requests to the configured endpoint with OAuth bearer authorization.
- Jira REST client builds default Atlassian API URLs with `api.atlassian.com/ex/jira/{cloudId}`.
- Jira REST client requests only the mapped issue by id/key and does not list/search a project.
- Jira REST client parses issue data into the existing Jira issue payload shape.
- Jira REST client treats HTTP 404 as a not-found provider error.
- Jira REST client treats invalid JSON or malformed issue data as an invalid-response fatal error.
- Jira REST client maps HTTP 408, 409, 429, and 5xx responses to retryable provider errors.
- Jira worker returns fatal result for non-Jira jobs when used directly.
- Jira worker processes an installation-wide job with multiple active issue mappings.
- Jira worker updates existing OpenRoad request title, owner, status, tags, description, and Jira sync comment from live issue data.
- Jira worker updates mapping `lastSyncedAt` for synced issue mappings.
- Jira worker ignores unmapped live issues and does not create new requests.
- Jira worker returns a success summary with synced, missing, and skipped counts.
- Jira worker revalidates installation, credential, and mappings after live fetch before applying updates.
- Mapping-scoped sync fetches and updates only the selected mapping.
- Cross-workspace, cross-installation, disconnected, non-issue, and missing mappings fail safely.
- Missing active Jira credential fails without calling the Jira API.
- Revoked or expired Jira credentials fail without calling the Jira API.
- Token vault decrypt failure fails with a generic fatal error and no ciphertext/token detail.
- Private runner uses a provider dispatcher when GitHub, Linear, and Jira workers are configured.
- Private runner still processes GitHub and Linear jobs after Jira worker is added.
- Private runner remains `503 not_configured` when no provider worker can be configured.
- Integration status endpoint reports Jira manual sync false until active installation, active issue mapping, active credential, and worker readiness are all present.
- Integration status endpoint reports Jira manual sync true when all readiness conditions are met.
- Settings UI enables Jira manual sync only in the ready state.
- Browser-rendered Settings never contains token-shaped text, encrypted credential payloads, REST payloads, or raw authorization headers.
- Existing background sync queue tests still pass.
- Existing Jira import/link tests still pass.
- Existing GitHub and Linear sync worker tests still pass.
- Existing ops backup/restore and release tests still pass.

## Regression Checklist

- GitHub App worker auto-wiring remains compatible with the provider dispatcher.
- Linear worker auto-wiring remains compatible with the provider dispatcher.
- GitHub and Linear workers do not receive Jira jobs when Jira worker is configured.
- Jira import/re-import remains payload-backed and independent of live worker configuration.
- Credential create/list/revoke APIs still return metadata only.
- Revoking a Jira credential prevents future live sync without deleting OpenRoad requests or mappings.
- Public portal snapshots still exclude integration metadata, credentials, and sync jobs.
- Backup/restore continues sanitizing integration metadata and sync job history.
- Release manifests do not include provider tokens, token vault keys, encrypted payloads, or smoke-state paths.
- Settings remains usable in standalone/local mode.

## Security And Privacy Checks

- No Jira client secret, access token, refresh token, token vault key, admin token, REST authorization header, or encrypted credential payload is committed.
- Worker receives scoped job metadata only and obtains Jira access through the server-side credential vault.
- Worker summaries include counts and scoped ids only, not raw provider payloads.
- Worker errors are generic or redacted before persistence.
- API responses do not include Jira tokens, authorization headers, raw REST payloads, or encrypted credential payloads.
- Built-server smoke uses temporary state files and fake Jira API tokens only.

## UX And Accessibility Checks

- Settings keeps the same default navigation and does not add Sync logs.
- Jira provider row uses the same flat control surface as GitHub and Linear.
- Jira manual sync action uses the existing icon/text button treatment and remains keyboard reachable.
- Mobile Settings still has no horizontal overflow and provider action touch targets remain at least 44px.
- Status copy remains short, operational, and text-based.

## Manual QA Checklist

- Start app in standalone/local mode and confirm Settings still shows optional integrations without errors.
- Start built server with token vault missing and confirm Jira jobs cannot run and Settings does not enable Jira manual sync.
- Start built server with temporary state, integration metadata, token vault key, a Jira installation, a stored Jira credential, and a fake Jira REST API.
- Import/link a Jira issue, enqueue a Jira sync job, run the private sync runner, and confirm the linked request updates.
- Confirm fake Jira API receives exactly the expected issue request and no surprise search/list query.
- Confirm response bodies, persisted OpenRoad state, persisted integration metadata, and backup output do not contain fake Jira token values.
- Run `pnpm check`.
- Run `pnpm release:verify`.
- Run built-server smoke with `pnpm ops:smoke` and the Jira manual sync path.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch or remove `OPENROAD_TOKEN_ENCRYPTION_KEY` to disable the auto-configured Jira worker.
- If live sync changed request data unexpectedly, restore a pre-branch backup and rerun `pnpm ops:smoke`.
- Existing OpenRoad state schema `7` and integration metadata schema `3` remain active.

## Evidence

- Branch: `feat/jira-sync-worker`
- Implementation commit SHA: `eb4accfb72fdf5acf9985b1ba65879df65e85ae1`
- Date: 2026-07-04.
- Acceptance criteria status: Passed. Jira live sync is implemented for already-linked issue mappings using encrypted server-side credentials, and no OpenRoad state or integration metadata schema migration was introduced.
- Commands run:
  - `pnpm vitest run server/jira-sync-worker.test.ts src/integrations/jira.test.ts src/persistence/openroadIntegrations.test.ts src/App.test.tsx` - passed, 74 tests.
  - `pnpm build:server` - passed.
  - `pnpm vitest run server/jira-sync-worker.test.ts server/linear-sync-worker.test.ts server/github-sync-worker.test.ts server/provider-sync-worker.test.ts server/http.test.ts src/persistence/openroadIntegrations.test.ts src/App.test.tsx src/integrations/jira.test.ts src/integrations/linear.test.ts src/integrations/github.test.ts` - passed, 179 tests.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` - passed with `[]`.
  - `pnpm check` - passed, 306 tests plus production client/server build.
  - `pnpm release:verify` - passed, dry-run manifest generated without writing.
  - Custom built-server Jira smoke with temporary state and fake Jira REST API - passed. Verified one `GET /ex/jira/jira-cloud/rest/api/2/issue/10042` call with bearer auth, bounded fields, successful sync job, updated linked request title, and no fake token or `access_token` text in responses or persisted files.
  - `pnpm ops:smoke -- --base-url http://127.0.0.1:4793 --workspace-id acme --admin-token ops-smoke-admin-token` - passed `health`, `contract`, `portal`, `private-denied`, and `private-token` against a temporary built server.
- Browser/viewports tested:
  - Built app at `1280x720` on `#settings`: Settings nav active, document dimensions stayed `1280x720`, Jira ready copy rendered, Jira manual sync button enabled, and no secret-shaped text rendered.
  - Built app at `390x844` on `#settings`: document dimensions stayed `390x844`, no horizontal overflow, Jira connected row visible inside the internal app scroll surface, Jira sync button enabled at `44px` high, and no secret-shaped text rendered.
- Accessibility checks: Jira manual sync action uses provider-specific accessible name `Jira sync linked issues`; Settings keeps `aria-current="page"` on the active nav item; sync readiness is expressed with text plus badge; mobile touch target height was verified at `44px`; no Sync logs navigation was added.
- Reviewer notes: Official Atlassian docs were used for OAuth setup shape, `api.atlassian.com/ex/jira/{cloudId}` REST routing, `GET /rest/api/2/issue/{issueIdOrKey}`, required read scope behavior, and rate-limit handling. The worker intentionally does not perform JQL search, project discovery, OAuth callback exchange, token refresh, webhook ingestion, provider write-back, or conflict resolution.
- Known unresolved risks: OAuth callback exchange, token refresh, Jira webhooks, provider write-back, conflict UI, scheduler packaging, distributed locks, and browser credential management remain later production slices.
- Rollback notes: Revert `eb4accfb72fdf5acf9985b1ba65879df65e85ae1` and this evidence commit, or remove `OPENROAD_TOKEN_ENCRYPTION_KEY` to disable the auto-configured Jira worker. Existing OpenRoad state schema `7` and integration metadata schema `3` remain compatible. If live sync changed request content unexpectedly, restore the pre-branch backup and rerun `pnpm ops:smoke`.
