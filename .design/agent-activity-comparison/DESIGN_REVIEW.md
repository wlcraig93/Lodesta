# Design Review: Agent Activity Compared With SheetPal Observability

Reviewed against:

- `docs/design/lodesta-product-design-language.md`
- `.design/modern-saas-refresh/DESIGN_BRIEF.md`
- SheetPal's current observability list, trace page, and observation components

Date: 2026-07-24

## Post-implementation verification

Status: approved. The comparative findings below were the implementation brief;
the current activity inventory and run inspector resolve the listed must-fix and
should-fix items.

Fresh connected-data viewport captures were taken after migration
`202607230017_site_agent_run_admin_inventory.sql` was applied:

| Screenshot | Breakpoint | Result |
| --- | --- | --- |
| `screenshots/qa-agent-activity-desktop-1280.png` | 1280×800 | Compact summary strip, one inventory surface, full filter toolbar, and scannable rows |
| `screenshots/qa-agent-activity-tablet-768.png` | 768×1024 | Controls reorganize without horizontal page overflow |
| `screenshots/qa-agent-activity-mobile-375.png` | 375×812 | Two-by-two metrics, stacked filters, readable inventory, and task-focused bottom navigation |

The implemented inventory now uses the recommended column order, truncates
diagnostic previews, exposes search/date/sort/page-size controls, and keeps full
run navigation on each row. The responsive run inspector uses a selectable
event rail and structured detail modes instead of the former accordion and
unstyled result list. Static product UI, typography, activity, TypeScript, build,
and smoke verification all pass. No remaining release-blocking design finding
was observed in the current implementation.

## Review setup

Lodesta was reviewed against its running development data. SheetPal's existing
development process could not serve the current checkout because its database
is behind the checkout's conversation schema. To avoid changing that database,
the SheetPal screenshots use the repository's real application shell,
observability pages, components, and CSS with representative mock telemetry.

The normal screenshot files show the fixed app-shell viewport, because that is
the visible operator experience. Additional `-fullpage` files retain the
full-page captures required by the review workflow; fixed-height app shells make
those captures less useful than the viewport images.

