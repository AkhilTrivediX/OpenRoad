# OpenRoad Deployment And Self-Host Runbook

This runbook covers the current production path: one Node process serving the built app, OpenRoad state, integration metadata, team metadata, and public portal APIs. It also defines the first supported self-host path with Docker Compose, backup/restore commands, and smoke checks.

## Current Operator Contract

- OpenRoad is self-hostable as a single Node service.
- Mutable data lives in four JSON files: `OPENROAD_DATA_FILE`, `OPENROAD_INTEGRATION_FILE`, `OPENROAD_TEAM_FILE`, and `OPENROAD_SESSION_FILE`.
- Docker Compose stores those files in the `openroad-data` volume at `/data`.
- `OPENROAD_ADMIN_TOKEN` protects private APIs when configured and can be exchanged for an httpOnly owner browser session.
- Valid invitation tokens can be exchanged for httpOnly member browser sessions scoped to the invited workspace and role.
- Existing team users can set an account password and return through an httpOnly member browser session scoped to one workspace membership.
- Existing credentialed team users can recover account access through a hashed one-time reset token and operator-controlled JSONL handoff.
- Workspace owners can list members, change roles, and deactivate memberships; affected member sessions are revoked on role change or deactivation.
- Invitation delivery is disabled by default; file mode appends raw-token invite handoff records to an operator-controlled JSONL file, and HTTP provider mode posts bounded invite payloads to an operator-configured HTTPS endpoint.
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
$env:OPENROAD_SESSION_FILE="C:\openroad\openroad-sessions.json"
$env:OPENROAD_SESSION_TTL_MS="604800000"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
$env:OPENROAD_OWNER_EMAIL="owner@example.com"
$env:OPENROAD_OWNER_NAME="Workspace Owner"
$env:OPENROAD_ADMIN_TOKEN="replace-with-long-random-token"
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
$env:OPENROAD_TOKEN_ENCRYPTION_KEY=""
$env:OPENROAD_TOKEN_ENCRYPTION_KEY_ID="primary"
$env:OPENROAD_PORTAL_RATE_LIMIT_MAX="30"
$env:OPENROAD_PORTAL_RATE_LIMIT_WINDOW_MS="60000"
$env:OPENROAD_GITHUB_APP_SLUG=""
$env:OPENROAD_GITHUB_APP_ID=""
$env:OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE=""
$env:OPENROAD_GITHUB_APP_WEBHOOK_SECRET=""
$env:OPENROAD_LINEAR_CLIENT_ID=""
$env:OPENROAD_LINEAR_CLIENT_SECRET=""
$env:OPENROAD_LINEAR_REDIRECT_URI=""
$env:OPENROAD_LINEAR_API_URL="https://api.linear.app/graphql"
$env:OPENROAD_LINEAR_TOKEN_URL="https://api.linear.app/oauth/token"
$env:OPENROAD_LINEAR_WEBHOOK_SECRET=""
$env:OPENROAD_JIRA_AUTH_BASE_URL="https://auth.atlassian.com"
$env:OPENROAD_JIRA_RESOURCE_BASE_URL="https://api.atlassian.com"
$env:OPENROAD_JIRA_CLIENT_ID=""
$env:OPENROAD_JIRA_CLIENT_SECRET=""
$env:OPENROAD_JIRA_REDIRECT_URI=""
$env:OPENROAD_JIRA_API_BASE_URL="https://api.atlassian.com/ex/jira"
$env:OPENROAD_JIRA_WEBHOOK_SECRET=""
$env:OPENROAD_SINGLE_USER_MODE="false"
$env:OPENROAD_TRUST_PROXY_HEADERS="false"
$env:PORT="4173"
pnpm start
```

## Environment

```powershell
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:OPENROAD_INTEGRATION_FILE="C:\openroad\openroad-integrations.json"
$env:OPENROAD_SESSION_FILE="C:\openroad\openroad-sessions.json"
$env:OPENROAD_SESSION_TTL_MS="604800000"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
$env:OPENROAD_OWNER_EMAIL="owner@example.com"
$env:OPENROAD_OWNER_NAME="Workspace Owner"
$env:OPENROAD_ADMIN_TOKEN="replace-with-long-random-token"
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
$env:OPENROAD_TOKEN_ENCRYPTION_KEY=""
$env:OPENROAD_TOKEN_ENCRYPTION_KEY_ID="primary"
$env:OPENROAD_PORTAL_RATE_LIMIT_MAX="30"
$env:OPENROAD_PORTAL_RATE_LIMIT_WINDOW_MS="60000"
$env:OPENROAD_GITHUB_APP_SLUG=""
$env:OPENROAD_GITHUB_APP_ID=""
$env:OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE=""
$env:OPENROAD_GITHUB_APP_WEBHOOK_SECRET=""
$env:OPENROAD_LINEAR_CLIENT_ID=""
$env:OPENROAD_LINEAR_CLIENT_SECRET=""
$env:OPENROAD_LINEAR_REDIRECT_URI=""
$env:OPENROAD_LINEAR_API_URL="https://api.linear.app/graphql"
$env:OPENROAD_LINEAR_TOKEN_URL="https://api.linear.app/oauth/token"
$env:OPENROAD_LINEAR_WEBHOOK_SECRET=""
$env:OPENROAD_JIRA_AUTH_BASE_URL="https://auth.atlassian.com"
$env:OPENROAD_JIRA_RESOURCE_BASE_URL="https://api.atlassian.com"
$env:OPENROAD_JIRA_CLIENT_ID=""
$env:OPENROAD_JIRA_CLIENT_SECRET=""
$env:OPENROAD_JIRA_REDIRECT_URI=""
$env:OPENROAD_JIRA_API_BASE_URL="https://api.atlassian.com/ex/jira"
$env:OPENROAD_JIRA_WEBHOOK_SECRET=""
$env:OPENROAD_SINGLE_USER_MODE="false"
$env:OPENROAD_TRUST_PROXY_HEADERS="false"
$env:PORT="4173"
```

Do not expose `OPENROAD_ADMIN_TOKEN` to browser JavaScript beyond the one-time owner login request. In admin-token mode the browser app shows an owner/member sign-in surface: owners submit the admin token to the same-origin server, invited members submit invitation tokens for first access, and existing team users can sign in with email/password after setting an account password. OpenRoad stores only hashed session-token material in `OPENROAD_SESSION_FILE`; deleting that file signs out owner and member browser sessions without touching product data.

Treat `OPENROAD_INVITATION_DELIVERY_FILE` as sensitive when invitation delivery file mode is enabled. The file contains raw invitation accept tokens and links for external mail/helpdesk workers. Treat `OPENROAD_ACCOUNT_RECOVERY_DELIVERY_FILE` as sensitive when account recovery file mode is enabled. It contains raw recovery tokens and reset links for external mail/helpdesk workers. These delivery files are not included in OpenRoad backups and should be rotated, shipped, or deleted according to your operations policy. Treat `OPENROAD_INVITATION_DELIVERY_HTTP_BEARER_TOKEN` as a server secret when HTTP provider mode is enabled; OpenRoad sends it only as an outbound authorization header.

Do not expose GitHub App private keys, GitHub webhook secrets, Linear client/webhook secrets, Jira client/webhook secrets, or `OPENROAD_TOKEN_ENCRYPTION_KEY` to browser JavaScript. Prefer `OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE` for self-host installs.

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
- Stores product, integration, session, and team data in the `openroad-data` volume.
- Runs with `OPENROAD_SINGLE_USER_MODE=false`.
- Requires `OPENROAD_ADMIN_TOKEN` before startup.
- Keeps invitation delivery disabled unless `OPENROAD_INVITATION_DELIVERY_MODE=file` or `OPENROAD_INVITATION_DELIVERY_MODE=http` is configured.
- Keeps account recovery delivery disabled unless `OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE=file` is configured.
- Keeps requester notification delivery disabled unless `OPENROAD_NOTIFICATION_DELIVERY_MODE=file` is configured.
- Keeps provider credential storage disabled unless `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured.
- Applies process-local public portal write limits from `OPENROAD_PORTAL_RATE_LIMIT_MAX` and `OPENROAD_PORTAL_RATE_LIMIT_WINDOW_MS`.

