import type {
  AnalyticsClickMapPoint,
  AnalyticsEvent,
  AnalyticsOutcomeRow,
  AnalyticsOutcomeTotals,
  AnalyticsStandardCorrelation,
  AnalyticsSummary
} from "./models";
import { getStandardCriterion } from "./standard";

const primaryActionEvents = new Set<AnalyticsEvent["eventType"]>(["tel_click", "form_submit", "outbound_click"]);
const clickEventTypes = new Set<AnalyticsEvent["eventType"]>(["click", "tel_click", "outbound_click"]);

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
    outcomesBySource: summarizeSources(siteEvents),
    clickMap: summarizeClickMap(siteEvents),
    standardCorrelations: summarizeStandardCorrelations(siteEvents, totals),
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
  const assignments = new Map<string, Array<{ experimentId: string; variantId: string; surface?: string }>>();
  for (const event of events) {
    if (event.eventType !== "experiment_assignment") continue;
    const experimentId = String(event.metadata?.experimentId ?? "unknown");
    const variantId = String(event.metadata?.variantId ?? "unknown");
    const surface = typeof event.metadata?.surface === "string" ? event.metadata.surface : undefined;
    const sessionAssignments = assignments.get(event.sessionId) ?? [];
    if (!sessionAssignments.some((assignment) => assignment.experimentId === experimentId && assignment.variantId === variantId)) {
      sessionAssignments.push({ experimentId, variantId, surface });
    }
    assignments.set(event.sessionId, sessionAssignments);
  }

  const groups = new Map<string, AnalyticsEvent[]>();
  const labels = new Map<string, string>();
  for (const event of events) {
    const sessionAssignments = assignments.get(event.sessionId);
    if (!sessionAssignments) continue;
    for (const assignment of sessionAssignments) {
      const key = `${assignment.experimentId}:${assignment.variantId}`;
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
      labels.set(
        key,
        `${assignment.experimentId} / ${assignment.variantId}${assignment.surface ? ` / ${assignment.surface}` : ""}`
      );
    }
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({ key, label: labels.get(key) ?? key.replace(":", " / "), events: group.length, ...outcomeTotals(group) }))
    .sort((a, b) => b.primaryActions - a.primaryActions || b.events - a.events)
    .slice(0, 12);
}

function summarizeSources(events: AnalyticsEvent[]): AnalyticsOutcomeRow[] {
  const sourceBySession = new Map<string, string>();
  const sorted = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  for (const event of sorted) {
    if (sourceBySession.has(event.sessionId)) continue;
    sourceBySession.set(event.sessionId, sourceLabel(event));
  }

  const groups = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const key = sourceBySession.get(event.sessionId) ?? "direct / unknown";
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({ key, label: key, events: group.length, ...outcomeTotals(group) }))
    .sort((a, b) => b.sessions - a.sessions || b.primaryActions - a.primaryActions || b.events - a.events)
    .slice(0, 12);
}

function summarizeClickMap(events: AnalyticsEvent[]): AnalyticsClickMapPoint[] {
  type ClickGroup = {
    events: AnalyticsEvent[];
    xTotal: number;
    yTotal: number;
    sample: AnalyticsEvent;
  };
  const groups = new Map<string, ClickGroup>();

  for (const event of events) {
    if (!clickEventTypes.has(event.eventType)) continue;
    if (typeof event.normalizedX !== "number" || typeof event.normalizedY !== "number") continue;
    const bucketX = coordinateBucket(event.normalizedX);
    const bucketY = coordinateBucket(event.normalizedY);
    const role = event.elementRole ?? "unknown";
    const hrefType = event.hrefType ?? "unknown";
    const key = [
      event.pageId ?? "unknown",
      event.sectionId ?? "unknown",
      role,
      hrefType,
      event.deviceType ?? "unknown",
      bucketX,
      bucketY
    ].join(":");
    const group = groups.get(key) ?? { events: [], xTotal: 0, yTotal: 0, sample: event };
    group.events.push(event);
    group.xTotal += event.normalizedX;
    group.yTotal += event.normalizedY;
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const primaryActions = group.events.filter((event) => primaryActionEvents.has(event.eventType)).length;
      const count = group.events.length;
      return {
        key,
        label: `${group.sample.elementRole ?? "unknown"} / ${group.sample.hrefType ?? group.sample.eventType}`,
        count,
        primaryActions,
        pageId: group.sample.pageId,
        sectionId: group.sample.sectionId,
        elementRole: group.sample.elementRole,
        hrefType: group.sample.hrefType,
        deviceType: group.sample.deviceType,
        normalizedX: round(group.xTotal / count, 3),
        normalizedY: round(group.yTotal / count, 3)
      };
    })
    .sort((left, right) => right.primaryActions - left.primaryActions || right.count - left.count)
    .slice(0, 20);
}

