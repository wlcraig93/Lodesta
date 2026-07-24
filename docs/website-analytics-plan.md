# Website Analytics

Status: implemented in source; database migration and trusted-runtime promotion remain rollout actions
Date: 2026-07-23

## Decision

Lodesta will provide one first-party website analytics experience for every published
site. The product will not assign or persist “low traffic” or “established” analytics
statuses. Data sufficiency is evaluated per metric for the currently selected reporting
window, and the same interface becomes more informative as the selected data supports
stronger conclusions.

The product will use Google Analytics as a completeness guide for measurement concepts,
date ranges, comparisons, acquisition, content, key actions, and funnels. It will not
copy Google Analytics’ information density, advertising orientation, arbitrary event
configuration, or analyst-oriented exploration surface.

The owner-facing product should answer four questions:

1. How many real visitors and visits did the website receive?
2. How did those visitors find the website?
3. Which pages and paths helped them act?
4. Which customer actions did they take, and what should the owner improve next?

## Current baseline

Lodesta already has:

- an `analytics_events` table;
- a public `/api/analytics` ingestion route;
- an analytics-capable trusted runtime injected into finalized site HTML;
- active/published-site gating at ingestion and public serving;
- preview isolation;
- repository summarization; and
- an owner Analytics page.

The current implementation is not an acceptable reporting authority:

- Lodesta-operated browser agents are not excluded.
- A browser tab ID is reported as a session, but no persistent pseudonymous visitor is
  emitted.
- The reporting code expects acquisition, engagement, section, click-map, and Web Vital
  signals that the runtime does not generally emit.
- Successful form submissions are recorded by the form endpoint and again by the browser.
- Client-provided site IDs, timestamps, and session IDs are accepted without binding the
  event to the serving hostname and current published version.
- Owner reporting loads all raw site events and aggregates them in application memory.
- A draft site shows zero-valued metrics and falsely says Lodesta is collecting.

At the time this plan was written, the configured environment contained zero analytics
events and zero active published sites. Implementation must run the stored-data report
again immediately before changing the schema or contract.

## Product contract

### Lifecycle

The site lifecycle controls collection:

- **Draft, before first publish:** no collection and no numeric dashboard. The Analytics
  route remains discoverable and explains what will be measured after publication.
- **Active with a published version:** collection runs when analytics is enabled in the
  published build input.
- **Paused:** new collection stops. Previously collected results remain visible with a
  “Collection paused” notice and the last accepted event time.

These are derived presentations of the canonical site lifecycle. Analytics does not add
a second site-status machine.

### Data sufficiency

Data sufficiency is computed for each report query and is never stored as a site status.

- Counts are shown whenever the selected window contains counted human activity.
- Empty windows show “No activity in this date range,” not a zero-valued performance
  judgment.
- Rates always expose their denominator.
- Comparisons may display raw changes with small samples, but must label them as early
  signals.
- Recommendations and performance judgments require explicit minimum samples.

Initial presentation thresholds:

- fewer than 20 visits: counts only, with rates labeled “Early signal”;
- 20 or more visits: rates and period comparisons may display;
- recommendations about a page, source, or action require at least 50 relevant visits
  and at least 5 relevant customer actions;
- thresholds are centralized, tested constants and may be tuned from observed behavior.

### Measurement vocabulary

| Lodesta term | Definition |
| --- | --- |
| Visitor | A pseudonymous browser identifier scoped to one Lodesta site. It is not a verified person. |
| Visit | A sequence of activity from one visitor, ending after 30 minutes of inactivity. |
| Page view | A counted human view of one public page. |
| Customer action | A configured high-intent action such as a call, submitted form, directions request, booking click, or ordering click. |
| Lead | An inquiry retained by Lodesta, currently created by a valid managed-form submission. Clicks are actions, not leads. |
| Action rate | Visits containing at least one customer action divided by counted visits. |
| Landing page | The first public page viewed during a visit. |
| Channel | Lodesta’s normalized classification of the visit source, such as organic search, direct, social, referral, or campaign. |

## Reporting experience

### Global controls

Every owner report uses one URL-backed query model. Changing the global window or filter
updates every metric, chart, table, comparison, and export in the selected view.

Date presets:

