# Feature Test Plan: Team Invitations Foundation

Branch: `feat/team-invitations-foundation`

## Objective

Add a production-safe invitation and account-access foundation on top of OpenRoad team metadata and owner sessions, without introducing unfinished password auth or OAuth account login.

## User Story

As an OpenRoad workspace owner, I need to invite a teammate to a workspace with a bounded role, inspect pending invitations, revoke mistakes, and have accepted invitations create durable user and membership records. As an operator, I need invitation tokens to stay secret, auditable, and separate from core product state.

## Scope

- Versioned team metadata upgrade for invitation records.
- Invitation creation, listing, revocation, and acceptance APIs.
- Hashed invitation tokens only; raw accept token is returned once on creation.
- Workspace role validation for Owner, Maintainer, Contributor, and Viewer.
- Workspace-scoped permission checks for invitation management.
- Acceptance that creates or reuses a team user and workspace membership.
- Audit events for create, revoke, and accept.
- Session/workspace metadata includes safe invitation summaries where appropriate.
- Backup/restore validation remains compatible with the upgraded team state.
- Documentation for API contract, production readiness, deployment, rollback, and limits.

## Not In Scope

- Password login.
- OAuth account login.
- Email delivery of invitations.
- Account recovery or password reset.
- User profile editing UI.
- Browser Settings UI for invitation management.
- Hosted billing/admin console.

## Acceptance Criteria

- Owners can create a pending invitation for a workspace and role.
- Maintainers, contributors, viewers, public visitors, requesters, and integration actors cannot create or revoke invitations.
- Invitation creation rejects unknown workspaces, malformed email, invalid roles, and missing team store.
- Invitation list returns only safe metadata and never returns accept token hashes.
- Revoke marks a pending invitation revoked and leaves users/memberships untouched.
- Accepting a valid invitation creates or reuses a team user, creates a workspace membership, and marks the invitation accepted.
- Accepted, revoked, expired, malformed, or wrong tokens cannot be accepted again.
- Invitation tokens are generated with cryptographic randomness and stored as hashes only.
- Core OpenRoad workspace state is not polluted with user, token, or invitation data.
- Existing owner session, bearer-token, trusted-proxy, public portal, integration, and notification paths continue to pass.

## Automated Test Checklist

- Team store migrates schema v1 state to v2 with empty invitations.
- Team store creates invitations with bounded email/name/role/workspace fields.
- Team store persists only the invitation token hash, not the raw token.
- Team store lists safe invitation metadata.
- Team store revokes a pending invitation and refuses revoked/accepted/expired invitations.
- Team store accepts a valid token, creates/reuses a user, creates membership once, and marks accepted metadata.
- Team store rejects future schema versions and recovers corrupt state as before.
- API contract lists invitation routes.
- `POST /api/openroad/workspaces/:workspaceId/invitations` enforces `integration:manage`.
- `GET /api/openroad/workspaces/:workspaceId/invitations` enforces `integration:manage`.
- `POST /api/openroad/workspaces/:workspaceId/invitations/:invitationId/revoke` enforces `integration:manage`.
- `POST /api/openroad/invitations/accept` is public but only accepts a valid token.
- Invitation API responses omit token hashes and return raw accept token only on creation.
- Acceptance records audit events without token material.
- `GET /api/openroad/session` and workspace list continue returning safe memberships.
- `pnpm check` passes.

## Regression Checklist

- Single-user mode remains owner-capable without invitation setup.
- Admin-token owner sessions still sign in and access private routes.
- Bearer-token operational routes still work.
- Trusted proxy workspace-member role checks still work.
- Public portal read/write endpoints remain public and do not expose invitations.
- GitHub, Linear, Jira integration routes keep their permission checks.
- Notification delivery and release verification still pass.
- Backup and restore continue validating team metadata.

## Security And Privacy Checks

- Raw invitation tokens are never persisted, audited, logged, or returned after creation.
- Invitation token hashes are never returned in JSON API responses.
- Accept responses do not authenticate a browser session or expose private workspace state.
- Invitation acceptance uses bounded inputs and generic invalid-token errors.
- Invitation management requires Owner permission through the existing `integration:manage` gate.
- Audit summaries include email/workspace/action context but not token material.
- Rollback preserves core product state even if team invitation metadata is discarded.

## Manual QA Checklist

- Run `pnpm vitest run server/team.test.ts server/http.test.ts scripts/openroad-ops.test.mjs`.
- Run `pnpm check`.
- Run `pnpm release:verify`.
- Start built server in admin-token mode and verify bearer-token invitation create/list/revoke/accept smoke through API.
- Verify created team metadata contains a token hash but not the raw accept token.
- Verify public portal still loads without an authenticated session.

## Evidence

- Branch: `feat/team-invitations-foundation`
- Commit SHA: pending.
- Date: 2026-07-05.
- Commands run:
  - `pnpm vitest run server/team.test.ts server/http.test.ts scripts/openroad-ops.test.mjs`: 94 tests passed.
  - `pnpm vitest run server/team.test.ts server/http.test.ts scripts/openroad-ops.test.mjs scripts/openroad-release.test.mjs`: 100 tests passed.
  - `pnpm check`: 329 tests passed; client and server production builds passed.
  - Built-server invitation smoke in admin-token mode: create/list/accept/revoke passed, raw accept token was not persisted, list/accept responses did not expose token material, repeated accept returned `400`, and public portal still loaded.
  - `pnpm release:verify`: dry-run release manifest generated with `team metadata schema 2` rollback notes.
- Browser/viewports tested: No visual UI changes in this slice.
- Accessibility checks: No visual UI changes in this slice.
- Reviewer notes: Backend/API slice only. Invitation data remains in team metadata, separate from core OpenRoad state, sessions, and integration metadata. Acceptance creates durable user and membership records but intentionally does not authenticate the accepted user into a browser session.
- Known unresolved risks: Password auth, OAuth account login, email invitation delivery, account recovery, session upgrade from accepted invite, and invitation management UI remain future production slices.
- Rollback notes: Revert branch; team metadata schema v2 invitation records can be discarded after backup while core OpenRoad state, sessions, and integrations remain separate.
