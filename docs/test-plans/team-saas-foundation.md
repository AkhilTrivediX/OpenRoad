# Feature Test Plan: Team SaaS Foundation

Branch: `feat/team-saas-foundation`

## Objective

Add the first durable team and operations foundation behind the API/auth/tenancy contract so OpenRoad can move from single-user production foundation toward a small-team beta without weakening standalone mode.

## User Story

As a future OpenRoad team owner, I need server-side workspace membership, tenant-aware workspace APIs, audit events for private mutations, and a deployable production path so the product can safely support more than one person later.

## Scope

- Versioned team metadata store.
- Users and workspace memberships.
- Audit events for private state writes and action mutations.
- Workspace list API filtered by actor scope.
- Session API exposing the current actor and allowed memberships.
- Audit event API filtered by workspace permissions.
- Operations status API for store and runtime health.
- Environment documentation for team metadata storage.
- CI workflow that runs the production gate.
- Deployment documentation for production server, data files, rollback, and token mode.

## Not In Scope

- OAuth/session cookies.
- Password login.
- Managed SQL database.
- Billing/admin UI.
- Email invitations.
- Provider integrations.
- Webhook handling.
- Background job queue.

## Acceptance Criteria

- Team metadata has a schema version and migration/validation path.
- Missing team metadata initializes from existing OpenRoad workspaces without losing standalone usability.
- Team metadata persists users, memberships, and audit events outside browser localStorage.
- Workspace list API returns only workspaces the actor can read.
- Session API returns current actor and accessible memberships without exposing secrets.
- Workspace member cannot list or inspect another workspace.
- Private state replacement writes an audit event.
- Workspace-scoped actions write audit events with workspace id and request id.
- Audit events are filtered by actor permissions.
- Ops status reports store health and runtime basics without exposing logs or secrets.
- CI workflow runs install from lockfile and `pnpm check`.
- Deployment docs explain admin token, data files, smoke test, backup, and rollback.

## Automated Test Checklist

- Team store seeds local-owner memberships for all existing workspaces when metadata is missing.
- Team store persists a new audit event and reloads it from disk.
- Team store rejects future schema versions.
- Team store recovers corrupt metadata by backing it up and reseeding.
- `GET /api/openroad/session` returns local owner and memberships in single-user mode.
- `GET /api/openroad/workspaces` returns all workspace summaries for local owner.
- Workspace member sees only their own workspace summary.
- Workspace member is forbidden from reading another workspace summary.
- State replacement records an audit event.
- Workspace-scoped action records an audit event.
- Audit event API returns own workspace events to workspace member.
- Audit event API denies cross-workspace reads.
- Ops status endpoint requires private read permission.
- Existing API/auth/tenancy, server store, domain, and app tests still pass.

## Regression Checklist

- Single-user mode remains usable without `OPENROAD_ADMIN_TOKEN`.
- Admin token mode still protects full-state APIs.
- Public portal remains unauthenticated and private-data-safe.
- Existing localStorage fallback remains intact.
- Workspace creation and selection still work.
- Standalone request, triage, work, roadmap, changelog, and portal workflows still pass.
- Production server still serves app routes and assets.

## Security And Privacy Checks

- No secrets are committed.
- `.env.example` uses placeholder values only.
- Audit events do not store full request bodies or private notes.
- Ops status does not expose logs, tokens, environment dumps, or filesystem contents.
- CI does not require secrets.
- Workspace-scoped APIs deny authenticated cross-workspace access with `403`.

## Migration And Rollback

- Team metadata schema starts at version `1`.
- Rollback by reverting this branch and preserving `OPENROAD_TEAM_FILE` as metadata backup.
- OpenRoad state JSON remains compatible with the previous production foundation.
- Corrupt team metadata is backed up before reseeding.

## Manual QA Checklist

- Run `pnpm check`.
- Start production server without `OPENROAD_ADMIN_TOKEN`; verify session, workspace list, state write audit, and ops status.
- Start production server with `OPENROAD_ADMIN_TOKEN`; verify private APIs deny unauthenticated requests and accept bearer token.
- Browser QA production app at desktop and compact widths for fixed-shell regression.

## Evidence

- Branch: `feat/team-saas-foundation`
- Commit SHA: Pending.
- Date: 2026-07-04.
- Commands run:
  - `pnpm vitest run server/team.test.ts server/access.test.ts server/http.test.ts server/store.test.ts`: 33 tests passed.
  - `pnpm check`: 91 tests passed; client and server production builds passed.
  - Production smoke without `OPENROAD_ADMIN_TOKEN`: health `200`, session local owner, 2 memberships, 2 workspaces, ops status `200`.
  - Production smoke with `OPENROAD_ADMIN_TOKEN`: health `200`, unauthenticated ops status `403`, authenticated ops status `200`, public portal `200`.
- Browser/viewports tested:
  - Production server on port `4196`, `1440x900`: root rendered, body overflow hidden, app shell height matched viewport, no horizontal overflow, operations deck owned scrolling.
  - Production server on port `4196`, `390x844`: root rendered, body overflow hidden, app shell height matched viewport, no horizontal overflow, operations deck owned scrolling.
- Accessibility checks: No visual UI changes expected.
- Reviewer notes: Subagent audit completed read-only; full-state leak risk was addressed by making global actions owner/admin-only and adding workspace-scoped action responses that return only `{ workspace, revision }`.
- Known unresolved risks: OAuth/session UI, managed database, invitation flows, hosted secrets management, and background jobs remain future production slices.
- Rollback notes: Revert branch; preserve `OPENROAD_DATA_FILE` and `OPENROAD_TEAM_FILE`.
