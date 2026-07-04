# Feature Test Plan: Integration Adapter Contract

Branch: `feat/integration-adapter-contract`

## Objective

Define the provider-neutral integration boundary that GitHub, Linear, and Jira adapters must follow so external work can enrich OpenRoad without corrupting core requests, work items, roadmap items, changelog entries, or standalone workflows.

## User Story

As an OpenRoad maintainer adding GitHub, Linear, or Jira sync, I need a stable adapter contract for installations, external object references, mappings, sync jobs, conflicts, retries, and disconnect behavior before writing provider-specific code.

## Scope

- Provider-neutral adapter TypeScript contract.
- External object references and stable mapping keys.
- Installation and permission model types.
- Sync job, sync result, retry, and rate-limit result types.
- Conflict model for local/external divergence.
- Disconnect behavior notes that preserve OpenRoad source-of-truth data.
- Tests for key normalization, mapping identity, retry decisions, and provider fixture shape.
- Documentation for GitHub, Linear, and Jira adapters to implement later.

## Not In Scope

- OAuth flows.
- Provider API clients.
- Webhook handlers.
- Background job runner.
- Token storage.
- UI for connecting providers.
- Importing live GitHub, Linear, or Jira data.
- Mutating core OpenRoad domain schema.

## Acceptance Criteria

- Provider-specific fields stay outside core OpenRoad domain objects.
- Adapter contract can represent GitHub, Linear, and Jira installations.
- External object mappings are stable and deterministic.
- Sync conflicts have explicit local/external/base snapshots.
- Retry decisions distinguish retryable, rate-limited, conflict, and fatal outcomes.
- Disconnect behavior preserves OpenRoad data and marks mappings disconnected instead of deleting core objects.
- Provider fixtures validate against the shared contract.
- Existing standalone app and production server tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- External object keys are stable across equivalent provider refs.
- Mapping keys include installation, external object, and OpenRoad object identity.
- Retry helper retries transient failures and rate limits.
- Retry helper does not retry conflicts or fatal validation failures.
- Disconnect helper marks mappings disconnected without changing core object refs.
- GitHub issue fixture satisfies the adapter contract.
- Linear issue fixture satisfies the adapter contract.
- Jira issue fixture satisfies the adapter contract.
- Existing App, domain, server, and ops tests still pass.
- `pnpm check` passes.

## Regression Checklist

- No OpenRoad domain schema version change.
- Standalone request/work/roadmap/changelog/portal workflows still pass.
- Public portal hardening tests still pass.
- Auth/tenancy actor model still includes integration actor permissions.
- Self-host ops scripts still pass.
- No external network calls are introduced.

## Security And Privacy Checks

- No provider secrets or tokens are committed.
- Contract keeps provider tokens out of core domain and fixtures.
- Webhook signature handling is documented as future provider-specific work.
- Provider identifiers are normalized but not treated as authentication.
- Disconnect behavior does not delete OpenRoad source-of-truth data.

## Migration And Rollback

- No data migration is expected.
- Rollback by reverting this branch.
- Future provider persistence must add migration notes before storing mappings.

## Manual QA Checklist

- Run `pnpm vitest run src/integrations/adapter.test.ts server/access.test.ts`.
- Run `pnpm check`.
- Review docs for provider leakage into core domain.

## Evidence

- Branch: `feat/integration-adapter-contract`
- Commit SHA: pending commit.
- Date: 2026-07-04.
- Acceptance criteria status: Passed.
- Commands run:
  - `pnpm vitest run src/integrations/adapter.test.ts server/access.test.ts` - 12 tests passed.
  - `pnpm check` - 115 tests passed; production client and server builds passed.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending branch reviewer before merge.
- Known unresolved risks: OAuth flows, provider API clients, token storage, webhook handlers, background job runner, and live GitHub/Linear/Jira sync are intentionally deferred to provider-specific branches.
- Rollback notes: Revert this branch; no schema migration or persisted data transformation is included.
