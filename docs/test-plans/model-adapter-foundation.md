# Feature Test Plan: Model Adapter Foundation

Branch: `feat/model-adapter-foundation`

## Objective

Add the first production-safe server-side model adapter boundary for OpenRoad assistant triage. The feature must keep deterministic local assistant behavior as the default fallback while creating a tested path for consented, server-only model assistance.

## User Story

As a workspace maintainer, I can request assistant triage for a selected request through a private OpenRoad API. If no external model is configured, or if I do not grant explicit context-sharing consent, OpenRoad returns the same deterministic advisory suggestion it already trusts. If an external model is configured and I explicitly allow it, OpenRoad sends only bounded, redacted context from the server and records audit/ops evidence.

## Source Guidance

- OpenAI text generation docs recommend the Responses API for direct model requests: `https://developers.openai.com/api/docs/guides/text`.
- OpenAI API reference documents `POST /v1/responses` for creating model responses: `https://api.openai.com/v1/responses`.
- OpenAI text docs warn not to assume text output is always at `output[0].content[0].text`; the adapter must parse `output_text` and output arrays defensively.
- OpenAI docs recommend code-managed production prompts with typed inputs, tests, and normal deployment review.

## Scope

- Shared deterministic assistant core usable by both browser app and server fallback.
- Server-side model adapter interface with a deterministic provider and an OpenAI Responses API provider.
- Private endpoint: `POST /api/openroad/workspaces/:workspaceId/assistant/triage`.
- Workspace-scoped read permission for assistant triage.
- Request payload with `requestId`, optional `allowExternalModel`, and explicit consent flags.
- Default behavior returns deterministic suggestions and performs no external model call.
- External behavior is enabled only when all are true:
  - Server configuration selects the OpenAI provider.
  - Server has an API key and model name.
  - Request payload explicitly sets `allowExternalModel: true`.
  - Request payload explicitly grants workspace-context consent.
- Server-only environment configuration:
  - `OPENROAD_AI_PROVIDER=deterministic|openai`
  - `OPENROAD_OPENAI_API_KEY`
  - `OPENROAD_OPENAI_MODEL`
  - `OPENROAD_OPENAI_BASE_URL` for tests/private gateways only, validated as HTTPS except localhost/loopback and no embedded credentials.
  - `OPENROAD_AI_TIMEOUT_MS`
  - `OPENROAD_AI_MAX_OUTPUT_TOKENS`
- Code-managed assistant prompt builder with bounded structured context.
- Model responses may refine only the selected-request summary and next action in this foundation slice.
- Deterministic duplicate suggestions and changelog draft suggestions remain the source of truth for these advisory surfaces.
- Audit event for successful model-backed assistant use.
- Operational events for deterministic fallback, consent-required fallback, model success, model failure, invalid model output, and not-configured external requests.
- Operator documentation for configuration, privacy boundaries, smoke checks, and rollback.

## Not In Scope

- Browser UI opt-in controls for external model use.
- Persisted assistant suggestions.
- Background AI jobs.
- Embeddings, vector search, fine-tuning, eval service integration, or analytics.
- Model-generated changelog public copy.
- Model-generated duplicate merge decisions.
- Silent status, owner, roadmap, work item, notification, integration, or changelog mutations.
- Provider-specific GitHub/Jira/Linear prompt enrichment beyond the OpenRoad core fields already visible to the maintainer.
- Browser exposure of model provider names, API keys, request payloads, raw prompts, raw responses, or provider errors.

## Acceptance Criteria

- The endpoint returns a complete assistant triage bundle for a selected request in standalone mode with no integrations and no model configuration.
- The endpoint requires `POST`.
- The endpoint requires `workspace:read` for the requested workspace.
- A workspace member can request triage only for their own workspace.
- A public visitor cannot request private assistant triage.
- Unknown workspaces and unknown request ids return safe `404` errors.
- Invalid payloads return bounded safe `400` errors.
- With no external consent, the endpoint returns deterministic suggestions and does not call any external adapter.
- With provider configuration missing, an external request falls back deterministically and records not-configured operational evidence without leaking submitted data.
- With external consent and a configured OpenAI adapter, the server sends only bounded redacted prompt context to the provider.
- The provider API key, model configuration, base URL, raw prompt, and raw response are never returned to the browser.
- The OpenAI adapter uses `POST /v1/responses` with code-managed `instructions` and `input`.
- The OpenAI adapter parses `output_text` and nested `output` text items defensively.
- Empty, malformed, oversized, or non-JSON model outputs fall back to deterministic suggestions.
- Provider network failures, non-2xx responses, redirects, timeouts, and aborts fall back safely and record sanitized operational events.
- Model-backed output can only replace `summary.problem` and `summary.nextAction`; deterministic signal, state, duplicates, and changelog suggestions remain intact.
- All returned text is bounded before API output.
- Audit events record successful model-backed use without raw prompt or response text.
- Operational events are queryable through the existing private ops events API and remain sanitized.
- Existing deterministic browser assistant behavior remains unchanged.
- Existing public portal, notification, integration, access, backup/restore, release, and smoke checks still pass.
- `pnpm check` passes before merge.

