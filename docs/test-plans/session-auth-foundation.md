# Feature Test Plan: Session Auth Foundation

Branch: `feat/session-auth-foundation`

## Objective

Add a production-safe browser session foundation for self-hosted OpenRoad so admin-token deployments can use the app in the browser without exposing `OPENROAD_ADMIN_TOKEN` to ongoing client API calls.

## User Story

As a self-hosted OpenRoad owner, I need to sign into the server once from the browser and then use the product through a server-managed, httpOnly session cookie. As an operator, I still need bearer-token access for smoke tests, automations, and emergency operations.

## Scope

- File-backed session store with versioned validation.
- One-time admin-token login exchange that creates a local-owner browser session.
- HttpOnly, SameSite=Lax, path-scoped session cookie.
- Session-token hashing before persistence.
- Session expiration and logout revocation.
- `GET /api/openroad/session` metadata that reports whether login is required.
- Same-origin browser fetches that explicitly include credentials.
- Documentation for session file, cookie behavior, login/logout, and rollback.
- Tests proving existing bearer-token, trusted-proxy, public portal, and single-user flows still work.

## Not In Scope

- User password auth.
- Email invitations.
- OAuth account login.
- Managed SQL session database.
- CSRF token rotation beyond SameSite cookie boundaries.
- Multi-device session management UI.
- Billing or hosted account administration.

## Acceptance Criteria

- Admin-token mode without a session still rejects private state APIs.
- `POST /api/openroad/auth/login` rejects missing, malformed, and wrong admin tokens.
- Correct admin-token login creates a session and returns only safe session metadata.
- The raw session token is never returned in JSON and is not persisted to disk.
- The session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and has a bounded `Max-Age`.
- Session cookies authenticate private browser API calls without an `Authorization` header.
- `POST /api/openroad/auth/logout` revokes the current session and clears the cookie.
- Expired or revoked sessions do not authenticate private routes.
- Bearer-token auth still works for scripts and operations.
- Trusted proxy actors still work when explicitly enabled.
- Single-user mode still works with no login or session store requirement.
- Public portal read/write routes remain unauthenticated and keep their visitor cookie behavior.
- Browser server persistence fetches send same-origin credentials intentionally.
- Docs explain session storage, secure deployment notes, and rollback.

## Automated Test Checklist

- Access layer accepts a valid session actor before falling back to public visitor.
- Access layer keeps bearer-token local-owner auth working when sessions are configured.
- Access layer keeps trusted proxy actor headers working when enabled.
- Access layer keeps single-user owner fallback working without sessions.
- Session store seeds an empty session file when missing.
- Session store hashes tokens and does not persist raw token material.
- Session store returns active sessions before expiry.
- Session store ignores expired sessions and trims them on write.
- Session store revokes a matching active session.
- Session store rejects future schema versions and recovers corrupt state safely if designed to recover.
- Login endpoint rejects non-POST methods.
- Login endpoint rejects missing/wrong token.
- Login endpoint returns `Set-Cookie` with secure attributes.
- Login endpoint records a bounded audit event.
- Session endpoint reports `authenticated: false` and `loginRequired: true` in admin-token mode before login.
- Session endpoint reports local-owner actor and memberships after cookie login.
- Private state GET succeeds with only the session cookie.
- Private state PUT succeeds with only the session cookie and records audit.
- Logout endpoint clears the browser cookie and revokes persisted session.
- Private state GET fails after logout with the old cookie.
- Bearer-token private state GET succeeds without a cookie.
- Public portal GET and write routes still succeed without an auth cookie.
- Existing `server/access.test.ts`, `server/team.test.ts`, `server/http.test.ts`, and client persistence tests pass.

## Regression Checklist

- Production app still loads in local single-user mode.
- Admin-token mode still denies unauthenticated full-state access.
- Existing integration setup, credential, sync, webhook, notification, and ops routes retain their permission checks.
- Workspace-scoped member routes continue to filter by workspace.
- Public portal visitor cookies are not confused with owner session cookies.
- Existing release scripts and GitHub Actions remain platform-portable.

## Security And Privacy Checks

- No admin token, session token, bearer token, provider token, ciphertext, or cookie value appears in JSON API responses, audit events, logs, docs examples, screenshots, or tests beyond fake fixture strings.
- Session tokens are generated with cryptographic randomness.
- Session persistence stores token hashes only.
- Login responses include no raw token.
- Logout is idempotent and safe when no session is present.
- Cookie security uses `Secure` for HTTPS requests and trusted proxy HTTPS headers.
- Error responses are generic enough to avoid revealing valid tokens.
- The admin token remains server-only except for the one-time login exchange.

## Migration And Rollback

- New session metadata is stored outside core OpenRoad state and team metadata.
- Default session file path: `.openroad/openroad-sessions.json`.
- Rollback by reverting the branch and deleting or preserving the session file; core state, integration metadata, and team metadata stay compatible.
- Rotating `OPENROAD_ADMIN_TOKEN` invalidates existing sessions because session records are bound to the active token hash.

## Manual QA Checklist

- Run `pnpm vitest run server/access.test.ts server/session-store.test.ts server/http.test.ts src/persistence/openroadServer.test.ts`.
- Run `pnpm check`.
- Build and start the production server without `OPENROAD_ADMIN_TOKEN`; verify session reports local owner and state loads.
- Build and start the production server with `OPENROAD_ADMIN_TOKEN` and `OPENROAD_SINGLE_USER_MODE=false`; verify unauthenticated state is denied.
- Login through the API with the admin token; verify private state loads using only the returned cookie.
- Logout; verify private state is denied with the old cookie.
- Verify public portal still works without auth.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/session-auth-foundation`
- Commit SHA: `e3819ea`.
- Date: 2026-07-05.
- Commands run:
  - `pnpm vitest run server/session-store.test.ts server/access.test.ts server/http.test.ts src/persistence/openroadServer.test.ts scripts/openroad-ops.test.mjs`: 101 tests passed.
  - `pnpm check`: 316 tests passed; client and server production builds passed.
  - `pnpm vitest run scripts/openroad-release.test.mjs`: 6 tests passed.
  - `pnpm release:verify`: dry-run release manifest generated with required gates and session-aware rollback text.
  - Built server smoke with `OPENROAD_ADMIN_TOKEN` and `OPENROAD_SINGLE_USER_MODE=false`: `pnpm ops:smoke` passed health, contract, portal, private denial, and bearer-token checks.
  - Built server session smoke: unauthenticated state `403`, login `200` with `openroad_session` cookie, cookie state `200`, logout `200`, old cookie state `403`, bearer-token state `200`.
- Browser/viewports tested: No visual UI changes in this slice; client change is fetch credential behavior covered by `src/persistence/openroadServer.test.ts`.
- Accessibility checks: No major visual UI changes expected in this slice.
- Reviewer notes: Session store is intentionally separate from core state, team metadata, and integration metadata. Backup/restore includes the session file, while deleting `OPENROAD_SESSION_FILE` remains a safe sign-out operation.
- Known unresolved risks: User invitations, password login, account recovery, OAuth callback exchange, hosted session storage, and admin session management remain future production slices.
- Rollback notes: Revert branch; preserve or delete `OPENROAD_SESSION_FILE` as desired.
