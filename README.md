# OpenRoad

OpenRoad is a standalone-first, open-source product feedback, roadmap, work, and changelog platform.

The product must be useful with no integrations connected. GitHub, Jira, Linear, Slack, Discord, and support/email sources enrich OpenRoad through optional adapters; they do not define the core workflow.

## Product Promise

OpenRoad helps teams capture user requests, decide what matters, communicate a clear roadmap, connect decisions to delivery work, and close the loop when features ship.

## Core Objects

- Request
- Roadmap item
- Work item
- Changelog entry
- Customer
- Vote
- Comment
- Decision

External providers attach through external links and sync state. Provider-specific concepts must not leak into the core domain model.

## Repository Status

OpenRoad now has a working standalone product loop, production server foundation, and first self-host operations path:

- React app shell for requests, work, roadmap, changelog, portal, and settings.
- Versioned OpenRoad domain state with local persistence, import/export, and recovery.
- Public/private visibility for requests, comments, roadmap items, and changelog entries.
- Production Node server that serves the built app and same-origin OpenRoad APIs.
- File-backed server persistence for a single-tenant self-host or evaluation install.
- Team metadata, workspace membership, audit events, and private ops status APIs.
- App-level crash recovery boundary with retry and local browser-data reset actions.
- Provider-neutral integration mappings plus a payload-backed GitHub issue import/link API.
- Server-only GitHub App setup and installation verification foundation.
- Live GitHub issue fetch through verified installations without persisted tokens.
- Signed GitHub App webhook ingestion, idempotent linked issue sync, and safe disconnect handling.
- Encrypted server-only provider credential storage primitives for GitHub, Linear, and Jira.
- Safe Linear OAuth setup plus payload-backed Linear issue import/link.
- Safe Jira OAuth setup plus payload-backed Jira issue import/link with explicit field mapping.
- Requester notification preferences plus an internal outbox for status and changelog updates.
- Deterministic local assistant triage for request summaries, duplicate hints, and private changelog draft suggestions.
- Release candidate manifest tooling for version, checksum, support-window, and dry-run publishing verification.
- Docker Compose, backup/restore, and smoke-check commands for self-host operators.

Current production limits are explicit: OAuth/session auth, invitation flows, managed database migrations, hosted release promotion, deeper observability, browser Settings UI for integrations, OAuth callback exchange, Linear/Jira live fetch/webhooks, background sync jobs, direct email/provider notification delivery, real model-backed AI adapters with consent/prompt redaction/audit logs, and conflict UI are planned next-stage work.

Current docs:

- [PRODUCT.md](PRODUCT.md)
- [DESIGN.md](DESIGN.md)
- [Build plan](docs/BUILD_PLAN.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Branching and release workflow](docs/BRANCHING_AND_RELEASE.md)
- [Integration adapter contract](docs/INTEGRATION_ADAPTER_CONTRACT.md)
- [GitHub issue sync](docs/GITHUB_ISSUE_SYNC.md)
- [GitHub App installation](docs/GITHUB_APP_INSTALLATION.md)
- [Linear issue sync](docs/LINEAR_ISSUE_SYNC.md)
- [Jira issue sync](docs/JIRA_ISSUE_SYNC.md)
- [Provider token storage](docs/PROVIDER_TOKEN_STORAGE.md)
- [Requester notifications](docs/REQUESTER_NOTIFICATIONS.md)
- [AI-assisted triage](docs/AI_ASSISTED_TRIAGE.md)
- [Release operations](docs/RELEASE_OPERATIONS.md)
- [UI concepts](docs/UI_CONCEPTS.md)

## Working Rule

Before implementation starts for any feature:

1. Create a feature branch named by work, not phase number, for example `feat/workspace-shell`.
2. Write the feature test checklist first.
3. Include regression checks for previously completed features.
4. Implement only the scoped feature.
5. Run the checklist.
6. Merge only when the feature passes its acceptance and regression gates.

## Local Development

```powershell
pnpm install
pnpm dev
```

## Production Run Path

```powershell
pnpm install --frozen-lockfile
pnpm build
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:OPENROAD_INTEGRATION_FILE="C:\openroad\openroad-integrations.json"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
$env:PORT="4173"
pnpm start
```

## Release Verification

```powershell
pnpm check
pnpm release:verify
pnpm release:plan -- --version 0.1.0-rc.1 --channel rc --output .openroad\releases\openroad-0.1.0-rc.1.json
```

Release manifests record build artifact checksums, support window, required gates, and whether Docker publishing or artifact signing is only a dry-run for the current stage.

## Self-Host Operations

```powershell
Copy-Item .env.selfhost.example .env.selfhost
docker compose --env-file .env.selfhost up --build -d
$env:OPENROAD_ADMIN_TOKEN = (Get-Content .env.selfhost | Where-Object { $_ -match "^OPENROAD_ADMIN_TOKEN=" }) -replace "^OPENROAD_ADMIN_TOKEN=", ""
pnpm ops:smoke -- --base-url http://127.0.0.1:4173 --workspace-id acme --admin-token $env:OPENROAD_ADMIN_TOKEN
pnpm ops:backup -- --output-dir C:\openroad\backups
```

Keep `.env.selfhost`, `/data`, backup directories, and restore-safety directories private. Backups contain OpenRoad product data, requester information, integration metadata, team metadata, memberships, and audit events.

The server exposes:

- `GET /api/health`
- `GET /api/openroad/contract`
- `GET /api/openroad/session`
- `GET /api/openroad/state`
- `PUT /api/openroad/state`
- `POST /api/openroad/actions`
- `GET /api/openroad/workspaces`
- `GET /api/openroad/workspaces/:workspaceId`
- `POST /api/openroad/workspaces/:workspaceId/actions`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/issues/live`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/app/setup`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/verify`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect`
- `POST /api/openroad/integrations/github/webhook`
- `POST /api/openroad/workspaces/:workspaceId/integrations/linear/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup`
- `POST /api/openroad/workspaces/:workspaceId/integrations/jira/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/jira/oauth/setup`
- `GET /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials/:credentialId/revoke`
- `GET /api/openroad/audit-events`
- `GET /api/openroad/ops/status`
- `GET /api/openroad/workspaces/:workspaceId/portal`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/vote`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/comments`

When `OPENROAD_ADMIN_TOKEN` is configured, private state APIs require `Authorization: Bearer <token>`. The portal API remains public and returns only the public projection. See [API auth and tenancy contract](docs/API_AUTH_TENANCY_CONTRACT.md).

Deployment, backup, restore, smoke, upgrade, and rollback details live in [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md).
