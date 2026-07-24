import { z } from "zod";
import { publiclyEligibleVisualQualityCheckIds } from "./visual-quality";

export const assessmentCalibrationDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("website-assessment-calibration"),
  rubricIdentity: z.string().min(1),
  visualMethodologyIdentity: z.string().regex(/^visual-quality@sha256:[a-f0-9]{64}$/),
  visualEvaluatorIdentity: z.string().regex(/^visual-evaluator@sha256:[a-f0-9]{64}$/),
  reviews: z.array(z.object({
    assessmentId: z.string().min(1),
    vertical: z.string().min(1),
    reviewer: z.string().min(1),
    reviewedAt: z.string().datetime({ offset: true }),
    criteria: z.array(z.object({
      criterionId: z.string().min(1),
      certainty: z.enum(["deterministic", "inferred", "human_reviewed"]),
      automatedStatus: z.enum(["pass", "warning", "fail", "unknown", "not_applicable"]),
      expectedStatus: z.enum(["pass", "warning", "fail", "unknown", "not_applicable"]),
      note: z.string().max(1_000).optional()
    }).strict()).min(1),
    visualRun: z.object({
      status: z.enum(["completed", "unavailable"]),
      durationMs: z.number().int().nonnegative(),
      estimatedCostUsd: z.number().nonnegative()
    }).strict(),
    visualChecks: z.array(z.object({
      checkId: z.string().startsWith("visual."),
      automatedStatus: z.enum(["pass", "warning", "fail", "unknown", "not_applicable"]),
      expectedStatus: z.enum(["pass", "warning", "fail", "unknown", "not_applicable"]),
      note: z.string().max(1_000).optional()
    }).strict()).min(1)
  }).strict()).min(1)
}).strict();

export type AssessmentCalibrationDataset = z.infer<typeof assessmentCalibrationDatasetSchema>;

