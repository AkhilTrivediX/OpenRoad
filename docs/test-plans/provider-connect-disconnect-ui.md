# Feature Test Plan: Provider Connect Disconnect UI

Branch: `feat/provider-connect-disconnect-ui`

## Objective

Make GitHub, Linear, and Jira connection management usable from Settings without direct API scripting. A workspace owner should be able to inspect setup readiness, create or verify a provider connection, store scoped server-side credentials when required, revoke credentials, and disconnect an installation while OpenRoad preserves its standalone source-of-truth data and never exposes provider secrets in browser-visible state.

## User Story

As a workspace owner, I can connect GitHub, Linear, or Jira from Settings using a guided, provider-specific flow. I can see what is connected, which credentials are active, what remains optional, and I can safely disconnect a provider when the workspace no longer needs it. As a self-host operator, I can use a manual connection path until hosted OAuth callback exchange exists, and I can trust that access tokens are submitted only to the same-origin server, encrypted there, redacted from responses, and never stored in local workspace state.

## Scope

- Settings UI expansion for provider connection management inside the existing Integration Control section.
- Provider setup summaries for GitHub App setup, Linear OAuth setup, and Jira OAuth setup using existing server setup endpoints.
- Manual connection bootstrap for GitHub, Linear, and Jira when a user has provider account/installation details and, where needed, access-token credentials.
- Provider-neutral installation create API for manual self-host connection metadata.
- Provider-neutral installation disconnect API for GitHub, Linear, and Jira that marks installations disconnected, disconnects provider mappings, and revokes active credentials.
- Compatibility with the existing GitHub App installation verification and GitHub App disconnect endpoint.
- Client helpers for setup load, manual installation create, credential list/store/revoke, GitHub App verification, and provider disconnect.
- Credential management UI that lists only sanitized metadata and stores/revokes credentials through same-origin JSON APIs.
- Docs for deployment, API contract, README, build plan, production readiness, and rollback.

## Not In Scope

- Hosted OAuth callback exchange.
- Persisting provider secrets in browser storage or workspace state.
- Asking users for GitHub App private keys, webhook secrets, admin tokens, or OpenRoad server secrets in the browser.
- Provider write-back from OpenRoad to GitHub, Linear, or Jira.
- Linear/Jira webhooks.
- Conflict resolution UI.
- Full sync/audit timeline.
- Billing, hosted organization administration, SSO/MFA, or SCIM.

## Acceptance Criteria

- Standalone OpenRoad remains useful with no configured integrations and no server integration metadata.
- Settings keeps integrations progressive; no new primary nav item, no modal-first setup, and no increase in first-use complexity.
- GitHub setup shows configured/missing App state and supports verifying a GitHub App installation id when configured.
- Linear and Jira setup show configured/missing OAuth state, but do not claim hosted OAuth callback completion until that future slice exists.
- Manual connection bootstrap can create sanitized installation metadata for GitHub, Linear, and Jira with bounded ids/account names and provider-appropriate permissions.
- Credential storage uses the existing server token vault; access tokens and refresh tokens are accepted only by same-origin POST, encrypted server-side, and never returned by API, audit, logs, integration status, browser state, or tests.
- Credential list returns only sanitized metadata: id, installation id, provider, workspace id, permissions, scopes, secret types, status, label, token type, timestamps, and expiration when present.
- Credential revoke works for all providers, is idempotent, records audit only when state changes, and does not remove OpenRoad requests or work.
- Disconnect works for GitHub, Linear, and Jira, revokes active credentials, marks active mappings disconnected, prevents future sync/import apply through that installation, and preserves already-created OpenRoad objects.
- Existing GitHub App disconnect route remains compatible and uses the same safety behavior as the provider-neutral disconnect route.
- Connection/disconnect responses never expose encrypted credential payloads, provider tokens, refresh tokens, webhook secrets, GitHub private keys, admin tokens, session tokens, raw provider payloads, or cross-workspace records.
- Settings UI can refresh provider status after connect, credential store/revoke, and disconnect without a full page reload.
- Disabled or unavailable actions explain the next step through nearby operational copy, not tooltips alone.
- Provider connect forms are compact, labeled, keyboard reachable, and do not create nested-card clutter.
- Mobile Settings layout has no body-level scrolling, horizontal overflow, overlapping text, or touch targets below 44px for provider actions.
- Existing integration status/manual sync, GitHub import/live fetch/webhook, Linear/Jira import/link, background sync, account recovery, invitations, member management, public portal, ops, and release tests still pass.

## Automated Test Checklist

