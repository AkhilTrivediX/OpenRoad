# OpenRoad Modular Build Plan

This plan is standalone-first. Integrations are optional modules built after the native product loop works.

Each feature begins by creating a test checklist in `docs/TEST_STRATEGY.md` or a feature-specific checklist under `docs/test-plans/`.

Each feature must also satisfy `docs/PRODUCTION_READINESS.md` before merging to `main`.

## Current Stage

Current stage: Stage 3 Integration Beta hardening. `main` is production-checked for the shipped self-host and integration scopes, while Stage 4 public/hosted hardening remains explicit.

The standalone loop now covers workspaces, requests, triage, internal work, roadmap planning, changelog drafts, public portal preview, local durability, production APIs, basic tenancy boundaries, file-backed team metadata, audit events, structured operational events, self-host operations, owner browser sessions and owner sign-in for admin-token deployments, team invitation/account-access APIs, scoped member browser sessions from invitation tokens, server-side JSONL invitation delivery handoff, server-side HTTP invitation provider delivery, durable account password login for existing team users, JSONL account recovery handoff with reset-token confirmation, owner member-management UI/APIs with stale-session revocation, app-level crash recovery, a first app-module boundary, hardened public portal write APIs with persisted visitor vote identity, the provider-neutral integration adapter contract, a payload-backed GitHub issue import/link API, server-only GitHub App installation verification, live GitHub issue fetch through verified installations, signed GitHub/Linear/Jira webhooks for already-linked issue mappings, hosted GitHub App webhook registration with safe Linear/Jira blocked states, safe disconnect handling, encrypted server-only provider credential storage, provider-neutral background sync job foundations, GitHub/Linear/Jira workers for already-linked issue mappings, Linear/Jira OAuth callback exchange and refresh-token rotation, progressive Settings visibility with GitHub/Linear/Jira connect, credential, disconnect, manual sync, conflict resolution, and hosted webhook registration controls, explicit provider write-back for linked GitHub/Linear/Jira issues, Linear issue import/link, Jira issue import/link with explicit field mapping, requester notification preferences/outbox events plus JSONL delivery handoff and HTTP provider delivery, deterministic local assistant triage, and release candidate manifest tooling. The next production hardening should target real model-backed AI adapters, hosted SaaS hardening, dashboard/exporter observability, and managed persistence as separate slices.

## Feature 1: Workspace Shell

Branch: `feat/workspace-shell`

Build:

- App shell.
- Workspace creation and selection.
- Default navigation.
- Calm empty states.
- Basic design tokens.
- Demo workspace seed.

Acceptance:

- A user can enter OpenRoad and create/select a workspace.
- Default nav shows Inbox, Roadmap, Changelog, Portal, Settings.
- No integration is required.
- Current location is always visible.

## Feature 2: Standalone Requests

Branch: `feat/standalone-requests`

Build:

- Create, edit, archive requests.
- Vote and comment.
- Request statuses.
- Tags and requester metadata.
- Search and basic filters.

Acceptance:

- A user can capture and manage feedback without GitHub, Jira, or Linear.
- Requests are first-class OpenRoad objects.
- Empty, no-results, no-permission, and error states exist.

## Feature 3: Request Triage

Branch: `feat/request-triage`

Build:

- Inbox queue.
- Duplicate merge.
- Assignment.
- Saved views.
- Right inspector on selection.

Acceptance:

- A user can triage one request without leaving Inbox.
- No primary decision point shows more than four visible choices.
- Duplicate merge preserves source history.

## Feature 4: Internal Work Items

Branch: `feat/internal-work-items`

Build:

- Native OpenRoad work items.
- Link requests to work items.
- Owners, status, target date, comments.

Acceptance:

- Users can plan delivery inside OpenRoad without an external tracker.
- Linked work is useful even with zero integrations.

## Feature 4.5: Domain State And Persistence

Branch: `feat/domain-state-persistence`

Status: merged to `main`.

Build:

- Extract provider-neutral domain types and actions.
- Introduce reducer/store boundaries.
- Add stable ID helper.
- Add versioned local persistence.
- Add schema migration registry.
- Add workspace export/import.
- Add corrupt local state recovery.
- Add reset workspace data path.
- Preserve existing workspace, request, triage, and work item UX.

Acceptance:

- User-created workspaces, requests, comments, votes, triage edits, and work items survive reload.
- Existing demo workspace can still be reset or restored.
- Corrupt persisted data does not crash the app.
- Exported workspace data can be imported into a fresh browser state.
- Current standalone workflows pass unchanged.
- Future roadmap/changelog features can depend on durable request and work links.

## Production Foundation Track

These foundation branches are part of the product roadmap, not optional cleanup. They must happen before public portal, provider integrations, notifications, hosted beta, or self-host claims.

### App Module Decomposition

