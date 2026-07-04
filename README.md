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

OpenRoad now has a working standalone product loop and a production server foundation:

- React app shell for requests, work, roadmap, changelog, portal, and settings.
- Versioned OpenRoad domain state with local persistence, import/export, and recovery.
- Public/private visibility for requests, comments, roadmap items, and changelog entries.
- Production Node server that serves the built app and same-origin OpenRoad APIs.
- File-backed server persistence for a single-tenant self-host or evaluation install.

Current production limits are explicit: authentication, team roles, tenant membership, managed database migrations, hosted CI/CD, observability, and provider integrations are planned next-stage work.

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

## Local Development

```powershell
pnpm install
pnpm dev
```

## Production Run Path

```powershell
pnpm install --frozen-lockfile
pnpm build
$env:OPENROAD_DATA_FILE="C:\openroad\openroad-state.json"
$env:PORT="4173"
pnpm start
```

The server exposes:

- `GET /api/health`
- `GET /api/openroad/contract`
- `GET /api/openroad/state`
- `PUT /api/openroad/state`
- `POST /api/openroad/actions`
- `GET /api/openroad/workspaces/:workspaceId`
- `GET /api/openroad/workspaces/:workspaceId/portal`

When `OPENROAD_ADMIN_TOKEN` is configured, private state APIs require `Authorization: Bearer <token>`. The portal API remains public and returns only the public projection. See [API auth and tenancy contract](docs/API_AUTH_TENANCY_CONTRACT.md).
