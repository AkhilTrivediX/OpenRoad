# Feature Test Plan: OAuth Refresh Rotation

Branch: `feat/oauth-refresh-rotation`

## Objective

Add production-safe Linear and Jira OAuth refresh-token rotation so background sync workers can renew expired or near-expired OAuth credentials server-side without exposing provider tokens, interrupting standalone mode, or requiring users to reconnect whenever access tokens expire.

## User Story

As a workspace owner who connected Linear or Jira through OAuth, I want OpenRoad to keep sync credentials fresh automatically, so linked issue sync continues after provider access tokens expire. As an operator, I need refresh failures, revoked consent, missing refresh tokens, missing config, and provider outages to fail safely with bounded retry behavior and no secret leakage.

## Scope

- Server-only refresh clients for Linear and Jira.
- Rotation of encrypted credential secrets when a valid refresh token produces a new access token and refresh token.
- Sync-worker credential resolution that refreshes expired or near-expired OAuth credentials before provider issue fetches.
- Safe handling for credentials without refresh tokens, disabled token vault, missing provider OAuth config, provider non-2xx responses, invalid JSON, or missing access tokens.
- Provider docs, env/runbook notes, focused unit tests, worker integration tests, release evidence, `pnpm check`, built-server smoke, and CI.

## Not In Scope

- User-facing reconnect banners beyond existing credential/status metadata.
- Manual refresh buttons in Settings.
- Provider write-back.
- Conflict UI.
- Distributed refresh locks across multiple Node processes.
- External KMS or multi-key token-vault rotation.

## Official Provider Rules

- Linear refresh uses `POST https://api.linear.app/oauth/token` with `Content-Type: application/x-www-form-urlencoded`, `grant_type=refresh_token`, the previous `refresh_token`, and client authentication. Linear returns a new access token and refresh token; docs state refresh replay has a short grace window, so OpenRoad should persist the latest successful refresh token immediately.
- Atlassian refresh uses `POST https://auth.atlassian.com/oauth/token` with JSON body fields `grant_type=refresh_token`, `client_id`, `client_secret`, and the previous `refresh_token`. Atlassian uses rotating refresh tokens; the previously used refresh token is disabled after a successful exchange, so OpenRoad must replace stored refresh token material atomically.

## Acceptance Criteria

- Expired or near-expired Linear/Jira OAuth credentials refresh before sync workers call provider issue APIs.
- Successful refresh replaces encrypted access-token and refresh-token material in `OPENROAD_INTEGRATION_FILE`, updates `expiresAt`, `providerScopes`, `tokenType`, and `updatedAt`, and preserves credential id, installation id, provider, permissions, status, label, and workspace scope.
- Refresh-created API responses, sync results, audit events, logs, docs, and status summaries never expose raw access tokens, refresh tokens, client secrets, authorization headers, ciphertext, IVs, tags, or provider response bodies.
- Credentials without `refresh-token` in `secretTypes`, revoked credentials, credentials lacking `expiresAt`, and non-OAuth/API-key credentials continue using existing behavior unless provider calls fail normally.
- Missing provider OAuth config or missing refresh token produces a bounded sync-worker failure that does not erase the old encrypted credential.
- Provider non-2xx, invalid JSON, or missing access token responses do not mutate credential material and return retryable/fatal sync-worker outcomes according to provider status.
- Concurrent sync jobs in the same Node process cannot lose a newly rotated refresh token because refresh and credential replacement run under the existing integration mutation lock.
- Existing OAuth callback exchange, manual credential storage, sync workers, webhooks, and standalone mode remain green.

## Automated Test Checklist

- Refresh client tests:
  - Linear sends form-encoded `grant_type=refresh_token`, refresh token, client id, and client secret to the configured token URL.
  - Jira sends JSON `grant_type=refresh_token`, refresh token, client id, and client secret to the configured Atlassian token URL.
  - Both clients parse access token, refresh token, expiry, token type, and scope strings/arrays safely.
  - Both clients map provider non-2xx and malformed responses to sanitized typed errors without leaking response bodies.
