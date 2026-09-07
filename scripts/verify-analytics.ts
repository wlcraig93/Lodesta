import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildAnalyticsReport,
  classifyAnalyticsChannel,
  classifyAnalyticsTraffic,
  localDateBoundary,
  normalizeCampaignValue,
  normalizeAnalyticsPath
} from "../lib/analytics";
import { analyticsClientContextFromForm, parseAnalyticsClientEvent } from "../lib/analytics-ingestion";
import { parseAnalyticsQuery } from "../lib/analytics-query";
import type { AnalyticsEvent, AnalyticsReportQuery, AnalyticsTrendPoint } from "../packages/site-capabilities/contracts";

const trendBundle = await build({ stdin: { contents: `export {AnalyticsTrend} from ${JSON.stringify(resolve("components/AnalyticsTrend.tsx"))}`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"] });
const trendModule = { exports: {} as { AnalyticsTrend: ComponentType<{ points: AnalyticsTrendPoint[] }> } };
new Function("require", "module", "exports", trendBundle.outputFiles[0].text)(createRequire(import.meta.url), trendModule, trendModule.exports);
const onePoint = [{ bucket: "2026-09-07", pageViews: 1, customerActions: 1 }];
const trendHtml = renderToStaticMarkup(createElement(trendModule.exports.AnalyticsTrend, { points: onePoint }));
assert.equal((trendHtml.match(/<circle /g) ?? []).length, 2, "A single reporting interval must display both series, not an invisible move-only path.");
assert(trendHtml.includes('r="6"') && trendHtml.includes('r="3"'), "Equal single-point values must remain distinguishable.");
assert(renderToStaticMarkup(createElement(trendModule.exports.AnalyticsTrend, { points: [] })).includes("No activity in this date range"));
const multiplePoints = renderToStaticMarkup(createElement(trendModule.exports.AnalyticsTrend, { points: [...onePoint, { bucket: "2026-09-08", pageViews: 2, customerActions: 0 }] }));
assert(multiplePoints.includes("L ") && !multiplePoints.includes("<circle "), "Multi-interval line rendering changed unexpectedly.");

assert.equal(classifyAnalyticsTraffic("LodestaWebsiteCrawler/1.0"), "lodesta_internal");
assert.equal(classifyAnalyticsTraffic("Googlebot/2.1"), "known_bot");
assert.equal(classifyAnalyticsTraffic("Mozilla/5.0 Safari/605.1.15"), "human");
assert.equal(classifyAnalyticsChannel({ referrerHost: "google.com" }), "organic_search");
assert.equal(classifyAnalyticsChannel({ referrerHost: "instagram.com" }), "social");
assert.equal(classifyAnalyticsChannel({ referrerHost: "example.com" }), "referral");
assert.equal(classifyAnalyticsChannel({ utmSource: "newsletter" }), "campaign");
assert.equal(classifyAnalyticsChannel({}), "direct");
assert.equal(normalizeCampaignValue("visitor@example.com"), undefined);
assert.equal(normalizeAnalyticsPath("/contact?email=visitor@example.com#private"), "/contact");
const client = { siteId: "site_test", versionId: "version_test", eventId: "event_test_123", pageViewId: "page_load_123",
  eventType: "page_view", pagePath: "/", deviceCategory: "mobile" };
const parseClient = (body: unknown) => parseAnalyticsClientEvent(new Request("https://example.test/api/analytics", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
}));
assert((await parseClient(client)).ok);
assert(!(await parseClient({ ...client, visitorId: "visitor_123", visitId: "visit_123" })).ok,
  "Analytics ingestion accepted obsolete persistent identity fields.");
assert(!(await parseClient({ ...client, pageViewId: undefined })).ok);
assert.equal(analyticsClientContextFromForm({ siteId: "site_test", pagePath: "/" }), undefined,
  "A form without analytics context should omit analytics, not invent an identity.");

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
  event("page_1", "load_1", "page_view", "2026-07-02T10:00:00.000Z"),
  event("call_1", "load_1", "call_click", "2026-07-02T10:02:00.000Z"),
  event("call_2", "load_1", "call_click", "2026-07-02T10:03:00.000Z"),
  event("page_2", "load_2", "page_view", "2026-07-03T10:00:00.000Z"),
  event("page_3", "load_3", "page_view", "2026-07-03T11:00:00.000Z", "organic_search")
];
const report = buildAnalyticsReport("site_test", query, events);
assert.equal(report.current.pageViews, 3);
assert.equal(report.current.customerActions, 2);
assert.equal(report.current.actionPageViews, 1);
assert.equal(report.current.actionRate, 1 / 3, "Action rate counted actions instead of page views with action.");
const missingBeacon = buildAnalyticsReport("site_test", query, [...events,
  event("orphan_call", "load_missing", "call_click", "2026-07-03T12:00:00.000Z")]);
assert.equal(missingBeacon.current.customerActions, 3);
assert.equal(missingBeacon.current.actionRate, 1 / 3, "An orphan action inflated the page action rate.");
const actionFilter = buildAnalyticsReport("site_test", { ...query, filters: { action: "call_click" } }, events);
assert.equal(actionFilter.current.pageViews, 1);
assert.equal(actionFilter.current.actionRate, 1);
const outsideWindow = buildAnalyticsReport("site_test", { ...query, filters: { action: "call_click" } }, [
  event("outside", "load_2", "call_click", "2026-08-01T00:00:00.000Z"), events[3]
]);
assert.equal(outsideWindow.current.pageViews, 0, "An out-of-window action leaked into the filter.");
for (const key of ["visitors", "visits", "visitorTypes", "landingPages"]) {
  assert(!(key in report) && !(key in report.current));
}
assert.equal(report.sufficiency, "early");
assert.equal(report.recommendations.length, 0);

const runtime = await readFile("packages/trusted-runtime/site-runtime-v4.js", "utf8");
for (const retired of ["pageview", "tel_click", "section_view", "scroll_depth", 'track("form_submit"']) {
  assert(!runtime.includes(retired), `Trusted runtime retains obsolete analytics behavior: ${retired}`);
}
for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "visitorId", "visitId", "lastNonDirect", "returning"]) {
  assert(!runtime.includes(forbidden), `Runtime retains browser tracking: ${forbidden}`);
}
assert(runtime.includes("pageViewId: page.id"));

