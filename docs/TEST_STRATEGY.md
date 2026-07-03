# OpenRoad Test Strategy

Testing starts before implementation. Every feature branch must add a checklist before writing product code.

## Global Test Categories

- Unit tests for domain logic.
- Component tests for important UI states.
- Integration tests for data flows.
- End-to-end smoke tests for primary workflows.
- Accessibility checks for keyboard, focus, labels, and contrast.
- Regression checks for completed features.
- Standalone-mode checks to ensure integrations remain optional.
- Data export/import checks when persistence exists.

## Feature Test Plan Template

Each feature must define:

- Objective.
- User story.
- In scope.
- Out of scope.
- Acceptance criteria.
- Automated tests.
- Manual tests.
- Accessibility checks.
- Regression checks from previous features.
- Known risks.
- Sign-off result.

## Feature 1 Test List: Workspace Shell

Objective: prove a user can enter OpenRoad and understand the product shell.

Tests:

- Create workspace.
- Rename workspace.
- Select workspace.
- See default nav: Inbox, Roadmap, Changelog, Portal, Settings.
- Confirm no integration prompt blocks entry.
- Confirm current page is visually indicated.
- Confirm empty states are readable.
- Keyboard-tab through nav and primary actions.
- Verify focus ring is visible.
- Verify app handles no workspaces gracefully.

Regression base:

- None; this creates the base.

## Feature 2 Test List: Standalone Requests

Objective: prove feedback works without integrations.

Tests:

- Create request with title and description.
- Edit request.
- Archive request.
- Restore or view archived request if supported.
- Add vote.
- Remove vote if supported.
- Add comment.
- Edit/delete own comment if supported.
- Change request status.
- Add/remove tags.
- Add requester metadata.
- Search requests.
- Filter by status and tag.
- Empty Inbox has one primary action.
- No-results state preserves filters and offers clear filters.
- Error state explains recovery.

Regression checks from Feature 1:

- Workspace creation still works.
- Navigation still works.
- No integration is required.
- Keyboard navigation still reaches primary actions.

## Feature 3 Test List: Request Triage

Objective: prove a user can process feedback quickly without overload.

Tests:

- Open Inbox queue.
- Select request and open inspector.
- Assign owner.
- Merge duplicate requests.
- Preserve duplicate source history.
- Archive request from triage flow.
- Use saved views.
- Confirm no decision point has more than four major visible actions.
- Confirm inspector is hidden until selection in Calm mode.

Regression checks:

- Feature 1 shell still works.
- Feature 2 create/vote/comment/status/search still works.
- Standalone mode still works.

## Feature 4 Test List: Internal Work Items

Objective: prove OpenRoad can track delivery natively.

Tests:

- Create work item.
- Link request to work item.
- Change work item status.
- Assign owner.
- Add target date.
- Add comment.
- Unlink request from work item.
- Verify Work nav appears only when useful.

Regression checks:

- Requests still work without work items.
- Inbox triage still works.
- Navigation remains simple for new/demo workspace.

## Feature 5 Test List: Roadmap

Objective: prove roadmap communication works clearly.

Tests:

- Create roadmap item.
- Move request to Now, Next, Later.
- Link roadmap item to request and work item.
- Mark item public/private.
- Verify public/private state is visible.
- Set confidence/staleness metadata.
- Confirm timeline is optional.
- Confirm Roadmap empty state has one primary action.

Regression checks:

- Request triage still works.
- Work items still work.
- No external provider required.

## Feature 6 Test List: Changelog

Objective: prove shipped work can become public communication.

Tests:

- Create changelog draft.
- Pull shipped roadmap/work item into draft.
- Edit public wording.
- Preview changelog.
- Link requesters.
- Keep private notes hidden.
- Save draft.

Regression checks:

- Roadmap public/private visibility still works.
- Work item status still works.
- Request links remain intact.

## Feature 7 Test List: Public Portal

Objective: prove external users can interact without internal complexity.

Tests:

- View public feedback board.
- Search public requests.
- Vote on public request.
- Comment on public request if enabled.
- View public roadmap.
- View public changelog.
- Confirm private items are hidden.
- Confirm portal works with standalone objects.
- Confirm moderation controls work.

Regression checks:

- Internal Inbox, Roadmap, Changelog still work.
- Public/private flags are respected everywhere.

## Integration Feature Test Lists

For GitHub, Linear, and Jira, every integration must test:

- Connect provider.
- Import external work item.
- Link external work item to OpenRoad work item.
- Sync status.
- Handle revoked permissions.
- Handle rate-limit or provider error.
- Show sync status without overwhelming default UI.
- Disconnect provider without deleting OpenRoad core data.
- Export OpenRoad data with external links included.

Regression checks:

- Standalone request flow still works.
- Standalone work item flow still works.
- Roadmap and changelog still work without provider connection.

## AI Feature Test List

Objective: prove AI assists without taking control.

Tests:

- Suggest duplicate.
- Explain duplicate rationale.
- Reject duplicate suggestion.
- Accept duplicate suggestion.
- Summarize request.
- Draft changelog copy.
- Show source references.
- Require human approval before mutation.

Regression checks:

- Manual triage still works.
- AI can be disabled.
- Source-of-truth data is not silently modified.
