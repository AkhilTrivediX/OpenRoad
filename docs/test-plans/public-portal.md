# Feature Test Plan: Public Portal

Branch: `feat/public-portal`

## Objective

Turn the placeholder Portal nav target into a usable public-facing portal preview backed by standalone OpenRoad data. External visitors should be able to understand public requests, roadmap intent, and changelog updates without seeing internal work, private roadmap items, private changelog drafts, private notes, or integration complexity.

## User Story

As a founder, maintainer, or product lead, I can expose a simple public portal from my OpenRoad workspace so users can search public feedback, vote, comment when allowed, and see public roadmap/changelog updates while internal planning remains private.

## In Scope

- Portal settings stored with each workspace.
- Public/private visibility for requests.
- Public feedback board filtered to public, active requests.
- Public request search by title, description, and tags.
- Public voting on visible portal requests.
- Public commenting when comments are enabled.
- Comment visibility/moderation so public comments can be shown or hidden without deleting internal history.
- Public roadmap sourced only from Public roadmap items.
- Public changelog sourced only from Ready + Public changelog entries.
- Portal works with standalone OpenRoad objects and no GitHub, Jira, Linear, backend, or AI dependency.
- Migration for older saved workspaces.
- Export/import and recovery coverage for portal settings and request/comment visibility.
- Browser QA for fixed-shell desktop and compact layouts.

## Out Of Scope

- Hosted public URLs, custom domains, RSS, SEO, sitemap, or sharing links.
- Authentication, real public visitor accounts, CAPTCHA, rate limiting, or abuse automation.
- Email/Slack/Discord/requester notifications.
- Provider sync to GitHub, Jira, or Linear.
- Server-side moderation queues or audit logs.

## Acceptance Criteria

- Portal nav lands on a real Public Portal section, not the standalone intro plate.
- User can view a public feedback board without connecting an integration.
- User can search public requests.
- User can vote and remove a vote on a public request.
- User can add a public comment when comments are enabled.
- User can disable public comments without losing existing comments.
- User can hide and restore a public comment through moderation controls.
- Private/internal request comments are not shown in the public portal.
- Private requests are hidden from the public feedback board.
- Archived requests are hidden from the public feedback board.
- Public roadmap shows only Public roadmap items.
- Public changelog shows only Ready + Public changelog entries.
- Private changelog notes are never rendered in the portal.
- Imported/exported workspaces preserve portal settings and request/comment visibility.
- Older saved workspace data migrates into valid portal-ready records.
- Existing Inbox, Work, Roadmap, Changelog, persistence, and settings flows still pass.

## Automated Tests

- Domain migration adds default portal settings to older workspaces.
- Domain migration gives existing requests a valid visibility value.
- Domain migration gives existing comments a valid internal/public visibility value.
- Import rejects malformed portal settings.
- Import rejects malformed request/comment visibility.
- App renders a public portal section reachable from primary navigation.
- Public feedback board shows public requests and hides private/archived requests.
- Portal search filters public requests and can return an empty state.
- Portal vote button increments and decrements visible public request votes.
- Portal comment form adds a public comment when comments are enabled.
- Portal comment form is hidden/disabled when comments are disabled.
- Moderation controls hide and restore public comments.
- Internal comments remain hidden from the public portal.
- Public roadmap hides Private roadmap items.
- Public changelog hides Private or Draft changelog entries and never shows private notes.
- Export/reset/import restores portal settings, request visibility, and moderated comments.
- Existing roadmap, changelog, request triage, work, and persistence tests still pass.
- `pnpm check` passes.

## Manual / Browser QA

- Desktop `1440x900`: Portal section lands below sticky controls, public board/roadmap/changelog are scan-friendly, and no page-level scroll or horizontal overflow appears.
- Compact `390x844`: Portal cards stack cleanly inside the app scroll area, bottom status stays visible, and search/vote/comment controls remain reachable.
- Verify a private request and private changelog draft are not visible in portal preview.
- Verify disabling comments removes the comment composer while preserving existing public comments.
- Verify portal can be used with a blank standalone workspace after creating a public request manually.

## Accessibility Checks

- Portal section has a clear accessible name.
- Public request rows/buttons have clear accessible names.
- Vote, comment, hide, and restore controls have clear accessible labels.
- Search input has a clear label.
- Empty states are readable without relying on color.
- Public/private state is expressed in text, not color only.
- Keyboard users can search, select a public request, vote, add a comment, and moderate comments.

## Security/Privacy Checks

- Private requests are not rendered in the portal.
- Archived requests are not rendered in the portal.
- Request owner, source, requester identity, merged-source history, and linked internal work are not rendered in the portal.
- Internal request comments are not rendered in the portal.
- Private roadmap items are not rendered in the portal.
- Private or Draft changelog entries are not rendered in the portal.
- Changelog private notes are not rendered in the portal.
- User-authored request/comment/changelog text renders as text, not HTML.
- Portal actions stay local and send no data to external services.
- Settings make it clear this is a local preview, not a hosted public URL.

## Regression Checks

- Feature 1 workspace shell still works.
- Feature 2 standalone requests still work.
- Feature 3 request triage still works.
- Feature 4 internal work items still work.
- Feature 4.5 persistence/import/export/recovery still works.
- Feature 5 roadmap workflow still works.
- Feature 6 changelog drafts still work.
- Roadmap UX simplification still keeps a single selected editor.
- Optional integrations remain non-blocking.
- Impeccable detector returns no touched-UI findings.

## Rollback Plan

- If schema migration fails before merge, keep `main` on schema version 3 and do not merge.
- If portal visibility is ambiguous, keep the branch open until privacy tests are explicit.
- If the portal UI overloads the dashboard, keep domain changes behind the branch and simplify the section before merge.
- If public comments create moderation ambiguity, ship search/read/vote first and keep commenting out of `main`.

## Known Risks

- Local-only voting/commenting can be mistaken for a hosted public portal until backend/auth work exists.
- Public request visibility is new and could surprise users if seeded or imported data defaults incorrectly.
- Future hosted portal work must add rate limiting, abuse controls, consent, and audit logs before real public exposure.
- Public roadmap/changelog links can drift when internal source items are removed.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm check` passed with 58 total tests and a production build.
- Domain tests passed with schema v4 migration, invalid portal import, and public projection coverage.
- App tests passed for public portal rendering, public search, voting, commenting, moderation, standalone public requests, and portal export/import restoration.
- Impeccable detector returned no touched-UI findings for `src/App.tsx` and `src/styles.css`.
- Browser QA passed at `1440x900` and `390x844`: body scroll remained locked, no horizontal overflow was detected, the Portal anchor landed on the portal section, the public preview rendered before settings, public board/roadmap/changelog were present, and private request/roadmap/changelog/internal-comment/private-note content did not appear in the portal.
- Browser QA passed for a blank standalone workspace: a manually created Public request appeared in the portal without any GitHub, Jira, Linear, backend, or AI setup.
