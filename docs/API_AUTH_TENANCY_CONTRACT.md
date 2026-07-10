# OpenRoad API Auth And Tenancy Contract

This contract defines the first enforceable trust boundary for OpenRoad. It is not a full auth provider. It exists so every future auth, team, integration, and public feature has a stable permission model instead of treating server APIs as public by accident.

## API Version

Current API version: `2026-07-05`

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
- Workspace member: authenticated workspace user created from an accepted invitation session.
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
- `POST /api/openroad/auth/login` can exchange the admin token for an httpOnly owner session cookie.
- Browser calls may use the owner session cookie instead of an `Authorization` header.
- `POST /api/openroad/invitations/session` can exchange a valid pending invitation token for an httpOnly member session cookie scoped to the invited workspace and role.
- `POST /api/openroad/auth/password/login` can exchange an existing team user's email/password credential for an httpOnly member session cookie scoped to one of that user's persisted workspace memberships.
- Owner/admin actions such as `replace-state`, `replace-workspace`, and `create-workspace` require owner/admin permission.
- Workspace-member sessions can use workspace-scoped read/write APIs according to role, but cannot use full-state APIs.
- Public portal endpoints remain public.

Do not expose `OPENROAD_ADMIN_TOKEN` to browser JavaScript beyond the one-time login request. The server stores only a hash of generated session tokens. Owner sessions are bound to the active admin token hash. Member sessions are bound to the persisted workspace-member actor and do not store admin-token material.

### Owner Browser Sessions

Owner sessions are stored outside core product state in `OPENROAD_SESSION_FILE`, defaulting to `.openroad/openroad-sessions.json`. Session cookies use `HttpOnly`, `SameSite=Lax`, `Path=/`, and a bounded `Max-Age`. The server adds `Secure` when the request is HTTPS or when trusted proxy headers are enabled and `x-forwarded-proto` is `https`.

`POST /api/openroad/auth/logout` revokes the current session and clears the browser cookie. Rotating `OPENROAD_ADMIN_TOKEN` invalidates existing sessions because the persisted session record is bound to the admin token hash.

### Member Browser Sessions

Invitation session acceptance is public only because the invitation token is the bearer secret. `POST /api/openroad/invitations/session` accepts a valid pending token, creates or reuses the invited team user and workspace membership, marks the invitation accepted, creates an httpOnly session cookie, and returns only sanitized actor, membership, invitation, and user metadata. It must not return the raw invitation token, session cookie value, session token hash, admin token, private workspace state, or cross-workspace membership data.

Member sessions resolve as `workspace-member` actors. They can read `GET /api/openroad/workspaces`, read `GET /api/openroad/workspaces/:workspaceId` for allowed workspaces, and write workspace-scoped actions or `PUT /api/openroad/workspaces/:workspaceId` when their role grants `workspace:write`. They cannot read or write `/api/openroad/state`, create global workspaces, manage provider credentials, manage invitations unless their role grants owner-level integration management, or access another workspace.

### Account Password Sessions

