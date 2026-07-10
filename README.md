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

- React app shell for requests, work, roadmap, changelog, portal, and settings, including progressive GitHub/Linear/Jira connection, credential, disconnect, and manual sync controls.
- Versioned OpenRoad domain state with local persistence, import/export, and recovery.
- Public/private visibility for requests, comments, roadmap items, and changelog entries.
- Production Node server that serves the built app and same-origin OpenRoad APIs.
- File-backed server persistence for a single-tenant self-host or evaluation install.
- Team metadata, workspace membership, hashed invitation tokens, owner/member browser sessions, audit events, and private ops status APIs.
- Server-side JSONL invitation delivery handoff with invite links that prefill the member join flow.
- Server-side HTTP invitation delivery provider mode for HTTPS mail/webhook providers.
- Account password login for existing team users with server-side salted hashes and scoped member sessions.
- Account recovery foundation with hashed reset tokens, generic public requests, JSONL operator handoff, and stale member-session revocation.
- Owner-only member management for listing workspace members, changing roles, and deactivating memberships with affected member sessions revoked.
- App-level crash recovery boundary with retry and local browser-data reset actions.
- Provider-neutral integration mappings plus a payload-backed GitHub issue import/link API.
- Server-only GitHub App setup and installation verification foundation.
- Live GitHub issue fetch through verified installations without persisted tokens.
- Signed GitHub App, Linear, and Jira webhook ingestion for idempotent linked issue sync, plus safe GitHub installation disconnect handling.
- Hosted GitHub App webhook registration from server-only config, with safe blocked registration records for Linear/Jira until unverifiable provider-created deliveries are supported.
- Encrypted server-only provider credential storage primitives for GitHub, Linear, and Jira.
- Provider-neutral background sync job foundation with private runner boundary and GitHub/Linear/Jira linked-issue workers.
- Settings-managed provider installation bootstrap, credential metadata listing/storage/revoke, and provider-neutral disconnect for GitHub, Linear, and Jira.
- Safe Linear OAuth setup/callback exchange, refresh-token rotation, and payload-backed Linear issue import/link.
- Safe Jira OAuth setup/callback exchange, refresh-token rotation, and payload-backed Jira issue import/link with explicit field mapping and live linked-issue sync.
- Explicit provider write-back from an OpenRoad request to an already-linked GitHub, Linear, or Jira issue title/body with server-only credentials and sanitized responses.
- Settings conflict resolution for linked GitHub, Linear, and Jira issue mappings with keep-OpenRoad, accept-provider, and disconnect-mapping actions.
- Requester notification preferences, internal outbox events, JSONL handoff, and HTTP provider delivery for status and changelog updates.
- Deterministic local assistant triage for request summaries, duplicate hints, and private changelog draft suggestions.
- Server-side assistant model adapter foundation with deterministic fallback, explicit consent gate, prompt redaction, OpenAI Responses API adapter, audit events, and private operational events.
- Browser assistant consent controls for server-backed deployments, with deterministic suggestions by default and safe model/fallback status copy.
- Release candidate manifest tooling for version, checksum, support-window, and dry-run publishing verification.
- Docker Compose, backup/restore, and smoke-check commands for self-host operators.

Current production limits are explicit: built-in SMTP delivery, provider-specific invitation/recovery/notification templates, direct recovery provider delivery, OAuth login, email verification, managed database migrations, hosted release promotion, dashboards/metrics exporters, hosted organization administration, bulk member operations, Linear/Jira hosted webhook creation, workspace AI policy settings, model evals, and AI usage dashboards are planned next-stage work. Admin-token self-hosting has an httpOnly owner browser session path, invitation tokens can create scoped member browser sessions, existing users can sign in with account passwords, password recovery can be routed through a sensitive JSONL handoff without exposing raw reset tokens in team metadata, requester notifications can be handed to JSONL or a server-configured HTTP provider, private structured operational events can be inspected without scraping process logs, and model-backed assistant summary refinement is available only through a server-side explicit-consent adapter.

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
- [Background sync foundation](docs/BACKGROUND_SYNC_FOUNDATION.md)
- [Provider write-back](docs/PROVIDER_WRITE_BACK.md)
- [Provider conflict resolution](docs/PROVIDER_CONFLICT_RESOLUTION.md)
- [Hosted webhook registration](docs/HOSTED_WEBHOOK_REGISTRATION.md)
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
$env:OPENROAD_SESSION_FILE="C:\openroad\openroad-sessions.json"
$env:OPENROAD_SESSION_TTL_MS="604800000"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
$env:OPENROAD_PUBLIC_APP_URL="http://127.0.0.1:4173/"
$env:OPENROAD_WEBHOOK_PUBLIC_BASE_URL=""
$env:OPENROAD_INVITATION_DELIVERY_MODE="disabled"
$env:OPENROAD_INVITATION_DELIVERY_FILE="C:\openroad\openroad-invitation-deliveries.jsonl"
$env:OPENROAD_INVITATION_DELIVERY_HTTP_URL=""
$env:OPENROAD_INVITATION_DELIVERY_HTTP_BEARER_TOKEN=""
$env:OPENROAD_INVITATION_DELIVERY_HTTP_TIMEOUT_MS="10000"
$env:OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE="disabled"
$env:OPENROAD_ACCOUNT_RECOVERY_DELIVERY_FILE="C:\openroad\openroad-account-recovery-deliveries.jsonl"
$env:OPENROAD_ACCOUNT_RECOVERY_PUBLIC_BASE_URL=""
$env:OPENROAD_NOTIFICATION_DELIVERY_MODE="disabled"
$env:OPENROAD_NOTIFICATION_DELIVERY_FILE="C:\openroad\openroad-notification-deliveries.jsonl"
$env:OPENROAD_NOTIFICATION_DELIVERY_HTTP_URL=""
$env:OPENROAD_NOTIFICATION_DELIVERY_HTTP_BEARER_TOKEN=""
$env:OPENROAD_NOTIFICATION_DELIVERY_HTTP_TIMEOUT_MS="10000"
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

