# Feature Test Plan: Workspace Shell

Branch: `feat/workspace-shell`

## Objective

Prove a user can open OpenRoad, understand the selected Signal Rail product shell, create/select a workspace, and use the app without any GitHub, Jira, or Linear integration.

## User Story

As a product lead, founder, maintainer, or support lead, I can enter OpenRoad, choose my workspace, see the core workflow, and understand where feedback, roadmap, changelog, portal, and settings live without connecting an external tool.

## In Scope

- Vite/React/TypeScript app scaffold.
- Signal Rail app shell.
- Default navigation: Inbox, Roadmap, Changelog, Portal, Settings.
- Workspace selector and demo workspace.
- Minimal manual request capture.
- First-use action rail: capture request, move to roadmap, draft changelog.
- Calm default Inbox preview.
- Roadmap and changelog preview panels.
- Optional integration chips that are clearly non-blocking.
- Empty-state and demo-state messaging.
- Responsive shell behavior.
- Automated tests for shell rendering and workspace behavior.

## Out Of Scope

- Real authentication.
- Backend persistence.
- Real request CRUD.
- GitHub/Jira/Linear OAuth or sync.
- Public portal publishing.
- AI assistance.
- Billing or self-host packaging.

## Acceptance Criteria

- App opens on the Inbox workspace shell.
- Current workspace is visible as `Acme OSS`.
- User can switch to a second sample workspace.
- Default nav shows only Inbox, Roadmap, Changelog, Portal, Settings.
- The UI says integrations are optional and does not block standalone use.
- Signal Rail identity is present: dark shell, sharp 1px dividers, compact command bar, restrained status color.
- Calm mode is the default density.
- No screen presents more than one dominant primary action.
- No primary navigation item is icon-only.
- Roadmap preview uses Now, Next, Later.
- Changelog preview is visible without requiring integrations.
- The app has a useful mobile/tablet fallback.

## Automated Tests

- Renders OpenRoad shell title and default workspace.
- Renders the five default navigation items.
- Does not render Work, Prioritize, Insights, Sync logs, or Audit in default navigation.
- Renders standalone-first message.
- Switches workspace from Acme OSS to Maintainer Lab.
- Creates a blank standalone workspace.
- Selects request rows and updates the inspector.
- Captures a manual request without requiring integrations.
- Renders optional integration chips as non-blocking UI.
- Renders empty states for requests, selected request, roadmap lanes, and changelog drafts.
- Renders Now, Next, Later roadmap preview.
- Renders changelog draft preview.

## Manual Tests

- Open app in desktop viewport.
- Confirm first screen purpose is understandable within five seconds.
- Confirm top command/search bar is visible but not required.
- Confirm one primary action is visually dominant.
- Confirm external providers are presented as optional.
- Confirm no sync logs, audit trails, or AI reasoning are visible by default.
- Confirm no provider logos are required to understand the UI.
- Resize to tablet width and confirm nav/content remain usable.
- Resize to mobile width and confirm navigation collapses cleanly.
- Create a blank workspace on mobile and confirm the page remains understandable.
- Capture desktop and mobile screenshots for visual review.

## Accessibility Checks

- Tab through workspace selector, search, nav, primary action, request rows, and preview links.
- Confirm visible focus states.
- Confirm buttons and controls have accessible names.
- Confirm status badges include text, not color alone.
- Confirm text contrast is readable on dark surfaces.
- Confirm layout is usable with reduced motion.

## Regression Checks

Planning commitments must remain true:

- OpenRoad works without GitHub, Jira, or Linear.
- Core default nav remains Inbox, Roadmap, Changelog, Portal, Settings.
- Integrations are optional accelerators.
- No provider-specific fields are required for core shell behavior.
- No four-pane default cockpit ships for new users.
- No large rounded cards, decorative gradients, glassmorphism, blobs, or marketing metric cards.

## Known Risks

- Signal Rail could become too dense for first-time users.
- Dark UI can fail contrast if muted colors are too low contrast.
- Workspace selector can look functional before persistence exists.
- Demo data can imply features are complete before they are implemented.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm check`: 8 tests passed; production build passed.
- Headless Edge visual QA: desktop selected-request state and mobile blank-workspace state had no horizontal overflow.
- Saved QA screenshots in `design/qa/`.
