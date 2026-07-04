# Feature Test Plan: GitHub App Installation

Branch: `feat/github-app-installation`

## Objective

Add the first live GitHub App installation foundation on top of the payload-backed GitHub issue import route, keeping credentials server-only and preserving OpenRoad standalone workflows.

## User Story

As an OpenRoad workspace owner, I can see whether GitHub App connection is configured, open a GitHub installation URL, and verify a GitHub installation into OpenRoad integration metadata without storing GitHub tokens in core state.

## Scope

- GitHub App environment/config parser.
- GitHub installation setup URL builder.
- Server-only GitHub App JWT helper for future GitHub API calls.
- Installation verification endpoint backed by an injectable GitHub App client.
- Mapping GitHub installation API metadata into OpenRoad integration installation metadata.
- Integration metadata persistence for verified installations.
- Access contract and audit events for setup/verification routes.
- Docs for required GitHub App settings, permissions, and deferred token/webhook work.

## Not In Scope

- Browser settings UI.
- Persisting installation access tokens.
- Fetching/importing live GitHub issues after verification.
- Webhook endpoint and signature verification.
- Background sync jobs.
- OAuth user token flow.
- Linear or Jira live installation.

## Acceptance Criteria

- Setup route reports configured/missing GitHub App setup safely without exposing secrets.
- Setup route returns a GitHub installation URL when `OPENROAD_GITHUB_APP_SLUG` is configured.
- Installation verification requires workspace write permission.
- Verification uses a server-side GitHub App client boundary and can be tested without network calls.
- Verified installation metadata persists in `OPENROAD_INTEGRATION_FILE`.
- Verification response never includes private key, webhook secret, installation token, or raw credential values.
- Public and viewer actors cannot verify installations.
- Existing payload-backed GitHub issue import remains working.
- Standalone app/domain/server tests still pass with zero GitHub App config.
- `pnpm check` passes.

## Automated Test Checklist

- Config parser returns missing keys without leaking configured secret values.
- Setup URL uses the GitHub App slug and encoded workspace state.
- JWT helper signs a GitHub App JWT with RS256 and expected `iss`, `iat`, and `exp` claims.
- GitHub API installation payload maps into OpenRoad GitHub installation metadata.
- Setup route returns safe config status in single-user mode.
- Verification route persists installation metadata through the integration store.
- Verification route records an audit event.
- Verification route rejects missing installation ids.
- Verification route rejects public actors in admin-token mode.
- Verification route rejects trusted viewer actors.
- Verification route rejects trusted integration actors because installation management is owner/admin-only.
- Verifying the same GitHub installation id into two OpenRoad workspaces preserves both workspace records.
- Integration metadata parsing drops unknown secret-like fields.
- Payload-backed GitHub issue import tests still pass.
- Ops backup/restore still includes integration metadata.
- `pnpm check` passes.

## Regression Checklist

- No GitHub secret is bundled into `src/` browser code.
- No GitHub token or private key is written into OpenRoad core state, integration metadata, audit events, or API responses.
- Existing public portal routes remain public-only and do not expose integration metadata.
- `OPENROAD_INTEGRATION_FILE` remains optional for old installs until first integration write or backup.
- Existing self-host smoke still passes without GitHub App env vars.

## Security And Privacy Checks

- Private key handling stays in `server/`.
- Installation access tokens are not persisted in this slice.
- Setup state is informational and must not be treated as authentication.
- Trusted proxy headers remain disabled by default.
- Webhook signature verification is documented as required before any webhook mutation route is added.

## Migration And Rollback

- No OpenRoad core schema migration is expected.
- Integration metadata schema remains version `1`.
- Rollback by reverting this branch; existing GitHub installation metadata can remain in `OPENROAD_INTEGRATION_FILE` for a future retry or be removed by an operator.

## Manual QA Checklist

- Run `pnpm vitest run server/github-app.test.ts server/http.test.ts server/access.test.ts src/integrations/github.test.ts scripts/openroad-ops.test.mjs`.
- Run `pnpm check`.
- Run built-server smoke with no GitHub App env vars.
- Inspect API responses for secret leakage.

## Evidence

- Branch: `feat/github-app-installation`
- Commit SHAs: `f38a160`.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for server-only GitHub App setup and installation verification scope.
- Commands run:
  - `pnpm vitest run server/github-app.test.ts server/http.test.ts server/access.test.ts src/integrations/github.test.ts scripts/openroad-ops.test.mjs` - 60 tests passed before reviewer hardening.
  - `pnpm vitest run server/github-app.test.ts server/integrations.test.ts server/http.test.ts server/access.test.ts src/integrations/github.test.ts scripts/openroad-ops.test.mjs` - 68 tests passed after owner-only and store-boundary hardening.
  - `pnpm check` - 152 tests passed; production client and server builds passed.
  - Built-server smoke with GitHub App env unset and admin-token mode - passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Sidecar review found overly broad workspace-write verification access, workspace-overwriting installation upsert, secret-field persistence risk, and setup-state misuse risk. Fixed owner/admin-only `integration:manage`, workspace-aware installation upsert, store/API sanitization, and documented setup state as informational only.
- Known unresolved risks: Live issue fetch, webhook signature verification, background sync, conflict UI, disconnect UI, and browser Settings UI are intentionally deferred to `feat/github-live-issue-fetch` and later branches.
- Rollback notes: Revert this branch; existing GitHub installation metadata can remain in `OPENROAD_INTEGRATION_FILE` for a future retry or be removed by an operator.
