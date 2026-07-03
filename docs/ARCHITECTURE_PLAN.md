# OpenRoad Architecture Plan

OpenRoad should stay standalone-first while growing into a SaaS and self-hostable product. The architecture must keep the core product independent from provider-specific behavior.

## Architecture Principles

- Core domain first, integrations second.
- OpenRoad objects are the source of truth unless a user explicitly links an external object.
- Provider adapters translate between OpenRoad and GitHub/Jira/Linear; they do not shape the core data model.
- Every persistent data shape has a schema version.
- Every user-visible mutation has a named domain action.
- Domain invariants live outside React components.
- UI components call commands; they do not own business rules.
- Public/private visibility is a first-class concern once portal and changelog surfaces exist.
- AI suggestions are advisory records, not silent mutations.

## Target Layers

### App Shell

Owns layout, navigation, density, command surfaces, responsive behavior, and progressive disclosure.

Examples:

- Route index.
- Command deck.
- Operations deck.
- Inspectors.
- Empty/error/loading states.

### Core Domain

Owns provider-neutral business objects and state transitions.

Objects:

- Workspace
- Request
- WorkItem
- RoadmapItem
- ChangelogEntry
- Customer
- Vote
- Comment
- Decision

Actions:

- Create, update, archive, restore request.
- Merge duplicate request.
- Create, update, link, unlink work item.
- Move request/work into roadmap.
- Draft changelog from shipped work.
- Publish portal-visible objects.

Domain modules must eventually include:

- Entity definitions.
- Lifecycle state machines.
- Command handlers.
- Repository ports.
- Domain events.
- Invariant checks.
- Test fixtures.
- Provider anti-corruption boundaries.

Examples of invariants:

- Archived requests cannot be public portal candidates.
- Duplicate merge must preserve source evidence.
- Work links cannot point to missing requests after migration.
- Public roadmap items cannot expose private request details.
- Provider sync cannot delete OpenRoad objects without explicit user intent.

### Persistence

Stage 1 starts local-first, then moves to backend persistence.

Local-first adapter:

- `localStorage` or IndexedDB-backed workspace store.
- Schema version.
- Migration registry.
- Import/export JSON.
- Corrupt-state recovery.

Backend adapter:

- API service.
- Database migrations.
- Tenant-aware queries.
- Server validation.
- Audit events.

Production storage must eventually account for:

- Workspace.
- User.
- Member.
- Role.
- Request.
- Vote.
- Comment.
- WorkItem.
- RoadmapItem.
- ChangelogEntry.
- Customer/requester.
- Decision.
- AuditEvent.
- ExternalLink.
- ExternalSyncState.
- NotificationPreference.
- NotificationOutboxItem.

Persistence planning must include:

- Seed/demo data strategy.
- Migration rollback.
- Backup and restore drills.
- Retention policy.
- Data export and deletion.
- Import validation.

### Auth And Tenancy

Owns identity, membership, roles, and workspace isolation.

Actor types:

- Internal user.
- Workspace owner.
- Workspace member.
- Requester.
- Public visitor.
- Service account.
- Integration actor.
- Self-host bootstrap admin.

Permission model must define who can:

- View workspace data.
- Create requests.
- Vote and comment.
- Triage and merge requests.
- Create or update work items.
- Move roadmap items.
- Publish portal-visible content.
- Publish changelog entries.
- Manage integrations.
- Export/delete data.
- Manage billing or self-host license settings.

Tenancy rules:

- Workspace data must be isolated by tenant.
- Public portal access must read only public objects.
- Integration jobs must run with an installation-scoped actor.
- Audit events must record actor and workspace.

### API Contract

The API must be designed before public portal and integrations.

Required decisions:

- REST, GraphQL, tRPC, or hybrid API shape.
- Versioning policy.
- Request validation.
- Pagination.
- Filtering.
- Sorting.
- Idempotency keys for mutations and webhook processing.
- Optimistic concurrency.
- Error shape.
- Rate limits.
- Generated client strategy.
- Webhook endpoint contract.
- Public portal API boundaries.

