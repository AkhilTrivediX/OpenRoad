# Feature Test Plan: Team Invitations UI

Branch: `feat/team-invitations-ui`

## Objective

Add a progressive Settings surface for workspace owners to create, inspect, revoke, and accept-test team invitations through the production invitation APIs without increasing first-use complexity.

## User Story

As a workspace owner, I need a quiet place in Settings to invite a teammate, choose their role, copy the one-time accept token, see pending/accepted/revoked invitations, and revoke mistakes. As a non-owner or standalone/local user, I should not see confusing controls that I cannot use.

## Scope

- Browser client helpers for invitation list/create/revoke/accept APIs.
- Settings "Access" section that appears only when server access can support invitation APIs.
- Role, email, and optional name controls with clear error/success states.
- One-time accept token reveal after create with copy-friendly field.
- Pending/accepted/revoked invitation list with status text.
- Revoke action for pending invitations.
- Optional accept-token test field for self-host operators.
- Tests for success, forbidden/unavailable states, validation errors, token secrecy, and existing Settings regressions.
- Responsive/no-overflow QA for Settings at desktop and compact widths.

## Not In Scope

- Email delivery.
- Password auth.
- OAuth account login.
- Account recovery.
- Automatic browser session creation for accepted invitees.
- User profile editing.
- Dedicated team admin page.

## Acceptance Criteria

- Owners in server mode can create invitations from Settings.
- Created invitations display safe metadata and a one-time accept token without storing it in workspace data.
- Invitation list omits token hashes and raw tokens.
- Pending invitations can be revoked.
- Accepted/revoked/expired invitations have visible text status, not color alone.
- Forbidden or unavailable invitation APIs show bounded, non-technical copy.
- The UI does not appear as a primary nav item and does not overwhelm the Settings page.
- Local standalone mode remains fully usable and does not pretend team invitations are active.
- No raw accept token is written to localStorage, workspace export, audit copy, or persistent app state after leaving the success surface.

## Automated Test Checklist

- Invitation client list/create/revoke/accept helpers use same-origin credentials and parse safe responses.
- Invitation client handles forbidden and unavailable states with bounded messages.
- Settings shows invitation controls when server APIs are available.
- Creating an invitation posts email/name/role and renders the returned one-time token.
- The one-time token does not appear in workspace export JSON.
- Revoke action calls the revoke endpoint and updates invitation status.
- Accept-token test calls public accept endpoint and shows accepted status.
- API failures keep the user on the Settings surface with an accessible error.
- Existing integration Settings controls continue to work.
- Full `pnpm check` passes.

## Regression Checklist

- Owner sign-in still loads server state.
- Server unavailable fallback still preserves local mode.
- Existing Settings integration status and manual sync controls still render.
- Workspace export/import/reset controls still render.
- App shell stays fixed-height with Settings owning internal scroll.
- Public portal and standalone workflows remain unaffected.

## Security And Privacy Checks

- Raw accept token is displayed only from the create response and never persisted into OpenRoad domain state.
- Token hashes are never rendered.
- Errors do not echo tokens.
- Copy does not imply accepted users can log in yet.
- Non-owner actors receive no successful invitation management path.
- Inputs are labelled, bounded, and keyboard-operable.

## Manual QA Checklist

- Run `pnpm vitest run src/persistence/openroadInvitations.test.ts src/App.test.tsx`.
- Run the impeccable detector against touched UI files.
- Run `pnpm check`.
- Start built server in admin-token mode, sign in, create/revoke invitation in Settings at desktop width.
- Repeat Settings view at compact width and verify no horizontal overflow or text overlap.
- Verify public portal still loads without authentication.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/team-invitations-ui`
- Commit SHA: `28a1ff27ceeda03751b81b3485527e59e15bf191`.
- Date: 2026-07-05.
- Commands run:
  - `pnpm vitest run src/persistence/openroadInvitations.test.ts src/App.test.tsx` -> 61 passed.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` -> no findings.
  - `pnpm check` -> 335 passed plus client/server production builds.
  - `pnpm release:verify` -> dry-run release manifest passed.
- Browser/viewports tested:
  - Built server, admin-token mode, isolated temp state on `http://127.0.0.1:43174`.
  - Desktop `1440x900`: signed in, invitation access refreshed to Ready, created invitation, verified one-time token prefix, revoked invitation, verified token reveal cleared, no body overflow, no Team access text overflow.
  - Compact `390x844`: Settings stayed inside viewport-height app shell, Access panel Ready, one-column grid, no body overflow, no Team access text overflow.
  - Public portal API without session returned HTTP 200 for `/api/openroad/workspaces/acme/portal`.
- Accessibility checks: labelled Team access region, labelled create/accept forms, labelled inputs/selects, explicit status/alert messages, status text visible beyond color, keyboard-operable native controls.
- Reviewer notes: Live browser QA caught stale unauthenticated invitation access after owner sign-in; the Settings metadata effects now refresh after the owner session returns to idle and have regression coverage.
- Known unresolved risks: Email delivery, password/OAuth login, account recovery, accepted-member session login, and deeper role-management UI remain future slices.
- Rollback notes: Revert branch; backend invitation APIs remain available for API users and operators.