Branch: `feat/app-module-decomposition`

Status: merged to `main`.

Build:

- Split the monolithic app into feature modules.
- Move domain types/actions out of UI components.
- Add shared UI primitives.
- Add domain fixtures.
- Preserve the current UX.

Acceptance:

- Feature modules have clear ownership.
- Domain actions are not owned by React view components.
- Existing tests pass without behavior changes.

### API, Auth, And Tenancy Contract

Branch: `feat/api-auth-tenancy-contract`

Status: merged to `main`.

Build:

- API shape and error contract.
- Auth actor model.
- Workspace membership and role matrix.
- Public visitor/requester model.
- Permission test matrix.
- Cross-workspace isolation rules.

Acceptance:

- Portal and integration work have a real trust boundary before implementation.
- Public/private visibility is testable.
- Provider jobs have an installation-scoped actor model.

### Team SaaS Foundation

Branch: `feat/team-saas-foundation`

Status: merged to `main`.

Build:

- Backend API.
- Versioned team metadata schema.
- Workspace membership persistence.
- Workspace-scoped APIs.
- Server-side validation.
- Audit event persistence.
- Hosted deployment workflow scaffolding.
- Observability baseline.

Acceptance:

- A small team can use OpenRoad with isolated workspace data.
- Deployments can be smoke-tested and rolled back.
- Operational errors are visible without exposing logs in default navigation.

### Session Auth Foundation

Branch: `feat/session-auth-foundation`

Status: implemented and production-checked.

Build:

- Versioned file-backed session metadata.
- Admin-token login exchange for owner browser sessions.
- HttpOnly, SameSite=Lax owner session cookie.
- Session-token hashing, expiration, revocation, and admin-token rotation binding.
- Login/logout/session API contract.
- Same-origin browser persistence fetches with credentials.
- Deployment and security documentation.

Acceptance:

- Admin-token deployments can use the browser app without sending bearer tokens on every request.
- Bearer-token scripts, trusted proxy actors, single-user mode, and public portal access still work.
- Session secrets are not returned, logged, or persisted as raw token material.
- Deleting the session file signs out browsers without touching product, team, or integration data.

### Owner Login Experience

Branch: `feat/owner-login-experience`

Status: implemented and production-checked.

Build:

- Typed auth-required client path for server persistence.
- Owner sign-in surface for admin-token browser sessions.
- Admin-token login request with same-origin credentials.
- Server-state retry after successful login.
- Wrong-token and server-unavailable error states.
- Responsive Map Room sign-in plate with no page-level overflow.

Acceptance:

- Admin-token deployments show a focused browser sign-in instead of silently falling back to local data.
- Successful sign-in creates the owner session and opens the normal app shell.
- Wrong tokens stay on the sign-in surface without rendering token text.
- Non-auth server failures still preserve local browser fallback behavior.

### Team Invitations Foundation

Branch: `feat/team-invitations-foundation`

Status: implemented and production-checked.

Build:

- Team metadata schema `2` with invitation records.
- Owner-only workspace invitation create/list/revoke APIs.
- Public invitation accept API that creates or reuses users and workspace memberships.
- Raw accept tokens returned once and persisted only as hashes.
- Safe invitation summaries that omit token hashes.
- Audit events for create, revoke, and accept.
- Backup/restore validation for invitation-aware team metadata.
- API contract, deployment, readiness, and rollback documentation.

Acceptance:

- Owners can invite a teammate with a bounded workspace role.
- Non-owner actors cannot manage invitations.
- Accepted invitations create durable team users and memberships without authenticating a browser session.
- Revoked, accepted, expired, malformed, or wrong tokens cannot be accepted.
- Core OpenRoad product state, session data, and integration metadata remain separate from invitation data.

### Member Invite Sessions

Branch: `feat/member-invite-sessions`

Status: implemented and production-checked.

Build:

- Session metadata schema `2` with actor-aware owner and workspace-member session records.
- Public invitation session endpoint that accepts a valid pending token and creates a scoped httpOnly member session.
- Workspace-scoped `PUT /api/openroad/workspaces/:workspaceId` save path.
- Browser persistence fallback from owner-only full-state APIs to member workspace list/detail APIs.
- Owner/member sign-in surface that lets invitees join without the admin token.
- Safe backup/release schema notes and contract documentation for session metadata `2`.

Acceptance:

- Accepted invitation sessions create or reuse the user and membership, mark the invitation accepted, and set an httpOnly cookie.
- Member sessions cannot read or write `/api/openroad/state` and cannot cross workspace boundaries.
- Contributor or higher member sessions can save workspace-scoped data; viewer sessions remain read-only.
- Owner sessions remain admin-token-bound and keep full-state behavior.
- Raw invitation tokens, session secrets, admin tokens, and token hashes are never returned or persisted in browser-visible state.

