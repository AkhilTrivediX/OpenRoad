# Feature Test Plan: Provider Write-Back

Branch: `feat/provider-write-back`

## Objective

Add production-safe, user-triggered provider write-back so an owner can push the selected OpenRoad request title and description to an already-linked GitHub, Linear, or Jira issue without exposing provider tokens, changing unrelated provider fields, or weakening standalone mode.

## User Story

As a workspace owner, I want OpenRoad to push a refined request title/description back to the linked delivery issue when I explicitly choose to, so the provider issue reflects the product decision without making Jira/Linear/GitHub the source of truth. As an operator, I need every write to require explicit external-write permission, use server-only credentials, redact provider failures, and leave clear audit/evidence.

## Scope

- Server-side write-back clients for GitHub, Linear, and Jira issue title/body fields.
- A same-origin write-back API for an active OpenRoad request mapping.
- Permission checks for workspace ownership/admin access, active installation, active mapping, active credential where required, and `write:external`.
- GitHub App installation token write-back for issue title/body.
- Linear encrypted credential write-back for issue title/description, including refresh of expired OAuth credentials through the existing refresh path where possible.
- Jira encrypted credential write-back for summary/description, including refresh of expired OAuth credentials through the existing refresh path where possible.
- Settings/request-detail UI affordance that stays hidden/disabled unless linked provider write-back is available.
- Docs, focused unit/API/UI tests, release evidence, `pnpm check`, built-server smoke, and CI.

## Not In Scope

- Automatic write-back on every OpenRoad edit.
- Provider status transitions, assignee changes, labels/tags, milestones, priorities, comments, projects, and custom fields.
- Conflict resolution UI.
- Bulk write-back.
- Creating new provider issues from OpenRoad requests.
- Distributed locking beyond the existing file-store mutation lock.

## Official Provider Rules

- GitHub issue updates use `PATCH /repos/{owner}/{repo}/issues/{issue_number}`. GitHub documents `title`, `body`, and `state` body parameters, with labels replacing the full label set; this slice avoids labels to prevent accidental provider data loss. GitHub docs also require issue or pull request repository write permission for fine-grained tokens.
- Linear issue edits use the GraphQL `issueUpdate` mutation. Linear documents `issueUpdate(id, input)` for title/state changes and GraphQL errors in an `errors` array; this slice sends title and description only.
- Jira issue edits use `PUT /rest/api/3/issue/{issueIdOrKey}` with `fields` and/or `update`. Atlassian documents that transitions are not handled by this endpoint, description fields use Atlassian Document Format, and `write:jira-work`/`write:issue:jira` scopes are required.

## Acceptance Criteria

- A write-back request can only target an active issue mapping for the same workspace, provider, installation, and OpenRoad request.
- The API rejects disconnected mappings/installations, unsupported provider object types, missing requests, wrong workspace, missing integration store, missing credentials, missing `write:external`, expired unrefreshable credentials, and token-vault misconfiguration with bounded sanitized errors.
- GitHub writes use a short-lived installation access token and never persist or return it.
- Linear/Jira writes open encrypted credentials server-side; expired OAuth credentials refresh through the existing rotation path before the provider write when refresh material/config is present.
- Provider requests send only bounded title and body/description derived from the current OpenRoad request.
- Provider responses, sync events, audit events, logs, API responses, and UI state never expose access tokens, refresh tokens, private keys, provider authorization headers, ciphertext, IVs, tags, raw provider bodies, client secrets, or webhook secrets.
- Successful write-back records a sanitized audit event and a bounded integration event, and updates safe mapping metadata without changing OpenRoad request contents.
- Standalone request capture/edit, import/link, live sync, webhooks, refresh rotation, provider connect/disconnect, requester notifications, and release tooling remain green.

## Automated Test Checklist

- Provider client tests:
  - GitHub sends `PATCH` to the issue URL with title/body only and app installation bearer auth.
  - Linear sends GraphQL `issueUpdate` with `title` and `description`, parses success, maps GraphQL/provider errors safely, and supports API-key or bearer authorization.
  - Jira sends `PUT` to the cloud-scoped issue URL with `fields.summary` and ADF `fields.description`, maps `204`/`200` success, and maps provider errors safely.
- Write-back service/API tests:
  - Success for GitHub, Linear, and Jira already-linked issue mappings.
  - Wrong workspace/request/provider/mapping and disconnected installation/mapping are rejected.
  - Missing `write:external` on installation or credential is rejected.
  - Expired Linear/Jira OAuth credential with refresh token rotates before write-back.
  - Provider retryable failures return sanitized retryable responses and do not persist raw provider bodies.
  - Provider validation/auth failures return sanitized fatal responses.
  - API responses contain no provider tokens, encrypted payload internals, raw authorization headers, or raw provider response bodies.