Account passwords are credentials for existing team users only. `POST /api/openroad/account/password` requires an authenticated local-owner or workspace-member session and stores a per-user salted password hash in `OPENROAD_TEAM_FILE`; it must not store or return raw passwords. `POST /api/openroad/auth/password/login` is public because the email/password pair is the bearer secret; successful login creates the same httpOnly workspace-member session type used by invitation sessions. If a user belongs to multiple workspaces, the login request must include a workspace id and can only select an existing membership for that user.

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
- `GET /api/openroad/session`
- `POST /api/openroad/auth/login`
- `POST /api/openroad/auth/logout`
- `POST /api/openroad/auth/password/login`
- `POST /api/openroad/invitations/accept`
- `POST /api/openroad/invitations/session`
- `GET /api/openroad/workspaces/:workspaceId/portal`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/vote`
- `POST /api/openroad/workspaces/:workspaceId/portal/requests/:requestId/comments`

Public portal responses use the OpenRoad public projection and must not include requester source, internal comments, hidden comments, private roadmap items, private changelog entries, draft changelog entries, or private notes. Public portal write routes must validate portal settings, public request visibility, requester scope, and rate limits before mutation.

Session/auth routes return only current actor, login-required flags, safe auth capability metadata, and bounded session status. They must not return admin tokens, bearer tokens, session cookie values, session token hashes, provider tokens, encrypted credentials, or private OpenRoad state.

Password login must reject malformed input, unknown users, wrong passwords, and invalid workspace selection with bounded errors that do not echo submitted secrets. It returns only sanitized session status and never returns password hashes, salts, raw passwords, full team metadata, or private multi-workspace state.

API-only invitation acceptance remains available at `POST /api/openroad/invitations/accept`. It accepts a valid pending token and creates or reuses the invited team user and workspace membership without creating a browser session. Browser invitation acceptance uses `POST /api/openroad/invitations/session` and creates the scoped member session described above. Both endpoints must reject accepted, revoked, expired, malformed, or wrong tokens with generic invalid request errors and must not expose token hashes.

## Private Routes

- `GET /api/openroad/state`
- `PUT /api/openroad/state`
- `POST /api/openroad/actions`
- `POST /api/openroad/account/password`
- `GET /api/openroad/workspaces`
- `GET /api/openroad/workspaces/:workspaceId`
- `PUT /api/openroad/workspaces/:workspaceId`
- `POST /api/openroad/workspaces/:workspaceId/actions`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/issues/live`
- `GET /api/openroad/workspaces/:workspaceId/integrations/github/app/setup`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/verify`
- `POST /api/openroad/workspaces/:workspaceId/integrations/github/app/installations/:installationId/disconnect`
- `GET /api/openroad/workspaces/:workspaceId/integrations/status`
- `POST /api/openroad/workspaces/:workspaceId/integrations/linear/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/linear/oauth/setup`
- `POST /api/openroad/workspaces/:workspaceId/integrations/jira/issues/import`
- `GET /api/openroad/workspaces/:workspaceId/integrations/jira/oauth/setup`
- `GET /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/credentials/:credentialId/revoke`
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/sync/jobs`
- `GET /api/openroad/workspaces/:workspaceId/invitations`
- `POST /api/openroad/workspaces/:workspaceId/invitations`
- `POST /api/openroad/workspaces/:workspaceId/invitations/:invitationId/revoke`
- `GET /api/openroad/workspaces/:workspaceId/members`
- `PATCH /api/openroad/workspaces/:workspaceId/members/:membershipId`
- `POST /api/openroad/workspaces/:workspaceId/members/:membershipId/deactivate`
- `GET /api/openroad/audit-events`
- `GET /api/openroad/ops/status`

Workspace-scoped routes require the actor to be scoped to the requested workspace unless the actor is the local owner/admin.

Workspace-scoped action and workspace replacement responses return the updated workspace and a revision marker. They must not return the full multi-workspace state.

GitHub issue import is workspace-scoped and requires workspace write permission. It accepts fixture/API payloads only in the current slice; it must not accept GitHub OAuth tokens, App private keys, webhook secrets, or raw credential fields.

GitHub live issue fetch requires workspace write permission or a scoped integration actor. It generates short-lived installation access tokens server-side and must never persist, audit, or return those tokens.

Workspace integration status requires workspace read permission. It returns bounded provider status, active installation counts, linked mapping counts, capability flags, and sanitized recent sync job summaries for the requested workspace only. It must not return credentials, encrypted secrets, installation tokens, webhook payloads, private keys, authorization headers, or cross-workspace records.

GitHub App setup and installation verification require `integration:manage`, which is reserved for local owners/admins and workspace owners. Contributor, viewer, requester, public visitor, and integration actors cannot verify new GitHub App installations.

GitHub App disconnect also requires `integration:manage`. It marks installation metadata and mappings disconnected without deleting OpenRoad objects.

