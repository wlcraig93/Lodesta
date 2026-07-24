import { assessmentDimensions } from "./rubric";
import type { AssessmentDimensionId } from "./contracts";

export type GenerationQualityBenchmarkPhase = "baseline" | "phase1" | "phase2";

export type GenerationQualityBenchmarkRun = {
  id: string;
  sourceKey: string;
  phase: GenerationQualityBenchmarkPhase;
  status: "completed" | "failed";
  durationMs: number;
  estimatedCostUsd: number;
  inspectionInvoked: boolean;
  assessment?: {
    score?: number;
    dimensions: Partial<Record<AssessmentDimensionId, number>>;
  };
};

export type GenerationQualityBenchmarkInput = {
  benchmarkId: string;
  expectedRunsPerPhase: number;
  runs: GenerationQualityBenchmarkRun[];
};

const gatedDimensions = new Set<AssessmentDimensionId>([
  "functional_integrity",
  "automated_accessibility"
]);
const phase2ValueDimensions = new Set<AssessmentDimensionId>([
  "discoverability",
  "conversion",
  "local_content"
]);
const dimensionWeights = new Map(assessmentDimensions.map((dimension) => [dimension.id, dimension.weight]));

export function summarizeGenerationQualityBenchmark(input: GenerationQualityBenchmarkInput) {
  if (!input.benchmarkId.trim()) throw new Error("benchmarkId is required.");
  if (!Number.isInteger(input.expectedRunsPerPhase) || input.expectedRunsPerPhase < 1) {
    throw new Error("expectedRunsPerPhase must be a positive integer.");
  }
  const phases = {
    baseline: summarizePhase(input.runs.filter((run) => run.phase === "baseline"), input.expectedRunsPerPhase),
    phase1: summarizePhase(input.runs.filter((run) => run.phase === "phase1"), input.expectedRunsPerPhase),
    phase2: summarizePhase(input.runs.filter((run) => run.phase === "phase2"), input.expectedRunsPerPhase)
  };
  const overallDelta = difference(phases.phase2.medianScore, phases.baseline.medianScore);
  const nonGatedDelta = difference(
    phases.phase2.medianPhase2ValueContribution,
    phases.baseline.medianPhase2ValueContribution
  );
  const phase1CostRatio = ratio(phases.phase1.medianEstimatedCostUsd, phases.baseline.medianEstimatedCostUsd);
  const phase1DurationRatio = ratio(phases.phase1.medianDurationMs, phases.baseline.medianDurationMs);
  const dimensionRegressions = assessmentDimensions.flatMap((dimension) => {
    const baseline = phases.baseline.medianDimensions[dimension.id];
    const phase2 = phases.phase2.medianDimensions[dimension.id];
    if (baseline === undefined || phase2 === undefined) return [];
    const weightedDelta = round((phase2 - baseline) * dimension.weight / 100);
    return weightedDelta < -2 ? [{ id: dimension.id, weightedDelta }] : [];
  });
  return {
    benchmarkId: input.benchmarkId,
    expectedRunsPerPhase: input.expectedRunsPerPhase,
    phases,
    deltas: {
      overallScore: overallDelta,
      gatedWeightedContribution: difference(
        phases.phase2.medianGatedContribution,
        phases.baseline.medianGatedContribution
      ),
      phase2ValueWeightedContribution: nonGatedDelta
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
    phase2Acceptance: {
      accepted: overallDelta !== undefined
        && overallDelta >= 15
        && nonGatedDelta !== undefined
        && nonGatedDelta >= 6
        && dimensionRegressions.length === 0,
      requirements: {
        minimumOverallScoreDelta: 15,
        minimumPhase2ValueWeightedContributionDelta: 6,
        maximumWeightedContributionRegressionPerDimension: 2
      },
      dimensionRegressions
    }
  };
}

function summarizePhase(runs: GenerationQualityBenchmarkRun[], expectedRuns: number) {
  const completed = runs.filter((run) => run.status === "completed" && run.assessment);
  const scoreValues = completed.flatMap((run) => run.assessment?.score === undefined ? [] : [run.assessment.score]);
  const medianDimensions = Object.fromEntries(assessmentDimensions.flatMap((dimension) => {
    const values = completed.flatMap((run) => {
      const score = run.assessment?.dimensions[dimension.id];
      return score === undefined ? [] : [score];
    });
    const value = median(values);
    return value === undefined ? [] : [[dimension.id, value]];
  })) as Partial<Record<AssessmentDimensionId, number>>;
  const inspected = completed.filter((run) => run.inspectionInvoked);
  const uninspected = completed.filter((run) => !run.inspectionInvoked);
  return {
    suppliedRuns: runs.length,
    completedRuns: completed.length,
    failedRuns: Math.max(0, expectedRuns - completed.length),
    completionRate: round(completed.length / expectedRuns),
    medianScore: median(scoreValues),
    medianDimensions,
    medianGatedContribution: median(completed.map((run) => weightedContribution(run, gatedDimensions))),
    medianPhase2ValueContribution: median(completed.map((run) => weightedContribution(run, phase2ValueDimensions))),
    medianDurationMs: median(completed.map((run) => run.durationMs)),
    medianEstimatedCostUsd: median(completed.map((run) => run.estimatedCostUsd)),
    inspectionInvocationRate: completed.length ? round(inspected.length / completed.length) : 0,
    scoreByInspection: {
      invoked: {
        runs: inspected.length,
        medianScore: median(inspected.flatMap((run) => run.assessment?.score === undefined ? [] : [run.assessment.score]))
      },
      notInvoked: {
        runs: uninspected.length,
        medianScore: median(uninspected.flatMap((run) => run.assessment?.score === undefined ? [] : [run.assessment.score]))
      },
      directionalOnly: inspected.length < 3 || uninspected.length < 3
    }
  };
}

function weightedContribution(run: GenerationQualityBenchmarkRun, dimensions: Set<AssessmentDimensionId>) {
  return round([...dimensions].reduce((total, id) => {
    const score = run.assessment?.dimensions[id];
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

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
