# Feature Test Plan: Request Triage

Branch: `feat/request-triage`

## Objective

Prove a user can process an Inbox request quickly without leaving the standalone OpenRoad workflow or increasing first-screen complexity.

## User Story

As a founder, maintainer, PM, or support lead, I can select a request, assign an owner, apply a saved view, merge duplicates while preserving source history, and archive completed noise without losing request evidence.

## In Scope

- Inbox triage controls that stay inside the existing two-pane app shell.
- Owner assignment for selected requests.
- Triage saved views for common request slices.
- Duplicate merge into the selected request.
- Duplicate source history preserved on the surviving request.
- Duplicate request removed from the active queue after merge.
- Triage summary that explains the current queue without adding a new navigation item.
- Regression coverage for request create, edit, vote, comment, status, search, filters, and archive.
- Preserve standalone-first messaging and optional integrations.
- Preserve fixed app-shell behavior from `feat/design-reset`.

## Out Of Scope

- Bulk triage.
- AI duplicate suggestions.
- Revenue scoring, account weight, or custom prioritization formulas.
- Native work items and request-to-work links.
- Roadmap movement.
- Changelog publishing.
- Provider sync or external issue linking.
- Persistence beyond local component state.

## Acceptance Criteria

- A user can assign an owner to the selected request.
- Owner assignment is visible in the request row and selected request inspector.
- Saved views can filter requests by useful triage slices.
- Saved views do not hide standalone use behind integration assumptions.
- A user can merge a duplicate request into the selected request.
- Merging preserves the duplicate title, requester, source, votes, tags, comments, and source-history record on the surviving request.
- Merging removes the duplicate from the active queue and keeps the survivor selected.
- A user cannot merge a request into itself.
- No primary triage decision point exposes more than four major visible actions.
- Archiving from the triage flow still clears unsafe draft state and selects the next active request.
- The first screen remains calm: Inbox, selected request, roadmap preview, and changelog preview stay discoverable without adding Work/Prioritize navigation yet.

## Automated Tests

- Assign owner to selected request and verify row plus inspector update.
- Filter saved view to unassigned requests.
- Filter saved view to high-signal requests.
- Reset saved view back to all active requests.
- Merge duplicate request into the selected request.
- Confirm duplicate request is removed from the active queue after merge.
- Confirm merged source history appears on the survivor.
- Confirm merged votes, tags, and comments are preserved on the survivor.
- Confirm merged description, owner, status, and current-user vote state are preserved.
- Confirm merge select cannot choose the selected request.
- Confirm selected request remains selected after merge.
- Confirm archived selected requests cannot absorb active requests.
- Archive selected request after triage changes.

## Manual Tests

- Desktop: select a request, assign owner, use saved view, merge duplicate, archive from triage.
- Mobile: confirm triage controls remain usable inside the fixed app shell.
- Confirm triage controls do not make the first screen feel denser than Jira/Linear for a basic user.
- Confirm no integration prompt blocks request triage.
- Confirm no full-page scroll returns; only `.operations-deck` should scroll.
- Confirm footer/status rail remains visible after triage controls are added.

## Accessibility Checks

- Saved view, owner, and duplicate merge controls have accessible names.
- Merge duplicate control excludes the selected request from choices.
- Status, owner, and duplicate history do not rely on color alone.
- Focus remains visible on triage controls, request rows, inspector actions, and footer-adjacent controls.
- Keyboard users can assign owner and merge duplicate without pointer-only interactions.
- Empty/no-results states remain meaningful after saved view filtering.

## Regression Checks

- Workspace creation and selection still work.
- Default nav remains Inbox, Roadmap, Changelog, Portal, Settings.
- Primary nav hash targets remain reachable.
- Optional integration chips remain non-blocking.
- Standalone request creation still works.
- Request edit, vote, comment, status, search, filters, archive, and restore still work.
- Request selection remains stable when edited fields stop matching active filters.
- Blank edited titles still normalize on blur.
- Unsent comment drafts still clear when archive changes selection.
- Roadmap and changelog previews still render.
- Bottom status rail remains visible on desktop and mobile.
- `documentScroll` and `bodyScroll` remain `0` in browser QA.

## Known Risks

- Adding assignment, saved views, and merge controls can overload the inspector.
- Duplicate merge can accidentally destroy useful source evidence if not preserved explicitly.
- Saved views can conflict with active search/status/archive filters.
- Merging can create selection bugs if the duplicate or selected request is filtered out.
- Mobile triage controls can push the inspector too far down the internal scroll surface.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm check`: 24 tests passed and production build passed.
- Design detector: `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` returned no findings.
- Browser QA: desktop `1440x900` and mobile `390x900` both kept `documentScroll` and `bodyScroll` at `0`; `.operations-deck` was the only scroll container; bottom status rail remained visible.
- Browser QA: desktop and mobile both had `0` horizontal overflow and exactly four inspector buttons.
- Browser QA: saved view, owner, duplicate merge, and merge button controls were present on desktop and mobile.
- Review fixes: duplicate merge now preserves description, owner, status, age, vote state, tags, comments, and nested merge history; archived selected requests cannot merge active requests; triage summary now reflects the visible queue; empty source history is hidden by default.
- Screenshots: `design/qa/request-triage-desktop.png` and `design/qa/request-triage-mobile.png`.