Linear issue import is workspace-scoped and requires workspace write permission. It accepts fixture/API payloads only in the current slice; it must not accept Linear OAuth tokens, refresh tokens, client secrets, webhook secrets, or raw OAuth codes.

Linear OAuth setup requires `integration:manage`, which is reserved for local owners/admins and workspace owners. It returns a safe authorization URL and setup state, but does not exchange OAuth codes or persist tokens.

Jira issue import is workspace-scoped and requires workspace write permission. It accepts fixture/API payloads only in the current slice; it must not accept Atlassian OAuth tokens, refresh tokens, client secrets, webhook secrets, or raw OAuth codes.

Jira OAuth setup requires `integration:manage`, which is reserved for local owners/admins and workspace owners. It returns a safe Atlassian authorization URL and setup state, but does not exchange OAuth codes or persist tokens.

Jira live sync requires a queued sync job, an active Jira installation, an active encrypted Jira credential with `read:external`, and the private sync runner. It fetches already-linked issues server-side through Jira Cloud REST and must never return access tokens, authorization headers, encrypted credential internals, or raw Jira REST payloads.

Provider credential create/list/revoke routes require `integration:manage`, which is reserved for local owners/admins and workspace owners. Credential storage requires `OPENROAD_TOKEN_ENCRYPTION_KEY`; credentials must be scoped to an active installation in the same workspace and provider. Responses return only metadata and never return access tokens, refresh tokens, ciphertext, IVs, tags, or encryption key material.

Integration sync job enqueue routes require `integration:manage`, which is reserved for local owners/admins and workspace owners. Jobs must be scoped to an active installation in the same workspace and provider. Responses return sanitized job metadata and never return provider tokens, encrypted credentials, raw provider payloads, webhook signatures, request headers, or request bodies. Concurrent integration metadata writes are serialized inside one Node process while OpenRoad uses file-backed stores.

Invitation management routes require `integration:manage`, which is reserved for local owners/admins and workspace owners. Creating an invitation returns the raw accept token exactly once and stores only a hash in `OPENROAD_TEAM_FILE`; invitation records were introduced in team metadata schema `2`, delivery metadata in schema `3`, and account credentials in schema `4`. When `OPENROAD_INVITATION_DELIVERY_MODE=file` is configured, creation also writes a server-side JSONL delivery handoff record containing the raw accept token and accept URL for an external mail/helpdesk worker. List, revoke, accept, session, audit, and ops API responses must not return invitation token hashes or raw accept tokens after creation. Team backups are sensitive restorable snapshots and may contain token hashes, but never raw accept tokens. Direct SMTP/provider invitation sending, OAuth login, and account recovery remain out of scope for this slice.

Account password routes require `account:write`, which is granted to local owners/admins and authenticated workspace members for their own team user. `POST /api/openroad/account/password` can set an initial password for the authenticated actor's team user and requires the current password for subsequent member changes. Local owners may bootstrap their own credential from an owner session without a previous password. Credential records in team metadata schema `4` store only algorithm, salt, hash, user id, and timestamps; they must not contain raw passwords, invitation tokens, session tokens, admin tokens, provider tokens, or external authorization material.

Member management routes require `integration:manage`, which is reserved for local owners/admins and workspace owners. `GET /api/openroad/workspaces/:workspaceId/members` returns only sanitized membership summaries: membership id, user id, workspace id, name, email, role, creation timestamp, local-owner flag, and boolean account-password readiness. `PATCH /api/openroad/workspaces/:workspaceId/members/:membershipId` changes a persisted workspace role, records an audit event, and revokes active workspace-member sessions for that user/workspace so stale cookies cannot keep old permissions. `POST /api/openroad/workspaces/:workspaceId/members/:membershipId/deactivate` removes only that workspace membership, preserves the user and credential record for other memberships or future reactivation, records an audit event, and revokes affected member sessions. Member responses must not return password hashes, salts, session records, session token hashes, admin-token hashes, invitation token hashes, raw invitation tokens, provider tokens, encrypted provider payloads, or private workspace state. The local owner bootstrap membership cannot be deactivated or role-changed, and the last owner membership in a workspace cannot be demoted or deactivated. This feature uses existing team schema `4` and session schema `2`; no schema bump is required.

