import { z } from "zod";
import { assessmentCriteria } from "./rubric";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identity = z.string().min(1).max(500);
const status = z.enum(["pass", "warning", "fail", "unknown", "not_applicable"]);
const disposition = z.enum(["ship", "needs_revision", "reject"]);
const routeSlot = z.enum([
  "home",
  "primary_service",
  "secondary_same_family",
  "conversion_or_faq"
]);

const targetPinsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("public_url"),
    sourceKey: identity,
    sourceUrl: z.string().url()
  }).strict(),
  z.object({
    kind: z.literal("published_site"),
    sourceKey: identity,
    sourceUrl: z.string().url(),
    siteId: identity,
    versionId: identity
  }).strict(),
  z.object({
    kind: z.literal("site_artifact"),
    sourceKey: identity,
    siteId: identity,
    artifactId: identity,
    versionId: identity.optional(),
    publicBuildInput: z.object({ id: identity, hash }).strict()
  }).strict()
]);

const referenceAuthorityPinsSchema = z.object({
  kind: z.enum(["none", "site_public_build_input"]),
  identity: z.string().regex(/^reference-authority@sha256:[a-f0-9]{64}$/),
  publicBuildInputId: identity.optional(),
  publicBuildInputHash: hash.optional(),
  businessRevision: z.number().int().positive().optional(),
  siteIntentRevision: z.number().int().positive().optional(),
  sourceSnapshotIds: z.array(identity).max(500)
}).strict().superRefine((authority, context) => {
  const pinned = authority.kind === "site_public_build_input";
  if (pinned !== Boolean(authority.publicBuildInputId && authority.publicBuildInputHash)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A site-public-build-input reference requires its immutable ID and hash."
    });
  }
});

const calibrationPinsSchema = z.object({
  target: targetPinsSchema,
  referenceAuthority: referenceAuthorityPinsSchema,
  report: z.object({
    id: identity,
    hash,
    inputHash: hash
  }).strict(),
  screenshotSetHash: hash,
  comparability: z.object({
    key: z.string().regex(/^comparison@sha256:[a-f0-9]{64}$/),
    servingContractIdentity: z.string().regex(/^serving-contract@sha256:[a-f0-9]{64}$/),
    referenceAuthorityIdentity: z.string().regex(/^reference-authority@sha256:[a-f0-9]{64}$/),
    inventoryIdentity: z.string().regex(/^assessment-inventory@sha256:[a-f0-9]{64}$/)
  }).strict(),
  routeSelectionIdentity: identity,
  selectedRoutes: z.tuple([
    z.object({ slot: z.literal("home"), resolvedPath: z.string().startsWith("/").optional() }).strict(),
    z.object({ slot: z.literal("primary_service"), resolvedPath: z.string().startsWith("/").optional() }).strict(),
    z.object({ slot: z.literal("secondary_same_family"), resolvedPath: z.string().startsWith("/").optional() }).strict(),
    z.object({ slot: z.literal("conversion_or_faq"), resolvedPath: z.string().startsWith("/").optional() }).strict()
  ])
}).strict();

