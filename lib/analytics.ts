import type { AnalyticsEvent, AnalyticsOutcomeRow, AnalyticsOutcomeTotals, AnalyticsSummary } from "./models";

const primaryActionEvents = new Set<AnalyticsEvent["eventType"]>(["tel_click", "form_submit", "outbound_click"]);

export function summarizeAnalytics(siteId: string, events: AnalyticsEvent[]): AnalyticsSummary {
  const siteEvents = events.filter((event) => event.siteId === siteId);
  const totals = outcomeTotals(siteEvents);

  return {
    siteId,
    events: siteEvents.length,
    sessions: totals.sessions,
    pageviews: totals.pageviews,
    clicks: siteEvents.filter((event) => event.eventType === "click").length,
    telClicks: totals.telClicks,
    formStarts: totals.formStarts,
    formSubmits: totals.formSubmits,
    outboundClicks: totals.outboundClicks,
    primaryActions: totals.primaryActions,
    actionRate: totals.actionRate,
    engagedMs: totals.engagedMs,
    avgEngagedSeconds: totals.avgEngagedSeconds,
    avgTimeToActionMs: totals.avgTimeToActionMs,
    medianTimeToActionMs: totals.medianTimeToActionMs,
    avgScrollDepth: totals.avgScrollDepth,
    webVitals: siteEvents
      .filter((event) => event.eventType === "web_vital")
      .map((event) => ({ metric: event.metadata?.metric, value: event.value, timestamp: event.timestamp })),
    outcomesByPage: summarizeBy(siteEvents, (event) => event.pageId ?? "unknown", (key) => key),
    outcomesByCtaRole: summarizeBy(
      siteEvents.filter((event) => event.eventType === "click" || primaryActionEvents.has(event.eventType)),
      (event) => `${event.elementRole ?? "unknown"}:${event.hrefType ?? "unknown"}`,
      (key) => key.replace(":", " / ")
    ),
    outcomesBySection: summarizeBy(
      siteEvents.filter((event) => event.sectionId || event.eventType === "section_view"),
      (event) => event.sectionId ?? "unknown",
      (key) => key
    ),
    outcomesByExperimentVariant: summarizeExperimentVariants(siteEvents),
    baselineComparison: baselineComparison(siteEvents)
  };
}

function summarizeBy(
  events: AnalyticsEvent[],
  keyFor: (event: AnalyticsEvent) => string,
  labelFor: (key: string) => string
): AnalyticsOutcomeRow[] {
  const groups = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const key = keyFor(event);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({ key, label: labelFor(key), events: group.length, ...outcomeTotals(group) }))
    .sort((a, b) => b.primaryActions - a.primaryActions || b.events - a.events)
    .slice(0, 12);
}

function summarizeExperimentVariants(events: AnalyticsEvent[]): AnalyticsOutcomeRow[] {
  const assignments = new Map<string, { experimentId: string; variantId: string }>();
  for (const event of events) {
    if (event.eventType !== "experiment_assignment") continue;
    const experimentId = String(event.metadata?.experimentId ?? "unknown");
    const variantId = String(event.metadata?.variantId ?? "unknown");
    assignments.set(event.sessionId, { experimentId, variantId });
  }

  const assignedEvents = events.filter((event) => assignments.has(event.sessionId));
  return summarizeBy(
    assignedEvents,
    (event) => {
      const assignment = assignments.get(event.sessionId);
      return `${assignment?.experimentId ?? "unknown"}:${assignment?.variantId ?? "unknown"}`;
    },
    (key) => key.replace(":", " / ")
  );
}

