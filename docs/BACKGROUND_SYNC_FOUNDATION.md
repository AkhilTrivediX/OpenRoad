# Background Sync Foundation

OpenRoad has a provider-neutral background sync job foundation for GitHub, Linear, and Jira integrations. GitHub and Linear now have live workers for already-linked issue mappings when their server-side credentials are configured; Jira live sync and provider write-back remain future work.

## Current Capability

- Integration metadata schema `3` stores `syncJobs` in `OPENROAD_INTEGRATION_FILE`.
- Workspace owners/admins can enqueue sync jobs for active provider installations.
- A private global sync runner endpoint can claim due jobs and process them through a server-side worker adapter.
- The built-in production server wires a GitHub worker when GitHub App credentials are configured and a Linear worker when `OPENROAD_TOKEN_ENCRYPTION_KEY` plus active Linear credentials are available; otherwise the runner returns `503 not_configured` until a worker is available.
- Browser Settings can show sanitized provider sync status and run manual GitHub or Linear linked-issue sync when a connected installation, linked issue mapping, and worker are available.
- Retryable failures stay queued with backoff and attempt metadata.
- Running jobs have a lease and become claimable again after the lease expires, so a crashed process does not strand work forever.
- Fatal failures are marked failed without deleting job history.
- Integration metadata writes are serialized inside one Node process while OpenRoad uses file-backed JSON stores.
- Job history keeps active work first and newest completed history after that.

## Endpoints

Enqueue a sync job:

`POST /api/openroad/workspaces/:workspaceId/integrations/:provider/sync/jobs`

```json
{
  "installationId": "github-install",
  "mappingId": "optional-mapping-id",
  "reason": "manual",
  "runAfter": "2026-07-04T12:00:00.000Z"
}
```

Run due sync jobs:

`POST /api/openroad/integrations/sync/run`

```json
{
  "workspaceId": "acme",
  "provider": "github",
  "limit": 10
}
```

The enqueue endpoint requires `integration:manage`. The runner endpoint requires global owner/admin write access. Public visitors, requesters, viewers, contributors, and integration actors cannot enqueue or run sync jobs in this slice.

## Privacy Boundary

Sync jobs store provider, workspace, installation, reason, status, attempts, timestamps, and bounded error/result summaries. Worker failure text is redacted for common token/secret shapes before persistence and response. Jobs must not store provider tokens, encrypted credential payloads, raw provider payloads, webhook signatures, request headers, or request bodies.

Provider workers fetch/decrypt credentials server-side through the credential boundary and must keep provider payload redaction explicit.

## Deferred Work

- Jira live fetch worker.
- Provider write-back.
- OAuth callback token exchange.
- Full browser connect/disconnect flows and Jira manual sync controls.
- Conflict detection/resolution UI.
- External queue systems.
- Distributed locks across multiple Node processes.
- Cron packaging or hosted scheduler infrastructure.