- Today
- Yesterday
- Last 7 days
- Last 30 days, the default
- Last 90 days
- Month to date
- Year to date
- Since launch
- Custom start and end dates

Comparison choices:

- Off
- Previous period of equal length, the default when comparison is enabled
- Previous year
- Custom comparison window

Chart granularity:

- Auto
- Day
- Week
- Month

Auto chooses a legible interval from the selected window. Reporting uses a site-level
IANA timezone, initialized during onboarding from the owner’s browser timezone and
editable in Website settings. Date boundaries are inclusive at the local start and
exclusive at the following local day boundary.

Filters:

- channel/source;
- landing page or page;
- customer-action type; and
- device category.

Filters and view selection are represented in search parameters so a report can be
bookmarked, shared with another authorized owner, refreshed, or exported without losing
context. The initial contract is:

```text
/workspace/:slug/analytics
  ?view=overview|traffic|content|actions
  &range=30d|7d|90d|mtd|ytd|since_launch|custom
  &from=YYYY-MM-DD
  &to=YYYY-MM-DD
  &compare=off|previous_period|previous_year|custom
  &compareFrom=YYYY-MM-DD
  &compareTo=YYYY-MM-DD
  &interval=auto|day|week|month
  &channel=...
  &source=...
  &page=...
  &action=...
  &device=...
```

Invalid or unauthorized query values fall back safely and never broaden site access.

### Information architecture

Analytics remains one workspace destination with four report views:

1. **Overview**
   - tracking-health indicator;
   - visitors, visits, leads, customer actions, and action rate;
   - visit and customer-action trend;
   - leading channels;
   - customer actions by type;
   - pages creating action; and
   - at most two evidence-backed recommendations.
2. **Traffic**
   - channel, source, medium, campaign, and referrer;
   - new versus returning pseudonymous visitors;
   - landing-page performance;
   - device breakdown; and
   - visit and action counts/rates for each row.
3. **Content**
   - page views, visitors, visits, engaged time, and exits;
   - landing pages;
   - page-to-action contribution; and
   - a page detail view preserving the global date and comparison query.
4. **Customer actions**
   - calls, managed-form starts/submissions, directions, booking, ordering, and email;
   - visit-to-action and form-start-to-submit funnels;
   - median time to first customer action; and
   - landing page, source, page, and device breakdowns.

Realtime is a later enhancement, not a launch dependency. When added, it will show
counted human visitors active in the last 5 and 30 minutes, current pages, sources, and
customer actions. It will not replace finalized reporting.

### Empty, collecting, and paused presentations

Before first publish:

> Analytics starts when this website goes live.
>
> Lodesta will measure real visits and customer actions. Drafts, previews, Lodesta
> agents, and known bots will not count.

The primary action links to the editor or publication readiness, depending on the
canonical candidate state.

For an active site with no activity in the selected window:

> No counted visits in this date range.
>
> Tracking is active. Try a wider date range or check collection health.

For a paused site:

> Collection is paused.
>
> These results include activity through {lastAcceptedAt}.

## Canonical measurement contract

### Event taxonomy

The clean-cut event vocabulary is:

| Event | Authority | Owner-facing use |
| --- | --- | --- |
| `page_view` | Browser runtime, accepted once per navigation | Visitors, visits, pages, landing pages |
| `engagement` | Browser runtime, one bounded summary per page lifecycle | Engaged time and maximum scroll depth |
| `form_start` | Browser runtime, once on first meaningful interaction | Form funnel |
| `form_submit` | Server form endpoint only | Lead and customer action |
| `call_click` | Browser runtime | Customer action |
| `email_click` | Browser runtime | Customer action |
| `directions_click` | Browser runtime | Customer action |
| `booking_click` | Browser runtime | Customer action |
| `ordering_click` | Browser runtime | Customer action |
| `outbound_click` | Browser runtime for allowlisted diagnostic links | Content diagnostics; not a customer action by default |
| `web_vital` | Browser runtime, bounded to supported metrics | Admin collection/performance diagnostics |

The obsolete names and unused broad events are removed in the same change. There is no
dual vocabulary, aliasing, or compatibility reader.

Section-view telemetry, arbitrary click maps, heatmaps, and session replay are excluded
from version one. They add volume and privacy risk without answering the owner’s primary
questions.

