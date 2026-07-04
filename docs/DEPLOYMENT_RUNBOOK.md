# OpenRoad Deployment Runbook

This runbook covers the current production path: one Node process serving the built app, OpenRoad state, team metadata, and public portal APIs.

## Build

```powershell
pnpm install --frozen-lockfile
pnpm build
```

## Environment

```powershell
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
$env:OPENROAD_OWNER_EMAIL="owner@example.com"
$env:OPENROAD_OWNER_NAME="Workspace Owner"
$env:OPENROAD_ADMIN_TOKEN="replace-with-long-random-token"
$env:OPENROAD_SINGLE_USER_MODE="false"
$env:OPENROAD_TRUST_PROXY_HEADERS="false"
$env:PORT="4173"
```

Do not expose `OPENROAD_ADMIN_TOKEN` to browser JavaScript.

## Start

```powershell
pnpm start
```

## Smoke Test

- `GET /api/health` should return `200`.
- `GET /api/openroad/contract` should return the API contract.
- `GET /api/openroad/workspaces/acme/portal` should return public data only.
- With `OPENROAD_ADMIN_TOKEN` configured, unauthenticated `GET /api/openroad/state` should return `403`.
- With `Authorization: Bearer <token>`, `GET /api/openroad/state` should return `200`.
- `GET /api/openroad/ops/status` should require private read permission.

## Backup

Back up both files together:

- `OPENROAD_DATA_FILE`
- `OPENROAD_TEAM_FILE`

The data file contains workspace product data. The team file contains users, workspace memberships, and audit events.

## Rollback

1. Stop the server.
2. Restore the previous application build.
3. Keep the current data and team files as backups.
4. If needed, restore the previous data and team file pair.
5. Run the smoke test before reopening access.

## Current Limits

- OAuth/session auth is not implemented.
- Team metadata is file-backed, not managed SQL.
- Trusted proxy headers are disabled by default.
- Background jobs, webhooks, provider tokens, and billing are not implemented.
