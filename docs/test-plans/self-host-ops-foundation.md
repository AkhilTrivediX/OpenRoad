# Feature Test Plan: Self-Host Operations Foundation

Branch: `feat/self-host-ops-foundation`

## Objective

Make OpenRoad self-hostable through a repeatable container path, documented admin bootstrap, operator-owned backup and restore commands, and a production smoke script that validates the running instance without exposing secrets.

## User Story

As a self-host operator, I can configure OpenRoad from environment variables, start it with Docker Compose, back up and restore its product/team data files, run a smoke check after deploy or rollback, and understand the limits of the current stage before inviting users.

## Scope

- Dockerfile for production build and runtime.
- Docker Compose service with persistent data volume and documented environment.
- Backup command for OpenRoad state and team metadata files.
- Restore command that validates backup contents before replacing active data.
- Smoke command for health, contract, portal, and authenticated/private API checks.
- Operator documentation for admin bootstrap, secrets, backup, restore, upgrade, rollback, and current limits.
- Package scripts that run the new operational commands without extra global tools.

## Not In Scope

- Managed SQL database.
- Docker image publishing.
- Kubernetes manifests.
- OAuth/session login.
- Email invitations.
- Provider integrations.
- Hosted SaaS deployment promotion.
- Automated browser E2E in CI.
- Billing or license enforcement.

## Acceptance Criteria

- A clean clone can build the production container using the checked-in Dockerfile.
- Docker Compose defines one OpenRoad service with persistent `/data` storage.
- Runtime environment variables are explicit and use placeholders for secrets.
- Backup command captures `OPENROAD_DATA_FILE` and `OPENROAD_TEAM_FILE` together.
- Backup metadata records schema versions, source file names, creation time, and app package version.
- Restore command refuses invalid archive shape unless explicitly forced.
- Restore command always requires both state and team backup files.
- Restore command preserves the currently active data files before replacing them.
- Smoke command exits non-zero when health, contract, portal, or private auth checks fail.
- Smoke command supports admin-token and single-user modes.
- Operator docs explain first admin bootstrap without committing secrets.
- Upgrade notes explain pre-upgrade backup, smoke test, rollback, and current data-file limits.
- Existing production server, auth, team, public portal, and app workflows still pass.

## Automated Test Checklist

- Backup command writes an archive directory with state, team metadata, and manifest.
- Backup manifest includes both expected files and version metadata.
- Backup command fails when a required source file is missing.
- Restore command validates a valid backup and replaces active files.
- Restore command creates a pre-restore safety backup of active files.
- Restore command rejects a backup missing required data.
- Smoke command passes against a running server in single-user mode.
- Smoke command denies private APIs without token when token mode is configured.
- Smoke command passes private API checks with `OPENROAD_ADMIN_TOKEN`.
- Existing API/auth/tenancy tests still pass.
- Existing team SaaS tests still pass.
- Existing store/domain/app tests still pass.
- `pnpm check` passes.

## Regression Checklist

- `pnpm start` still serves the built app and APIs.
- `OPENROAD_DATA_FILE` and `OPENROAD_TEAM_FILE` defaults still work for local operators.
- Public portal remains unauthenticated and public-data-safe.
- Admin token mode still protects private state and ops endpoints.
- Single-user mode still works when no admin token is configured.
- Workspace-scoped APIs still avoid leaking full state.
- Audit event persistence still works after file backup/restore operations.
- No frontend UI complexity is added by this operations branch.

## Security And Privacy Checks

- No secrets are committed.
- Docker and Compose examples use placeholder tokens only.
- Backup archives are local filesystem artifacts and are not uploaded by tooling.
- Smoke output does not print admin token values.
- Restore validation checks schema shape before replacing active files.
- Active files are preserved before restore to reduce accidental data loss.
- Docs warn operators to store backups securely because they contain requester and team data.

## Migration And Rollback

- No product data schema version changes are planned.
- Rollback by restoring the previous app version and the pre-upgrade backup pair.
- Restore command creates an additional pre-restore safety copy of the current files.
- If a restore is wrong but valid, stop the server and restore from the safety backup.
- Existing corrupt-file recovery in the production server remains unchanged.

## Manual QA Checklist

- Run `pnpm vitest run server/store.test.ts server/team.test.ts server/http.test.ts`.
- Run `pnpm vitest run scripts/openroad-ops.test.ts`.
- Run `pnpm check`.
- Build production app.
- Start production server with temporary data/team files.
- Run smoke command in single-user mode.
- Start production server with `OPENROAD_ADMIN_TOKEN`.
- Run smoke command with token and verify unauthenticated private API denial.
- Run backup command against temporary data files.
- Restore into a fresh target directory and compare restored files.
- Review Dockerfile and Compose for secret leakage and persistent volume behavior.

## Evidence

- Branch: `feat/self-host-ops-foundation`
- Commit SHA: `f014f98`.
- Date: 2026-07-04.
- Acceptance criteria status: Passed for Node production self-host path, backup/restore tooling, token-mode smoke, docs, and static container review. Docker build/config execution was not run because Docker is not installed in this environment.
- Commands run:
  - `pnpm vitest run scripts/openroad-ops.test.mjs`: 7 tests passed.
  - `pnpm vitest run scripts/openroad-ops.test.mjs server/store.test.ts server/team.test.ts server/http.test.ts server/access.test.ts`: 38 tests passed before the final smoke-script corrections.
  - `pnpm check`: 98 tests passed; client and server production builds passed.
  - Production single-user smoke on port `4197`: `pnpm ops:smoke` passed health, contract, portal, and private single-user checks.
  - Production backup/restore drill on temporary files: `pnpm ops:backup` produced manifest plus state/team files; `pnpm ops:restore` restored both files and created a pre-restore safety directory.
  - Production token-mode smoke on port `4198`: `pnpm ops:smoke -- --admin-token ...` passed health, contract, portal, unauthenticated private denial, and authenticated private access.
  - `docker --version`: unavailable; Docker is not installed in the current environment.
- Browser/viewports tested: No UI changes expected; production smoke covers server endpoints.
- Accessibility checks: No UI changes expected.
- Reviewer notes: Self-review completed against production readiness checklist; no subagent review used for this operations-only branch.
- Known unresolved risks: Managed database, published Docker images, automated browser E2E CI, OAuth/session login, named-volume backup helper, and hosted deployment promotion remain future production slices.
- Rollback notes: Revert branch; restore the previously backed-up `OPENROAD_DATA_FILE` and `OPENROAD_TEAM_FILE` pair.
