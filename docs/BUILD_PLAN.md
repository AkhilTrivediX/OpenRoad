# OpenRoad Modular Build Plan

This plan is standalone-first. Integrations are optional modules built after the native product loop works.

Each feature begins by creating a test checklist in `docs/TEST_STRATEGY.md` or a feature-specific checklist under `docs/test-plans/`.

Each feature must also satisfy `docs/PRODUCTION_READINESS.md` before merging to `main`.

## Current Stage

Current stage: Stage 2 Team Beta foundation in progress.

The standalone loop now covers workspaces, requests, triage, internal work, roadmap planning, changelog drafts, public portal preview, local durability, production APIs, basic tenancy boundaries, file-backed team metadata, audit events, self-host operations, app-level crash recovery, a first app-module boundary, hardened public portal write APIs with persisted visitor vote identity, the provider-neutral integration adapter contract, a payload-backed GitHub issue import/link API, server-only GitHub App installation verification, live GitHub issue fetch through verified installations, signed GitHub webhooks, safe disconnect handling, encrypted server-only provider credential storage, provider-neutral background sync job foundations, GitHub/Linear/Jira workers for already-linked issue mappings, progressive Settings visibility with GitHub/Linear/Jira manual sync controls, Linear issue import/link, Jira issue import/link with explicit field mapping, requester notification preferences/outbox events plus JSONL delivery handoff, deterministic local assistant triage, and release candidate manifest tooling. The next production work should continue hardening provider connect/disconnect, webhooks, direct email/provider notification delivery, and real model-backed AI adapters as separate slices.

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

## Feature 5: Roadmap Now/Next/Later

Branch: `feat/roadmap-now-next-later`

Status: active.

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
- Live OAuth/user tokens, background polling, and conflict UI remain deferred to later GitHub slices.

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

- Safe Linear OAuth setup URL and state.
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

- Safe Atlassian OAuth setup URL and state.
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

## Feature 14: Public Release Operations

Branch: `feat/public-release-ops`

Status: implemented and production-checked.

Build:

- Release candidates.
- Semantic versioning.
- Docker image publishing.
- Signed release artifacts if applicable.
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