- Token-vault/credential rotation tests:
  - Successful refresh reseals new access and refresh tokens with the existing associated-data context.
  - Old raw tokens do not appear in persisted integration metadata or API-visible summaries.
  - Failed refresh leaves the previous encrypted credential untouched.
- Worker tests:
  - Linear sync refreshes an expired OAuth credential, persists the rotated secret, then fetches the issue using the new access token.
  - Jira sync refreshes an expired OAuth credential, persists the rotated secret, then fetches the issue using the new access token.
  - Near-expiry threshold refreshes before provider calls.
  - Missing refresh token or missing provider OAuth config fails safely and does not call the issue API with an expired token.
  - Existing valid unexpired credentials still sync without refresh.
- Regression tests:
  - OAuth callback exchange tests remain green.
  - Provider credential create/list/revoke tests remain green.
  - Linear/Jira webhook tests remain green.
  - `pnpm check`, `pnpm release:verify`, built-server smoke, and GitHub Actions production gate pass before merge.

## Security And Privacy Checks

- OAuth client secrets are read only from server environment/config.
- Refresh tokens are opened only inside server sync/refresh code and immediately resealed after successful rotation.
- Refresh exchange happens before provider issue API calls only after workspace/provider/installation/credential scope is resolved.
- Refresh provider errors are bounded/redacted before persistence or API output.
- Refresh does not grant broader OpenRoad integration permissions than the existing credential.
- Refresh does not create installations, mappings, OpenRoad requests, or provider webhooks.

## Manual QA Checklist

- Start built server with `OPENROAD_TOKEN_ENCRYPTION_KEY`, seed an expired Linear credential with a refresh token, run the private sync runner with a fake Linear token endpoint, and confirm the issue API receives only the refreshed access token.
- Repeat for Jira with a fake Atlassian token endpoint.
- Start built server without provider client secrets and confirm expired OAuth credentials fail safely without changing encrypted credential material.
- Confirm `pnpm ops:smoke` still passes against `server-dist`.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch. Credentials refreshed before rollback remain valid encrypted credential records because the storage shape is unchanged. If a provider refresh bug stores bad tokens, revoke the affected credential through Settings/API and reconnect OAuth.

## Evidence

- Branch: `feat/oauth-refresh-rotation`
- Implementation commit SHA: `7d6534a`
- Date: July 10, 2026
- Commands run:
  - `pnpm exec tsc -p tsconfig.server.json --noEmit`
  - `pnpm vitest run server/oauth-clients.test.ts server/linear-sync-worker.test.ts server/jira-sync-worker.test.ts server/http.test.ts`
  - `pnpm check`
  - `pnpm release:verify`
  - Built `server-dist/server/index.js` smoke on `http://127.0.0.1:4201` with `OPENROAD_TOKEN_ENCRYPTION_KEY` configured: `OpenRoad smoke passed: health, contract, portal, private-denied, private-token`
- Browser/viewports tested: Not required for this branch because no browser UI was changed. API-visible Settings status eligibility is covered by `server/http.test.ts`; built app/server artifacts were exercised through the smoke check.
- Reviewer notes: Linear and Jira refresh clients follow provider-specific request formats; sync workers rotate expired or near-expired OAuth credentials before provider reads; rotation preserves credential scope/identity and reseals only access/refresh token material; retryable provider refresh failures leave old encrypted credentials untouched and do not call provider issue APIs with expired tokens.
- Known unresolved risks: Provider write-back, conflict UI, hosted webhook registration automation, automatic reconnect UX for revoked consent, external callback/refresh state storage, and distributed refresh locking remain later production slices.
- Rollback notes: Revert this branch. No schema shape changed; credentials already rotated by this branch remain valid credential records. If a bad provider token is stored, revoke that credential through Settings/API and reconnect OAuth.
