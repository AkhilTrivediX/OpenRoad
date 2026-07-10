# Provider Token Storage

OpenRoad now has server-only encrypted credential storage primitives for GitHub, Linear, and Jira integrations. Linear and Jira OAuth callbacks can exchange provider authorization codes server-side and store encrypted credentials without putting provider tokens in browser state or core OpenRoad workspace data. Linear and Jira live sync use these encrypted credentials for already-linked issue mappings and rotate OAuth refresh tokens server-side when access tokens expire.

## Environment

```powershell
$env:OPENROAD_TOKEN_ENCRYPTION_KEY="replace-with-at-least-32-random-characters"
$env:OPENROAD_TOKEN_ENCRYPTION_KEY_ID="primary"
```

Credential storage is disabled until `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured. The key is derived server-side for AES-256-GCM encryption and is never returned by OpenRoad APIs. Use a high-entropy secret from your host secret manager. Do not commit it, put it in browser JavaScript, or include it in support bundles.

## Credential API

List credentials:

`GET /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`

Create a credential:

`POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`

```json
{
  "installationId": "github-install",
  "accessToken": "provider-access-token",
  "refreshToken": "optional-provider-refresh-token",
  "permissions": ["read:external"],
  "providerScopes": ["repo", "issues:read"],
  "expiresAt": "2026-07-05T00:00:00.000Z",
  "label": "GitHub sync",
  "tokenType": "bearer"
}
```

Revoke a credential:

`POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials/:credentialId/revoke`

All credential endpoints require `integration:manage`, which is limited to local owners/admins and workspace owners. Public visitors, requesters, contributors, viewers, and integration actors cannot create, list, or revoke credentials.

## Storage Boundary

Credentials are stored in `OPENROAD_INTEGRATION_FILE`. The credential record shape was introduced in integration metadata schema `2`; current schema `3` also stores provider-neutral background sync job metadata.

API responses return only credential metadata:

- Provider, workspace, and installation scope.
- OpenRoad integration permissions.
- Provider scope labels.
- Expiry, token type, label, timestamps, and status.

API responses never return raw access tokens, refresh tokens, ciphertext, IVs, tags, or key material.

Revoking a credential marks it `revoked`, records `revokedAt`, and removes encrypted secret material from the integration metadata record. Manual GitHub disconnects and signed GitHub installation deletion webhooks revoke matching active credentials while preserving other workspaces and providers.

## OAuth Callback Storage

Linear and Jira callbacks use the same credential records as the manual credential API. Callback-created credentials are limited to `read:external`, labeled `OAuth`, and scoped to the decoded workspace plus active provider installation. Provider authorization codes, access tokens, refresh tokens, client secrets, authorization headers, and encrypted credential internals are not returned in callback responses or audit events.

When a Linear or Jira OAuth credential is expired or near expiry, the provider sync worker opens the encrypted refresh token server-side, exchanges it with the provider token endpoint, and replaces the encrypted access-token and refresh-token payload under the existing integration metadata mutation lock. Refresh failures never erase the old encrypted credential and API/status responses continue to expose metadata only.

OAuth callback exchange is disabled with `503 not_configured` unless the provider OAuth client settings, integration metadata store, and `OPENROAD_TOKEN_ENCRYPTION_KEY` token vault are all configured.

## Backup And Rotation

Backups include `openroad-integrations.json`. When credentials exist, that file contains encrypted provider token material and must be protected like production secrets.

For rotation:

1. Add a new provider credential with the replacement token.
2. Verify the later sync worker can use the new credential.
3. Revoke the old credential.
4. Rotate or expire old backups according to your operator policy.

Changing `OPENROAD_TOKEN_ENCRYPTION_KEY` without re-encrypting existing credentials prevents those encrypted credential payloads from being opened by future sync workers. This branch does not include multi-key decrypt or re-encryption tooling.

## Deferred Work

- Provider write-back.
- External KMS or multi-key rotation.
- Multi-process mutation locking.
