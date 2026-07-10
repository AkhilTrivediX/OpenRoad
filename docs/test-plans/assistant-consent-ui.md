# Feature Test Plan: Assistant Consent UI

Branch: `feat/assistant-consent-ui`

## Objective

Add the first browser UI path for consented model-assisted assistant triage while preserving OpenRoad's local deterministic assistant as the default. The UI must be compact, workspace-safe, and clear enough that a maintainer understands what will be shared before any external model request can happen.

## User Story

As a workspace maintainer using a server-backed OpenRoad deployment, I can review the normal local assistant suggestion, optionally grant request-level consent to share bounded workspace context with the server-side model adapter, and refresh the selected-request summary. If I do not grant consent, if the provider is not configured, or if the provider fails, OpenRoad keeps the local suggestion visible and explains the fallback without exposing provider details.

## Design Intent

- Keep the assistant inside the existing selected-request inspector.
- Use one small consent row and one action, not a second assistant dashboard.
- Keep standalone/local-first mode unchanged.
- Use the dark map-room workbench language already in `DESIGN.md`: sharp geometry, 1px dividers, restrained semantic color, no gradients, no oversized rounded surfaces, no nested card stack.
- Use direct product copy, not implementation copy. Users need to know what is shared and what remains local; they do not need provider names, prompt internals, or raw error details.

## Source Guidance

- `docs/AI_ASSISTED_TRIAGE.md` defines the deterministic default and server model adapter boundary.
- `docs/API_AUTH_TENANCY_CONTRACT.md` requires `workspace:read`, explicit request-level consent, server-only provider config, no raw prompt/response exposure, and advisory-only output.
- `docs/PRODUCTION_READINESS.md` requires a feature test plan before product-code changes, browser QA for touched UI, no increased first-use complexity, and production gates before merge.
- `PRODUCT.md` and `DESIGN.md` require standalone-first behavior, no silent AI source-of-truth mutation, and calm progressive disclosure.

## Scope

- Add a typed browser helper for `POST /api/openroad/workspaces/:workspaceId/assistant/triage`.
- Add client-side result state for the selected request only.
- Keep local deterministic suggestions as the initially visible suggestion.
- Show model consent controls only when server persistence is enabled.
- Require an explicit workspace-context consent checkbox before enabling the model refresh action.
- Offer a second optional requester-identity consent checkbox that is disabled until workspace-context consent is checked.
- Send only `requestId`, `allowExternalModel: true`, and explicit consent flags from the browser.
- Merge the returned suggestion into the existing assistant panel display without persisting it to OpenRoad state.
- Show a compact model status/fallback line with safe user-facing language.
- Preserve the session-level assistant pause toggle.
- Keep the existing `Create private draft` approval path unchanged.
- Update docs and readiness notes for this UI slice.

## Not In Scope

- Per-workspace AI policy settings.
- Hosted account-level AI controls.
- Provider selection from the browser.
- Browser exposure of model provider names, API keys, base URLs, raw prompts, raw responses, prompt sections, stack traces, or provider errors.
- Persisted assistant suggestions.
- Streaming model responses.
- Model-generated duplicate merge decisions.
- Model-generated changelog public copy.
- Background AI jobs, embeddings, model evals, usage dashboards, billing, or quotas.
- Automatic status, owner, roadmap, work item, notification, duplicate, or changelog mutations.
- Public portal assistant output.

## Acceptance Criteria

- Standalone/local mode still shows deterministic assistant suggestions and no model consent controls.
- Server-backed mode shows deterministic assistant suggestions before any model action.
- Server-backed mode shows concise consent controls inside the existing assistant panel only.
- The model refresh action is disabled until workspace-context consent is checked.
- Requester identity consent is optional and cannot be enabled without workspace-context consent.
- Clicking model refresh sends `POST /api/openroad/workspaces/:workspaceId/assistant/triage` with same-origin credentials.
- The request body contains only `requestId`, `allowExternalModel: true`, and `consent.shareWorkspaceContext/shareRequesterIdentity`.
- A successful model result can update only the displayed assistant suggestion returned by the server.
- Model-backed status copy says that the summary was refined without exposing provider configuration.
- Provider-not-configured, missing-consent, invalid-output, and provider-failed fallbacks keep local suggestions visible and use safe fallback copy.
- Network/API failures keep local suggestions visible and show generic retry-safe copy.
- The pause toggle still hides assistant suggestion content and prevents model controls from becoming a separate workflow.
- Changing selected request or workspace clears stale model result, loading, and error state.
- Existing private changelog draft creation remains explicit, private, draft-only, and human-approved.
- Public portal output does not include assistant model metadata or suggestion content.
- No browser API response, DOM text, logs, tests, docs, or screenshots expose API keys, raw prompts, raw model responses, private notes, internal comments, hidden comments, notification bodies, provider secrets, or raw provider payloads.
- Desktop and mobile app shell remain fixed-height with no body-level scroll and no horizontal overflow.
- `pnpm check`, `pnpm release:verify`, built-server smoke, and GitHub Actions production gate pass before merge.

## Automated Test Checklist