## Automated Test Checklist

- Shared deterministic assistant module still passes existing summary, duplicate, and changelog tests.
- App-facing assistant re-export remains source-compatible for the current UI.
- Server deterministic adapter returns the same advisory shape as the current assistant helper.
- Prompt context builder includes selected request title/description/status/owner/visibility/source/tags/vote count/comment count/merged count with bounded lengths.
- Prompt context builder includes only bounded duplicate candidate metadata, not full raw workspace state.
- Prompt context builder includes bounded roadmap/work/changelog relationship signals only when linked to the selected request.
- Prompt context builder excludes internal comment bodies, hidden comment bodies, notification outbox bodies, private changelog notes, provider credential metadata, webhook payloads, and encrypted secrets.
- Prompt context builder redacts bearer tokens, authorization headers, passwords, API keys, secret-like strings, token query parameters, and raw email/requester identity when identity-sharing consent is absent.
- Prompt context builder records which context sections were included and how many redactions occurred.
- OpenAI config parser defaults to deterministic mode.
- OpenAI config parser rejects provider URLs with embedded credentials.
- OpenAI config parser rejects non-HTTPS provider URLs unless localhost or loopback.
- OpenAI config parser accepts localhost loopback URLs for automated tests.
- OpenAI config parser bounds timeout and max output token settings.
- OpenAI request body uses server configured model, code-managed instructions/input, bounded max output tokens, and does not include browser-supplied provider config.
- OpenAI request sets `store: false` when supported by the request shape.
- OpenAI client blocks redirects.
- OpenAI client aborts on timeout.
- OpenAI response parser reads SDK-style `output_text`.
- OpenAI response parser reads nested `output[].content[]` text.
- OpenAI response parser ignores tool-call-only output and returns an invalid-output failure.
- OpenAI response validator accepts concise JSON with `problem` and `nextAction`.
- OpenAI response validator rejects non-object JSON, missing fields, oversized fields, and unsafe strings after redaction.
- Model result merger updates only `summary.problem` and `summary.nextAction`.
- Model result merger preserves deterministic `summary.signal`, `summary.state`, duplicate suggestions, and changelog suggestion.
- Server endpoint rejects public access when an admin token is configured.
- Server endpoint permits a workspace viewer to triage a request in the same workspace.
- Server endpoint rejects cross-workspace member access.
- Server endpoint rejects `GET`, `PUT`, and unsupported methods.
- Server endpoint returns `404` for missing workspace.
- Server endpoint returns `404` for missing selected request.
- Server endpoint returns deterministic fallback when `allowExternalModel` is false.
- Server endpoint returns deterministic fallback when consent is missing.
- Server endpoint calls injected fake model adapter only when external use and consent are explicit.
- Server endpoint returns sanitized model metadata: provider family, external-used flag, fallback reason, included section counts, and redaction count only.
- Server endpoint does not return raw prompt text, raw provider response text, API key, model key, or provider failure text.
- Server endpoint records audit event for model-backed success.
- Server endpoint records operational event for deterministic fallback.
- Server endpoint records operational event for consent-required fallback.
- Server endpoint records operational event for provider not configured.
- Server endpoint records operational event for provider failure or invalid model output.
- Ops event filters by `workspaceId`, `category=ai`, and severity continue to work.
- Access contract test includes the new assistant route.
- Existing account/session/access tests still pass.
- Existing integration sync, provider write-back, conflict, notification, portal, backup/restore, and release tests still pass.

## Regression Checklist