export const assessmentCalibrationDatasetSchema = z.object({
  schemaVersion: z.literal(3),
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
    readinessDisposition: disposition,
    criteria: z.array(z.object({
      criterionId: identity,
      certainty: z.enum(["deterministic", "inferred", "human_reviewed"]),
      scoreEligible: z.boolean(),
      automatedStatus: status,
      expectedStatus: status,
      evidence: z.array(z.string().min(1).max(2_000)).min(1).max(12),
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
    if (review.pins.referenceAuthority.identity !== review.pins.comparability.referenceAuthorityIdentity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviews"],
        message: `Report ${review.pins.report.id} does not bind the same reference authority in its calibration and comparability pins.`
      });
    }
    const slots = review.pins.selectedRoutes.map((slot) => slot.slot);
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
        message: `Target, reference, selected routes, or screenshot hashes differ across reviews for report ${review.pins.report.id}.`
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
    const labelComparable = relevant.filter((row) =>
      row.automatedStatus !== "unknown" && row.expectedStatus !== "unknown"
    );
    const opportunities = labelComparable.filter((row) =>
      row.scoreEligible
      && row.certainty === "inferred"
      && isOpportunity(row.automatedStatus)
    );
    const trueOpportunities = opportunities.filter((row) => isOpportunity(row.expectedStatus));
    const disagreements = labelComparable.filter((row) => row.automatedStatus !== row.expectedStatus);
    const missedOpportunities = labelComparable.filter((row) =>
      !isOpportunity(row.automatedStatus) && isOpportunity(row.expectedStatus)
    );
    return {
      criterionId,
      definitionIdentity: registryDefinitions.get(criterionId)?.definitionIdentity,
      reviewed: relevant.length,
      comparableLabels: labelComparable.length,
      agreement: labelComparable.length
        ? round((labelComparable.length - disagreements.length) / labelComparable.length)
        : undefined,
      scoredInferredOpportunities: opportunities.length,
      opportunityPrecision: opportunities.length
        ? round(trueOpportunities.length / opportunities.length)
        : undefined,
      missedOpportunities: missedOpportunities.length,
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
  const disagreements = rows.filter((row) =>
    row.automatedStatus !== "unknown"
    && row.expectedStatus !== "unknown"
    && row.automatedStatus !== row.expectedStatus
  );
  const undocumentedDisagreements = disagreements.filter((row) => !row.note?.trim());
  const criterionAgreement = reviewerCriterionAgreement(rows);
  const readinessDispositionAgreement = reviewerDispositionAgreement(dataset.reviews);
  const reportIds = [...new Set(dataset.reviews.map((review) => review.pins.report.id))];
  const reviewedSites = reportIds.length;
  const verticals = [...new Set(dataset.reviews.map((review) => review.vertical))];
  const readiness = {
    minimumReviewedSitesMet: reviewedSites >= 30,
    verticalCoverageMet: verticals.length >= 5,
    dualReviewedSitesMet: criterionAgreement.overlappingSites >= 10,
    inferredOpportunityPrecisionMet: inferredCriteriaWithOpportunities.length > 0
      && inferredCriteriaWithOpportunities.every((criterion) =>
        (criterion.opportunityPrecision ?? 0) >= 0.85
      ),
    reviewerCriterionAgreementMet: criterionAgreement.value !== undefined && criterionAgreement.value >= 0.8,
    readinessDispositionAgreementMet: readinessDispositionAgreement.value !== undefined
      && readinessDispositionAgreement.value >= 0.8,
    everyDisagreementDocumented: undocumentedDisagreements.length === 0,
    publicScoreApproved: false
  };
  return {
    schemaVersion: 3 as const,
    kind: "website-health-calibration-summary" as const,
    registryIdentity: dataset.registryIdentity,
    scannerIdentity: dataset.scannerIdentity,
    routeSelectionIdentity: dataset.routeSelectionIdentity,
    evaluatorIdentities: dataset.evaluatorIdentities,
    reviewedSites,
    verticals,
    dualReviewedSites: criterionAgreement.overlappingSites,
    reviewerCriterionAgreement: criterionAgreement.value,
    readinessDispositionAgreement: readinessDispositionAgreement.value,
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

function reviewerCriterionAgreement(rows: Array<{
  reportId: string;
  criterionId: string;
  reviewer: string;
  expectedStatus: string;
}>) {
  return groupedReviewerAgreement(rows.map((row) => ({
    reportId: row.reportId,
    key: `${row.reportId}:${row.criterionId}`,
    reviewer: row.reviewer,
    value: row.expectedStatus
  })));
}

function reviewerDispositionAgreement(reviews: AssessmentCalibrationDataset["reviews"]) {
  return groupedReviewerAgreement(reviews.map((review) => ({
    reportId: review.pins.report.id,
    key: review.pins.report.id,
    reviewer: review.reviewer,
    value: review.readinessDisposition
  })));
}

function groupedReviewerAgreement(rows: Array<{
  reportId: string;
  key: string;
  reviewer: string;
  value: string;
}>) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
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
        if (reviewers[left].value === reviewers[right].value) agreements += 1;
      }
    }
  }
  return {
    overlappingSites: overlappingSites.size,
    value: comparisons ? round(agreements / comparisons) : undefined
  };
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