- UI tests:
  - Linked request detail shows a provider write-back action only when server status says a provider has write-back capability for the selected request.
  - The action calls the write-back API, reports success/failure, and does not render provider secrets.
  - Standalone requests with no mapping are not cluttered by write-back controls.
- Regression tests:
  - OAuth callback exchange tests remain green.
  - OAuth refresh rotation tests remain green.
  - Provider credential create/list/revoke tests remain green.
  - GitHub/Linear/Jira sync worker and webhook tests remain green.
  - `pnpm check`, `pnpm release:verify`, built-server smoke, and GitHub Actions production gate pass before merge.

## Security And Privacy Checks

- Provider write-back never accepts provider tokens or OAuth codes from the browser.
- The write-back API derives provider target identity from stored mappings, not browser-supplied owner/repo/issue/cloud ids.
- Request body text is bounded before sending to providers.
- Provider errors are redacted before persistence or API output.
- `write:external` is required separately from `read:external`.
- Provider-specific fields stay outside OpenRoad core domain state.

## Manual QA Checklist

- Start built server with GitHub App config and a fake GitHub API, import/link a GitHub issue, update the OpenRoad request title/description, trigger write-back, and confirm the fake GitHub issue receives the bounded title/body only.
- Repeat for Linear with an encrypted OAuth credential and fake GraphQL endpoint.
- Repeat for Jira with an encrypted OAuth credential and fake REST endpoint.
- Start built server with only standalone state and confirm no write-back controls appear for standalone requests.
- Confirm `pnpm ops:smoke` still passes against `server-dist`.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch. External provider issues already updated by explicit write-back remain changed in the provider; OpenRoad metadata remains readable because no storage shape changes are planned.

## Evidence

- Branch: `feat/provider-write-back`
- Implementation commit SHA: `0cb9aee7654155298069d5220d96de0a0e146cde`.
- Date: 2026-07-10.
- Commands run:
  - `pnpm vitest run server/github-app.test.ts server/linear-sync-worker.test.ts server/jira-sync-worker.test.ts` -> 3 files, 38 tests passed.
  - `pnpm vitest run server/http.test.ts` -> 105 tests passed.
  - `pnpm vitest run src/persistence/openroadIntegrations.test.ts src/App.test.tsx` -> 78 tests passed after adding the request inspector write-back affordance; `src/persistence/openroadIntegrations.test.ts` rerun -> 11 tests passed after redaction expectation alignment.
  - `pnpm check` -> 34 files, 430 tests passed, then `pnpm build` completed client and server builds.
  - `pnpm release:verify` -> release manifest dry-run passed for current build artifacts.
  - Built-server smoke against `server-dist/server/index.js` on `http://127.0.0.1:4217` with temporary file-backed state and `OPENROAD_TOKEN_ENCRYPTION_KEY` -> `OpenRoad smoke passed: health, contract, portal, private-denied, private-token`.
- Browser/viewports tested: In-app browser desktop viewport `1280x720` against temporary built server on `http://127.0.0.1:4218`; authenticated with a temporary local admin token; selected request inspector action row measured at `389x36`, showed `Add vote` and `Archive request`, no standalone write-back control, no action overlap, and no console errors.
- Reviewer notes: Passed. GitHub, Linear, and Jira write-back derive provider targets from active stored mappings, require active `write:external` installations, and keep provider tokens server-only. Linear/Jira credentials require `write:external`; expired Linear OAuth write-back coverage verifies refresh-token rotation before provider write. Provider client tests cover GitHub `PATCH`, Linear `issueUpdate`, and Jira v3 ADF update bodies. HTTP tests cover provider success paths, missing mapping, missing write permission, sanitized upstream failures, mapping `lastSyncedAt`, sync events, audit-safe responses, and no provider secret leakage. Browser UI keeps the control hidden for standalone requests and exposes the request inspector action only when sanitized provider status reports write-back for a provider-sourced request.
- Known unresolved risks: Conflict UI, provider status transitions, label/tag mapping, bulk write-back, hosted webhook registration automation, automatic provider issue creation, and distributed write locks remain later production slices.
- Rollback notes: Revert this branch and redeploy the previous build. No state or integration metadata schema migration is introduced. Provider issues explicitly updated before rollback remain changed in the provider; restore provider-side history manually if needed.
