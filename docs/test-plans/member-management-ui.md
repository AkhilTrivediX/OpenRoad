# Feature Test Plan: Member Management UI

Branch: `feat/member-management-ui`

## Objective

Add a production-safe workspace member management surface so workspace owners can see who has access, understand account password readiness, change roles, and deactivate workspace memberships without hand-editing team metadata or leaving stale member sessions active.

## User Story

As a workspace owner, I can review current members beside pending invitations, see whether a teammate has account password access ready, update a member role when responsibilities change, and remove workspace access when someone leaves. As an operator, I need those changes to preserve owner/admin access, revoke affected member sessions, and avoid exposing credential hashes, session tokens, invitation token hashes, or provider secrets.

## Scope

- Server-side workspace member summary endpoint.
- Server-side membership role update endpoint.
- Server-side membership deactivation endpoint.
- Team-store helpers for listing workspace members, updating membership roles, and removing workspace memberships.
- Session-store helper to revoke active workspace-member sessions for a user/workspace after role changes or deactivation.
- Client persistence helpers for loading members and performing role/deactivation mutations with same-origin credentials.
- Settings access UI that shows members, role controls, credential readiness, and deactivation actions without adding a new top-level nav item.
- Docs for API contract, deployment, readiness, and rollback notes.

## Not In Scope

- Creating users without invitations.
- Deleting user records or password credentials globally.
- Email verification, password reset, OAuth, SSO, MFA/passkeys, SCIM, billing, or hosted organization admin.
- Bulk member actions.
- Cross-workspace organization directory.
- Editing member names/emails.
- Changing the local owner bootstrap identity.

## Acceptance Criteria

- Workspace owners/local owners can list members for a workspace with sanitized user, membership, and credential readiness metadata.
- Non-owners cannot list, update, or deactivate workspace members.
- Member list responses do not include password hashes, salts, session token hashes, admin-token hashes, invitation token hashes, raw invitation tokens, provider tokens, or private workspace state.
- Role changes update persisted membership roles and record audit events.
- Deactivation removes the workspace membership, records an audit event, and does not delete the user or password credential.
- Role changes and deactivation revoke affected active workspace-member sessions for that user/workspace so old role cookies do not keep stale permissions.
- Last active owner membership for a workspace cannot be demoted or deactivated.
- The local owner bootstrap membership cannot be deactivated from the workspace.
- Settings UI remains compact in the existing Access section and does not introduce nested-card clutter.
- Existing account password login, invitation session, invitation delivery, owner session, public portal, integration, ops, and release tests continue to pass.

## Automated Test Checklist

- Team store lists workspace members with `credentialStatus` but without credential secrets.
- Team store rejects member listing for missing workspaces.
- Team store updates a member role and preserves user/credential records.
- Team store blocks demoting/removing the last owner membership.
- Team store removes a non-owner membership without deleting the user or credential.
- Session store revokes active member sessions by user/workspace and leaves owner or other-workspace sessions untouched.
- Member list API requires owner-level integration management and returns sanitized summaries.
- Role update API requires owner-level integration management, updates role, revokes affected sessions, and records an audit event.
- Deactivation API requires owner-level integration management, removes membership, revokes affected sessions, and records an audit event.
- Deactivated member sessions can no longer read or write the workspace.
- Role-changed member sessions are revoked and must sign in again before using the new role.
- Client helpers call the new endpoints with same-origin credentials and parse safe responses.
- Settings UI loads member summaries, updates a role, deactivates a member, and does not render credential/session secrets.
- Existing invitation create/revoke, invitation accept/session, account password login, owner login, ops, and release tests still pass.
- Design detector returns no findings for touched UI files.
- `pnpm check` passes.

## Regression Checklist

- Existing team invitations still list, create, revoke, and accept exactly once.
- Account password login still creates scoped member sessions and does not expose raw passwords.
- Owner admin-token sessions and bearer-token scripts keep full-state behavior.
- Public portal routes remain public-only projections.
- Provider credentials and integration sync metadata remain outside team-member responses.
- Backup/restore and release manifest schema reporting remain valid.

## Security And Privacy Checks

- Member responses expose only user id, name, email, membership id, role, workspace id, timestamps, and credential readiness.
- Mutation responses do not return credentials, session records, token hashes, or private workspace state.
- Role/deactivation mutations serialize through the file-backed stores and avoid partial stale-session outcomes where practical.
- Last-owner and local-owner safeguards prevent accidental lockout.
- Audit summaries are bounded and do not include secrets.

## Migration And Rollback

- No schema bump is expected for team or session metadata; existing schema `4` team memberships and schema `2` session records are used.
- Rollback: revert the branch. Existing memberships, credentials, sessions, product data, and integrations remain compatible. If roles/memberships were changed while this feature was live, restore a team/session backup to undo those operational changes.

## Manual QA Checklist

- Run focused team, session, HTTP, client, app, ops, and release tests.
- Run design detector for touched UI files.
- Run `pnpm check`.
- Start the built server with isolated temp files.
- Create a member, set an account password, list members, change the role, verify the old session is revoked, sign in again, deactivate the membership, and verify access is denied.
- Check desktop and mobile Settings Access layout for overflow and cognitive load.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/member-management-ui`
- Implementation commit SHA: `95faedb21ffb98a2af431fc20bcf5c42a0d52f64`
- Date: 2026-07-10.
- Commands run:
  - `pnpm vitest run server/team.test.ts server/session-store.test.ts server/access.test.ts server/http.test.ts` (122 tests passed before the `account:write` contract correction).
  - `pnpm vitest run src/persistence/openroadMembers.test.ts src/App.test.tsx` (66 tests passed).
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` (no findings).
  - `pnpm vitest run server/access.test.ts` (10 tests passed after adding `account:write`).
  - `pnpm check` (373 tests passed, production client/server builds passed).
  - Built-server member-management smoke against `server-dist/server/index.js` with isolated state/team/session files (passed; role update revoked 2 member sessions, deactivation revoked 1 active member session).
  - `pnpm release:verify` (passed for implementation commit `95faedb21ffb98a2af431fc20bcf5c42a0d52f64`).
- Browser/viewports tested:
  - `1440x900`: Settings Access member rows visible, no body overflow, local owner role control disabled, QA member role control enabled.
  - `390x844`: app shell remained fixed, `.operations-deck` handled internal scrolling, member rows collapsed to one column, no horizontal row/body overflow.
  - `360x740`: same mobile checks passed; controls remained full-width inside member rows with no text/control overflow.
- Accessibility checks: Member list has an accessible `Workspace members` label; role selects are named per member email; deactivation buttons have per-member accessible names; status text is visible and not color-only; protected local-owner controls are disabled.
- Reviewer notes: Sidecar review highlighted stale member-session risk; implementation now revokes matching active workspace-member sessions by user/workspace after role update or deactivation and preserves owner/other-workspace sessions.
- Known unresolved risks: Global organization directory, email verification, password recovery, SSO/MFA/passkeys, SCIM, account deletion, hosted org admin, and billing remain future production slices.
- Rollback notes: No schema bump; feature uses team metadata schema `4` and session metadata schema `2`. Revert this branch to remove UI/API surface. Restore team/session backups if role changes, deactivations, or session revocations performed while live need to be undone operationally.
