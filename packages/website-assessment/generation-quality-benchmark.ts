import { z } from "zod";
import { assessmentDimensions, criterionDefinition } from "./rubric";
import {
  websiteAssessmentSchema,
  type AssessmentCriterionStatus,
  type AssessmentDimensionId,
  type WebsiteAssessment
} from "./contracts";
/* Benchmarks retain full canonical reports so callers cannot manufacture a detached score summary. */

export type GenerationQualityBenchmarkPhase = "baseline" | "phase1" | "phase2";

export type ProductionReadinessReview = {
  assessmentId: string;
  reviewerIdentity: string;
  reviewedAt: string;
  disposition: "ship" | "needs_revision" | "reject";
  criteria: Array<{
    criterionId: string;
    status: Extract<AssessmentCriterionStatus, "pass" | "warning" | "fail">;
    evidence: string[];
  }>;
  notes: string[];
};

export type GenerationQualityBenchmarkRun = {
  id: string;
  sourceKey: string;
  phase: GenerationQualityBenchmarkPhase;
  status: "completed" | "failed";
  durationMs: number;
  estimatedCostUsd: number;
  inspectionInvoked: boolean;
  assessment?: WebsiteAssessment;
  productionReadinessReview?: ProductionReadinessReview;
};

export type GenerationQualityBenchmarkInput = {
  benchmarkId: string;
  expectedRunsPerPhase: number;
  runs: GenerationQualityBenchmarkRun[];
};

const gatedDimensions = new Set<AssessmentDimensionId>([
  "business_truth",
  "functional_integrity",
  "accessibility"
]);
const phase2ValueDimensions = new Set<AssessmentDimensionId>([
  "search_answer_discoverability",
  "content_intent_coverage",
  "trust_proof",
  "conversion_usability",
  "visual_editorial_craft"
]);
const dimensionWeights = new Map(assessmentDimensions.map((dimension) => [dimension.id, dimension.weight]));

export const productionReadinessCriterionIds = [
  "content.five_second_clarity",
  "content.decision_support",
  "content.route_family_distinctiveness",
  "copy.opening_specificity",
  "copy.customer_decision_language",
  "copy.cross_route_coherence",
  "copy.action_truthfulness",
  "visual.brand.distinctiveness",
  "visual.composition.density_pacing",
  "visual.navigation.presentation",
  "visual.polish.visible_defects"
] as const;

export const productionReadinessReviewSchema: z.ZodType<ProductionReadinessReview> = z.object({
  assessmentId: z.string().min(1).max(180),
  reviewerIdentity: z.string().min(1).max(180),
  reviewedAt: z.string().datetime({ offset: true }),
  disposition: z.enum(["ship", "needs_revision", "reject"]),
  criteria: z.array(z.object({
    criterionId: z.string().min(1).max(180),
    status: z.enum(["pass", "warning", "fail"]),
    evidence: z.array(z.string().min(1).max(2_000)).min(1).max(12)
  }).strict()).length(productionReadinessCriterionIds.length),
  notes: z.array(z.string().min(1).max(2_000)).max(20)
}).strict();