- Existing local assistant panel still renders from deterministic helpers with no server dependency.
- Existing "Create private draft" assistant action remains explicit, private, draft-only, and generic in public wording.
- Public portal snapshots still do not contain assistant suggestions.
- Public portal writes still do not expose private comments, internal notes, or assistant metadata.
- Workspace read/write APIs still respect scoped membership.
- Integration credential APIs still never expose encrypted secrets or access tokens.
- Integration sync jobs still redact provider errors and metadata.
- Requester notification delivery still uses public-safe notification payloads only.
- Account invitation/recovery flows still never expose raw token hashes after one-time creation/confirmation flows.
- Backup/restore still includes team metadata and redacts sensitive operational metadata.
- Release candidate verification still records current schema and operational metadata correctly.
- Production build still compiles server output with the shared assistant module.

## Security And Privacy Checks

- No model provider call occurs from browser code.
- No API key, model name, base URL, raw prompt, raw response, or provider stack trace is exposed through API responses.
- No model provider call happens without explicit request-level consent.
- Prompt context is data-minimized and bounded before leaving the server.
- Internal and hidden comments are excluded from prompt context.
- Private changelog notes and notification outbox bodies are excluded from prompt context.
- Provider secrets, credential metadata, webhook signatures, and raw provider payloads are excluded from prompt context.
- Secret-shaped text is redacted before prompt send, API output, audit events, operational events, and logs.
- Provider URLs reject embedded credentials and unsafe schemes.
- Redirects are blocked for the model provider request.
- Timeout and payload-size limits are enforced.
- Model output is treated as untrusted and validated before merging into assistant results.
- Model-backed results remain advisory and cannot mutate source-of-truth state.

## UX And Accessibility Checks

- No new visible UI controls are introduced in this foundation slice.
- Existing assistant panel stays compact and deterministic by default.
- Future UI controls must keep consent language short and avoid adding a second command center inside the inspector.
- Existing assistant region labels and buttons remain accessible.
- If UI is touched unexpectedly, run browser QA and the design detector for touched files.

## Migration And Rollback

- No OpenRoad domain schema migration is expected.
- No team metadata schema migration is expected unless assistant audit metadata becomes durable beyond existing audit/ops event records.
- Rollback is a normal code rollback because assistant suggestions remain derived.
- Operators can disable external model use by unsetting `OPENROAD_AI_PROVIDER` or setting it to `deterministic`.
- If an external provider is misconfigured, OpenRoad must continue returning deterministic suggestions.

## Manual QA Checklist

- Run focused assistant/model adapter tests.
- Run focused server route/access tests.
- Run `pnpm build:server`.
- Run `pnpm check`.
- Run `pnpm release:verify`.
- Run built-server smoke with no AI env configured and confirm baseline smoke passes.
- Run a built-server assistant triage call with no AI env and confirm deterministic fallback.
- Run a built-server assistant triage call with a local fake model provider and explicit consent, then confirm sanitized model metadata and ops/audit evidence.
- Confirm public portal JSON does not include assistant prompt/model metadata.
- Confirm `/api/openroad/ops/events?workspaceId=acme&category=ai` is private and sanitized.

## Evidence

- Branch: `feat/model-adapter-foundation`
- Commit SHAs: `f9f169e` test plan; implementation commit pending.
- Acceptance criteria status: passed for the scoped model adapter foundation.
- Commands run:
  - `pnpm build:server` passed before focused test expansion.
  - `pnpm vitest run src\app\openroadAssistant.test.ts server\model-adapter.test.ts server\access.test.ts server\http.test.ts` passed 139 tests.
  - `pnpm vitest run src\app\openroadAssistant.test.ts server\model-adapter.test.ts server\access.test.ts server\http.test.ts scripts\openroad-ops.test.mjs` passed 149 tests.
  - `pnpm check` passed 35 test files / 464 tests plus production client and server builds.
  - `pnpm release:verify` passed before implementation commit; rerun after commit required for final manifest commit.
  - Built-server deterministic smoke passed on port `4265`: `health`, `contract`, `portal`, `private-denied`, `private-token`, `assistant-triage`.
  - Built-server fake OpenAI-compatible provider probe passed on port `4266`: one `/v1/responses` call, `store:false`, model summary merged, and sanitized `category=ai` operational event verified.
- Browser/viewports tested: not expected unless UI changes.
- Reviewer notes: The browser UI remains deterministic and unchanged. The server endpoint requires workspace read access, defaults to deterministic output, and calls an external adapter only with explicit request-level consent plus server-side provider configuration. Model output can update only `summary.problem` and `summary.nextAction`; duplicates and changelog suggestions remain deterministic and approval-only.
- Known unresolved risks: UI consent controls, per-workspace AI policy settings, hosted account-level AI controls, model evals, streaming, background AI jobs, embeddings, provider-specific prompt policies, and AI usage dashboards remain future slices.
