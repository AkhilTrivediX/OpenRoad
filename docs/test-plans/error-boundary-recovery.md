# Feature Test Plan: Error Boundary Recovery

Branch: `feat/error-boundary-recovery`

## Objective

Add an app-level recovery boundary so unexpected React runtime errors do not leave OpenRoad as a blank screen. The recovery UI must preserve user trust, avoid leaking technical details by default, and provide safe local recovery actions.

## User Story

As a maintainer using OpenRoad, if the app shell crashes, I can see that OpenRoad caught the failure, retry the app, or clear local browser state when local data is the likely problem.

## Scope

- Root-level React error boundary wrapping `App`.
- Calm fallback UI with clear recovery actions.
- Retry action that attempts to render OpenRoad again without clearing data.
- Local-data reset action that uses the existing OpenRoad local persistence clear path.
- Tests for fallback rendering, retry, local reset, and normal child rendering.
- Documentation update for production readiness.

## Not In Scope

- External error reporting service.
- Server log ingestion or observability dashboard.
- Automatic upload of stack traces or user data.
- Product data schema changes.
- Hosted support ticket workflow.

## Acceptance Criteria

- The root React tree is wrapped in an error boundary.
- Normal app rendering is unchanged.
- A child render crash shows a recovery UI instead of a blank screen.
- Retry re-renders children when the crash condition is gone.
- Reset local data clears OpenRoad local persistence keys and keeps the user on a recovery screen.
- The fallback does not expose stack traces, local data contents, requester data, provider payloads, tokens, or secrets.
- Existing standalone, public portal, integration, notification, assistant, release, and ops tests still pass.

## Automated Test Checklist

- Boundary renders children when there is no crash.
- Boundary catches a child render error and shows a named recovery region.
- Retry action clears boundary error state and renders recovered children.
- Reset action calls the existing `clearOpenRoadState` behavior and removes OpenRoad storage keys.
- Fallback copy does not render the thrown error message by default.
- App entry imports and uses the boundary.
- `pnpm check` passes.

## Regression Checklist

- Corrupt persisted OpenRoad state recovery still works through existing load recovery.
- Workspace export/import remains available when the app is healthy.
- Reset demo data in Settings still works when the app is healthy.
- Release verification and built-server smoke still pass.
- No server API or schema changes are introduced.

## Security And Privacy Checks

- Do not send error details to external services.
- Do not expose stack traces or persisted workspace data in the fallback UI.
- Do not clear integration/team/server files from the browser recovery action.
- Do not print secrets in tests or docs.

## UX And Accessibility Checks

- Recovery fallback has a named region and visible heading.
- Buttons have direct accessible names.
- Keyboard users can activate retry and local reset.
- Text fits on mobile and desktop.
- Design detector passes for touched UI/CSS files.

## Migration And Rollback

- No product data schema migration is expected.
- Rollback by reverting the branch.
- Local reset action only removes browser-local OpenRoad keys, matching existing `clearOpenRoadState` behavior.

## Manual QA Checklist

- Run focused boundary tests.
- Run `pnpm check`.
- Run design detector for touched UI/CSS.
- Run release verify.
- Run built-server smoke.
- Browser QA fallback screen if a test-only crash trigger is added; otherwise automated fallback tests are sufficient.

## Evidence

- Branch: `feat/error-boundary-recovery`
- Commit SHAs: `1a26929` test plan, `d968bef` implementation.
- Date: 2026-07-04.
- Acceptance criteria status: passed on branch before merge.
- Commands run:
  - `pnpm vitest run src/app/OpenRoadErrorBoundary.test.tsx src/App.test.tsx` passed 2 files and 50 tests.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\app\OpenRoadErrorBoundary.tsx src\main.tsx src\styles.css` returned no findings.
  - `pnpm check; pnpm release:verify` passed 20 test files and 226 tests; production client/server builds passed; release dry-run manifest generated from real build artifacts.
  - Built-server smoke with integration environment variables unset and admin-token mode passed `health`, `contract`, `portal`, `private-denied`, and `private-token`.
- Browser/viewports tested: No production crash trigger was added, so fallback behavior is covered by automated component tests. Healthy app rendering is covered by existing App workflow tests and production smoke.
- Accessibility checks: Recovery fallback uses `aria-label="OpenRoad recovery"`, direct button names `Try again` and `Reset local data`, and a status message after local reset. Design detector returned no findings for touched UI/CSS files.
- Reviewer notes: The boundary wraps the root React tree in `src/main.tsx`, does not send errors externally, does not expose thrown error messages by default, and clears only the two OpenRoad browser-local persistence keys through the existing `clearOpenRoadState` function.
- Known unresolved risks: External observability, structured error telemetry, hosted support workflow, and automated browser E2E CI remain future slices.
- Rollback notes: No data migration expected; rollback by reverting the branch.
