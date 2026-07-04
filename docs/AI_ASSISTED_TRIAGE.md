# AI-Assisted Triage

OpenRoad's first assistant slice is deterministic, local-only, and review-first. It helps maintainers understand a selected request without making OpenRoad dependent on an external AI service.

## What It Does

- Summarizes the selected request into problem, signal, current state, and next action.
- Suggests likely duplicates with compact explanations.
- Suggests a private changelog draft from the selected request plus linked completed work or roadmap context.
- Keeps every suggestion inspectable in the selected request inspector.
- Lets the maintainer pause assistant suggestions for the current browser session.

## Production Boundary

- Suggestions are derived in memory from the current workspace.
- No assistant suggestions are persisted to the OpenRoad state schema.
- No external network calls, model clients, API keys, prompt logs, embeddings, telemetry, or analytics are used in this slice.
- Public portal projections do not include assistant suggestions.
- Provider payloads, private notes, internal comments, notification bodies, and integration secrets are not included in generated public wording.
- Changelog suggestion titles and public wording stay generic until a maintainer writes approved copy.
- Source request, work, and roadmap descriptions are not copied into changelog public fields.

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

## Future Model-Backed Slice

Real model-backed assistance is intentionally deferred. Before adding it, OpenRoad needs:

- Explicit user and workspace consent.
- Server-side prompt redaction.
- Provider policy review for GitHub, Jira, Linear, and support data.
- AI audit logs for suggestions that influence source-of-truth changes.
- Clear settings for disabling AI per workspace.
- Tests proving public/private boundaries and secret handling.
