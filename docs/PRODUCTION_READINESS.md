# OpenRoad Production Readiness Standard

This document defines what `main` means for OpenRoad. A branch is not ready to merge because the happy path works. A branch is ready when the feature is shippable within the current product maturity stage, tested against previous workflows, and honest about the limits of the stage.

## Main Branch Contract

`main` must always represent the best production candidate for the current stage.

- No knowingly broken workflows.
- No feature merged without a test plan and sign-off.
- No UI merged only because it looks acceptable in code; browser behavior must be checked for touched surfaces.
- No core data mutation merged without data-loss and regression coverage.
- No integration-specific shortcuts inside the core domain.
- No hidden dependency on GitHub, Jira, Linear, or AI for standalone workflows.
- No merge that increases first-use complexity without a progressive disclosure reason.

## Maturity Stages

OpenRoad will move through explicit maturity stages instead of pretending the first React shell is already a full SaaS.

### Stage 1: Local-First Alpha

Goal: one user can run OpenRoad and trust the standalone workflow locally.

Required before calling Stage 1 complete:

- Versioned local persistence.
- Durable workspace, request, work item, roadmap, and changelog state.
- Import/export for workspace data.
- Corrupt-storage recovery.
- Error boundary with useful recovery.
- Domain state actions covered by tests.
- Browser QA for desktop and mobile app shell.

### Stage 2: Team Beta

Goal: small teams can collaborate safely.

Required before calling Stage 2 complete:

- Backend API.
- Server-backed persistence with schema migration, backup, and rollback notes.
- Authentication.
- Workspace membership and roles.
- Tenant isolation.
- Server-side validation.
- Audit events for destructive or externally visible actions.
- Self-host deployment path; hosted deployment pipeline before hosted SaaS.
- Backup and restore path.

### Stage 3: Integration Beta

Goal: teams can connect GitHub, Linear, and Jira without corrupting OpenRoad source-of-truth data.

Required before calling Stage 3 complete:

- Provider adapter contract.
- Installation and permission model.
- External object mapping.
- Sync jobs with retries and rate-limit handling.
- Conflict model and user-facing conflict resolution path.
- Disconnect behavior that preserves OpenRoad data.
- Provider-specific test fixtures.

### Stage 4: Public Product

Goal: OpenRoad can be sold or used publicly with confidence.

Required before calling Stage 4 complete:

- Public portal controls.
- Notification preferences and anti-spam limits.
- Observability for errors, latency, jobs, and sync failures.
- Security review for authentication, authorization, provider tokens, webhook signatures, and data export.
- Accessibility review against WCAG AA.
- Performance budgets enforced in CI.
- Self-host path or clear SaaS-only position.
- Billing/admin controls if hosted subscription is enabled.
- Release process with rollback, security patches, and self-host upgrade notes.

## Pre-Merge Definition Of Done

Every branch must satisfy this checklist before merge to `main`.

### Product

- User story is clear and included in the feature test plan.
- Workflow is complete enough to use without developer explanation.
- Empty, loading, error, and no-results states exist when relevant.
- Standalone mode still works unless the branch is explicitly integration-only.
- The feature does not expose advanced complexity by default.
- UX copy is direct and does not explain implementation details.

### Architecture

- New domain concepts are named in product language.
- State changes have a single clear owner.
- Data-loss paths are identified and tested.
- Persistent data changes include schema versioning or migration notes.
- Provider-specific fields stay outside the core domain.
- IDs are stable enough for links, tests, and future persistence.

### UX And Accessibility

- Keyboard users can complete the touched workflow.
- Inputs, selects, buttons, regions, and forms have accessible names.
- Focus is visible.
- Status does not rely on color alone.
- Desktop and mobile layouts avoid document/body scroll in the app shell.
- Text does not overflow or overlap at supported breakpoints.
- Design detector returns no findings for touched UI files.

### Testing

- Feature-specific test plan exists before product-code implementation.
- Automated tests cover the new primary workflow.
- Regression tests cover every previously completed feature touched by the branch.
- Browser QA covers desktop and mobile for touched UI.
- `pnpm check` passes before merge.
- Manual sign-off notes are written into the feature test plan.

### Reliability

- Invalid input is rejected or normalized.
- Unsafe drafts are cleared when context changes.
- Destructive actions preserve recovery paths or require explicit intent.
- Corrupt persisted state has a recovery route once persistence exists.
- Long-running or external actions have loading, retry, and failure states once external actions exist.

### Security And Privacy

