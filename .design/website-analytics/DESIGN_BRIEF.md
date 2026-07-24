# Design Brief: Website Analytics

Status: proposed
Date: 2026-07-23
Product and technical authority: `docs/website-analytics-plan.md`

## Experience goal

Give a small-business owner a calm, trustworthy answer to four questions:

1. How many real visitors and visits did the website receive?
2. How did those visitors find the website?
3. Which content helped them act?
4. Which customer actions did they take, and what should improve next?

Google Analytics is a measurement-completeness guidepost, not the desired interface.
Lodesta should retain its useful concepts while removing analyst jargon, advertising
complexity, arbitrary event configuration, and decorative dashboard density.

## Product model

There is one Analytics experience. “Low traffic” and “established” are not statuses or
manual modes. The selected date window determines how much evidence each metric has.
Counts remain available, early rates are labeled, and recommendations appear only after
their tested minimum samples are met.

Site lifecycle controls collection:

- a draft site gets a pre-publication explanation, not zero metrics;
- an active published site gets the report;
- a paused site gets historical results and a paused-collection notice.

## Information architecture

The Analytics workspace destination contains four URL-backed report views:

- Overview
- Traffic
- Content
- Customer actions

Every view shares:

- preset or custom date range;
- optional previous-period, previous-year, or custom comparison;
- auto/day/week/month interval;
- channel, page, action, and device filters; and
- CSV export.

The Overview reading order is:

1. page title, tracking health, date/comparison controls;
2. visitors, visits, leads, customer actions, and action rate;
3. visit/action trend;
4. leading traffic sources and action types;
5. pages creating action; and
6. no more than two evidence-backed recommendations.

## States

Design and verify:

- draft before first publish;
- active with no lifetime data;
- active with no data in the selected range;
- active with limited data;
- active with sufficient data;
- compared period;
- filtered report;
- paused collection;
- loading;
- report failure; and
- export failure.

Limited/sufficient are query presentation conditions, not persisted site states.

## Visual direction

Follow `docs/design/lodesta-product-design-language.md`:

- calm, dense, precise, evidence-forward, and action-oriented;
- warm-neutral product canvas and bounded panels;
- forest for active controls and positive product intent;
- amber only for evidence-backed intelligence or attention;
- semantic status colors;
- compact product typography; and
- no decorative dashboard chrome, gradients, or marketing composition.

Reuse the workspace shell, page header, metrics, status, panels, product tokens, and
mobile navigation. Add no charting or component library. The primary trend should use a
restrained accessible implementation with a tabular alternative.

## Responsive behavior

- Desktop: controls share the header; metrics form one scannable row; primary report
  sections use balanced columns where comparison is useful.
- Tablet: controls wrap without losing the global-query relationship; metric and report
  grids reorganize to two columns.
- Mobile: controls use touch-safe compact triggers; metrics use two columns where labels
  remain legible; report tables become stacked comparison rows; bottom navigation stays
  unobstructed.

No report may require horizontal page scrolling at 375px.

## Accessibility

- Date, comparison, filter, tab, and export controls are keyboard operable.
- Report navigation uses links and preserves the query.
- Every chart has a text summary and accessible table.
- Color is never the only carrier of comparison or status.
- Rates expose denominators in visible text.
- Touch targets are at least 44×44px on mobile.
- Empty and paused states use headings and explanatory copy, not disabled-looking
  dashboards.

## Success criteria

An owner can select, compare, filter, bookmark, and export an authorized reporting
window; distinguish visitors, visits, leads, and customer actions; identify important
sources and pages; and understand when Lodesta does or does not have enough evidence for
a recommendation.
