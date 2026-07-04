# OpenRoad GitHub App Installation

OpenRoad now has a server-only GitHub App installation foundation and live issue fetch path. It does not run background sync yet; it prepares the safe connection path that webhook and recurring sync work will use.

Official GitHub references used for this slice:

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
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

Events planned for later webhook work:

- Issues
- Pull request

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

## Deferred Work

- Browser Settings UI for connect/disconnect.
- Setup callback page that carries workspace context from GitHub back into OpenRoad.
- Webhook endpoint with signature verification.
- Background sync jobs and conflict handling.
