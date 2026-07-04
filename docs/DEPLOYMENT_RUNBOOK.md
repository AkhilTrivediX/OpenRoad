# OpenRoad Deployment And Self-Host Runbook

This runbook covers the current production path: one Node process serving the built app, OpenRoad state, integration metadata, team metadata, and public portal APIs. It also defines the first supported self-host path with Docker Compose, backup/restore commands, and smoke checks.

## Current Operator Contract

- OpenRoad is self-hostable as a single Node service.
- Mutable data lives in three JSON files: `OPENROAD_DATA_FILE`, `OPENROAD_INTEGRATION_FILE`, and `OPENROAD_TEAM_FILE`.
- Docker Compose stores those files in the `openroad-data` volume at `/data`.
- `OPENROAD_ADMIN_TOKEN` protects private APIs when configured.
- The public portal API remains unauthenticated and returns only public data.
- Backups contain product, requester, integration, team, membership, and audit data; store them like production data.

## Build

```powershell
pnpm install --frozen-lockfile
pnpm build
```

## Local Production Start

Use this path when running directly on a server or VM without Docker.

```powershell
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:OPENROAD_INTEGRATION_FILE="C:\openroad\openroad-integrations.json"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
$env:OPENROAD_OWNER_EMAIL="owner@example.com"
$env:OPENROAD_OWNER_NAME="Workspace Owner"
$env:OPENROAD_ADMIN_TOKEN="replace-with-long-random-token"
$env:OPENROAD_PORTAL_RATE_LIMIT_MAX="30"
$env:OPENROAD_PORTAL_RATE_LIMIT_WINDOW_MS="60000"
$env:OPENROAD_GITHUB_APP_SLUG=""
$env:OPENROAD_GITHUB_APP_ID=""
$env:OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE=""
$env:OPENROAD_GITHUB_APP_WEBHOOK_SECRET=""
$env:OPENROAD_SINGLE_USER_MODE="false"
$env:OPENROAD_TRUST_PROXY_HEADERS="false"
$env:PORT="4173"
pnpm start
```

## Environment

```powershell
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:OPENROAD_INTEGRATION_FILE="C:\openroad\openroad-integrations.json"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
$env:OPENROAD_OWNER_EMAIL="owner@example.com"
$env:OPENROAD_OWNER_NAME="Workspace Owner"
$env:OPENROAD_ADMIN_TOKEN="replace-with-long-random-token"
$env:OPENROAD_PORTAL_RATE_LIMIT_MAX="30"
$env:OPENROAD_PORTAL_RATE_LIMIT_WINDOW_MS="60000"
$env:OPENROAD_GITHUB_APP_SLUG=""
$env:OPENROAD_GITHUB_APP_ID=""
$env:OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE=""
$env:OPENROAD_GITHUB_APP_WEBHOOK_SECRET=""
$env:OPENROAD_SINGLE_USER_MODE="false"
$env:OPENROAD_TRUST_PROXY_HEADERS="false"
$env:PORT="4173"
```

Do not expose `OPENROAD_ADMIN_TOKEN` to browser JavaScript.

Do not expose GitHub App private keys or webhook secrets to browser JavaScript. Prefer `OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE` for self-host installs.

## Docker Compose Self-Host

Create a private environment file outside source control:

```powershell
Copy-Item .env.selfhost.example .env.selfhost
```

Edit `.env.selfhost` and replace `OPENROAD_ADMIN_TOKEN` with a long random value. Then start Compose with that env file:

```powershell
docker compose --env-file .env.selfhost up --build -d
$env:OPENROAD_ADMIN_TOKEN = (Get-Content .env.selfhost | Where-Object { $_ -match "^OPENROAD_ADMIN_TOKEN=" }) -replace "^OPENROAD_ADMIN_TOKEN=", ""
```

The Compose service:

- Builds from `Dockerfile`.
- Publishes `${OPENROAD_PORT:-4173}` to container port `4173`.
- Stores product, integration, and team data in the `openroad-data` volume.
- Runs with `OPENROAD_SINGLE_USER_MODE=false`.
- Requires `OPENROAD_ADMIN_TOKEN` before startup.
- Applies process-local public portal write limits from `OPENROAD_PORTAL_RATE_LIMIT_MAX` and `OPENROAD_PORTAL_RATE_LIMIT_WINDOW_MS`.

## Admin Bootstrap

The first local owner is seeded from:

- `OPENROAD_OWNER_EMAIL`
- `OPENROAD_OWNER_NAME`

Changing these values later does not rewrite existing team metadata. To change the owner after metadata exists, update the team metadata through a future admin UI or intentionally restore edited metadata from backup. Until invitation flows exist, treat the first bootstrap as an operator decision.

## Operational Commands

OpenRoad ships a small dependency-free operations CLI.