- Existing deterministic assistant test still finds `Triage assist`, `Assistant suggestions`, duplicate suggestions, and private draft approval behavior.
- Local mode does not render model consent controls or call `fetch` for assistant triage.
- Server-backed mode renders a compact model consent area in the assistant panel.
- Model refresh button is disabled before workspace-context consent is checked.
- Requester-identity checkbox is disabled until workspace-context consent is checked.
- Unchecking workspace-context consent clears requester-identity consent.
- Clicking model refresh while enabled calls the assistant triage endpoint exactly once with `credentials: "same-origin"` and `method: "POST"`.
- Endpoint payload includes `requestId`, `allowExternalModel: true`, and the selected consent flags.
- Endpoint payload does not include workspace export, provider config, API key, model name, base URL, raw prompt, raw response, comments, notifications, private notes, or integration credentials.
- A model-success response updates displayed `Problem` and `Next` text from the response.
- A model-success response preserves deterministic `Signal`, duplicate suggestions, and changelog suggestion behavior as returned by the server result.
- Provider-not-configured response shows safe local-fallback copy and keeps the existing suggestion visible.
- Provider-failed response shows safe local-fallback copy and keeps the existing suggestion visible.
- Invalid-model-output response shows safe local-fallback copy and keeps the existing suggestion visible.
- A 400/403/404/500 assistant endpoint failure shows generic unavailable copy and keeps the local suggestion visible.
- Loading state disables model controls and avoids duplicate submissions.
- Selecting another request clears the previous model status/result.
- Switching workspaces clears the previous model status/result.
- Pausing assistant suggestions hides the consent controls and removes the private draft action.
- Re-enabling assistant suggestions returns to deterministic suggestions without auto-calling the endpoint.
- Existing request triage, owner assignment, duplicate merge, archive filter, and selected inspector action-count tests still pass.
- Existing provider write-back, integration Settings, requester notifications, team membership, public portal, persistence, import/export, release, and server access tests still pass.

## Regression Checklist

- The first-use shell remains two-pane and does not reveal AI controls before a request is selected.
- The primary nav remains Inbox, Roadmap, Changelog, Portal, Settings for new users.
- Work navigation still appears only after work items or delivery integrations exist.
- Public portal snapshots still contain only public-safe request, roadmap, and changelog data.
- Public portal writes still do not expose private comments, internal notes, hidden comments, assistant metadata, or model metadata.
- Workspace read/write APIs still respect owner/member scope.
- Integration credential APIs still never expose encrypted secrets or access tokens.
- Provider sync and write-back tests still redact provider errors and metadata.
- Requester notification preferences and outbox delivery still use public-safe payloads only.
- Account invitation/recovery flows still do not expose raw token hashes after one-time creation/confirmation.
- Backup/restore and release verification still include the current schema and operational metadata.
- Existing model adapter server tests still prove prompt redaction, explicit consent, fallback behavior, OpenAI request shape, and sanitized operational events.

## Security And Privacy Checks

- No model provider call happens from browser code.
- No model provider call happens unless the user explicitly checks workspace-context consent and clicks model refresh.
- The browser sends only selected-request id and consent booleans to OpenRoad.
- The browser never sends provider configuration, model names, raw prompts, raw responses, full workspace exports, provider payloads, tokens, API keys, hidden/private comments, notification bodies, or private changelog notes.
- The UI never displays raw provider failure text, stack traces, provider names, model names, prompt section names, redaction counts, prompt characters, raw prompts, or raw responses.
- Model-backed suggestions remain advisory and cannot mutate OpenRoad state.
- Changelog creation remains a separate explicit private-draft action.
- Endpoint failures are handled as safe UI states, not as leaked error messages.
- The consent controls are visible and explicit enough for a keyboard or screen-reader user to understand before the action is enabled.

## UX And Accessibility Checks

- The assistant panel remains a single compact inspector section.
- The consent controls use native checkboxes and a normal button with accessible names.
- Status updates use `aria-live="polite"` or equivalent so screen-reader users hear loading/success/fallback states.
- Focus remains visible on the pause toggle, consent checkboxes, model action, duplicate cards, and private draft action.
- Loading, disabled, and fallback states are visible through text, not color alone.
- Text wraps within the inspector at desktop and mobile widths.
- The panel does not introduce nested card stacks, large rounded corners, decorative gradients, or unexplained AI iconography.
- Mobile layout does not push the footer/status rail out of the fixed app shell.
- Design detector runs on touched UI files and returns no actionable findings.

## Manual QA Checklist

- Run focused app assistant tests.
- Run focused server assistant/model adapter tests.
- Run `pnpm check`.
- Run `pnpm release:verify`.
- Run built-server smoke with no AI provider configured and confirm assistant triage smoke still passes.
- In local/standalone dev mode, confirm deterministic assistant remains visible and model controls are absent.
- In server-backed mode with no AI provider configured, check consent, click model refresh, and confirm safe local-fallback copy.
- In server-backed mode with a local fake OpenAI-compatible provider, check consent, click model refresh, and confirm problem/next summary refinement appears without provider details.
- Confirm public portal JSON does not include assistant prompt/model metadata.
- Browser QA desktop `1440x900`: selected-request assistant panel remains compact, no body scroll, no horizontal overflow, footer visible.
- Browser QA mobile `390x900`: consent controls wrap cleanly, no text overlap, no body scroll, no horizontal overflow.

## Migration And Rollback

- No OpenRoad domain schema migration is expected.
- No team metadata schema migration is expected.
- Assistant UI state is session-only and can be removed with a normal code rollback.
- Operators can disable external model use by unsetting `OPENROAD_AI_PROVIDER` or setting it to `deterministic`; the browser should continue showing deterministic suggestions.
- If the assistant endpoint is unavailable, the UI must continue showing deterministic suggestions.

## Evidence

- Planning status: written before product-code implementation.
- Implementation commits: pending.
- Commands run: pending.
- Browser/viewports tested: pending.
- Reviewer notes: pending.
- Known unresolved risks: per-workspace AI policy settings, hosted account-level AI controls, provider-specific policy review, model evals, AI usage dashboards, streaming, background jobs, and automated browser E2E CI remain future slices.
