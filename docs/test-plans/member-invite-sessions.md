# Feature Test Plan: Member Invite Sessions

Branch: `feat/member-invite-sessions`

## Objective

Allow a valid invitation token to create a browser session for the invited workspace member, and allow the browser app to run against workspace-scoped APIs instead of requiring owner-only full-state APIs.

## User Story

As an invited teammate, I need to paste or open an invitation token, enter my display name, and land in the workspace I was invited to without knowing the server admin token. As a workspace owner, I need this not to weaken owner/admin access, invitation secrecy, or cross-workspace isolation.

## Scope

- Versioned session metadata that can store local-owner and workspace-member session actors.
- Public invitation acceptance endpoint that can create a member httpOnly browser session.
- Browser persistence fallback that loads allowed workspace data through workspace-scoped APIs when full state is forbidden.
- Browser save path that uses workspace-scoped action and workspace replacement APIs for member sessions.
- Focused invite acceptance UI state using the existing owner sign-in surface area.
- Documentation updates for auth/session contract and production limits.

## Not In Scope

- Password login.
- OAuth login.
- Account recovery.
- Invitation email delivery.
- Multiple-workspace member switcher beyond memberships returned by the server.
- Full member/admin management UI.
- Billing or hosted account administration.

## Acceptance Criteria

- Accepting a valid invitation through the session endpoint creates/reuses the user and membership, marks the invitation accepted, and sets an httpOnly session cookie.
- The new member session resolves as a workspace-member actor with the invited role and workspace id.
- Member sessions can read only their workspace summary/detail and cannot read full `/api/openroad/state`.
- Member browser app loads the invited workspace and can save workspace-scoped actions when the role allows writes.
- Viewer member sessions can read the workspace but cannot write.
- Owner admin-token sessions remain bound to admin-token rotation and still use full-state APIs.
- Settings owner invitation management and API-only invitation acceptance continue to work.
- Raw invitation tokens and session secrets are not persisted, exported, logged, or returned after one-time use.
- Public portal remains unauthenticated and private-data-safe.

## Automated Test Checklist

- Session store migrates v1 owner sessions to v2 actor-aware records.
- Session store creates and resolves owner sessions with admin-token binding.
- Session store creates and resolves workspace-member sessions without admin-token binding.
- Session store rejects malformed, expired, revoked, and tampered session cookies.
- Public invitation session endpoint accepts a valid pending token and returns safe actor/membership/user metadata.
- Public invitation session endpoint sets the session cookie and does not return raw cookie value or token hashes.
- Reusing the same invitation token for session acceptance fails.
- Member session is forbidden from `/api/openroad/state` and cross-workspace reads.
- Member session can load `/api/openroad/workspaces/:workspaceId` for its own workspace.
- Contributor/Maintainer/Owner member session can save workspace-scoped actions.
- Viewer member session cannot save workspace-scoped actions.
- Browser persistence helpers fall back from full-state load to workspace-scoped load when authenticated member access is available.
- Browser persistence helpers use workspace-scoped saves for member scope.
- Existing owner sign-in, Settings invitations, integrations status, portal, and standalone workflows pass.

## Manual QA Checklist

- Run focused session, HTTP, persistence, and app tests.
- Run the design detector if UI files are touched.
- Run `pnpm check`.
- Start built server with admin-token mode and isolated temp files.
- Sign in as owner, create an invitation, accept it in a fresh browser/session path, and verify the member lands in the workspace without the admin token.
- Verify member cannot load another workspace or full-state APIs.
- Verify compact and desktop invite acceptance surfaces have no page-level overflow.
- Run `pnpm release:verify`.

## Security And Privacy Checks

- Session cookies are `HttpOnly`, `SameSite=Lax`, scoped to `/`, and Secure on HTTPS/proxy HTTPS.
- Owner sessions remain invalidated by admin-token rotation.
- Member sessions do not depend on or expose admin-token material.
- Accepted invitation tokens cannot be used twice.
- Error messages do not echo raw invitation tokens.
- Workspace-scoped browser saves cannot mutate global state or another workspace.

## Evidence

- Branch: `feat/member-invite-sessions`
- Commit SHA: `dee9c8aa007f16b26ebea069228769e710ebe5c7`.
- Date: 2026-07-08.
- Commands run:
  - `pnpm vitest run server/access.test.ts server/session-store.test.ts server/team.test.ts server/http.test.ts src/persistence/openroadServer.test.ts src/App.test.tsx scripts/openroad-ops.test.mjs scripts/openroad-release.test.mjs`: 186 tests passed.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css`: no findings.
  - `pnpm check`: 343 tests passed; client and server production builds passed.
  - Built-server member invite smoke in admin-token mode: owner login, invitation create, invitation session accept, member session resolve, full-state denial, scoped workspace list/read/write, cross-workspace denial, one-time token reuse denial, httpOnly cookie, and no token echo all passed.
  - `pnpm release:verify`: dry-run release manifest generated with `session metadata schema 2` rollback notes.
- Browser/viewports tested: Headless Chrome against built assets at 390x844 and 1280x720 for owner/member auth surface and member workspace shell; no document-level horizontal or vertical overflow. Screenshots saved under `.openroad/member-invite-sessions-final-*/final-*.png`.
- Accessibility checks: Owner and member auth forms have accessible names, invite token/name fields have labels, status is text-based, and design detector returned no findings for touched UI files.
- Reviewer notes: Member invite sessions are scoped to invited workspaces, use httpOnly cookies, and do not depend on admin-token material. The browser disables new workspace creation for member sessions to avoid local-only server-mode mutations.
- Known unresolved risks: OAuth auth, built-in SMTP delivery, provider-specific invitation templates, account recovery, automated browser E2E, managed SQL migrations, and hosted billing remain future slices. Password auth, deeper member management UI, JSONL invitation delivery handoff, and HTTP invitation provider delivery were completed in later slices.
- Rollback notes: Revert branch; session metadata v2 can be restored from pre-upgrade backup, while team invitation and product state remain separate.