## Provider-Signature Routes

- `POST /api/openroad/integrations/github/webhook`

## Global Private Worker Routes

- `POST /api/openroad/integrations/sync/run`

The sync runner route requires global owner/admin write access. It auto-configures a GitHub worker when GitHub App credentials are available and Linear/Jira workers when `OPENROAD_TOKEN_ENCRYPTION_KEY` plus active provider credentials are available. It stays disabled with `503 not_configured` when no server-side integration sync worker adapter can be configured. The runner claims due queued or stale-running jobs, processes them server-side, redacts worker failure text before persistence, and returns sanitized processing counts.

The GitHub webhook route is not authorized by OpenRoad actor headers. It is provider-signature protected: the server requires `OPENROAD_GITHUB_APP_WEBHOOK_SECRET` and verifies `X-Hub-Signature-256` against the raw request body with HMAC-SHA256 before parsing JSON or mutating state.

Valid deliveries are processed as integration actor work after the target workspace is derived from existing installation/mapping metadata. Duplicate delivery IDs are idempotent no-ops. Webhook secrets, raw payloads, signatures, and request headers must not be persisted or returned.

## Environment

```powershell
$env:OPENROAD_ADMIN_TOKEN="replace-with-long-random-token"
$env:OPENROAD_SESSION_FILE=".openroad/openroad-sessions.json"
$env:OPENROAD_SESSION_TTL_MS="604800000"
$env:OPENROAD_INTEGRATION_FILE=".openroad/openroad-integrations.json"
$env:OPENROAD_TEAM_FILE=".openroad/openroad-team.json"
$env:OPENROAD_PUBLIC_APP_URL="https://openroad.example.com/"
$env:OPENROAD_INVITATION_DELIVERY_MODE="disabled"
$env:OPENROAD_INVITATION_DELIVERY_FILE=".openroad/openroad-invitation-deliveries.jsonl"
$env:OPENROAD_TOKEN_ENCRYPTION_KEY="replace-with-at-least-32-random-characters"
$env:OPENROAD_TOKEN_ENCRYPTION_KEY_ID="primary"
$env:OPENROAD_GITHUB_APP_SLUG="openroad"
$env:OPENROAD_GITHUB_APP_ID="12345"
$env:OPENROAD_GITHUB_APP_PRIVATE_KEY_FILE="C:\openroad\github-app.private-key.pem"
$env:OPENROAD_GITHUB_APP_WEBHOOK_SECRET="replace-with-long-random-secret"
$env:OPENROAD_LINEAR_CLIENT_ID="lin_..."
$env:OPENROAD_LINEAR_CLIENT_SECRET="replace-with-linear-client-secret"
$env:OPENROAD_LINEAR_REDIRECT_URI="https://openroad.example.com/api/openroad/integrations/linear/oauth/callback"
$env:OPENROAD_LINEAR_API_URL="https://api.linear.app/graphql"
$env:OPENROAD_JIRA_AUTH_BASE_URL="https://auth.atlassian.com"
$env:OPENROAD_JIRA_CLIENT_ID="jira-client-id"
$env:OPENROAD_JIRA_CLIENT_SECRET="replace-with-jira-client-secret"
$env:OPENROAD_JIRA_REDIRECT_URI="https://openroad.example.com/api/openroad/integrations/jira/oauth/callback"
$env:OPENROAD_JIRA_API_BASE_URL="https://api.atlassian.com/ex/jira"
$env:OPENROAD_TRUST_PROXY_HEADERS="false"
$env:OPENROAD_SINGLE_USER_MODE="false"
```

`OPENROAD_SINGLE_USER_MODE=false` can explicitly disable owner fallback when no token is configured.