### Invitation Email Delivery

Branch: `feat/invitation-email-delivery`

Status: implemented and production-checked.

Build:

- Server-side invitation delivery adapter contract.
- JSONL file handoff for self-host mail/helpdesk workers.
- `OPENROAD_INVITATION_DELIVERY_MODE`, `OPENROAD_INVITATION_DELIVERY_FILE`, and `OPENROAD_PUBLIC_APP_URL` configuration.
- Team metadata schema `3` with bounded invitation delivery status fields.
- Invite accept URLs that prefill the member join form through `?invite=`.
- Safe docs, backup/release schema notes, and failure handling.

Acceptance:

- Invitation delivery is disabled by default and preserves manual token copy behavior.
- File mode appends one sensitive JSONL record with the raw accept token and accept URL for an external worker.
- Raw accept tokens remain out of team metadata, list APIs, audit events, backups, and browser-visible persisted state.
- Delivery failures do not drop invitations; owners still receive the one-time token and can revoke or retry operationally.
- Member invite sessions, owner sessions, and workspace isolation continue to pass.

### Invitation Provider Delivery

Branch: `feat/invitation-provider-delivery`

Status: implemented and production-checked.

Build:

- Server-side HTTP invitation delivery adapter for mail/webhook providers.
- `OPENROAD_INVITATION_DELIVERY_HTTP_URL`, `OPENROAD_INVITATION_DELIVERY_HTTP_BEARER_TOKEN`, and `OPENROAD_INVITATION_DELIVERY_HTTP_TIMEOUT_MS` configuration.
- `OPENROAD_PUBLIC_APP_URL` requirement for provider mode so invite links use an operator-owned origin.
- HTTPS-only provider URL validation with localhost/loopback exceptions for local development.
- Redirect blocking, timeout handling, bounded provider response parsing, and redacted provider message ids/errors.
- HTTP provider creation tests that verify provider secrets and raw accept tokens stay out of persisted/browser-visible state.
- Deployment, contract, readiness, Docker, and README documentation for provider mode.

Acceptance:

- HTTP provider mode is disabled unless explicitly configured and remains standalone-compatible.
- Provider payloads contain recipient, workspace, role, subject/body, invitation id, expiration, and accept URL, but no admin tokens, session secrets, token hashes, or provider bearer secrets.
- Provider bearer tokens are sent only in the outbound authorization header and are never persisted or returned.
- Provider delivery success records only bounded delivery metadata.
- Provider failures, redirects, malformed responses, timeouts, and network errors keep invitations pending and usable with redacted failure metadata.
- Disabled delivery, JSONL delivery, invitation sessions, account password login, member management, public portal, integrations, ops, and release verification continue to pass.

### Account Auth Foundation

Branch: `feat/account-auth-foundation`

Status: implemented and production-checked.

Build:

- Team metadata schema `4` with per-user password credential records.
- Server-side password hashing and verification with per-credential salts.
- Authenticated account password set/change API for existing team users.
- Public email/password login API that creates scoped httpOnly member sessions.
- Multi-workspace membership guard that requires explicit workspace selection.
- Compact account/invite sign-in modes and Settings password update controls.
- Backup/release schema notes and account-auth rollback documentation.

Acceptance:

- Prior team metadata schemas migrate to `credentials: []`.
- Raw passwords are never persisted, returned, logged, or rendered in browser-visible state.
- Account login produces the same workspace-member permission boundary as invitation sessions.
- Multi-workspace users cannot accidentally sign into an ambiguous workspace.
- Owner sessions, bearer-token scripts, invitation sessions, invitation delivery, public portal, integrations, ops, and release verification continue to pass.

### Account Recovery Foundation

Branch: `feat/account-recovery-foundation`

Status: implemented and production-checked.

Build:

- Team metadata schema `5` with account recovery request records.
- Hashed, expiring, single-use reset tokens for existing credentialed team users.
- Public, enumeration-safe recovery request API.
- Public recovery confirmation API that sets a new password, consumes the token, revokes stale member sessions, and creates a fresh scoped member session.
- Server-side JSONL recovery delivery handoff using an operator-owned public base URL.
- Compact sign-in recovery/reset UI that consumes `?recovery=` or `?reset=` links and clears browser history.
- Backup/release schema notes and recovery rollback documentation.

Acceptance:

- Recovery delivery is disabled by default and standalone mode remains usable with no recovery delivery provider.
- Eligible requests append one sensitive JSONL handoff record only in file mode; unknown, ineligible, ambiguous, or disabled requests return the same generic response without writing raw reset tokens.
- Raw reset tokens are stored only as hashes in team metadata and are never returned by APIs, audit events, backups, or browser-visible state.
- Recovery confirmation rejects expired, consumed, malformed, or wrong tokens and old passwords stop working after a successful reset.
- Account password login, password change, invitation sessions, member management, owner sessions, public portal, integrations, ops, and release verification continue to pass.

