import type {
  AnalyticsActionType,
  AnalyticsChannel,
  AnalyticsCollectionHealth,
  AnalyticsDeviceCategory,
  AnalyticsEvent,
  AnalyticsReport,
  AnalyticsReportQuery,
  AnalyticsReportRow,
  AnalyticsTotals,
  AnalyticsTrafficClass
} from "@/packages/site-capabilities/contracts";
import { sanitizeAnalyticsMetadata } from "./privacy";

export const analyticsActionTypes = new Set<AnalyticsActionType>([
  "form_submit",
  "call_click",
  "email_click",
  "directions_click",
  "booking_click",
  "ordering_click"
]);

export const analyticsSufficiency = {
  rates: 20,
  recommendations: { pageViews: 50, actions: 5 }
} as const;

const knownBots = /bot\b|crawler\b|spider\b|slurp\b|bingpreview\b|facebookexternalhit\b|googleother\b|google-inspectiontool\b|headlesschrome\b|lighthouse\b|curl\/|wget\/|python-requests|go-http-client|postmanruntime/i;
const lodestaAgents = /\bLodesta(?:WebsiteCrawler|WebsiteAssessment|RenderInspection|RetainedSiteVerifier)\b/i;
const searchHosts = /(^|\.)((google|bing|yahoo|duckduckgo|brave)\.[a-z.]+|search\.aol\.com)$/i;
const socialHosts = /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|pinterest\.com|reddit\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com)$/i;

export function classifyAnalyticsTraffic(userAgent: string | null): AnalyticsTrafficClass {
  const value = userAgent?.trim() ?? "";
  if (lodestaAgents.test(value)) return "lodesta_internal";
  if (!value || knownBots.test(value)) return "known_bot";
  return "human";
}

export function classifyAnalyticsChannel(input: {
  utmSource?: string;
  utmMedium?: string;
  referrerHost?: string;
}): AnalyticsChannel {
  if (input.utmSource || input.utmMedium) return "campaign";
  const host = normalizeReferrerHost(input.referrerHost);
  if (!host) return "direct";
  if (searchHosts.test(host)) return "organic_search";
  if (socialHosts.test(host)) return "social";
  return "referral";
}

export function normalizeAnalyticsPath(value: string | undefined) {
  if (!value) return "/";
  try {
    const url = new URL(value, "https://lodesta.invalid");
    const path = url.pathname.replace(/\/{2,}/g, "/").slice(0, 500);
    return path.startsWith("/") ? path || "/" : `/${path}`;
  } catch {
    return "/";
  }
}

