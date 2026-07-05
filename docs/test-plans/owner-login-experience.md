# Feature Test Plan: Owner Login Experience

Branch: `feat/owner-login-experience`

## Objective

Make admin-token self-host deployments usable from the browser by adding a focused owner sign-in experience on top of the session-auth foundation.

## User Story

As a self-hosted OpenRoad owner, I need the app to tell me when server sign-in is required, accept my admin token once, create the httpOnly session, then load the server workspace without making me use developer tools or manual API calls.

## Scope

- Session/auth client helpers for `GET /api/openroad/session`, `POST /api/openroad/auth/login`, and `POST /api/openroad/auth/logout`.
- A server-auth-required error path from server persistence.
- A focused owner sign-in plate that follows the existing Dark Map Room visual system.
- Retry behavior that loads server state after successful login.
- Safe error copy for wrong tokens and unavailable servers.
- Tests for auth-required state load, successful login, failed login, and generic server outage fallback.
- Visual/UX QA for the login surface at desktop and compact widths.

## Not In Scope

- Password auth.
- Invitations.
- OAuth account login.
- Remembered email/user profile.
- Session management list.
- Password reset or account recovery.
- Hosted billing/admin console.

## Acceptance Criteria

- In admin-token mode, a `403 forbidden` state load shows owner sign-in instead of silently falling back to local data.
- The sign-in form asks for the admin token without persisting it in app state after success.
- Successful login calls `/api/openroad/auth/login`, receives the server cookie, loads `/api/openroad/state`, and enters the normal app shell.
- Wrong token keeps the user on the sign-in surface with a bounded error message.
- Non-auth server failures still fall back to local browser data with the existing persistence message.
- The login surface uses existing sharp geometry, dark surfaces, semantic color, visible labels, and focus states.
- Server fetches continue to use `credentials: "same-origin"`.
- No admin token is logged, rendered after submit, or stored in localStorage.

## Automated Test Checklist

- `loadServerOpenRoadState` throws a typed auth-required error on `403 forbidden`.
- `loadServerOpenRoadSession` reads session metadata with credentials.
- `loginOpenRoadOwner` posts the admin token with credentials.
- App renders owner sign-in when server state returns `403 forbidden`.
- Successful owner sign-in posts the token, reloads state, renders the server workspace, and clears the token input.
- Failed owner sign-in shows an error and does not render the token.
- Generic `500` or network server load failure still activates local browser fallback, not the owner sign-in surface.
- Existing integration Settings tests still pass.
- Full `pnpm check` passes.

## Regression Checklist

- Single-user/local mode starts directly in the app shell.
- Server sync off still uses local persistence.
- Server storage connected message still appears after a successful server load.
- Save failures still switch to local fallback.
- Settings integration status still shows forbidden/unavailable states as before.
- App shell fixed-height layout and bottom status remain intact.

## Security And Privacy Checks

- Token input uses password masking.
- Submitted token is cleared on success.
- Error messages do not echo user input.
- No token is written to localStorage, URL, logs, persistence messages, or test snapshots.
- Login requests use same-origin credentials and JSON content type.

## Manual QA Checklist

- Run `pnpm vitest run src/persistence/openroadServer.test.ts src/App.test.tsx`.
- Run the impeccable detector against touched UI files.
- Run `pnpm check`.
- Start built server with `OPENROAD_ADMIN_TOKEN` and `OPENROAD_SINGLE_USER_MODE=false`.
- Visit the app at desktop width; verify owner sign-in appears, focus is visible, token login loads the app.
- Repeat at compact mobile width; verify no text overflow or page-level scroll trap.
- Try a wrong token; verify the error is visible, bounded, and does not reveal the token.

## Evidence

- Branch: `feat/owner-login-experience`
- Commit SHA: `4415341`.
- Date: 2026-07-05.
- Commands run:
  - `pnpm vitest run src/persistence/openroadServer.test.ts src/App.test.tsx`: 60 tests passed.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css`: no findings.
  - `pnpm check`: 323 tests passed; client and server production builds passed.
  - `pnpm release:verify`: dry-run release manifest generated.
- Browser/viewports tested:
  - Built server with `OPENROAD_ADMIN_TOKEN` and `OPENROAD_SINGLE_USER_MODE=false`, desktop `1440x900`: owner sign-in rendered, password input focused, no body overflow, no text overflow.
  - Built server with `OPENROAD_ADMIN_TOKEN` and `OPENROAD_SINGLE_USER_MODE=false`, compact `390x844`: owner sign-in rendered, no body overflow, no text overflow.
  - Interaction QA: wrong token showed bounded error; correct token created session, loaded app shell, showed `Server storage connected.`, and neither token appeared in page text.
- Accessibility checks: Password input has a visible label, submit button has text plus icon, error uses `role="alert"`, focus outline is visible, and no text overflow was detected in browser QA.
- Reviewer notes: The auth-required state owns the viewport and preserves the existing local fallback for non-auth server failures.
- Known unresolved risks: Full user accounts, invitations, session management UI, and OAuth login remain future production slices.
- Rollback notes: Revert branch; backend session-auth foundation remains usable via API.