### Provider Adapters

Adapters are isolated modules for GitHub, Linear, Jira, and future providers.

Each adapter owns:

- Auth/install flow.
- Provider object fetch/import.
- External object mapping.
- Webhook validation.
- Sync jobs.
- Rate-limit handling.
- Conflict detection.
- Disconnect behavior.

Provider platform requirements:

- OAuth/GitHub App install flows.
- Encrypted token storage.
- Webhook signature verification.
- Job queue.
- Retries and backoff.
- Provider rate-limit handling.
- Replayable sync jobs.
- Sync ledger.
- Source-of-truth rules.
- Conflict resolution UX.

### Public Surfaces

Public surfaces read from OpenRoad visibility rules, not provider permissions.

Surfaces:

- Feedback portal.
- Public roadmap.
- Public changelog.
- Requester notifications.

Public portal trust boundary:

- Public/private visibility enforcement.
- Portal slugs and future custom domains.
- Anonymous or verified requester identity.
- Moderation.
- Spam/rate limits.
- Abuse reporting.
- SEO/indexing policy.
- Private-data leak tests.

### Notifications

Notifications must use an outbox-style model instead of sending directly from UI actions.

Requirements:

- Requester preferences.
- Unsubscribe.
- Digesting.
- Delivery provider boundary.
- Templates.
- Bounce handling.
- Suppression lists.
- Audit trail.
- Anti-spam limits.

### Deployment And Operations

SaaS and self-host topology must be planned before hosted beta.

Runtime units:

- Web app.
- API service.
- Worker.
- Database.
- Cache/queue.
- Object storage.
- Email provider.

Operational requirements:

- Environment variables and secrets.
- Database migrations.
- Health checks.
- Docker Compose for self-host.
- Admin bootstrap.
- Upgrade path.
- Backup/restore.
- Rollback.
- Structured logs.
- Metrics.
- Traces.
- Error reporting.
- Uptime checks.
- SLOs.
- Runbooks.
- Incident process.
- Security event logging.

### Security And Compliance

Production security planning must cover:

- CSRF.
- CORS.
- CSP.
- Session security.
- Token encryption.
- Secret rotation.
- Dependency scanning.
- Audit log immutability.
- Data deletion/export.
- PII boundaries.
- Permission regression tests.

### Billing And Admin Boundary

SaaS and self-host must remain cleanly separated.

Planning items:

- Plan limits.
- Admin roles.
- Usage metering.
- Billing provider boundary.
- Self-host license behavior.
- Feature flags.
- Free/self-host capability guarantee.

## Production Roadmap By Foundation

### Foundation A: Domain State And Persistence

Branch: `feat/domain-state-persistence`

Status: merged to `main`.

Build:

- Extract domain types and actions.
- Introduce reducer/store boundaries.
- Add stable ID helpers.
- Add versioned local persistence.
- Add workspace export/import.
- Add corrupt-state recovery and reset.
- Keep existing UI behavior unchanged.

Why now:

- The app currently loses all data on reload.
- More workflow features would multiply migration risk if built on in-memory state.
- Roadmap/changelog/portal need durable links between requests, work, and public updates.

### Foundation B: Roadmap Domain

Branch: `feat/roadmap-now-next-later`

Status: active.

Build:

- Roadmap item model.
- Now/Next/Later movement.
- Public/private visibility.
- Request/work links.
- Confidence and stale signals.

Dependency:

- Foundation A persistence is complete.

### Foundation B.5: App Decomposition

Branch: `feat/app-module-decomposition`

Build:

- Split monolithic `App.tsx` into feature modules.
- Move domain types/actions out of UI components.
- Add shared UI primitives for buttons, panels, badges, forms, and empty states.
- Add test fixtures for workspace/request/work data.
- Keep visual behavior unchanged.

Dependency:

- Foundation A defines the first domain/store boundary.

### Foundation C: Changelog Domain

Branch: `feat/changelog-drafts`

Build:

- Changelog entry model.
- Draft from shipped work.
- Internal notes versus public copy.
- Requester link preservation.

