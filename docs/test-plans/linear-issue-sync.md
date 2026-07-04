# Feature Test Plan: Linear Issue Sync

Branch: `feat/linear-issue-sync`

## Objective

Add the first Linear integration slice on the shared adapter contract: safe OAuth setup metadata, payload-backed Linear issue import/link, external mappings, and workspace-scoped API protection.

## User Story

As a workspace owner, I can prepare a Linear OAuth connection and import Linear issues into OpenRoad requests without losing standalone usability or leaking Linear credentials into OpenRoad core state.

## Scope

- Linear issue payload parser and request sync mapper.
- Linear installation metadata model using the shared integration adapter contract.
- Linear issue external mappings in `OPENROAD_INTEGRATION_FILE`.
- Payload-backed Linear issue import/link endpoint.
- Safe Linear OAuth setup endpoint with authorize URL and state.
- Server-only Linear environment parsing and secret redaction.
- Docs for official Linear API/OAuth/webhook references and deferred token storage.

## Not In Scope

- OAuth callback and token exchange.
- Persisting Linear access tokens or refresh tokens.
- Linear live GraphQL fetch.
- Linear webhook endpoint.
- Browser Settings UI.
- Background sync jobs or conflict UI.
- Jira integration.

## Acceptance Criteria

- Linear issue import creates a private OpenRoad request by default.
- Re-importing the same Linear issue updates the mapped request instead of creating a duplicate.
- Import can link a Linear issue to an existing OpenRoad request.
- Linear mappings persist outside OpenRoad core workspace state.
- The same Linear installation ID can exist in multiple OpenRoad workspaces without overwriting another workspace.
- Public and viewer actors cannot import Linear issues or view OAuth setup.
- Contributor or scoped integration actors can import Linear issues only inside their workspace.
- OAuth setup requires `integration:manage` and returns no client secret or token values.
- Standalone OpenRoad works with zero Linear environment variables.
- Existing GitHub import, live fetch, webhook/disconnect, backup/restore, and public portal tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Linear parser accepts official-style issue fields: `id`, `identifier`, `title`, `description`, `url`, `state`, `team`, `assignee`, `labels`, and `project`.
- Linear parser rejects missing issue identity/title/team data.
- Linear mapper creates deterministic external object refs using provider ID, not display key alone.
- Linear request creation maps issue state, assignee, labels, project, and team into OpenRoad fields/tags.
- Linear request sync updates title/status/tags/owner while preserving request identity.
- Server import route persists installation and mapping metadata outside core state.
- Server import route re-imports by mapping and updates the existing request.
- Server import route preserves same installation IDs across multiple workspaces.
- Server import route rejects disconnected/suspended installations.
- Access contract documents Linear import and setup routes.
- Safe OAuth setup output redacts `OPENROAD_LINEAR_CLIENT_SECRET`.
- Ops backup/restore still accepts integration metadata containing Linear records and sync events.

## Regression Checklist

- GitHub installation scoping remains provider/workspace aware.
- GitHub webhook signature verification still happens before JSON parsing.
- GitHub manual disconnect and webhook disconnect still preserve OpenRoad requests.
- Public portal responses do not expose Linear metadata or mappings.
- `OPENROAD_INTEGRATION_FILE` schema remains version `1`.
- Browser bundle does not import server-only Linear OAuth config code.

## Security And Privacy Checks

- Do not persist Linear OAuth access tokens, refresh tokens, client secrets, webhook secrets, or raw OAuth codes.
- Do not return client secrets in setup responses.
- Keep Linear issue bodies private by default.
- Bound Linear payload size.
- Validate workspace scope before mutation.
- Keep provider-specific data in integration metadata and adapter modules.

## Migration And Rollback

- No OpenRoad core schema migration is expected.
- Integration metadata schema remains version `1`; Linear installations and mappings use the existing provider enum.
- Rollback by reverting this branch; existing Linear metadata can remain ignored by older code or be removed by an operator.

## Manual QA Checklist

- Run focused Linear/GitHub/integration/server tests.
- Run `pnpm check`.
- Run built-server smoke with Linear and GitHub env unset.
- Inspect persisted OpenRoad state to confirm Linear mappings are not embedded in workspace objects.
- Inspect API responses to confirm no Linear client secret or token is returned.

## Evidence

- Branch: `feat/linear-issue-sync`
- Commit SHAs: pending.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for safe Linear OAuth setup, payload-backed Linear issue import/link, workspace-scoped metadata, and standalone operation with zero Linear env vars.
- Commands run:
  - `pnpm vitest run server/linear.test.ts src/integrations/linear.test.ts server/http.test.ts server/access.test.ts server/integrations.test.ts scripts/openroad-ops.test.mjs src/integrations/github.test.ts server/github-app.test.ts` - 96 tests passed.
  - `pnpm check` - 180 tests passed; production client and server builds passed.
  - Built-server smoke with GitHub and Linear env unset and admin-token mode - passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Official Linear docs confirm GraphQL endpoint `https://api.linear.app/graphql`, OAuth authorization/token shape, OAuth scopes, and webhook signature requirements. This branch intentionally avoids token persistence until a production secret-store slice exists.
- Known unresolved risks: OAuth callback/token exchange, encrypted token storage, live GraphQL fetch, Linear webhooks, browser Settings UI, and conflict UI remain later production slices.
- Rollback notes: Revert this branch; existing Linear metadata can remain in `OPENROAD_INTEGRATION_FILE` for a later retry or be removed by an operator after backup.
