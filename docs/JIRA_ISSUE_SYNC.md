# Jira Issue Sync

OpenRoad supports Jira import, linking, encrypted credential storage, live sync, and signed webhooks while keeping Jira complexity outside the core OpenRoad domain.

## Implemented

- Safe Atlassian OAuth setup metadata at `GET /api/openroad/workspaces/:workspaceId/integrations/jira/oauth/setup`.
- Server-side Atlassian OAuth callback exchange with encrypted credential storage.
- Payload-backed Jira issue import/link at `POST /api/openroad/workspaces/:workspaceId/integrations/jira/issues/import`.
- Explicit Jira field mapping for issue id, key, summary, Atlassian Document Format description, status category, project, issue type, priority, assignee, reporter, labels, URL, and updated timestamp.
- Provider-neutral external mappings in `OPENROAD_INTEGRATION_FILE`.
- Workspace-scoped installation metadata.
- Encrypted server-only credential records through the provider-neutral credential API when `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured.
- Server-side OAuth refresh-token rotation for expired or near-expired Jira credentials before live issue sync.
- Provider-neutral background sync jobs for active Jira installations.
- Live Jira Cloud REST sync for already-linked issue mappings through the private sync runner when an active encrypted Jira credential is stored.
- Signed Jira issue webhooks for already-linked issue mappings.
- Provider/id-scoped integration actors, for example `jira:jira-install-jira-cloud-id`.
- Audit events for Jira issue import/update.

## Official Platform References

- Atlassian OAuth 2.0 3LO apps: https://developer.atlassian.com/cloud/jira/software/oauth-2-3lo-apps/
- Atlassian authorization-code flow: https://developer.atlassian.com/cloud/oauth/getting-started/implementing-oauth-3lo/
- Jira OAuth scopes: https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
- Jira Cloud REST API: https://developer.atlassian.com/cloud/jira/platform/rest/v2/
- Jira webhooks: https://developer.atlassian.com/cloud/jira/platform/webhooks/

## Safe OAuth Setup

Configure:

```powershell
$env:OPENROAD_JIRA_AUTH_BASE_URL="https://auth.atlassian.com"
$env:OPENROAD_JIRA_CLIENT_ID="jira-client-id"
$env:OPENROAD_JIRA_CLIENT_SECRET="replace-with-jira-client-secret"
$env:OPENROAD_JIRA_REDIRECT_URI="https://openroad.example.com/api/openroad/integrations/jira/oauth/callback"
$env:OPENROAD_JIRA_RESOURCE_BASE_URL="https://api.atlassian.com"
$env:OPENROAD_JIRA_API_BASE_URL="https://api.atlassian.com/ex/jira"
$env:OPENROAD_JIRA_WEBHOOK_SECRET="replace-with-jira-webhook-secret"
```

The setup endpoint returns:

- `configured`
- `missing`
- `requiredScopes`
- `state`
- `authorizeUrl` when fully configured

It never returns `OPENROAD_JIRA_CLIENT_SECRET`, OAuth codes, access tokens, refresh tokens, or webhook secrets.

Add `?installationId=...` to bind callback storage to an existing Jira installation id. This is recommended when a user can authorize more than one Atlassian site.

## OAuth Callback

`GET /api/openroad/integrations/jira/oauth/callback`

The callback verifies signed, time-limited state, checks `integration:manage` for the decoded workspace, exchanges the code with Atlassian using JSON authorization-code parameters, loads accessible resources from `OPENROAD_JIRA_RESOURCE_BASE_URL`, and stores an encrypted `read:external` credential through the token vault.

If Atlassian returns multiple accessible Jira sites and the state is not bound to an existing installation, OpenRoad rejects the callback instead of guessing a site. JSON callers can pass `format=json`; browser callers are redirected back to app settings with a same-origin status query.

The callback requires `OPENROAD_TOKEN_ENCRYPTION_KEY`. It never returns or persists raw OAuth codes, access tokens, refresh tokens, client secrets, provider authorization headers, or encrypted credential internals in API responses or audit events.

Required current scopes:

- `read:jira-work`
- `read:jira-user`

## Import Payload

```json
{
  "installation": {
    "id": "jira-install",
    "accountId": "jira-cloud-id",
    "accountName": "OpenRoad Jira",
    "permissions": ["read:external", "read:openroad", "write:openroad"]
  },
  "issue": {
    "id": "10042",
    "key": "OPEN-42",
    "url": "https://openroad.atlassian.net/browse/OPEN-42",
    "self": "https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/issue/10042",
    "fields": {
      "summary": "Import Jira issues",
      "description": {
        "type": "doc",
        "version": 1,
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Users need Jira context." }]
          }
        ]
      },
      "status": {
        "id": "3",
        "name": "Triage",
        "statusCategory": { "key": "new", "name": "To Do" }
      },
      "project": { "id": "10000", "key": "OPEN", "name": "OpenRoad" },
      "issuetype": { "id": "10001", "name": "Story" },
      "priority": { "id": "2", "name": "High" },
      "assignee": { "accountId": "acct-1", "displayName": "Akhil Trivedi" },
      "reporter": { "accountId": "acct-2", "displayName": "Customer Ops" },
      "labels": ["needs-decision", "ux"]
    }
  }
}
```

Add `requestId` to link the Jira issue to an existing OpenRoad request. Re-importing the same mapped Jira provider id updates the linked request rather than creating a duplicate.

## Mapping Rules

- Jira provider `id` plus Atlassian cloud/site id is the external identity.
- Jira `key` is a display key only.
- Raw installation ids are canonicalized with the Jira cloud/site id so two Jira sites cannot overwrite each other when an importer reuses the same local installation label.
- Imported requests are private by default.
- Jira issue body is stored in the OpenRoad request description, not public portal output unless the request is intentionally made public later.
- OpenRoad core objects do not receive Jira-specific fields.

## Credential Storage

`POST /api/openroad/workspaces/:workspaceId/integrations/jira/credentials`

Credential storage requires `integration:manage`, an active Jira installation in the workspace, and `OPENROAD_TOKEN_ENCRYPTION_KEY`. API responses return only metadata and never return access tokens, refresh tokens, ciphertext, IVs, tags, or key material.

## Background Sync Jobs

`POST /api/openroad/workspaces/:workspaceId/integrations/jira/sync/jobs`

The endpoint queues provider-neutral sync jobs for active Jira installations. The private runner is `POST /api/openroad/integrations/sync/run`.

When `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured and an active Jira credential exists for the installation, the server auto-wires a Jira sync worker. The worker refreshes expired or near-expired OAuth credentials before provider reads, then refreshes already-linked Jira issue mappings only. It does not search projects, import unmapped Jira issues, or write back to Jira.

The Jira REST client defaults to `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2/issue/{issueIdOrKey}` and can be pointed at a fake/self-host test endpoint with `OPENROAD_JIRA_API_BASE_URL`. It uses OAuth bearer authorization server-side and requests a bounded field set for issue sync. Jira `429`, `408`, `409`, and `5xx` responses become retryable sync failures with bounded backoff; malformed responses fail without persisting raw provider payloads.

## Webhook Endpoint

`POST /api/openroad/integrations/jira/webhook`

The endpoint requires `OPENROAD_JIRA_WEBHOOK_SECRET`. It verifies the raw request body with the Jira `X-Hub-Signature` HMAC-SHA256 header before parsing JSON or mutating state. It requires `X-Atlassian-Webhook-Identifier` for idempotency across retries.

Only Jira issue webhooks for active installations with `webhook:receive` can update OpenRoad, and only when the Jira issue is already linked to an OpenRoad request for the same installation/site. Jira issue ids stay scoped by cloud/site id before mapping updates are applied. Unmapped issues are logged as ignored sync events without creating requests. Responses and persisted events never include raw Jira payloads, signatures, webhook secrets, access tokens, refresh tokens, or encrypted credential material.

## Deferred

- Conflict UI.
- Full browser import UI and Jira sync logs.