Dependency:

- Roadmap/work status must be durable.

### Foundation D: Public Portal

Branch: `feat/public-portal`

Build:

- Public request board.
- Public roadmap.
- Public changelog.
- Voting/comment moderation.
- Visibility enforcement.

Dependency:

- Public/private visibility must be tested in roadmap and changelog.

### Foundation E: Adapter Contract

Branch: `feat/integration-adapter-contract`

Build:

- Provider interface.
- External object and external link model.
- Sync state.
- Conflict model.
- Webhook event model.
- Hidden sync logs in Settings.

Dependency:

- Core objects must already be durable and provider-neutral.

### Foundation E.5: API/Auth/Tenancy Contract

Branch: `feat/api-auth-tenancy-contract`

Build:

- API route contract.
- Auth actor model.
- Workspace membership and role matrix.
- Public visitor/requester model.
- Permission test matrix.
- API error and validation shape.

Dependency:

- Domain objects and persistence boundaries must be stable.

### Foundation F: Provider Integrations

Branches:

- `feat/github-issue-sync`
- `feat/linear-issue-sync`
- `feat/jira-issue-sync`

Build:

- Provider-specific auth.
- Import/link flows.
- Status sync.
- Permission-aware UI.
- Disconnect safety.

Dependency:

- Adapter contract must be complete.

### Foundation G: Team And SaaS Readiness

Branch: `feat/team-saas-foundation`

Build:

- Auth.
- Workspace membership.
- Roles.
- API.
- Database migrations.
- Deployment workflow.
- Observability.

Dependency:

- Product loop must prove durable locally first.

### Foundation H: Self-Host And Operations

Branch: `feat/self-host-and-saas-ops`

Build:

- Docker/self-host path.
- Backup/restore.
- Export/import hardening.
- Admin controls.
- Billing foundations if SaaS is enabled.

Dependency:

- Team SaaS foundation must define runtime boundaries.

## Data Model Direction

### Workspace

Owns all user-created OpenRoad objects for a team or project.

Key fields:

- `id`
- `name`
- `plan`
- `summary`
- `requests`
- `workItems`
- `roadmapItems`
- `changelogEntries`
- `integrations`
- `schemaVersion`

### Request

Represents user demand or feedback evidence.

Key relationships:

- Can link to many work items.
- Can link to many roadmap items.
- Can link to changelog entries through shipped work.
- Can preserve merged duplicate source history.

### WorkItem

Represents internal delivery tracking inside OpenRoad.

Key relationships:

- Can link to many requests.
- Can later link to one or more external provider objects.
- Can feed roadmap and changelog workflows.

### RoadmapItem

Represents product commitment or intent.

Key relationships:

- Can link to requests and work items.
- Has lane, visibility, confidence, and stale state.

### ChangelogEntry

Represents public communication.

Key relationships:

- Can link to shipped work, roadmap items, and requesters.
- Separates internal notes from public copy.

### ExternalLink

Represents a provider relationship.

Key fields:

- `provider`
- `externalId`
- `externalUrl`
- `openRoadObjectType`
- `openRoadObjectId`
- `syncState`

Provider fields stay here, not in core objects.

## Testing Architecture Direction

Near-term:

- Component tests remain in Vitest/Testing Library.
- Domain actions get unit tests once extracted.
- Browser QA remains required for touched UI.

Next:

- Add Playwright end-to-end smoke tests for workspace/request/work/roadmap/changelog flows.
- Extend persistence migration tests whenever roadmap/changelog schema changes.
- Add accessibility checks for primary routes.
- Add CI that runs `pnpm check`, lint/type checks, and E2E smoke tests.

## Production Risks To Control

- Data loss from state shape changes.
- Provider sync overwriting OpenRoad data.
- Public/private visibility leakage.
- UI complexity creeping into first-use screens.
- One-component app growth blocking reliable changes.
- Tests proving text exists but not proving user workflows.
- No server recovery route yet.

The next production foundation feature directly addresses roadmap correctness, durable request/work links, and public/private visibility before portal surfaces exist.