## Admin Bootstrap

The first local owner is seeded from:

- `OPENROAD_OWNER_EMAIL`
- `OPENROAD_OWNER_NAME`

Changing these values later does not rewrite existing team metadata. To change access after metadata exists, use the invitation APIs and owner member-management Settings surface to add, role-change, or deactivate durable workspace members, or intentionally restore edited metadata from backup. Account password login applies to existing team users; it does not rewrite the seeded owner identity.

## Operational Commands

OpenRoad ships a small dependency-free operations CLI.

```powershell
pnpm ops:backup -- --output-dir C:\openroad\backups
pnpm ops:restore -- --input-dir C:\openroad\backups\openroad-backup-2026-07-04T10-00-00-000Z
pnpm ops:smoke -- --base-url http://127.0.0.1:4173 --workspace-id acme --admin-token $env:OPENROAD_ADMIN_TOKEN
```

For Docker Compose, run the same commands from the repository checkout on the host. Point `OPENROAD_DATA_FILE`, `OPENROAD_INTEGRATION_FILE`, `OPENROAD_SESSION_FILE`, and `OPENROAD_TEAM_FILE` at bind-mounted files if you manage data outside the named Docker volume. For named volumes, use `docker compose cp` or a temporary helper container to copy `/data/openroad-state.json`, `/data/openroad-integrations.json`, `/data/openroad-sessions.json`, and `/data/openroad-team.json` before running host-side restore operations.

