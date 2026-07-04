# Feature Test Plan: Public Release Operations

Branch: `feat/public-release-ops`

## Objective

Make OpenRoad release promotion repeatable for self-host and future SaaS operators by adding versioned release candidate tooling, release manifest validation, artifact checksum planning, security patch workflow documentation, support-window policy, and upgrade/rollback instructions.

## User Story

As an OpenRoad maintainer, I can cut a release candidate from a clean production branch, prove which gates passed, generate a release manifest for operators, and publish or roll back the release using a documented process.

## Scope

- Release candidate manifest model.
- Semantic version validation.
- Release checklist generation from package version, git commit, build outputs, and verification evidence.
- Checksums for built artifacts that exist locally.
- Explicit signing policy for the current stage.
- Docker image publishing plan and dry-run metadata.
- Security patch and support-window policy.
- Self-host upgrade and rollback documentation tied to backup/restore and smoke commands.
- CI release verification command that can run without secrets.

## Not In Scope

- Actually publishing Docker images to a registry.
- Real artifact signing keys or key-management integration.
- Hosted SaaS deployment automation.
- Billing or subscription administration.
- Database migration dry-runs beyond documenting the current no-managed-database state.
- Changing runtime product data schemas.

## Acceptance Criteria

- A maintainer can run a release command locally to create a release candidate manifest.
- Invalid semantic versions are rejected.
- Release manifests include package version, git commit, generated timestamp, release channel, support window, required verification gates, artifact checksum entries, and current signing/publishing mode.
- Release tooling fails when required build artifacts are missing.
- Release tooling can run in dry-run mode without writing files.
- Release docs define release candidate, stable release, security patch, rollback, and support-window rules.
- Self-host upgrade docs reference backup, restore, smoke, and rollback commands.
- CI runs the release verification path without publishing or requiring secrets.
- Existing product tests, ops tests, production build, and self-host smoke still pass.

## Automated Test Checklist

- Release helper accepts valid semver versions.
- Release helper rejects invalid semver versions.
- Release helper rejects unsupported channels.
- Release helper creates a manifest with stable keys and required verification gates.
- Release helper computes SHA-256 checksums for existing build artifacts.
- Release helper rejects missing required artifacts in strict mode.
- Release helper supports dry-run output without writing a manifest file.
- Release helper records Docker publishing as planned/dry-run unless explicit publish metadata is supplied.
- Release helper records signing as not configured unless signing metadata is supplied.
- CLI argument parsing covers `--version`, `--channel`, `--commit`, `--output`, `--dry-run`, and `--json`.
- Existing ops backup/restore/smoke tests still pass.
- `pnpm check` passes.

## Regression Checklist

- `pnpm build` still creates the client and server build used by production start.
- `pnpm ops:smoke` still validates public portal and private API boundaries.
- Backup manifests still record app package version.
- No product domain schema version changes are introduced.
- No secrets, signing keys, registry credentials, or tokens are committed.
- Docker Compose self-host path remains build-local and useful.
- Release docs do not claim hosted SaaS deployment, registry publishing, or signed artifacts are complete when they are not.

## Security And Privacy Checks

- Release tooling must not print environment secrets.
- Release manifests must not include admin tokens, provider secrets, local data-file contents, requester data, backup contents, or private workspace data.
- Signing and registry publishing remain dry-run/planned unless an operator provides external infrastructure later.
- Security patch process includes triage, private fix branch, advisory notes, patched release, and operator upgrade guidance.

## UX And Accessibility Checks

- No user-facing product UI changes are expected.
- Browser QA is not required unless implementation touches rendered UI.
- CLI output should be direct and actionable.

## Migration And Rollback

- No product data schema migration is expected.
- Rollback is a normal code rollback for this branch.
- Release rollback docs must preserve the existing operator flow: stop writes, restore previous app image/build, restore backup if data changed, start, smoke-test, reopen access.

## Manual QA Checklist

- Run focused release helper tests.
- Run `pnpm check`.
- Build production assets and run release manifest generation.
- Run built-server smoke with integration environment variables unset.
- Review generated release manifest for no secrets/private data.
- Review release docs for honest current-stage limits.

## Evidence

- Branch: `feat/public-release-ops`
- Commit SHAs: pending.
- Date: 2026-07-04.
- Acceptance criteria status: pending.
- Commands run: pending.
- Browser/viewports tested: Not expected unless rendered UI changes.
- Accessibility checks: pending.
- Reviewer notes: pending.
- Known unresolved risks: Actual Docker registry publishing, artifact signing key management, hosted SaaS deployment automation, billing/admin controls, managed database migrations, and automated browser E2E CI remain future slices unless explicitly implemented in this branch.
- Rollback notes: No data migration expected; rollback by reverting the branch.