### Browser identity

The trusted runtime maintains:

- a cryptographically random visitor identifier in first-party browser storage, scoped
  by site ID;
- a visit identifier plus last-activity time;
- a new visit after 30 minutes of inactivity; and
- first-seen information required to classify a visitor as new or returning.

The public identifier is HMAC-normalized by the server before persistence so the same
browser cannot be correlated across different Lodesta sites. Lodesta does not use
fingerprinting and does not store raw IP addresses in analytics events.

Browser-storage duration and raw-event retention require privacy review before launch.
The proposed reporting target is at least 14 months so previous-year comparisons can
work. Aggregate site/date metrics may be retained while the site remains owned. The
final durations must be documented in the public privacy notice and enforced by an
operator-verifiable retention job.

### Visit acquisition

The first accepted `page_view` in a visit records:

- landing path;
- sanitized referrer host;
- `utm_source`, `utm_medium`, and `utm_campaign`;
- device category; and
- normalized channel.

Initial channel rules are deterministic and documented:

- campaign, based on supported UTM parameters;
- organic search, based on an allowlisted search-referrer map;
- social, based on an allowlisted social-referrer map;
- referral, for other valid external referrers; and
- direct/unknown when no usable attribution exists.

Version one uses visit-level last-non-direct attribution. It does not implement
multi-touch attribution models, advertising cost import, or cross-device identity.

### Traffic classification and exclusion

Every ingestion request receives one server-derived traffic class:

- `human`;
- `lodesta_internal`;
- `known_bot`; or
- `invalid`.

Only `human` events appear in owner metrics.

Lodesta internal exclusion uses defense in depth:

1. every Lodesta crawler, website assessment, render inspection, retained-site
   verification, and other public-site browser context uses the canonical
   `LodestaGenerationCrawler` user agent or a successor documented product token;
2. internal browser contexts attach a signed Lodesta internal-traffic header to
   same-origin requests;
3. internal Playwright request guards abort the analytics endpoint where analytics is
   irrelevant to the task;
4. the trusted runtime avoids emission when it detects the canonical Lodesta product
   token; and
5. ingestion excludes a request when any trusted server-side internal signal applies.

Known search, AI, training, and preview bot user agents are classified through one
canonical mapping. Their requests may feed separate admin-only operational counters,
but they never count as visitors.

Authenticated owner/operator visits to a Lodesta-hosted `/sites/*` URL are excluded
server-side. A later “Exclude this browser” control may cover human review on custom
domains. It must use a signed, site-scoped suppression token and may not silently create
a permanent cross-site identifier.

Agent-readable HTTP requests are not browser visitors. If Lodesta later reports them,
they will appear in a separate “Bots and agents” report backed by server request
telemetry, never mixed into human visitor statistics.

## Ingestion integrity

`POST /api/analytics` remains the public same-origin endpoint. It becomes ingestion-only;
the current default-site GET behavior is removed.

The server:

1. enforces a small body-size limit and a strict event-specific schema;
2. rate-limits by site hint and abuse key;
3. resolves the public site from the custom hostname or the Lodesta `/sites/:slug`
   referrer path;
4. requires that the site is active, has a published version, and that the published
   build input enables analytics;
5. binds the event to the server-resolved current published version;
6. classifies and excludes internal, known-bot, preview, and invalid traffic;
7. replaces the client timestamp with server receipt time, retaining only bounded
   client elapsed time for event ordering;
8. HMAC-normalizes the visitor identifier per site;
9. deduplicates on the site-scoped client event ID; and
10. inserts the accepted event without returning the retained event document.

Platform-host events without a valid same-site Lodesta referrer are rejected. Custom
domain events require that the request hostname resolves to the same active site. Origin,
hostname, path, site ID, and published-version disagreements fail closed.

The form endpoint is the sole authority for `form_submit`. The browser sends visitor,
visit, attribution, and form-start context with the managed form request, and the server
creates one inquiry and one deduplicated analytics event in the same logical operation.
The browser never posts a second form-submit event.

## Storage and reporting architecture

### Raw events

Because there are no production customers, replace the current analytics table shape
after proving the stored-data report is empty. The canonical table carries:

