# Jira Issue Sync

OpenRoad supports a first Jira integration slice that keeps Jira complexity outside the core OpenRoad domain.

## Implemented

- Safe Atlassian OAuth setup metadata at `GET /api/openroad/workspaces/:workspaceId/integrations/jira/oauth/setup`.
- Payload-backed Jira issue import/link at `POST /api/openroad/workspaces/:workspaceId/integrations/jira/issues/import`.
- Explicit Jira field mapping for issue id, key, summary, Atlassian Document Format description, status category, project, issue type, priority, assignee, reporter, labels, URL, and updated timestamp.
- Provider-neutral external mappings in `OPENROAD_INTEGRATION_FILE`.
- Workspace-scoped installation metadata.
- Encrypted server-only credential records through the provider-neutral credential API when `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured.
- Provider-neutral background sync jobs for active Jira installations.
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
```

The setup endpoint returns:

- `configured`
- `missing`
- `requiredScopes`
- `state`
- `authorizeUrl` when fully configured

It never returns `OPENROAD_JIRA_CLIENT_SECRET`, OAuth codes, access tokens, refresh tokens, or webhook secrets.

The setup endpoint still does not exchange OAuth codes. Encrypted credential storage now exists through the provider-neutral credential API, but OAuth callback exchange remains deferred.

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

The endpoint queues provider-neutral sync jobs for active Jira installations. The private runner is `POST /api/openroad/integrations/sync/run`, but live Jira REST workers remain deferred.

## Deferred

- OAuth callback and token exchange.
- Live Jira REST fetch.
- Jira webhook endpoint and signature/idempotency handling.
- Background sync jobs.
- Conflict UI.
- Full browser connect/import/disconnect flows and Jira sync logs.
