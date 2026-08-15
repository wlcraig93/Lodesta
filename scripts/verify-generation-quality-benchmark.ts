import assert from "node:assert/strict";
import {
  summarizeGenerationQualityBenchmark,
  type GenerationQualityBenchmarkRun
} from "../packages/website-assessment/generation-quality-benchmark";

const dimensions = (score: number, gatedScore = score) => ({
  business_truth: gatedScore,
  functional_integrity: gatedScore,
  responsive_usability: score,
  performance: score,
  accessibility: gatedScore,
  search_answer_discoverability: score,
  content_intent_coverage: score,
  trust_proof: score,
  conversion_usability: score,
  visual_editorial_craft: score
});
const runs: GenerationQualityBenchmarkRun[] = [];
for (let index = 0; index < 9; index += 1) {
  runs.push({
    id: `baseline_${index}`,
    sourceKey: `source_${index % 3}`,
    phase: "baseline",
    status: "completed",
    durationMs: 100_000 + index,
    estimatedCostUsd: 1,
    inspectionInvoked: index < 4,
    assessment: { score: 45, dimensions: dimensions(45, 40) }
  });
  runs.push({
    id: `phase1_${index}`,
    sourceKey: `source_${index % 3}`,
    phase: "phase1",
    status: index === 8 ? "failed" : "completed",
    durationMs: 120_000 + index,
    estimatedCostUsd: 1.2,
    inspectionInvoked: index < 5,
    ...(index === 8 ? {} : { assessment: { score: 54, dimensions: dimensions(45, 80) } })
  });
  runs.push({
    id: `phase2_${index}`,
    sourceKey: `source_${index % 3}`,
    phase: "phase2",
    status: "completed",
    durationMs: 121_000 + index,
    estimatedCostUsd: 1.21,
    inspectionInvoked: index < 7,
    assessment: { score: 63, dimensions: dimensions(63, 80) }
  });
}
const summary = summarizeGenerationQualityBenchmark({
  benchmarkId: "quality_fixture",
  expectedRunsPerPhase: 9,
  runs
});
assert.equal(summary.phases.baseline.completedRuns, 9);
assert.equal(summary.phases.phase1.completedRuns, 8);
assert.equal(summary.phase1Checkpoint.pause, false);
assert.equal(summary.deltas.overallScore, 18);
assert((summary.deltas.phase2ValueWeightedContribution ?? 0) >= 6);
assert.equal(summary.phase2Acceptance.accepted, true);
assert.equal(summary.phases.phase1.scoreByInspection.directionalOnly, false);

const expensive = summarizeGenerationQualityBenchmark({
  benchmarkId: "expensive_fixture",
  expectedRunsPerPhase: 9,
  runs: runs.map((run) => run.phase === "phase1" ? { ...run, estimatedCostUsd: 1.3 } : run)
});
assert.equal(expensive.phase1Checkpoint.pause, true);
assert(expensive.phase1Checkpoint.reasons.some((reason) => reason.includes("cost")));

process.stdout.write(`${JSON.stringify({ ok: true, benchmarkSplit: "pass", checkpoint: "pass", acceptance: "pass" })}\n`);
