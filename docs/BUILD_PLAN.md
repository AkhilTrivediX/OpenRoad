# OpenRoad Modular Build Plan

This plan is standalone-first. Integrations are optional modules built after the native product loop works.

Each feature begins by creating a test checklist in `docs/TEST_STRATEGY.md` or a feature-specific checklist under `docs/test-plans/`.

## Feature 1: Workspace Shell

Branch: `feat/workspace-shell`

Build:

- App shell.
- Workspace creation and selection.
- Default navigation.
- Calm empty states.
- Basic design tokens.
- Demo workspace seed.

Acceptance:

- A user can enter OpenRoad and create/select a workspace.
- Default nav shows Inbox, Roadmap, Changelog, Portal, Settings.
- No integration is required.
- Current location is always visible.

## Feature 2: Standalone Requests

Branch: `feat/standalone-requests`

Build:

- Create, edit, archive requests.
- Vote and comment.
- Request statuses.
- Tags and requester metadata.
- Search and basic filters.

Acceptance:

- A user can capture and manage feedback without GitHub, Jira, or Linear.
- Requests are first-class OpenRoad objects.
- Empty, no-results, no-permission, and error states exist.

## Feature 3: Request Triage

Branch: `feat/request-triage`

Build:

- Inbox queue.
- Duplicate merge.
- Assignment.
- Saved views.
- Right inspector on selection.

Acceptance:

- A user can triage one request without leaving Inbox.
- No primary decision point shows more than four visible choices.
- Duplicate merge preserves source history.

## Feature 4: Internal Work Items

Branch: `feat/internal-work-items`

Build:

- Native OpenRoad work items.
- Link requests to work items.
- Owners, status, target date, comments.

Acceptance:

- Users can plan delivery inside OpenRoad without an external tracker.
- Linked work is useful even with zero integrations.

## Feature 5: Roadmap Now/Next/Later

Branch: `feat/roadmap-now-next-later`

Build:

- Now, Next, Later roadmap.
- Public/private visibility per item.
- Link requests and work items.
- Stale and confidence indicators.

Acceptance:

- A user can move a request into roadmap.
- Public/private state is visible.
- Timeline is optional, not default.

## Feature 6: Changelog Drafts

Branch: `feat/changelog-drafts`

Build:

- Draft changelog entries.
- Pull from shipped roadmap or work items.
- Preview public wording.
- Link requesters for later notification.

Acceptance:

- Shipped work can become a changelog draft without duplicate manual writing.
- Private/internal details are not exposed by default.

## Feature 7: Public Portal

Branch: `feat/public-portal`

Build:

- Public feedback board.
- Public roadmap.
- Public changelog.
- Search, vote, comment.
- Basic moderation.

Acceptance:

- External users can understand status without seeing internal complexity.
- Portal works for standalone OpenRoad objects.

## Feature 8: Integration Adapter Contract

Branch: `feat/integration-adapter-contract`

Build:

- Provider adapter interface.
- External objects and links.
- Sync state.
- Sync conflict model.
- Webhook event model.
- Hidden sync logs in Settings.

Acceptance:

- Provider objects attach to OpenRoad objects.
- Core workflows do not change when no provider exists.
- No provider-specific fields appear in core domain tables.

## Feature 9: GitHub Issue Sync

Branch: `feat/github-issue-sync`

Build:

- GitHub App installation flow.
- Import/link GitHub issues.
- Sync issue status.
- Link pull requests.
- Permission-aware display.

Acceptance:

- GitHub enriches OpenRoad but remains optional.
- Disconnecting GitHub does not delete or corrupt core OpenRoad objects.

## Feature 10: Linear Issue Sync

Branch: `feat/linear-issue-sync`

Build:

- Linear OAuth flow.
- Import/link Linear issues/projects.
- Sync owner and status.

Acceptance:

- Linear uses the same adapter contract.
- No Linear-specific logic leaks into core screens.

## Feature 11: Jira Issue Sync

Branch: `feat/jira-issue-sync`

Build:

- Jira OAuth flow.
- Import/link Jira issues.
- Explicit field mapping.
- Sync audit and conflict handling.

Acceptance:

- Jira complexity stays in mapping and Settings.
- Core UX remains the same as standalone mode.

## Feature 12: Requester Notifications

Branch: `feat/requester-notifications`

Build:

- Notification preferences.
- Status-change updates.
- Changelog publish updates.
- Anti-spam controls.

Acceptance:

- Requesters can be notified when relevant work ships.
- Notifications are useful and controllable.

## Feature 13: AI Assistance

Branch: `feat/ai-assisted-triage`

Build:

- Duplicate suggestions.
- Request summaries.
- Changelog draft suggestions.
- Explanation UI for suggestions.

Acceptance:

- AI never silently changes source-of-truth data.
- Every AI action is inspectable and requires human approval.

## Feature 14: Self-Host And SaaS Operations

Branch: `feat/self-host-and-saas-ops`

Build:

- Docker self-host path.
- Export/import.
- Backup documentation.
- Billing foundations.
- Admin controls.

Acceptance:

- Free self-host remains useful.
- Hosted and self-host paths share the same core product behavior.