## Release Candidate Manifest

After `pnpm check` builds the production client and server, generate or verify a release manifest:

```powershell
pnpm release:verify
pnpm release:plan -- --version 0.1.0-rc.1 --channel rc --output .openroad\releases\openroad-0.1.0-rc.1.json
```

The manifest records the release version, channel, git commit, required gates, support window, rollback note, and SHA-256 checksums for local build artifacts. Docker registry publishing and artifact signing remain dry-run/not-configured unless an operator supplies external publishing or signing metadata. Do not publish a release as signed or registry-published unless the generated manifest says that mode is configured.

## Backup

Back up the product, integration, session, and team files together. They form one logical data snapshot. Restoring a backup restores active owner sessions unless the operator deletes `openroad-sessions.json` after restore.

```powershell
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:OPENROAD_INTEGRATION_FILE="C:\openroad\openroad-integrations.json"
$env:OPENROAD_SESSION_FILE="C:\openroad\openroad-sessions.json"
$env:OPENROAD_TEAM_FILE="C:\openroad\openroad-team.json"
pnpm ops:backup -- --output-dir C:\openroad\backups
```

The backup directory contains:

- `openroad-state.json`
- `openroad-integrations.json`
- `openroad-sessions.json`
- `openroad-team.json`
- `manifest.json`

The manifest records creation time, app package version, source paths, file sizes, and schema versions. Backups are not encrypted by OpenRoad tooling; use your host, storage, or secret-management system to protect them. When provider credentials exist, `openroad-integrations.json` contains encrypted token material and must be treated as sensitive. `openroad-sessions.json` stores session and admin-token hashes, not raw tokens, but should still be treated as operationally sensitive. `openroad-team.json` stores invitation token hashes, account password hashes/salts, membership data, and audit events.

## Data Schema Notes

OpenRoad state schema `7` stores anonymous public portal voter keys and requester notification delivery metadata inside `openroad-state.json`. Upgrade from schema `6` is automatic on load and initializes existing notification events with `deliveryAttempts: 0`. Downgrading to a schema `6` or older build after schema `7` data is written requires restoring a pre-upgrade backup.