export function summarizeGenerationQualityBenchmark(input: GenerationQualityBenchmarkInput) {
  if (!input.benchmarkId.trim()) throw new Error("benchmarkId is required.");
  if (!Number.isInteger(input.expectedRunsPerPhase) || input.expectedRunsPerPhase < 1) {
    throw new Error("expectedRunsPerPhase must be a positive integer.");
  }
  for (const run of input.runs) validateRun(run);
  const phases = {
    baseline: summarizePhase(input.runs.filter((run) => run.phase === "baseline"), input.expectedRunsPerPhase),
    phase1: summarizePhase(input.runs.filter((run) => run.phase === "phase1"), input.expectedRunsPerPhase),
    phase2: summarizePhase(input.runs.filter((run) => run.phase === "phase2"), input.expectedRunsPerPhase)
  };
  const comparisonKeys = unique([
    ...phases.baseline.comparabilityKeys,
    ...phases.phase2.comparabilityKeys
  ]);
  const matchedMethodology = comparisonKeys.length === 1
    && phases.baseline.completedRuns > 0
    && phases.phase2.completedRuns > 0;
  const readinessBlockers = readinessComparisonBlockers(input.runs, input.expectedRunsPerPhase);
  const overallDelta = matchedMethodology
    ? difference(phases.phase2.medianMeasuredHealth, phases.baseline.medianMeasuredHealth)
    : undefined;
  const nonGatedDelta = matchedMethodology
    ? difference(
        phases.phase2.medianPhase2ValueContribution,
        phases.baseline.medianPhase2ValueContribution
      )
    : undefined;
  const phase1CostRatio = ratio(phases.phase1.medianEstimatedCostUsd, phases.baseline.medianEstimatedCostUsd);
  const phase1DurationRatio = ratio(phases.phase1.medianDurationMs, phases.baseline.medianDurationMs);
  return {
    benchmarkId: input.benchmarkId,
    expectedRunsPerPhase: input.expectedRunsPerPhase,
    phases,
    methodology: {
      measuredHealthMatched: matchedMethodology,
      comparabilityKeys: comparisonKeys,
      readinessEvidenceMatched: readinessBlockers.length === 0,
      productionReadinessDecisionUnit: "criterion_labels_and_disposition" as const,
      legacyCompositeHumanScore: "provenance_only" as const
    },
    deltas: {
      measuredWebsiteHealth: overallDelta,
      gatedWeightedContribution: matchedMethodology
        ? difference(phases.phase2.medianGatedContribution, phases.baseline.medianGatedContribution)
        : undefined,
      phase2ValueWeightedContribution: nonGatedDelta,
      diagnosticOnly: true
    },
    phase1Checkpoint: {
      pause: phases.phase1.failedRuns > 1
        || (phase1CostRatio !== undefined && phase1CostRatio >= 1.25)
        || (phase1DurationRatio !== undefined && phase1DurationRatio >= 1.25),
      costRatio: phase1CostRatio,
      durationRatio: phase1DurationRatio,
      reasons: [
        ...(phases.phase1.failedRuns > 1 ? [`${phases.phase1.failedRuns} of ${input.expectedRunsPerPhase} Phase 1 runs did not complete.`] : []),
        ...(phase1CostRatio !== undefined && phase1CostRatio >= 1.25 ? [`Median Phase 1 cost is ${phase1CostRatio}× baseline.`] : []),
        ...(phase1DurationRatio !== undefined && phase1DurationRatio >= 1.25 ? [`Median Phase 1 duration is ${phase1DurationRatio}× baseline.`] : [])
      ]
    },
    phase2DecisionReadiness: {
      readyForOwnerDecision: readinessBlockers.length === 0,
      blockers: readinessBlockers,
      note: "Fixed-sample human criterion labels and dispositions may support an owner decision when complete-inventory Measured Website Health is not comparable. Legacy summed human scores remain provenance only: a small numerical difference does not establish treatment superiority, and neither evidence path automatically accepts a generator treatment."
    }
  };
}

function validateRun(run: GenerationQualityBenchmarkRun) {
  if (run.status === "completed" && !run.assessment) {
    throw new Error(`Completed benchmark run ${run.id} must retain its canonical assessment.`);
  }
  if (run.assessment && !websiteAssessmentSchema.safeParse(run.assessment).success) {
    throw new Error(`Benchmark run ${run.id} does not contain a canonical current-schema assessment.`);
  }
  const review = run.productionReadinessReview;
  if (!review) return;
  const parsedReview = productionReadinessReviewSchema.safeParse(review);
  if (!parsedReview.success) {
    throw new Error(`Production-readiness review for ${run.id} is invalid: ${parsedReview.error.issues[0]?.message ?? "unknown contract error"}`);
  }
  if (!run.assessment || review.assessmentId !== run.assessment.id) {
    throw new Error(`Production-readiness review for ${run.id} is not bound to its retained assessment.`);
  }
  const suppliedIds = review.criteria.map((criterion) => criterion.criterionId).sort();
  const expectedIds = [...productionReadinessCriterionIds].sort();
  if (new Set(suppliedIds).size !== suppliedIds.length
    || suppliedIds.join("|") !== expectedIds.join("|")) {
    throw new Error(`Production-readiness review for ${run.id} must label every canonical judgment criterion exactly once.`);
  }
  for (const criterion of review.criteria) {
    criterionDefinition(criterion.criterionId);
    if (!criterion.evidence.length) {
      throw new Error(`Production-readiness criterion ${criterion.criterionId} must retain evidence.`);
    }
  }
}

