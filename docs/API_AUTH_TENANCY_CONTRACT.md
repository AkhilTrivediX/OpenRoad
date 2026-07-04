# OpenRoad API Auth And Tenancy Contract

This contract defines the first enforceable trust boundary for OpenRoad. It is not a full auth provider. It exists so every future auth, team, integration, and public feature has a stable permission model instead of treating server APIs as public by accident.

## API Version

Current API version: `2026-07-04`

Every JSON API response includes:

- `apiVersion`
- `requestId`

Every JSON API error includes:

- `error.code`
- `error.message`
- `error.status`
- `error.requestId`

## Actors

- Local owner: single-user self-host owner or bearer-token admin.
- Workspace member: future authenticated workspace user.
- Public visitor: anonymous public portal reader.
- Requester: future public requester with linked identity.
- Integration actor: provider installation/job actor.
- Service account: future automation actor.

## Roles

- Owner
- Maintainer
- Contributor
- Viewer

Workspace roles do not grant full-state access. Full-state APIs are local-owner/admin surfaces only.

## Runtime Modes

### Single-User Mode

When `OPENROAD_ADMIN_TOKEN` is not configured, OpenRoad runs in single-user owner mode. This keeps local self-host and evaluation installs usable while the browser app has no login UI.

### Admin Token Mode

When `OPENROAD_ADMIN_TOKEN` is configured:

- `GET /api/openroad/state` requires `Authorization: Bearer <token>`.
- `PUT /api/openroad/state` requires `Authorization: Bearer <token>`.
- Owner/admin actions such as `replace-state`, `replace-workspace`, and `create-workspace` require owner/admin permission.
- Public portal endpoints remain public.

Do not expose `OPENROAD_ADMIN_TOKEN` to browser JavaScript. A future session/auth feature must replace direct browser access to private APIs when admin token mode is enabled.

### Trusted Proxy Headers

Trusted actor headers are disabled by default. They are only accepted when `OPENROAD_TRUST_PROXY_HEADERS=true`.

Supported contract headers:

- `x-openroad-actor-type`
- `x-openroad-actor-id`
- `x-openroad-workspace-id`
- `x-openroad-workspace-role`
- `x-openroad-requester-id`
- `x-openroad-integration-id`

These headers are for future auth proxy/session integration and tests. Do not enable them on a public deployment unless a trusted reverse proxy strips external copies and injects verified values.

## Public Routes

- `GET /api/health`
- `GET /api/openroad/contract`
- `GET /api/openroad/workspaces/:workspaceId/portal`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/vote`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/comments`

Public portal responses use the OpenRoad public projection and must not include requester source, internal comments, hidden comments, private roadmap items, private changelog entries, draft changelog entries, or private notes. Public portal write routes must validate portal settings, public request visibility, requester scope, and rate limits before mutation.

## Private Routes

- `GET /api/openroad/state`
- `PUT /api/openroad/state`
- `POST /api/openroad/actions`
- `GET /api/openroad/session`
- `GET /api/openroad/workspaces`
- `GET /api/openroad/workspaces/:workspaceId`
- `POST /api/openroad/workspaces/:workspaceId/actions`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/issues/live`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/app/setup`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/verify`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect`
- `POST /api/openroad/workspaces/:workspaceId/integrations/linear/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup`
- `GET /api/openroad/audit-events`
- `GET /api/openroad/ops/status`

Workspace-scoped routes require the actor to be scoped to the requested workspace unless the actor is the local owner/admin.

Workspace-scoped action responses return the updated workspace and a revision marker. They must not return the full multi-workspace state.

GitHub issue import is workspace-scoped and requires workspace write permission. It accepts fixture/API payloads only in the current slice; it must not accept GitHub OAuth tokens, App private keys, webhook secrets, or raw credential fields.

GitHub live issue fetch requires workspace write permission or a scoped integration actor. It generates short-lived installation access tokens server-side and must never persist, audit, or return those tokens.

GitHub App setup and installation verification require `integration:manage`, which is reserved for local owners/admins and workspace owners. Contributor, viewer, requester, public visitor, and integration actors cannot verify new GitHub App installations.

GitHub App disconnect also requires `integration:manage`. It marks installation metadata and mappings disconnected without deleting OpenRoad objects.

Linear issue import is workspace-scoped and requires workspace write permission. It accepts fixture/API payloads only in the current slice; it must not accept Linear OAuth tokens, refresh tokens, client secrets, webhook secrets, or raw OAuth codes.

Linear OAuth setup requires `integration:manage`, which is reserved for local owners/admins and workspace owners. It returns a safe authorization URL and setup state, but does not exchange OAuth codes or persist tokens.

## Provider-Signature Routes

- `POST /api/openroad/integrations/github/webhook`

The GitHub webhook route is not authorized by OpenRoad actor headers. It is provider-signature protected: the server requires `OPENROAD_GITHUB_APP_WEBHOOK_SECRET` and verifies `X-Hub-Signature-256` against the raw request body with HMAC-SHA256 before parsing JSON or mutating state.

Valid deliveries are processed as integration actor work after the target workspace is derived from existing installation/mapping metadata. Duplicate delivery IDs are idempotent no-ops. Webhook secrets, raw payloads, signatures, and request headers must not be persisted or returned.

## Environment

```powershell
$env:OPENROAD_ADMIN_TOKEN="replace-with-long-random-token"
$env:OPENROAD_INTEGRATION_FILE=".openroad/openroad-integrations.json"
$env:OPENROAD_GITHUB_APP_SLUG="openroad"
$env:OPENROAD_GITHUB_APP_ID="12345"
$env:OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE="C:\openroad\github-app.private-key.pem"
$env:OPENROAD_GITHUB_APP_WEBHOOK_SECRET="replace-with-long-random-secret"
$env:OPENROAD_LINEAR_CLIENT_ID="lin_..."
$env:OPENROAD_LINEAR_CLIENT_SECRET="replace-with-linear-client-secret"
$env:OPENROAD_LINEAR_REDIRECT_URI="https://openroad.example.com/api/openroad/integrations/linear/oauth/callback"
$env:OPENROAD_TRUST_PROXY_HEADERS="false"
$env:OPENROAD_SINGLE_USER_MODE="false"
```

`OPENROAD_SINGLE_USER_MODE=false` can explicitly disable owner fallback when no token is configured.