function baselineComparison(events: AnalyticsEvent[]): AnalyticsSummary["baselineComparison"] {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (sorted.length === 0) {
    return {
      status: "collecting",
      baseline: emptyTotals(),
      current: emptyTotals(),
      delta: { sessions: 0, primaryActions: 0, actionRate: 0 }
    };
  }

  const first = new Date(sorted[0].timestamp).getTime();
  const last = new Date(sorted.at(-1)?.timestamp ?? sorted[0].timestamp).getTime();
  const midpoint = first + Math.max(1, Math.floor((last - first) / 2));
  const baselineEvents = sorted.filter((event) => new Date(event.timestamp).getTime() <= midpoint);
  const currentEvents = sorted.filter((event) => new Date(event.timestamp).getTime() > midpoint);
  const baseline = outcomeTotals(baselineEvents);
  const current = outcomeTotals(currentEvents);

  return {
    status: last - first >= 1000 * 60 * 60 * 24 * 7 && currentEvents.length > 0 ? "ready" : "collecting",
    baselineStart: sorted[0].timestamp,
    baselineEnd: baselineEvents.at(-1)?.timestamp,
    currentStart: currentEvents[0]?.timestamp,
    currentEnd: sorted.at(-1)?.timestamp,
    baseline,
    current,
    delta: {
      sessions: current.sessions - baseline.sessions,
      primaryActions: current.primaryActions - baseline.primaryActions,
      actionRate: Number((current.actionRate - baseline.actionRate).toFixed(4))
    }
  };
}

function outcomeTotals(events: AnalyticsEvent[]): AnalyticsOutcomeTotals {
  const sessions = new Set(events.map((event) => event.sessionId)).size;
  const telClicks = events.filter((event) => event.eventType === "tel_click").length;
  const formSubmits = events.filter((event) => event.eventType === "form_submit").length;
  const outboundClicks = events.filter((event) => event.eventType === "outbound_click").length;
  const primaryActions = telClicks + formSubmits + outboundClicks;
  const engagedMs = events
    .filter((event) => event.eventType === "engagement")
    .reduce((total, event) => total + (typeof event.value === "number" ? event.value : 0), 0);
  const timeToActionMs = timeToFirstActions(events);
  const scrollDepths = maxScrollDepths(events);

  return {
    sessions,
    pageviews: events.filter((event) => event.eventType === "pageview").length,
    telClicks,
    formStarts: events.filter((event) => event.eventType === "form_start").length,
    formSubmits,
    outboundClicks,
    primaryActions,
    actionRate: sessions ? Number((primaryActions / sessions).toFixed(4)) : 0,
    engagedMs,
    avgEngagedSeconds: sessions ? round(engagedMs / sessions / 1000, 1) : 0,
    avgTimeToActionMs: average(timeToActionMs),
    medianTimeToActionMs: median(timeToActionMs),
    avgScrollDepth: round(average(scrollDepths) ?? 0, 1)
  };
}

function emptyTotals(): AnalyticsOutcomeTotals {
  return {
    sessions: 0,
    pageviews: 0,
    telClicks: 0,
    formStarts: 0,
    formSubmits: 0,
    outboundClicks: 0,
    primaryActions: 0,
    actionRate: 0,
    engagedMs: 0,
    avgEngagedSeconds: 0,
    avgTimeToActionMs: undefined,
    medianTimeToActionMs: undefined,
    avgScrollDepth: 0
  };
}

function timeToFirstActions(events: AnalyticsEvent[]) {
  const bySession = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const group = bySession.get(event.sessionId) ?? [];
    group.push(event);
    bySession.set(event.sessionId, group);
  }

  const values: number[] = [];
  for (const sessionEvents of bySession.values()) {
    const sorted = [...sessionEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = sorted[0];
    const firstAction = sorted.find((event) => primaryActionEvents.has(event.eventType));
    if (!first || !firstAction) continue;
    const explicit = numericMetadata(firstAction, "elapsedMs");
    if (explicit !== undefined) {
      values.push(explicit);
      continue;
    }
    const delta = new Date(firstAction.timestamp).getTime() - new Date(first.timestamp).getTime();
    if (Number.isFinite(delta) && delta >= 0) values.push(delta);
  }
  return values;
}

function maxScrollDepths(events: AnalyticsEvent[]) {
  const bySession = new Map<string, number>();
  for (const event of events) {
    if (event.eventType !== "scroll_depth" || typeof event.value !== "number") continue;
    bySession.set(event.sessionId, Math.max(bySession.get(event.sessionId) ?? 0, event.value));
  }
  return Array.from(bySession.values());
}

function numericMetadata(event: AnalyticsEvent, key: string) {
  const value = event.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function average(values: number[]) {
  if (values.length === 0) return undefined;
  return round(values.reduce((total, value) => total + value, 0) / values.length, 1);
}

function median(values: number[]) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round((sorted[middle - 1] + sorted[middle]) / 2, 1) : sorted[middle];
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