- `schema_version`;
- server-generated row ID;
- site ID;
- published site-version ID;
- site-scoped event ID with a unique constraint;
- event type;
- HMAC-normalized visitor key;
- visit ID;
- page path and landing path;
- channel and sanitized acquisition fields;
- device category;
- bounded event properties;
- server occurrence time; and
- created time.

Traffic excluded before owner reporting is not retained as a raw analytics event.
Admin collection-health counters retain only day/site/reason counts, not visitor
identifiers or request payloads.

### Reporting queries

Owner reports aggregate inside Postgres over the authorized site and bounded date range.
The application must not load every raw event and summarize it in memory.

The repository exposes one typed query:

```ts
analyticsReport(siteId, {
  view,
  range,
  comparison,
  interval,
  filters,
  timezone
})
```

It returns:

- resolved query bounds;
- current and comparison totals;
- time series;
- requested breakdown rows;
- denominators and sufficiency annotations;
- collection health; and
- at most two eligible recommendations.

Use indexed SQL aggregation first. Do not add a rollup worker, materialized view, or
aggregation pipeline until measured query volume or latency requires one. If rollups
become necessary, they must remain reproducible from retained raw events and use the
same report contract.

### Owner APIs

The server-rendered workspace may call the repository directly. Protected APIs are
limited to interactions that need them:

- `GET /api/sites/:siteId/analytics/export` exports the current authorized query as CSV;
- a future Realtime endpoint may return the bounded 5/30-minute snapshot.

There is no public raw-event query API.

## UI implementation

Reuse:

- `ProductAppShell`;
- `WorkspacePageHeader`;
- `WorkspaceMetric`;
- `WorkspaceStatus`;
- `.workspace-panel` and existing product tokens; and
- the existing mobile bottom navigation.

Modify:

- the Analytics route to parse and preserve the global query;
- `WorkspaceMetric` only if a reusable comparison/denominator presentation is needed;
- product CSS for report controls, tabs, charts, tables, and lifecycle messages; and
- Website settings to expose the reporting timezone.

Create:

- `AnalyticsReportControls`, a client component responsible only for URL-backed date,
  comparison, interval, and filter controls;
- `AnalyticsReportNav`, implemented as links preserving the global query;
- `AnalyticsTrend`, a restrained accessible SVG/chart with a tabular fallback;
- focused overview, traffic, content, and customer-action result components; and
- typed report-query parsing and formatting utilities.

No charting library, component library, Tailwind, or new styling framework is introduced.

## Implementation sequence

### Slice 1: trustworthy visits

Clean-cut the empty analytics schema and contract, implement site/version resolution,
visitor/visit identity, internal/bot exclusion, and one deduplicated `page_view` path.
Replace the draft dashboard with the truthful pre-publish state and show real visitor,
visit, and page-view counts for an active synthetic site.

This slice proves the hardest boundary before adding more metrics.

### Slice 2: date windows and comparisons

Implement the global URL-backed date control, site timezone, bounded Postgres report
query, current/comparison totals, interval selection, and visit/action trend. Verify
custom, previous-period, and previous-year boundaries across daylight-saving changes.

### Slice 3: customer actions

Make form submission server-authoritative and add calls, email, directions, booking, and
ordering events. Render the Overview action summary and Customer actions view, including
visit-to-action and form-start-to-submit funnels.

### Slice 4: traffic acquisition

Capture and sanitize visit acquisition, normalize channels, and render the Traffic view
with channel, source, campaign, landing-page, visitor-type, and device breakdowns.

### Slice 5: content performance

Add one bounded engagement summary per page lifecycle and render the Content view with
pages, landing pages, engagement, exits, and page-to-action contribution.

### Slice 6: filtering, export, and recommendations

Apply channel, page, action, and device filters across all views; add a CSV export that
uses the identical authorized query; and enable at most two recommendations only when
their explicit sample thresholds are satisfied.

### Slice 7: collection diagnostics and retention

Expose admin-only accepted/excluded/invalid counters, validate the configured retention
policy, and add query-latency/volume monitoring. Add rollups only if the measured
threshold documented in this slice is exceeded.

### Slice 8: optional Realtime

After finalized reports are reliable, add the 5/30-minute human-activity snapshot if
owner research shows that immediate campaign/change verification is valuable.

## Verification

### Contract and security

