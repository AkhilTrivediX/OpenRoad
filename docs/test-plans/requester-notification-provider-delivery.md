# Feature Test Plan: Requester Notification Provider Delivery

Branch: `feat/requester-notification-provider-delivery`

## Objective

Add a production-safe HTTP provider delivery adapter for requester notifications so OpenRoad can hand queued notification events directly to an operator-controlled mail/helpdesk/webhook provider without exposing secrets to the browser or weakening the existing JSONL/self-host path.

## User Story

As an OpenRoad operator, I can configure a trusted HTTPS notification provider endpoint and optional bearer token, run the existing private notification delivery endpoint, and have queued requester notifications delivered as bounded public-safe provider payloads with retryable, redacted failure metadata.

## Scope

- HTTP notification delivery adapter behind `OPENROAD_NOTIFICATION_DELIVERY_MODE=http`.
- `OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL`, `OPENROAD_NOTIFICATION_DELIVERY_HTTP_BEARER_TOKEN`, and `OPENROAD_NOTIFICATION_DELIVERY_HTTP_TIMEOUT_MS` configuration.
- HTTPS-only provider URL validation with localhost and loopback exceptions for local development/tests.
- Redirect blocking so notification payloads and bearer auth are not resent to another host.
- Bounded provider response parsing for `messageId`, `message_id`, `id`, and `x-message-id`.
- Redaction of provider response text, provider message ids, URLs, bearer tokens, authorization text, and secret-shaped values before persistence or API output.
- Notification provider payload that includes only public-safe notification fields already present in queued events plus workspace context.
- Tests for adapter construction, successful provider delivery, disabled/invalid config, secret redaction, non-JSON success responses, oversized provider errors, redirects, timeouts, endpoint auth, and no duplicate delivery.
- Operator documentation, readiness notes, and release/rollback evidence updates.

## Not In Scope

- Built-in SMTP, SES, Postmark, SendGrid, Slack, Discord, SMS, or web-push clients.
- Provider-specific templates, unsubscribe routing, bounce/suppression handling, notification analytics, or delivery scheduler packaging.
- Browser Settings UI for notification provider configuration.
- Public requester identity verification or public account management.
- Multi-process/distributed delivery locking beyond the existing single-process exclusive runner.

## Acceptance Criteria

- File delivery mode remains unchanged and still passes existing delivery tests.
- HTTP mode is disabled unless a safe provider URL is configured.
- HTTP mode rejects non-HTTPS provider URLs except localhost, `127.0.0.1`, and `::1`; URLs with embedded credentials are rejected.
- The outbound provider request uses `POST`, `Content-Type: application/json`, `Accept: application/json`, `redirect: "error"`, a bounded timeout, and optional server-only bearer authorization.
- Provider payloads include notification id, type, title, body, requester, request id/title, optional changelog id/title, creation time, dedupe key, workspace id/name, channel, and delivery time.
- Provider payloads do not include admin tokens, session secrets, provider bearer tokens, integration credentials, private workspace state, notification preferences, audit events, request comments, private changelog notes, raw provider responses, or delivery internals beyond the event summary.
- Successful provider responses mark events delivered with bounded sanitized message ids.
- Non-2xx provider responses, malformed success bodies, redirects, timeouts, aborts, and network errors leave events queued for retry with bounded sanitized `deliveryError`.
- Re-running delivery does not resend already delivered events.
- The private `/api/openroad/notifications/deliver` endpoint keeps its existing `state:write` permission boundary and structured `503 not_configured` behavior.
- Public portal and workspace APIs still do not expose notification delivery internals.
- Existing notification queueing, quiet-window dedupe, JSONL delivery, invitation/recovery delivery, provider integrations, backup/restore, smoke, release, and app tests remain green.

## Automated Test Checklist

- `createNotificationDeliveryAdapterFromEnv` returns `HttpNotificationDeliveryAdapter` for valid HTTP mode and rejects disabled, invalid, credentialed, and non-local insecure URLs.
- HTTP adapter posts one bounded notification payload with optional bearer auth and no secret/persistence-only fields.
- HTTP adapter reads provider message ids from JSON body and `x-message-id`.
- Provider message ids are redacted when they contain bearer text, token URLs, password text, authorization text, or secret-shaped values.
- Provider failures are redacted before the delivery processor can persist them.
- Redirect responses are blocked and do not call the redirect target.
- Hanging provider requests time out with a safe error.
- Non-JSON success responses fail safely.
- Oversized provider error bodies are bounded.
- Delivery endpoint with HTTP adapter marks a queued event delivered and stores `deliveryChannel: "http-provider"` without persisting the provider bearer token.
- Delivery endpoint with HTTP adapter leaves provider failures queued and safe to retry.
- Existing JSONL delivery, notification domain, server auth, public portal, ops, and release tests still pass.

## Regression Checklist

- File mode appends the same JSONL record shape as before.
- Disabled notification delivery still returns `503 not_configured`.
- Status/changelog notification queueing still creates public-safe bodies.
- Quiet-window dedupe still prevents repeated queue entries.
- Public portal snapshots still exclude notification settings, outbox, and delivery metadata.
- Backup/restore keeps state schema `7` compatible; no new OpenRoad state schema migration is required.
- No client bundle receives provider delivery URLs or bearer tokens.

## Security And Privacy Checks

- Provider endpoint and bearer token are server-only environment values.
- Browser requests cannot submit provider URLs, provider tokens, notification secrets, or delivery channel overrides.
- HTTP adapter must not follow redirects.
- Provider response bodies are bounded before parsing and redaction.
- Provider failures are redacted before persistence, API output, audit records, or logs.
- Payload fields are public-safe notification summaries, not full requests, full changelogs, workspace exports, credentials, or audit logs.
- Rollback does not require deleting OpenRoad product data.

## Manual QA Checklist

- Run focused notification delivery tests.
- Run focused HTTP endpoint tests for successful provider delivery and failed provider retry.
- Run `pnpm check`.
- Start the built server with temporary OpenRoad state, admin token, and local HTTP notification provider.
- Queue a notification, call `/api/openroad/notifications/deliver`, confirm one provider call and delivered status.
- Re-run delivery and confirm the provider does not receive a duplicate call.
- Run `pnpm release:verify` and built-server smoke.

## Migration And Rollback

- No OpenRoad state schema migration is planned; notification delivery metadata already exists in schema `7`.
- Rollback: unset `OPENROAD_NOTIFICATION_DELIVERY_MODE=http` to stop direct provider calls immediately, or revert this branch. Already delivered events remain delivered in schema `7`; restore a pre-delivery backup if an operator needs to replay them.

## Evidence

- Branch: `feat/requester-notification-provider-delivery`
- Implementation commit SHA: Pending.
- Date: 2026-07-10.
- Commands run: Pending.
- Acceptance criteria status: Pending.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending.
- Rollback notes: Pending final implementation details.
