# Feature Test Plan: Changelog Drafts

Branch: `feat/changelog-drafts`

## Objective

Make changelog drafting a durable OpenRoad workflow instead of a static preview. Users should be able to create public-safe release notes from shipped work or roadmap items, edit the public wording, keep private notes separate, and preserve requester links for later notification.

## User Story

As a founder, maintainer, or product lead, I can turn completed work into a clear changelog draft without copying context across tools or exposing internal/private details by default.

## In Scope

- Durable changelog entry model with schema migration from the existing preview format.
- Draft creation from manual input, Done work items, or roadmap items.
- Public wording editor and private-notes field.
- Public/private visibility state for changelog entries.
- Ready/Draft state editing.
- Request links derived from source work/roadmap and editable after creation.
- Public preview surface that shows public wording and hides private notes.
- Persistence, export/import, and corrupt-data recovery coverage.
- Calm dashboard UI that does not add another dense control wall.

## Out Of Scope

- Public portal rendering.
- Email/Slack/Discord/requester notifications.
- Provider sync to GitHub, Jira, or Linear.
- AI-generated release notes.
- Published changelog URLs or RSS.

## Acceptance Criteria

- User can create a manual changelog draft.
- User can create a changelog draft from a Done work item.
- User can create a changelog draft from a roadmap item.
- New drafts are Private by default unless the user explicitly changes visibility.
- Public preview never renders private notes.
- User can edit title, public wording, private notes, state, and visibility.
- User can link and unlink requests from a changelog draft.
- Imported/exported workspaces include full changelog draft state.
- Existing preview-shaped changelog data migrates into valid draft records.
- Existing request, work, roadmap, persistence, and settings workflows still pass.

## Automated Tests

- Reducer creates, replaces, and removes changelog entries without mutating other workspace data.
- Schema migration converts old `{ title, state, detail }` changelog entries into the new model.
- Import rejects malformed changelog entries.
- App renders seeded changelog drafts.
- App creates a manual changelog draft in a blank workspace.
- App creates a changelog draft from Done work and carries linked requests.
- App creates a changelog draft from a roadmap item and carries linked requests/work source context.
- App edits public wording while private notes remain hidden from public preview.
- App links and unlinks requests from a changelog draft.
- Changelog edits persist across remounts.
- Export/reset/import restores changelog drafts.
- Existing roadmap public/private and work status tests still pass.
- `pnpm check` passes.

## Manual / Browser QA

- Desktop `1440x900`: Changelog section shows a compact draft list, selected editor, and public preview without nested-card clutter.
- Compact `390x844`: Changelog anchor lands below sticky controls, editor stacks cleanly, no horizontal overflow.
- Verify private notes are visible only in the internal editor, not the public preview.
- Verify draft creation from a Done work item does not require external integrations.

## Accessibility Checks

- Changelog draft rows/buttons have clear accessible names.
- Selected changelog editor region has a clear accessible name.
- Public preview region has a clear accessible name.
- Form controls retain labels.
- State and visibility are text, not color only.
- Keyboard users can select, edit, link, unlink, and create changelog drafts.

## Security/Privacy Checks

- Private notes are stored as internal text and never shown in public preview.
- Private visibility is the default for new drafts.
- User-authored changelog text renders as text, not HTML.
- No changelog data is sent to external services.

## Regression Checks

- Feature 1 workspace shell still works.
- Feature 2 standalone requests still work.
- Feature 3 request triage still works.
- Feature 4 internal work items still work.
- Feature 4.5 persistence/import/export/recovery still works.
- Feature 5 roadmap workflow still works.
- Roadmap UX simplification still exposes one selected detail editor.
- Optional integrations remain non-blocking.
- Impeccable detector returns no touched-UI findings.

## Rollback Plan

- If schema migration fails before merge, keep `main` on schema version 2 and do not merge.
- If UI overloads the dashboard, keep the domain changes behind the branch and simplify the Changelog section before merge.
- If public/private preview behavior is ambiguous, do not merge until privacy tests are explicit.

## Known Risks

- Changelog source links can drift if linked work or roadmap items are later removed.
- Public portal work must respect changelog visibility and private notes.
- Requester notification later needs a separate consent and delivery model.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm exec tsc --noEmit` passed.
- `pnpm exec vitest run src/domain/openroad.test.ts` passed with 14 reducer/domain tests.
- `pnpm check` passed with 53 total tests and a production build.
- Impeccable detector returned no touched-UI findings for `src/App.tsx` and `src/styles.css`.
- Browser QA passed at `1440x900` and `390x844`: body scroll remained locked, no horizontal overflow was detected, the changelog anchor landed below sticky controls, draft creation worked without integrations, and private notes stayed out of the public preview.
- Compact editor scroll QA passed: selected editor and public preview stack inside the workspace scroll area, no horizontal overflow was detected, and private notes stayed internal.
