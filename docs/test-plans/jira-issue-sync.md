# Feature Test Plan: Jira Issue Sync

Branch: `feat/jira-issue-sync`

## Objective

Add the first Jira integration slice on the shared adapter contract: safe Atlassian OAuth setup metadata, payload-backed Jira issue import/link, explicit field mapping, external mappings, and workspace/provider-scoped API protection.

## User Story

As a workspace owner, I can prepare a Jira OAuth connection and import Jira issues into OpenRoad requests without losing standalone usability, storing Atlassian secrets in core state, or exposing Jira complexity in the default product flow.

## Scope

- Jira issue payload parser for Jira Cloud REST/webhook-like issue objects.
- Jira installation metadata model using the shared integration adapter contract.
- Explicit Jira field mapping into OpenRoad request title, description, requester, owner, status, tags, and source comment.
- Jira issue external mappings in `OPENROAD_INTEGRATION_FILE`.
- Payload-backed Jira issue import/link endpoint.
- Safe Atlassian OAuth setup endpoint with authorize URL, state, and required scopes.
- Server-only Jira environment parsing and secret redaction.
- Docs for official Atlassian OAuth/API/webhook references and deferred token storage.

## Not In Scope

- OAuth callback and token exchange.
- Persisting Atlassian access tokens or refresh tokens.
- Live Jira REST fetch.
- Jira webhook endpoint.
- Browser Settings UI.
- Background sync jobs or conflict UI.
- Full Jira field configuration discovery.

## Acceptance Criteria

- Jira issue import creates a private OpenRoad request by default.
- Re-importing the same Jira issue updates the mapped request instead of creating a duplicate.
- Import can link a Jira issue to an existing OpenRoad request.
- Jira mappings persist outside OpenRoad core workspace state.
- The same Jira installation ID can exist in multiple OpenRoad workspaces without overwriting another workspace.
- Public and viewer actors cannot import Jira issues or view OAuth setup.
- Contributor or scoped integration actors can import Jira issues only inside their workspace and only when provider/id scope matches the Jira installation.
- OAuth setup requires `integration:manage` and returns no client secret, OAuth code, token, or refresh token values.
- Standalone OpenRoad works with zero Jira environment variables.
- Existing GitHub import, live fetch, webhook/disconnect, Linear import/setup, backup/restore, and public portal tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Jira parser accepts REST/webhook-like issue fields: `id`, `key`, `self`, `fields.summary`, `fields.description`, `fields.status`, `fields.issuetype`, `fields.project`, `fields.assignee`, `fields.reporter`, `fields.labels`, `fields.priority`, and `fields.updated`.
- Jira parser accepts Atlassian Document Format descriptions and converts them into readable text.
- Jira parser rejects missing issue identity/key/summary/project/status data.
- Jira mapper creates deterministic external object refs using provider ID, not display key alone.
- Jira request creation maps issue status category, assignee, labels, priority, issue type, and project into OpenRoad fields/tags.
- Jira request sync updates title/status/tags/owner while preserving request identity and comments.
- Server import route persists installation and mapping metadata outside core state.
- Server import route re-imports by mapping and updates the existing request.
- Server import route preserves same installation IDs across multiple workspaces.
- Server import route rejects disconnected/suspended Jira installations.
- Access contract documents Jira import and setup routes.
- Safe OAuth setup output redacts `OPENROAD_JIRA_CLIENT_SECRET`.
- Ops backup/restore still accepts integration metadata containing Jira records and sync events.

## Regression Checklist

- GitHub installation scoping remains provider/workspace aware.
- GitHub webhook signature verification still happens before JSON parsing.
- Linear issue import/setup remains provider/workspace aware.
- Public portal responses do not expose Jira metadata or mappings.
- `OPENROAD_INTEGRATION_FILE` schema remains version `1`.
- Browser bundle does not import server-only Jira OAuth config code.

## Security And Privacy Checks

- Do not persist Atlassian OAuth access tokens, refresh tokens, client secrets, webhook secrets, or raw OAuth codes.
- Do not return client secrets in setup responses.
- Keep Jira issue bodies private by default.
- Bound Jira payload size.
- Validate workspace and provider/id actor scope before mutation.
- Keep provider-specific data in integration metadata and adapter modules.

## Migration And Rollback

- No OpenRoad core schema migration is expected.
- Integration metadata schema remains version `1`; Jira installations and mappings use the existing provider enum.
- Rollback by reverting this branch; existing Jira metadata can remain ignored by older code or be removed by an operator after backup.

## Manual QA Checklist

- Run focused Jira/GitHub/Linear/integration/server tests.
- Run `pnpm check`.
- Run built-server smoke with GitHub, Linear, and Jira env unset.
- Inspect persisted OpenRoad state to confirm Jira mappings are not embedded in workspace objects.
- Inspect API responses to confirm no Jira client secret, OAuth code, token, or refresh token is returned.

## Evidence

- Branch: `feat/jira-issue-sync`
- Commit SHAs: `0c0e8a1`, `5884db3`.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for safe Jira OAuth setup, payload-backed Jira issue import/link, explicit Jira field mapping, workspace-scoped metadata, provider/id-scoped integration actors, and standalone operation with zero Jira env vars.
- Commands run:
  - `pnpm vitest run src/integrations/jira.test.ts server/jira.test.ts` - 9 tests passed.
  - `pnpm vitest run server/jira.test.ts src/integrations/jira.test.ts server/http.test.ts server/access.test.ts server/integrations.test.ts server/linear.test.ts src/integrations/linear.test.ts server/github-app.test.ts src/integrations/github.test.ts scripts/openroad-ops.test.mjs` - 111 tests passed.
  - `pnpm check` - 195 tests passed; production client and server builds passed.
  - Built-server smoke with GitHub, Linear, and Jira env unset and admin-token mode - passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
  - After read-only audit hardening: `pnpm vitest run server/jira.test.ts src/integrations/jira.test.ts server/http.test.ts server/access.test.ts server/integrations.test.ts server/linear.test.ts src/integrations/linear.test.ts server/github-app.test.ts src/integrations/github.test.ts scripts/openroad-ops.test.mjs` - 112 tests passed.
  - After read-only audit hardening: `pnpm check` - 196 tests passed; production client and server builds passed.
  - After read-only audit hardening: built-server smoke with GitHub, Linear, and Jira env unset and admin-token mode - passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Official Atlassian docs confirm OAuth 2.0 3LO uses `https://auth.atlassian.com/authorize`, authorization-code token exchange at `https://auth.atlassian.com/oauth/token`, API access through `api.atlassian.com`, classic Jira scopes including `read:jira-work`, `read:jira-user`, and `manage:jira-webhook`, and retry/idempotency headers for Jira webhooks. Read-only audit found Jira issue IDs must be cloud/site scoped and payload imports must not mint future write-back/webhook capabilities; both were hardened with regression coverage. This branch intentionally avoids token persistence until a production secret-store slice exists.
- Known unresolved risks: OAuth callback/token exchange, encrypted token storage, live Jira REST fetch, Jira webhooks, browser Settings UI, and conflict UI remain later production slices.
- Rollback notes: Revert this branch; existing Jira metadata can remain in `OPENROAD_INTEGRATION_FILE` for a later retry or be removed by an operator after backup.
