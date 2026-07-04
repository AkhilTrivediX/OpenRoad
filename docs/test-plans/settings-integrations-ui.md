# Feature Test Plan: Settings Integrations UI

Branch: `feat/settings-integrations-ui`

## Objective

Turn the current passive Settings integration chips into a progressive, production-safe integration control surface. The surface should help a maintainer understand GitHub, Jira, and Linear readiness, inspect recent sync state, and manually trigger GitHub linked-issue sync where the server supports it, without making integrations required for standalone use or exposing provider secrets.

## User Story

As a workspace maintainer, I can open Settings and see whether OpenRoad is running standalone, whether integration metadata is available, which providers are connected or only available later, and when GitHub sync last ran. When GitHub is connected and the server allows it, I can run a manual sync for linked GitHub issues from Settings and see a safe success, queued, unavailable, or failure status.

## Scope

- Settings UI refresh for the existing dark map-room product shell.
- A calm Integration Control section inside Settings, not a new primary nav item.
- Provider rows/cards for GitHub, Linear, and Jira using the existing sharp geometry, 1px dividers, semantic status badges, and restrained color system.
- A server-backed integration status read path that returns sanitized workspace-scoped provider status, installation counts, linked mapping counts, recent sync job metadata, and safe capability flags.
- Browser client helpers for integration status loading, GitHub manual sync enqueue, and private runner execution when the current deployment allows those calls.
- Manual GitHub sync action that enqueues a GitHub sync job and attempts to run due jobs through the existing private runner.
- Progressive disclosure for recent sync activity so logs are visible inside Settings but not noisy by default.
- Graceful standalone/local fallback when no server integration metadata endpoint is available.
- Graceful permission/error state when a deployment requires admin/session auth that the browser does not have.
- Documentation updates to reflect that browser Settings UI now exists for integration visibility and GitHub manual sync, while Linear/Jira live workers remain future work.

## Not In Scope

- OAuth callback exchange or browser token capture.
- Persisting provider secrets in browser state.
- Exposing admin tokens through `VITE_*` or client JavaScript.
- GitHub repository discovery or unmapped issue import.
- Linear/Jira live sync workers.
- Provider write-back from OpenRoad to GitHub, Linear, or Jira.
- Full sync log/audit timeline.
- Conflict resolution UI.
- Scheduler/cron packaging.
- New app navigation item for sync logs.
- Broad component/module extraction unrelated to Settings.

## Acceptance Criteria

- Default navigation remains Inbox, Roadmap, Changelog, Portal, Settings.
- Standalone OpenRoad still works with no server integration metadata; Settings must show integrations as optional/unavailable without blocking local data tools.
- Settings keeps local data tools usable and visually secondary to the current task, not buried behind a modal.
- The integration section shows GitHub, Linear, and Jira in one scannable surface with distinct provider names, current status text, and capability text.
- GitHub shows live-sync capability only when the server reports a connected active installation and worker-supported sync.
- Linear and Jira clearly show import/link support or future live-sync status without presenting a fake working sync button.
- Manual GitHub sync is disabled when no active installation exists, no server API is available, the user lacks permission, or the worker is not configured.
- Manual GitHub sync never sends or displays provider tokens, private keys, webhook secrets, encrypted credential payloads, or raw provider payloads.
- Manual GitHub sync returns safe user-facing states for queued, succeeded, retryable, failed, deduped, forbidden, and not-configured outcomes.
- Recent sync activity is bounded and sanitized; default Settings view shows a small summary with optional disclosure for job details.
- Provider metadata is derived from a sanitized server summary and is not copied into `Workspace.integrations` as source-of-truth state.
- Provider rows are flat route plates with one primary action/status area; the design must avoid nested provider cards or sync-log clutter.
- Provider actions meet the product touch target baseline on mobile.
- The UI does not introduce body-level scrolling, horizontal overflow, nested-card confusion, or larger first-use complexity.
- Keyboard users can reach provider actions, recent activity disclosure, export/import controls, and Settings navigation.
- Focus states remain visible and status is conveyed with text, not color alone.
- Touched UI passes desktop and mobile browser QA.
- Existing request, work, roadmap, changelog, portal, persistence, public portal, GitHub import/live fetch/webhook/disconnect, background sync worker, ops, release, and API auth tests still pass.
- `pnpm check` passes.

## Automated Test Checklist

- Settings renders local data tools and the integration control section together.
- Existing standalone-first test still finds Optional integrations when no server API is available.
- Integration status client returns a safe fallback when fetch is unavailable, rejected, forbidden, or returns `503 not_configured`.
- Integration status client validates response shape and rejects malformed payloads without crashing the app.
- Server integration status endpoint requires workspace read access and rejects public visitors when token/auth mode is enabled.
- Server integration status endpoint returns sanitized provider status only for the requested workspace.
- Server integration status endpoint includes active installation count, linked issue mapping count, recent bounded sync job metadata, and provider capability flags.
- Server integration status endpoint does not include credentials, encrypted secrets, tokens, authorization headers, raw provider payloads, webhook secrets, private keys, or cross-workspace records.
- GitHub manual sync button is enabled only when an active GitHub installation and sync capability are reported.
- Clicking GitHub manual sync enqueues a GitHub sync job and attempts the private sync runner when available.
- Manual sync success updates the provider status message and recent activity summary.
- Manual sync queued/deduped/retryable/fatal/not-configured/forbidden outcomes show bounded, safe copy.
- Manual sync action is idempotent enough for repeated clicks and does not create duplicate jobs beyond backend dedupe behavior.
- Browser-rendered integration UI does not contain token-shaped text, encrypted credential payloads, webhook payloads, or raw sync logs.
- Linear and Jira controls remain visible but do not claim live sync support.
- Settings keeps export, reset, and import workspace data workflows working.
- Settings mobile layout stacks provider controls without text overlap or horizontal overflow.
- Provider action buttons remain at least 44px tall on mobile.
- Default nav remains unchanged and no Sync logs/Audit nav item appears.
- Existing `server/http.test.ts`, `server/sync-jobs.test.ts`, `server/integrations.test.ts`, `src/App.test.tsx`, and persistence tests pass.