```powershell
pnpm ops:backup -- --output-dir C:\openroad\backups
pnpm ops:restore -- --input-dir C:\openroad\backups\openroad-backup-2026-07-04T10-00-00-000Z
pnpm ops:smoke -- --base-url http://127.0.0.1:4173 --workspace-id acme --admin-token $env:OPENROAD_ADMIN_TOKEN
```

For Docker Compose, run the same commands from the repository checkout on the host. Point `OPENROAD_DATA_FILE`, `OPENROAD_INTEGRATION_FILE`, and `OPENROAD_TEAM_FILE` at bind-mounted files if you manage data outside the named Docker volume. For named volumes, use `docker compose cp` or a temporary helper container to copy `/data/openroad-state.json`, `/data/openroad-integrations.json`, and `/data/openroad-team.json` before running host-side restore operations.

## Backup

Back up the product, integration, and team files together. They form one logical data snapshot.

```powershell
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:OPENROAD_INTEGRATION_FILE="C:\openroad\openroad-integrations.json"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
pnpm ops:backup -- --output-dir C:\openroad\backups
```

The backup directory contains:

- `openroad-state.json`
- `openroad-integrations.json`
- `openroad-team.json`
- `manifest.json`

The manifest records creation time, app package version, source paths, file sizes, and schema versions. Backups are not encrypted by OpenRoad tooling; use your host, storage, or secret-management system to protect them.

## Restore

Stop OpenRoad before restoring files.

```powershell
pnpm ops:restore -- --input-dir C:\openroad\backups\openroad-backup-2026-07-04T10-00-00-000Z
```

Restore validation checks the backup manifest and expected JSON shape before replacing active files. The command creates a pre-restore safety backup under `restore-safety` before copying the restored files into place.

Use `--force` only when you intentionally need to recover from a missing manifest or hand-repaired JSON shape and have separately inspected the files. Restore still requires state, integration, and team files to be present.

## Smoke Test

Run smoke checks after deploy, restore, upgrade, or rollback.

```powershell
pnpm ops:smoke -- --base-url http://127.0.0.1:4173 --workspace-id acme --admin-token $env:OPENROAD_ADMIN_TOKEN
```

The smoke command checks:

- `GET /api/health`
- `GET /api/openroad/contract`
- `GET /api/openroad/workspaces/:workspaceId/portal`
- Private ops API denial without a token when token mode is configured.
- Private ops API success with `Authorization: Bearer <token>`.
- Public portal read and write APIs should never return private workspace data.

For local single-user mode without `OPENROAD_ADMIN_TOKEN`, omit `--admin-token`; the command expects private ops status to be readable by the local owner.

## Upgrade Procedure

1. Read the release notes and migration notes.
2. Stop writes to the instance.
3. Run `pnpm ops:backup` and verify the backup directory has a manifest and both data files.
4. Deploy the new application version or rebuild the Docker image.
5. Start OpenRoad.
6. Run `pnpm ops:smoke`.
7. Check `/api/openroad/ops/status` with the admin token.
8. Reopen access.

## Rollback

1. Stop the server.
2. Preserve the current data files as a failed-upgrade backup.
3. Restore the previous application build or Docker image.
4. Restore the last known-good data/team backup if the new version changed or damaged runtime data.
5. Start OpenRoad.
6. Run the smoke test before reopening access.

## Endpoint Smoke Checklist

- `GET /api/health` should return `200`.
- `GET /api/openroad/contract` should return the API contract.
- `GET /api/openroad/workspaces/acme/portal` should return public data only.
- With `OPENROAD_ADMIN_TOKEN` configured, unauthenticated `GET /api/openroad/state` should return `403`.
- With `Authorization: Bearer <token>`, `GET /api/openroad/state` should return `200`.
- `GET /api/openroad/ops/status` should require private read permission.

## Security Notes

- Keep `.env.selfhost` out of git.
- Rotate `OPENROAD_ADMIN_TOKEN` after accidental exposure.
- Keep `OPENROAD_TRUST_PROXY_HEADERS=false` unless a trusted reverse proxy is enforcing identity headers.
- Do not publish `/data`, backup directories, or restore-safety directories.
- Treat backup archives as sensitive because they contain requester, workspace, membership, and audit data.
- Tune public portal rate limits for the deployment shape. Current limits are process-local and reset on restart.

## Current Limits

- OAuth/session auth is not implemented.
- Team metadata is file-backed, not managed SQL.
- Trusted proxy headers are disabled by default.
- Payload-backed GitHub issue import, GitHub App installation verification, live issue fetch, signed webhooks, and safe disconnect APIs exist; background jobs, persisted provider tokens, Linear, Jira, and billing are not implemented.
- Docker images are build-local only; publishing and signed release artifacts are future release work.
- Named Docker volume backup requires an operator copy step or a future packaged volume helper.
- Public portal rate limits are in-memory per Node process; distributed deployments need a shared limiter in a future slice.
