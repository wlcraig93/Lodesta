import assert from "node:assert/strict";
import {
  productionReadinessCriterionIds,
  summarizeGenerationQualityBenchmark,
  type GenerationQualityBenchmarkRun
} from "../packages/website-assessment/generation-quality-benchmark";
import { buildWebsiteAssessment } from "../packages/website-assessment/engine";
import { assessmentCriteria } from "../packages/website-assessment/rubric";
import type { WebsiteAssessment } from "../packages/website-assessment/contracts";

const now = "2026-08-23T12:00:00.000Z";
const inventory: WebsiteAssessment["siteInventory"] = {
  source: "complete_crawl",
  coverage: "complete",
  discoveredUrls: 3,
  eligiblePages: 3,
  assessedPages: 3,
  failedPages: 0,
  contentDepth: { substantivePages: 3, thinPages: 0, unclassifiedPages: 0 },
  pageTypes: [
    { id: "home", label: "Homepage", count: 1 },
    { id: "service", label: "Services", count: 1 },
    { id: "location", label: "Locations", count: 0 },
    { id: "about", label: "About", count: 0 },
    { id: "contact", label: "Contact", count: 1 },
    { id: "faq", label: "FAQ", count: 0 },
    { id: "proof", label: "Proof", count: 0 },
    { id: "comparison", label: "Comparison", count: 0 },
    { id: "editorial", label: "Editorial", count: 0 },
    { id: "legal", label: "Legal", count: 0 },
    { id: "other", label: "Other", count: 0 }
  ]
};

function assessment(id: string, value: number): WebsiteAssessment {
  const built = buildWebsiteAssessment({
    id,
    target: { kind: "public_url", sourceKey: "fixture", sourceUrl: "https://example.com/" },
    siteUnderstanding: {
      businessName: "Example",
      services: ["Service"],
      vertical: "local_service",
      verticalConfidence: 1,
      verticalEvidence: ["fixture"],
      customerJourneys: ["Contact"]
    },
    canonicalFactAvailability: {
      businessName: true,
      phone: true,
      email: true,
      address: true,
      hours: true,
      coordinates: true,
      serviceAreas: true,
      proof: true
    },
    siteInventory: inventory,
    criteria: assessmentCriteria.filter((criterion) => criterion.scoreEligible).map((criterion) => ({
      id: criterion.id,
      status: "pass",
      certainty: criterion.evaluatorType === "model" ? "inferred" : "deterministic",
      explanation: "Fixture evidence.",
      evidence: [{ id: `${criterion.id}.fixture`, kind: "system", summary: "Fixture evidence.", observedAt: now }]
    })),
    agentReadinessChecks: [],
    generatedAt: now,
    inputHashSource: { id }
  });
  return {
    ...built,
    coverage: { ...built.coverage, comparisonEligible: true, pipelineCompleteness: 1 },
    comparability: { ...built.comparability, key: `comparison@sha256:${"a".repeat(64)}` },
    grade: built.grade ? { ...built.grade, value } : undefined,
    dimensions: built.dimensions.map((dimension) =>
      dimension.score === undefined ? dimension : { ...dimension, score: value }
    )
  };
}

function review(assessmentId: string) {
  return {
    assessmentId,
    reviewerIdentity: "reviewer:fixture",
    reviewedAt: now,
    disposition: "ship" as const,
    criteria: productionReadinessCriterionIds.map((criterionId) => ({
      criterionId,
      status: "pass" as const,
      evidence: ["The opening uses business-specific evidence."]
    })),
    notes: ["Fixture review."]
  };
}

const runs: GenerationQualityBenchmarkRun[] = [];
for (let index = 0; index < 9; index += 1) {
  const baseline = assessment(`baseline_assessment_${index}`, 45);
  const phase1 = assessment(`phase1_assessment_${index}`, 54);
  const phase2 = assessment(`phase2_assessment_${index}`, 63);
  runs.push({
    id: `baseline_${index}`, sourceKey: `source_${index % 3}`, phase: "baseline", status: "completed",
    durationMs: 100_000 + index, estimatedCostUsd: 1, inspectionInvoked: index < 4,
    assessment: baseline, productionReadinessReview: review(baseline.id)
  });
  runs.push({
    id: `phase1_${index}`, sourceKey: `source_${index % 3}`, phase: "phase1",
    status: index === 8 ? "failed" : "completed", durationMs: 120_000 + index,
    estimatedCostUsd: 1.2, inspectionInvoked: index < 5,
    ...(index === 8 ? {} : { assessment: phase1, productionReadinessReview: review(phase1.id) })
  });
  runs.push({
    id: `phase2_${index}`, sourceKey: `source_${index % 3}`, phase: "phase2", status: "completed",
    durationMs: 121_000 + index, estimatedCostUsd: 1.21, inspectionInvoked: index < 7,
    assessment: phase2, productionReadinessReview: review(phase2.id)
  });
}

