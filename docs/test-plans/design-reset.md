# Feature Test Plan: Design Reset

Branch: `feat/design-reset`

## Objective

Replace the first Signal Rail shell with a darker Workbench Plate and Map Room hybrid that feels product-specific, sharp, and less like a generic AI-generated SaaS dashboard.

## Design Requirements

- Keep the UI fully dark, not mixed light and dark.
- Merge Workbench Plate structure with Map Room topology.
- Reduce rounded-card language to near-square plates.
- Move the screen away from a generic left-sidebar dashboard composition.
- Use route, map, ledger, and instrument-panel cues as functional UI structure.
- Avoid decorative gradients, blobs, glassmorphism, hero-metric templates, and oversized rounded cards.
- Keep standalone-first behavior and optional integrations visible.
- Preserve the default navigation: Inbox, Roadmap, Changelog, Portal, Settings.

## Automated Checks

- Existing shell behavior tests must continue passing.
- Workspace creation must still work.
- Manual request capture must still work.
- Request row selection must still update the inspector.
- Roadmap and changelog previews must remain discoverable.
- Primary navigation hash targets must resolve to visible shell modules.
- Command deck controls must keep a visible keyboard focus treatment.

## Visual QA

- Desktop screenshot must show a clearly different visual system from the previous dark dashboard.
- Mobile screenshot must not overflow horizontally.
- App shell must stay fixed to the viewport with no document-level scrolling.
- Bottom status rail must remain fully visible on desktop and mobile.
- Long workspace content must scroll inside the operations deck.
- Primary navigation must keep text labels on mobile.
- Empty workspace state must remain understandable.
- The UI must keep text readable and avoid over-dense first-use presentation.

## Regression Checks

- OpenRoad still works without GitHub, Jira, or Linear.
- Integrations remain optional adapters.
- No provider-specific object becomes required for core flow.
- Add Request remains the main manual capture path.
- No AI assistant panel, sync log, audit trail, or scoring formula appears by default.

## Sign-Off Result

Passed on 2026-07-03.

- `pnpm check`: 9 tests passed; production build passed.
- Impeccable detector: no findings for `src/App.tsx` and `src/styles.css`.
- In-app browser QA: desktop selected-request state and mobile blank-workspace state had no horizontal overflow.
- PWA-style shell QA: `documentScroll` and `bodyScroll` were `0`; the bottom status rail stayed visible; `.operations-deck` owned the scrollable content.
- Focus QA: workspace selector showed the route-colored focus treatment on the command deck.
- Saved viewport QA screenshots as `design/qa/design-reset-desktop.png` and `design/qa/design-reset-mobile-blank.png`.