export function normalizeReferrerHost(value: string | undefined) {
  if (!value) return undefined;
  try {
    const host = value.includes("://") ? new URL(value).hostname : value.split("/")[0];
    const normalized = host?.toLowerCase().replace(/^www\./, "").replace(/\.$/, "").slice(0, 253);
    return normalized && /^[a-z0-9.-]+$/.test(normalized) ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeCampaignValue(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!normalized) return undefined;
  const sanitized = sanitizeAnalyticsMetadata({ campaign: normalized })?.campaign;
  return typeof sanitized === "string" ? sanitized : undefined;
}

export function buildAnalyticsReport(
  siteId: string,
  query: AnalyticsReportQuery,
  events: AnalyticsEvent[],
  collectionHealth: AnalyticsCollectionHealth = emptyCollectionHealth()
): AnalyticsReport {
  const currentEvents = filterEvents(events, query, query.from, query.to);
  const comparisonEvents = query.compareFrom && query.compareTo
    ? filterEvents(events, query, query.compareFrom, query.compareTo)
    : undefined;
  const current = totals(currentEvents);
  const comparison = comparisonEvents ? totals(comparisonEvents) : undefined;
  const report: AnalyticsReport = {
    siteId,
    query,
    current,
    comparison,
    trend: trend(currentEvents, query),
    channels: rows(currentEvents, (event) => event.channel, channelLabel),
    sources: rows(currentEvents, (event) => event.source ?? event.referrerHost ?? "direct", channelLabel),
    campaigns: rows(currentEvents.filter((event) => Boolean(event.campaign)), (event) => event.campaign ?? "", (value) => value),
    pages: rows(currentEvents, (event) => event.pagePath, pageLabel),
    actions: rows(currentEvents.filter((event) => analyticsActionTypes.has(event.eventType as AnalyticsActionType)), (event) => event.eventType, actionLabel),
    devices: rows(currentEvents, (event) => event.deviceCategory, titleCase),
    collectionHealth,
    sufficiency: current.pageViews === 0 ? "empty" : current.pageViews < analyticsSufficiency.rates ? "early" : "sufficient",
    recommendations: []
  };
  report.recommendations = recommendations(report);
  return report;
}

export function analyticsReportFromDatabase(siteId: string, query: AnalyticsReportQuery, value: unknown): AnalyticsReport {
  const raw = isRecord(value) ? value : {};
  const current = databaseTotals(raw.current);
  const report: AnalyticsReport = {
    siteId,
    query,
    current,
    comparison: raw.comparison ? databaseTotals(raw.comparison) : undefined,
    trend: array(raw.trend).map((item) => ({
      bucket: text(item.bucket),
      pageViews: integer(item.page_views),
      customerActions: integer(item.customerActions ?? item.customer_actions)
    })),
    channels: databaseRows(raw.channels),
    sources: databaseRows(raw.sources),
    campaigns: databaseRows(raw.campaigns),
    pages: databaseRows(raw.pages),
    actions: databaseRows(raw.actions),
    devices: databaseRows(raw.devices),
    collectionHealth: databaseHealth(raw.collectionHealth ?? raw.collection_health),
    sufficiency: current.pageViews === 0 ? "empty" : current.pageViews < analyticsSufficiency.rates ? "early" : "sufficient",
    recommendations: []
  };
  report.recommendations = recommendations(report);
  return report;
}

function filterEvents(events: AnalyticsEvent[], query: AnalyticsReportQuery, from: string, to: string) {
  const start = localDateBoundary(from, query.timezone);
  const end = localDateBoundary(addDays(to, 1), query.timezone);
  const actionPageIds = query.filters.action
    ? new Set(events.filter((event) => event.eventType === query.filters.action
      && Date.parse(event.occurredAt) >= start && Date.parse(event.occurredAt) < end).map((event) => event.pageViewId))
    : undefined;
  return events.filter((event) => {
    const at = Date.parse(event.occurredAt);
    return event.schemaVersion === 1
      && at >= start && at < end
      && (!query.filters.channel || event.channel === query.filters.channel)
      && (!query.filters.source || (event.source ?? event.referrerHost ?? "direct") === query.filters.source)
      && (!query.filters.page || event.pagePath === query.filters.page)
      && (!query.filters.device || event.deviceCategory === query.filters.device)
      && (!actionPageIds || actionPageIds.has(event.pageViewId));
  });
}

function totals(events: AnalyticsEvent[]): AnalyticsTotals {
  const pageViews = new Set(events.filter((event) => event.eventType === "page_view").map((event) => event.pageViewId));
  const actionEvents = events.filter((event) => analyticsActionTypes.has(event.eventType as AnalyticsActionType));
  // An action with a missing page-view beacon still counts as an action, but
  // cannot inflate the fraction of observed page views that led to an action.
  const actionPageViews = new Set(actionEvents.map((event) => event.pageViewId).filter((id) => pageViews.has(id)));
  return {
    pageViews: pageViews.size,
    leads: events.filter((event) => event.eventType === "form_submit").length,
    customerActions: actionEvents.length,
    actionPageViews: actionPageViews.size,
    actionRate: pageViews.size ? actionPageViews.size / pageViews.size : 0,
    formStarts: events.filter((event) => event.eventType === "form_start").length,
    engagedSeconds: Math.round(events.filter((event) => event.eventType === "engagement")
      .reduce((sum, event) => sum + numberProperty(event, "engagedMs") / 1000, 0)),
    medianSecondsToAction: median(actionEvents.map((event) => numberProperty(event, "elapsedMs") / 1000))
  };
}

function rows(events: AnalyticsEvent[], keyFor: (event: AnalyticsEvent) => string, labelFor: (value: string) => string) {
  const grouped = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const key = keyFor(event) || "unknown";
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return [...grouped.entries()].map(([key, scoped]) => {
    const summary = totals(scoped);
    return {
      key,
      label: labelFor(key),
      pageViews: summary.pageViews,
      customerActions: summary.customerActions,
      actionRate: summary.actionRate,
      engagedSeconds: summary.engagedSeconds
    };
  }).sort((left, right) => right.pageViews - left.pageViews || right.customerActions - left.customerActions || left.key.localeCompare(right.key)).slice(0, 100);
}

function trend(events: AnalyticsEvent[], query: AnalyticsReportQuery) {
  const grouped = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const bucket = localBucket(event.occurredAt, query.timezone, query.interval);
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), event]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([bucket, scoped]) => ({
    bucket,
    pageViews: new Set(scoped.filter((event) => event.eventType === "page_view").map((event) => event.pageViewId)).size,
    customerActions: scoped.filter((event) => analyticsActionTypes.has(event.eventType as AnalyticsActionType)).length
  }));
}

