# Feature Test Plan: Requester Notifications

Branch: `feat/requester-notifications`

## Objective

Add the first production-safe requester notification slice: requester preferences, a notification outbox, status-change notifications, changelog-publish notifications, and anti-spam controls without sending external email or leaking private data.

## User Story

As a maintainer, I can see whether requesters want updates, queue useful notifications when a request moves toward shipping or appears in a public changelog, and avoid duplicate/noisy messages until a real delivery adapter exists.

## Scope

- Workspace-level notification settings.
- Requester/request-level notification preferences.
- Notification outbox events stored in OpenRoad state.
- Status-change notification generation for meaningful request status changes.
- Public changelog publish notification generation for linked requests.
- Dedupe and quiet-window anti-spam controls.
- UI surface for notification preferences and queued events.
- Schema migration for existing workspaces.
- Docs for current outbox-only behavior and future delivery adapters.

## Not In Scope

- Sending email, Slack, Discord, web push, SMS, or provider messages.
- Requester identity verification.
- Unsubscribe links.
- Background delivery workers.
- Notification analytics.
- Hosted billing or marketing email.

## Acceptance Criteria

- Existing workspaces migrate to include notification settings and an empty outbox.
- Maintainers can enable/disable updates for the selected request's requester.
- Updating a request to `Planned` or `Shipping soon` queues one status-change notification when preferences allow it.
- Repeating the same status update inside the quiet window does not queue duplicates.
- Publishing a public, ready changelog item linked to requests queues changelog notifications when preferences allow it.
- Draft or private changelog items do not queue requester notifications.
- Notification payloads do not include internal comments, private notes, integration tokens, or hidden portal content.
- Public portal snapshots do not expose notification preferences or outbox entries.
- Standalone mode works with no integrations configured.
- Existing GitHub, Linear, Jira, public portal, backup/restore, and self-host smoke tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Notification settings defaults are created for new workspaces.
- Previous schema workspaces migrate notification settings and outbox safely.
- Preference lookup normalizes requester/request identity.
- Disabled global notifications queue no events.
- Disabled request preference queues no events.
- Status change from `New` to `Planned` queues a status notification.
- Status change to `Shipping soon` queues a shipping notification.
- Same request/status inside quiet window is deduped.
- Changelog publish from Draft/private to Ready/Public queues notifications for linked public-safe requests.
- Changelog drafts/private entries queue no notifications.
- Notification summaries redact private changelog notes and internal comments.
- App tests cover toggling request notification preference and seeing queued events.
- Existing domain/app/server/integration tests pass.

## Regression Checklist

- Public portal response does not expose notification state.
- Changelog public preview still excludes private notes.
- Request edit workflow still preserves comments, tags, votes, owner, and visibility.
- Integration imports still create private requests by default.
- GitHub/Linear/Jira import routes still pass provider/workspace scoping tests.
- Backup/restore still accepts the updated OpenRoad schema.

## Security And Privacy Checks

- Do not send external messages in this slice.
- Do not persist delivery secrets or provider credentials.
- Do not include private notes or internal comments in queued notification bodies.
- Keep notification events workspace-scoped.
- Bound event and preference arrays to avoid unbounded growth.
- Keep public APIs projection-only.
- Keep broad notification settings replacement out of the server workspace action API until a narrower preferences endpoint exists.

## Migration And Rollback

- OpenRoad schema version increments for workspace notification settings.
- Previous workspaces migrate with notifications enabled, conservative quiet window defaults, no preferences, and empty outbox.
- Rollback requires restoring a backup made before schema upgrade or running a future down-migration because older builds reject newer schema versions.

## Manual QA Checklist

- Run focused notification/domain/app tests.
- Run `pnpm check`.
- Run built-server smoke with all integration env unset.
- Inspect public portal JSON for absence of notification settings/outbox.
- Inspect generated outbox events to confirm no private notes or internal comments.

## Evidence

- Branch: `feat/requester-notifications`
- Commit SHAs: `9d06bd6` implementation, `0b7c8f0` and `e3d82e3` evidence records, `2432258` audit hardening.
- Date: 2026-07-04.
- Acceptance criteria status: passed on branch after audit hardening.
- Commands run:
  - `pnpm vitest run src/domain/openroad.test.ts server/store.test.ts server/http.test.ts` - 88 tests passed.
  - `pnpm vitest run src/App.test.tsx` - 45 tests passed.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` - no findings.
  - `pnpm check` - 17 test files, 210 tests passed; production client and server builds passed.
  - Built-server smoke with all provider integration env unset - passed health, workspace contract, public portal, private denied, and private token checks.
- Browser/viewports tested:
  - Desktop 1280x720: requester notification panel rendered, status update queued, no horizontal overflow across app shell, operations deck, board, inspector, triage controls, or notification panel.
  - Mobile 390x844: no horizontal overflow across the same surfaces.
- Accessibility checks:
  - Requester notification controls are checkbox inputs with visible `Status` and `Changelog` labels.
  - The new panel is exposed as `aria-label="Requester notifications"`.
- Reviewer notes:
  - The slice is intentionally outbox-only; it queues internal events but sends no external provider, email, web push, or chat messages.
  - Notification bodies use public request/changelog fields and tests assert private changelog notes and internal comments are not present.
  - Public portal projection was checked to exclude notification settings and outbox records.
  - Read-only subagent audit found no P0/P1 issues. P2 feedback was resolved by discriminator-bearing event ids, selected-request-only outbox counts, rejecting broad notification settings replacement over workspace actions, and adding explicit draft/private changelog no-queue tests.
  - Impeccable detector reported no UI findings for the edited app/CSS files.
- Known unresolved risks: Real delivery channels, verified requester identities, unsubscribe links, background delivery workers, and notification analytics remain later production slices.
- Rollback notes: Restore a pre-upgrade backup or migrate notification fields out before downgrading to an older schema.
