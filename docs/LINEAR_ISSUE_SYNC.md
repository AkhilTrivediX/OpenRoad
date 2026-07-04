# OpenRoad Linear Issue Sync

OpenRoad now has the first Linear integration slice: safe OAuth setup metadata and a payload-backed Linear issue import/link endpoint built on the shared integration adapter contract.

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
- Record audit events for Linear imports and syncs.

## Environment

```powershell
$env:OPENROAD_LINEAR_CLIENT_ID="lin_..."
$env:OPENROAD_LINEAR_CLIENT_SECRET="replace-with-linear-client-secret"
$env:OPENROAD_LINEAR_REDIRECT_URI="https://openroad.example.com/api/openroad/integrations/linear/oauth/callback"
```

`OPENROAD_LINEAR_APP_BASE_URL` can override `https://linear.app` for tests.

Do not expose Linear client secrets, access tokens, refresh tokens, webhook secrets, or raw OAuth codes to browser JavaScript, public logs, audit events, API responses, or support bundles.

## OAuth Setup Endpoint

`GET /api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup`

The endpoint requires `integration:manage`, which is limited to local owners/admins and workspace owners. It returns setup status, required scopes, a CSRF state value, and an authorization URL when the Linear OAuth environment is configured.

This endpoint does not exchange OAuth codes. Encrypted credential storage now exists through the provider-neutral credential API, but the OAuth callback and code exchange flow remains deferred.

## Credential Storage

`POST /api/openroad/workspaces/:workspaceId/integrations/linear/credentials`

Credential storage requires `integration:manage`, an active Linear installation in the workspace, and `OPENROAD_TOKEN_ENCRYPTION_KEY`. API responses return only metadata and never return access tokens, refresh tokens, ciphertext, IVs, tags, or key material.

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
- Live GraphQL issue fetch.
- Linear webhook endpoint with `Linear-Signature` verification.
- Browser Settings UI for connect, import, disconnect, and sync logs.
- Background sync and conflict handling.
