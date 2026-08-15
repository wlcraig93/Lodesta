import { z } from "zod";
import { assessmentCriteria } from "./rubric";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identity = z.string().min(1).max(300);
const status = z.enum(["pass", "warning", "fail", "unknown", "not_applicable"]);
const routeSlot = z.enum(["home", "primary_service", "contact_or_about"]);

const calibrationPinsSchema = z.object({
  sourceSnapshots: z.array(z.object({
    id: identity,
    hash
  }).strict()).min(1),
  businessState: z.object({
    revision: z.number().int().positive(),
    hash
  }).strict(),
  siteIntent: z.object({
    revision: z.number().int().positive(),
    hash
  }).strict(),
  publicBuildInput: z.object({
    id: identity,
    hash
  }).strict(),
  artifact: z.object({
    id: identity,
    versionId: identity.optional()
  }).strict(),
  report: z.object({
    id: identity,
    hash,
    inputHash: hash
  }).strict(),
  screenshotSetHash: hash,
  routeSelectionIdentity: identity,
  selectedSlots: z.tuple([
    z.object({ slot: z.literal("home"), resolvedPath: z.string().startsWith("/").optional() }).strict(),
    z.object({ slot: z.literal("primary_service"), resolvedPath: z.string().startsWith("/").optional() }).strict(),
    z.object({ slot: z.literal("contact_or_about"), resolvedPath: z.string().startsWith("/").optional() }).strict()
  ])
}).strict();

export const assessmentCalibrationDatasetSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("website-health-calibration"),
  registryIdentity: identity,
  scannerIdentity: identity,
  routeSelectionIdentity: identity,
  evaluatorIdentities: z.array(identity).min(1),
  reviews: z.array(z.object({
    vertical: z.string().min(1).max(120),
    reviewer: z.string().min(1).max(180),
    reviewedAt: z.string().datetime({ offset: true }),
    pins: calibrationPinsSchema,
    automatedRankScore: z.number().min(0).max(100),
    humanRankScore: z.number().min(0).max(100),
    criteria: z.array(z.object({
      criterionId: identity,
      certainty: z.enum(["deterministic", "inferred", "human_reviewed"]),
      scoreEligible: z.boolean(),
      automatedStatus: status,
      expectedStatus: status,
      note: z.string().min(1).max(1_000).optional()
    }).strict()).min(1)
  }).strict()).min(1)
}).strict().superRefine((dataset, context) => {
  for (const review of dataset.reviews) {
    if (review.pins.routeSelectionIdentity !== dataset.routeSelectionIdentity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviews"],
        message: `Report ${review.pins.report.id} uses a different route-selection identity.`
      });
    }
    const slots = review.pins.selectedSlots.map((slot) => slot.slot);
    if (new Set(slots).size !== slots.length || slots.some((slot) => !routeSlot.options.includes(slot))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviews"],
        message: `Report ${review.pins.report.id} has invalid semantic route slots.`
      });
    }
  }
  const byReport = new Map<string, string>();
  for (const review of dataset.reviews) {
    const serialized = JSON.stringify(review.pins);
    const prior = byReport.get(review.pins.report.id);
    if (prior && prior !== serialized) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviews"],
        message: `Retained inputs, selected slots, or screenshot hashes differ across reviews for report ${review.pins.report.id}.`
      });
    }
    byReport.set(review.pins.report.id, serialized);
  }
});

export type AssessmentCalibrationDataset = z.infer<typeof assessmentCalibrationDatasetSchema>;

