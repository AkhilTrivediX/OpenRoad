# Feature Test Plan: Hosted Webhook Registration

Branch: `feat/hosted-webhook-registration`

## Objective

Add production-safe hosted webhook registration automation so OpenRoad can configure supported provider webhook delivery from server-side settings, track registration state durably, and keep manual/self-host webhook setup working without exposing secrets to the browser.

## User Story

As a workspace owner or hosted OpenRoad operator, I need OpenRoad to register and track provider webhooks from trusted server configuration, so linked GitHub, Linear, and Jira issue sync can move toward hosted automation without asking users to copy secrets into the browser or creating provider callbacks OpenRoad cannot verify.

## Current Provider Facts Reviewed

- GitHub App webhook configuration can be read and updated through GitHub's REST API using a GitHub App JWT. The update body accepts the webhook URL, `json` content type, shared secret, and SSL verification mode.
- Linear can create webhooks through the `webhookCreate` GraphQL mutation for a team or all public teams, but the public docs describe the signing secret as a webhook detail value, not as a caller-supplied mutation field.
- Jira Cloud supports dynamic webhook registration for Connect and OAuth 2.0 apps, but the official REST API registration shape is based on URL plus JQL/event filters and does not match OpenRoad's current HMAC-secret verification contract.

References:

- GitHub REST API endpoints for GitHub App webhooks: https://docs.github.com/en/rest/apps/webhooks
- Linear Webhooks developer docs: https://linear.app/developers/webhooks
- Jira Cloud REST API v3 webhooks: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-webhooks/

## Scope

- Add provider-neutral webhook registration metadata to integration storage.
- Add a workspace-scoped registration API:
  - `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/webhooks/register`
- Add sanitized registration status to `GET /api/openroad/workspaces/:workspaceId/integrations/status`.
- Add compact Settings controls/status for webhook registration only where the server reports a safe registration capability.
- Implement GitHub App webhook configuration execution with server-only GitHub App credentials:
  - URL: `${publicBaseUrl}/api/openroad/integrations/github/webhook`
  - content type: `json`
  - secret: `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`
  - SSL verification: enabled
- Record Linear and Jira registration attempts as blocked/not-supported unless OpenRoad can prove a server-known signing secret will verify future deliveries.
- Record sanitized sync/audit events for registration success, blocked registration, and safe provider failures.
- Update operator docs, readiness docs, and API/auth contracts.

## Not In Scope

- Creating Linear or Jira provider webhooks that OpenRoad cannot verify with the currently configured webhook secret.
- Asking browser users to paste webhook secrets, provider private keys, provider tokens, admin tokens, or raw provider webhook payloads.
- Automatically creating new OpenRoad requests from provider webhook deliveries.
- External queue infrastructure, distributed locks, hosted SaaS provisioning, billing, or provider notification delivery.
- Full webhook delivery observability dashboards.

## Acceptance Criteria

- Integration metadata schema migration initializes `webhookRegistrations: []` for older schema versions and preserves existing credentials, mappings, sync jobs, and sync events.
- Webhook registration records store only safe metadata: id, workspace id, provider, installation id, target URL, event/resource names, external webhook id when known, status, attempts, timestamps, expiry when applicable, and redacted error text.
- Webhook registration records never store provider tokens, refresh tokens, private keys, raw webhook secrets, ciphertext internals, authorization headers, raw provider responses, request headers, or request bodies.
- The registration endpoint requires `integration:manage`, rejects unsupported providers, wrong workspaces, disconnected/suspended installations, missing public base URL, missing webhook secret, missing provider credentials, unsafe URLs, and oversized payloads with bounded errors.
- The browser payload never accepts webhook URL, secret, provider authorization, raw provider config, or callback URL override.
- GitHub registration updates the GitHub App webhook config using a JWT and records a durable active registration without exposing the webhook secret or private key.
- GitHub registration is idempotent for the same provider/workspace/installation/target URL and updates the existing registration record instead of creating duplicates.
- GitHub upstream failures are sanitized, persisted as failed registration metadata, and do not mutate OpenRoad workspace state.
- Linear/Jira registration attempts either execute only when OpenRoad can verify future deliveries with a server-known secret, or return a blocked/not-supported result that explains the safe next step without making provider API calls.
- Existing signed GitHub/Linear/Jira webhook ingestion remains green.
- Existing provider status, connect/disconnect, credential, manual sync, write-back, conflict resolution, OAuth refresh, backup/restore, release, and standalone app flows remain green.
- Settings stays uncluttered: standalone and unsupported providers do not show confusing webhook automation controls.

## Automated Test Checklist

- Storage/parser tests:
  - Schema `3` integration metadata migrates to the new schema with `webhookRegistrations: []`.
  - Future schemas are rejected as before.
  - Invalid webhook registration records recover or reject consistently with integration metadata rules.
  - Sanitization strips or rejects token-shaped text, secrets, ciphertext internals, authorization headers, and raw provider payload fragments from registration records.
- GitHub client tests:
  - GitHub App webhook config update sends `PATCH /app/hook/config` with JWT auth, `content_type: "json"`, `insecure_ssl: "0"`, the expected public URL, and server-only secret.
  - Provider failures and invalid responses become bounded sanitized errors.
  - No private key, JWT, installation token, or webhook secret appears in thrown messages.
