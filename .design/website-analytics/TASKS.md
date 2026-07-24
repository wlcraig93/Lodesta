# Build Tasks: Website Analytics

Generated from: `.design/website-analytics/DESIGN_BRIEF.md`
Product and technical plan: `docs/website-analytics-plan.md`
Date: 2026-07-23

## Foundation

- [ ] **Prove the clean-cut analytics baseline**: Run and retain the active-site, stored-event, retained-version, and runtime-series report; proceed with the canonical replacement only if the operator-safe cutover condition in the plan is satisfied. _Modifies: `supabase/migrations/202607230001_canonical_baseline.sql`, `scripts/verify-supabase.ts`; creates: focused stored-data verifier._
- [ ] **Ship trustworthy visits as the first vertical slice**: Replace the event schema, validate the serving site and published version, implement site-scoped visitor/visit identity and deduplication, exclude Lodesta/known-bot traffic, and render truthful draft plus active visit metrics. _Reuses: `WorkspacePageHeader`, `WorkspaceMetric`, product tokens; modifies: `app/api/analytics/route.ts`, `packages/trusted-runtime/site-runtime-v1.js`, `packages/site-capabilities/*`, `app/(owner-workspace)/workspace/[slug]/analytics/page.tsx`; creates: strict event/query contracts._

## Core UI

- [ ] **Add the global date and comparison experience**: Build preset/custom windows, previous-period/previous-year/custom comparison, interval control, site timezone, URL persistence, SQL aggregation, and the overview trend so the selected query governs every result. _Reuses: workspace panels and controls; modifies: Analytics page, Website settings, repository; creates: `AnalyticsReportControls`, `AnalyticsTrend`, report-query utilities. Depends on: trustworthy visits._
- [ ] **Add canonical customer actions**: Make managed forms record exactly one server-authoritative submission, add call/email/directions/booking/ordering events, and render Overview action totals plus the Customer actions view and funnels. _Reuses: managed form runtime and workspace panels; modifies: `app/api/forms/submit/route.ts`, trusted runtime, analytics repository/page; creates: customer-action report component. Depends on: trustworthy visits and date queries._
- [ ] **Add visit acquisition and the Traffic view**: Capture sanitized landing/referrer/UTM fields, normalize deterministic channels, and report sources, campaigns, landing pages, visitor type, devices, visits, actions, and rates. _Reuses: privacy sanitizers and report controls; modifies: trusted runtime and analytics repository; creates: channel classifier and Traffic report. Depends on: trustworthy visits and date queries._
- [ ] **Add content performance**: Emit one bounded engagement summary per page lifecycle and render pages, landing pages, engaged time, exits, and page-to-action contribution in the Content view. _Reuses: report controls and panels; modifies: trusted runtime and analytics query; creates: Content report. Depends on: trustworthy visits, date queries, and customer actions._

## Interactions & States

- [ ] **Apply filters and export consistently**: Add channel, page, action, and device filters that update the URL and every view, then export the identical authorized query as CSV. _Reuses: existing protected export patterns; modifies: analytics controls/repository; creates: `app/api/sites/[siteId]/analytics/export/route.ts`. Covers: empty, invalid-query, unauthorized, loading, and export-error states._
- [ ] **Gate evidence-backed recommendations by sample**: Centralize per-metric sufficiency thresholds, label early signals, suppress unsupported judgments, and show no more than two recommendations with denominators and direct next actions. _Reuses: `WorkspaceStatus`; modifies: analytics report contract and Overview; creates: tested sufficiency/recommendation utilities._
- [ ] **Expose collection health without polluting owner metrics**: Add day/site/reason counters for accepted, internal, bot, preview, duplicate, and invalid traffic; show detailed diagnostics to admins and only a concise tracking-health state to owners. _Reuses: admin-only disclosure pattern; modifies: ingestion and Analytics page; creates: collection-counter repository/query._

## Responsive & Polish

- [ ] **Complete responsive and accessible report behavior**: Verify desktop 1280px, tablet 768px, and mobile 375px layouts; make date/calendar, comparisons, filters, report navigation, charts, tables, and exports keyboard and screen-reader usable with 44px mobile targets. _Reuses: product tokens and mobile bottom navigation; modifies: `app/globals.css` and analytics components._
- [ ] **Validate retention and measured query performance**: Finalize privacy-reviewed browser/raw-event retention, enforce it, add bounded query telemetry, and document the measured threshold that would justify rollups without implementing them prematurely. _Modifies: privacy notice, maintenance verification, analytics repository; creates: retention verification._

## Review

- [ ] **Run boundary verification**: Prove active/inactive behavior, Lodesta-agent and known-bot exclusion, custom-domain and Lodesta-path binding, version binding, deduplication, one-form/one-action behavior, and filtered date/comparison accuracy. _Modifies: `scripts/verify-trusted-runtime.ts`, database and smoke verifiers; creates: analytics report/date-boundary verifier._
- [ ] **Run design review**: Review draft, active-empty, active-with-data, custom-date, compared, filtered, paused, error, desktop, tablet, and mobile states against `docs/design/lodesta-product-design-language.md`. _Reuses: the project design-review workflow and product design language; creates: responsive review captures and the feature `DESIGN_REVIEW.md`._
- [ ] **Perform the coordinated runtime rollout**: Deploy the verified clean-cut web/schema change, promote the audited content-hashed runtime patch, run synthetic live acceptance, prove internal traffic exclusion, and remove synthetic data through the explicit pre-launch operator procedure. _Reuses: runtime promotion and retained-site verification; modifies no compatibility paths._

## Later, only after core reporting is reliable

- [ ] **Evaluate Realtime owner value**: Research whether a 5/30-minute active-human snapshot helps owners verify campaigns or site changes, then build it only if the owner value is demonstrated. _Reuses: canonical events and report vocabulary; creates: bounded Realtime report and endpoint if approved._
