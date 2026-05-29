import type { Experiment, ExperimentAnalysis, ExperimentLearning, ExperimentVariantOutcome } from "./models";

export type ExperimentLearningResult =
  | { ok: true; learning: ExperimentLearning; analysis: ExperimentAnalysis }
  | { ok: false; reason: string; analysis?: ExperimentAnalysis };

export function createExperimentLearning(input: {
  siteId: string;
  experiment: Experiment;
  analysis: ExperimentAnalysis;
  createdAt?: string;
}): ExperimentLearningResult {
  const { siteId, experiment, analysis } = input;
  if (analysis.status !== "leader_detected") return { ok: false, reason: "Experiment has no detectable winner.", analysis };
  if (analysis.confidence === "insufficient_data") return { ok: false, reason: "Experiment needs more data before learning can be adopted.", analysis };
  const leader = analysis.variants.find((variant) => variant.variantId === analysis.leaderVariantId);
  const control = analysis.variants.find((variant) => variant.variantId === analysis.controlVariantId);
  if (!leader) return { ok: false, reason: "Leader variant was not found in experiment analysis.", analysis };
  if (!control) return { ok: false, reason: "Control variant was not found in experiment analysis.", analysis };
  if (leader.variantId === control.variantId) return { ok: false, reason: "Control is still leading; no new learning should be adopted.", analysis };
  if (leader.metricActions <= control.metricActions && leader.actionRate <= control.actionRate) {
    return { ok: false, reason: "Leader does not outperform the control on the primary metric.", analysis };
  }

  return {
    ok: true,
    analysis,
    learning: {
      id: `learning_${experiment.id}_${leader.variantId}`,
      siteId,
      experimentId: experiment.id,
      cohort: experiment.cohort,
      surface: experiment.surface,
      primaryMetric: experiment.primaryMetric,
      winnerVariantId: leader.variantId,
      winnerLabel: leader.label,
      controlVariantId: control.variantId,
      confidence: analysis.confidence,
      observedLift: leader.liftVsControl,
      winnerActionRate: leader.actionRate,
      controlActionRate: control.actionRate,
      totalAssignments: analysis.totalAssignments,
      metricActions: leader.metricActions,
      standardCriterionId: standardCriterionForSurface(experiment.surface),
      generationRule: generationRuleForLearning(experiment, leader, control),
      status: "active",
      createdAt: input.createdAt ?? new Date().toISOString()
    }
  };
}

export function applyExperimentLearningsToVariants(input: {
  cohort: string;
  surface: Experiment["surface"];
  primaryMetric: Experiment["primaryMetric"];
  variants: Array<Record<string, unknown>>;
  learnings?: ExperimentLearning[];
}) {
  const learning = activeLearningFor(input.learnings ?? [], input);
  if (!learning) return input.variants;
  return input.variants.map((variant) => {
    const id = String(variant.id ?? "");
    return id === learning.winnerVariantId
      ? {
          ...variant,
          learnedDefault: true,
          learningId: learning.id,
          generationRule: learning.generationRule
        }
      : variant;
  });
}

export function activeLearningFor(
  learnings: ExperimentLearning[],
  context: { cohort: string; surface: Experiment["surface"]; primaryMetric: Experiment["primaryMetric"] }
) {
  return learnings
    .filter(
      (learning) =>
        learning.status === "active" &&
        learning.cohort === context.cohort &&
        learning.surface === context.surface &&
        learning.primaryMetric === context.primaryMetric
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function standardCriterionForSurface(surface: Experiment["surface"]) {
  switch (surface) {
    case "sticky_cta":
      return "conversion.mobile_sticky_action";
    case "cta_placement":
    case "hero_layout":
      return "conversion.primary_action_above_fold";
    case "form_length":
      return "conversion.lead_form";
  }
}

function generationRuleForLearning(
  experiment: Experiment,
  leader: ExperimentVariantOutcome,
  control: ExperimentVariantOutcome
) {
  const lift = Number.isFinite(leader.liftVsControl) ? `${Math.round(leader.liftVsControl * 100)}%` : "measurable";
  return `For ${experiment.cohort} ${experiment.surface.replaceAll("_", " ")} experiments using ${experiment.primaryMetric.replaceAll("_", " ")}, prefer "${leader.label}" over "${control.label}" when fields remain experiment-eligible; observed lift was ${lift}.`;
}
