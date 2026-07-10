# OpenRoad Linear Issue Sync

OpenRoad now has a production-safe Linear integration path: safe OAuth setup metadata, payload-backed Linear issue import/link, encrypted server-only credential storage, live GraphQL sync workers, and signed webhooks for already-linked issue mappings.

Official Linear references used for this slice:

- [Linear GraphQL API getting started](https://linear.app/developers/graphql)
- [Linear OAuth 2.0 authentication](https://linear.app/developers/oauth-2-0-authentication)
- [Linear webhooks](https://linear.app/developers/webhooks)
- [Linear API and webhooks overview](https://linear.app/docs/api-and-webhooks)

## Current Capability

- Generate a safe Linear OAuth authorize URL for workspace owners.
- Import a Linear issue payload into an OpenRoad request.
- Link a Linear issue payload to an existing OpenRoad request.
- Re-import the same Linear issue and update the mapped request instead of creating duplicates.
- Store Linear installation metadata and mappings in `OPENROAD_INTEGRATION_FILE`, outside OpenRoad core workspace state.
- Store encrypted server-only credential records through the provider-neutral credential API when `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured.
- Queue provider-neutral background sync jobs for active Linear installations.
- Run private Linear live sync for already-linked Linear issue mappings when an active encrypted Linear credential is stored.
- Update linked OpenRoad requests from live Linear GraphQL issue data without importing unmapped issues.
- Receive signed Linear issue webhooks and update already-linked OpenRoad requests idempotently.
- Record audit events for Linear imports and syncs.

## Environment

```powershell
$env:OPENROAD_LINEAR_CLIENT_ID="lin_..."
$env:OPENROAD_LINEAR_CLIENT_SECRET="replace-with-linear-client-secret"
$env:OPENROAD_LINEAR_REDIRECT_URI="https://openroad.example.com/api/openroad/integrations/linear/oauth/callback"
$env:OPENROAD_LINEAR_API_URL="https://api.linear.app/graphql"
$env:OPENROAD_LINEAR_WEBHOOK_SECRET="replace-with-linear-webhook-secret"
```

`OPENROAD_LINEAR_APP_BASE_URL` can override `https://linear.app` for OAuth setup tests. `OPENROAD_LINEAR_API_URL` can override the GraphQL endpoint for smoke tests and private deployments.

Do not expose Linear client secrets, access tokens, refresh tokens, webhook secrets, or raw OAuth codes to browser JavaScript, public logs, audit events, API responses, or support bundles.

## OAuth Setup Endpoint

`GET /api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup`

The endpoint requires `integration:manage`, which is limited to local owners/admins and workspace owners. It returns setup status, required scopes, a CSRF state value, and an authorization URL when the Linear OAuth environment is configured.

This endpoint does not exchange OAuth codes. Encrypted credential storage now exists through the provider-neutral credential API, but the OAuth callback and code exchange flow remains deferred.

## Credential Storage

`POST /api/openroad/workspaces/:workspaceId/integrations/linear/credentials`

Credential storage requires `integration:manage`, an active Linear installation in the workspace, and `OPENROAD_TOKEN_ENCRYPTION_KEY`. API responses return only metadata and never return access tokens, refresh tokens, ciphertext, IVs, tags, or key material.

Set `tokenType` to `bearer` for OAuth access tokens. Set `tokenType` to `api-key` for Linear personal API keys, which Linear expects in the `Authorization` header without a `Bearer` prefix.

## Background Sync Jobs

`POST /api/openroad/workspaces/:workspaceId/integrations/linear/sync/jobs`

The endpoint queues provider-neutral sync jobs for active Linear installations. The private runner is `POST /api/openroad/integrations/sync/run`.

When `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured and an active Linear credential exists for the installation, the built-in production server auto-wires a Linear GraphQL worker. The worker refreshes already-linked Linear issue mappings by issue id, updates the linked OpenRoad request through the existing Linear mapper, and records `lastSyncedAt` on synced mappings.

The worker does not list/import unmapped Linear issues, refresh OAuth tokens, or write changes back to Linear.

## Webhook Endpoint

`POST /api/openroad/integrations/linear/webhook`

The endpoint requires `OPENROAD_LINEAR_WEBHOOK_SECRET`. It verifies the raw request body with the `Linear-Signature` header and HMAC-SHA256 before parsing JSON or mutating state. It also checks the Linear `webhookTimestamp` replay window and dedupes by `webhookId` or `Linear-Delivery` when present.

Only `Issue` webhooks for active installations with `webhook:receive` can update OpenRoad, and only when the Linear issue is already linked to an OpenRoad request. Unmapped issues are logged as ignored sync events without creating requests. Responses and persisted events never include raw Linear payloads, signatures, webhook secrets, access tokens, refresh tokens, or encrypted credential material.

## Import Endpoint

`POST /api/openroad/workspaces/:workspaceId/integrations/linear/issues/import`

The endpoint requires workspace write permission. Trusted integration actors can use it only when `OPENROAD_TRUST_PROXY_HEADERS=true` and the proxy supplies a matching workspace id.

Minimal payload shape:

```json
{
  "installation": {
    "id": "linear-install",
    "accountId": "linear-team",
    "accountName": "OpenRoad",
    "permissions": ["read:external", "read:openroad", "write:openroad"]
  },
  "issue": {
    "id": "lin-issue-123",
    "identifier": "OPEN-42",
    "title": "Import Linear issues",
    "description": "Issue body",
    "url": "https://linear.app/openroad/issue/OPEN-42/import-linear-issues",
    "state": { "id": "state-triage", "name": "Triage", "type": "triage" },
    "team": { "id": "team-open", "key": "OPEN", "name": "OpenRoad" },
    "assignee": { "displayName": "Akhil Trivedi" },
    "creator": { "displayName": "Customer Ops" },
    "labels": { "nodes": [{ "name": "needs-decision" }] },
    "project": { "name": "OpenRoad Beta" }
  }
}
```

To link an issue to an existing OpenRoad request, include `requestId`.

## Privacy Defaults

Imported Linear issues become private OpenRoad requests by default. Linear issue descriptions can include customer or internal delivery context, so public portal projection remains the only public exposure path.

Linear issue assignees are preserved in the imported description and tags. OpenRoad’s controlled owner field maps assigned Linear issues to `Maintainer` and unassigned Linear issues to `Unassigned`.

## Deferred Work

- OAuth callback and token exchange.
- OAuth refresh-token rotation.
- Full browser import UI and Linear sync logs.
- Provider write-back and conflict handling.
