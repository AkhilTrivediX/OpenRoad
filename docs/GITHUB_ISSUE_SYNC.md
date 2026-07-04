# OpenRoad GitHub Issue Sync

OpenRoad now has the first provider-specific integration slice: a server-side GitHub issue import/link endpoint built on the shared integration adapter contract.

## Current Capability

- Import a GitHub issue payload into an OpenRoad request.
- Link a GitHub issue payload to an existing OpenRoad request.
- Re-import the same GitHub issue and update the mapped request instead of creating duplicates.
- Link GitHub pull request payloads to the same OpenRoad request through external mappings.
- Store GitHub installation metadata and mappings in `OPENROAD_INTEGRATION_FILE`, outside OpenRoad core workspace state.
- Record audit events for GitHub imports and syncs.

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

## Deferred Live GitHub App Work

The next GitHub slices should add:

- GitHub App installation and callback flow.
- Server-only token/private-key handling.
- Live REST/GraphQL issue fetch.
- Webhook signature verification.
- Idempotent webhook processing.
- Background sync and conflict handling.
- UI for connect, import, disconnect, and sync logs.