Integration metadata schema `4` stores server-only encrypted provider credential records, background sync job metadata, and hosted webhook registration metadata in `openroad-integrations.json`. Upgrade from schema `1`, `2`, or `3` is automatic on load and initializes missing `credentials: []`, `syncJobs: []`, and `webhookRegistrations: []`. Downgrading to an older integration metadata build after credentials, sync jobs, or webhook registration records are created requires revoking/removing credentials, draining/removing sync jobs, resetting external webhook config where needed, or restoring a pre-upgrade integration backup.

Session metadata schema `2` stores actor-aware owner and workspace-member browser session records in `openroad-sessions.json`. Owner records remain bound to the active admin-token hash; member records store the workspace-member actor and do not store admin-token material. Records contain hashes, ids, timestamps, and bounded client metadata only. Schema `1` owner-session files migrate automatically on load. Deleting this file signs out browsers without changing OpenRoad product data.

Team metadata schema `5` stores users, memberships, audit events, invitations, bounded invitation delivery status metadata, account password credential records, and account recovery request metadata in `openroad-team.json`. Invitation records store hashed accept tokens only. Account recovery records store hashed reset tokens only. Account credential records store algorithm, salt, hash, user id, and timestamps only; raw passwords are not stored. Member role changes, deactivation, and account recovery completion use existing session schema `2` revocation records; no session schema bump is required. Restoring a pre-schema-2 team file automatically migrates invitations to an empty list; restoring schema `2`, `3`, or `4` team files automatically adds missing delivery, credential, or recovery collections. Rolling back across this schema should preserve a backup first; reverting to a build that only understands schema `1`, `2`, `3`, or `4` requires restoring the previous team metadata backup or intentionally discarding newer account recovery metadata after backup.

## Provider Token Storage

Provider credential storage is disabled by default. To allow workspace owners/admins to create encrypted provider credential records for later sync workers, configure:

```powershell
$env:OPENROAD_TOKEN_ENCRYPTION_KEY="replace-with-at-least-32-random-characters"
$env:OPENROAD_TOKEN_ENCRYPTION_KEY_ID="primary"
```

Credential and provider installation management APIs require `integration:manage` and return only metadata. Settings can manually bootstrap GitHub, Linear, or Jira installation metadata, store encrypted provider credentials, list/revoke credential metadata, and disconnect provider installations from the same-origin app. Linear and Jira sync workers refresh expired or near-expired OAuth credentials server-side and rotate encrypted access-token and refresh-token material without exposing secrets to the browser. Credential responses never return access tokens, refresh tokens, ciphertext, IVs, tags, or the encryption key. Provider disconnect revokes matching active credentials, disconnects matching mappings, and preserves OpenRoad product data. Signed GitHub installation deletion webhooks keep the same credential-revocation behavior.

## Provider Webhooks

OpenRoad accepts provider webhook callbacks only when the matching server-only secret is configured:

- GitHub: `POST /api/openroad/integrations/github/webhook` with `OPENROAD_GITHUB_APP_WEBHOOK_SECRET` and `X-Hub-Signature-256`.
- Linear: `POST /api/openroad/integrations/linear/webhook` with `OPENROAD_LINEAR_WEBHOOK_SECRET` and `Linear-Signature`.
- Jira: `POST /api/openroad/integrations/jira/webhook` with `OPENROAD_JIRA_WEBHOOK_SECRET`, `X-Hub-Signature`, and `X-Atlassian-Webhook-Identifier`.

Linear and Jira webhooks refresh already-linked issue mappings for active installations that include `webhook:receive`; they do not create new OpenRoad requests from provider payloads. Duplicate delivery ids are no-ops, raw provider payloads are not persisted, and webhook responses return sanitized sync-event metadata only.

Hosted webhook registration is available at:

- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/webhooks/register`

The route requires `integration:manage` and accepts only an `installationId`. For GitHub, OpenRoad uses server-only GitHub App credentials to update the GitHub App webhook config to `${OPENROAD_WEBHOOK_PUBLIC_BASE_URL || OPENROAD_PUBLIC_APP_URL}/api/openroad/integrations/github/webhook`, with JSON payloads, SSL verification enabled, and `OPENROAD_GITHUB_APP_WEBHOOK_SECRET` as the shared secret. Linear and Jira registration attempts are recorded as blocked unless OpenRoad can verify future provider-created deliveries with a server-known secret; OpenRoad does not create unverifiable Linear/Jira provider webhooks. Settings shows the registration control only when the server reports a safe capability.

For hosted GitHub registration, configure `OPENROAD_PUBLIC_APP_URL` or `OPENROAD_WEBHOOK_PUBLIC_BASE_URL`. The public base must be HTTPS except for localhost/loopback development and tests.

Changing the encryption key without re-encrypting credentials will make existing encrypted payloads unreadable to future sync workers. This release does not include external KMS or re-encryption tooling.

## Background Sync Foundation

OpenRoad stores provider-neutral sync jobs in `openroad-integrations.json` and exposes private sync job routes:

- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/conflicts/:mappingId/resolve`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/sync/jobs`
- `POST /api/openroad/integrations/sync/run`

The enqueue endpoint requires `integration:manage`. The runner endpoint requires global owner/admin write access. When GitHub App credentials are configured, OpenRoad auto-wires a GitHub worker for already-linked issue mappings. When `OPENROAD_TOKEN_ENCRYPTION_KEY` and active provider credentials are configured, OpenRoad auto-wires Linear and Jira workers for already-linked issue mappings. Without an available worker, the runner returns `503 not_configured`. Jobs contain scoped metadata and bounded, redacted summaries only; they must not contain provider tokens, encrypted credential payloads, raw provider payloads, webhook signatures, request headers, or request bodies.

While OpenRoad uses file-backed integration metadata, integration writes are serialized inside one Node process. Running jobs receive a lease and can be reclaimed after the lease expires if a process crashes mid-run. Multi-process/distributed locking remains future database or external queue work.

## Invitation Delivery Handoff

Invitation delivery is disabled by default. To hand created invitation links to a local operational mail/helpdesk worker, configure:

```powershell
$env:OPENROAD_PUBLIC_APP_URL="https://openroad.example.com/"
$env:OPENROAD_INVITATION_DELIVERY_MODE="file"
$env:OPENROAD_INVITATION_DELIVERY_FILE="C:\openroad\openroad-invitation-deliveries.jsonl"
```

Then create an invitation through the owner Settings surface or API:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4173/api/openroad/workspaces/acme/invitations" `
  -Headers @{ Authorization = "Bearer $env:OPENROAD_ADMIN_TOKEN" } `
  -ContentType "application/json" `
  -Body '{"email":"teammate@example.com","role":"Contributor"}'
```

The file adapter appends one JSONL record with the invitee email/name, role, workspace id/name, expiration, subject/body, raw accept token, and accept URL. OpenRoad stores only delivery status metadata in `openroad-team.json`; raw invitation tokens stay out of team metadata, list APIs, audit events, and backups. The app reads `?invite=<token>` links and pre-fills the member join form, then removes the token from browser history.

The JSONL handoff does not send SMTP, SES, SendGrid, Mailgun, Slack, or provider messages by itself.

To send invitation payloads to an HTTPS mail/webhook provider, configure:

```powershell
$env:OPENROAD_PUBLIC_APP_URL="https://openroad.example.com/"
$env:OPENROAD_INVITATION_DELIVERY_MODE="http"
$env:OPENROAD_INVITATION_DELIVERY_HTTP_URL="https://mail-provider.example.com/openroad/invitations"
$env:OPENROAD_INVITATION_DELIVERY_HTTP_BEARER_TOKEN="replace-with-provider-token"
$env:OPENROAD_INVITATION_DELIVERY_HTTP_TIMEOUT_MS="10000"
```

HTTP provider mode requires `OPENROAD_PUBLIC_APP_URL`; local request headers are not used to form provider invite links. Provider URLs must be HTTPS, except `http://localhost`, `http://127.0.0.1`, and `http://[::1]` for local development and tests. URLs containing usernames or passwords are rejected.