const migration = await readFile("supabase/migrations/202607230011_canonical_website_analytics.sql", "utf8");
assert(migration.includes("now() - interval '14 months'"), "Raw-event retention is not fixed at 14 months.");
assert(migration.includes("on conflict (site_id, event_id)"), "Site-scoped event deduplication is missing.");
const privacyMigration = await readFile("supabase/migrations/202609070001_privacy_minimal_analytics.sql", "utf8");
assert(privacyMigration.includes("privacy_minimal_analytics_cutover_not_empty"));
assert(privacyMigration.includes("in access exclusive mode"));
assert(!/delete from|truncate|drop table/i.test(privacyMigration));
assert(!privacyMigration.includes("p_visitor_id"));
const privacyNotice = await readFile("app/(marketing)/privacy/page.tsx", "utf8");
assert(privacyNotice.includes("does not set analytics cookies"));
assert(privacyNotice.includes("held in page memory"));
assert(!privacyNotice.includes("up to 13 months") && !privacyNotice.includes("pseudonymous visitor identifiers"),
  "The public notice still describes the retired analytics implementation.");

console.log(JSON.stringify({
  ok: true,
  trafficExclusion: "pass",
  noPersistentIdentity: "pass",
  timezoneBoundaries: "pass",
  reporting: "pass",
  retention: "pass"
}));

function event(
  eventId: string,
  pageViewId: string,
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
    pageViewId,
    pagePath: "/",
    channel,
    deviceCategory: "mobile",
    properties: {},
    occurredAt,
    createdAt: occurredAt
  };
}
