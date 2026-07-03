# OpenRoad Product Charter

## Thesis

OpenRoad is the customer-facing feedback and roadmap layer for teams whose execution may live in OpenRoad itself, GitHub, Jira, Linear, or another delivery tool.

The product must not become a Jira clone first. It should own the trust loop:

1. Someone asks for something.
2. The team understands and triages the signal.
3. The team decides whether it belongs on the roadmap.
4. Delivery work is tracked.
5. The change ships.
6. The original requesters are notified.

## Standalone-First Rule

OpenRoad must work without integrations.

Users can:

- Create requests manually.
- Vote and comment.
- Triage requests.
- Create internal work items.
- Build a roadmap.
- Draft and publish changelog entries.
- Run a public portal.

Integrations are optional accelerators. They import, link, sync, and enrich OpenRoad data.

## Integration Boundary

Core domain:

- Request
- RoadmapItem
- WorkItem
- ChangelogEntry
- Customer
- Vote
- Comment
- Decision

Integration domain:

- Provider
- IntegrationInstallation
- ExternalObject
- ExternalLink
- ExternalSyncState
- SyncJob
- SyncConflict
- WebhookEvent

The core product can ask to create, update, link, or publish OpenRoad objects. Provider adapters translate those operations into GitHub, Jira, Linear, or other provider behavior when connected.

## Initial Navigation

Default navigation for new users:

- Inbox
- Roadmap
- Changelog
- Portal
- Settings

Progressive navigation:

- Work appears after internal work items exist or a delivery integration is connected.
- Prioritize appears after enough requests exist to justify scoring.
- Insights appears after enough activity exists to make analytics meaningful.
- Sync logs and audit trails stay inside Settings or inspector tabs.

## Product Red Lines

- Do not require GitHub, Jira, or Linear to get value.
- Do not ship a four-pane default UI for first-time users.
- Do not expose sync logs, audit trails, scoring formulas, or AI reasoning by default.
- Do not hide source-of-truth ambiguity when integrations are connected.
- Do not let provider-specific fields enter core tables except through external-link mapping.
- Do not make AI silently change source-of-truth data.

## Primary ICP

Start with developer-first SaaS teams, open-source maintainers, and product-led teams that need feedback, roadmap, and changelog workflows without buying a heavy enterprise suite.
