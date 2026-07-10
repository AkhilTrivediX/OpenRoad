# Feature Test Plan: Conflict Resolution UI

Branch: `feat/conflict-resolution-ui`

## Objective

Surface conflicted provider mappings in Settings and give owners explicit, auditable resolution actions without adding noise to standalone or healthy connected workflows.

## User Story

As a workspace owner, I need to see when a linked GitHub, Linear, or Jira issue is in conflict and choose what happens next, so OpenRoad never silently overwrites product decisions and never leaves provider sync stuck without a clear recovery path.

## Scope

- Extend sanitized integration status with conflicted mapping counts and compact conflict summaries.
- Add a workspace-scoped conflict resolution API for linked issue mappings.
- Support three owner actions:
  - Keep OpenRoad: clear the conflict and preserve the current OpenRoad request.
  - Accept provider: fetch the current provider issue, apply the existing provider-to-OpenRoad issue sync mapping, clear the conflict, and update `lastSyncedAt`.
  - Disconnect mapping: disconnect only the conflicted mapping, preserving the provider account and unrelated mappings.
- Add a compact Settings conflict surface inside the existing provider management area.
- Keep standalone mode and healthy provider rows uncluttered.
- Record sanitized sync/audit events and avoid returning provider secrets, encrypted payloads, raw upstream responses, or authorization material.
- Update readiness docs so conflict UI is no longer listed as missing.

## Not In Scope

- Automatic conflict detection heuristics or stored conflict snapshots.
- Field-by-field merge UI.
- Bulk conflict resolution.
- Conflict resolution for provider object types other than linked issues.
- Distributed locks beyond the existing integration mutation lock.
- Hosted webhook registration automation, direct provider notification delivery, or real model-backed AI.

## Acceptance Criteria

- Integration status includes `conflictedMappings` and a bounded `conflicts` list per provider without leaking secrets or raw provider payloads.
- Conflict summaries include only safe identifiers: mapping id, installation id, provider account name, OpenRoad request id/title/status, external issue id/key/url, timestamps, and provider label.
- Manual sync and write-back remain unavailable for conflicted mappings until the owner resolves them.
- `POST /api/openroad/workspaces/:workspaceId/integrations/:provider/conflicts/:mappingId/resolve` requires `integration:manage`.
- The API rejects unknown providers, non-conflicted mappings, wrong workspaces, wrong providers, disconnected mappings, unsupported object types, missing requests, missing integration store, missing provider read credentials for accept-provider, and unsafe payloads with bounded errors.
- Keep OpenRoad clears only the mapping conflict and records sanitized evidence.
- Accept provider fetches the current provider issue through server-only credentials, applies existing GitHub/Linear/Jira request sync transforms, clears the mapping conflict, and records sanitized evidence.
- Disconnect mapping marks only the target mapping disconnected and records sanitized evidence.
- Browser Settings shows a small conflict callout only for providers with conflicts, with the three resolution actions grouped under the provider row.
- Successful UI resolution refreshes integration status and server state, and failure renders a short safe message.
- Existing standalone requests, normal provider connection management, manual sync, write-back, webhooks, OAuth refresh, and release tooling remain green.

## Automated Test Checklist

- Server/API tests:
  - Status endpoint reports conflicted mapping counts and bounded summaries.
  - Keep OpenRoad resolves a conflicted GitHub/Linear/Jira mapping to active without changing the request.
  - Accept provider resolves a conflicted GitHub mapping by fetching the issue and updating the linked request.
  - Accept provider resolves a conflicted Linear mapping with encrypted credentials and no token leakage.
  - Accept provider resolves a conflicted Jira mapping with encrypted credentials and no token leakage.
  - Disconnect mapping affects only the requested mapping.
  - Non-owner actors cannot resolve conflicts.
  - Non-conflicted, disconnected, wrong provider, wrong workspace, unsupported type, and missing request cases are rejected safely.
  - Provider upstream failures are sanitized and do not clear the conflict.
- Browser client tests:
  - Status parser keeps conflict summaries and redacts token-shaped text.
  - Resolve helper posts the selected resolution and handles sanitized errors.
- UI tests:
  - Settings shows no conflict callout for standalone/healthy providers.
  - Settings shows a compact conflict callout for a conflicted provider.
  - Keep OpenRoad, Accept provider, and Disconnect mapping buttons call the resolve API and refresh state.
  - The UI does not render provider tokens, encrypted payload internals, or raw provider errors.
- Regression tests:
  - Existing Settings provider connect/disconnect and manual sync tests remain green.
  - Existing write-back UI test remains green.
  - `pnpm check`, built-server smoke, release verification, and GitHub Actions pass.

## Evidence

- Branch: `feat/conflict-resolution-ui`
- Implementation commit SHA: `cf203a7b71308ecf912ce4c92e840339d59d6c92`.
- Date: 2026-07-10.
- Commands run:
  - `pnpm build:server` -> passed.
  - `pnpm build:client` -> passed after parser literal alignment.
  - `pnpm vitest run src/persistence/openroadIntegrations.test.ts src/App.test.tsx` -> 2 files, 81 tests passed.
  - `pnpm vitest run server/http.test.ts` -> 109 tests passed.
  - `git diff --check` -> passed.
  - `pnpm check` -> 34 files, 437 tests passed, then client and server production builds passed.
  - `pnpm release:verify` -> release manifest dry-run passed for current build artifacts.
  - Built-server smoke against `server-dist/server/index.js` on `http://127.0.0.1:4222` with temporary file-backed state and admin token -> `OpenRoad smoke passed: health, contract, portal, private-denied, private-token`.
- Acceptance criteria status: Passed before merge.
- Browser/viewports tested: In-app browser against the built server on `http://127.0.0.1:4222`; desktop viewport `1280x720` showed the Settings conflict callout at `558x116`, no horizontal overflow, and three actions fitting on one row. Mobile viewport `390x844` showed no horizontal overflow, the conflict callout stacked at `299x289`, and the resolution buttons at touch-friendly `44px` height. The browser Keep OpenRoad action resolved the temporary GitHub conflict, removed the conflict panel, and showed the sanitized success status message.
- Accessibility checks: Conflict actions use named buttons with provider/action/request context; conflict status uses an icon plus text and does not rely on color alone; status updates render through the existing `role="status"` integration action message.
- Reviewer notes: Passed. Conflict resolution is limited to existing conflicted issue mappings for OpenRoad requests. The browser submits only the resolution choice; provider target details and credentials are derived server-side from stored mappings/installations. GitHub accept-provider reads through the GitHub App client; Linear and Jira accept-provider reads open encrypted server credentials and refresh near-expired OAuth material through the existing rotation path. Status responses expose bounded conflict summaries and redact token-shaped text. Healthy and standalone provider rows remain uncluttered.
- Rollback notes: Revert this branch. No schema migration is expected because conflict state already exists on mappings.
