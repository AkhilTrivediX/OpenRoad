# OpenRoad

OpenRoad is a standalone-first, open-source product feedback, roadmap, work, and changelog platform.

The product must be useful with no integrations connected. GitHub, Jira, Linear, Slack, Discord, and support/email sources enrich OpenRoad through optional adapters; they do not define the core workflow.

## Product Promise

OpenRoad helps teams capture user requests, decide what matters, communicate a clear roadmap, connect decisions to delivery work, and close the loop when features ship.

## Core Objects

- Request
- Roadmap item
- Work item
- Changelog entry
- Customer
- Vote
- Comment
- Decision

External providers attach through external links and sync state. Provider-specific concepts must not leak into the core domain model.

## Repository Status

This repository is in planning/bootstrap mode. No product implementation has started yet.

Current docs:

- [PRODUCT.md](PRODUCT.md)
- [DESIGN.md](DESIGN.md)
- [Build plan](docs/BUILD_PLAN.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Branching and release workflow](docs/BRANCHING_AND_RELEASE.md)
- [UI concepts](docs/UI_CONCEPTS.md)

## Working Rule

Before implementation starts for any feature:

1. Create a feature branch named by work, not phase number, for example `feat/workspace-shell`.
2. Write the feature test checklist first.
3. Include regression checks for previously completed features.
4. Implement only the scoped feature.
5. Run the checklist.
6. Merge only when the feature passes its acceptance and regression gates.
