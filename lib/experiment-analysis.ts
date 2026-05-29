import type { AnalyticsEvent, Experiment, ExperimentAnalysis } from "./models";

export function analyzeExperiments(experiments: Experiment[], events: AnalyticsEvent[]): ExperimentAnalysis[] {
  return experiments.map((experiment) => analyzeExperiment(experiment, events));
}

export function analyzeExperiment(experiment: Experiment, events: AnalyticsEvent[]): ExperimentAnalysis {
  const assignmentEvents = events.filter(
    (event) => event.eventType === "experiment_assignment" && event.metadata?.experimentId === experiment.id
  );
  const assignments = new Map<string, string>();

  for (const event of assignmentEvents) {
    assignments.set(event.sessionId, String(event.metadata?.variantId ?? "unknown"));
  }

  const controlVariantId = variantId(experiment.variants[0]);
  const variants = experiment.variants.map((variant) => {
    const id = variantId(variant);
    const label = String(variant.label ?? id);
    const sessions = Array.from(assignments.values()).filter((assignedVariant) => assignedVariant === id).length;
    const sessionIds = new Set(
      Array.from(assignments.entries())
        .filter(([, assignedVariant]) => assignedVariant === id)
        .map(([sessionId]) => sessionId)
    );
    const variantEvents = events.filter((event) => sessionIds.has(event.sessionId));
    const metricActions = variantEvents.filter((event) => matchesPrimaryMetric(experiment.primaryMetric, event)).length;
    const allPrimaryActions = variantEvents.filter((event) =>
      event.eventType === "tel_click" || event.eventType === "form_submit" || event.eventType === "outbound_click"
    ).length;
    const engagedMs = variantEvents
      .filter((event) => event.eventType === "engagement")
      .reduce((total, event) => total + (typeof event.value === "number" ? event.value : 0), 0);

    return {
      variantId: id,
      label,
      sessions,
      assignments: assignmentEvents.filter((event) => String(event.metadata?.variantId ?? "unknown") === id).length,
      metricActions,
      allPrimaryActions,
      actionRate: sessions ? round(metricActions / sessions, 4) : 0,
      liftVsControl: 0,
      avgEngagedSeconds: sessions ? round(engagedMs / sessions / 1000, 1) : 0
    };
  });

  const control = variants.find((variant) => variant.variantId === controlVariantId) ?? variants[0];
  for (const variant of variants) {
    variant.liftVsControl = control?.actionRate
      ? round((variant.actionRate - control.actionRate) / control.actionRate, 4)
      : variant.actionRate > 0
        ? 1
        : 0;
  }

  const leader = [...variants].sort(
    (left, right) => right.actionRate - left.actionRate || right.metricActions - left.metricActions || right.sessions - left.sessions
  )[0];
  const totalAssignments = assignmentEvents.length;
  const totalActions = variants.reduce((total, variant) => total + variant.metricActions, 0);
  const status =
    totalAssignments < 10
      ? "collecting"
      : totalActions === 0
        ? "no_signal"
        : "leader_detected";

  return {
    experimentId: experiment.id,
    hypothesis: experiment.hypothesis,
    status,
    primaryMetric: experiment.primaryMetric,
    totalAssignments,
    controlVariantId,
    leaderVariantId: leader?.variantId,
    leaderLabel: leader?.label,
    confidence: totalAssignments >= 100 && totalActions >= 20 ? "strong" : totalAssignments >= 20 && totalActions >= 3 ? "directional" : "insufficient_data",
    variants
  };
}

function matchesPrimaryMetric(metric: Experiment["primaryMetric"], event: AnalyticsEvent) {
  switch (metric) {
    case "tel_clicks":
      return event.eventType === "tel_click";
    case "form_submits":
      return event.eventType === "form_submit";
    case "booking_clicks":
      return event.eventType === "outbound_click" && event.hrefType === "booking";
    case "order_clicks":
      return event.eventType === "outbound_click" && event.hrefType === "ordering";
  }
}

function variantId(variant: Record<string, unknown> | undefined) {
  return String(variant?.id ?? variant?.label ?? "unknown");
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
