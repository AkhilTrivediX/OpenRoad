# Feature Test Plan: Standalone Requests

Branch: `feat/standalone-requests`

## Objective

Prove OpenRoad can capture and manage customer feedback as first-class standalone requests without GitHub, Jira, Linear, or any other delivery integration.

## User Story

As a founder, maintainer, PM, or support lead, I can create a request, add context, triage its status, vote, comment, search, filter, edit, and archive it inside OpenRoad before I connect any external tracker.

## In Scope

- Create requests with title, description, requester metadata, source, and tags.
- Edit selected request fields from the inspector.
- Archive requests and keep archived requests discoverable through a filter.
- Add and remove the current user's vote.
- Add comments to a request.
- Change request status.
- Search requests from the command bar.
- Filter by status and archive visibility.
- Empty and no-results states for request workflows.
- Preserve standalone-first messaging and optional integrations.
- Preserve the fixed app-shell behavior from `feat/design-reset`.

## Out Of Scope

- Backend persistence.
- Authentication and real user permissions.
- Multi-user vote deduplication beyond the current-user UI state.
- Comment edit/delete.
- Duplicate merge and assignment; those belong to `feat/request-triage`.
- Roadmap movement, work items, changelog publishing, public portal, and provider sync.

## Acceptance Criteria

- A blank workspace can capture a request with at least a title and optional detail fields.
- Created requests become selected and editable.
- A user can update title, description, requester, source, status, and tags.
- A user can add and remove their vote.
- A user can add a comment and see it in the selected request inspector.
- A user can archive a request and it leaves the default active queue.
- Archived requests can be viewed by changing the archive filter.
- Search narrows the request list by title, requester, source, description, tag, or comment text.
- No-results state preserves the user's filters and offers a clear reset path.
- Request management works with no integrations connected.
- The app remains a fixed viewport shell with the bottom status rail visible.

## Automated Tests

- Create a request with title, description, requester, source, and tags in a blank workspace.
- Edit a selected request title and requester metadata.
- Change selected request status.
- Add and remove the current user's vote.
- Add a comment to a selected request.
- Search requests by title and show a no-results state.
- Reset request filters from the no-results state.
- Filter by status.
- Archive a request and confirm it leaves the active queue.
- View archived requests.
- Keep the selected request open when edits stop matching active filters.
- Clear unsent comments when archive changes the selected request.
- Normalize blank edited request titles on blur.

## Manual Tests

- Desktop: create, edit, vote, comment, archive, and view archived request.
- Mobile: create a request and confirm controls remain usable inside the fixed app shell.
- Confirm the command search feels like a real app control, not decorative chrome.
- Confirm request management adds power without turning the first screen into a dense cockpit.
- Confirm no integration prompt blocks request work.
- Confirm no full-page scroll returns; only `.operations-deck` should scroll.

## Accessibility Checks

- Request composer labels are visible or accessible.
- Inspector edit controls have accessible names.
- Vote, archive, and reset controls are keyboard reachable.
- Status changes do not rely on color alone.
- Empty and no-results states have meaningful text and one clear primary recovery action.
- Focus remains visible on command bar, filters, request rows, inspector controls, and footer-adjacent controls.

## Regression Checks

- Workspace creation and selection still work.
- Default nav remains Inbox, Roadmap, Changelog, Portal, Settings.
- Primary nav hash targets remain reachable.
- Optional integration chips remain non-blocking.
- Roadmap and changelog previews still render.
- Bottom status rail remains visible on desktop and mobile.
- `documentScroll` and `bodyScroll` remain `0` in browser QA.

## Known Risks

- Adding CRUD controls can overload the first screen.
- Inline edit controls can make the inspector feel too form-heavy.
- Archive behavior can hide the selected request if selection state is not updated.
- Search and filters can conflict with the standalone empty state.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm check`: 19 tests passed and production build passed.
- Design detector: `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` returned no findings.
- Browser QA: desktop `1440x900` and mobile `390x900` both kept `documentScroll` and `bodyScroll` at `0`; `.operations-deck` was the only scroll container; bottom status rail remained visible.
- Browser QA: desktop and mobile both had `0` horizontal overflow.
- Review fixes: selected request no longer disappears while active filters stop matching edited fields; unsent comment drafts clear when archive changes selection; blank edited titles normalize on blur; search label now matches request-only behavior.
- Screenshots: `design/qa/standalone-requests-desktop.png` and `design/qa/standalone-requests-mobile.png`.
