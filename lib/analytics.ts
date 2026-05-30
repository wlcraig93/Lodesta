import type {
  AnalyticsClickMapPoint,
  AnalyticsAgentReadableResource,
  AnalyticsEvent,
  AnalyticsFunnelDropoff,
  AnalyticsOutcomeRow,
  AnalyticsOutcomeTotals,
  AnalyticsSectionConversionPath,
  AnalyticsStandardCorrelation,
  AnalyticsSummary
} from "./models";
import { getStandardCriterion } from "./standard";
import { formatWebVitalValue, normalizeWebVitalMetric, webVitalWithinThreshold } from "./web-vitals-standard";

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
    agentReadableRequests: siteEvents.filter((event) => event.eventType === "agent_readable_request").length,
    agentReadableByResource: summarizeAgentReadableResources(siteEvents),
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
    funnelDropoffs: summarizeFunnelDropoffs(siteEvents),
    sectionConversionPaths: summarizeSectionConversionPaths(siteEvents),
    outcomesByExperimentVariant: summarizeExperimentVariants(siteEvents),
    outcomesBySource: summarizeSources(siteEvents),
    clickMap: summarizeClickMap(siteEvents),
    standardCorrelations: summarizeStandardCorrelations(siteEvents, totals),
    baselineComparison: baselineComparison(siteEvents)
  };
}

function summarizeAgentReadableResources(events: AnalyticsEvent[]): AnalyticsAgentReadableResource[] {
  const groups = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    if (event.eventType !== "agent_readable_request") continue;
    const key = stringMetadata(event, "resource") || "unknown";
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      label: key.replace(/_/g, " "),
      requests: group.length,
      sessions: new Set(group.map((event) => event.sessionId)).size,
      latestAt: group.map((event) => event.timestamp).sort().at(-1)
    }))
    .sort((left, right) => right.requests - left.requests || left.label.localeCompare(right.label));
}

function summarizeFunnelDropoffs(events: AnalyticsEvent[]): AnalyticsFunnelDropoff[] {
  const allSessions = sessionSet(events);
  const pageviewSessions = sessionSet(events.filter((event) => event.eventType === "pageview"));
  const sectionViewSessions = sessionSet(events.filter((event) => event.eventType === "section_view"));
  const primaryActionSessions = sessionSet(events.filter((event) => primaryActionEvents.has(event.eventType)));
  const formStartSessions = sessionSet(events.filter((event) => event.eventType === "form_start"));
  const formSubmitSessions = sessionSet(events.filter((event) => event.eventType === "form_submit"));
  const sectionActionSessions = sessionsWithSectionExposureBeforeAction(events);

  return [
    funnelDropoff("visit_to_primary_action", "Sessions", "Primary action sessions", allSessions.size, primaryActionSessions.size),
    funnelDropoff("pageview_to_section_view", "Pageview sessions", "Section-view sessions", pageviewSessions.size, sectionViewSessions.size),
    funnelDropoff(
      "section_view_to_primary_action",
      "Section-view sessions",
      "Action after section exposure",
      sectionViewSessions.size,
      sectionActionSessions.size
    ),
    funnelDropoff("form_start_to_submit", "Form-start sessions", "Form-submit sessions", formStartSessions.size, formSubmitSessions.size)
  ];
}

function funnelDropoff(key: string, from: string, to: string, fromCount: number, toCount: number): AnalyticsFunnelDropoff {
  const boundedTo = Math.min(toCount, fromCount);
  const dropoffCount = Math.max(fromCount - boundedTo, 0);
  return {
    key,
    from,
    to,
    fromCount,
    toCount,
    dropoffCount,
    conversionRate: rate(boundedTo, fromCount),
    dropoffRate: rate(dropoffCount, fromCount)
  };
}

function sessionSet(events: AnalyticsEvent[]) {
  return new Set(events.map((event) => event.sessionId));
}