### Member Management UI

Branch: `feat/member-management-ui`

Status: implemented and production-checked.

Build:

- Owner-only workspace member list API with sanitized user, membership, and account-password readiness fields.
- Owner-only membership role update API.
- Owner-only membership deactivation API that removes a workspace membership without deleting the user or credential record.
- Session-store revocation for active workspace-member sessions affected by role changes or deactivation.
- Last-owner and local-owner safeguards to prevent accidental lockout.
- Settings Access member ledger with credential readiness, role controls, and deactivation actions beside invitation management.
- Client persistence helper boundary and docs for API, deployment, readiness, rollback, and evidence.

Acceptance:

- Owners can list members, update roles, and deactivate non-protected memberships from Settings.
- Non-owners cannot list, update, or deactivate workspace members.
- Role changes and deactivation revoke stale member cookies for the affected user/workspace.
- Member responses never expose credential hashes, salts, session records, invitation token hashes, raw tokens, provider secrets, or private workspace state.
- The local owner bootstrap membership cannot be changed, and the last owner membership cannot be demoted or deactivated.
- Account password login, invitation sessions, owner sessions, bearer-token scripts, public portal, integrations, ops, and release verification continue to pass.

### Production Server Foundation

Branch: `feat/production-foundation`

Status: merged to `main`.

Build:

- Production Node server.
- Same-origin OpenRoad state API.
- File-backed state store with existing schema migration and validation.
- Public portal API projection.
- Production client sync with localStorage fallback.
- Production start path.

Acceptance:

- `pnpm start` serves the built app and API from one process.
- Server state persists outside browser localStorage.
- Invalid and future-schema writes are rejected.
- Public portal API does not leak private workspace data.
- Standalone local development remains optional and non-blocking.

### App Error Boundary Recovery

Branch: `feat/error-boundary-recovery`

Status: implemented and production-checked.

Build:

- Root-level React error boundary.
- Recovery fallback with retry.
- Local browser-data reset using the existing OpenRoad local persistence clear path.
- Privacy-safe fallback copy that does not expose stack traces or persisted data.

Acceptance:

- Unexpected React render errors show a recovery screen instead of a blank app.
- Users can retry without data loss.
- Users can clear only OpenRoad local browser data when local state is damaged.
- No external error reporting or data upload is introduced.

### Self-Host Operations Foundation

Branch: `feat/self-host-ops-foundation`

Status: merged to `main`.

Build:

- Docker Compose path.
- Admin bootstrap.
- Backup/restore.
- Upgrade notes.
- Environment and secret documentation.

Acceptance:

- Self-host is a real deployment path, not a late marketing checkbox.
- Backup and restore are documented before public release.

### Observability Foundation

Branch: `feat/observability-foundation`

Status: implemented and production-checked.

Build:

- Team metadata schema `6` with a durable bounded private operational event ledger.
- Sanitized event categories for server errors, notification delivery, integration sync, webhook ingestion, hosted webhook registration, state replacement, and workspace replacement.
- Private `GET /api/openroad/ops/events` API with workspace/provider/category/severity/limit filters.
- `GET /api/openroad/ops/status` summary for recent operational health signals and latest warning/error timestamps.
- Best-effort event recording helper so observability persistence failures do not break product workflows.
- Backup, restore, release, deployment, API contract, readiness, and test-plan documentation.

Acceptance:

- Operators can inspect recent structured events without scraping process logs.
- Events are bounded, private, and free of secrets, raw provider payloads, stack traces, environment dumps, and workspace exports.
- Workspace-scoped actors see only their own workspace events.
- Audit events remain the user/action history and are not replaced by ops events.
- Existing production gates remain green.

## Feature 5: Roadmap Now/Next/Later

Branch: `feat/roadmap-now-next-later`

Status: implemented and production-checked.

Build:

- Now, Next, Later roadmap.
- Public/private visibility per item.
- Link requests and work items.
- Stale and confidence indicators.

Acceptance:

- A user can move a request into roadmap.
- Public/private state is visible.
- Timeline is optional, not default.

Dependencies:

- `feat/domain-state-persistence` is merged.
- Roadmap visibility rules must align with the API/auth/tenancy contract before public portal work.

## Feature 6: Changelog Drafts

Branch: `feat/changelog-drafts`

Status: implemented and production-checked.

Build:

- Draft changelog entries.
- Pull from shipped roadmap or work items.
- Preview public wording.
- Link requesters for later notification.

Acceptance:

- Shipped work can become a changelog draft without duplicate manual writing.
- Private/internal details are not exposed by default.

Dependencies:

- Roadmap and work state must be durable.
- Public/private content boundaries must be defined.

## Feature 7: Public Portal

Branch: `feat/public-portal`

