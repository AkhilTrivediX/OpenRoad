# Feature Test Plan: Account Recovery Foundation

Branch: `feat/account-recovery-foundation`

## Objective

Add a production-safe account recovery foundation for existing OpenRoad team users so a user who already has a password credential can request a reset link, receive it through an operator-controlled delivery handoff, set a new password with a one-time token, and regain a scoped member session without exposing credentials, recovery tokens, or private workspace data.

## User Story

As an existing team member, I can request a password reset from the sign-in surface and set a new password from a reset link. As a self-host operator, I can route recovery links through a sensitive JSONL handoff file until direct email/provider delivery is added. As a workspace owner, I can trust that recovery tokens are hashed, expiring, single-use, auditable, and do not create new users or memberships.

## Scope

- Team metadata schema `5` with account recovery request records.
- Hashed, expiring, single-use recovery tokens.
- Public, enumeration-safe recovery request endpoint.
- Public recovery confirmation endpoint that sets a new password and creates a scoped member session.
- Server-side JSONL recovery delivery handoff adapter.
- Environment configuration for disabled/file recovery delivery and recovery token TTL.
- Sign-in UI additions for request reset and reset-from-link flows.
- Docs for API contract, deployment runbook, README, build plan, and production readiness.

## Not In Scope

- Built-in SMTP or provider SDK delivery.
- Hosted email templates, bounce handling, suppression lists, analytics, or retry scheduler.
- Creating new users, verifying email ownership, or changing workspace membership.
- MFA/passkeys/SSO.
- Owner-assisted bulk recovery tooling.
- Account deletion or email-change flows.

## Acceptance Criteria

- Recovery delivery is disabled by default.
- `OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE=file` appends one sensitive JSONL record containing the raw recovery token and reset URL for an existing user with a password credential.
- Public recovery request responses are generic and do not reveal whether an email, credential, or workspace exists.
- Unknown emails, users without password credentials, inactive memberships, missing ambiguous workspace ids, and disabled delivery do not write raw recovery tokens to a delivery file.
- Recovery request records store only token hashes and bounded metadata in `OPENROAD_TEAM_FILE`.
- Recovery tokens expire, are single-use, and cannot be used after consumption.
- Recovery confirmation sets the new account password without requiring the old password, consumes the token, revokes stale member sessions for the recovered user, and creates a fresh httpOnly member session for the selected workspace membership.
- Multi-workspace accounts require a workspace id at confirmation if the token was not created for a single workspace.
- Recovery endpoints never return raw recovery tokens, token hashes, password hashes, salts, session cookie values, session token hashes, admin tokens, provider tokens, private workspace state, or cross-workspace membership data.
- Existing account password login, account password update, invitation sessions, member management, invitation delivery, public portal, integrations, ops, and release verification continue to pass.

## Automated Test Checklist

- Team schema `4` migrates to schema `5` with `accountRecoveryRequests: []`.
- Corrupt/future schema handling continues to behave as before.
- `createAccountRecoveryRequest` creates a hashed pending token for an existing credentialed user and returns the raw token only to server-side delivery code.
- Recovery creation is bounded, expires by configured TTL, and prunes old records.
- Recovery creation rejects or safely no-ops for unknown email, user without credential, nonexistent workspace, inactive membership, and ambiguous multi-workspace request.
- `completeAccountRecovery` rejects missing, malformed, expired, consumed, and wrong tokens.
- `completeAccountRecovery` updates password credential metadata, consumes the recovery token, and returns only sanitized user/membership metadata.
- Public request route returns the same generic response for known and unknown users.
- File delivery writes one JSONL record with recovery URL, email, workspace id/name when applicable, expiration, subject/body, and raw token.
- File delivery is not written when recovery delivery is disabled or the request is not eligible.
- Recovery confirmation route sets an httpOnly session cookie and revokes stale member sessions for the recovered user.
- Recovery confirmation route does not echo submitted password or recovery token in API output, team metadata, audit events, or UI state.
- Existing `POST /api/openroad/auth/password/login` works with the new password and rejects the old password after recovery.
- Existing account password change still requires the current password when already authenticated.
- App sign-in UI can request recovery, show a generic message, consume `?recovery=<token>`, clear the token from browser history, submit a new password, and enter the workspace without rendering secrets.
- `pnpm check` passes.
- `pnpm release:verify` passes.

## Regression Checklist

- Owner sign-in with admin token still creates an owner session.
- Invitation token session flow still creates a scoped member session.
- Account password login still handles single-workspace and multi-workspace users.
- Member role changes and deactivation still revoke stale member sessions.
- Invitation delivery disabled/file/http modes continue to pass.
- Requester notification delivery, integration sync, ops backup/restore/smoke, and release manifest tests remain green.
- Locked app shell stays compact and does not introduce page overflow at desktop or mobile breakpoints.

## Security And Privacy Checks

- Recovery tokens use at least 256 bits of entropy and are stored only as hashes.
- Recovery links are generated from `OPENROAD_PUBLIC_APP_URL` or a recovery-specific public base URL, never from untrusted request headers in delivery mode.
- Public request route avoids user enumeration by returning a stable generic body and status.
- Delivery JSONL files are documented as sensitive and excluded from backups.
- Passwords are normalized and hashed through the existing account credential path.
- Existing sessions for the recovered user are revoked before the fresh session is created.
- Audit events are bounded and do not include raw tokens, passwords, or hashes.
- UI state clears submitted passwords/tokens after success or failure and removes URL tokens from history.

## Migration And Rollback

- Expected schema bump: team metadata schema `5` adds `accountRecoveryRequests`.
- Rollback: set `OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE=disabled` to stop new recovery delivery immediately. Rolling back to a build that only understands team schema `4` requires restoring a pre-schema-5 team metadata backup or intentionally removing recovery records after backup.

## Manual QA Checklist

- Run focused team, access, HTTP auth/recovery, session-store, and app tests.
- Run `pnpm check`.
- Start the built server with isolated data and `OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE=file`.
- Create a user password, request recovery from the locked sign-in UI, verify one JSONL record is written, and confirm the recovery URL does not expose tokens in persisted team metadata.
- Open the recovery URL, set a new password, verify the app enters as a member, and verify old sessions/passwords are invalid.
- Repeat with an unknown email and verify the UI/API response is generic and no file record is written.
- Run browser QA at desktop and mobile breakpoints for the locked sign-in/recovery surfaces if UI changes are introduced.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/account-recovery-foundation`
- Implementation commit SHA: Pending.
- Date: Pending.
- Commands run: Pending.
- Browser/viewports tested: Pending.
- Accessibility checks: Pending.
- Reviewer notes: Pending.
- Known unresolved risks: Built-in SMTP/provider recovery delivery, email verification, account lockout throttling beyond existing process-local limits, MFA/passkeys, SSO, account deletion, email change, and hosted account administration remain future slices.
- Rollback notes: Pending.
