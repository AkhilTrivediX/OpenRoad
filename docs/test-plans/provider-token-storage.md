# Feature Test Plan: Provider Token Storage

Branch: `feat/provider-token-storage`

## Objective

Add production-safe, server-only provider credential storage primitives for GitHub, Linear, and Jira integrations before any background sync, OAuth callback, or provider write-back feature can persist tokens.

## User Story

As a self-host operator or workspace owner, I can register provider credentials against an already verified integration installation, have OpenRoad store them encrypted at rest, list only non-secret credential metadata, and revoke them when an installation is disconnected.

## Scope

- Integration metadata schema migration from version `1` to version `2`.
- Credential metadata model scoped by workspace, provider, and installation.
- AES-256-GCM encryption for access tokens and optional refresh tokens using a server-only environment key.
- Server-only helper functions for sealing, opening, sanitizing, validating, listing, storing, and revoking integration credentials.
- Private credential API endpoints guarded by `integration:manage`.
- Safe cleanup of credentials when GitHub App installations are manually or webhook-disconnected.
- Documentation for operator configuration, backup/restore sensitivity, rotation, rollback, and current limitations.
- Tests for schema migration, redaction, crypto behavior, API auth, provider scope validation, revoke behavior, disconnect cleanup, and existing integration regressions.

## Not In Scope

- OAuth callback exchange for Linear or Jira.
- Persisting GitHub installation access tokens generated for live issue fetch.
- Background polling/sync runners.
- Provider write-back.
- Browser Settings UI for credential management.
- Hosted KMS integration.
- Multi-process file locking.

## Acceptance Criteria

- Version `1` integration metadata migrates automatically to version `2` with an empty credentials list.
- Credential records are scoped to a known active installation in the same workspace and provider.
- Credential storage is disabled with `503 not_configured` until `OPENROAD_TOKEN_ENCRYPTION_KEY` is configured.
- The encryption key is validated server-side and is never returned by APIs.
- Stored credential secrets are encrypted at rest with authenticated encryption.
- Credential API responses never include raw tokens, refresh tokens, ciphertext, IVs, tags, or key material.
- Public visitors, viewers, contributors, requesters, and integration actors cannot create/list/revoke credentials.
- Local owners/admin tokens and workspace owners can create/list/revoke credentials for their workspace.
- Revoke clears encrypted secret material and marks credential status revoked without deleting audit history.
- Manual GitHub disconnect revokes credentials tied to that workspace installation.
- GitHub installation deleted webhooks revoke credentials tied to affected installations.
- Existing GitHub live fetch continues to generate short-lived tokens in memory only and does not persist them.
- Existing standalone mode works with zero integrations and no token encryption key.
- Backup/restore continues to include integration metadata while docs clearly warn that backups containing encrypted credentials are sensitive.
- Release verification and production smoke still pass.

## Automated Test Checklist

- Integration store seeds schema `2` with `credentials: []`.
- Parser migrates schema `1` metadata without sync events to schema `2`.
- Parser rejects future schema versions and malformed credential records.
- Parser drops unknown secret-like fields outside the explicit encrypted credential envelope.
- Sanitizer removes encrypted secret payloads from credential metadata.
- Token vault rejects missing or too-short encryption keys.
- Token vault encrypts access and refresh tokens with random IVs and decrypts them for server-side callers.
- Token vault rejects tampered ciphertext.
- Credential upsert requires an active same-provider, same-workspace installation.
- Credential upsert rejects unknown installation IDs and disconnected/suspended installations.
- Credential revoke clears encrypted secret material and is idempotent for already revoked records.
- Credential list returns only sanitized metadata.
- Credential create/list/revoke endpoints require `integration:manage`.
- Credential create endpoint rejects invalid provider values and invalid body shapes.
- Credential create endpoint returns `503 not_configured` when no encryption key is configured.
- Credential API responses and audit events do not contain raw tokens or encrypted secret material.
- Manual GitHub disconnect revokes matching credentials while preserving other workspace/provider credentials.
- GitHub installation deleted webhook revokes matching credentials.
- Existing GitHub import, live fetch, webhook, Linear import/setup, Jira import/setup, notification delivery, public portal, ops, release, and app tests still pass.
- `pnpm check` passes.

## Regression Checklist

- Standalone OpenRoad state works when the integration store is empty or absent.
- GitHub App setup and verification still do not persist installation access tokens.
- GitHub live issue fetch still uses short-lived generated tokens only in memory.
- Linear and Jira setup endpoints still return safe authorization metadata without client secrets.
- Integration actor sync permissions do not grant credential management.
- Public portal snapshots do not include integrations, credentials, or notification internals.
- Backup/restore command shape remains state, integration, team, and manifest files.
- Release manifest continues to report schema and rollback notes accurately.

## Security And Privacy Checks

- No real provider tokens, webhook secrets, private keys, admin tokens, or encryption keys are committed.
- Credential APIs never echo `accessToken`, `refreshToken`, `token`, `secret`, ciphertext, IV, auth tag, or encryption key fields.
- Encrypted credentials are stored only in `OPENROAD_INTEGRATION_FILE`.
- Encryption uses authenticated encryption with per-record random IVs.
- Error messages are bounded and avoid including request bodies or secret values.
- Audit events mention credential metadata only by provider, installation, and label-safe details.
- Docs warn that integration backups containing encrypted credentials are sensitive and require operator-managed storage protection.
- Rotation guidance covers adding a new credential, revoking old credentials, and replacing backups according to operator policy.

## Migration And Rollback

- Migration: schema `1` integration metadata loads as schema `2` and receives `credentials: []`.
- Rollback: before downgrading to a schema `1` build, revoke/remove provider credentials or restore a pre-schema-2 integration backup.
- Existing OpenRoad core state schema remains unchanged in this slice.

## Manual QA Checklist

- Run focused integration, token vault, HTTP, access, and release tests.
- Run `pnpm check`.
- Start the built server with a temporary state directory, admin token, and token encryption key.
- Verify a GitHub installation, create a credential, list credentials, and confirm no token/ciphertext appears in API output.
- Revoke the credential and confirm the integration metadata has no encrypted secret for the revoked record.
- Create a second credential, disconnect the GitHub installation, and confirm credentials for that installation are revoked.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/provider-token-storage`
- Implementation commit SHA: Pending.
- Date: Pending.
- Acceptance criteria status: Pending.
- Commands run: Pending.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending.
- Known unresolved risks: OAuth callbacks, live Linear/Jira fetch, provider write-back, background sync, browser Settings UI, external KMS, and multi-process credential mutation locking remain later production slices.
- Rollback notes: Pending.
