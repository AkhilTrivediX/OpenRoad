# Feature Test Plan: Roadmap UX Simplification

Branch: `feat/roadmap-ux-simplification`

## Objective

Reduce cognitive load in the dashboard by turning the editable roadmap from many repeated control-heavy cards into a calmer list/detail workflow.

## User Story

As a user reviewing the dashboard, I can quickly understand what is in Now, Next, and Later without every roadmap item looking like a settings form. When I need to edit a roadmap item, I can select it and use one clear detail area.

## In Scope

- Simplify roadmap lane cards into scan-first roadmap rows.
- Move repeated lane, visibility, confidence, stale, request-link, and work-link controls into one selected roadmap detail surface.
- Keep roadmap item create, edit, delete, move, link, unlink, persistence, export/import, and migration behavior intact.
- Reduce nested bordered surfaces in the roadmap area.
- Preserve app shell fixed-scroll behavior.
- Preserve request inspector action count and existing standalone workflows.

## Out Of Scope

- Drag-and-drop roadmap movement.
- Full app module decomposition.
- Changelog UI redesign.
- Public portal rendering.
- Backend/API work.

## Acceptance Criteria

- Roadmap lanes show compact item rows/cards with title, summary, visibility, confidence, stale state, and link counts.
- Lane controls are not repeated visibly on every roadmap item.
- Selecting a roadmap item opens one detail editor for lane, visibility, confidence, stale state, links, and removal.
- Creating roadmap items still works in blank and seeded workspaces.
- Moving an item between Now, Next, and Later still works from the detail editor.
- Linking/unlinking requests and work items still works from the detail editor.
- Current selected roadmap item remains understandable after lane moves.
- Empty roadmap state still has one primary create action.
- App remains usable at desktop and mobile breakpoints.
- No body-level scroll or horizontal overflow appears.
- Existing request, triage, work, persistence, import/export, and settings tests still pass.

## Automated Tests

- Existing roadmap create/edit test passes with detail-editor controls.
- Existing roadmap link/unlink test passes with detail-editor controls.
- Existing roadmap persistence test passes with detail-editor controls.
- Add assertion that the roadmap list surface does not expose repeated lane controls for every item.
- Add assertion that selected roadmap detail exposes exactly one lane selector for the selected item.
- Existing inspector action count remains four.
- `pnpm check` passes.

## Manual / Browser QA

- Desktop `1440x900`: Roadmap lands below command band, lanes are scannable, one selected detail editor is visible, no horizontal overflow.
- Mobile `390x900`: Roadmap lands below command band, list/detail stacks without hidden header, no body-level scroll.
- Visual check that roadmap items no longer look like nested settings containers.
- Verify selected detail editor remains reachable after selecting a different item.

## Accessibility Checks

- Roadmap item rows/buttons have clear accessible names.
- Selected roadmap detail region has a clear accessible name.
- Form controls retain labels.
- Status uses text, not color alone.
- Keyboard users can select an item and edit lane/visibility/confidence.

## Security/Privacy Checks

- Private/Public visibility remains explicit text.
- Export/import behavior is unchanged.
- User-authored roadmap text renders as text, not HTML.
- No external services receive roadmap data.

## Regression Checks

- Feature 1 workspace shell still works.
- Feature 2 standalone requests still work.
- Feature 3 request triage still works.
- Feature 4 internal work items still work.
- Feature 4.5 persistence/import/export/recovery still works.
- Feature 5 roadmap domain and workflow still work.
- Optional integrations remain non-blocking.
- `impeccable detect` returns no touched-UI findings.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm check` passed: 47 tests, production TypeScript build, Vite production build.
- `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` returned `[]`.
- Desktop browser QA at `1440x900` passed: one selected roadmap detail editor, 6 scannable roadmap rows, no body-level scroll, no horizontal overflow.
- Compact browser QA at `390x844` passed: roadmap anchor lands below sticky controls, selected detail appears before lane list, no body-level scroll, no horizontal overflow.
