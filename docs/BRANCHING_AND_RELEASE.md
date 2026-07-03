# Branching And Release Workflow

## Branch Naming

Use feature and fix names, not phase numbers.

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

1. The feature-specific test checklist exists.
2. The implementation satisfies its acceptance criteria.
3. Regression checks from previously completed features pass.
4. Accessibility checks pass for touched UI.
5. Standalone mode still works.
6. Integration paths, if touched, remain optional.
7. The branch has a focused change summary.

## Suggested Flow

1. Start from `main`.
2. Create a named feature branch.
3. Write or update the test checklist.
4. Implement the scoped work.
5. Run tests and manual checks.
6. Request subagent review if the feature is broad, risky, or UX-sensitive.
7. Merge to `main` only after the gate passes.

## Release Rhythm

Use small, mergeable increments. A feature is not complete because code exists; it is complete when the workflow is usable, tested, accessible, and does not break prior workflows.
