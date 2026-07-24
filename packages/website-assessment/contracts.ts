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
export const assessmentApplicabilitySchema = z.enum(["universal", "vertical", "business_specific", "capability"]);
export const assessmentVerdictSchema = z.enum(["strong", "serviceable", "weak", "poor"]);
export const agentReadinessGroupIdSchema = z.enum([
  "answer_quality",
  "basic_web_presence",
  "discoverability",
  "content_accessibility",
  "bot_access_control",
  "protocol_discovery",
  "commerce"
]);
export const agentReadinessAlignmentSchema = z.enum([
  "present_valid",
  "present_invalid",
  "not_detected",
  "not_tested"
]);
export const visualQualityGroupIdSchema = z.enum([
  "hierarchy",
  "typography",
  "composition",
  "imagery",
  "brand_trust",
  "responsive_polish"
]);

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

export const agentReadinessCheckSchema = z.object({
  id: z.string().min(1).max(180),
  groupId: agentReadinessGroupIdSchema,
  title: z.string().min(1).max(240),
  status: assessmentCriterionStatusSchema,
  alignment: agentReadinessAlignmentSchema,
  impact: assessmentImpactSchema,
  certainty: assessmentCertaintySchema,
  confidence: z.number().min(0).max(1).optional(),
  applicability: assessmentApplicabilitySchema,
  explanation: z.string().min(1).max(2_000),
  businessConsequence: z.string().min(1).max(1_000),
  recommendation: z.string().min(1).max(1_000),
  evidence: z.array(assessmentEvidenceSchema).min(1).max(30),
  standard: z.object({
    authority: z.enum(["cloudflare", "lodesta"]),
    referenceUrl: z.string().url(),
    countedByAuthority: z.boolean()
  }).strict()
}).strict();

export const agentReadinessGroupSchema = z.object({
  id: agentReadinessGroupIdSchema,
  label: z.string().min(1).max(120),
  coverage: z.number().min(0).max(1),
  verifiedChecks: z.number().int().nonnegative(),
  opportunityChecks: z.number().int().nonnegative(),
  unknownChecks: z.number().int().nonnegative(),
  notApplicableChecks: z.number().int().nonnegative(),
  applicableChecks: z.number().int().nonnegative(),
  checks: z.array(agentReadinessCheckSchema)
}).strict();

export const agentReadinessSchema = z.object({
  methodologyIdentity: z.string().regex(/^agent-readiness@sha256:[a-f0-9]{64}$/),
  coverage: z.object({
    value: z.number().min(0).max(1),
    assessedChecks: z.number().int().nonnegative(),
    applicableChecks: z.number().int().nonnegative(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict(),
  counts: z.object({
    verified: z.number().int().nonnegative(),
    opportunities: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    notApplicable: z.number().int().nonnegative()
  }).strict(),
  groups: z.array(agentReadinessGroupSchema).length(7)
}).strict();

export const visualQualityCheckSchema = z.object({
  id: z.string().min(1).max(180),
  groupId: visualQualityGroupIdSchema,
  title: z.string().min(1).max(240),
  status: assessmentCriterionStatusSchema,
  impact: z.enum(["major", "minor", "advisory"]),
  certainty: z.literal("inferred"),
  confidence: z.number().min(0).max(1).optional(),
  applicability: assessmentApplicabilitySchema,
  explanation: z.string().min(1).max(2_000),
  businessConsequence: z.string().min(1).max(1_000),
  recommendation: z.string().min(1).max(1_000),
  evidence: z.array(assessmentEvidenceSchema).min(1).max(12)
}).strict();

export const visualQualityGroupSchema = z.object({
  id: visualQualityGroupIdSchema,
  label: z.string().min(1).max(120),
  coverage: z.number().min(0).max(1),
  verifiedChecks: z.number().int().nonnegative(),
  opportunityChecks: z.number().int().nonnegative(),
  unknownChecks: z.number().int().nonnegative(),
  notApplicableChecks: z.number().int().nonnegative(),
  applicableChecks: z.number().int().nonnegative(),
  checks: z.array(visualQualityCheckSchema)
}).strict();

export const visualQualitySchema = z.object({
  methodologyIdentity: z.string().regex(/^visual-quality@sha256:[a-f0-9]{64}$/),
  evaluator: z.object({
    identity: z.string().regex(/^visual-evaluator@sha256:[a-f0-9]{64}$/),
    status: z.enum(["completed", "unavailable"]),
    provider: z.literal("openai"),
    modelId: z.string().min(1).max(180),
    promptIdentity: z.string().regex(/^visual-prompt@sha256:[a-f0-9]{64}$/),
    screenshotSetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    generatedAt: z.string().datetime({ offset: true }),
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative()
  }).strict(),
  coverage: z.object({
    value: z.number().min(0).max(1),
    assessedChecks: z.number().int().nonnegative(),
    applicableChecks: z.number().int().nonnegative(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict(),
  counts: z.object({
    verified: z.number().int().nonnegative(),
    opportunities: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    notApplicable: z.number().int().nonnegative()
  }).strict(),
  groups: z.array(visualQualityGroupSchema).length(6)
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
  agentReadiness: agentReadinessSchema,
  visualQuality: visualQualitySchema,
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
export type AgentReadinessGroupId = z.infer<typeof agentReadinessGroupIdSchema>;
export type AgentReadinessAlignment = z.infer<typeof agentReadinessAlignmentSchema>;
export type AgentReadinessCheck = z.infer<typeof agentReadinessCheckSchema>;
export type AgentReadinessGroup = z.infer<typeof agentReadinessGroupSchema>;
export type AgentReadiness = z.infer<typeof agentReadinessSchema>;
export type VisualQualityGroupId = z.infer<typeof visualQualityGroupIdSchema>;
export type VisualQualityCheck = z.infer<typeof visualQualityCheckSchema>;
export type VisualQualityGroup = z.infer<typeof visualQualityGroupSchema>;
export type VisualQuality = z.infer<typeof visualQualitySchema>;

export type AssessmentCriterionInput = Omit<AssessmentCriterion, "pointsEarned" | "pointsPossible"> & {
  pointsPossible?: number;
};
export type AgentReadinessCheckInput = Omit<
  AgentReadinessCheck,
  "title" | "impact" | "applicability" | "businessConsequence" | "recommendation" | "standard" | "groupId"
> & {
  id: string;
};
export type VisualQualityCheckInput = Omit<
  VisualQualityCheck,
  "title" | "impact" | "applicability" | "businessConsequence" | "recommendation" | "groupId"
> & {
  id: string;
};
