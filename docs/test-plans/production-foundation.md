# Feature Test Plan: Production Foundation

Branch: `feat/production-foundation`

## Objective

Make OpenRoad runnable as a production build with a real server boundary, durable server-side state, server validation, and a documented start path while preserving the standalone local-first workflow.

## User Story

As a product owner self-hosting or evaluating OpenRoad, I can build the app, start one production process, keep workspace data outside the browser, and trust that invalid or private data does not leak through public APIs.

## Scope

- Production Node server for the built React app.
- Same-origin OpenRoad state API.
- File-backed server store with a replaceable storage interface.
- Server-side schema migration and validation using the existing OpenRoad domain.
- Public portal API projection using existing public/private visibility rules.
- Production-only client sync to the server API with localStorage fallback.
- Build and start scripts.
- README and release notes for the production foundation.

## Not In Scope

- Managed database migrations.
- Authentication provider.
- Multi-user roles.
- Workspace membership UI.
- Provider integrations.
- Webhooks.
- Background job queue.
- Billing.
- Hosted CI/CD.

## Acceptance Criteria

- `pnpm build` compiles the client and server.
- `pnpm start` serves the production app and API from one process.
- Missing server data initializes from the current OpenRoad seed state.
- Existing schema migration code validates and migrates server data.
- Invalid or future-schema server writes are rejected with a structured API error.
- Server writes are persisted outside browser localStorage.
- Public portal API returns only public requests, public comments, public roadmap items, and public ready changelog entries.
- Static file serving blocks path traversal.
- Client production sync does not break local development, tests, or standalone fallback.
- No GitHub, Jira, Linear, or AI dependency is introduced.

## Permission And Trust Matrix

- Local owner: can read and replace all server state in this foundation slice.
- Public visitor: can read only the public portal projection.
- Provider actor: not implemented.
- Team member roles: not implemented.
- Tenant isolation: single-tenant foundation only; cross-workspace isolation is enforced by workspace id selection inside one state file.

## Automated Test Checklist

- File store creates a seed state when the data file is missing.
- File store persists a modified state and reloads it from disk.
- File store migrates previous-schema persisted state.
- File store recovers to seed when persisted JSON is corrupt.
- File store rejects future-schema state.
- State API returns current schema state.
- State API persists valid replacement state.
- State API rejects invalid JSON.
- State API rejects invalid OpenRoad state.
- Public portal API returns public projection for an existing workspace.
- Public portal API returns `404` for an unknown workspace.
- Public portal API does not expose private request, comment, roadmap, changelog, requester source, or private notes.
- Static server returns `index.html` for app routes.
- Static server rejects path traversal.
- Unsupported methods return structured API errors.
- Existing domain migration/import/export tests still pass.
- Existing App workflow tests still pass.

## Regression Checklist

- Workspace creation and selection still work.
- Standalone request capture still works.
- Request triage and duplicate merge still work.
- Native work items still work.
- Roadmap Now/Next/Later movement still works.
- Changelog draft creation still works.
- Public portal preview still respects public/private visibility.
- Local persistence fallback still works in test/dev mode.
- Import/export still works.
- Optional integration chips remain non-blocking.

## Security And Privacy Checks

- No secrets are added to the repository.
- Server API responses use a consistent error shape without stack traces.
- User-authored strings remain JSON data, not rendered as HTML by the server.
- Public API uses `createPublicPortalSnapshot`, not raw workspace data.
- Static server normalizes paths before reading files.
- Environment variables are documented without committing `.env`.

## Migration And Rollback

- Server data uses the existing `openRoadSchemaVersion`.
- Existing localStorage state is not automatically uploaded; users keep local fallback unless the production server API is available.
- Roll back by reverting this branch and keeping the server data JSON file as an export candidate.
- If the server data file becomes invalid, the server recovers to seed data and writes a timestamped backup of the corrupt file.

## Manual QA Checklist

- Run `pnpm check`.
- Run `pnpm build`.
- Start production server with a temporary `OPENROAD_DATA_FILE`.
- Call `/api/health`.
- Call `/api/openroad/state`.
- Replace state through `/api/openroad/state`.
- Call `/api/openroad/workspaces/acme/portal`.
- Open the served app in a browser and confirm the dashboard loads.
- Confirm browser body scroll remains locked in the production app shell.

## Evidence

- Branch: `feat/production-foundation`
- Commit SHA: `50f4603`.
- Date: 2026-07-03.
- Commands run:
  - `pnpm vitest run server/store.test.ts server/http.test.ts`: 13 tests passed.
  - `pnpm check`: 71 tests passed; client and server production builds passed.
  - Production smoke on port `4187`: `/api/health`, `/api/openroad/state`, `/api/openroad/workspaces/acme/portal`, and `/roadmap` passed.
- Browser/viewports tested:
  - Production server on port `4188`, `1440x900`: root rendered, body overflow hidden, app shell height matched viewport, no horizontal overflow, operations deck owned scrolling.
  - Production server on port `4188`, `390x844`: root rendered, body overflow hidden, app shell height matched viewport, no horizontal overflow, operations deck owned scrolling.
- Accessibility checks: No visual layout change beyond persistence status behavior; existing app accessibility tests passed.
- Reviewer notes: Subagent audit completed read-only; server plan incorporated its recommendations for corrupt-state backup, public projection endpoint, validation, and localStorage fallback risks.
- Known unresolved risks: Managed database, auth, tenant roles, hosted CI/CD, backup/restore drills, and observability remain planned production slices.
- Rollback notes: Revert branch; preserve any `OPENROAD_DATA_FILE` JSON as user data.