function sessionsWithSectionExposureBeforeAction(events: AnalyticsEvent[]) {
  const sessions = new Set<string>();
  const bySession = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const group = bySession.get(event.sessionId) ?? [];
    group.push(event);
    bySession.set(event.sessionId, group);
  }

  for (const [sessionId, sessionEvents] of bySession.entries()) {
    const sorted = [...sessionEvents].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const firstSectionView = sorted.find((event) => event.eventType === "section_view");
    if (!firstSectionView) continue;
    const exposureTime = new Date(firstSectionView.timestamp).getTime();
    if (!Number.isFinite(exposureTime)) continue;
    const laterAction = sorted.some((event) => {
      if (!primaryActionEvents.has(event.eventType)) return false;
      const actionTime = new Date(event.timestamp).getTime();
      return Number.isFinite(actionTime) && actionTime >= exposureTime;
    });
    if (laterAction) sessions.add(sessionId);
  }
  return sessions;
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

function summarizeSectionConversionPaths(events: AnalyticsEvent[]): AnalyticsSectionConversionPath[] {
  type SectionPathGroup = {
    sectionId: string;
    exposedSessions: Set<string>;
    actionSessions: Set<string>;
    exposures: number;
    primaryActions: number;
    telClicks: number;
    formSubmits: number;
    outboundClicks: number;
    timeToActionMs: number[];
  };

  const bySession = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const sessionEvents = bySession.get(event.sessionId) ?? [];
    sessionEvents.push(event);
    bySession.set(event.sessionId, sessionEvents);
  }

  const groups = new Map<string, SectionPathGroup>();
  const groupFor = (sectionId: string) => {
    const existing = groups.get(sectionId);
    if (existing) return existing;
    const created: SectionPathGroup = {
      sectionId,
      exposedSessions: new Set(),
      actionSessions: new Set(),
      exposures: 0,
      primaryActions: 0,
      telClicks: 0,
      formSubmits: 0,
      outboundClicks: 0,
      timeToActionMs: []
    };
    groups.set(sectionId, created);
    return created;
  };

  for (const [sessionId, sessionEvents] of bySession.entries()) {
    const sorted = [...sessionEvents].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const firstExposureBySection = new Map<string, AnalyticsEvent>();
    for (const event of sorted) {
      if (event.eventType !== "section_view" || !event.sectionId) continue;
      const group = groupFor(event.sectionId);
      group.exposures += 1;
      group.exposedSessions.add(sessionId);
      if (!firstExposureBySection.has(event.sectionId)) firstExposureBySection.set(event.sectionId, event);
    }

    const primaryActions = sorted.filter((event) => primaryActionEvents.has(event.eventType));
    for (const [sectionId, exposure] of firstExposureBySection.entries()) {
      const exposureTime = new Date(exposure.timestamp).getTime();
      if (!Number.isFinite(exposureTime)) continue;
      const laterActions = primaryActions.filter((event) => {
        const actionTime = new Date(event.timestamp).getTime();
        return Number.isFinite(actionTime) && actionTime >= exposureTime;
      });
      if (laterActions.length === 0) continue;
      const group = groupFor(sectionId);
      group.actionSessions.add(sessionId);
      group.primaryActions += laterActions.length;
      group.telClicks += laterActions.filter((event) => event.eventType === "tel_click").length;
      group.formSubmits += laterActions.filter((event) => event.eventType === "form_submit").length;
      group.outboundClicks += laterActions.filter((event) => event.eventType === "outbound_click").length;
      const firstAction = laterActions[0];
      const firstActionTime = new Date(firstAction.timestamp).getTime();
      const explicit = numericMetadata(firstAction, "elapsedMs");
      const exposureElapsed = numericMetadata(exposure, "elapsedMs");
      const delta = explicit !== undefined && exposureElapsed !== undefined ? explicit - exposureElapsed : firstActionTime - exposureTime;
      if (Number.isFinite(delta) && delta >= 0) group.timeToActionMs.push(delta);
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      key: group.sectionId,
      sectionId: group.sectionId,
      exposedSessions: group.exposedSessions.size,
      exposures: group.exposures,
      actionSessions: group.actionSessions.size,
      primaryActions: group.primaryActions,
      telClicks: group.telClicks,
      formSubmits: group.formSubmits,
      outboundClicks: group.outboundClicks,
      actionRate: rate(group.actionSessions.size, group.exposedSessions.size),
      avgTimeToActionMs: average(group.timeToActionMs),
      medianTimeToActionMs: median(group.timeToActionMs)
    }))
    .sort((left, right) => right.primaryActions - left.primaryActions || right.actionRate - left.actionRate || right.exposures - left.exposures)
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
  const sourceByVisitor = new Map<string, string>();
  const sorted = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  for (const event of sorted) {
    const label = sourceLabel(event);
    if (!sourceBySession.has(event.sessionId)) sourceBySession.set(event.sessionId, label);
    if (event.visitorId && !sourceByVisitor.has(event.visitorId) && label !== "direct / unknown") {
      sourceByVisitor.set(event.visitorId, label);
    }
  }

  const groups = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const sessionSource = sourceBySession.get(event.sessionId) ?? "direct / unknown";
    const key =
      sessionSource !== "direct / unknown"
        ? sessionSource
        : event.visitorId
          ? sourceByVisitor.get(event.visitorId) ?? sessionSource
          : sessionSource;
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

  const correlations: AnalyticsStandardCorrelation[] = [
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
  const performance = webVitalPerformanceCorrelation(events);
  if (performance) correlations.push(performance);
  return correlations;
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

function webVitalPerformanceCorrelation(events: AnalyticsEvent[]): AnalyticsStandardCorrelation | undefined {
  const webVitalEvents = events.filter((event) => event.eventType === "web_vital");
  if (webVitalEvents.length === 0) return undefined;

  const mobileEvents = webVitalEvents.filter((event) => event.deviceType === "mobile");
  const scopedEvents = mobileEvents.length ? mobileEvents : webVitalEvents;
  const latest = new Map<string, { metric: ReturnType<typeof normalizeWebVitalMetric>; value: number; timestamp: string }>();
  for (const event of scopedEvents) {
    const metric = normalizeWebVitalMetric(event.metadata?.metric);
    if (!metric || typeof event.value !== "number") continue;
    const existing = latest.get(metric);
    if (!existing || event.timestamp > existing.timestamp) {
      latest.set(metric, { metric, value: event.value, timestamp: event.timestamp });
    }
  }
  const values = Array.from(latest.values()).filter(
    (item): item is { metric: NonNullable<ReturnType<typeof normalizeWebVitalMetric>>; value: number; timestamp: string } =>
      Boolean(item.metric)
  );
  if (values.length === 0) return undefined;

  const passing = values.filter((item) => webVitalWithinThreshold(item.metric, item.value));
  const failing = values.filter((item) => !webVitalWithinThreshold(item.metric, item.value));
  const criterion = getStandardCriterion("technical.mobile_performance");
  const metricLabel = mobileEvents.length ? "Mobile Web Vitals within target" : "Web Vitals within target";
  const badList = failing.map((item) => `${item.metric} ${formatWebVitalValue(item.metric, item.value)}`).join(", ");

  return {
    criterionId: "technical.mobile_performance",
    title: criterion?.title ?? "Mobile Core Web Vitals stay within launch thresholds",
    layer: criterion?.layer ?? "technical_seo",
    metric: metricLabel,
    events: scopedEvents.length,
    primaryActions: 0,
    rate: rate(passing.length, values.length),
    signal: failing.length === 0 ? "positive" : failing.length >= 2 ? "weak" : "watch",
    insight: failing.length
      ? `${badList} exceeded launch thresholds and should feed performance recommendations.`
      : "Latest measured Web Vitals are inside launch thresholds."
  };
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
