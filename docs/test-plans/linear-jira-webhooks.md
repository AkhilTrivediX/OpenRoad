# Feature Test Plan: Linear And Jira Webhooks

Branch: `feat/linear-jira-webhooks`

## Objective

Make Linear and Jira linked-issue updates arrive through provider webhooks without requiring manual sync, while preserving OpenRoad as the source-of-truth for requests, keeping provider credentials server-only, and treating webhook payloads as untrusted external input.

## User Story

As a workspace owner with Linear or Jira connected, I want OpenRoad to refresh already-linked requests when the provider sends issue update webhooks, so request status and delivery context stay current without manual refresh. As an operator, I need webhook routes that are signed or secret-protected, idempotent, bounded, redacted, auditable, and safe to disable when provider webhook secrets are not configured.

## Scope

- Public webhook receiver routes for Linear and Jira.
- Provider-specific webhook signature or shared-secret verification using server-only environment variables.
- Event normalization that accepts issue update events for already-linked Linear/Jira issue mappings.
- Reuse of existing Linear/Jira mapping and sync worker logic for linked issue refresh.
- Idempotency by provider delivery/event id where available.
- Sanitized webhook event persistence in integration metadata.
- Safe ignored/duplicate/error responses that do not leak webhook secrets, provider tokens, authorization headers, raw provider payloads, or internal file paths.
- Documentation for setup, API contract, runbook, and rollback.

## Not In Scope

- Creating new OpenRoad requests from arbitrary webhook issue payloads.
- Provider write-back.
- Conflict resolution UI.
- Hosted OAuth callback exchange.
- Linear/Jira webhook registration automation inside the browser.
- External queue infrastructure or distributed locks.
- Jira Connect/Forge app packaging.

## Acceptance Criteria

- Linear and Jira webhook routes are disabled with safe `503 not_configured` responses until their server-side webhook secrets are configured.
- Valid signed/secret-protected issue update webhooks for active installations can refresh already-linked OpenRoad requests through existing provider mappers.
- Unknown installation, workspace, issue, or mapping events are accepted or ignored safely without creating OpenRoad objects.
- Duplicate delivery/event ids are idempotent and do not apply repeated state changes.
- Disconnected or suspended installations do not apply webhook updates.
- Webhook handling preserves OpenRoad requests, comments, votes, roadmap items, changelog entries, and portal data unrelated to the mapped external issue.
- Webhook responses and persisted sync events never include raw provider payloads, provider tokens, encrypted credentials, authorization headers, webhook secrets, session tokens, admin tokens, or private keys.
- Existing GitHub webhook behavior remains unchanged.
- Manual sync and private runner behavior remains unchanged.
- `pnpm check`, built-server smoke, release verification, and feature evidence pass before merge.

## Automated Test Checklist

- Route access contract lists Linear and Jira webhook routes as public provider callbacks with explicit signature/secret verification inside handlers.
- Linear webhook route rejects missing/invalid signature or secret.
- Jira webhook route rejects missing/invalid signature or secret.
- Linear/Jira webhook routes return `503 not_configured` when secrets are absent.
- Valid Linear issue update webhook refreshes an existing active Linear mapping and records sanitized sync event metadata.
- Valid Jira issue update webhook refreshes an existing active Jira mapping and records sanitized sync event metadata.
- Unknown installation or issue mapping is ignored without creating OpenRoad requests.
- Duplicate delivery/event id returns a duplicate/noop response and does not apply twice.
- Disconnected installation webhook does not update OpenRoad request data.
- Provider payload validation bounds titles, descriptions, URLs, issue keys, identifiers, timestamps, and enum-like state fields.
- Webhook error paths redact token/secret/header-shaped strings.
- GitHub webhook tests remain green.
- Linear/Jira import/link tests remain green.
- Background sync worker tests remain green.
- Settings provider connect/disconnect tests remain green.

## Security And Privacy Checks

- Webhook secrets are read only from server environment variables.
- Browser code never sees or asks for webhook secrets.
- Webhook verification uses raw request bytes when required by the provider signature scheme.
- Signature comparison uses timing-safe comparison when fixed-length signatures are available.
- Replay/idempotency keys are scoped by provider and delivery/event id.
- Raw payloads are not persisted.
- Public webhook routes must not grant workspace read/write access outside the verified provider event path.
- Responses are bounded and generic enough for public callback endpoints.

## UX And Operator Checks

- Settings may show webhook capability when active provider metadata supports it, but no new primary navigation is added.
- Operator docs explain required environment variables, provider-side callback URL, failure modes, and rollback.
- Standalone mode remains unchanged when webhook secrets are not configured.

## Manual QA Checklist

- Start built server without Linear/Jira webhook secrets and confirm webhook routes return safe not-configured responses.
- Start built server with fake Linear/Jira webhook secrets, seed active installation plus mapping, send valid webhook, and confirm mapped OpenRoad request refreshes.
- Send duplicate webhook delivery id and confirm idempotent response.
- Disconnect installation, resend webhook, and confirm no OpenRoad request mutation.
- Confirm API responses and integration metadata do not contain raw webhook payloads or secrets.
- Run focused webhook tests.
- Run `pnpm check`.
- Run built-server smoke.
- Run `pnpm release:verify`.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch. Existing integration metadata schema `3` remains compatible because webhook events use existing sync-event/job shapes. If webhook deliveries were processed unexpectedly, restore a pre-webhook `OPENROAD_DATA_FILE` and `OPENROAD_INTEGRATION_FILE` backup.

## Evidence

- Branch: `feat/linear-jira-webhooks`
- Implementation commit SHA: `18df80748d058b6730da8d386e3cd8fa047ce6c1`
- Date: 2026-07-10
- Commands run:
  - `pnpm vitest run server/access.test.ts`
  - `pnpm exec tsc --noEmit`
  - `pnpm vitest run server/http.test.ts`
  - `pnpm vitest run server/http.test.ts server/access.test.ts`
  - `pnpm check` (401 tests passed, client build passed, server build passed)
  - `pnpm release:verify` (dry-run manifest passed)
- Browser/viewports tested: Not required for this server/API slice; no UI layout or browser interaction code changed.
- Reviewer notes: Linear and Jira webhook routes now require server-only secrets, verify raw-body HMAC signatures before JSON mutation, dedupe delivery ids, update only already-linked issue mappings for active installations with `webhook:receive`, and persist sanitized sync events without raw provider payloads. Jira issue ids remain scoped through the existing installation/site mapping before request updates. Manual Jira installation/import permissions now preserve `webhook:receive` while still rejecting unsupported write-back capability.
- Known unresolved risks: Provider write-back, hosted OAuth callback exchange, conflict UI, registration automation, distributed locks, and external queue infrastructure remain later production slices.
- Rollback notes: Unset `OPENROAD_LINEAR_WEBHOOK_SECRET` and `OPENROAD_JIRA_WEBHOOK_SECRET` or remove provider webhook callback URLs to stop new deliveries. Revert this branch if handler behavior must be removed. No schema migration was added; restore `OPENROAD_DATA_FILE`, `OPENROAD_INTEGRATION_FILE`, and `OPENROAD_TEAM_FILE` from the latest pre-webhook backup if processed webhooks caused bad linked-request state.
