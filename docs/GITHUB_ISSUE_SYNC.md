# OpenRoad GitHub Issue Sync

OpenRoad now has the first provider-specific integration slice: a server-side GitHub issue import/link endpoint built on the shared integration adapter contract.

## Current Capability

- Import a GitHub issue payload into an OpenRoad request.
- Link a GitHub issue payload to an existing OpenRoad request.
- Re-import the same GitHub issue and update the mapped request instead of creating duplicates.
- Link GitHub pull request payloads to the same OpenRoad request through external mappings.
- Store GitHub installation metadata and mappings in `OPENROAD_INTEGRATION_FILE`, outside OpenRoad core workspace state.
- Record audit events for GitHub imports and syncs.
- Fetch live GitHub issues through verified GitHub App installations without persisting installation tokens.
- Receive signed GitHub App `issues` webhooks and update already-linked OpenRoad requests idempotently.
- Disconnect installations and mappings without deleting OpenRoad requests.

## Endpoint

`POST /api/openroad/workspaces/:workspaceId/integrations/github/issues/import`

The endpoint requires workspace write permission. In admin-token mode it is private. Trusted integration actors can use it only when `OPENROAD_TRUST_PROXY_HEADERS=true` and the proxy supplies a matching workspace id.

Minimal payload shape:

```json
{
  "installation": {
    "id": "github-install",
    "accountId": "AkhilTrivediX",
    "accountName": "AkhilTrivediX",
    "permissions": ["read:external", "read:openroad", "write:openroad"]
  },
  "issue": {
    "node_id": "I_kwDOGH123",
    "number": 42,
    "title": "Import GitHub issues",
    "body": "Issue body",
    "state": "open",
    "html_url": "https://github.com/AkhilTrivediX/OpenRoad/issues/42",
    "repository": {
      "node_id": "R_kwDOR123",
      "full_name": "AkhilTrivediX/OpenRoad",
      "name": "OpenRoad",
      "owner": { "login": "AkhilTrivediX" }
    },
    "user": { "login": "akhil" },
    "labels": [{ "name": "planned" }]
  },
  "pullRequests": []
}
```

To link an issue to an existing OpenRoad request, include `requestId`.

## Privacy Defaults

Imported GitHub issues become private OpenRoad requests by default. GitHub issue bodies can contain private repository or customer context, so public portal projection must remain the only public exposure path.

The endpoint does not accept or store GitHub tokens, App private keys, webhook secrets, OAuth codes, or raw credential fields.

If an existing installation is disconnected or suspended in integration metadata, manual import rejects that installation instead of reactivating it from client-supplied payloads.

## Webhook And Disconnect

Signed webhook endpoint:

`POST /api/openroad/integrations/github/webhook`

Manual disconnect endpoint:

`POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect`

The webhook endpoint verifies `X-Hub-Signature-256` against the raw payload with `OPENROAD_GITHUB_APP_WEBHOOK_SECRET`. Duplicate GitHub delivery IDs are no-ops. Unmapped issues are logged without creating requests.

## Deferred GitHub Work

The next GitHub slices should add:

- Background sync and conflict handling.
- UI for connect, import, disconnect, and sync logs.
