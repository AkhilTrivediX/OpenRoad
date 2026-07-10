# Feature Test Plan: Invitation Email Delivery

Branch: `feat/invitation-email-delivery`

## Objective

Add a production-safe invitation delivery handoff so workspace owners can create teammate invitations that are ready to deliver through a server-side channel, without moving email/provider credentials into the browser or leaking invitation internals through public APIs.

## User Story

As a workspace owner, I can invite a teammate and have OpenRoad prepare a delivery record with the invitee, role, workspace, expiration, and accept link. As a self-host operator, I can wire that record into my preferred mail/helpdesk worker while keeping OpenRoad's token, session, and tenant boundaries intact.

## Scope

- Server-side invitation delivery adapter interface.
- Local JSONL file adapter for self-host invitation email handoff.
- Environment configuration for invitation delivery mode, delivery file path, and public app URL.
- Invitation delivery metadata persisted on invitation summaries without exposing token hashes.
- Bounded failure metadata when delivery fails after invitation creation.
- Team metadata schema migration for delivery fields.
- Tests for configured delivery, disabled delivery, adapter failure, summary redaction, backup/restore, release manifest schema notes, and member-session regressions.
- Operator docs for configuration, smoke testing, rollback, and current direct-email limits.

## Not In Scope

- Direct SMTP, SES, Mailgun, SendGrid, Slack, Discord, SMS, or provider API sending.
- Hosted background queue infrastructure.
- Password login, OAuth login, account recovery, or billing.
- Full member management UI beyond the current invitation list.
- Unsubscribe links or email preference center.
- HTML email templating.

## Acceptance Criteria

- Invitation delivery is disabled by default and preserves the current one-time copy-token workflow.
- `OPENROAD_INVITATION_DELIVERY_MODE=file` plus `OPENROAD_INVITATION_DELIVERY_FILE` enables an append-only JSONL handoff.
- Configured delivery writes one record per created invitation with email, invited name, role, workspace id/name, expiration, subject/body, raw accept token, and accept URL.
- Delivery records do not include token hashes, admin tokens, session secrets, provider credentials, audit logs, full workspace state, or private integration payloads.
- Accept URLs use `OPENROAD_PUBLIC_APP_URL` when configured and safely fall back to the request origin for local/self-host smoke tests.
- Delivery success persists bounded delivery metadata on the invitation summary without persisting the raw accept token.
- Delivery adapter failures do not drop the invitation; the API returns `201` with failed delivery metadata, and the invitation remains revocable/acceptable through the returned one-time token.
- Public invitation acceptance, member-session creation, owner session access, workspace-scoped member reads/writes, and cross-workspace denial continue to pass.
- Invitation list, backup/restore manifests, and release notes include delivery metadata and schema version updates without exposing raw tokens.

## Automated Test Checklist

- Team metadata migrates schema 1 and schema 2 files to the current schema.
- Current-schema validation accepts invitation delivery metadata and rejects malformed delivery fields.
- Team store records successful invitation delivery metadata without changing token hashes or invitation status.
- Team store records failed delivery metadata with bounded error text.
- JSONL invitation adapter appends one safe delivery record with an accept link and no token hash.
- Delivery adapter environment factory returns disabled, file, and invalid-mode behavior predictably.
- Invitation creation with disabled delivery keeps existing API behavior.
- Invitation creation with configured delivery returns delivery status and persists summary metadata.
- Invitation creation with adapter failure returns `201`, records failed metadata, and keeps the token usable once.
- Invitation list never returns raw token, token hash, admin token, or session secret.
- Existing invitation revoke and invitation acceptance flows still pass.
- Existing owner sessions and workspace-member sessions still pass.
- Ops backup manifest reports the current team metadata schema.
- Release verification reports the current team metadata schema for rollback planning.
- `pnpm check` passes.

## Regression Checklist

- Owner admin-token sessions still bind to admin-token rotation.
- Member invitation sessions still create httpOnly cookies and remain workspace-scoped.
- Viewer members remain read-only.
- Public portal snapshots remain unauthenticated and private-data-safe.
- Existing requester notification JSONL delivery remains independent from invitation delivery.
- Standalone local/browser mode still works without server delivery configuration.
- No browser code reads delivery file paths or delivery secrets.

## Security And Privacy Checks

- Invitation delivery runs server-side only.
- Raw accept tokens are returned only by the create-invitation response and the operator-configured delivery artifact.
- Delivery artifact path is controlled by server env and documented as sensitive.
- Delivery errors are bounded before persistence or response.
- Delivery records exclude token hashes and unrelated private state.
- Public, member, and workspace-scoped APIs cannot trigger invitation delivery.

## Migration And Rollback

- Migration: schema 1 and schema 2 team metadata load into the current schema with no delivery metadata until a delivery attempt occurs.
- Rollback: restore a pre-schema-upgrade team metadata backup before downgrading to an older build.
- JSONL invitation delivery files are append-only operational artifacts and are not required for OpenRoad state restore.

## Manual QA Checklist

- Run focused invitation delivery, team, HTTP, session, ops, and release tests.
- Run `pnpm check`.
- Start the built server with admin-token mode, temporary data files, `OPENROAD_INVITATION_DELIVERY_MODE=file`, `OPENROAD_INVITATION_DELIVERY_FILE`, and `OPENROAD_PUBLIC_APP_URL`.
- Sign in as owner, create an invitation, verify a JSONL line is appended, and inspect that no token hash or admin/session secret appears.
- Open the accept URL in a fresh browser/session path and verify the invited member lands in the scoped workspace.
- Verify the same token cannot be reused.
- Run `pnpm release:verify`.

## Evidence

- Branch: `feat/invitation-email-delivery`
- Implementation commit SHA: Pending.
- Date: Pending.
- Commands run: Pending.
- Browser/viewports tested: No UI changes planned.
- Accessibility checks: No UI changes planned.
- Reviewer notes: Pending.
- Known unresolved risks: Direct SMTP/provider sending, hosted background queue infrastructure, password/OAuth login, account recovery, HTML email templates, and full member management UI remain future production slices.
- Rollback notes: Pending.
