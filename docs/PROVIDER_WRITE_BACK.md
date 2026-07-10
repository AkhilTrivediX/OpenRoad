# Provider Write-Back

OpenRoad supports explicit, user-triggered write-back from an OpenRoad request to an already-linked GitHub, Linear, or Jira issue.

Write-back is intentionally narrow. It updates only the provider issue title and body/description from the current OpenRoad request title and description. It does not change provider status, labels, assignees, priorities, projects, comments, milestones, or custom fields.

## Endpoint

`POST /api/openroad/workspaces/:workspaceId/integrations/:provider/write-back`

Supported providers: `github`, `linear`, `jira`.

Request body:

```json
{
  "requestId": "request-id",
  "mappingId": "optional-specific-mapping-id"
}
```

The browser never sends provider owner/repo/issue ids, Jira cloud ids, Linear issue ids, access tokens, refresh tokens, or OAuth codes. The server derives the provider target from the active stored mapping for the OpenRoad request.

## Permissions

The route requires workspace-scoped `integration:manage` access.

The linked provider installation must be active and include `write:external`. Linear and Jira also require an active encrypted credential for the same installation with `write:external`.

GitHub write-back uses a short-lived GitHub App installation token. Linear and Jira write-back opens the encrypted credential server-side; expired or near-expired OAuth credentials refresh through the existing refresh-token rotation path when refresh material and OAuth config are present.

## Provider Calls

- GitHub: `PATCH /repos/{owner}/{repo}/issues/{issue_number}` with `title` and `body`.
- Linear: GraphQL `issueUpdate(id, input)` with `title` and `description`.
- Jira: `PUT /rest/api/3/issue/{issueIdOrKey}` with `fields.summary` and Atlassian Document Format `fields.description`.

## Safety Boundaries

- No automatic write-back runs on OpenRoad edits.
- Request body text is bounded before provider calls.
- Provider errors are sanitized before API output or persistence.
- Successful writes record a bounded integration sync event and audit event without raw provider payloads.
- OpenRoad request contents are not mutated by write-back; the provider issue is the only external object changed.
- Standalone requests remain uncluttered. The browser request inspector shows write-back only when sanitized integration status reports provider write-back capability for the selected provider-sourced request.

## Deferred Work

- Provider status, label, assignee, priority, project, comment, and custom-field mapping.
- Bulk write-back.
- Creating new provider issues from OpenRoad requests.
- Hosted webhook registration automation.
