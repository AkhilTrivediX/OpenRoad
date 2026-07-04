# Feature Test Plan: Public Portal Identity Abuse Controls

Branch: `feat/public-portal-identity-abuse-controls`

## Objective

Make public portal interactions safer for production exposure by giving anonymous public visitors a durable, bounded identity for voting and by preventing repeated vote inflation without exposing private workspace state.

## User Story

As a self-host OpenRoad operator, I can expose a public portal where visitors can vote and comment without accounts, while the app prevents repeated vote inflation, keeps visitor identity pseudonymous, and continues returning public-only data.

## Scope

- Persist public voter identity on requests so vote deduplication survives server restarts and backup/restore.
- Add a schema migration for older OpenRoad request records.
- Issue and read a bounded public visitor cookie for public portal API calls.
- Continue supporting explicit requester IDs and visitor headers for API clients.
- Make public portal API projections visitor-aware so `hasCurrentUserVote` reflects the current visitor only.
- Return idempotent duplicate vote responses without mutating state.
- Preserve existing portal write validation, access rules, public/private projection boundaries, and rate limiting.
- Update public portal API tests, domain migration tests, and production readiness notes.

## Not In Scope

- CAPTCHA or external bot detection services.
- Browser account auth or public visitor login.
- Distributed Redis/database-backed rate limiting.
- Notification preference UI or delivery adapters.
- Public portal visual redesign.
- Provider integration sync changes.

## Acceptance Criteria

- Existing saved OpenRoad data migrates to the new schema with `publicVoterKeys` initialized on every request.
- New requests created by the app, seed data, and provider imports include an empty `publicVoterKeys` list.
- A public visitor vote increments a public request once and persists that visitor's voter key.
- A repeated vote from the same visitor returns a successful idempotent response and does not increment votes again.
- A public vote response marks `hasCurrentUserVote` for the current visitor only.
- A public portal read response does not leak local owner `hasCurrentUserVote` state when no visitor identity has voted.
- Public visitor cookies are bounded, HTTP-only, same-site, and scoped to OpenRoad API paths.
- Existing private/internal comments, private requests, audit logs, requester source, and private notes remain hidden from public responses.
- Existing disabled portal, private request, archived request, validation, and rate-limit behavior continues to pass.
- Rate-limited duplicate attempts do not mutate votes.

## Automated Test Checklist

- Domain migration from schema 5 initializes `publicVoterKeys` and bumps to the current schema.
- `createPublicPortalSnapshot` can render visitor-aware vote state without exposing local app vote state.
- Public vote endpoint sets a visitor cookie and stores exactly one public voter key.
- Public vote endpoint treats a repeated same-cookie vote as idempotent and leaves vote count unchanged.
- Public vote endpoint supports `X-OpenRoad-Visitor-Id` for non-browser API clients.
- Public read endpoint uses the visitor cookie/header for `hasCurrentUserVote`.
- Public read endpoint without a visitor identity hides local owner vote state.
- Existing public comment endpoint still creates public comments only and still hides internal/hidden comments.
- Existing private, archived, disabled, invalid payload, and rate-limit tests still pass.
- `pnpm vitest run src/domain/openroad.test.ts server/http.test.ts server/store.test.ts` passes.
- `pnpm check` passes.

## Regression Checklist

- Standalone in-app request voting and portal preview voting still behave as before.
- GitHub, Linear, and Jira imports still create valid requests.
- Export/import validates current schema data.
- Backup/restore does not need a separate public identity file because voter keys live inside OpenRoad state.
- Admin token mode still protects private APIs.
- Public portal GET still returns only the public projection.
- Public portal POST still does not require private API authentication.

## Security And Privacy Checks

- Visitor IDs are normalized and bounded before storage or rate-limit use.
- Public responses do not expose `publicVoterKeys`.
- Cookies use `HttpOnly`, `SameSite=Lax`, a bounded max age, and an OpenRoad API path.
- Audit events use normalized requester IDs, not raw request payloads.
- Duplicate votes are not logged as new vote mutations.
- Structured errors remain stack-trace free.

## Migration And Rollback

- Migration: schema 5 and older request records receive `publicVoterKeys: []`.
- Rollback: revert this branch before production data is migrated, or restore from a pre-migration backup if downgrading after deployment.
- No separate data store or secret rotation is introduced.

## Manual QA Checklist

- Run the focused Vitest set for domain, server, and store behavior.
- Run `pnpm check`.
- Build and start the production server against temporary data files.
- Smoke public portal GET and vote endpoints with no cookie, repeated cookie, and `X-OpenRoad-Visitor-Id`.
- Run release verification after merge.

## Evidence

- Branch: `feat/public-portal-identity-abuse-controls`
- Implementation commit SHA: `58763b2`.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for schema migration, persisted public voter keys, visitor-aware public projections, idempotent duplicate votes, cookie/header visitor identity, existing portal validation, rate limiting, and private-data projection boundaries.
- Commands run:
  - `pnpm vitest run src/domain/openroad.test.ts server/http.test.ts server/store.test.ts`: 92 tests passed.
  - `pnpm vitest run scripts/openroad-release.test.mjs`: 6 tests passed.
  - `pnpm check`: 230 tests passed; client and server production builds passed.
  - `pnpm release:verify`: dry-run release manifest generated; rollback data-migration note reports OpenRoad state schema `6`.
  - Built-server smoke on port `4298`: `pnpm ops:smoke` passed; direct public portal read, cookie-backed vote, duplicate vote dedupe, and visitor-header read checks passed.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Self-review completed against public/private projection boundaries, schema migration, requester identity normalization, duplicate-vote behavior, and rollback notes.
- Known unresolved risks: Distributed abuse control, CAPTCHA/external bot checks, and public visitor accounts remain out of scope until OpenRoad has shared production infrastructure such as managed SQL/Redis and explicit account/session support.
- Rollback notes: Revert this branch before migrated data is written, or restore a pre-schema-6 backup when downgrading after deployment.
