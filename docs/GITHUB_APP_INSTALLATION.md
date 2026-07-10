# OpenRoad GitHub App Installation

OpenRoad now has a server-only GitHub App installation foundation, live issue fetch path, signed webhook ingestion, safe disconnect handling, encrypted provider credential storage primitives, and a private background sync worker for already-linked GitHub issues.

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

## Hosted Webhook Registration

`POST /api/openroad/workspaces/:workspaceId/integrations/github/webhooks/register`

The endpoint requires `integration:manage`, a verified active installation with `webhook:receive`, GitHub App credentials, `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`, and either `OPENROAD_PUBLIC_APP_URL` or `OPENROAD_WEBHOOK_PUBLIC_BASE_URL`.

OpenRoad updates the GitHub App webhook configuration server-side with JSON content type, SSL verification enabled, the derived public callback URL, and the server-only webhook secret. Browser requests submit only an installation id. Responses and stored registration metadata never include the webhook secret, private key, JWT, installation token, authorization headers, raw provider responses, request bodies, or request headers.

Repeated registration for the same provider/workspace/installation/target URL updates the same registration record and increments the attempt count.

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

The private runner is `POST /api/openroad/integrations/sync/run`. When GitHub App credentials are configured, the production server auto-wires a GitHub sync worker that refreshes already-linked GitHub issue mappings by targeted issue number. It does not import unmapped repository issues.

Browser Settings can now display sanitized GitHub connection/sync status and run manual linked-issue sync when a connected installation and worker are available. It does not expose installation tokens, App private keys, webhook secrets, or raw GitHub payloads.

## Provider Write-Back

`POST /api/openroad/workspaces/:workspaceId/integrations/github/write-back`

GitHub write-back is explicit and request-scoped. It updates only the linked issue title/body through the GitHub App installation token after the stored installation has `write:external`. See [Provider write-back](PROVIDER_WRITE_BACK.md).

## Deferred Work

- Setup callback page that carries workspace context from GitHub back into OpenRoad.
- Expanded sync/log observability beyond the compact Settings status surface.
