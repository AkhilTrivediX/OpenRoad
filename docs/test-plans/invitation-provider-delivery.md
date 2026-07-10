# Feature Test Plan: Invitation Provider Delivery

Branch: `feat/invitation-provider-delivery`

## Objective

Add a production-safe server-side invitation delivery provider path so self-host operators can send invitation emails through a configured HTTPS provider/webhook endpoint instead of relying only on manual token copy or local JSONL handoff.

## User Story

As a workspace owner, I can create an invitation and trust the server to hand the invite to a configured delivery provider. As an operator, I need delivery secrets to stay server-side, failed provider calls to be retryable by creating/revoking operationally, and raw invitation tokens to stay out of OpenRoad team metadata, backups, list APIs, audit events, and browser-visible state.

## Scope

- HTTP provider invitation delivery adapter.
- Environment configuration for provider URL, optional bearer token, and timeout.
- Provider payload with public-safe invitation message fields, accept URL, workspace metadata, role, and recipient metadata.
- Provider response parsing for bounded message ids.
- Error handling that redacts token/secret-shaped provider failures before persistence or API response.
- Docs for API contract, deployment, runbook, README, and production readiness.

## Not In Scope

- Built-in SMTP socket client.
- Provider-specific SDKs.
- OAuth or provider account connection UI.
- Delivery retry queue, scheduler, or background worker.
- Bounce handling, unsubscribe routing, suppression lists, analytics, or verified sender setup.
- Changing invitation token semantics or making invitation delivery mandatory.

## Acceptance Criteria

- `OPENROAD_INVITATION_DELIVERY_MODE=http` creates an HTTP provider adapter only when a valid provider URL is configured.
- HTTP provider URLs must be HTTPS except localhost/loopback URLs for local tests/self-host development.
- Invitation creation posts a bounded JSON payload to the provider with recipient, workspace, role, subject, body, accept URL, expiration, and invitation id.
- Optional provider bearer token is sent only as an Authorization header and is never persisted, returned, logged in errors, or exposed to browser code.
- Successful provider responses mark invitation delivery as `sent` and persist only bounded delivery metadata.
- Non-2xx provider responses, invalid responses, timeout/abort, and network errors mark delivery as `failed` while keeping the invitation usable/revokable.
- Provider error text is bounded and redacts tokens, authorization headers, passwords, and invite query values.
- Existing disabled delivery mode and JSONL file handoff behavior continue to pass unchanged.
- Owner invitation UI, member sessions, account password login, member management, public portal, integration sync, ops, and release verification continue to pass.

## Automated Test Checklist

- HTTP provider adapter posts expected payload and bearer header to a local provider server.
- Provider payload includes accept URL but does not include admin tokens, session cookies, token hashes, provider secrets, or private workspace state.
- Adapter returns bounded message id from `messageId`, `message_id`, or `id`.
- Adapter rejects non-2xx responses with redacted, bounded errors.
- Adapter rejects insecure non-localhost HTTP URLs from environment.
- Environment factory creates disabled, file, and HTTP adapters correctly.
- Invitation creation with HTTP delivery persists `deliveryStatus: "sent"`, provider channel, attempted timestamp, and bounded message id.
- Invitation creation with failing HTTP delivery persists `deliveryStatus: "failed"` and a redacted bounded error while returning the one-time accept token exactly once.
- Existing JSONL adapter tests continue to pass.
- `pnpm check` passes.
- `pnpm release:verify` passes.

## Regression Checklist

- Manual invitation token copy still works when delivery is disabled.
- JSONL delivery handoff still appends raw-token operational records only when file mode is configured.
- Raw accept tokens remain out of team metadata, list APIs, audit events, backups, and browser-visible state.
- Accepted, revoked, expired, malformed, or wrong invitation tokens still cannot be reused.
- Account password, invite session, member management, owner session, bearer token, public portal, requester notification delivery, and integration sync tests remain green.

## Security And Privacy Checks

- Provider bearer token stays in process environment and outbound request headers only.
- Provider URL must be explicit and HTTPS unless localhost/loopback.
- Provider failure text is redacted before storage or API output.
- Provider payload intentionally transmits the accept URL to the configured server-side provider; no other secrets are included.
- Delivery metadata in team schema `4` remains bounded and does not require a schema bump.

## Migration And Rollback

- No schema bump is expected; existing invitation delivery metadata fields are reused.
- Rollback: set `OPENROAD_INVITATION_DELIVERY_MODE=disabled` or revert the branch. Invitations created while HTTP delivery was enabled remain valid; delivery metadata remains compatible with team schema `4`.

## Manual QA Checklist

- Run focused invitation delivery, HTTP invitation, team, app, ops, and release tests.
- Run `pnpm check`.
- Start the built server with isolated data and a local test HTTP provider.
- Create an invitation and verify the provider receives one payload, the API returns only the one-time accept token once, and persisted team metadata does not contain provider bearer tokens or raw passwords.
- Repeat with a failing provider and verify the invitation remains pending with redacted failed delivery metadata.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/invitation-provider-delivery`
- Implementation commit SHA: `b344742`
- Date: 2026-07-10.
- Commands run:
  - `pnpm vitest run server/invitation-delivery.test.ts server/http.test.ts` -> 97 passed.
  - `pnpm check` -> 381 passed, production client build passed, production server build passed.
  - Built-server HTTP provider smoke with `server-dist/server/index.js`, isolated data files, local provider endpoint, `OPENROAD_INVITATION_DELIVERY_MODE=http`, and `OPENROAD_PUBLIC_APP_URL=http://127.0.0.1:<port>/` -> created invitation returned `delivery.status: "sent"`, provider received one request, and team metadata did not contain the raw accept token or provider bearer token.
  - `pnpm release:verify` -> passed, dry-run release manifest generated with artifacts and required gates.
  - `git diff --check` -> passed.
- Browser/viewports tested: Not applicable unless UI changes are introduced.
- Accessibility checks: Not applicable unless UI changes are introduced.
- Reviewer notes: Sidecar security review completed before implementation cleanup. Coverage now blocks redirects, rejects insecure/non-local provider URLs, rejects provider URL credentials, sanitizes provider message ids, bounds provider response text, redacts provider failures, requires `OPENROAD_PUBLIC_APP_URL` for provider mode, and keeps provider delivery failures recoverable.
- Known unresolved risks: Built-in SMTP, provider-specific templates, retry scheduler, bounce handling, unsubscribe/suppression management, delivery analytics, and hosted provider admin remain future slices.
- Rollback notes: Set `OPENROAD_INVITATION_DELIVERY_MODE=disabled` to stop provider delivery immediately, or revert this branch. No schema bump was introduced; invitations created while HTTP delivery was enabled remain valid and store only schema-4 delivery metadata.