OpenRoad posts one JSON payload with the invitee email/name, role, workspace id/name, expiration, subject/body, invitation id, and accept URL. The optional bearer token is sent only as `Authorization: Bearer ...`; it is not persisted, returned, or exposed to browser code. Provider responses may return a JSON `messageId`, `message_id`, `id`, or `x-message-id` header; OpenRoad stores only bounded, redacted delivery metadata.

Non-2xx responses, malformed success responses, timeouts, aborts, and network errors mark invitation delivery as `failed` while keeping the invitation pending, usable, and revokable. This mode does not include a retry scheduler, bounce handling, suppression lists, verified sender setup, or provider-specific templates.

## Account Password Login

Account passwords are available only for existing team users. A teammate first joins by invitation or already exists in team metadata, then sets a password from the authenticated Settings access panel. The server stores only salted password hashes in `openroad-team.json`.

API clients can use the same boundary:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4173/api/openroad/account/password" `
  -WebSession $session `
  -ContentType "application/json" `
  -Body '{"password":"replace-with-long-user-password"}'
```

After a password exists, the user can create a scoped member session:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4173/api/openroad/auth/password/login" `
  -SessionVariable session `
  -ContentType "application/json" `
  -Body '{"email":"teammate@example.com","password":"replace-with-long-user-password","workspaceId":"acme"}'
```

`workspaceId` is optional for users with exactly one active membership and required when the same account belongs to multiple workspaces. Account passwords do not create users, verify email ownership, reset forgotten passwords, or grant access beyond the user's persisted workspace memberships.

## Account Recovery Handoff

Account recovery delivery is disabled by default. To hand password reset links to a local operational mail/helpdesk worker, configure:

```powershell
$env:OPENROAD_PUBLIC_APP_URL="https://openroad.example.com/"
$env:OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE="file"
$env:OPENROAD_ACCOUNT_RECOVERY_DELIVERY_FILE="C:\openroad\openroad-account-recovery-deliveries.jsonl"
$env:OPENROAD_ACCOUNT_RECOVERY_PUBLIC_BASE_URL=""
```

The public request endpoint is intentionally generic:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4173/api/openroad/account/recovery/request" `
  -ContentType "application/json" `
  -Body '{"email":"teammate@example.com","workspaceId":"acme"}'
```

It returns the same response for existing users, unknown users, users without password credentials, ambiguous workspace memberships, and disabled delivery. When a credentialed existing user and workspace are eligible, OpenRoad stores only a hashed, expiring recovery token in `openroad-team.json` and appends one sensitive JSONL record with the raw recovery token and reset URL to the configured file.

Users complete recovery through the browser reset link or API:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4173/api/openroad/account/recovery/confirm" `
  -SessionVariable session `
  -ContentType "application/json" `
  -Body '{"token":"orec_from_delivery_file","password":"replace-with-new-long-password","workspaceId":"acme"}'
```

Recovery confirmation consumes the token, sets a new salted password hash, revokes active member sessions for that user, and returns a fresh httpOnly member session. Recovery tokens are single-use and expire. OpenRoad does not send recovery email directly, verify mailbox ownership, throttle by distributed identity, or provide provider-specific templates in this slice.

## Member Management

Workspace owners can review and manage access from Settings or the owner-only member APIs:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://127.0.0.1:4173/api/openroad/workspaces/acme/members" `
  -Headers @{ Authorization = "Bearer $env:OPENROAD_ADMIN_TOKEN" }
