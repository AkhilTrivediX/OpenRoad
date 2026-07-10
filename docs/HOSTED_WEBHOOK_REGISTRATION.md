# Hosted Webhook Registration

OpenRoad can now register hosted webhook delivery metadata from server-side configuration without asking browser users to handle provider secrets.

## Route

`POST /api/openroad/workspaces/:workspaceId/integrations/:provider/webhooks/register`

The route requires `integration:manage`, so only the local owner/admin or a workspace owner can use it. The browser sends only:

```json
{ "installationId": "github-install" }
```

The browser cannot submit callback URLs, webhook secrets, provider tokens, SSL flags, event lists, private keys, or provider configuration overrides.

## GitHub

For GitHub, OpenRoad updates the GitHub App webhook configuration through the server-side GitHub App client:

- Target URL: `${OPENROAD_WEBHOOK_PUBLIC_BASE_URL || OPENROAD_PUBLIC_APP_URL}/api/openroad/integrations/github/webhook`
- Content type: `json`
- SSL verification: enabled
- Secret: `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`

Required server configuration:

- `OPENROAD_PUBLIC_APP_URL` or `OPENROAD_WEBHOOK_PUBLIC_BASE_URL`
- `OPENROAD_GITHUB_APP_SLUG`
- `OPENROAD_GITHUB_APP_ID`
- `OPENROAD_GITHUB_APP_PRIVATE_KEY` or `OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE`
- `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`

The public base URL must be HTTPS, except localhost/loopback URLs for development and tests.

## Linear And Jira

Linear and Jira registration requests are recorded as blocked until OpenRoad can prove provider-created deliveries will be signed with a server-known secret that matches the current verifier. OpenRoad does not create unverifiable Linear or Jira provider webhooks.

## Stored Metadata

Integration metadata schema `4` adds `webhookRegistrations: []`.

Records store bounded operational metadata only: provider, workspace id, installation id, target URL, event names, external webhook id when known, status, attempt count, timestamps, expiry, and redacted errors.

Records must not store provider tokens, refresh tokens, private keys, webhook secrets, JWTs, authorization headers, raw provider responses, request headers, request bodies, or encrypted credential internals.

## UI

Settings shows a compact `Register webhook` action only when the server reports a safe provider capability. Standalone mode and unsupported providers do not show extra webhook automation controls. Existing webhook ingestion remains manual/self-host compatible.
