# Feature Test Plan: Account Auth Foundation

Branch: `feat/account-auth-foundation`

## Objective

Add a durable account-login foundation so invited OpenRoad users can return with an email/password account instead of relying on a one-time invitation token, while preserving the current admin-token owner mode, member sessions, and workspace isolation boundaries.

## User Story

As an invited teammate, after I accept an invitation and enter the workspace once, I can set a password for my OpenRoad account and later sign in with email and password. As an owner/operator, I need password credentials to stay server-side, hashed, scoped to existing team users, and unable to grant access to workspaces the user does not belong to.

## Scope

- Team metadata schema upgrade for password credential records.
- Password hashing and verification using Node crypto primitives with per-credential salts.
- Authenticated password set/change endpoint for existing team users.
- Public email/password login endpoint that creates an httpOnly workspace-member session.
- Login workspace selection guard when an account belongs to more than one workspace.
- Minimal browser sign-in/password setup paths using existing auth/settings surfaces.
- Tests for hashing, credential migration, set/change, login, session cookies, role scoping, cross-workspace denial, wrong-password rejection, and token secrecy.
- Docs for environment, security, migration, rollback, and remaining account-auth limits.

## Not In Scope

- OAuth login.
- Password reset or account recovery.
- Email verification.
- Magic links.
- Hosted organization admin and billing.
- Multi-workspace switcher UI beyond a bounded login workspace selection.
- Account deletion, SCIM, SSO, passkeys, MFA, or audit-policy admin console.

## Acceptance Criteria

- Team metadata migrates to the current schema with `credentials: []`.
- Password credentials store only hashes, salts, algorithm metadata, and timestamps; raw passwords are never persisted, returned, logged, or exported in browser state.
- Authenticated owners and members can set an initial password for their own team user.
- Existing password changes require the current password unless the actor is the local owner setting their own password through an owner session.
- Public password login rejects unknown users, wrong passwords, malformed input, and ambiguous multi-workspace membership without revealing which condition applied beyond bounded errors.
- Successful password login creates an httpOnly member session scoped to the selected/only workspace and role.
- Password-login member sessions can read/write exactly like invitation-created member sessions for the same role.
- Viewer password-login sessions remain read-only.
- Admin-token owner sessions, bearer token scripts, invitation session acceptance, JSONL invitation delivery, public portal, integrations, backup, and release verification continue to pass.

## Automated Test Checklist

- Team metadata migrates schema 1, 2, and 3 files to the current schema with credentials.
- Current-schema validation rejects malformed credential records.
- Password hashing creates unique salts and non-raw hashes for the same password.
- Password verification accepts correct passwords and rejects wrong passwords.
- Password set endpoint requires an authenticated owner/member session.
- Initial password set succeeds for the current actor and stores only hashed material.
- Password change rejects missing/wrong current passwords and accepts correct current password.
- Password login creates an httpOnly workspace-member session for a single-workspace user.
- Password login requires `workspaceId` or returns a bounded error for multi-workspace users.
- Password login rejects wrong passwords with a generic invalid-credentials response.
- Password-login member session can read its workspace and cannot read full `/api/openroad/state`.
- Password-login contributor can write workspace-scoped data; viewer cannot.
- Existing invitation session, owner session, invitation delivery, public portal, ops, and release tests still pass.
- Browser account sign-in and password setup tests pass without exposing password text.
- Design detector returns no findings for touched UI files.
- `pnpm check` passes.

## Regression Checklist

- One-time invitation tokens still accept exactly once and create member sessions.
- Invitation delivery JSONL still includes accept links and does not leak token hashes.
- Owner admin-token login/logout/session behavior remains unchanged.
- Existing owner/member auth surface remains compact and does not add page-level overflow.
- Team backups include credential hashes but not raw passwords.
- Release manifest reports the new team metadata schema.

## Security And Privacy Checks

- Password endpoints use server-side code only.
- Credential comparison uses constant-time hash comparison where applicable.
- Error messages are bounded and do not echo passwords.
- Credential records must not contain provider tokens, admin tokens, session cookie values, raw invitation tokens, or raw passwords.
- Password login creates workspace-member sessions only for persisted memberships.
- Public portal and public invitation endpoints do not expose credential metadata.

## Migration And Rollback

- Migration: prior team metadata schemas receive `credentials: []`.
- Rollback: restore a pre-schema-upgrade team metadata backup before downgrading to a build that does not understand credential records.
- Existing session, product, and integration data remain separate from credentials.

## Manual QA Checklist

- Run focused account credential, team, session, HTTP, persistence, app, ops, and release tests.
- Run design detector for touched UI files.
- Run `pnpm check`.
- Start the built server with admin-token mode and isolated temp files.
- Accept an invitation, set a password from the authenticated member session, sign out, sign in with email/password, and verify scoped workspace access.
- Verify wrong password and cross-workspace access fail.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/account-auth-foundation`
- Implementation commit SHA: `845bd32523dbfc370f9109a125cbc533d3f6fb22`.
- Date: 2026-07-10.
- Commands run:
  - `pnpm vitest run server/team.test.ts server/http.test.ts src/App.test.tsx src/persistence/openroadServer.test.ts scripts/openroad-ops.test.mjs scripts/openroad-release.test.mjs`: 184 tests passed.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css`: no findings.
  - `pnpm build:server`: passed.
  - `pnpm check`: 361 tests passed, production client build passed, production server build passed.
  - Built-server smoke against `server-dist/server/index.js`: health, owner invitation create, invitation member session, full-state denial, workspace read, account password set, wrong-password denial, password login session, workspace read/write, invite-token reuse denial, raw password not persisted, raw invitation token not persisted.
  - `pnpm release:verify`: passed with rollback notes for OpenRoad state schema `7`, integration metadata schema `3`, session metadata schema `2`, and team metadata schema `4`.
- Browser/viewports tested:
  - In-app browser, production build at `1440x900`: owner/member auth panels fit, Account/Invite switch works, no document overflow.
  - In-app browser, production build at `390x844`: account and invite member modes fit, no document overflow.
  - In-app browser, production build at `360x740`: auth panels fit within viewport, no document overflow.
- Accessibility checks: Auth controls use labeled inputs, semantic buttons, `aria-pressed` mode switch state, visible focus inherited from the app shell, and status messages use `role="status"`/`role="alert"` where relevant.
- Reviewer notes: Passed. Account passwords are limited to existing team users and produce scoped workspace-member sessions; admin-token owner sessions, invitation sessions, public portal, integrations, ops, and release checks remained green.
- Known unresolved risks: OAuth login, email verification, MFA/passkeys, SSO, account deletion, hosted org admin, and billing remain future production slices. Password recovery was completed later in `feat/account-recovery-foundation`.
- Rollback notes: Restore a pre-schema-4 team metadata backup before downgrading to a build that does not understand account credential records. Product, integration, and session files remain separate but should be restored from the same operational snapshot when rolling back across a release.