```

Role changes and deactivation are membership-scoped:

```powershell
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://127.0.0.1:4173/api/openroad/workspaces/acme/members/membership-id" `
  -Headers @{ Authorization = "Bearer $env:OPENROAD_ADMIN_TOKEN" } `
  -ContentType "application/json" `
  -Body '{"role":"Viewer"}'

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4173/api/openroad/workspaces/acme/members/membership-id/deactivate" `
  -Headers @{ Authorization = "Bearer $env:OPENROAD_ADMIN_TOKEN" }
```

Both mutations record audit events and revoke active workspace-member sessions for the affected user/workspace. Deactivation removes the workspace membership only; the user and password credential remain in team metadata for other memberships or future reactivation. The local owner membership and the last owner membership are protected from role change or deactivation.

## Requester Notification Delivery

Requester notification delivery is disabled by default. To hand queued notifications to a local operational worker, configure:

```powershell
$env:OPENROAD_NOTIFICATION_DELIVERY_MODE="file"
$env:OPENROAD_NOTIFICATION_DELIVERY_FILE="C:\openroad\openroad-notification-deliveries.jsonl"
```

Then call the private delivery endpoint with the admin token:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:4173/api/openroad/notifications/deliver" `
  -Headers @{ Authorization = "Bearer $env:OPENROAD_ADMIN_TOKEN" } `
  -ContentType "application/json" `
  -Body '{"workspaceId":"acme"}'
