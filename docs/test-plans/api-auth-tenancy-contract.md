# Feature Test Plan: API Auth Tenancy Contract

Branch: `feat/api-auth-tenancy-contract`

## Objective

Create the first enforceable OpenRoad API trust boundary before team collaboration, provider integrations, notifications, or hosted public launch work continues.

## User Story

As a future self-host admin or team owner, I need OpenRoad APIs to distinguish private workspace data from public portal data, define actor roles clearly, and prevent cross-workspace access before real OAuth, sessions, provider sync, or billing are added.

## Scope

- API version and structured error contract.
- Actor model for local owner, workspace member, public visitor, requester, service account, and integration actor.
- Workspace role matrix for owner, maintainer, contributor, and viewer.
- Permission checks for full-state APIs, workspace-scoped APIs, action APIs, public portal APIs, and contract discovery.
- Workspace isolation rules for member/requester/integration actors.
- Optional admin bearer token for private APIs.
- Single-user fallback mode when no admin token is configured.
- Contract endpoint documenting version, actors, roles, permissions, and protected routes.

## Not In Scope

- OAuth/session provider.
- Passwords.
- User database.
- Persistent membership table.
- Provider token storage.
- Webhook signature verification.
- UI sign-in.
- Billing/admin UI.

## Acceptance Criteria

- Every API response includes an API version and request id.
- API errors use one structured shape with `code`, `message`, `status`, and `requestId`.
- Public portal APIs remain readable by public visitors and never expose private data.
- Full-state read/write APIs are private owner/admin surfaces.
- Action APIs reject missing, invalid, or cross-workspace actor permissions.
- Workspace-scoped APIs allow a member to read only their own workspace.
- Workspace-scoped APIs reject cross-workspace access.
- Optional `OPENROAD_ADMIN_TOKEN` protects private APIs when configured.
- Single-user evaluation mode remains usable when no admin token is configured.
- Contract docs and tests make clear that trusted proxy/member headers are a development contract, not a full auth provider.
- Existing standalone app and public portal flows continue to pass.

## Permission Matrix

| Actor | Scope | Can Read Full State | Can Write Full State | Can Read Own Workspace | Can Write Own Workspace | Can Read Public Portal | Can Run Integration Sync |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Local owner | All workspaces | Yes | Yes | Yes | Yes | Yes | No |
| Workspace owner | Own workspace | No | No | Yes | Yes | Yes | No |
| Workspace maintainer | Own workspace | No | No | Yes | Yes | Yes | No |
| Workspace contributor | Own workspace | No | No | Yes | Yes | Yes | No |
| Workspace viewer | Own workspace | No | No | Yes | No | Yes | No |
| Requester | Linked public workspace | No | No | No | No | Yes | No |
| Public visitor | Public data only | No | No | No | No | Yes | No |
| Integration actor | Installed workspace | No | No | Yes | Yes | No | Yes |
| Service account | Configured workspace/all | Yes when owner-scoped | Yes when owner-scoped | Yes | Yes | Yes | Yes |

## Automated Test Checklist

- Contract endpoint returns API version, actor types, roles, permissions, and route protections.
- Health endpoint returns API version and request id.
- API errors include request id, status, and stable error code.
- Single-user mode can read full state without an admin token.
- Configured admin token allows full-state read/write.
- Missing admin token rejects full-state read/write.
- Invalid admin token rejects full-state read/write.
- Workspace member can read only their own workspace through a workspace-scoped endpoint.
- Workspace member cannot read another workspace through a workspace-scoped endpoint.
- Workspace viewer cannot run write actions.
- Workspace contributor can run a workspace-scoped action inside their workspace.
- Workspace contributor cannot run a workspace-scoped action against another workspace.
- `replace-state` action requires owner/admin permission.
- Public visitor can read portal projection.
- Public portal projection still hides private requests, comments, roadmap items, changelog entries, requester source, and private notes.
- Unknown API route returns structured `404`.
- Unsupported method returns structured `405`.
- Existing server store tests still pass.
- Existing domain and app tests still pass.

## Regression Checklist

- Workspace creation and selection still work.
- Standalone request capture still works.
- Request triage and duplicate merge still work.
- Native work items still work.
- Roadmap Now/Next/Later movement still works.
- Changelog draft creation still works.
- Public portal preview still respects public/private visibility.
- Production server still serves app routes and assets.
- Production client still falls back to localStorage when server state is unavailable.
- Optional GitHub, Jira, and Linear chips remain non-blocking.

## Security And Privacy Checks

- No secrets are committed.
- `OPENROAD_ADMIN_TOKEN` is documented as an environment variable only.
- Private state APIs do not become public because the portal endpoint exists.
- Requester/source/private notes do not appear in public API responses.
- Trusted actor headers are disabled unless the server explicitly enables them.
- Cross-workspace denial uses `403`, not `404`, for authenticated actors.
- Error responses do not expose stack traces.

## Migration And Rollback

- No OpenRoad domain schema migration is required.
- Rollback by reverting this branch; server data JSON remains compatible with the production foundation.
- If `OPENROAD_ADMIN_TOKEN` is configured and clients cannot authenticate yet, the browser app falls back to localStorage until the next UI auth/session feature.

## Manual QA Checklist

- Run `pnpm check`.
- Build and start production server without `OPENROAD_ADMIN_TOKEN`; verify `/api/openroad/state` works for single-user mode.
- Build and start production server with `OPENROAD_ADMIN_TOKEN`; verify unauthenticated `/api/openroad/state` is denied.
- Verify authenticated bearer token can read `/api/openroad/state`.
- Verify `/api/openroad/workspaces/acme/portal` remains public.
- Browser QA production app at desktop and compact widths for fixed-shell regression.

## Evidence

- Branch: `feat/api-auth-tenancy-contract`
- Commit SHA: Pending.
- Date: Pending.
- Commands run: Pending.
- Browser/viewports tested: Pending.
- Accessibility checks: No visual UI changes expected.
- Reviewer notes: Pending.
- Known unresolved risks: OAuth/session auth, persistent membership, provider token security, webhook signatures, managed database tenancy, audit events, and hosted CI/CD remain future production slices.
- Rollback notes: Revert branch; preserve server data JSON.