Status: implemented and production-checked.

Build:

- Public feedback board.
- Public roadmap.
- Public changelog.
- Search, vote, comment.
- Basic moderation.

Acceptance:

- External users can understand status without seeing internal complexity.
- Portal works for standalone OpenRoad objects.

Dependencies:

- Public/private visibility rules must be tested.
- Auth/requester/public visitor model must be defined.
- Abuse, moderation, and rate-limit plan must exist.

### Public Portal Hardening

Branch: `feat/public-portal-hardening`

Status: merged to `main`.

Build:

- Server-side public vote and comment endpoints.
- Requester identity normalization for public actions.
- Process-local public write rate limit.
- Public-only mutation responses.
- Validation for disabled portal settings, private requests, archived requests, and invalid comments.

Acceptance:

- Public writes cannot mutate private or archived requests.
- Public write responses never expose internal/private portal data.
- Repeated public writes can be rate-limited before persistence.

## Feature 8: Integration Adapter Contract

Branch: `feat/integration-adapter-contract`

Status: implemented and production-checked.

Build:

- Provider adapter interface.
- External objects and links.
- Sync job/result state.
- Sync conflict model.
- Deterministic provider object identity.
- Installation/workspace mapping validation.
- Provider fixture validation.

Acceptance:

- Provider objects attach to OpenRoad objects.
- Core workflows do not change when no provider exists.
- No provider-specific fields appear in core domain tables.

Dependencies:

- Core objects must be durable.
- Provider anti-corruption boundary must be defined.
- API/auth/tenancy contract must define integration actors.

## Feature 9: GitHub Issue Sync

Branch: `feat/github-issue-sync`

Status: implemented and production-checked.

Build:

- GitHub installation metadata model.
- Payload-backed GitHub issue import/link API.
- Re-import updates mapped requests instead of creating duplicates.
- Pull request external mappings.
- File-backed integration metadata store.
- Backup/restore support for integration metadata.
- Workspace-scoped access and audit events.

Acceptance:

- GitHub enriches OpenRoad but remains optional.
- Disconnecting GitHub does not delete or corrupt core OpenRoad objects.
- GitHub mappings stay outside the core OpenRoad workspace schema.
- At this GitHub import/link slice, live OAuth/user tokens, background polling, and conflict UI remained deferred to later slices. Conflict UI was completed in Feature 11H.

## Feature 9A: GitHub App Installation

Branch: `feat/github-app-installation`

Status: implemented and production-checked.

Build:

- GitHub App setup URL/status API.
- Server-only GitHub App credential handling.
- Installation permission verification.
- Owner/admin-only integration management permission.
- Workspace-scoped installation metadata persistence.
- Explicit secret redaction at API and store boundaries.

Acceptance:

- Workspace owners can verify a GitHub App installation before live issue fetch.
- Tokens and private keys never enter browser bundles or audit logs.
- Existing payload-backed import remains usable for tests and self-host operators.

## Feature 9B: GitHub Live Issue Fetch

Branch: `feat/github-live-issue-fetch`

Status: implemented and production-checked.

Build:

- Installation access token generation without persistence.
- Live issue fetch for verified installations.
- Import selected live GitHub issues through the existing payload-backed mapper.
- Token-free issue preview responses.

Acceptance:

- Users can import GitHub issues without pasting payloads.
- Installation tokens are short-lived and never persisted.
- Existing standalone and payload-backed paths remain usable.

## Feature 9C: GitHub Webhook And Disconnect Hardening

Branch: `feat/github-webhook-disconnect`

Status: implemented and production-checked.

Build:

- Webhook endpoint with signature verification.
- Idempotent issue event handling.
- Disconnect flow that preserves OpenRoad data.
- Hidden sync log/audit surface for GitHub sync events.

Acceptance:

- GitHub events cannot mutate OpenRoad without valid signatures.
- Disconnecting GitHub stops future sync without deleting OpenRoad requests.
- Existing manual import and live fetch paths remain usable.

## Feature 10: Linear Issue Sync

Branch: `feat/linear-issue-sync`

Status: implemented and production-checked.

Build:

- Safe Linear OAuth setup URL, signed state, and callback credential exchange.
- Payload-backed Linear issue import/link.
- Linear installation and issue mappings in integration metadata.
- Sync owner and status.

Acceptance:

- Linear uses the same adapter contract.
- No Linear-specific logic leaks into core screens.
- Linear tokens and client secrets are not persisted or returned.

## Feature 11: Jira Issue Sync

Branch: `feat/jira-issue-sync`

Status: implemented and production-checked.

Build:

- Safe Atlassian OAuth setup URL, signed state, and callback credential exchange.
- Payload-backed Jira issue import/link.
- Explicit Jira field mapping for status category, ADF description text, project, type, priority, assignee, reporter, and labels.
- Jira installation and issue mappings in integration metadata.
- Sync audit trail for import/update actions.

