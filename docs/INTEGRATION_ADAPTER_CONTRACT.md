# OpenRoad Integration Adapter Contract

OpenRoad integrations must enrich the core product without becoming the source of truth. GitHub, Linear, and Jira adapters attach external objects to OpenRoad objects through mappings that live outside the core domain model.

## Boundary Rules

- OpenRoad requests, work items, roadmap items, and changelog entries remain provider-neutral.
- Provider-specific IDs, URLs, cursor state, webhook metadata, and conflict records live in integration modules.
- Disconnecting a provider marks mappings disconnected; it does not delete OpenRoad objects.
- Sync jobs may create or update provider-owned mapping data, but core OpenRoad mutations must go through explicit OpenRoad actions.
- Standalone mode must work with zero installations.

## Core Types

The TypeScript contract lives in `src/integrations/adapter.ts`.

Adapters implement:

- `IntegrationInstallation`
- `ExternalObjectRef`
- `OpenRoadObjectRef`
- `ExternalObjectMapping`
- `SyncJob`
- `SyncResult`
- `SyncConflict`
- `ProviderAdapter`

Supported initial providers:

- `github`
- `linear`
- `jira`

Supported initial external object types:

- `issue`
- `pull-request`
- `project`
- `comment`
- `release`

## Mapping Identity

Mappings use deterministic keys derived from:

- Installation id.
- Provider.
- External object type.
- External object key or id.
- OpenRoad workspace id.
- OpenRoad object type.
- OpenRoad object id.

This keeps GitHub, Linear, and Jira objects from colliding even when external issue keys look similar.

## Retry Rules

Adapters should retry:

- `retryable-error`
- `rate-limited`

Adapters should not automatically retry:

- `success`
- `noop`
- `conflict`
- `fatal-error`

Rate-limited results may include `retryAfterSeconds`. A future job runner should use that value to schedule `nextRunAt`.

## Conflict Model

Conflicts must include:

- Local snapshot.
- External snapshot.
- Optional base snapshot.
- Mapping id.
- Resolution state.

The first implementation should surface unresolved conflicts in a hidden Settings/ops area, not in default navigation.

## Disconnect Behavior

Disconnect must:

- Stop future sync jobs for the installation.
- Mark mappings as `disconnected`.
- Preserve OpenRoad requests, work items, roadmap items, and changelog entries.
- Preserve enough mapping metadata for export and audit.

Disconnect must not:

- Delete OpenRoad objects.
- Remove requester comments or votes.
- Rewrite public roadmap/changelog history.

## Provider Implementation Order

1. Implement adapter fixture tests with the shared contract.
2. Add installation and permission flow.
3. Add external object import/link.
4. Add sync job runner and retry handling.
5. Add webhook signature verification.
6. Add conflict UI in Settings/ops surfaces.
7. Add disconnect flow and export behavior.
