# Feature Test Plan: GitHub Issue Sync

Branch: `feat/github-issue-sync`

## Objective

Implement the first provider-specific integration slice on top of the shared adapter contract: GitHub issue import/link with persisted external mappings that do not pollute OpenRoad core objects or break standalone workflows.

## User Story

As an OpenRoad maintainer, I can import or link a GitHub issue into an OpenRoad workspace, keep the GitHub mapping outside the core workspace state, re-run the import safely, and still use OpenRoad with no integrations configured.

## Scope

- GitHub issue payload parser and normalizer.
- GitHub installation permission/capability model.
- GitHub issue to OpenRoad request import/update mapper.
- GitHub issue and pull request external object mappings.
- File-backed integration metadata store.
- Production API endpoint for fixture/payload-backed GitHub issue import.
- Access contract entry for the GitHub import route.
- Audit events for GitHub import/link actions.
- Documentation for live GitHub App permissions and deferred OAuth/webhook work.

## Not In Scope

- OAuth browser installation flow.
- GitHub App private key handling.
- Live GitHub REST/GraphQL clients.
- Webhook signature verification.
- Background sync runner.
- Conflict UI.
- Linear or Jira adapters.

## Acceptance Criteria

- GitHub issue import creates an OpenRoad request when no mapping exists.
- GitHub issue import links to an existing request when a request id is provided.
- Re-importing the same GitHub issue updates the mapped request instead of creating duplicates.
- Linked pull requests create external mappings without changing core request schema.
- GitHub installation permissions are represented without storing tokens or secrets.
- GitHub mappings persist in a separate integration metadata store.
- GitHub route requires workspace write access and rejects public/viewer actors.
- Invalid GitHub payloads fail without mutating OpenRoad or integration state.
- Standalone app/domain/server tests still pass with zero integrations configured.
- `pnpm check` passes.

## Automated Test Checklist

- GitHub issue payload parser accepts REST-like snake_case payloads.
- Parser rejects GitHub pull requests submitted as issues.
- Parser rejects missing issue identity, title, number, or repository identity.
- Request import preserves OpenRoad defaults for owner, visibility, votes, and archive state.
- Status mapping handles open, planned/milestoned, needs-decision, and closed issues.
- Existing request sync updates title, description, status, tags, and GitHub sync comment without duplicating comments.
- Issue mapping uses the GitHub provider id through the adapter contract.
- Pull request mapping attaches to the same OpenRoad request without core schema changes.
- Integration store seeds empty state, persists installations/mappings, and rejects future schema versions.
- API import creates request, mapping, and audit event.
- API re-import updates existing request and keeps a single issue mapping.
- API link mode updates the chosen request instead of creating a new one.
- API rejects unauthenticated public actors when admin-token mode is enabled.
- API rejects trusted viewer actors and allows trusted contributors/maintainers.
- API rejects invalid payloads without changing persisted state or integration metadata.
- Existing App, domain, server, adapter, ops, and portal tests still pass.

## Regression Checklist

- No core `Workspace`, `RequestItem`, `WorkItem`, `RoadmapItem`, or `ChangelogItem` provider-specific fields are added.
- Public portal responses do not expose integration mappings or GitHub metadata files.
- Existing `/api/openroad/actions` and standalone reducer workflows still pass.
- Integration actor permissions remain scoped to the requested workspace.
- File-backed team metadata and self-host ops tests still pass.

## Security And Privacy Checks

- No GitHub tokens, app private keys, webhook secrets, or OAuth secrets are committed.
- API responses never echo unknown credential-like fields from the request body.
- GitHub route is not public.
- Integration metadata stores only provider ids, display keys, URLs, mappings, and non-secret installation metadata.
- Payload validation happens before persistence.

## Migration And Rollback

- No OpenRoad core schema migration is expected.
- A new integration metadata file is created at `.openroad/openroad-integrations.json` by default.
- Rollback by reverting this branch and deleting the integration metadata file if no longer needed.

## Manual QA Checklist

- Run `pnpm vitest run src/integrations/github.test.ts src/integrations/adapter.test.ts server/integrations.test.ts server/access.test.ts server/http.test.ts`.
- Run `pnpm check`.
- Run production smoke after merge if server paths change.
- Review persisted OpenRoad state to ensure GitHub mappings are not embedded in workspace objects.

## Evidence

- Branch: `feat/github-issue-sync`
- Commit SHAs: pending commit.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for payload-backed GitHub issue import/link scope.
- Commands run:
  - `pnpm vitest run src/integrations/github.test.ts src/integrations/adapter.test.ts server/integrations.test.ts server/access.test.ts server/http.test.ts` - 53 tests passed.
  - `pnpm vitest run scripts/openroad-ops.test.mjs server/http.test.ts server/integrations.test.ts src/integrations/github.test.ts server/access.test.ts` - 52 tests passed.
  - `pnpm vitest run server/http.test.ts server/integrations.test.ts src/integrations/github.test.ts server/access.test.ts` - 45 tests passed after workspace-scoped duplicate detection hardening.
  - `pnpm check` - 137 tests passed; production client and server builds passed.
  - Built-server smoke with temp state, integration, and team files plus admin-token mode - passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Sidecar review advised keeping live GitHub/token code server-only, preserving standalone mode, and testing integration actor workspace scope; implemented in this branch.
- Known unresolved risks: GitHub App OAuth, live API fetch, webhook signature verification, background sync, conflict UI, disconnect UI, and token/private-key storage are intentionally deferred to `feat/github-app-installation`.
- Rollback notes: Revert this branch; preserve or delete `OPENROAD_INTEGRATION_FILE` depending on whether payload-backed GitHub mappings should be retained for a later rollout.
