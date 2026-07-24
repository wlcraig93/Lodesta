import { z } from "zod";

export const websiteAssessmentTargetKindSchema = z.enum([
  "public_url",
  "site_artifact",
  "published_site"
]);
export const assessmentDimensionIdSchema = z.enum([
  "functional_integrity",
  "mobile_performance",
  "discoverability",
  "conversion",
  "local_content",
  "trust",
  "automated_accessibility"
]);
export const assessmentCriterionStatusSchema = z.enum([
  "pass",
  "warning",
  "fail",
  "unknown",
  "not_applicable"
]);
export const assessmentImpactSchema = z.enum(["critical", "major", "minor", "advisory"]);
export const assessmentCertaintySchema = z.enum(["deterministic", "inferred", "human_reviewed"]);
export const assessmentApplicabilitySchema = z.enum(["universal", "vertical", "business_specific"]);
export const assessmentVerdictSchema = z.enum(["strong", "serviceable", "weak", "poor"]);

export const assessmentEvidenceSchema = z.object({
  id: z.string().min(1).max(180),
  kind: z.enum([
    "http",
    "crawl",
    "render",
    "field_metric",
    "lab_metric",
    "content",
    "artifact_gate",
    "screenshot",
    "system"
  ]),
  summary: z.string().min(1).max(2_000),
  sourceUrl: z.string().url().optional(),
  route: z.string().max(300).optional(),
  viewport: z.enum(["desktop", "tablet", "mobile"]).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  unit: z.string().max(40).optional(),
  artifactKey: z.string().max(500).optional(),
  observedAt: z.string().datetime({ offset: true })
}).strict();

export const assessmentCriterionSchema = z.object({
  id: z.string().min(1).max(180),
  dimensionId: assessmentDimensionIdSchema,
  title: z.string().min(1).max(240),
  status: assessmentCriterionStatusSchema,
  impact: assessmentImpactSchema,
  certainty: assessmentCertaintySchema,
  confidence: z.number().min(0).max(1).optional(),
  applicability: assessmentApplicabilitySchema,
  explanation: z.string().min(1).max(2_000),
  businessConsequence: z.string().min(1).max(1_000),
  recommendation: z.string().min(1).max(1_000),
  evidence: z.array(assessmentEvidenceSchema).min(1).max(30),
  pointsEarned: z.number().min(0).max(100).optional(),
  pointsPossible: z.number().positive().max(100).optional()
}).strict();

export const assessmentDimensionSchema = z.object({
  id: assessmentDimensionIdSchema,
  label: z.string().min(1).max(120),
  weight: z.number().positive().max(100),
  coverage: z.number().min(0).max(1),
  score: z.number().min(0).max(100).optional(),
  assessedCriteria: z.number().int().nonnegative(),
  applicableCriteria: z.number().int().nonnegative(),
  criteria: z.array(assessmentCriterionSchema)
}).strict();

export const websiteAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(180),
  target: z.object({
    kind: websiteAssessmentTargetKindSchema,
    sourceKey: z.string().min(1).max(500),
    sourceUrl: z.string().url().optional(),
    siteId: z.string().min(1).max(180).optional(),
    artifactId: z.string().min(1).max(180).optional(),
    versionId: z.string().min(1).max(180).optional()
  }).strict(),
  producer: z.object({
    name: z.literal("lodesta-website-assessment"),
    identity: z.string().min(1).max(180),
    rubricIdentity: z.string().min(1).max(180),
    scannerIdentity: z.string().min(1).max(180),
    inputHash: z.string().startsWith("sha256:"),
    generatedAt: z.string().datetime({ offset: true })
  }).strict(),
  siteUnderstanding: z.object({
    businessName: z.string().max(240).optional(),
    primaryLocation: z.string().max(300).optional(),
    services: z.array(z.string().min(1).max(240)).max(60),
    vertical: z.string().min(1).max(120),
    verticalConfidence: z.number().min(0).max(1),
    verticalEvidence: z.array(z.string().min(1).max(500)).max(20),
    customerJourneys: z.array(z.string().min(1).max(300)).max(20)
  }).strict(),
  coverage: z.object({
    value: z.number().min(0).max(1),
    assessedCriteria: z.number().int().nonnegative(),
    applicableCriteria: z.number().int().nonnegative(),
    scoreEligible: z.boolean(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict(),
  score: z.object({
    value: z.number().min(0).max(100),
    verdict: assessmentVerdictSchema,
    provisional: z.boolean()
  }).strict().optional(),
  dimensions: z.array(assessmentDimensionSchema).length(7),
  summary: z.object({
    strengths: z.array(z.string().min(1).max(500)).max(12),
    opportunities: z.array(z.string().min(1).max(500)).max(12),
    criticalFailures: z.array(z.string().min(1).max(500)).max(12)
  }).strict()
}).strict();

export type WebsiteAssessment = z.infer<typeof websiteAssessmentSchema>;
export type WebsiteAssessmentTargetKind = z.infer<typeof websiteAssessmentTargetKindSchema>;
export type AssessmentDimensionId = z.infer<typeof assessmentDimensionIdSchema>;
export type AssessmentCriterionStatus = z.infer<typeof assessmentCriterionStatusSchema>;
export type AssessmentImpact = z.infer<typeof assessmentImpactSchema>;
export type AssessmentCertainty = z.infer<typeof assessmentCertaintySchema>;
export type AssessmentApplicability = z.infer<typeof assessmentApplicabilitySchema>;
export type AssessmentEvidence = z.infer<typeof assessmentEvidenceSchema>;
export type AssessmentCriterion = z.infer<typeof assessmentCriterionSchema>;
export type AssessmentDimension = z.infer<typeof assessmentDimensionSchema>;

export type AssessmentCriterionInput = Omit<AssessmentCriterion, "pointsEarned" | "pointsPossible"> & {
  pointsPossible?: number;
};
