# Feature Test Plan: Public Portal Hardening

Branch: `feat/public-portal-hardening`

## Objective

Harden OpenRoad's public portal API before wider public launch or provider integrations by adding server-side public interaction endpoints with validation, requester identity boundaries, rate limiting, and public/private data protection.

## User Story

As a self-host operator exposing a public OpenRoad portal, I need votes and comments to be accepted through narrow public APIs that cannot mutate private data, spam the workspace, or leak internal state.

## Scope

- Public portal vote endpoint for public, non-archived requests.
- Public portal comment endpoint for public, non-archived requests.
- Requester identity normalization for public actions.
- In-memory rate limit foundation for public portal writes.
- Server-side validation for public action payloads.
- Public-only response projection after mutations.
- Tests for disabled portal settings, private requests, archived requests, rate limits, and validation errors.
- Environment documentation for rate-limit settings.

## Not In Scope

- Email notification delivery.
- CAPTCHA or external abuse services.
- Persistent requester accounts.
- OAuth/session auth.
- Browser UI changes.
- Provider integrations.
- Webhook handling.
- Cross-process distributed rate limiting.

## Acceptance Criteria

- Public portal write APIs do not require admin authentication.
- Public portal write APIs only mutate public, non-archived requests in enabled portals.
- Public portal comment writes honor `portal.allowComments`.
- Public portal vote writes honor `portal.allowVoting`.
- Invalid requester, comment, or request payloads return structured API errors.
- Public write responses return only public portal projection data.
- Rate limit denies repeated public writes with `429` and does not mutate state after denial.
- Rate-limit settings are environment-configurable.
- Existing private state APIs and public portal read APIs keep their behavior.
- Existing standalone app workflows still pass unchanged.

## Automated Test Checklist

- Vote endpoint increments votes for a public request and returns a public request projection.
- Vote endpoint rejects private requests.
- Vote endpoint rejects archived requests.
- Vote endpoint rejects disabled voting.
- Comment endpoint appends a public comment for a public request and returns a public request projection.
- Comment endpoint rejects blank or oversized comments.
- Comment endpoint rejects disabled comments.
- Comment endpoint does not expose private/internal comments in the response.
- Public write rate limiter returns `429` after configured threshold.
- Rate-limited requests do not mutate votes or comments.
- Existing API/auth/tenancy tests still pass.
- Existing team/audit and server store tests still pass.
- Existing App, domain, and self-host ops tests still pass.
- `pnpm check` passes.

## Regression Checklist

- Public portal `GET` still returns public projection only.
- Private requests, internal comments, private roadmap items, and draft/private changelog entries remain hidden.
- Admin token mode still protects private APIs.
- Single-user mode still works.
- Workspace-scoped private APIs still avoid full-state leakage.
- Local standalone portal interactions in the React app still pass existing tests.
- No integration dependency is introduced.

## Security And Privacy Checks

- No secrets are committed.
- Public action responses do not include full workspace, requester source, private notes, internal comments, or audit logs.
- Rate-limit keys avoid logging secrets or raw request bodies.
- Requester identity is normalized and bounded in length.
- Public comments are stored with `Public` visibility only after validation.
- Public APIs return structured errors without stack traces.

## Migration And Rollback

- No schema migration is expected.
- Rollback by reverting this branch.
- In-memory rate limits reset on process restart.
- Existing persisted request data remains compatible.

## Manual QA Checklist

- Run `pnpm vitest run server/http.test.ts server/access.test.ts`.
- Run `pnpm check`.
- Start production server with temporary data files.
- Run `pnpm ops:smoke` in single-user mode.
- Run `pnpm ops:smoke` in admin-token mode.
- Manually call portal vote/comment endpoints against a temporary public request if needed.

## Evidence

- Branch: `feat/public-portal-hardening`
- Commit SHA: pending.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for public vote/comment endpoints, public-only responses, disabled/private/archived request handling, validation, and process-local rate limits.
- Commands run:
  - `pnpm vitest run server/http.test.ts server/access.test.ts`: 28 tests passed.
  - `pnpm check`: 110 tests passed; client and server production builds passed.
  - Production single-user smoke on port `4201`: health, contract, portal, and private single-user checks passed.
  - Production direct public portal write check on port `4201`: vote and comment endpoints returned public request projections.
  - Production token-mode smoke on port `4202`: health, contract, portal, unauthenticated private denial, and authenticated private access passed.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Self-review completed against public/private visibility, requester identity, rate-limit, and structured-error requirements.
- Known unresolved risks: Rate limits are process-local and reset on restart; persistent requester identity, notification preferences, CAPTCHA/external abuse services, and distributed limiters remain future production slices.
- Rollback notes: Revert branch; no data migration or schema rollback required.
