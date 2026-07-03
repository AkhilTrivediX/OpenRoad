# OpenRoad Design Direction

## Experience Goal

OpenRoad should feel powerful after five minutes, not overwhelming at first sight.

The app should borrow the calm precision of developer tools, but the first-time experience must stay closer to a clear feedback workflow than a dense operations console.

## Complexity Layers

1. Default layer: Inbox, Roadmap, Changelog, Portal, Settings.
2. Selection layer: right inspector opens only after selecting an object.
3. Advanced layer: scoring, revenue weight, custom fields, linked work, duplicate history, audit trail.
4. Power layer: bulk edit, command palette, keyboard triage, sync conflicts, API logs, automation rules.

## Density Modes

- Calm: default for new users. Two-pane layout, fewer columns, plain labels.
- Standard: default after activation. Inbox plus inspector, key metadata visible.
- Dense: power mode with tables, shortcuts, bulk actions, more columns.
- Focus: hides secondary navigation and side panes while writing roadmap or changelog content.

## Visual Direction

- Sharp geometry: 0-6px radius, 1px dividers, no oversized rounded cards.
- Product surfaces over decoration: panes, tables, inspectors, drawers, tabs.
- Semantic color only: green for shipped, amber for stale or pending, red for blocked or error, blue/cobalt for selection and links.
- No gradients, blobs, glassmorphism, decorative card grids, or marketing dashboard tropes.
- Road/route motifs may appear structurally as lane dividers, route plates, stamps, and timeline marks. They should not become illustrations.

## Accessibility Baseline

- WCAG AA contrast.
- Visible focus states.
- Keyboard operation for the full Inbox to Roadmap to Changelog path.
- Status badges include text, not color alone.
- Empty states include one clear primary action.
- No icon-only navigation for primary workflows.

## Dashboard Concept Directions

Concept exploration should compare genuinely different app models:

1. Calm Desk: light, beginner-safe, two-pane default.
2. Signal Rail: dark, command/workbench style for power users.
3. Route Board: roadmap-lane first, visual planning without clutter.
4. Ledger Console: table-first, operational, fast for PM and support teams.