- Server/API tests:
  - `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/webhooks/register` requires `integration:manage`.
  - Owner can register GitHub webhook config for an active installation with `webhook:receive`.
  - Contributor/viewer/public/integration actors cannot register webhooks.
  - Wrong workspace, wrong provider, disconnected installation, missing integration store, missing public base URL, missing GitHub App config, and missing webhook secret are rejected without metadata mutation.
  - GitHub registration records an active sanitized registration, sync event, and audit event.
  - Repeated GitHub registration is idempotent and updates attempt timestamps without duplicate active records.
  - GitHub upstream failure records a failed sanitized registration and returns a safe error.
  - Linear/Jira registration is blocked/not-supported unless safe verification prerequisites are proven, and no provider call is made in blocked mode.
  - Existing webhook ingestion tests still verify signatures before JSON mutation and still process linked issue deliveries idempotently.
- Client/parser tests:
  - Integration status parser preserves sanitized registration status/capabilities.
  - Registration helper posts only provider/installation identity, not URL/secret/token/config.
  - Redaction covers registration failure messages.
- UI tests:
  - Settings shows no hosted webhook registration control in standalone mode.
  - Settings shows a compact registration action/status only when the server reports registration capability.
  - The action calls the registration API, refreshes integration status, and renders success/blocked/failure as short safe messages.
  - The rendered UI never contains webhook secrets, provider tokens, JWTs, private keys, encrypted payload internals, raw provider responses, or authorization headers.
- Regression gates:
  - Existing Settings provider connect/disconnect/manual sync/write-back/conflict tests remain green.
  - Existing signed GitHub/Linear/Jira webhook tests remain green.
  - `pnpm check`, `pnpm release:verify`, built-server smoke, and GitHub Actions pass before merge.

## Security And Privacy Checks

- Server derives the webhook target URL from trusted public-base configuration only.
- Server derives webhook secrets from server-only environment/config only.
- Browser requests cannot override URL, secret, events, SSL mode, or provider authorization.
- Provider API errors are redacted before API output, persistence, audit, or sync events.
- Registration metadata is safe to show in Settings and safe to include in backup manifests as operational metadata.
- Rollback does not require deleting OpenRoad product data.

## Manual QA Checklist

- Start a built server with `OPENROAD_PUBLIC_APP_URL`, GitHub App config, and `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`; trigger GitHub webhook registration from Settings; confirm the fake GitHub API receives the app webhook config update.
- Repeat with missing public URL and missing webhook secret; confirm Settings shows a short safe blocked message.
- Confirm standalone mode and providers without safe capability show no extra cognitive load.
- Confirm `pnpm ops:smoke` passes against `server-dist`.

## Migration And Rollback

- Integration metadata schema moved from `3` to `4`; older schema versions are migrated by initializing `webhookRegistrations: []` while preserving existing credentials, mappings, sync jobs, and sync events.
- Rollback: revert the implementation and evidence commits, then restore the previous build. If rolling back to a schema `3` build, restore a pre-schema-4 integration backup or remove `webhookRegistrations` from persisted integration metadata before downgrade. If a GitHub App webhook config was updated externally before rollback, reset the GitHub App webhook URL/secret in GitHub App settings or by re-running the previous deployment's webhook configuration.

## Evidence

- Branch: `feat/hosted-webhook-registration`
- Implementation commit SHA: `d0a0d7824856709781ea90df7d6334d7fcd74764`.
- Date: 2026-07-10.
- Commands run:
  - `pnpm build:server`
  - `pnpm build:client`
  - `pnpm vitest run src\persistence\openroadIntegrations.test.ts src\App.test.tsx`
  - `pnpm vitest run server\integrations.test.ts server\access.test.ts`
  - `pnpm vitest run scripts\openroad-ops.test.mjs`
  - `pnpm vitest run server\http.test.ts`
  - `pnpm check`
  - `pnpm release:verify`
  - `pnpm ops:smoke -- --base-url http://127.0.0.1:4238 --workspace-id acme --admin-token smoke-secret` against the built `server-dist` server.
- Acceptance criteria status: Passed for the scoped GitHub hosted registration capability and safe Linear/Jira blocked-state handling.
- Browser/viewports tested:
  - Desktop Chrome 1280x720 against the built server with seeded GitHub installation and GitHub App env; Settings rendered `Register webhook` and the DOM did not contain `github-hook-secret` or `raw-secret`.
  - Mobile Chrome 390x844 against the built server with the same seeded state; Settings rendered `Register webhook`, the DOM did not contain `github-hook-secret` or `raw-secret`, and the compact header actions stayed inside the viewport.
- Accessibility checks:
  - The hosted GitHub action exposes `aria-label="GitHub register webhook delivery"`.
  - Registration status is rendered as text plus badge state, not color alone.
  - The action uses the existing button/focus system.
  - React tests query the action by role and accessible name.
- Reviewer notes:
  - GitHub is the only provider with executable hosted registration in this slice.
  - Linear and Jira return a safe blocked registration because current provider-created webhook registration cannot guarantee a server-known signing secret for OpenRoad's verifier.
  - Browser requests post only the installation identity; URL, secret, events, SSL mode, provider authorization, and callback overrides are derived server-side or rejected.
  - Integration metadata schema `4` is an automatic migration from schema `1`, `2`, and `3`.
- Rollback notes:
  - Revert `d0a0d7824856709781ea90df7d6334d7fcd74764` and this evidence commit.
  - Restore a pre-schema-4 integration backup before downgrading to a schema-3 build, or remove `webhookRegistrations` from persisted metadata.
  - Reset GitHub App webhook config in GitHub settings if the hosted registration was executed against a real app before rollback.
