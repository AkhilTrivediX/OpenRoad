# Branching And Release Workflow

## Branch Naming

Use feature and fix names, not phase numbers. This is a merge blocker.

Allowed prefixes:

- `feat/`
- `fix/`

Examples:

- `feat/workspace-shell`
- `feat/standalone-requests`
- `feat/request-triage`
- `feat/roadmap-now-next-later`
- `feat/changelog-drafts`
- `feat/public-portal`
- `feat/integration-adapter-contract`
- `feat/github-issue-sync`
- `fix/request-status-regression`
- `fix/roadmap-public-private-leak`

Avoid:

- `codex/phase-01`
- `phase-02-feedback`
- vague names like `feat/mvp` or `feat/misc`.

## Merge Rule

A branch can merge only when:

1. The branch name uses `feat/...` or `fix/...`.
2. The feature-specific test checklist exists before product-code implementation.
3. The implementation satisfies its acceptance criteria.
4. Regression checks from previously completed features pass.
5. Accessibility checks pass for touched UI.
6. Standalone mode still works.
7. Integration paths, if touched, remain optional.
8. Data durability is implemented or the branch is explicitly foundation/planning-only.
9. Auth, permissions, and public/private visibility are defined for touched surfaces.
10. Security and privacy risks are addressed for user input, requester data, public surfaces, secrets, dependencies, and external calls.
11. Schema or data-shape changes include migration and rollback notes.
12. Production build and required CI commands pass.
13. Browser QA covers touched desktop and mobile surfaces.
14. The branch has a focused change summary and evidence block.
15. Product, code, UX/a11y, and security review requirements are satisfied for the risk level.

## Required Evidence Block

Every feature test plan sign-off must include:

- Branch name.
- Commit SHA.
- Date.
- Acceptance criteria status.
- Commands run and result summary.
- Browser/viewports tested for UI changes.
- Accessibility checks completed.
- Screenshots or recordings for visual UI changes when useful.
- Reviewer or subagent review notes when used.
- Known unresolved risks.
- Rollback notes.

## CI Gate

Before protected `main` is enabled, run this locally for every merge:

- Install from lockfile.
- `pnpm check`.
- Design detector for touched UI files.
- Browser QA for touched UI files.
- Dependency and secret review when dependencies, env, integrations, or public surfaces change.

After CI is configured, these checks must be required before merge.

## Production Data Gate

User-created data must not disappear on refresh in any production path.

Until durable persistence exists, workflow branches after Feature 4 should not add more user-facing domain surface. The next implementation feature must create the domain-state and persistence foundation.

Durable feature branches must define:

- Storage owner.
- Schema version.
- Migration behavior.
- Corrupt-state recovery.
- Export/import or backup expectations.
- Data-loss regression tests.

## Permission Gate

Any branch touching workspaces, requests, comments, roadmap, changelog, portal, integrations, notifications, or requester metadata must define:

- Who can view.
- Who can create.
- Who can edit.
- Who can delete/archive.
- Who can publish publicly.
- How cross-workspace isolation is enforced.
- How no-permission states appear.

## Security And Privacy Gate

Branches must address relevant risks:

- XSS-safe rendering for user text.
- Input validation and normalization.
- Requester PII handling.
- Public portal abuse and moderation.
- Secret and environment handling.
- Dependency vulnerability review.
- Provider token handling.
- Webhook signature verification.
- Export/import privacy.

## Deployment And Rollback Gate

Production-ready features must have:

- Preview or staging deployment path once hosting exists.
- Smoke test from production build.
- Rollback plan.
- Migration rollback notes for data-shape changes.
- Operational owner for high-risk features.

## Observability Gate

Production features should define:

- User-visible error handling.
- Developer-visible error reporting.
- Privacy-aware telemetry events, if telemetry exists.
- Operational logs for external jobs, sync, imports, exports, notifications, and AI actions.
- Hidden sync/audit surfaces in Settings or inspectors, not default navigation.

## Performance Gate

Branches touching UI or data volume must consider:

- Bundle impact.
- Initial load.
- Interaction latency.
- Filtering/search behavior with realistic list sizes.
- Mobile responsiveness.
- Need for pagination or virtualization.

Initial local budgets:

- App shell should remain interactive with at least 250 requests and 100 work items in a workspace.
- No horizontal overflow at `390x900`, `768x900`, and `1440x900`.
- Document/body scroll remains `0`; `.operations-deck` owns app scrolling.

## Suggested Flow

1. Start from `main`.
2. Create a named feature branch.
3. Write or update the test checklist.
4. Implement the scoped work.
5. Run tests and manual checks.
6. Run required local CI and browser checks.
7. Request subagent review if the feature is broad, risky, security-sensitive, data-sensitive, or UX-sensitive.
8. Write the evidence block into the test plan.
9. Merge to `main` only after the gate passes.

## Release Rhythm

Use small, mergeable increments. A feature is not complete because code exists; it is complete when the workflow is usable, tested, accessible, and does not break prior workflows.