export function summarizeAssessmentCalibration(value: unknown) {
  const dataset = assessmentCalibrationDatasetSchema.parse(value);
  const rows = dataset.reviews.flatMap((review) => review.criteria.map((criterion) => ({
    ...criterion,
    reportId: review.pins.report.id,
    vertical: review.vertical,
    reviewer: review.reviewer
  })));
  const registryDefinitions = new Map(assessmentCriteria.map((criterion) => [criterion.id, criterion]));
  const criterionIds = [...new Set(rows.map((row) => row.criterionId))];
  const criteria = criterionIds.map((criterionId) => {
    const relevant = rows.filter((row) => row.criterionId === criterionId);
    const opportunities = relevant.filter((row) =>
      row.scoreEligible
      && row.certainty === "inferred"
      && isOpportunity(row.automatedStatus)
    );
    const trueOpportunities = opportunities.filter((row) => isOpportunity(row.expectedStatus));
    const disagreements = relevant.filter((row) => row.automatedStatus !== row.expectedStatus);
    return {
      criterionId,
      definitionIdentity: registryDefinitions.get(criterionId)?.definitionIdentity,
      reviewed: relevant.length,
      scoredInferredOpportunities: opportunities.length,
      opportunityPrecision: opportunities.length
        ? round(trueOpportunities.length / opportunities.length)
        : undefined,
      disagreements: disagreements.length,
      disagreementSamples: disagreements.slice(0, 10).map((row) => ({
        reportId: row.reportId,
        vertical: row.vertical,
        automatedStatus: row.automatedStatus,
        expectedStatus: row.expectedStatus,
        note: row.note
      }))
    };
  });
  const inferredCriteriaWithOpportunities = criteria.filter((criterion) =>
    criterion.scoredInferredOpportunities > 0
  );
  const disagreements = rows.filter((row) => row.automatedStatus !== row.expectedStatus);
  const undocumentedDisagreements = disagreements.filter((row) => !row.note?.trim());
  const agreement = reviewerAgreement(rows);
  const reports = uniqueReportScores(dataset);
  const rankAgreement = spearman(
    reports.map((report) => report.automated),
    reports.map((report) => report.human)
  );
  const reviewedSites = reports.length;
  const verticals = [...new Set(dataset.reviews.map((review) => review.vertical))];
  const readiness = {
    minimumReviewedSitesMet: reviewedSites >= 30,
    verticalCoverageMet: verticals.length >= 5,
    dualReviewedSitesMet: agreement.overlappingSites >= 10,
    inferredOpportunityPrecisionMet: inferredCriteriaWithOpportunities.length > 0
      && inferredCriteriaWithOpportunities.every((criterion) =>
        (criterion.opportunityPrecision ?? 0) >= 0.85
      ),
    reviewerAgreementMet: agreement.value !== undefined && agreement.value >= 0.8,
    rankingAgreementMet: rankAgreement !== undefined && rankAgreement >= 0.8,
    everyDisagreementDocumented: undocumentedDisagreements.length === 0,
    publicScoreApproved: false
  };
  return {
    schemaVersion: 2 as const,
    kind: "website-health-calibration-summary" as const,
    registryIdentity: dataset.registryIdentity,
    scannerIdentity: dataset.scannerIdentity,
    routeSelectionIdentity: dataset.routeSelectionIdentity,
    evaluatorIdentities: dataset.evaluatorIdentities,
    reviewedSites,
    verticals,
    dualReviewedSites: agreement.overlappingSites,
    reviewerAgreement: agreement.value,
    rankingAgreement: rankAgreement,
    criteria,
    undocumentedDisagreements: undocumentedDisagreements.map((row) => ({
      reportId: row.reportId,
      criterionId: row.criterionId,
      vertical: row.vertical
    })),
    readiness: {
      ...readiness,
      readyForProductOwnerReview: Object.entries(readiness)
        .filter(([key]) => key !== "publicScoreApproved")
        .every(([, met]) => met),
      note: "Calibration never enables public grades automatically. Product-owner approval and a new registry identity are required."
    }
  };
}

function isOpportunity(value: z.infer<typeof status>) {
  return value === "warning" || value === "fail";
}

function reviewerAgreement(rows: Array<{
  reportId: string;
  criterionId: string;
  reviewer: string;
  expectedStatus: string;
}>) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.reportId}:${row.criterionId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let comparisons = 0;
  let agreements = 0;
  const overlappingSites = new Set<string>();
  for (const group of groups.values()) {
    const reviewers = [...new Map(group.map((row) => [row.reviewer, row])).values()];
    if (reviewers.length < 2) continue;
    overlappingSites.add(reviewers[0].reportId);
    for (let left = 0; left < reviewers.length; left += 1) {
      for (let right = left + 1; right < reviewers.length; right += 1) {
        comparisons += 1;
        if (reviewers[left].expectedStatus === reviewers[right].expectedStatus) agreements += 1;
      }
    }
  }
  return {
    overlappingSites: overlappingSites.size,
    value: comparisons ? round(agreements / comparisons) : undefined
  };
}

function uniqueReportScores(dataset: AssessmentCalibrationDataset) {
  const groups = new Map<string, AssessmentCalibrationDataset["reviews"]>();
  for (const review of dataset.reviews) {
    groups.set(review.pins.report.id, [...(groups.get(review.pins.report.id) ?? []), review]);
  }
  return [...groups.entries()].map(([id, reviews]) => ({
    id,
    automated: average(reviews.map((review) => review.automatedRankScore)),
    human: average(reviews.map((review) => review.humanRankScore))
  }));
}

function spearman(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 3) return undefined;
  const leftRanks = ranks(left);
  const rightRanks = ranks(right);
  const meanLeft = average(leftRanks);
  const meanRight = average(rightRanks);
  const numerator = leftRanks.reduce((total, value, index) =>
    total + (value - meanLeft) * (rightRanks[index] - meanRight), 0);
  const leftVariance = leftRanks.reduce((total, value) => total + (value - meanLeft) ** 2, 0);
  const rightVariance = rightRanks.reduce((total, value) => total + (value - meanRight) ** 2, 0);
  if (!leftVariance || !rightVariance) return undefined;
  return round(numerator / Math.sqrt(leftVariance * rightVariance));
}

function ranks(values: number[]) {
  const ordered = values.map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const result = Array<number>(values.length);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) result[ordered[index].index] = rank;
    start = end;
  }
  return result;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
