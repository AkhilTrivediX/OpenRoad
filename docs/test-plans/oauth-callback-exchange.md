# Feature Test Plan: OAuth Callback Exchange

Branch: `feat/oauth-callback-exchange`

## Objective

Add production-safe Linear and Jira OAuth callback exchange so workspace owners can complete provider authorization through the server without pasting access tokens into Settings, while preserving standalone mode and keeping all OAuth codes, access tokens, refresh tokens, client secrets, and encrypted credential material server-only.

## User Story

As a workspace owner connecting Linear or Jira, I want OpenRoad to receive the provider OAuth callback, exchange the authorization code on the server, and store a scoped encrypted credential for an active provider installation, so linked-issue sync can run without manual token handling. As an operator, I need the callback to reject stale/tampered state, missing configuration, wrong workspace permissions, and upstream provider failures without leaking secrets.

## Scope

- Public Linear and Jira OAuth callback routes under `/api/openroad/integrations/:provider/oauth/callback`.
- Server-side authorization-code exchange clients for Linear and Jira.
- OAuth state decoding, age checks, workspace permission checks, and optional installation selection.
- Encrypted credential storage using the existing `OPENROAD_TOKEN_ENCRYPTION_KEY` token vault.
- Sanitized success/failure responses for JSON clients and safe browser redirects back to Settings.
- Access contract, server tests, provider docs, runbook/env examples, and feature evidence.

## Not In Scope

- OAuth refresh-token rotation jobs.
- Creating OpenRoad requests or importing provider issues from OAuth callbacks.
- Provider write-back.
- Conflict UI.
- Full browser OAuth status banner polish beyond a safe redirect target.
- Automatic Jira site picker UI.
- Distributed callback/session state storage beyond existing signed-in workspace permission checks.

## Acceptance Criteria

- Callback routes are disabled with safe `503 not_configured` responses when OAuth config, integration store, or token vault are unavailable.
- Missing provider `code`, malformed/missing `state`, stale state, provider `error`, and wrong workspace permissions fail without token exchange or mutation.
- Linear callback exchanges the code with the configured Linear token endpoint using form-encoded authorization-code parameters.
- Jira callback exchanges the code with the configured Atlassian token endpoint using JSON authorization-code parameters.
- Successful callbacks store encrypted credentials for an active installation in the decoded workspace and never return raw tokens, refresh tokens, ciphertext, IVs, tags, client secrets, or provider authorization codes.
- Callback credential permissions are limited to `read:external` unless a later explicit write-back slice expands them.
- Duplicate/repeated successful callbacks upsert active credential metadata without exposing previous encrypted payloads.
- Existing OAuth setup, manual credential storage, sync workers, webhooks, and standalone mode remain green.
- Built server smoke, `pnpm check`, release verification, and CI pass before merge.

## Automated Test Checklist

- Access contract lists Linear/Jira OAuth callback routes as public callback routes with handler-level state, permission, and token-vault checks.
- Linear OAuth setup still returns a safe authorize URL and redacts `OPENROAD_LINEAR_CLIENT_SECRET`.
- Jira OAuth setup still returns a safe authorize URL and redacts `OPENROAD_JIRA_CLIENT_SECRET`.
- Linear callback rejects missing code/state, stale state, provider error query, missing token vault, and invalid workspace permission.
- Jira callback rejects missing code/state, stale state, provider error query, missing token vault, and invalid workspace permission.
- Linear callback sends expected form-encoded token exchange fields and bounded headers to the token endpoint.
- Jira callback sends expected JSON token exchange fields and bounded headers to the token endpoint.
- Upstream non-2xx, invalid JSON, or missing access token responses fail safely without mutating integration metadata.
- Successful Linear callback stores a sanitized active credential tied to an active Linear installation in the decoded workspace.
- Successful Jira callback stores a sanitized active credential tied to an active Jira installation in the decoded workspace.
- Persisted integration metadata contains encrypted credential material but not raw access tokens, refresh tokens, OAuth codes, client secrets, or provider authorization headers.
- Existing provider credential create/list/revoke tests remain green.
- Existing Linear/Jira sync worker and webhook tests remain green.
- App Settings tests remain green.

## Security And Privacy Checks

- OAuth client secrets are read only from server environment/config.
- Browser code never receives provider client secrets, authorization codes after callback handling, access tokens, refresh tokens, encrypted credential internals, or token-vault keys.
- Callback state must include a workspace id, creation timestamp, and optionally an installation id, and must expire before exchange.
- Workspace permission is checked after state decode and before token exchange.
- Token exchange response parsing is bounded and redacted.
- Audit events summarize credential storage without provider tokens or OAuth codes.
- Redirect targets are same-origin app settings paths only.

## Manual QA Checklist

- Start built server without `OPENROAD_TOKEN_ENCRYPTION_KEY` and confirm Linear/Jira callbacks return safe not-configured responses.
- Start built server with fake OAuth token endpoints and token vault, seed an active installation, send a callback with valid state/code, and confirm sanitized credential metadata is stored.
- Repeat callback error/missing-code paths and confirm integration metadata remains unchanged.
- Confirm `pnpm ops:smoke` still passes against `server-dist`.

## Migration And Rollback

- No OpenRoad state schema version change is planned.
- No integration metadata schema version change is planned.
- Rollback: revert this branch or unset Linear/Jira OAuth client secrets to disable setup/callback exchange. If bad credentials were stored, revoke provider credentials through Settings/API or restore `OPENROAD_INTEGRATION_FILE` from a pre-callback backup.

## Evidence

- Branch: `feat/oauth-callback-exchange`
- Implementation commit SHA: Pending.
- Date: Pending.
- Commands run: Pending.
- Browser/viewports tested: Pending.
- Reviewer notes: Pending.
- Known unresolved risks: Refresh-token rotation, provider write-back, conflict UI, automatic Jira site picker UI, hosted webhook registration automation, and external callback state storage remain later production slices.
- Rollback notes: Pending.
