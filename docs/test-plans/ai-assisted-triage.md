# Feature Test Plan: AI-Assisted Triage

Branch: `feat/ai-assisted-triage`

## Objective

Add the first production-safe assistant layer for triage: duplicate suggestions, request summaries, changelog draft suggestions, and explanation UI. This slice must improve maintainer speed without sending data to external AI services and without changing source-of-truth records unless a maintainer explicitly accepts an action.

## User Story

As a maintainer, I can open a request and quickly understand likely duplicates, the strongest signal, and a possible public changelog draft, then decide what to apply myself.

## Scope

- Deterministic local assistant engine for this first slice.
- Duplicate request suggestions based on title, description, tags, requester/source overlap, status, and existing merge history.
- Request summary card for the selected request with problem, signal, current state, and suggested next action.
- Changelog draft suggestion generated from selected request context and linked Done work or roadmap evidence when available.
- Explanation UI showing why each suggestion appeared.
- Explicit human-approval actions only.
- Session-level pause control for assistant suggestions.
- Generic changelog public title and wording until a maintainer writes approved copy.
- No external network calls, API keys, prompt logs, embeddings, model responses, or provider-specific fields.
- Tests and docs for assistant boundaries and future model-backed adapters.

## Not In Scope

- OpenAI or other model API integration.
- Server-side background AI jobs.
- Vector search or embeddings.
- Automatic merge, status, owner, roadmap, or changelog writes.
- Training, analytics, telemetry, or prompt history.
- Provider-specific AI logic for GitHub, Jira, or Linear.

## Acceptance Criteria

- Assistant suggestions are available in standalone mode with no integrations configured.
- Selecting a request shows an assistant panel that summarizes the request without exposing private workspace state outside the app.
- Duplicate suggestions exclude the selected request, archived requests, and requests already merged into the selected request.
- Duplicate suggestions include a human-readable explanation of matching title terms, tag overlap, requester/source overlap, or description overlap.
- Suggestions are bounded and stable enough for repeatable tests.
- Changelog draft suggestions use only selected request context plus linked Done work/roadmap context already visible to the maintainer.
- Changelog draft suggestions do not copy source request, work, or roadmap descriptions into public changelog fields.
- Applying an assistant changelog suggestion requires an explicit button click and creates a normal editable changelog draft.
- No assistant action silently changes a request status, owner, duplicate relation, visibility, notification outbox, or public portal content.
- Maintainers can pause assistant suggestions for the current session.
- Public portal snapshots do not include assistant suggestions.
- Existing GitHub, Linear, Jira, public portal, requester notification, backup/restore, and self-host smoke tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Assistant summary returns a concise problem/signal/state/next-action model for a selected request.
- Duplicate scoring ranks obvious title/tag matches higher than weak unrelated requests.
- Duplicate suggestions exclude the selected request.
- Duplicate suggestions exclude archived requests.
- Duplicate suggestions exclude requests already present in selected request merge history.
- Duplicate explanations include specific overlap reasons.
- Duplicate suggestions do not appear for one broad tag match alone.
- Suggestion output is bounded to a small number of cards.
- Changelog suggestion uses linked Done work when available.
- Changelog suggestion falls back to selected request context when no Done work exists.
- Changelog suggestion does not include internal comments, hidden comments, private changelog notes, notification outbox bodies, integration secrets, raw provider payloads, or copied source descriptions in public fields.
- App tests cover opening the assistant panel, reviewing duplicate explanations, and applying a changelog suggestion through an explicit click.
- Applying a changelog suggestion creates an editable private draft and does not publish it.
- App tests cover pausing and resuming assistant suggestions.
- Existing domain/app/server/integration tests pass.

## Regression Checklist

- Request editing still preserves comments, tags, votes, owner, status, visibility, archive state, and requester notification behavior.
- Existing duplicate merge workflow still requires the existing explicit merge button.
- Changelog manual and source-based draft creation still work.
- Public portal projection still excludes private requests, internal comments, private notes, notifications, and assistant suggestions.
- Workspace export/import still accepts the current schema.
- Standalone mode remains usable without GitHub, Jira, Linear, or AI service configuration.

## Security And Privacy Checks

