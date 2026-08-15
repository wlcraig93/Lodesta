import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildAnalyticsReport,
  classifyAnalyticsChannel,
  classifyAnalyticsTraffic,
  localDateBoundary,
  normalizeAnalyticsVisitor
} from "../lib/analytics";
import { parseAnalyticsQuery } from "../lib/analytics-query";
import type { AnalyticsEvent, AnalyticsReportQuery } from "../packages/site-capabilities/contracts";

assert.equal(classifyAnalyticsTraffic("LodestaWebsiteCrawler/1.0"), "lodesta_internal");
assert.equal(classifyAnalyticsTraffic("Googlebot/2.1"), "known_bot");
assert.equal(classifyAnalyticsTraffic("Mozilla/5.0 Safari/605.1.15"), "human");
assert.equal(classifyAnalyticsChannel({ referrerHost: "google.com" }), "organic_search");
assert.equal(classifyAnalyticsChannel({ referrerHost: "instagram.com" }), "social");
assert.equal(classifyAnalyticsChannel({ referrerHost: "example.com" }), "referral");
assert.equal(classifyAnalyticsChannel({ utmSource: "newsletter" }), "campaign");
assert.equal(classifyAnalyticsChannel({}), "direct");
assert.notEqual(normalizeAnalyticsVisitor("site_a", "browser_1"), normalizeAnalyticsVisitor("site_b", "browser_1"), "Visitor keys correlate across sites.");

const springDay = localDateBoundary("2026-03-09", "America/Chicago") - localDateBoundary("2026-03-08", "America/Chicago");
const fallDay = localDateBoundary("2026-11-02", "America/Chicago") - localDateBoundary("2026-11-01", "America/Chicago");
assert.equal(springDay, 23 * 60 * 60 * 1000, "Spring DST boundary is not 23 hours.");
assert.equal(fallDay, 25 * 60 * 60 * 1000, "Fall DST boundary is not 25 hours.");

const parsed = parseAnalyticsQuery({
  view: "traffic",
  range: "custom",
  from: "2026-07-01",
  to: "2026-07-10",
  compare: "previous_period",
  interval: "auto",
  channel: "organic_search",
  device: "mobile"
}, {
  timezone: "America/Chicago",
  siteCreatedAt: "2026-01-01T00:00:00.000Z",
  now: new Date("2026-07-23T12:00:00.000Z")
});
assert.equal(parsed.view, "traffic");
assert.equal(parsed.compareFrom, "2026-06-21");
assert.equal(parsed.compareTo, "2026-06-30");
assert.equal(parsed.interval, "day");
assert.deepEqual(parsed.filters, { channel: "organic_search", source: undefined, page: undefined, action: undefined, device: "mobile" });

const query: AnalyticsReportQuery = {
  view: "overview",
  from: "2026-07-01",
  to: "2026-07-31",
  interval: "day",
  timezone: "UTC",
  filters: {}
};
const events = [
  event("page_1", "visitor_1", "visit_1", "page_view", "2026-07-02T10:00:00.000Z"),
  event("call_1", "visitor_1", "visit_1", "call_click", "2026-07-02T10:02:00.000Z"),
  event("call_2", "visitor_1", "visit_1", "call_click", "2026-07-02T10:03:00.000Z"),
  event("page_2", "visitor_1", "visit_2", "page_view", "2026-07-03T10:00:00.000Z"),
  event("page_3", "visitor_2", "visit_3", "page_view", "2026-07-03T11:00:00.000Z", "organic_search")
];
const report = buildAnalyticsReport("site_test", query, events);
assert.equal(report.current.visitors, 2);
assert.equal(report.current.visits, 3);
assert.equal(report.current.customerActions, 2);
assert.equal(report.current.actionVisits, 1);
assert.equal(report.current.actionRate, 1 / 3, "Action rate counted actions instead of visits with action.");
assert.equal(report.sufficiency, "early");
assert.equal(report.recommendations.length, 0);

const runtime = await readFile("packages/trusted-runtime/site-runtime-v1.js", "utf8");
for (const retired of ["pageview", "tel_click", "section_view", "scroll_depth", 'track("form_submit"']) {
  assert(!runtime.includes(retired), `Trusted runtime retains obsolete analytics behavior: ${retired}`);
}
assert(runtime.includes("30 * 60 * 1000"), "Runtime does not enforce the 30-minute visit boundary.");
assert(runtime.includes("395 * 24 * 60 * 60 * 1000"), "Runtime does not enforce the 13-month visitor-storage duration.");

const migration = await readFile("supabase/migrations/202607230011_canonical_website_analytics.sql", "utf8");
assert(migration.includes("now() - interval '14 months'"), "Raw-event retention is not fixed at 14 months.");
assert(migration.includes("on conflict (site_id, event_id)"), "Site-scoped event deduplication is missing.");

console.log(JSON.stringify({
  ok: true,
  trafficExclusion: "pass",
  visitorScoping: "pass",
  timezoneBoundaries: "pass",
  reporting: "pass",
  retention: "pass"
}));

function event(
  eventId: string,
  visitorKey: string,
  visitId: string,
  eventType: AnalyticsEvent["eventType"],
  occurredAt: string,
  channel: AnalyticsEvent["channel"] = "direct"
): AnalyticsEvent {
  return {
    schemaVersion: 1,
    eventId,
    siteId: "site_test",
    siteVersionId: "version_test",
    eventType,
    visitorKey,
    visitId,
    pagePath: "/",
    landingPath: "/",
    channel,
    deviceCategory: "mobile",
    properties: {},
    occurredAt,
    createdAt: occurredAt
  };
}
