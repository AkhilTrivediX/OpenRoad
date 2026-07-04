# Feature Test Plan: App Module Decomposition

Branch: `feat/app-module-decomposition`

## Objective

Reduce the risk of future product work by splitting the monolithic React app into clearer feature and utility modules while preserving the current OpenRoad UX, data model, persistence behavior, and production server contract.

## User Story

As a maintainer building OpenRoad toward public portal, integrations, and AI assistance, I need app code organized by ownership boundaries so feature work can move faster without accidentally breaking requests, work items, roadmap, changelog, portal, or settings workflows.

## Scope

- Move shared domain/view helpers out of `App.tsx`.
- Move seed/demo data construction out of `App.tsx`.
- Move UI copy/formatting helpers into a local app module.
- Keep the current component behavior and visual structure unchanged.
- Add tests for extracted helpers where behavior is meaningful.
- Preserve existing app, domain, server, and operations tests.

## Not In Scope

- Visual redesign.
- New product workflows.
- Route changes.
- Provider integrations.
- Auth/session UI.
- Database migration.
- Public portal abuse controls.
- State schema changes.
- Replacing the current test framework.

## Acceptance Criteria

- `App.tsx` no longer owns seed data construction.
- Reusable request/work/roadmap/changelog helper logic has a non-React module owner.
- Extracted modules use product-language names and provider-neutral types.
- No current app screen, navigation item, panel, or workflow is removed.
- No domain schema version changes are introduced.
- Local storage and production server sync behavior remain unchanged.
- Public/private portal visibility remains unchanged.
- UI shell still avoids document/body scrolling through existing tests and browser QA where needed.
- The branch does not add new dependencies.
- `pnpm check` passes on the feature branch and merged `main`.

## Automated Test Checklist

- Extracted seed-data helpers produce a valid initial OpenRoad state.
- Extracted view helpers preserve request counts, filters, status labels, and linked-object summaries.
- Existing App workflow tests pass unchanged.
- Existing domain migration/import/export tests pass unchanged.
- Existing server store, auth, tenancy, team, and HTTP tests pass unchanged.
- Existing self-host operations tests pass unchanged.
- `pnpm check` passes.

## Regression Checklist

- Workspace creation and selection still work.
- Manual request capture, edit, archive, search, vote, comment, and tags still work.
- Request triage, duplicate merge, owner assignment, and saved views still work.
- Native work item creation, linking, editing, commenting, and unlinking still work.
- Roadmap Now/Next/Later creation, movement, linking, and public/private state still work.
- Changelog draft creation from manual input, work, and roadmap still works.
- Public portal preview and moderation still hide private content.
- Import/export, corrupt recovery, and reset flows still work.
- Production server APIs, audit events, and ops tooling still pass tests.

## Security And Privacy Checks

- No secrets are committed.
- No external service calls are added.
- Provider-specific fields remain outside core UI/domain helpers.
- Public portal projection continues using existing domain filtering.
- Extracted helpers do not bypass permission or visibility contracts.

## Migration And Rollback

- No data migration is expected.
- Rollback by reverting this branch.
- Since the branch is structural, existing persisted OpenRoad data should remain compatible.
- If a module extraction breaks behavior, revert the branch and keep the previous monolithic `App.tsx` implementation.

## Manual QA Checklist

- Run `pnpm check`.
- Start production server with temporary data files.
- Run `pnpm ops:smoke` in single-user mode.
- Run `pnpm ops:smoke` in admin-token mode.
- Browser QA at desktop and compact widths if rendered markup or layout structure changes.
- Review diff to confirm no UI copy, color, spacing, or hierarchy changes were intended.

## Evidence

- Branch: `feat/app-module-decomposition`
- Commit SHA: pending.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for helper/module extraction without intended UX or schema changes.
- Commands run:
  - `pnpm vitest run src/app/openroadViewModel.test.ts src/app/openroadChangelog.test.ts`: 7 focused tests passed.
  - `pnpm check`: 105 tests passed; client and server production builds passed.
  - Production single-user smoke on port `4199`: health, contract, portal, and private single-user checks passed.
  - Production token-mode smoke on port `4200`: health, contract, portal, unauthenticated private denial, and authenticated private access passed.
- Browser/viewports tested: No rendered markup or layout changes intended; existing App workflow tests and production smoke were used for regression.
- Accessibility checks: No UI structure or copy changes intended; existing component tests passed.
- Reviewer notes: Self-review completed against the decomposition scope. `App.tsx` reduced from 3,642 to 3,433 lines; helper/draft/changelog logic now has module owners and focused tests.
- Known unresolved risks: `App.tsx` still owns many event handlers and rendered sections; component-level splitting, app-level error boundary, and automated browser E2E remain future production slices.
- Rollback notes: Revert branch; no data migration or schema rollback required.
