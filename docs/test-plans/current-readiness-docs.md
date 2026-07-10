# Feature Test Plan: Current Readiness Docs

Branch: `fix/current-readiness-docs`

## Objective

Bring the build plan, readiness contract, and release evidence notes in line with the current OpenRoad production candidate after provider write-back merged to `main`.

## User Story

As the project owner, I need the roadmap and readiness docs to tell the truth about what is already production-checked and what still belongs to future hardening, so the next development branch starts from a clear operating picture.

## Scope

- Update stale feature statuses for roadmap, changelog, and public portal surfaces.
- Update the older architecture plan status marker for the roadmap domain.
- Update the current maturity-stage summary after GitHub/Linear/Jira sync, provider connect/disconnect, OAuth refresh, webhooks, and provider write-back.
- Update current readiness debt so completed features are no longer listed as pending.
- Preserve explicit future limits for hosted SaaS, managed persistence, direct provider notification delivery, conflict UI, hosted webhook registration, real model-backed AI, observability, signing, and registry publishing.
- Record branch evidence after checks and merge readiness.

## Not In Scope

- Product-code changes.
- UI changes.
- New deployment infrastructure.
- Rewriting historical feature evidence beyond clarifying what has changed since that evidence was written.

## Acceptance Criteria

- Docs no longer claim provider connect/disconnect UI is the next branch after it has already shipped.
- Docs no longer describe Feature 5 roadmap planning, Feature 6 changelog drafts, or Feature 7 public portal as unimplemented or active when they are production-checked.
- Current-stage language distinguishes the self-host/integration production candidate from future hosted public SaaS hardening.
- Remaining limitations are concrete and current.
- `pnpm check`, `pnpm release:verify`, and GitHub Actions remain green after the docs-only merge.

## Verification Checklist

- `rg` review for stale "active", "next branch", and outdated remaining-gap language in `docs/ARCHITECTURE_PLAN.md`, `docs/BUILD_PLAN.md`, `docs/PRODUCTION_READINESS.md`, `docs/test-plans/public-release-ops.md`, and `README.md`.
- `pnpm check`.
- `pnpm release:verify`.
- GitHub Actions for `main` after merge.

## Evidence

- Branch: `fix/current-readiness-docs`
- Implementation commit SHA: `c1633e7b6040fa347b50fd83237421b6f9436840`.
- Date: 2026-07-10.
- Commands run:
  - `rg -n "Status: active|provider-connect-disconnect-ui|after the account recovery foundation|Remaining larger product gaps|live Linear/Jira sync|app-level error boundary recovery|provider connection management usable|notification preferences.*pending" docs README.md` confirmed no stale status/next-branch language remains; remaining matches are current readiness wording or historical context.
  - `git diff --check` passed.
  - `pnpm check` passed 34 test files and 430 tests; production client/server builds passed.
  - `pnpm release:verify` passed; dry-run manifest remained Docker `dry-run` and signing `not-configured`.
- Acceptance criteria status: Passed before merge.
- Browser/viewports tested: Not expected; docs-only change.
- Accessibility checks: Not expected; docs-only change.
- Reviewer notes: Docs-only cleanup. No runtime, API, schema, or rendered UI behavior changed. The current docs now point next hardening toward conflict resolution instead of already-shipped provider connection UI, and keep hosted/public SaaS limits explicit.
- Rollback notes: Revert this docs branch; no data or runtime migration.
