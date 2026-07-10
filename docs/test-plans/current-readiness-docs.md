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
- Implementation commit SHA: Pending.
- Date: 2026-07-10.
- Commands run: Pending.
- Acceptance criteria status: Pending.
- Browser/viewports tested: Not expected; docs-only change.
- Accessibility checks: Not expected; docs-only change.
- Reviewer notes: Pending.
- Rollback notes: Revert this docs branch; no data or runtime migration.