## Regression Checklist

- GitHub issue import and live issue preview APIs still work.
- GitHub webhook processing stays idempotent and private.
- GitHub disconnect still revokes credentials, disconnects mappings, and prevents future sync apply.
- Background sync runner still returns `503` when no worker is configured.
- GitHub sync worker still updates only already-linked issue mappings.
- Linear and Jira payload-backed import/link behavior remains unchanged.
- Public portal API still excludes integration metadata and sync jobs.
- Backup/restore still sanitizes integration metadata and sync job history.
- Error boundary recovery still allows local data reset.
- Release manifest generation remains dry-run safe and does not include secrets.

## Security And Privacy Checks

- No provider secret, admin token, private key, installation token, webhook secret, encrypted credential payload, or raw provider payload is exposed to browser UI.
- Browser code must not read provider secrets from environment variables.
- Browser code must not ask users to paste provider private keys or admin tokens.
- Status endpoint must only return sanitized metadata and bounded sync job summaries.
- Manual sync responses must use existing redaction/sanitization paths.
- Forbidden and not-configured responses must not reveal deployment secrets or internal file paths.

## UX And Accessibility Checks

- The Settings surface uses the existing Dark Map Room vocabulary: sharp edges, 1px dividers, route labels, semantic badges, no gradients, no glass, no decorative card grid.
- Provider controls are organized as a single control surface, not container-inside-container clutter.
- Important information is visible in this order: standalone status, provider readiness, next action, recent activity.
- Text fits in provider rows at desktop and mobile widths.
- Buttons use icons plus clear text for actions; disabled actions explain why through nearby text.
- Recent activity is available through native disclosure or equivalent keyboard-accessible progressive disclosure.
- Status copy is short and operational, not implementation-heavy.

## Manual QA Checklist

- Start app in standalone/local mode and confirm Settings shows optional integrations without errors.
- Start built server without integration metadata or GitHub App config and confirm Settings degrades gracefully.
- Start built server with integration metadata and GitHub App test config, import/link a GitHub issue, open Settings, run manual GitHub sync, and confirm linked request updates.
- Confirm a forbidden/token-mode deployment shows a safe permission message instead of exposing admin-token instructions.
- At desktop viewport, navigate to Settings, use keyboard tab order through integration controls and local data tools, and verify focus rings.
- At mobile viewport, navigate to Settings and confirm no body scroll, no horizontal overflow, bottom status remains reachable, and provider text/actions do not overlap.
- Run `pnpm check`.
- Run `pnpm release:verify`.
- Run built-server smoke with `pnpm ops:smoke` and a GitHub manual sync path where possible.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch. Existing integration metadata, sync jobs, mappings, credentials, and OpenRoad state remain compatible with the previous build.
- If manual sync changed request data unexpectedly, restore a pre-branch backup and rerun `pnpm ops:smoke`.

## Evidence

- Branch: `feat/settings-integrations-ui`
- Implementation commit SHA: `848c386f8a53348337341b857a2e3c8f7ef3ce4a`.
- Date: 2026-07-04.
- Acceptance criteria status: Passed. Settings keeps standalone mode usable, exposes sanitized provider readiness, enables GitHub manual sync only when supported, keeps Linear/Jira as non-fake future live-sync controls, preserves local data tools, and avoids a new Sync logs navigation item.
- Commands run:
  - `pnpm vitest run src/integrations/github.test.ts src/persistence/openroadIntegrations.test.ts src/App.test.tsx server/access.test.ts server/http.test.ts` passed: 5 files, 141 tests.
  - `pnpm build:server` passed.
  - `pnpm build:client` passed.
  - `pnpm check` passed: 25 files, 280 tests, production client/server builds.
  - `pnpm release:verify` passed and generated the RC manifest dry-run.
  - `node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\styles.css` returned `[]`.
  - Built-server smoke passed against `server-dist/server/index.js` with a fake GitHub App API: `ops:smoke`, unauthenticated status denial, GitHub issue import, sanitized Settings status, manual sync enqueue/run, linked request update, and hostile URL/token redaction were verified.
- Browser/viewports tested:
  - Desktop 1440x900 Settings QA passed: no body scroll, bottom status in viewport, no horizontal overflow, Settings visible, provider controls visible, local data buttons stable at 32px.
  - Mobile 390x844 Settings QA passed: no body scroll, bottom status in viewport, no horizontal overflow, Settings visible, provider action touch targets at 44px.
- Accessibility checks: Provider actions, recent activity disclosure, and local data tools remain keyboard-reachable; status is conveyed through text plus tone; disabled Linear/Jira actions include nearby operational copy.
- Reviewer notes: Dalton read-only audit called out auth, sanitization, fallback, and no-clutter risks; follow-up checks added route authorization coverage, sanitized status tests, client fallback parsing, no token-shaped UI assertions, and browser overflow/touch-target QA.
- Known unresolved risks: OAuth callback exchange, Linear/Jira live workers, provider write-back, full sync/audit timeline, conflict UI, scheduler packaging, and hosted session auth remain later production slices.
- Rollback notes: Revert `848c386f8a53348337341b857a2e3c8f7ef3ce4a` and this evidence commit. No schema migration was introduced; existing OpenRoad state and integration metadata remain compatible. If manual GitHub sync changed request content unexpectedly, restore the pre-branch backup and rerun `pnpm ops:smoke`.