Acceptance:

- Jira complexity stays in mapping and Settings.
- Core UX remains the same as standalone mode.
- Jira tokens and client secrets are not persisted or returned.

## Feature 11A: Provider Token Storage

Branch: `feat/provider-token-storage`

Status: implemented and production-checked.

Build:

- Integration metadata schema `2` with credential records.
- AES-256-GCM server-only token sealing behind `OPENROAD_TOKEN_ENCRYPTION_KEY`.
- Provider-neutral credential create/list/revoke APIs guarded by `integration:manage`.
- Installation/provider/workspace scope validation.
- Safe revocation on manual and signed GitHub installation disconnect.
- Backup, restore, release, and runbook notes for sensitive integration metadata.

Acceptance:

- Standalone mode works with zero credentials and no encryption key.
- Credential APIs return only metadata and never return tokens or encrypted payload internals.
- Background sync and provider write-back now have a server-only secret boundary to build on.

## Feature 11B: Background Sync Foundation

Branch: `feat/background-sync-foundation`

Status: implemented and production-checked.

Build:

- Integration metadata schema `3` with provider-neutral sync jobs.
- Enqueue and private runner APIs.
- Dedupe, due-job claim, running-job lease recovery, completion, retryable failure, fatal failure, and history trimming helpers.
- Process-local integration metadata mutation lane for the file-backed store.
- Server-side worker adapter boundary, disabled by default.
- Sanitized/redacted job responses and backup/restore/release schema notes.

Acceptance:

- Sync work is durable, bounded, and private before each provider-specific worker is added.
- Standalone mode remains usable with no integrations and no sync adapter.
- Job metadata never stores provider tokens, encrypted credential payloads, raw provider payloads, webhook headers, or unredacted worker failure text.

## Feature 11C: GitHub Sync Worker

Branch: `feat/github-sync-worker`

Status: implemented and production-checked.

Build:

- Server-side GitHub sync worker auto-wired when GitHub App credentials are configured.
- Targeted live issue fetch by mapped repository issue number, avoiding list pagination gaps.
- Refresh of already-linked GitHub issue mappings only; no surprise unmapped issue import.
- Request updates through the established GitHub mapper and mapping `lastSyncedAt` updates.
- Retryable/fatal worker result mapping with sanitized count-only summaries.

Acceptance:

- Private runner processes GitHub jobs when configured and stays `503 not_configured` when not.
- Linked GitHub-backed requests refresh without persisting or returning installation tokens.
- Standalone mode, Linear/Jira queued jobs, webhooks, disconnect, backup/restore, and release checks continue to pass.

## Feature 11D: Settings Integrations UI

Branch: `feat/settings-integrations-ui`

Status: implemented and production-checked.

Build:

- Progressive Settings integration control surface using the Dark Map Room shell.
- Sanitized workspace-scoped integration status endpoint.
- Browser integration client with standalone, forbidden, unavailable, and ready states.
- GitHub manual sync action that enqueues linked-issue sync and attempts the private runner.
- Bounded recent sync summaries inside Settings without adding Sync logs to primary navigation.

Acceptance:

- Standalone mode remains useful with no server integration metadata.
- Settings shows GitHub, Jira, and Linear readiness honestly without copying provider metadata into workspace state.
- GitHub manual sync never exposes provider secrets and uses existing queue/runner boundaries.
- Linear and Jira manual sync are enabled only when encrypted server-side credentials and linked mappings exist.

## Feature 11E: Linear Sync Worker

Branch: `feat/linear-sync-worker`

Status: implemented and production-checked.

Build:

- Server-side Linear GraphQL client with injectable fetch and bounded provider errors.
- Server-side Linear sync worker using encrypted provider credentials from the token vault.
- Provider sync dispatcher so GitHub and Linear workers can coexist behind the private runner.
- Refresh of already-linked Linear issue mappings only; no surprise unmapped issue import.
- Request updates through the established Linear mapper and mapping `lastSyncedAt` updates.
- Settings manual sync enablement for Linear only when worker, active credential, active installation, and linked issue mapping are present.

Acceptance:

- Private runner processes Linear jobs when encrypted credentials are ready and stays `503 not_configured` when no provider worker is available.
- Linked Linear-backed requests refresh without persisting or returning Linear access tokens.
- GitHub worker behavior, standalone mode, Jira queued jobs, backup/restore, and release checks continue to pass.

## Feature 11F: Jira Sync Worker

Branch: `feat/jira-sync-worker`

Status: implemented and production-checked.

Build:

