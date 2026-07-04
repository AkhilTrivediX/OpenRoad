# OpenRoad GitHub App Installation

OpenRoad now has a server-only GitHub App installation foundation, live issue fetch path, signed webhook ingestion, safe disconnect handling, and encrypted provider credential storage primitives. It does not run background polling yet; webhooks update already-linked issues and installation state.

Official GitHub references used for this slice:

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Using webhooks with GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps)
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)

## Environment

```powershell
$env:OPENROAD_GITHUB_APP_SLUG="openroad"
$env:OPENROAD_GITHUB_APP_ID="12345"
$env:OPENROAD_GITHUB_APP_CLIENT_ID="Iv1..."
$env:OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE="C:\openroad\github-app.private-key.pem"
$env:OPENROAD_GITHUB_APP_WEBHOOK_SECRET="replace-with-long-random-secret"
```

`OPENROAD_GITHUB_APP_PRIVATE_KEY` is also supported for container secret injection, but a private key file is preferred for self-host operators.

Do not expose these values to browser JavaScript, public logs, audit events, or support bundles.

## Required GitHub App Settings

Permissions:

- Issues: read
- Pull requests: read

Webhook URL:

`POST /api/openroad/integrations/github/webhook`

Events:

- Issues
- Installation
- Pull request, for later pull request sync

Setup URL should point to the future OpenRoad settings callback page. The current server API exposes setup details at:

`GET /api/openroad/workspaces/:workspaceId/integrations/github/app/setup`

## Verification Endpoint

`POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/verify`

Payload:

```json
{
  "installationId": "98765"
}
```

The endpoint requires `integration:manage`, which is limited to local owners/admins and workspace owners. It uses the server-side GitHub App client boundary to verify installation metadata, then stores a GitHub integration installation in `OPENROAD_INTEGRATION_FILE`.

The endpoint does not persist installation access tokens. GitHub installation tokens are intentionally deferred until live issue fetch, where they must be generated server-side, used briefly, and allowed to expire.

The same GitHub installation id can be verified into more than one OpenRoad workspace without overwriting another workspace's integration metadata.

## Live Issue Fetch Endpoint

`GET /api/openroad/workspaces/:workspaceId/integrations/github/issues/live?installationId=98765&repository=AkhilTrivediX/OpenRoad`

The endpoint requires workspace write permission or a scoped integration actor. It requires a verified active installation in the same OpenRoad workspace, generates a short-lived GitHub installation access token server-side, fetches `/repos/{owner}/{repo}/issues`, filters pull requests, and returns normalized issue previews.

Installation tokens are never persisted, audited, or returned. Returned issue previews include an `importPayload` that can be sent to the existing payload-backed import endpoint.

## Webhook Endpoint

`POST /api/openroad/integrations/github/webhook`

The endpoint requires `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`. It verifies the raw request body with the `X-Hub-Signature-256` header and HMAC-SHA256 before parsing JSON or mutating state. Legacy SHA-1 signatures are not accepted.

Handled events:

- `issues`: updates already-linked OpenRoad requests through the existing GitHub issue sync mapper. Unmapped issues are accepted as logged no-ops and do not create requests.
- `installation` with `deleted`: marks matching installations and mappings disconnected without deleting OpenRoad requests.
- `installation` with `suspend` or `unsuspend`: updates matching installation status.

Webhook delivery IDs are stored as sanitized `syncEvents` in `OPENROAD_INTEGRATION_FILE` for idempotency and hidden operational visibility. The event log stores delivery id, event name, provider, result, summary, workspace id, and installation id only; raw payloads, signatures, headers, tokens, and secrets are not stored.

## Disconnect Endpoint

`POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect`

The endpoint requires `integration:manage`, marks the installation and all active mappings in that workspace as `disconnected`, records an audit event, and preserves all OpenRoad requests.

Matching active provider credentials are revoked and have encrypted secret material removed from their credential records.

## Provider Credentials

Credential storage is managed through the provider-neutral routes:

- `GET /api/openroad/workspaces/:workspaceId/integrations/github/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/credentials/:credentialId/revoke`

These routes require `integration:manage` and `OPENROAD_TOKEN_ENCRYPTION_KEY`. Responses return only credential metadata. GitHub installation access tokens generated for live issue fetch remain short-lived and are still not persisted.

## Background Sync Jobs

Provider-neutral sync jobs can be queued at:

`POST /api/openroad/workspaces/:workspaceId/integrations/github/sync/jobs`

The private runner is `POST /api/openroad/integrations/sync/run`. It is disabled until a future GitHub sync worker adapter is configured.

## Deferred Work

- Browser Settings UI for connect/disconnect and sync logs.
- Setup callback page that carries workspace context from GitHub back into OpenRoad.
- Live background sync worker and conflict handling.