Keep `.env.selfhost`, `/data`, backup directories, restore-safety directories, and any configured invitation/recovery/notification delivery JSONL files private. Backups contain OpenRoad product data, requester information, integration metadata, team metadata, invitation token hashes, account recovery token hashes, memberships, and audit events. Invitation and account recovery delivery JSONL files contain raw accept/reset tokens by design so an external delivery worker can send them. HTTP invitation and requester-notification provider bearer tokens are read from environment and must be treated as server secrets. HTTP invitation provider mode requires `OPENROAD_PUBLIC_APP_URL` so invitation links are generated from an operator-owned origin instead of request headers.

The server exposes:

- `GET /api/health`
- `GET /api/openroad/contract`
- `GET /api/openroad/session`
- `POST /api/openroad/auth/login`
- `POST /api/openroad/auth/logout`
- `POST /api/openroad/auth/password/login`
- `POST /api/openroad/account/password`
- `POST /api/openroad/account/recovery/request`
- `POST /api/openroad/account/recovery/confirm`
- `POST /api/openroad/notifications/deliver`
- `POST /api/openroad/invitations/accept`
- `POST /api/openroad/invitations/session`
- `GET /api/openroad/state`
- `PUT /api/openroad/state`
- `POST /api/openroad/actions`
- `GET /api/openroad/workspaces`
- `GET /api/openroad/workspaces/:workspaceId`
- `PUT /api/openroad/workspaces/:workspaceId`
- `POST /api/openroad/workspaces/:workspaceId/actions`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/issues/live`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/app/setup`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/verify`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect`
- `POST /api/openroad/integrations/github/webhook`
- `POST /api/openroad/integrations/linear/webhook`
- `POST /api/openroad/integrations/jira/webhook`
- `POST /api/openroad/workspaces/:workspaceId/integrations/linear/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup`
- `POST /api/openroad/workspaces/:workspaceId/integrations/jira/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/jira/oauth/setup`
- `GET /api/openroad/workspaces/:workspaceId/integrations/:provider/installations`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/installations`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/installations/:installationId/disconnect`
- `GET /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials/:credentialId/revoke`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/write-back`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/conflicts/:mappingId/resolve`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/webhooks/register`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/sync/jobs`
- `GET /api/openroad/workspaces/:workspaceId/invitations`
- `POST /api/openroad/workspaces/:workspaceId/invitations`
- `POST /api/openroad/workspaces/:workspaceId/invitations/:invitationId/revoke`
- `GET /api/openroad/workspaces/:workspaceId/members`
- `PATCH /api/openroad/workspaces/:workspaceId/members/:membershipId`
- `POST /api/openroad/workspaces/:workspaceId/members/:membershipId/deactivate`
- `POST /api/openroad/integrations/sync/run`
- `GET /api/openroad/audit-events`
- `GET /api/openroad/ops/events`
- `GET /api/openroad/ops/status`
- `GET /api/openroad/workspaces/:workspaceId/portal`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/vote`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/comments`

When `OPENROAD_ADMIN_TOKEN` is configured, private state APIs require either `Authorization: Bearer <token>` or an owner session cookie created by the browser sign-in flow or `POST /api/openroad/auth/login`. Invitation tokens can create scoped member session cookies through `POST /api/openroad/invitations/session`; existing team users can set a password through `POST /api/openroad/account/password` and return through `POST /api/openroad/auth/password/login`. Workspace owners can manage members from Settings or the member APIs; role changes and deactivation revoke affected member sessions so stale cookies cannot retain old access. Member sessions use workspace-scoped APIs and cannot read or write full multi-workspace state. The portal API remains public and returns only the public projection. See [API auth and tenancy contract](docs/API_AUTH_TENANCY_CONTRACT.md).

Deployment, backup, restore, smoke, upgrade, and rollback details live in [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md).
