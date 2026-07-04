# OpenRoad Modular Build Plan

This plan is standalone-first. Integrations are optional modules built after the native product loop works.

Each feature begins by creating a test checklist in `docs/TEST_STRATEGY.md` or a feature-specific checklist under `docs/test-plans/`.

Each feature must also satisfy `docs/PRODUCTION_READINESS.md` before merging to `main`.

## Current Stage

Current stage: Stage 2 Team Beta foundation in progress.

The standalone loop now covers workspaces, requests, triage, internal work, roadmap planning, changelog drafts, public portal preview, local durability, production APIs, basic tenancy boundaries, file-backed team metadata, audit events, self-host operations, a first app-module boundary, hardened public portal write APIs, the provider-neutral integration adapter contract, a payload-backed GitHub issue import/link API, server-only GitHub App installation verification, and live GitHub issue fetch through verified installations. The next production work should add webhook/disconnect hardening before broader provider rollout.

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
- Live OAuth/user tokens and webhooks remain deferred to later GitHub slices.

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

Status: next.

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

Build:

- Linear OAuth flow.
- Import/link Linear issues/projects.
- Sync owner and status.

Acceptance:

- Linear uses the same adapter contract.
- No Linear-specific logic leaks into core screens.

## Feature 11: Jira Issue Sync

Branch: `feat/jira-issue-sync`

Build:

- Jira OAuth flow.
- Import/link Jira issues.
- Explicit field mapping.
- Sync audit and conflict handling.

Acceptance:

- Jira complexity stays in mapping and Settings.
- Core UX remains the same as standalone mode.

## Feature 12: Requester Notifications

Branch: `feat/requester-notifications`

Build:

- Notification preferences.
- Status-change updates.
- Changelog publish updates.
- Anti-spam controls.

Acceptance:

- Requesters can be notified when relevant work ships.
- Notifications are useful and controllable.

## Feature 13: AI Assistance

Branch: `feat/ai-assisted-triage`

Build:

- Duplicate suggestions.
- Request summaries.
- Changelog draft suggestions.
- Explanation UI for suggestions.

Acceptance:

- AI never silently changes source-of-truth data.
- Every AI action is inspectable and requires human approval.

## Feature 14: Public Release Operations

Branch: `feat/public-release-ops`

Build:

- Release candidates.
- Semantic versioning.
- Docker image publishing.
- Signed release artifacts if applicable.
- Security patch process.
- Support windows.
- Billing/admin hardening if hosted subscription is enabled.
- Self-host upgrade documentation.

Acceptance:

- SaaS and self-host releases can be versioned, tested, and rolled back.
- Free self-host remains useful.
- Hosted and self-host paths share the same core product behavior.
- Security patches have an explicit release path.