- Do not introduce external AI/network calls.
- Do not add API keys, model names, provider clients, prompt logs, telemetry, or analytics.
- Do not persist assistant suggestions in the OpenRoad state schema in this slice.
- Keep generated suggestions derived from current in-memory workspace data.
- Keep future model-backed integration behind explicit consent and server-side redaction.
- Do not include private notes or internal-only records in public-facing suggestion text.
- Keep generated public changelog title and wording generic until a maintainer writes approved copy.

## UX And Accessibility Checks

- Assistant UI should be compact and subordinate to the selected request, not a new noisy command center.
- Suggestions must explain why they exist without teaching implementation details.
- Controls must be normal buttons/checkboxes/selects with accessible names.
- Empty state should be calm when no useful suggestions exist.
- Desktop and mobile layouts must avoid horizontal overflow and keep the app shell fixed.
- Design detector must return no findings for touched UI files.

## Migration And Rollback

- No schema version increment is expected if suggestions remain derived and not persisted.
- Rollback is a normal code rollback; no data migration should be required.
- If implementation later requires persisted assistant state, add schema migration and rollback notes before merge.

## Manual QA Checklist

- Run focused assistant/domain/app tests.
- Run `pnpm check`.
- Run the design detector for touched UI files.
- Run built-server smoke with all integration env unset.
- Browser QA selected-request assistant panel on desktop and mobile.
- Confirm applying changelog suggestion creates a private editable draft only.
- Confirm public portal JSON contains no assistant suggestion data.

## Evidence

- Branch: `feat/ai-assisted-triage`
- Commit SHAs: `406cda6` test plan, `eaa827c` implementation, `c73b1fc` first evidence docs, `e3bd0e2` audit hardening.
- Date: 2026-07-04.
- Acceptance criteria status: passed after audit hardening; ready for merge after final branch push.
- Commands run:
  - `pnpm vitest run src/app/openroadAssistant.test.ts` passed 5 tests.
  - `pnpm vitest run src/app/openroadAssistant.test.ts src/App.test.tsx` passed 51 tests before audit and again after audit hardening.
  - `pnpm check` passed 18 test files and 216 tests; production client and server builds passed before audit and again after audit hardening.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` returned no findings before audit and again after audit hardening.
  - Built-server smoke passed health, contract, portal, private-denied, and private-token checks with integration environment variables unset before audit and again after audit hardening.
- Browser/viewports tested:
  - Desktop 1280x720 selected-request assistant panel rendered with no horizontal overflow on `body`, `.app-shell`, `.operations-deck`, `.inspector`, or `[aria-label="Assistant triage"]`.
  - Desktop post-hardening check confirmed generic assistant changelog public copy, no copied selected-request title in the assistant changelog suggestion, no horizontal overflow on `body`, `.app-shell`, `.operations-deck`, `.inspector`, `[aria-label="Assistant triage"]`, or `.assistant-changelog`.
  - Desktop post-hardening pause toggle hid the draft action, re-enable restored it, and private draft action created a `Draft` and `Private` changelog entry whose public wording stayed generic and did not add the draft to the public changelog.
  - Mobile 390x844 selected-request assistant panel rendered with no horizontal overflow on `body`, `.app-shell`, `.operations-deck`, `.inspector`, `[aria-label="Assistant triage"]`, `.assistant-changelog`, or `.assistant-toggle`.
- Accessibility checks: assistant region has `aria-label="Assistant triage"`; duplicate list has `aria-label="Duplicate suggestions"`; draft suggestion has `aria-label="Assistant changelog suggestion"`; draft creation uses a normal named button; assistant suggestions can be paused with a named checkbox.
- Reviewer notes: local deterministic assistant only; no external AI calls, API keys, prompt logs, telemetry, schema migration, persisted assistant state, or silent source-of-truth mutation. Bernoulli's read-only audit found one P1 public-field privacy risk and two P2 trust/UX risks; `e3bd0e2` fixed them by keeping assistant changelog public fields generic, requiring stronger duplicate evidence than a single tag, and adding the session pause control. The changelog path requires an explicit maintainer click and creates a normal editable private draft. In-app browser `domSnapshot()` was unavailable during final QA because the extension reported `incrementalAriaSnapshot` missing, so final browser checks used supported locator counts and targeted DOM reads.
- Known unresolved risks: Real model-backed suggestions, server-side prompt redaction, user consent, AI audit logs, and external-provider policy review remain future slices.
- Rollback notes: No schema migration expected; rollback by reverting the feature branch if suggestions remain derived-only.