const summary = summarizeGenerationQualityBenchmark({ benchmarkId: "quality_fixture", expectedRunsPerPhase: 9, runs });
assert.equal(summary.phases.baseline.completedRuns, 9);
assert.equal(summary.phases.phase1.completedRuns, 8);
assert.equal(summary.phase1Checkpoint.pause, false);
assert.equal(summary.deltas.measuredWebsiteHealth, 18);
assert.equal(summary.deltas.diagnosticOnly, true);
assert.equal(summary.methodology.measuredHealthMatched, true);
assert.equal(summary.methodology.readinessEvidenceMatched, true);
assert.equal(summary.methodology.productionReadinessDecisionUnit, "criterion_labels_and_disposition");
assert.equal(summary.methodology.legacyCompositeHumanScore, "provenance_only");
assert.equal(summary.phase2DecisionReadiness.readyForOwnerDecision, true);
assert.match(summary.phase2DecisionReadiness.note, /small numerical difference does not establish treatment superiority/);
assert.equal(summary.phases.phase1.scoreByInspection.directionalOnly, false);

assert.throws(() => summarizeGenerationQualityBenchmark({
  benchmarkId: "detached_human_score_fixture",
  expectedRunsPerPhase: 1,
  runs: [{
    ...runs[0],
    productionReadinessReview: {
      ...runs[0].productionReadinessReview!,
      total: 44
    } as GenerationQualityBenchmarkRun["productionReadinessReview"]
  }]
}), /Production-readiness review.*invalid/);

const mismatched = runs.map((run) => run.id === "phase2_0" && run.assessment ? {
  ...run,
  assessment: {
    ...run.assessment,
    comparability: { ...run.assessment.comparability, key: `comparison@sha256:${"b".repeat(64)}` }
  }
} : run);
const blocked = summarizeGenerationQualityBenchmark({ benchmarkId: "blocked_fixture", expectedRunsPerPhase: 9, runs: mismatched });
assert.equal(blocked.methodology.measuredHealthMatched, false);
assert.equal(blocked.phase2DecisionReadiness.readyForOwnerDecision, true);
assert.equal(blocked.deltas.measuredWebsiteHealth, undefined);

const servingMismatch = runs.map((run) => run.id === "phase2_0" && run.assessment ? {
  ...run,
  assessment: {
    ...run.assessment,
    servingContract: {
      kind: "private_preview" as const,
      identity: `serving-contract@sha256:${"b".repeat(64)}`
    },
    comparability: {
      ...run.assessment.comparability,
      key: `comparison@sha256:${"c".repeat(64)}`,
      servingContractIdentity: `serving-contract@sha256:${"b".repeat(64)}`
    }
  }
} : run);
const servingBlocked = summarizeGenerationQualityBenchmark({
  benchmarkId: "serving_blocked_fixture",
  expectedRunsPerPhase: 9,
  runs: servingMismatch
});
assert.equal(servingBlocked.phase2DecisionReadiness.readyForOwnerDecision, false);
assert(servingBlocked.phase2DecisionReadiness.blockers.some((reason) => reason.includes("serving contracts")));

const expensive = summarizeGenerationQualityBenchmark({
  benchmarkId: "expensive_fixture",
  expectedRunsPerPhase: 9,
  runs: runs.map((run) => run.phase === "phase1" ? { ...run, estimatedCostUsd: 1.3 } : run)
});
assert.equal(expensive.phase1Checkpoint.pause, true);
assert(expensive.phase1Checkpoint.reasons.some((reason) => reason.includes("cost")));

process.stdout.write(`${JSON.stringify({ ok: true, canonicalAssessments: "pass", humanReview: "pass", comparability: "pass" })}\n`);
