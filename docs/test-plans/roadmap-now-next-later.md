# Feature Test Plan: Roadmap Now/Next/Later

Branch: `feat/roadmap-now-next-later`

## Objective

Make roadmap planning a durable OpenRoad workflow instead of a static preview. Users should be able to place validated product intent into Now, Next, and Later, link that intent back to requests and work items, and mark whether an item is safe to show publicly.

## User Story

As a product-minded maintainer or SaaS founder, I can turn user requests and internal delivery work into a clear roadmap without needing GitHub, Jira, Linear, or a timeline-heavy planning tool.

## In Scope

- Roadmap item domain model.
- Roadmap item create, edit, delete/archive, and lane movement.
- Now, Next, Later lane assignment.
- Public/private visibility state.
- Request links.
- Work item links.
- Confidence indicator.
- Stale/needs-review indicator.
- Persistence and migration updates for roadmap item state.
- Empty state and one primary create action for blank workspaces.
- Existing roadmap preview replaced by an editable roadmap panel.
- Regression coverage for workspace, request, triage, work, and persistence flows.

## Out Of Scope

- Calendar/timeline roadmap.
- Drag-and-drop implementation if it would reduce reliability.
- Public portal rendering of roadmap items.
- Changelog generation from roadmap items.
- Provider sync to GitHub, Jira, or Linear.
- Multi-user permissions.
- Backend API or database migration.
- AI roadmap suggestions.

## Acceptance Criteria

- User can create a roadmap item in a workspace.
- User can edit roadmap title, summary, lane, visibility, confidence, and stale state.
- User can link one or more requests to a roadmap item.
- User can link one or more work items to a roadmap item.
- User can move an item between Now, Next, and Later.
- Public/private visibility is visible as text, not color alone.
- Confidence and stale state are visible without requiring a timeline.
- Empty roadmap state has one primary create action.
- Roadmap state survives reload.
- Roadmap state exports and imports with workspace data.
- Current schema migration preserves existing string-based roadmap seed data.
- Invalid roadmap edits are rejected or normalized without data loss.
- Existing request, triage, work item, persistence, and settings workflows still pass.
- No provider integration or AI dependency is introduced.

## Domain Tests

- Initial workspace migration converts lane string entries into roadmap item objects.
- Reducer creates roadmap item.
- Reducer edits roadmap title/summary/lane/visibility/confidence/stale state.
- Reducer links a request to a roadmap item.
- Reducer unlinks a request from a roadmap item.
- Reducer links a work item to a roadmap item.
- Reducer unlinks a work item from a roadmap item.
- Reducer moves roadmap item between Now, Next, and Later.
- Reducer archives or removes roadmap item without deleting linked requests/work.
- Import accepts valid roadmap item data.
- Import rejects malformed roadmap item data.
- Export includes roadmap item state.
- Migration from schema version 1 preserves existing roadmap lane strings.
- Unknown future schema still fails safely.

## Component Tests

- Roadmap panel renders editable lanes instead of static strings.
- Blank workspace roadmap shows one primary create action.
- User creates a roadmap item from empty state.
- User creates a roadmap item from a selected request.
- User changes lane from Now to Next to Later.
- User toggles public/private visibility.
- User changes confidence.
- User marks item stale/needs review.
- User links and unlinks a request.
- User links and unlinks a work item.
- User reloads after roadmap edits and sees the same roadmap state.
- Export/reset/import restores roadmap items.
- Settings data tools remain outside the request inspector.

## Manual Tests

- Create roadmap item in default workspace.
- Create roadmap item in a blank workspace.
- Move an item across all lanes.
- Link an existing request and confirm request remains intact.
- Link an existing work item and confirm work item remains intact.
- Refresh after edits and confirm roadmap state remains.
- Export workspace, reset demo data, import exported workspace, confirm roadmap state returns.
- Confirm no GitHub, Jira, Linear, backend, or AI setup is needed.
- Desktop browser QA at `1440x900`.
- Mobile browser QA at `390x900`.
- Confirm app shell still avoids document/body scroll.

## Accessibility Checks

- Roadmap lanes have accessible names.
- Create/edit forms have labels for all fields.
- Public/private, confidence, and stale state are text-visible.
- Lane movement can be completed with keyboard-accessible controls.
- Error/status feedback is announced or reachable without relying on color.
- Empty state primary action has a clear accessible name.

## Security/Privacy Checks

- Private roadmap items are explicitly labeled private.
- Public visibility is an intentional field, not inferred from lane.
- Export/import does not add provider secrets.
- User-authored roadmap text renders as text, not HTML.
- No roadmap data is sent to external services.

## Data/Persistence Checks

- Schema version is updated when roadmap shape changes.
- Migration from schema version 1 is covered by tests.
- Existing persisted requests/work items survive roadmap migration.
- Corrupt persisted data still recovers to demo state.
- Invalid import cannot partially mutate existing workspace data.
- Reset demo data clears roadmap edits and selected workspace preference.

## Performance Checks

- Roadmap rendering remains responsive with default seed data.
- No new heavy dependency is introduced for roadmap editing.
- Lane controls do not trigger document/body scroll or horizontal overflow.
- Future large-workspace risk is documented if list sizes grow.

## Regression Checks

- Feature 1 workspace shell still works.
- Feature 2 standalone requests still work.
- Feature 3 request triage still works.
- Feature 4 internal work items still work.
- Feature 4.5 persistence/import/export/recovery still works.
- Work nav still appears only after work exists.
- Optional integrations remain non-blocking.
- `pnpm check` passes.
- `impeccable detect` returns no touched-UI findings.

## Rollback Plan

- If roadmap migration fails before merge, keep `main` on schema version 1 and do not merge.
- If a merged issue appears, revert the feature commit and retain version 1 import/export behavior.
- Do not ship public portal work until roadmap visibility state is correct.

## Known Risks

- Roadmap items change the persisted workspace shape and require careful migration.
- Public/private visibility can become a privacy issue later if portal rendering ignores it.
- Adding roadmap controls can overload the dashboard if not progressively disclosed.
- Linking requests/work to roadmap items can drift if linked objects are later archived.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm test:run`: 46 automated tests passed.
- `pnpm check`: tests plus production build passed.
- `impeccable detect`: no UI/design detector findings for `src/App.tsx` and `src/styles.css`.
- `git diff --check`: passed; only repository line-ending normalization warnings were reported.
- Browser QA passed in the Codex in-app browser at `1440x900` and `390x900`: no body-level scroll, no horizontal overflow, Roadmap navigation lands below the sticky command band, the editable lanes render, public/private and confidence text are visible, and the request inspector still exposes only four triage actions.
