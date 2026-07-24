import { z } from "zod";

export const assessmentCalibrationDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("website-assessment-calibration"),
  rubricIdentity: z.string().min(1),
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
  return {
    schemaVersion: 1 as const,
    kind: "website-assessment-calibration-summary" as const,
    rubricIdentity: dataset.rubricIdentity,
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
    }
  };
}