- An active published site with analytics enabled accepts one valid human event.
- Draft, paused, unpublished, analytics-disabled, preview, and artifact-preview traffic
  never creates counted events.
- Lodesta assessment, crawler, render-inspection, and verification browsers never count.
- Known bots never count as visitors.
- A platform-host event cannot claim a different site ID or slug.
- A custom-domain event cannot claim a site not bound to that hostname.
- The server, not the client, binds the published version and occurrence time.
- Duplicate event IDs produce one retained event.
- Analytics metadata is event-specific, bounded, and free of form/contact payloads.

### Metrics

- One browser can produce multiple visits after the inactivity boundary while remaining
  one pseudonymous visitor.
- New/returning classification is stable within the retention window.
- One accepted form creates one inquiry and one `form_submit` action.
- Action rate counts visits with an action, not the number of action events.
- Landing-page and channel attribution remain fixed for a visit.
- Current and comparison windows use the selected site timezone and equal durations when
  “previous period” is selected.
- Filters affect totals, trends, breakdowns, recommendations, and exports identically.

### Product UI

- Draft, active-empty, active-with-data, no-data-in-range, paused, loading, and report
  error states are visually distinct and truthful.
- No “low traffic” or “established” site status or manual mode exists.
- Desktop, tablet, and mobile views preserve hierarchy without horizontal overflow.
- Date selection, comparison, filters, tabs, and export are keyboard accessible.
- Charts have text summaries and accessible tabular alternatives.
- Small samples never produce an unqualified performance judgment.
- Admin diagnostics never expose raw visitor identifiers to owners.

### Standing commands

At minimum:

```bash
npm run typecheck
npm run verify:database
npm run verify:trusted-runtime
npm run verify:account-setup-domain
npm run verify:render-browser
npm run smoke:dev
```

Add focused analytics contract, report-query, timezone/date-boundary, and internal-agent
exclusion verification to the standing suites.

## Rollout

This changes a boundary-sensitive public runtime and ingestion contract.

1. Run and retain a report of active published sites, analytics rows, runtime series,
   and retained versions.
2. If active published sites or analytics rows exist, stop and obtain an explicit
   operator cutover decision. Do not add a compatibility reader.
3. Apply the canonical analytics schema to an empty rehearsed environment.
4. Verify public Lodesta URLs, custom domains, previews, paused sites, and all internal
   browser contexts.
5. Run the full verification suite.
6. Deploy web and worker code together.
7. Promote the audited content-hashed trusted runtime patch.
8. Run live boundary verification with one synthetic active site and prove exactly one
   event for each canonical action.
9. Prove internal-agent and known-bot requests are excluded.
10. Remove the synthetic events/site through the explicit pre-launch operator procedure
    before owner access is reopened.

## Non-goals

- A persisted analytics maturity status.
- A manual low-traffic/established toggle.
- Google Ads, Meta Ads, Search Console, call-tracking, or third-party analytics
  integrations.
- Multi-touch attribution or attribution-model selection.
- Arbitrary custom-event builders.
- Cross-device or cross-site visitor identity.
- Fingerprinting.
- Heatmaps, session replay, raw visitor timelines, or owner-visible user snapshots.
- Ecommerce revenue reporting until ordering becomes a managed Lodesta capability.
- A general-purpose GA-style exploration builder.
- A rollup pipeline before indexed SQL reporting proves insufficient.

## Guideposts

- [Google Analytics: change and compare date ranges](https://support.google.com/analytics/answer/13412290?hl=en)
- [Google Analytics: overview reports](https://support.google.com/analytics/answer/13818312?hl=en)
- [Google Analytics: key events](https://support.google.com/analytics/answer/9267568?hl=en)
- [Google Analytics: funnel exploration](https://support.google.com/analytics/answer/9327974?hl=en)
- [Google Analytics: Realtime](https://support.google.com/analytics/answer/9271392?hl=en)

## Definition of done

Website analytics is complete for launch when an owner can select any authorized date
window, compare it, filter it, export it, and understand visitors, visits, acquisition,
content, leads, and customer actions from counted human traffic only; when Lodesta
agents, known bots, previews, inactive sites, duplicates, and cross-site spoofing cannot
pollute those results; and when every displayed insight is honest about its denominator
and evidence.
