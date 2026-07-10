# AI-Assisted Triage

OpenRoad's first assistant slice is deterministic, local-first, and review-first. It helps maintainers understand a selected request without making OpenRoad dependent on an external AI service.

## What It Does

- Summarizes the selected request into problem, signal, current state, and next action.
- Suggests likely duplicates with compact explanations.
- Suggests a private changelog draft from the selected request plus linked completed work or roadmap context.
- Keeps every suggestion inspectable in the selected request inspector.
- Lets the maintainer pause assistant suggestions for the current browser session.
- Exposes a private server-side assistant triage endpoint for production deployments.

## Production Boundary

- Suggestions are derived in memory from the current workspace.
- No assistant suggestions are persisted to the OpenRoad state schema.
- The browser assistant panel remains deterministic by default.
- Public portal projections do not include assistant suggestions.
- Provider payloads, private notes, internal comments, notification bodies, and integration secrets are not included in generated public wording.
- Changelog suggestion titles and public wording stay generic until a maintainer writes approved copy.
- Source request, work, and roadmap descriptions are not copied into changelog public fields.
- External model calls can happen only through the server-side adapter and only when explicitly requested with context-sharing consent.
- Model provider API keys, model names, base URLs, raw prompts, raw responses, and provider errors are never returned to browser responses.

## Human Approval Rule

The assistant can propose text, but it does not silently mutate source-of-truth data.

The only write path in this slice is `Create private draft`, which creates a normal editable changelog item with:

- `Draft` state.
- `Private` visibility.
- Generic public title and wording.
- Explicit links back to the selected request.

Status, owner, duplicate relation, requester preferences, notification outbox, public portal content, roadmap state, and source mappings are unchanged unless an existing OpenRoad action is used separately by the maintainer.

## Duplicate Suggestion Rules

Duplicate suggestions exclude:

- The selected request.
- Archived requests.
- Requests already merged into the selected request.

Suggestions are scored from title and description token overlap, shared tags, same requester or source, and matching status. The output is bounded to a small number of stable cards so tests and UI behavior remain predictable.

A candidate needs a real text signal or multiple non-text signals. A single broad shared tag is not enough to surface a duplicate suggestion.

## Server Model Adapter

`POST /api/openroad/workspaces/:workspaceId/assistant/triage` returns the same advisory triage bundle through a private workspace-scoped API. It requires `workspace:read` and accepts:

- `requestId`
- `allowExternalModel`
- `consent.shareWorkspaceContext`
- `consent.shareRequesterIdentity`

If `allowExternalModel` is absent or false, OpenRoad returns deterministic suggestions. If external use is requested but consent or provider configuration is missing, OpenRoad still returns deterministic suggestions and records sanitized operational evidence.

When `OPENROAD_AI_PROVIDER=openai`, `OPENROAD_OPENAI_API_KEY`, and `OPENROAD_OPENAI_MODEL` are configured, the server can call the OpenAI Responses API after explicit consent. The code-managed prompt includes bounded selected-request context, duplicate metadata, and linked roadmap/work/changelog relationship signals. It excludes internal and hidden comment bodies, notification outbox bodies, private changelog notes, provider credential material, webhook payloads, and secret-shaped text.

In this foundation slice, model-backed output may refine only `summary.problem` and `summary.nextAction`. Deterministic signal/state, duplicate suggestions, and changelog draft suggestions remain unchanged.

## Remaining Model Work

Future AI slices still need UI consent controls, per-workspace AI policy settings, hosted account-level AI controls, provider-specific policy review for GitHub/Jira/Linear/support data, model evals, usage dashboards, and optional background jobs.