```

The file adapter appends public-safe JSONL records and marks queued events delivered. It does not send email or provider messages by itself.

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

1. Read the release manifest, release notes, and migration notes.
2. Stop writes to the instance.
3. Run `pnpm ops:backup` and verify the backup directory has a manifest and all four data files.
4. Deploy the new application version or rebuild the Docker image.
5. Start OpenRoad.
6. Confirm automatic state migration succeeds when the release notes mention a schema bump.
7. Run `pnpm ops:smoke`.
8. Check `/api/openroad/ops/status` with the admin token.
9. Reopen access.

## Rollback

1. Stop the server.
2. Preserve the current data files as a failed-upgrade backup.
3. Restore the previous application build or Docker image.
4. Restore the last known-good data/team backup if the new version changed, migrated, or damaged runtime data.
5. Start OpenRoad.
6. Run the smoke test before reopening access.

## Endpoint Smoke Checklist

- `GET /api/health` should return `200`.
- `GET /api/openroad/contract` should return the API contract.
- `GET /api/openroad/session` should return public actor metadata before login.
- `GET /api/openroad/workspaces/acme/portal` should return public data only.
- With `OPENROAD_ADMIN_TOKEN` configured, unauthenticated `GET /api/openroad/state` should return `403`.
- With the same admin token posted to `POST /api/openroad/auth/login`, the response should set an `openroad_session` cookie using `HttpOnly` and `SameSite=Lax`.
- With that cookie, `GET /api/openroad/state` should return `200`.
- After `POST /api/openroad/auth/logout`, the same cookie should no longer read private state.
- With `Authorization: Bearer <token>`, `GET /api/openroad/state` should return `200`.
- `GET /api/openroad/ops/status` should require private read permission.
- `POST /api/openroad/notifications/deliver` should require private write permission and return `503` unless a delivery adapter is configured.
- `POST /api/openroad/workspaces/acme/invitations` should require owner/admin permission and return a one-time accept token only on creation.
- With `OPENROAD_INVITATION_DELIVERY_MODE=file`, invitation creation should append one sensitive JSONL delivery record and return delivery status metadata.
- With `OPENROAD_INVITATION_DELIVERY_MODE=http`, `OPENROAD_PUBLIC_APP_URL`, and a local provider endpoint, invitation creation should post one bounded provider payload and return delivery status metadata without exposing the provider bearer token or raw accept token beyond the one-time `acceptToken`.
- With `OPENROAD_INVITATION_DELIVERY_MODE=http` and no `OPENROAD_PUBLIC_APP_URL`, invitation creation should remain `201`, mark delivery failed, skip the provider call, and keep the invitation usable.
- `POST /api/openroad/invitations/accept` should accept a valid pending invitation token without returning private workspace state.
- `POST /api/openroad/account/password` should require an authenticated owner/member session and store only hashed credential metadata.
- `POST /api/openroad/auth/password/login` should create a scoped member session for a valid existing team user and reject wrong passwords without echoing submitted values.
- `POST /api/openroad/account/recovery/request` should return a generic success response for known and unknown emails, and should write no delivery record unless recovery file mode is configured and the existing account is eligible.
- With `OPENROAD_ACCOUNT_RECOVERY_DELIVERY_MODE=file`, account recovery request should append one sensitive JSONL delivery record and store only hashed recovery metadata in team state.
- `POST /api/openroad/account/recovery/confirm` should consume a valid recovery token, set a new password, revoke stale member sessions for that user, and create a fresh httpOnly member session without echoing token or password values.
- `GET /api/openroad/workspaces/acme/members` should require owner/admin permission and return only sanitized member summaries.
- `PATCH /api/openroad/workspaces/acme/members/:membershipId` should require owner/admin permission, update the role, and revoke affected member sessions.
- `POST /api/openroad/workspaces/acme/members/:membershipId/deactivate` should require owner/admin permission, remove only that workspace membership, and revoke affected member sessions.

## Security Notes

- Keep `.env.selfhost` out of git.
- Rotate `OPENROAD_ADMIN_TOKEN` after accidental exposure. Existing browser sessions are bound to the active admin-token hash and become unusable after rotation.
- Keep `OPENROAD_TRUST_PROXY_HEADERS=false` unless a trusted reverse proxy is enforcing identity headers.
- Do not publish `/data`, backup directories, or restore-safety directories.
- Do not publish invitation delivery JSONL files; they contain raw accept tokens.
- Do not publish account recovery delivery JSONL files; they contain raw reset tokens.
- Keep HTTP invitation provider bearer tokens in server environment or secret storage only.
- Treat backup archives as sensitive because they contain requester, workspace, membership, and audit data.
- Tune public portal rate limits for the deployment shape. Current limits are process-local and reset on restart.
- Review release manifests before sharing them; they should contain checksums and release metadata, not secrets or product data.

## Current Limits

- Owner browser sessions for admin-token self-hosting, backend invitation APIs, invitation UI, member invite sessions, JSONL invitation delivery handoff, HTTP invitation provider delivery, account password login and JSONL account recovery for existing team users, and owner member role/deactivation controls are implemented; built-in SMTP delivery, provider-specific invitation/recovery templates, OAuth login, email verification, bulk member operations, MFA/passkeys, SSO, and hosted account management are not implemented.
- Team metadata is file-backed, not managed SQL.
- Trusted proxy headers are disabled by default.
- Payload-backed GitHub issue import, GitHub App installation verification, live issue fetch, signed GitHub/Linear/Jira webhooks, hosted GitHub App webhook registration, safe disconnect APIs, encrypted server-only provider credential storage, provider-neutral background sync job metadata, GitHub/Linear/Jira workers for already-linked issue mappings, Linear/Jira OAuth callback exchange and refresh-token rotation, explicit provider write-back for linked GitHub/Linear/Jira issues, provider conflict resolution controls, payload-backed Linear issue import, payload-backed Jira issue import, requester notification outbox/preferences, and a server-side JSONL notification delivery handoff exist; direct email/provider notification delivery, Linear/Jira hosted webhook creation, and billing are not implemented.
- Docker images are build-local by default; release manifests can record publishing metadata, but registry publishing infrastructure is not bundled yet.
- Signed artifact infrastructure is not bundled yet; release manifests record signing as not configured unless an operator supplies signing metadata.
- Named Docker volume backup requires an operator copy step or a future packaged volume helper.
- Public portal rate limits are in-memory per Node process; distributed deployments need a shared limiter in a future slice.
