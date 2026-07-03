# Feature Test Plan: Internal Work Items

Branch: `feat/internal-work-items`

## Objective

Prove OpenRoad can track delivery natively, without GitHub, Jira, Linear, or any other external tracker.

## User Story

As a founder, maintainer, PM, or support lead, I can turn validated requests into small internal work items, assign ownership, set status and target timing, discuss delivery context, and keep the link back to request evidence without leaving OpenRoad.

## In Scope

- Native OpenRoad work item model.
- Create a standalone work item.
- Optionally link the selected request when creating a work item.
- Show linked work from the selected request.
- Show linked request evidence from the work item.
- Edit work item owner, status, and target date.
- Add comments to a work item.
- Unlink a request from a work item without deleting either object.
- Reveal Work navigation only after the workspace contains work items.
- Keep the first screen calm for blank and demo workspaces with no work items.
- Regression coverage for workspace shell, standalone requests, request triage, and fixed PWA-style shell behavior.

## Out Of Scope

- GitHub, Jira, or Linear synchronization.
- External issue import.
- Kanban boards.
- Bulk work item editing.
- Roadmap placement from work items.
- Changelog draft generation from work items.
- Backend persistence, permissions, audit logs, and notifications.
- AI work item generation.

## Acceptance Criteria

- A user can create a work item without connecting an external integration.
- A user can create a work item linked to the currently selected request.
- A user can create a standalone work item when there is no request link.
- Linked work appears in the selected request context.
- Linked request evidence appears in the work item context.
- Owner, status, and target date are editable after creation.
- A user can add comments to a work item.
- A user can unlink a request from a work item.
- Unlinking preserves both the request and the work item.
- Work navigation appears after internal work exists.
- Work navigation stays hidden for blank/new workspaces with no work items.
- The inspector does not grow into a dense Jira-like control wall.
- The app shell remains fixed to the viewport; `.operations-deck` remains the only primary scroll surface.

## Automated Tests

- Create a linked work item from the selected request.
- Verify the linked work item appears in the request context.
- Verify the linked request appears in the work item context.
- Verify Work navigation appears after the first work item is created.
- Create a standalone work item with no linked request.
- Change work item status.
- Change work item owner.
- Add a target date.
- Add a work item comment.
- Unlink a request from a work item.
- Confirm unlinking preserves the request and the work item.
- Confirm Work navigation is hidden in a fresh blank workspace with no work items.
- Confirm request creation still works without work items.
- Confirm request triage owner assignment still works.
- Confirm duplicate merge still preserves source history.

## Manual Tests

- Desktop: create a linked work item, edit metadata, comment, unlink, and confirm the request remains intact.
- Desktop: create a standalone work item in a blank workspace.
- Mobile: create and edit a work item inside the internal scroll surface.
- Mobile: verify the bottom status rail remains visible.
- Confirm Work navigation appears only when useful.
- Confirm the default experience still starts with Inbox, Roadmap, Changelog, Portal, and Settings.
- Confirm no integration prompt blocks internal delivery tracking.
- Confirm the work panel feels like a focused delivery desk, not a full project-management replacement.

## Accessibility Checks

- Work item create form has an accessible form name.
- Work item title, description, owner, status, target date, link checkbox, and comment controls have accessible names.
- Work item rows are keyboard reachable and expose enough text to identify the item.
- Work item status does not rely on color alone.
- Link and unlink controls have explicit names.
- Empty work item states are meaningful.
- Focus ring remains visible in the work panel.

## Regression Checks

- Workspace creation and selection still work.
- Primary nav hash targets remain reachable.
- Standalone-first and optional integration messaging remains visible.
- Request creation, selection, edit, vote, comment, status, search, filters, archive, and restore still work.
- Saved triage views still work.
- Duplicate merge still preserves source history.
- No primary triage decision point exposes more than four major visible actions.
- Roadmap and changelog previews still render.
- Bottom status rail remains visible on desktop and mobile.
- No full-page document/body scroll returns.

## Known Risks

- Work item controls can make the inspector too busy if placed beside triage decisions.
- Work navigation can appear too early and make blank workspaces feel heavier.
- Request/work links can become stale if archiving, filtering, or unlinking changes selection.
- Target dates can imply timeline commitments before roadmap confidence exists.
- Native work items may overlap with future GitHub/Jira/Linear adapters unless the domain model remains provider-neutral.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm check`: 28 tests passed and production build passed.
- Design detector: `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` returned no findings.
- Browser QA: desktop `1440x900` and mobile `390x900` both kept `documentScroll`, `bodyScroll`, and horizontal overflow at `0`; `.operations-deck` remained the only primary scroll surface.
- Browser QA: bottom status rail stayed visible on desktop and mobile.
- Browser QA: Work nav appeared after internal work creation; linked work appeared in the selected request context; linked request evidence appeared in the selected work context.
- Browser QA: selected request inspector remained at four buttons after work items were added.
