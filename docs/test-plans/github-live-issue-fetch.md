# Feature Test Plan: GitHub Live Issue Fetch

Branch: `feat/github-live-issue-fetch`

## Objective

Fetch live GitHub issues for a verified GitHub App installation by generating short-lived installation tokens server-side, then expose normalized issue previews that can be imported through the existing GitHub issue import mapper.

## User Story

As a workspace owner or contributor with delivery responsibility, I can fetch issues from a verified GitHub installation and import selected issues into OpenRoad without pasting raw payloads or storing GitHub tokens.

## Scope

- GitHub installation access token generation through the server-only GitHub App client.
- Live repository issue fetch using installation access tokens.
- Normalized GitHub issue preview response.
- Workspace-scoped API route for fetching issues from a verified installation.
- Reuse of existing payload-backed import route for selected issue import.
- Token non-persistence tests and response redaction tests.
- Docs for live issue fetch flow and remaining webhook/background-sync work.

## Not In Scope

- Browser Settings UI.
- Persisting installation access tokens.
- Automatic background sync.
- Webhook endpoint and signature verification.
- Conflict UI.
- Disconnect UI.
- Linear or Jira live fetch.

## Acceptance Criteria

- Fetch route requires workspace write permission or a scoped integration actor.
- Fetch route rejects public and viewer actors.
- Fetch route requires an active GitHub installation in `OPENROAD_INTEGRATION_FILE`.
- Fetch route rejects installation records from another workspace.
- Server client creates an installation access token and uses it to fetch repository issues.
- Installation tokens are never persisted, audited, or returned.
- Pull requests returned by GitHub's issues endpoint are filtered out.
- Normalized live issues can be imported through the existing payload-backed import route.
- Existing payload-backed imports, GitHub App verification, standalone flows, and ops backup/restore still pass.
- `pnpm check` passes.

## Automated Test Checklist

- GitHub App client posts to `/app/installations/:id/access_tokens` with a JWT.
- GitHub App client uses the installation token only in the outbound issues request.
- Client filters pull requests from repository issues.
- Client maps rate-limit and GitHub errors to structured upstream errors.
- Fetch route returns safe issue previews without tokens.
- Fetch route rejects missing repository names.
- Fetch route rejects missing or disconnected installation metadata.
- Fetch route rejects cross-workspace installation metadata.
- Fetch route allows owner/contributor workspace actors and scoped integration actors.
- Fetch route rejects public visitors and viewers.
- Existing import route accepts a selected live issue payload.
- Ops backup/restore tests still include integration metadata.
- `pnpm check` passes.

## Regression Checklist

- No GitHub token or private key is written into OpenRoad state, integration metadata, audit events, or API responses.
- `src/` browser bundle still does not import server-only GitHub App code.
- Public portal responses remain integration-free.
- Standalone mode still works with zero GitHub env vars and zero installations.
- Existing verified installation metadata remains schema version `1`.

## Security And Privacy Checks

- Installation tokens are generated per request and kept in memory only.
- Repository name input is bounded and path-encoded before GitHub API calls.
- Unknown raw GitHub payload fields are not returned from the preview route.
- GitHub errors do not echo request headers or tokens.
- Webhook signature verification remains required before any webhook mutation route is added.

## Migration And Rollback

- No OpenRoad core schema migration is expected.
- Integration metadata schema remains version `1`.
- Rollback by reverting this branch; verified GitHub installation metadata can remain for a later retry.

## Manual QA Checklist

- Run `pnpm vitest run server/github-app.test.ts server/http.test.ts server/integrations.test.ts src/integrations/github.test.ts scripts/openroad-ops.test.mjs`.
- Run `pnpm check`.
- Run built-server smoke with GitHub App env unset.
- Inspect fetch route responses for token leakage.

## Evidence

- Branch: `feat/github-live-issue-fetch`
- Commit SHAs: pending commit.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for live issue fetch without persisted token scope.
- Commands run:
  - `pnpm vitest run server/github-app.test.ts server/http.test.ts server/integrations.test.ts server/access.test.ts src/integrations/github.test.ts scripts/openroad-ops.test.mjs` - 74 tests passed.
  - `pnpm check` - 158 tests passed; production client and server builds passed.
  - Built-server smoke with GitHub App env unset and admin-token mode - passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Official GitHub docs confirmed installation token generation through `/app/installations/{id}/access_tokens`, token expiry, and repository issue listing through `/repos/{owner}/{repo}/issues`; implementation keeps tokens in memory only.
- Known unresolved risks: Webhook signature verification, background sync, conflict UI, disconnect UI, and browser Settings UI are intentionally deferred to `feat/github-webhook-disconnect` and later branches.
- Rollback notes: Revert this branch; verified installation metadata can remain in `OPENROAD_INTEGRATION_FILE` and payload-backed import remains available.
