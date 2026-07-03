# Feature Test Plan: Production Readiness Plan

Branch: `feat/production-readiness-plan`

## Objective

Make the OpenRoad roadmap production-grade before further implementation by defining the merge gates, architecture milestones, and readiness standards required for `main` to stay shippable.

## User Story

As the product owner and technical lead, I need every feature merged into `main` to be production-ready for the current maturity stage, with no hidden assumption that later work will fix durability, permissions, security, deployment, or observability.

## In Scope

- Production readiness standard.
- Architecture plan for SaaS and self-host evolution.
- Release and merge gate hardening.
- Test strategy hardening.
- Roadmap reorder to put domain state and persistence before more workflow surface.
- Explicit evidence block requirements for every feature.
- Explicit planning for auth, tenancy, API, integrations, portal security, notifications, deployment, observability, performance, accessibility, security/compliance, billing/admin, and self-host operations.

## Out Of Scope

- Product-code implementation.
- Persistence implementation.
- Auth implementation.
- API implementation.
- CI workflow implementation.
- Deployment pipeline implementation.
- Provider integration implementation.

## Acceptance Criteria

- `docs/PRODUCTION_READINESS.md` defines what `main` means.
- `docs/ARCHITECTURE_PLAN.md` defines the production architecture track.
- `docs/BUILD_PLAN.md` includes `feat/domain-state-persistence` before Roadmap/Changelog/Portal/Integration expansion.
- `docs/TEST_STRATEGY.md` includes production gate questions and evidence block requirements.
- `docs/BRANCHING_AND_RELEASE.md` includes hard merge gates for CI, evidence, persistence, auth/permission, security/privacy, migration, deployment/rollback, observability, performance, and review ownership.
- The plan explicitly acknowledges current readiness debt.
- The plan names `feat/domain-state-persistence` as the next implementation branch.
- Documentation does not claim the current app is full production SaaS before durability/auth/deployment exist.

## Automated Tests

- `pnpm check` must pass to prove planning changes did not break the current app.
- `git diff --check` must pass.

## Manual Tests

- Read the production readiness standard end to end.
- Read the architecture plan end to end.
- Confirm the next implementation branch is persistence/domain foundation, not another UI workflow.
- Confirm merge rules are explicit blockers, not suggestions.
- Confirm every future feature has required evidence fields.
- Confirm completed feature docs remain compatible with the stronger standard.

## Accessibility Checks

- No UI changed.
- Existing accessibility requirements are preserved and strengthened in docs.

## Security Checks

- No secrets or environment values added.
- Security/privacy gate is now explicit before risky surfaces merge.

## Regression Checks

- Current app tests still pass.
- Current build still passes.
- Existing docs still preserve standalone-first and integration-optional product principles.
- Branch naming rule remains `feat/` or `fix/`.

## Known Risks

- Completed early branches were local-only and do not yet meet the new durability standard.
- CI is documented as required but not yet implemented.
- Browser QA is still manual until E2E automation is added.
- Auth, tenancy, backend, and deployment are planned but not implemented.

## Sign-Off Result

Passed on 2026-07-03.

Branch:

- `feat/production-readiness-plan`

Commands:

- `git diff --check`: passed with Windows line-ending notices only.
- `pnpm check`: 28 tests passed and production build passed.

Acceptance:

- Passed. Production readiness, architecture, build, test, and release docs now define the stricter production standard.

Accessibility:

- No UI changed. Accessibility evidence requirements were strengthened for future UI branches.

Security/Privacy:

- No secrets or environment values added.
- Security/privacy gates were added for user-authored content, public surfaces, requester data, provider tokens, webhook signatures, dependency review, and export/import.

Data/Persistence:

- No product data model changed in this planning branch.
- The plan now blocks further workflow expansion until `feat/domain-state-persistence` addresses durable local data, schema versioning, import/export, and corrupt-state recovery.

Performance:

- No runtime UI changed.
- Performance gates and initial app-shell budgets were added for future branches.

Review:

- Subagent production-readiness audit completed with no edits; findings were incorporated.
- Subagent roadmap/architecture audit completed with no edits; findings were incorporated.

Rollback:

- Documentation-only branch. Revert the branch if the production readiness standard needs to be replaced.

Known Risks:

- Completed early branches are still local-only and do not yet meet the new durability standard.
- CI is documented as required but not yet implemented.
- Browser QA remains manual until E2E automation is added.
- Auth, tenancy, backend, deployment, and observability are planned but not implemented.