- Server-side Jira Cloud REST client with injectable fetch and bounded provider errors.
- Server-side Jira sync worker using encrypted provider credentials from the token vault.
- Provider sync dispatcher parity across GitHub, Linear, and Jira workers.
- Refresh of already-linked Jira issue mappings only; no JQL search, project listing, or surprise unmapped issue import.
- Request updates through the established Jira mapper and mapping `lastSyncedAt` updates.
- Settings manual sync enablement for Jira only when worker, active credential, active installation, and linked issue mapping are present.

Acceptance:

- Private runner processes Jira jobs when encrypted credentials are ready and stays `503 not_configured` when no provider worker is available.
- Linked Jira-backed requests refresh without persisting or returning Atlassian access tokens.
- GitHub and Linear worker behavior, standalone mode, backup/restore, and release checks continue to pass.

## Feature 11G: Provider Connect/Disconnect UI

Branch: `feat/provider-connect-disconnect-ui`

Status: implemented and production-checked.

Build:

- Provider-neutral manual installation create/list/disconnect APIs for GitHub, Linear, and Jira.
- Settings-managed GitHub App verification, manual provider connection bootstrap, credential metadata list/store/revoke, provider disconnect, and status refresh.
- Generic browser integration helpers that use same-origin credentials and parse only sanitized installation/credential metadata.
- Integration status summaries that keep active accounts separate from bounded disconnected account metadata.
- Compact Dark Map Room provider management drawer with advanced fields behind native disclosure.

Acceptance:

- Standalone mode remains useful with no provider connection.
- Workspace owners can create manual GitHub/Linear/Jira installation metadata without API scripting.
- Provider credentials are submitted only to the same-origin server, encrypted there, and never returned to browser-visible state.
- Disconnect revokes active credentials, disconnects mappings, preserves OpenRoad data, and keeps legacy GitHub App disconnect behavior compatible.
- Desktop and mobile Settings QA shows no body-level scroll, no horizontal overflow, and no nested-card clutter.

## Feature 11H: Provider Conflict Resolution UI

Branch: `feat/conflict-resolution-ui`

Status: implemented and production-checked.

Build:

- Sanitized provider status conflict summaries for linked issue mappings.
- Conflict resolution API for keep-OpenRoad, accept-provider, and disconnect-mapping actions.
- Server-only GitHub App and encrypted Linear/Jira credential reads for accept-provider resolution.
- Compact Settings callout that appears only for conflicted providers.
- Audit and sync events for conflict resolution outcomes.

Acceptance:

- Standalone and healthy provider workflows stay uncluttered.
- Owners can resolve conflicted GitHub, Linear, and Jira issue mappings without browser-visible provider secrets.
- Accept-provider updates only the linked OpenRoad request through the existing provider sync transforms.
- Disconnect-mapping affects only the selected mapping.

## Feature 11I: Hosted Webhook Registration

Branch: `feat/hosted-webhook-registration`

Status: implemented and production-checked.

Build:

- Provider-neutral webhook registration metadata.
- Workspace-scoped webhook registration API.
- Safe GitHub App webhook configuration from server-only settings.
- Blocked/not-supported registration states for providers where OpenRoad cannot verify future deliveries from a server-known secret.
- Compact Settings registration controls only when the server reports a safe capability.

Acceptance:

- Hosted registration never asks the browser for provider secrets, webhook secrets, callback URLs, private keys, or raw provider config.
- GitHub App webhook registration is auditable, idempotent, and sanitized.
- OpenRoad does not create Linear or Jira provider webhooks that its current signature verifier cannot validate.
- Existing signed webhook ingestion, provider sync, write-back, conflict resolution, standalone, and release gates remain green.

## Feature 12: Requester Notifications

Branch: `feat/requester-notifications`

Status: implemented and production-checked.

Build:

- Notification preferences.
- Status-change updates.
- Changelog publish updates.
- Anti-spam controls.
- Internal outbox without external delivery.

Acceptance:

- Requesters can be notified when relevant work ships.
- Notifications are useful and controllable.
- Public portal and changelog previews do not leak private notification state.

## Feature 12A: Requester Notification Provider Delivery

Branch: `feat/requester-notification-provider-delivery`

Status: implemented and production-checked.

Build:

- HTTP requester notification provider delivery adapter.
- Server-only provider endpoint and optional bearer-token configuration.
- HTTPS/loopback URL validation, redirect blocking, timeout handling, bounded provider response parsing, and redacted provider errors/message ids.
- Provider payloads derived only from public-safe queued notification summaries and workspace context.
- Operator docs, focused tests, smoke evidence, and rollback notes.

Acceptance:

- OpenRoad can deliver queued requester notifications to an operator-controlled HTTP provider without exposing provider secrets to the browser.
- File delivery mode remains unchanged.
- Failed provider calls leave events queued for retry with bounded redacted errors.
- Re-running delivery does not duplicate already delivered provider messages.
- Public portal, workspace APIs, notification preferences, release verification, and standalone mode remain green.

## Feature 13: AI Assistance

