# Design Review: Website Analytics

Reviewed against: `docs/design/lodesta-product-design-language.md`
Date: 2026-07-23

## Screenshots Captured

| Screenshot | Breakpoint | State |
| --- | --- | --- |
| `screenshots/analytics-review/review-analytics-draft-desktop-1280.jpg` | Desktop, 1280×800 | Draft site |
| `screenshots/analytics-review/review-analytics-draft-tablet-768.jpg` | Tablet, 768×1024 | Draft site |
| `screenshots/analytics-review/review-analytics-draft-mobile-375.jpg` | Mobile, 375×812 | Draft site |

## Summary

The page has a calm, compact, evidence-forward structure that matches Lodesta's product language and adapts cleanly at the three reviewed breakpoints. Its most important flaw is state truthfulness: a draft site displays a zero-filled live dashboard and says Lodesta is collecting traffic even though ingestion correctly rejects pre-publication events.

## Must Fix

1. **Represent lifecycle state truthfully.** `app/(owner-workspace)/workspace/[slug]/analytics/page.tsx` renders the same metrics and "collecting" copy for draft and active sites. Before first publish, replace the dashboard with a launch state explaining that analytics starts after publication and that previews, Lodesta traffic, and known bots are excluded. Do not show zero metrics as if they were measured results.
2. **Do not present unreliable outcomes as evidence.** The current runtime does not emit enough of the accepted event contract to populate acquisition, engagement, scroll, Web Vitals, section, click-map, or reliable conversion diagnostics. Form submissions are also recorded by both the form endpoint and the browser runtime. Owner-facing metrics should remain unavailable until the canonical events are trustworthy.

## Should Fix

1. **Use explicit periods.** Replace "Since launch" and the elapsed-time midpoint comparison with a visible period selector and calendar-aligned comparison such as last 30 days versus the preceding 30 days.
2. **Prioritize business outcomes.** Lead with visits, calls, forms, directions, and conversion rate. Keep implementation telemetry and website-standard correlations in admin-only diagnostics until minimum sample thresholds are met.
3. **Explain low-volume uncertainty.** Avoid percentages and performance judgments for tiny denominators. Show counts and "not enough data yet" until the configured sample threshold is reached.
4. **Preserve historical clarity for paused sites.** A paused site should show prior results with a "collection paused" banner and the last collected timestamp, not look like an active collector.

## Could Improve

1. Add concise metric definitions so owners can distinguish visitors, visits, page views, leads, and actions.
2. Turn evidence into one or two prioritized recommendations with the observed fact, confidence, and a direct next action.
3. Keep the Analytics tab discoverable before launch, but use an activation state rather than disabling navigation.

## What Works Well

- The desktop hierarchy is immediately scannable without becoming a decorative dashboard.
- Metric cards, acquisition/content panels, and the admin-only disclosure use existing Lodesta product patterns consistently.
- Tablet and mobile layouts reorganize cleanly, with a useful persistent mobile navigation treatment.
- The restrained forest, neutral, and amber roles match the documented semantic color system.