- Server provider installation create route rejects public/viewer actors and allows workspace owners/maintainers with `integration:manage`.
- Server provider installation create route rejects unsupported provider, missing workspace, malformed ids, unsupported permissions, and cross-workspace payloads.
- Server provider installation create route creates or updates scoped installation metadata for GitHub, Linear, and Jira without writing provider secrets.
- Server provider-neutral disconnect route rejects public/viewer actors and allows workspace owners/maintainers with `integration:manage`.
- Server provider-neutral disconnect route disconnects GitHub, Linear, and Jira installations, marks related mappings disconnected, revokes active credentials, and reports bounded counts.
- Existing GitHub App disconnect route remains covered and returns the same sanitized shape or compatible legacy fields.
- Credential list/store/revoke tests cover same-origin API behavior, token-vault-not-configured failure, wrong installation failure, disconnected installation failure, revoked credential idempotency, and secret redaction.
- Integration status after connect shows active installation and setup/readiness text for the workspace only.
- Integration status after credential storage shows active credential count but never credential secrets or encrypted payload internals.
- Integration status after disconnect shows attention/optional state, disconnected account metadata, revoked credentials, and no active installation.
- Client setup helpers parse GitHub/Linear/Jira setup responses, missing config, forbidden responses, malformed payloads, and redacted error copy.
- Client installation create/disconnect helpers call same-origin JSON endpoints with `credentials: "same-origin"` and parse safe statuses.
- Client credential helpers list/store/revoke with same-origin credentials and scrub token-shaped error text.
- Settings UI renders connect/manage actions for each provider without hiding local data tools.
- GitHub App verify flow submits an installation id, refreshes status, and does not render the id as a secret.
- Manual connection flow submits provider account id/name/installation id and optional credential fields, clears token inputs after success and failure, and does not render tokens.
- Credential revoke and provider disconnect UI require explicit button action, update status messages, and refresh provider status.
- Browser-rendered Settings never contains raw access tokens, refresh tokens, encrypted credential payloads, webhook secrets, private keys, or admin tokens.
- Standalone/local fallback still shows integrations as optional and keeps export/import/reset usable.
- Existing `src/App.test.tsx`, `src/persistence/openroadIntegrations.test.ts`, `server/http.test.ts`, `server/integrations.test.ts`, `server/sync-jobs.test.ts`, `server/access.test.ts`, ops, and release tests pass.

## Regression Checklist

- Manual GitHub/Linear/Jira sync buttons still use reported capability flags and existing sync queue/runner behavior.
- GitHub issue import and live issue preview APIs still work.
- GitHub signed webhook processing remains idempotent and private.
- Linear and Jira payload-backed import/link behavior remains unchanged.
- Background sync runner still returns `503 not_configured` when no worker is configured.
- Public portal API still excludes integration metadata, sync jobs, and credentials.
- Backup/restore still sanitizes integration metadata and does not include raw provider tokens.
- Account recovery, invitation delivery, owner/member sessions, and member-management session revocation remain green.
- Release manifest reports unchanged OpenRoad state schema `7`, integration metadata schema `3`, session metadata schema `2`, and team metadata schema `5`.

## Security And Privacy Checks

- Browser code must not read provider secrets from environment variables.
- Browser code must not ask for GitHub private keys, webhook secrets, admin tokens, or OpenRoad session cookies.
- Access and refresh token inputs must be password-type fields, cleared after submit, and never copied into React-visible status messages.
- API responses and audit events must use sanitized credential metadata only.
- Provider setup errors, credential errors, and disconnect errors must redact token-shaped text and internal file paths.
- Installation create/disconnect routes must enforce workspace permission and workspace scoping.
- Disconnect must preserve OpenRoad objects and only alter integration metadata/mappings/credentials.
- Cross-workspace provider records must not appear in status, credential list, disconnect counts, or UI.

## UX And Accessibility Checks

- The Settings surface keeps the Dark Map Room vocabulary: sharp edges, 1px dividers, route labels, restrained semantic badges, no gradients, no glass, no decorative nested cards.
- Provider rows expose one clear primary next action: Connect, Manage, Store credential, Revoke credential, Disconnect, or Sync.
- Advanced fields stay behind native disclosure sections so the default Settings view remains calm.
- Connect/disconnect copy is operational and short; it does not teach implementation internals.
- Forms have accessible names, labels, visible focus, and keyboard-reachable actions.
- Provider actions use icon plus text where actions are not obvious.
- Disabled actions include visible reason text nearby.
- Desktop and mobile browser QA verify no document/body scroll, no horizontal overflow, no overlapping controls, and stable bottom status.

## Manual QA Checklist

- Start standalone/local app and confirm Settings shows optional providers with no connect pressure and data tools remain usable.
- Start built server with token mode but no integration metadata/token-vault config and confirm safe unavailable/not-configured states.
- Start built server with `OPENROAD_TOKEN_ENCRYPTION_KEY`, create manual Linear/Jira connection, store credential, verify status shows active credential counts only, revoke credential, and confirm secrets are absent from persisted integration metadata snapshots visible to APIs.
- Start built server with GitHub App fake setup, verify a GitHub installation id, store/revoke a credential if applicable, disconnect the installation, and confirm linked mappings are disconnected while OpenRoad requests remain.
- Confirm public/viewer/member-without-manage actors cannot connect, revoke, or disconnect.
- At desktop viewport, navigate Settings by keyboard through provider connect/manage controls and local data tools.
- At mobile viewport, navigate Settings and confirm no body scroll, no horizontal overflow, and provider controls remain readable/tappable.
- Run focused server/client/UI tests.
- Run `pnpm check`.
- Run built-server smoke for connect, credential store/revoke, disconnect, and redaction.
- Run `pnpm release:verify`.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch. Existing integration metadata schema `3` remains compatible because the branch only adds UI/API paths around existing installation, mapping, credential, and sync-job shapes.
- If a disconnect was performed accidentally, restore a pre-disconnect integration metadata backup and rerun `pnpm ops:smoke`.

## Evidence

- Branch: `feat/provider-connect-disconnect-ui`
- Implementation commit SHA: Pending.
- Date: Pending.
- Commands run: Pending.
- Browser/viewports tested: Pending.
- Accessibility checks: Pending.
- Reviewer notes: Pending.
- Known unresolved risks: Hosted OAuth callback exchange, Linear/Jira webhooks, provider write-back, conflict UI, full sync/audit timeline, distributed credential rotation policy, and hosted account administration remain later production slices.
- Rollback notes: Pending.