function readinessComparisonBlockers(
  runs: GenerationQualityBenchmarkRun[],
  expectedRuns: number
) {
  const completed = (phase: "baseline" | "phase2") => runs.filter((run): run is GenerationQualityBenchmarkRun & {
    assessment: WebsiteAssessment;
    productionReadinessReview: ProductionReadinessReview;
  } => run.phase === phase
    && run.status === "completed"
    && Boolean(run.assessment)
    && Boolean(run.productionReadinessReview));
  const baseline = completed("baseline");
  const treatment = completed("phase2");
  const all = [...baseline, ...treatment];
  const blockers: string[] = [];
  if (baseline.length < expectedRuns) {
    blockers.push(`Only ${baseline.length} of ${expectedRuns} baseline runs have complete fixed-sample readiness evidence.`);
  }
  if (treatment.length < expectedRuns) {
    blockers.push(`Only ${treatment.length} of ${expectedRuns} Phase 2 runs have complete fixed-sample readiness evidence.`);
  }
  const samplingIdentities = unique(all.map((run) => run.assessment.comparability.samplingProfileIdentity));
  if (samplingIdentities.length !== 1) {
    blockers.push("Baseline and Phase 2 readiness reviews do not use one canonical four-route sampling policy.");
  }
  const servingIdentities = unique(all.map((run) => run.assessment.comparability.servingContractIdentity));
  if (servingIdentities.length !== 1) {
    blockers.push("Baseline and Phase 2 readiness evidence comes from different serving contracts.");
  }
  const sourceKeys = unique([...baseline, ...treatment].map((run) => run.sourceKey));
  for (const sourceKey of sourceKeys) {
    const left = baseline.filter((run) => run.sourceKey === sourceKey);
    const right = treatment.filter((run) => run.sourceKey === sourceKey);
    if (!left.length || !right.length) {
      blockers.push(`Source ${sourceKey} is not represented in both baseline and Phase 2.`);
      continue;
    }
    const references = unique([...left, ...right]
      .map((run) => run.assessment.comparability.referenceAuthorityIdentity));
    if (references.length !== 1) {
      blockers.push(`Source ${sourceKey} does not use one frozen reference authority.`);
    }
  }
  return unique(blockers);
}

function summarizePhase(runs: GenerationQualityBenchmarkRun[], expectedRuns: number) {
  const completed = runs.filter((run): run is GenerationQualityBenchmarkRun & { assessment: WebsiteAssessment } =>
    run.status === "completed" && Boolean(run.assessment)
  );
  const inspected = completed.filter((run) => run.inspectionInvoked);
  const uninspected = completed.filter((run) => !run.inspectionInvoked);
  const reviewed = completed.filter((run) => Boolean(run.productionReadinessReview));
  return {
    suppliedRuns: runs.length,
    completedRuns: completed.length,
    failedRuns: Math.max(0, expectedRuns - completed.length),
    completionRate: round(completed.length / expectedRuns),
    comparabilityKeys: unique(completed.map((run) => run.assessment.comparability.key)),
    assessmentIds: completed.map((run) => run.assessment.id),
    medianMeasuredHealth: median(completed.flatMap((run) =>
      run.assessment.grade?.value === undefined ? [] : [run.assessment.grade.value]
    )),
    medianDimensions: Object.fromEntries(assessmentDimensions.flatMap((dimension) => {
      const values = completed.flatMap((run) => {
        const score = run.assessment.dimensions.find((item) => item.id === dimension.id)?.score;
        return score === undefined ? [] : [score];
      });
      const value = median(values);
      return value === undefined ? [] : [[dimension.id, value]];
    })) as Partial<Record<AssessmentDimensionId, number>>,
    medianGatedContribution: median(completed.map((run) => weightedContribution(run.assessment, gatedDimensions))),
    medianPhase2ValueContribution: median(completed.map((run) => weightedContribution(run.assessment, phase2ValueDimensions))),
    medianDurationMs: median(completed.map((run) => run.durationMs)),
    medianEstimatedCostUsd: median(completed.map((run) => run.estimatedCostUsd)),
    inspectionInvocationRate: completed.length ? round(inspected.length / completed.length) : 0,
    reviewedRuns: reviewed.length,
    reviewDispositions: {
      ship: reviewed.filter((run) => run.productionReadinessReview?.disposition === "ship").length,
      needsRevision: reviewed.filter((run) => run.productionReadinessReview?.disposition === "needs_revision").length,
      reject: reviewed.filter((run) => run.productionReadinessReview?.disposition === "reject").length
    },
    scoreByInspection: {
      invoked: {
        runs: inspected.length,
        medianMeasuredHealth: median(inspected.flatMap((run) =>
          run.assessment.grade?.value === undefined ? [] : [run.assessment.grade.value]
        ))
      },
      notInvoked: {
        runs: uninspected.length,
        medianMeasuredHealth: median(uninspected.flatMap((run) =>
          run.assessment.grade?.value === undefined ? [] : [run.assessment.grade.value]
        ))
      },
      directionalOnly: inspected.length < 3 || uninspected.length < 3
    }
  };
}

function weightedContribution(assessment: WebsiteAssessment, dimensions: Set<AssessmentDimensionId>) {
  return round([...dimensions].reduce((total, id) => {
    const score = assessment.dimensions.find((dimension) => dimension.id === id)?.score;
    const weight = dimensionWeights.get(id);
    return score === undefined || weight === undefined ? total : total + score * weight / 100;
  }, 0));
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return undefined;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? round(sorted[midpoint]) : round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
}

function difference(left: number | undefined, right: number | undefined) {
  return left === undefined || right === undefined ? undefined : round(left - right);
}

function ratio(left: number | undefined, right: number | undefined) {
  return left === undefined || right === undefined || right === 0 ? undefined : round(left / right);
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