function recommendations(report: AnalyticsReport) {
  if (
    report.current.pageViews < analyticsSufficiency.recommendations.pageViews
    || report.current.customerActions < analyticsSufficiency.recommendations.actions
  ) return [];
  const result = [];
  const leadingChannel = report.channels[0];
  if (leadingChannel && leadingChannel.pageViews >= analyticsSufficiency.recommendations.pageViews) {
    result.push({
      key: `channel:${leadingChannel.key}`,
      title: `${leadingChannel.label} is the leading source`,
      detail: "Review this source alongside its observed actions; page-level attribution does not measure customer acquisition.",
      denominator: `${leadingChannel.customerActions} actions across ${leadingChannel.pageViews} page views`
    });
  }
  const leadingPage = report.pages.find((page) => page.customerActions >= analyticsSufficiency.recommendations.actions);
  if (leadingPage) {
    result.push({
      key: `page:${leadingPage.key}`,
      title: `${leadingPage.label} helps visitors act`,
      detail: "Keep its primary action prominent and use the same proof pattern on related pages.",
      denominator: `${leadingPage.customerActions} actions across ${leadingPage.pageViews} page views`
    });
  }
  return result.slice(0, 2);
}

function localBucket(timestamp: string, timezone: string, interval: AnalyticsReportQuery["interval"]) {
  const parts = localDateParts(new Date(timestamp), timezone);
  if (interval === "month") return `${parts.year}-${two(parts.month)}-01`;
  const date = `${parts.year}-${two(parts.month)}-${two(parts.day)}`;
  if (interval === "day") return date;
  const day = new Date(`${date}T12:00:00Z`);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - weekday + 1);
  return day.toISOString().slice(0, 10);
}

export function localDateBoundary(date: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  let guess = Date.UTC(year, month - 1, day);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = localDateParts(new Date(guess), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
    guess += Date.UTC(year, month - 1, day) - represented;
  }
  return guess;
}

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function numberProperty(event: AnalyticsEvent, key: string) {
  const value = event.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function channelLabel(value: string) {
  return value === "direct" ? "Direct / unknown" : titleCase(value);
}

function actionLabel(value: string) {
  return titleCase(value.replace(/_click$/, "").replace("form_submit", "form submission"));
}

function pageLabel(value: string) {
  return value === "/" ? "Homepage" : value;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function two(value: number) {
  return String(value).padStart(2, "0");
}

function emptyCollectionHealth(): AnalyticsCollectionHealth {
  return { accepted: 0, internal: 0, bot: 0, preview: 0, duplicate: 0, invalid: 0 };
}

function databaseTotals(value: unknown): AnalyticsTotals {
  const item = isRecord(value) ? value : {};
  const pageViews = integer(item.page_views);
  const actionPageViews = integer(item.action_page_views);
  return {
    pageViews,
    leads: integer(item.leads),
    customerActions: integer(item.customerActions ?? item.customer_actions),
    actionPageViews,
    actionRate: pageViews ? actionPageViews / pageViews : 0,
    formStarts: integer(item.formStarts ?? item.form_starts),
    engagedSeconds: integer(item.engagedSeconds ?? item.engaged_seconds),
    medianSecondsToAction: nullableNumber(item.medianSecondsToAction ?? item.median_seconds_to_action)
  };
}

function databaseRows(value: unknown): AnalyticsReportRow[] {
  return array(value).map((item) => ({
    key: text(item.key),
    label: text(item.label),
    pageViews: integer(item.pageViews ?? item.page_views),
    customerActions: integer(item.customerActions ?? item.customer_actions),
    actionRate: number(item.actionRate ?? item.action_rate),
    engagedSeconds: integer(item.engagedSeconds ?? item.engaged_seconds)
  }));
}

function databaseHealth(value: unknown): AnalyticsCollectionHealth {
  const item = isRecord(value) ? value : {};
  return {
    lastAcceptedAt: text(item.lastAcceptedAt ?? item.last_accepted_at) || undefined,
    accepted: integer(item.accepted),
    internal: integer(item.internal),
    bot: integer(item.bot),
    preview: integer(item.preview),
    duplicate: integer(item.duplicate),
    invalid: integer(item.invalid)
  };
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