export function summarizeAssessmentCalibration(value: unknown) {
  const dataset = assessmentCalibrationDatasetSchema.parse(value);
  const rows = dataset.reviews.flatMap((review) => review.criteria.map((criterion) => ({
    ...criterion,
    assessmentId: review.assessmentId,
    vertical: review.vertical
  })));
  const criterionIds = [...new Set(rows.map((row) => row.criterionId))];
  const criteria = criterionIds.map((criterionId) => {
    const relevant = rows.filter((row) => row.criterionId === criterionId);
    const automatedOpportunities = relevant.filter((row) => row.automatedStatus === "fail" || row.automatedStatus === "warning");
    const trueOpportunities = automatedOpportunities.filter((row) => row.expectedStatus === "fail" || row.expectedStatus === "warning");
    const inferred = automatedOpportunities.filter((row) => row.certainty === "inferred");
    const inferredTrue = inferred.filter((row) => row.expectedStatus === "fail" || row.expectedStatus === "warning");
    const disagreements = relevant.filter((row) => row.automatedStatus !== row.expectedStatus);
    return {
      criterionId,
      reviewed: relevant.length,
      automatedOpportunities: automatedOpportunities.length,
      precision: automatedOpportunities.length ? trueOpportunities.length / automatedOpportunities.length : undefined,
      inferredPrecision: inferred.length ? inferredTrue.length / inferred.length : undefined,
      disagreements: disagreements.length,
      disagreementSamples: disagreements.slice(0, 10).map((row) => ({
        assessmentId: row.assessmentId,
        vertical: row.vertical,
        automatedStatus: row.automatedStatus,
        expectedStatus: row.expectedStatus,
        note: row.note
      }))
    };
  });
  const inferredOpportunityRows = rows.filter((row) => row.certainty === "inferred" && (row.automatedStatus === "fail" || row.automatedStatus === "warning"));
  const inferredTrueRows = inferredOpportunityRows.filter((row) => row.expectedStatus === "fail" || row.expectedStatus === "warning");
  const inferredPrecision = inferredOpportunityRows.length ? inferredTrueRows.length / inferredOpportunityRows.length : undefined;
  const verticals = [...new Set(dataset.reviews.map((review) => review.vertical))];
  const reviewedSites = new Set(dataset.reviews.map((review) => review.assessmentId)).size;
  const disagreements = rows.filter((row) => row.automatedStatus !== row.expectedStatus);
  const undocumentedDisagreements = disagreements.filter((row) => !row.note?.trim());
  const visualRows = dataset.reviews.flatMap((review) => review.visualChecks.map((check) => ({
    ...check,
    assessmentId: review.assessmentId,
    vertical: review.vertical,
    reviewer: review.reviewer
  })));
  const visualCheckIds = [...new Set(visualRows.map((row) => row.checkId))];
  const visualChecks = visualCheckIds.map((checkId) => {
    const relevant = visualRows.filter((row) => row.checkId === checkId);
    const automatedOpportunities = relevant.filter((row) => row.automatedStatus === "fail" || row.automatedStatus === "warning");
    const trueOpportunities = automatedOpportunities.filter((row) => row.expectedStatus === "fail" || row.expectedStatus === "warning");
    const checkDisagreements = relevant.filter((row) => row.automatedStatus !== row.expectedStatus);
    return {
      checkId,
      publiclyEligible: publiclyEligibleVisualQualityCheckIds.has(checkId),
      reviewed: relevant.length,
      automatedOpportunities: automatedOpportunities.length,
      precision: automatedOpportunities.length ? trueOpportunities.length / automatedOpportunities.length : undefined,
      disagreements: checkDisagreements.length,
      disagreementSamples: checkDisagreements.slice(0, 10).map((row) => ({
        assessmentId: row.assessmentId,
        vertical: row.vertical,
        automatedStatus: row.automatedStatus,
        expectedStatus: row.expectedStatus,
        note: row.note
      }))
    };
  });
  const reviewerPairs = reviewerAgreementPairs(visualRows);
  const uniqueRuns = [...new Map(dataset.reviews.map((review) => [review.assessmentId, review.visualRun])).values()];
  const completedRuns = uniqueRuns.filter((run) => run.status === "completed");
  const visualUndocumentedDisagreements = visualRows.filter((row) =>
    row.automatedStatus !== row.expectedStatus && !row.note?.trim());
  return {
    schemaVersion: 1 as const,
    kind: "website-assessment-calibration-summary" as const,
    rubricIdentity: dataset.rubricIdentity,
    visualMethodologyIdentity: dataset.visualMethodologyIdentity,
    visualEvaluatorIdentity: dataset.visualEvaluatorIdentity,
    reviewedSites,
    verticals,
    inferredPrecision,
    criteria,
    readiness: {
      minimumReviewedSitesMet: reviewedSites >= 25,
      launchVerticalCoverageMet: verticals.length >= 2,
      inferredPrecisionMet: inferredPrecision !== undefined && inferredPrecision >= 0.85,
      everyDisagreementDocumented: undocumentedDisagreements.length === 0,
      undocumentedDisagreements: undocumentedDisagreements.map((row) => ({
        assessmentId: row.assessmentId,
        criterionId: row.criterionId,
        vertical: row.vertical
      })),
      publicScoreApproved: false,
      note: "This report never enables public scores automatically. Product-owner approval is required after every disagreement is inspected."
    },
    visualQuality: {
      reviewedSites: new Set(visualRows.map((row) => row.assessmentId)).size,
      unavailableRate: uniqueRuns.length
        ? uniqueRuns.filter((run) => run.status === "unavailable").length / uniqueRuns.length
        : 0,
      averageDurationMs: completedRuns.length
        ? completedRuns.reduce((total, run) => total + run.durationMs, 0) / completedRuns.length
        : 0,
      totalEstimatedCostUsd: uniqueRuns.reduce((total, run) => total + run.estimatedCostUsd, 0),
      reviewerAgreement: reviewerPairs.comparisons
        ? reviewerPairs.agreements / reviewerPairs.comparisons
        : undefined,
      reviewerComparisons: reviewerPairs.comparisons,
      checks: visualChecks,
      readiness: {
        minimumReviewedSitesMet: new Set(visualRows.map((row) => row.assessmentId)).size >= 25,
        overlappingReviewerSitesMet: reviewerPairs.overlappingSites >= 10,
        publicEligiblePrecisionMet: visualChecks
          .filter((check) => check.publiclyEligible && check.automatedOpportunities > 0)
          .every((check) => (check.precision ?? 0) >= 0.85),
        everyDisagreementDocumented: visualUndocumentedDisagreements.length === 0,
        undocumentedDisagreements: visualUndocumentedDisagreements.map((row) => ({
          assessmentId: row.assessmentId,
          checkId: row.checkId,
          vertical: row.vertical
        })),
        note: "Calibration reports accuracy and reviewer agreement; it never changes the objective score or release gate."
      }
    }
  };
}

function reviewerAgreementPairs(rows: Array<{
  assessmentId: string;
  checkId: string;
  reviewer: string;
  expectedStatus: string;
}>) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.assessmentId}:${row.checkId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let comparisons = 0;
  let agreements = 0;
  const overlappingSites = new Set<string>();
  for (const group of groups.values()) {
    const reviewers = [...new Map(group.map((row) => [row.reviewer, row])).values()];
    if (reviewers.length < 2) continue;
    overlappingSites.add(reviewers[0].assessmentId);
    for (let left = 0; left < reviewers.length; left += 1) {
      for (let right = left + 1; right < reviewers.length; right += 1) {
        comparisons += 1;
        if (reviewers[left].expectedStatus === reviewers[right].expectedStatus) agreements += 1;
      }
    }
  }
  return { comparisons, agreements, overlappingSites: overlappingSites.size };
}