Branch: `feat/ai-assisted-triage`

Status: implemented and production-checked.

Build:

- Duplicate suggestions.
- Request summaries.
- Changelog draft suggestions.
- Explanation UI for suggestions.
- Deterministic local-only assistant engine for the first production-safe slice.
- Explicit approval before creating a private changelog draft.
- Session-level pause control for assistant suggestions.
- Generic changelog public fields until a maintainer writes approved copy.

Acceptance:

- AI never silently changes source-of-truth data.
- Every AI action is inspectable and requires human approval.
- No assistant suggestion is persisted or sent to external model APIs in this slice.
- Assistant-generated changelog public fields do not copy private request, work, or roadmap source text.

## Feature 13A: Model Adapter Foundation

Branch: `feat/model-adapter-foundation`

Status: implemented and production-checked.

Build:

- Shared deterministic assistant core for browser and server fallback.
- Private server assistant endpoint for selected-request triage.
- Server-side model adapter contract with deterministic fallback and OpenAI Responses API provider.
- Explicit request-level consent before external model use.
- Bounded, redacted, code-managed prompt context.
- Defensive model output parsing and validation.
- Audit and structured operational events for model use, fallbacks, and failures.
- Operator docs, focused tests, smoke evidence, and rollback notes.

Acceptance:

- OpenRoad remains useful with no AI provider configured.
- External model calls never happen from browser code and never happen without explicit consent.
- Model-backed output can refine only selected-request summary and next action in this foundation slice.
- Deterministic duplicate suggestions and changelog draft suggestions remain bounded, generic, and approval-only.
- API responses, audit events, operational events, logs, backups, and release evidence never expose API keys, raw prompts, raw model responses, private notes, internal comments, hidden comments, notification bodies, provider secrets, or raw provider payloads.
- Existing standalone, portal, integration, notification, team, release, and self-host checks remain green.

## Feature 13B: Assistant Consent UI

Branch: `feat/assistant-consent-ui`

Status: implemented; production verification in progress.

Build:

- Compact server-backed consent controls inside the existing assistant inspector.
- Deterministic local suggestions as the default visible state.
- Explicit workspace-context consent before model refresh is enabled.
- Optional requester-identity consent that stays subordinate to workspace-context consent.
- Typed browser helper for the private assistant triage endpoint.
- Safe loading, model-success, fallback, and endpoint-failure copy.
- Session-only model result state that clears on selected request or workspace changes.
- Browser QA, focused tests, design detector evidence, smoke evidence, and rollback notes.

Acceptance:

- Standalone OpenRoad does not require or expose model controls.
- Server-backed users can explicitly request model-assisted summary refinement without leaving the selected-request inspector.
- Browser requests never include provider config, raw prompt data, raw provider responses, private notes, hidden/internal comments, notification bodies, provider payloads, or secrets.
- Model/fallback status is understandable to users without exposing provider internals.
- Model-backed output stays advisory and cannot mutate OpenRoad source-of-truth data.
- Existing assistant duplicate suggestions, private changelog draft approval, public portal, integrations, notifications, team access, release, and self-host checks remain green.

## Feature 13C: Workspace AI Policy Settings

Branch: `feat/workspace-ai-policy-settings`

Status: planned.

Build:

- Workspace-level policy for whether model-assisted triage is allowed.
- Owner/maintainer-facing policy controls that stay out of first-use Inbox complexity.
- Deterministic assistant fallback when policy disables model use.
- Request-level consent remains required even when workspace policy allows model use.
- Audit/operational evidence for policy changes and blocked model requests.
- Docs, focused tests, browser QA if UI changes, smoke evidence, and rollback notes.

Acceptance:

- Workspace policy cannot enable model use without server-side provider configuration and request-level consent.
- Workspace members get clear disabled-state copy when policy blocks model assist.
- Standalone/local OpenRoad behavior is unchanged.
- No provider config, raw prompts, raw responses, secrets, private notes, hidden/internal comments, notification bodies, or provider payloads are exposed through policy UI.

## Feature 14: Public Release Operations

Branch: `feat/public-release-ops`

Status: implemented and production-checked.

Build:

- Release candidates.
- Semantic versioning.
- Docker image publishing plan and dry-run manifest representation.
- Signed release artifact hooks when signing infrastructure is configured.
- Security patch process.
- Support windows.
- Billing/admin hardening if hosted subscription is enabled.
- Self-host upgrade documentation.
- Release candidate manifest helper with artifact checksums.
- CI dry-run release verification.

Acceptance:

- SaaS and self-host releases can be versioned, tested, and rolled back.
- Free self-host remains useful.
- Hosted and self-host paths share the same core product behavior.
- Security patches have an explicit release path.
- Docker publishing and signing are represented honestly as dry-run/not-configured unless external infrastructure is supplied.
