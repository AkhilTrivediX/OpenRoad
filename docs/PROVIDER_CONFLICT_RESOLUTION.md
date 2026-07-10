# Provider Conflict Resolution

OpenRoad surfaces conflicted GitHub, Linear, and Jira issue mappings in Settings without adding default navigation or cluttering standalone workspaces.

## Endpoint

`POST /api/openroad/workspaces/:workspaceId/integrations/:provider/conflicts/:mappingId/resolve`

Body:

```json
{
  "resolution": "keep-openroad"
}
```

Supported resolutions:

- `keep-openroad`: clears the conflict and preserves the current OpenRoad request.
- `accept-provider`: fetches the current provider issue with server-only credentials, applies the existing provider-to-request sync transform, clears the conflict, and updates `lastSyncedAt`.
- `disconnect-mapping`: disconnects only the conflicted mapping and preserves the provider account plus unrelated mappings.

## Safety Boundaries

- Requires `integration:manage`.
- Resolves only existing conflicted issue mappings for OpenRoad requests.
- Does not accept provider tokens, issue payloads, owner/repo ids, cloud ids, or OAuth material from the browser.
- Linear and Jira provider reads open encrypted credentials server-side and refresh OAuth credentials through the existing rotation path when needed.
- Responses, sync events, audit events, and UI state return only sanitized identifiers and never expose provider access tokens, refresh tokens, private keys, ciphertext, authorization headers, raw provider response bodies, or webhook secrets.

## UI Behavior

Settings shows a compact provider conflict callout only when the sanitized integration status contains conflicted mappings. Healthy providers and standalone workspaces do not show conflict controls.