- No secrets are committed.
- No user data is sent to external services without an explicit feature requirement.
- Export/import behavior is intentional and documented once implemented.
- Integration tokens, webhook secrets, and provider permissions are handled only inside integration modules.
- Public/private visibility is tested anywhere public surfaces exist.

### Performance

- The app remains responsive with realistic seed sizes for the feature.
- Lists use bounded rendering or a plan for virtualization before large datasets.
- Bundle growth is reviewed for new dependencies.
- Browser QA checks horizontal overflow and fixed-shell behavior.

### Release

- Feature has a rollback plan.
- Production build has been smoke-tested.
- Migration changes include rollback notes.
- Release notes are clear enough for a user or self-host admin.
- Security-sensitive changes define patch/response expectations.

## Release Process Standard

OpenRoad releases must eventually include:

- Semantic versioning.
- Release candidates.
- Generated changelog from merged feature plans.
- Production build smoke test.
- Migration dry-run where migrations exist.
- Docker image publishing for self-host.
- Signed artifacts if distribution requires it.
- Rollback criteria.
- Support window.
- Security patch process.
- Self-host upgrade notes.

## Current Readiness Debt

These are known production gaps after hosted webhook registration and release operations.

- Some UI orchestration still lives inside `App.tsx`; the first helper/module extraction is complete, but component-level splitting remains future work.
- Product, integration, and team persistence are file-backed with schema migration and backup/restore tooling, not managed SQL with online migrations.
- Full-state APIs are protected by single-user/admin-token mode, and admin-token deployments now have httpOnly owner browser sessions plus invitation-token, account-password, and account-recovery member browser sessions scoped to one workspace and role.
- Persistent workspace membership, audit events, owner browser sessions, invitation management UI, member invite sessions, JSONL invitation delivery handoff, HTTP invitation provider delivery, account password login, JSONL account recovery handoff, and owner member role/deactivation controls exist, but built-in SMTP delivery, provider-specific invitation/recovery templates, OAuth login, email verification, bulk member operations, MFA/passkeys, SSO, and hosted account administration are not implemented.
- Backup/restore, local self-host smoke commands, and release candidate manifests exist, but published Docker images, artifact signing infrastructure, and hosted release promotion are not implemented.
- Private structured operational events exist for core server workflows, but dashboards, metrics exporters, tracing, and alerting are pending.
- Public portal write controls, persisted anonymous visitor vote identity, idempotent vote dedupe, notification preferences, and process-local rate limits exist, but CAPTCHA/external bot checks, public identity verification, and distributed abuse controls are pending.
- Payload-backed GitHub issue import/link, GitHub App installation verification, live issue fetch, signed GitHub/Linear/Jira webhook handling, hosted GitHub App webhook registration, safe disconnect APIs, encrypted server-only provider credential storage, provider-neutral background sync job metadata, GitHub/Linear/Jira workers for already-linked issue mappings, Linear/Jira OAuth callback exchange and refresh-token rotation, progressive browser Settings integration visibility with GitHub/Linear/Jira connect, credential, disconnect, manual sync, conflict resolution, and hosted webhook registration controls, explicit provider write-back for linked GitHub/Linear/Jira issues, payload-backed Linear issue import/link, payload-backed Jira issue import/link, requester notification outbox/preferences, JSONL notification delivery handoff, and HTTP requester notification provider delivery exist, but built-in SMTP/provider-specific notification templates and Linear/Jira hosted webhook creation are not implemented yet.
- Deterministic local assistant triage exists, but real model-backed adapters, prompt redaction, user consent controls, AI audit logs, and external-provider policy review are not implemented yet.
- Browser QA is manual rather than automated end-to-end CI.

## Next Production Move

Next branch: `feat/model-adapter-foundation`

Purpose:

- Replace deterministic local assistant-only triage with a server-side model adapter boundary that keeps prompts, consent, redaction, and auditability explicit.
- Preserve privacy boundaries by sending only approved, bounded context to any external model provider.
- Keep the current deterministic assistant as the default fallback until provider configuration and consent are in place.
- Preserve the existing production gate: feature branch, test plan first, focused tests, `pnpm check`, browser QA when UI changes, smoke test, audit, merge, then push.

Built-in SMTP/provider-specific notification templates, Linear/Jira hosted webhook creation, real model-backed AI, SSO/MFA, bulk member operations, and hosted account management remain hardening work that should stay behind server-only secret management, background job controls, explicit delivery infrastructure, and/or user consent controls.