function summarizeStandardCorrelations(
  events: AnalyticsEvent[],
  totals: AnalyticsOutcomeTotals
): AnalyticsStandardCorrelation[] {
  const sessions = totals.sessions;
  const mobileEvents = events.filter((event) => event.deviceType === "mobile");
  const telEvents = events.filter((event) => event.eventType === "tel_click");
  const formStartEvents = events.filter((event) => event.eventType === "form_start");
  const formSubmitEvents = events.filter((event) => event.eventType === "form_submit");
  const aboveFoldClicks = events.filter(
    (event) => clickEventTypes.has(event.eventType) && typeof event.normalizedY === "number" && event.normalizedY <= 0.35
  );
  const stickyActions = events.filter((event) => event.elementRole === "sticky-tel");

  return [
    standardCorrelation({
      criterionId: "conversion.mobile_click_to_call",
      metric: "Mobile call actions",
      events: telEvents.length,
      primaryActions: telEvents.length,
      rate: rate(telEvents.length, Math.max(mobileEvents.length ? new Set(mobileEvents.map((event) => event.sessionId)).size : sessions, 1)),
      insight: telEvents.length
        ? "Tracked call clicks are proving the click-to-call path."
        : "No tracked call clicks yet; keep watching mobile sessions."
    }),
    standardCorrelation({
      criterionId: "conversion.lead_form",
      metric: "Form submit rate after starts",
      events: formStartEvents.length + formSubmitEvents.length,
      primaryActions: formSubmitEvents.length,
      rate: formStartEvents.length ? rate(formSubmitEvents.length, formStartEvents.length) : rate(formSubmitEvents.length, sessions),
      insight: formStartEvents.length && formSubmitEvents.length === 0
        ? "Visitors are starting forms without submitting, which should feed form-friction recommendations."
        : "Form starts and submits are being measured for the lead-form Standard."
    }),
    standardCorrelation({
      criterionId: "conversion.primary_action_above_fold",
      metric: "Above-fold click share",
      events: aboveFoldClicks.length,
      primaryActions: aboveFoldClicks.filter((event) => primaryActionEvents.has(event.eventType)).length,
      rate: rate(aboveFoldClicks.length, Math.max(events.filter((event) => clickEventTypes.has(event.eventType)).length, 1)),
      insight: aboveFoldClicks.length
        ? "Early clicks are visible enough to connect above-fold CTA decisions to outcomes."
        : "No above-fold clicks have been tracked yet."
    }),
    standardCorrelation({
      criterionId: "conversion.mobile_sticky_action",
      metric: "Sticky action usage",
      events: stickyActions.length,
      primaryActions: stickyActions.filter((event) => primaryActionEvents.has(event.eventType)).length,
      rate: rate(stickyActions.length, Math.max(mobileEvents.length ? new Set(mobileEvents.map((event) => event.sessionId)).size : sessions, 1)),
      insight: stickyActions.length
        ? "Sticky mobile action usage is measurable for Experiment Mode and monthly recommendations."
        : "No sticky action clicks yet; this remains a watch item for mobile traffic."
    })
  ];
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

function standardCorrelation(input: {
  criterionId: string;
  metric: string;
  events: number;
  primaryActions: number;
  rate: number;
  insight: string;
}): AnalyticsStandardCorrelation {
  const criterion = getStandardCriterion(input.criterionId);
  return {
    criterionId: input.criterionId,
    title: criterion?.title ?? input.criterionId,
    layer: criterion?.layer ?? "conversion",
    metric: input.metric,
    events: input.events,
    primaryActions: input.primaryActions,
    rate: input.rate,
    signal: analyticsSignal(input),
    insight: input.insight
  };
}

function analyticsSignal(input: { events: number; primaryActions: number; rate: number }): AnalyticsStandardCorrelation["signal"] {
  if (input.events === 0) return "collecting";
  if (input.primaryActions > 0 && input.rate >= 0.15) return "positive";
  if (input.primaryActions === 0) return "weak";
  return "watch";
}

function sourceLabel(event: AnalyticsEvent) {
  const utmSource = stringMetadata(event, "utmSource");
  const utmCampaign = stringMetadata(event, "utmCampaign");
  if (utmSource) return `utm:${utmSource}${utmCampaign ? ` / ${utmCampaign}` : ""}`;

  const referrerHost = stringMetadata(event, "referrerHost");
  if (referrerHost) return `referrer:${referrerHost}`;

  return "direct / unknown";
}

function stringMetadata(event: AnalyticsEvent, key: string) {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function coordinateBucket(value: number) {
  return round(Math.max(0, Math.min(1, value)) * 20, 0) / 20;
}

function rate(numerator: number, denominator: number) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
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
