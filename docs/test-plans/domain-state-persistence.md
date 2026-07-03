# Feature Test Plan: Domain State And Persistence

Branch: `feat/domain-state-persistence`

## Objective

Make OpenRoad Stage 1 local-first data durable, migration-safe, recoverable, and ready for later Roadmap, Changelog, Portal, and integration work.

## User Story

As a user running OpenRoad locally, I can create and update workspaces, requests, comments, votes, triage state, and work items, then refresh the app without losing my work. If local data becomes invalid, I can recover without the app crashing.

## In Scope

- Provider-neutral domain types extracted from the UI component.
- Domain actions/reducer for workspace, request, triage, and work item workflows.
- Stable ID helper.
- Versioned local persistence.
- Schema migration registry.
- Demo data reset path.
- Workspace export.
- Workspace import.
- Corrupt local-state recovery.
- Existing workspace/request/triage/work UI behavior preserved.
- Regression coverage for Features 1-4.

## Out Of Scope

- Backend API.
- Authentication.
- Multi-user tenancy.
- Database migrations.
- Hosted deployment.
- Provider integrations.
- Roadmap item editing.
- Changelog drafting.
- Public portal.

## Acceptance Criteria

- Workspaces survive reload.
- Created requests survive reload.
- Request edits survive reload.
- Votes and comments survive reload.
- Archive/restore state survives reload.
- Owner, status, tags, requester, source, and duplicate source history survive reload.
- Work items survive reload.
- Work item links, owner, status, target date, comments, and unlink state survive reload.
- Current schema version is stored with persisted data.
- Known previous schema versions migrate to current state.
- Unknown future schema fails safely.
- Corrupt persisted data does not crash the app.
- User can reset to demo data after corrupt or unwanted local state.
- User can export current workspace data.
- User can import valid workspace data into the app.
- Invalid import is rejected without corrupting existing state.
- Existing standalone flows still pass.
- No GitHub, Jira, Linear, backend, or AI dependency is introduced.

## Automated Tests

- Domain reducer creates workspace.
- Domain reducer creates request.
- Domain reducer edits request fields.
- Domain reducer archives and restores request.
- Domain reducer toggles vote.
- Domain reducer adds request comment.
- Domain reducer merges duplicate and preserves source history.
- Domain reducer creates linked work item.
- Domain reducer edits work item owner/status/target date.
- Domain reducer adds work item comment.
- Domain reducer unlinks request from work item.
- Duplicate merge rewrites work links from duplicate to survivor.
- Persistence saves and loads current schema.
- Selected workspace preference saves, loads, and clears with local state.
- Persistence migrates a previous schema fixture.
- Persistence rejects unknown future schema.
- Persistence recovers from invalid JSON.
- Export serializes the active workspace.
- Import accepts valid workspace data.
- Import rejects invalid workspace data.
- Existing component tests for workspace, request, triage, and work item flows still pass.

## Manual Tests

- Create workspace, request, comment, vote, and work item; refresh; confirm all remain.
- Change owner/status/date; refresh; confirm all remain.
- Export workspace; reset demo data; import exported workspace; confirm data returns.
- Manually corrupt local storage; reload; confirm recovery UI appears.
- Reset to demo data from recovery path.
- Desktop browser QA at `1440x900`.
- Mobile browser QA at `390x900`.
- Confirm app shell still avoids document/body scroll.

## Accessibility Checks

- Import/export/reset controls have accessible names.
- Recovery state has clear heading, explanation, and keyboard-accessible recovery action.
- Persistence/recovery messages do not rely on color alone.
- Existing keyboard paths for workspace, request, triage, and work item workflows still work.

## Security/Privacy Checks

- Export does not include secrets.
- Import validates shape before replacing local data.
- User-authored text continues to render as text, not HTML.
- No external service receives local workspace data.

## Data/Persistence Checks

- Current schema version documented in code.
- Migration registry has test coverage.
- Stored data can be reset.
- Corrupt data can be recovered.
- Import cannot partially mutate existing state on failure.

## Performance Checks

- Existing app remains responsive with default seed data.
- Persistence reads and writes are scoped to workspace state.
- No new large dependency is added for persistence.

## Regression Checks

- Feature 1 workspace shell still works.
- Feature 2 standalone requests still work.
- Feature 3 request triage still works.
- Feature 4 internal work items still work.
- Work nav still appears only after work exists.
- Optional integrations remain non-blocking.
- `pnpm check` passes.

## Known Risks

- Extracting domain logic from `App.tsx` can introduce behavior drift.
- Local persistence can overwrite state unexpectedly if migration fails.
- Import/export can become a future security issue if it later includes private integration metadata.
- Local storage size is limited; IndexedDB may be needed later for large workspaces.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm test:run`: 41 automated tests passed.
- `pnpm check`: tests plus production build passed.
- `impeccable detect`: no UI/design detector findings for `src/App.tsx` and `src/styles.css`.
- `git diff --check`: passed; only repository line-ending normalization warnings were reported.
- Browser QA passed in the Codex in-app browser at `1440x900` and `390x900`: no body-level scroll, no horizontal overflow, bottom status stays in frame, Settings remains inside the app scroll area, and the request inspector still exposes only the four triage actions.
- Settings navigation click at `1440x900` scrolls the operations deck to the Settings panel.