## Screenshots captured

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/lodesta-runs-desktop-1280.png` | 1280×800 | Lodesta activity list |
| `screenshots/lodesta-runs-tablet-768.png` | 768×1024 | Lodesta activity list |
| `screenshots/lodesta-runs-mobile-375.png` | 375×812 | Lodesta activity list |
| `screenshots/lodesta-run-detail-desktop-1280.png` | 1280×800 | Lodesta successful run detail |
| `screenshots/lodesta-run-detail-tablet-768.png` | 768×1024 | Lodesta successful run detail |
| `screenshots/lodesta-run-detail-mobile-375.png` | 375×812 | Lodesta successful run detail |
| `screenshots/sheetpal-runs-desktop-1280.png` | 1280×800 | SheetPal run list |
| `screenshots/sheetpal-runs-tablet-768.png` | 768×1024 | SheetPal run list |
| `screenshots/sheetpal-runs-mobile-375.png` | 375×812 | SheetPal run list |
| `screenshots/sheetpal-run-detail-desktop-1280.png` | 1280×800 | SheetPal observation inspector |
| `screenshots/sheetpal-run-detail-tablet-768.png` | 768×1024 | SheetPal observation inspector |
| `screenshots/sheetpal-run-detail-mobile-375.png` | 375×812 | SheetPal observation inspector |

Matching `-fullpage` captures are stored beside the responsive viewport files.

## Summary

The main gap is information architecture, not theme or component polish.
SheetPal treats a run as one inspectable work object: a compact summary strip,
a selectable observation rail, and one detail pane with Detail, Log, and
Outputs modes. Lodesta renders the same subject as a long diagnostic document:
six equal metric cards, an accordion event list, a large result definition
list, a second usage table, captures, and raw JSON.

Lodesta should borrow SheetPal's inspector model while keeping Lodesta's tokens,
plain React/CSS stack, better minimum type size, and stronger semantic HTML.
The existing `SiteAgentRunEvent` contract already contains the data needed for
the change; the first pass does not require a stored-schema change.

## What makes SheetPal feel better

| Concern | SheetPal | Lodesta now | Recommended Lodesta direction |
| --- | --- | --- | --- |
| Run summary | One compact, wrapping strip | Six equal-weight cards | One status/model/usage/duration strip with dividers |
| Event navigation | Selectable, dense observation rail | Long accordion timeline | Keyboard-accessible event buttons in a rail |
| Event inspection | One selected event with overview, input, output, metadata | JSON disclosure inside every event row | Dedicated selected-event detail pane |
| Alternate views | Detail, Log, Outputs tabs | Separate usage, captures, and raw JSON panels below | Detail, Log, Outputs, and Verification tabs |
| Page behavior | Bounded inspector workspace | Long scrolling dashboard document | Inspector height tied to the app viewport |
| Run list | Search, filters, date range, sort, pagination, full-row navigation | Status/site filter and 100-row dump | One inventory surface with a compact toolbar and pagination |
| Error treatment | Error count is scannable; detail is deferred | Full failure strings dominate table rows | One-line diagnostic preview; full error in run detail |

## Must fix

1. **The run detail breaks at mobile width.** In
   `screenshots/lodesta-run-detail-mobile-375.png`, the `Run events` and
   `Result` columns occupy the same narrow row, headings are clipped, and long
   identifiers overflow. `.admin-grid` keeps
   `minmax(320px, .8fr)` at every breakpoint, while `.metric-row` always keeps
   four columns. The page needs a run-specific responsive layout: two panes on
   desktop, a narrower rail plus detail at tablet, and an Events/Detail
   drill-in or segmented view on mobile.

2. **The Result definition list has no component styling.** `detail-list` is
   used but not defined in `app/globals.css`, leaving browser-default `dd`
   margins and no wrapping contract. This is why values appear centered and
   run into the edge in
   `screenshots/lodesta-run-detail-desktop-1280.png`. Replace it with an
   explicit metadata grid or fold it into the inspector's Run overview.

3. **Raw diagnostics overwhelm the run list.** Failure reasons and stack text
   are rendered directly in the Run cell. In
   `screenshots/lodesta-runs-desktop-1280.png`, one failure consumes most of
   the visible row while model, usage, and date become narrow fragments.
   Truncate the diagnostic to a single line, keep the error code visible, and
   expose the full reason only in the selected run.

## Should fix

1. **Replace the event accordion with an inspector.** Keep authorization,
   retained-payload integrity checks, and data loading in
   `app/admin/runs/[runId]/page.tsx`, then pass the run, events, payloads,
   captures, and links into a client-side `RunTelemetryInspector`. Use event
   sequence as the default order, preserve the selected event in
   `?event=<id>`, and render event rows as real buttons with visible focus and
   `aria-current` or `aria-selected`.

2. **Make event rows carry the scan-level telemetry.** Each row should show
   event kind, name, status, duration, and—when relevant—input/output tokens
   and cost. Model requests, tool calls, builds, and inspections should have
   distinct restrained type labels. Failures get the semantic error treatment;
   ordinary automation does not get amber.

3. **Give the selected event a structured detail view.** The first block should
   show kind, status, start time, duration, model/route, tokens, cost, and error
   code. Follow it with separate collapsible Input, Output, Summary, and
   Metadata sections, each with copy support and bounded code scrolling.

4. **Consolidate duplicate diagnostics.** The current event payload, metered
   usage table, result list, and raw run JSON repeat the same information in
   different forms. Keep:
   - `Detail` for the selected event;
   - `Log` for the complete run with Copy all;
   - `Outputs` for meaningful event outputs and failures;
   - `Verification` for contact sheets, candidate links, and final gate data;
   - `Run` or `Overview` for identifiers, revisions, guardrails, and recovery.

5. **Recompose the list as one inventory surface.** Put search in the heading
   row; use a compact toolbar for status, site, time range, and sort; put page
   size and pagination together; and make the full row open the run. The four
   summary metrics should become a compact divided strip or move to an
   Overview mode rather than preceding every search with dashboard cards.

6. **Use better list columns.** Recommended order:
   `Status`, `Run / site`, `Model`, `Tokens`, `Cost`, `Duration`, `Started`.
   Keep run and site IDs as secondary mono text. Separate token count and cost
   so expensive runs can be sorted and compared without parsing a stacked
   Usage cell.

## Could improve

1. Add quick filters for failed runs and tool errors, plus 24h, 7d, and 30d
   time presets.
2. Add newest/oldest, highest cost, and longest duration sorting.
3. Add copy actions for run IDs, event IDs, request IDs, and JSON blocks.
4. Keep the selected event rail and detail-tab state in the URL for shareable
   debugging links.
5. Add a small discrepancy or provenance treatment when billed/provider
   telemetry and catalog estimates differ; do not present an estimate as
   billed cost.

## Do not copy from SheetPal

- Do not introduce Radix, shadcn, Tailwind, a resizable-panel dependency, or a
  new component library. The composition can be implemented with Lodesta's
  existing tokens, plain CSS grid, and React.
- Do not copy SheetPal's 10px diagnostic text. Lodesta's 12px minimum is more
  legible and already documented.
- Do not copy clickable `<div>` observation rows. Use buttons or another
  keyboard-operable selection pattern.
- Do not squeeze the desktop two-pane inspector unchanged onto a phone.
  SheetPal's mobile capture becomes cramped. Lodesta should switch between the
  event list and selected-event detail.

## Suggested implementation order

1. Add the run-specific responsive layout and fix metadata wrapping.
2. Build the selectable event rail and selected-event detail pane.
3. Fold usage, raw JSON, results, and captures into inspector tabs.
4. Rework the activity list toolbar, row content, search, sort, and pagination.
5. Verify desktop, tablet, mobile, keyboard navigation, focus states, loading,
   empty, stale-schema, failed-run, and expired-payload states.
