import { z } from "zod";

export const websiteAssessmentTargetKindSchema = z.enum([
  "public_url",
  "site_artifact",
  "published_site"
]);
export const assessmentServingContractKindSchema = z.enum([
  "anonymous_public",
  "private_preview",
  "retained_artifact"
]);
export const assessmentReferenceAuthorityKindSchema = z.enum([
  "none",
  "site_public_build_input"
]);
export const assessmentDimensionIdSchema = z.enum([
  "business_truth",
  "functional_integrity",
  "responsive_usability",
  "performance",
  "accessibility",
  "search_answer_discoverability",
  "content_intent_coverage",
  "trust_proof",
  "conversion_usability",
  "visual_editorial_craft"
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
export const assessmentVerdictSchema = z.enum(["excellent", "strong", "serviceable", "weak", "poor"]);
export const assessmentControlOwnerSchema = z.enum([
  "site_author",
  "lodesta_platform",
  "source_research",
  "shared"
]);
export const assessmentEvaluatorTypeSchema = z.enum([
  "deterministic",
  "model",
  "human"
]);
export const assessmentReleaseDispositionSchema = z.enum(["blocking", "advisory"]);
export const assessmentUnknownReasonSchema = z.enum([
  "site_evidence_missing",
  "collector_unavailable",
  "evidence_not_retained",
  "target_structurally_unobservable",
  "inconclusive"
]);
export const assessmentScopeUnitSchema = z.enum([
  "element",
  "page",
  "route_family",
  "site",
  "capability"
]);
export const assessmentAggregationSchema = z.enum([
  "site_wide",
  "any_failure",
  "worst_case",
  "fraction_passing"
]);
export const assessmentEvidenceTierSchema = z.enum([
  "deterministic",
  "browser",
  "model",
  "human"
]);
export const assessmentDimensionStateSchema = z.enum([
  "scored",
  "not_yet_scored",
  "insufficient_evidence",
  "not_applicable"
]);
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
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  frame: z.enum(["top", "middle", "bottom", "navigation", "overview"]).optional(),
  stage: z.enum(["natural", "settled", "derived"]).optional(),
  width: z.number().int().positive().max(10_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  observedAt: z.string().datetime({ offset: true })
}).strict();

export const assessmentCriterionSchema = z.object({
  id: z.string().min(1).max(180),
  definitionIdentity: z.string().regex(/^criterion@sha256:[a-f0-9]{64}$/),
  dimensionId: assessmentDimensionIdSchema,
  topics: z.array(z.string().min(1).max(80)).max(12),
  title: z.string().min(1).max(240),
  status: assessmentCriterionStatusSchema,
  impact: assessmentImpactSchema,
  certainty: assessmentCertaintySchema,
  confidence: z.number().min(0).max(1).optional(),
  applicability: assessmentApplicabilitySchema,
  evaluatorType: assessmentEvaluatorTypeSchema,
  controlOwner: assessmentControlOwnerSchema,
  releaseDisposition: assessmentReleaseDispositionSchema,
  scoreEligible: z.boolean(),
  publicEligible: z.boolean(),
  scopeUnit: assessmentScopeUnitSchema,
  aggregation: assessmentAggregationSchema,
  evidenceTier: assessmentEvidenceTierSchema,
  anchors: z.object({
    pass: z.string().min(1).max(1_000),
    warning: z.string().min(1).max(1_000),
    fail: z.string().min(1).max(1_000)
  }).strict(),
  unknownReason: assessmentUnknownReasonSchema.optional(),
  explanation: z.string().min(1).max(2_000),
  businessConsequence: z.string().min(1).max(1_000),
  recommendation: z.string().min(1).max(1_000),
  evidence: z.array(assessmentEvidenceSchema).min(1).max(30),
  pointsEarned: z.number().min(0).max(100).optional(),
  pointsPossible: z.number().nonnegative().max(100)
}).strict().superRefine((criterion, context) => {
  if (criterion.status === "unknown" && !criterion.unknownReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unknownReason"],
      message: "Unknown criteria must identify why evidence was unavailable or inconclusive."
    });
  }
  if (criterion.status !== "unknown" && criterion.unknownReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unknownReason"],
      message: "Only unknown criteria may carry an unknown reason."
    });
  }
});

export const assessmentDimensionSchema = z.object({
  id: assessmentDimensionIdSchema,
  label: z.string().min(1).max(120),
  weight: z.number().positive().max(100),
  state: assessmentDimensionStateSchema,
  coverage: z.object({
    siteEvidence: z.number().min(0).max(1),
    pipelineCompleteness: z.number().min(0).max(1)
  }).strict(),
  score: z.number().min(0).max(100).optional(),
  capEligible: z.boolean(),
  assessedPoints: z.number().nonnegative(),
  possiblePoints: z.number().nonnegative(),
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

export const websiteSiteInventorySchema = z.object({
  source: z.enum(["complete_crawl", "retained_artifact"]),
  coverage: z.enum(["complete", "restricted", "incomplete", "retained_artifact"]),
  discoveredUrls: z.number().int().nonnegative(),
  eligiblePages: z.number().int().nonnegative(),
  assessedPages: z.number().int().nonnegative(),
  failedPages: z.number().int().nonnegative(),
  contentDepth: z.object({
    substantivePages: z.number().int().nonnegative(),
    thinPages: z.number().int().nonnegative(),
    unclassifiedPages: z.number().int().nonnegative()
  }).strict(),
  pageTypes: z.array(z.object({
    id: z.enum([
      "home",
      "service",
      "location",
      "about",
      "contact",
      "faq",
      "proof",
      "comparison",
      "editorial",
      "legal",
      "other"
    ]),
    label: z.string().min(1).max(80),
    count: z.number().int().nonnegative()
  }).strict()).length(11)
}).strict();

const assessmentScoreScopeSchema = z.object({
  value: z.number().min(0).max(100).optional(),
  coverage: z.number().min(0).max(1),
  activeWeight: z.number().min(0).max(100),
  assessedPoints: z.number().nonnegative(),
  possiblePoints: z.number().nonnegative()
}).strict();

export const websiteHealthReportSchema = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal("website-health-report"),
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
    name: z.literal("lodesta-website-health"),
    identity: z.string().min(1).max(180),
    rubricIdentity: z.string().min(1).max(180),
    scannerIdentity: z.string().min(1).max(180),
    routeSelectionIdentity: z.string().regex(/^route-selection@sha256:[a-f0-9]{64}$/),
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
  canonicalFactAvailability: z.object({
    businessName: z.boolean(),
    phone: z.boolean(),
    email: z.boolean(),
    address: z.boolean(),
    hours: z.boolean(),
    coordinates: z.boolean(),
    serviceAreas: z.boolean(),
    proof: z.boolean()
  }).strict(),
  referenceAuthority: z.object({
    kind: assessmentReferenceAuthorityKindSchema,
    identity: z.string().regex(/^reference-authority@sha256:[a-f0-9]{64}$/),
    publicBuildInputId: z.string().min(1).max(180).optional(),
    publicBuildInputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    businessRevision: z.number().int().positive().optional(),
    siteIntentRevision: z.number().int().positive().optional(),
    sourceSnapshotIds: z.array(z.string().min(1).max(180)).max(500)
  }).strict(),
  servingContract: z.object({
    kind: assessmentServingContractKindSchema,
    identity: z.string().regex(/^serving-contract@sha256:[a-f0-9]{64}$/)
  }).strict(),
  routeSelection: z.object({
    identity: z.string().regex(/^route-selection@sha256:[a-f0-9]{64}$/),
    requestedSlots: z.array(z.enum(["home", "primary_service", "secondary_same_family", "conversion_or_faq"])).length(4),
    selected: z.array(z.object({
      slot: z.enum(["home", "primary_service", "secondary_same_family", "conversion_or_faq"]),
      route: z.string().startsWith("/").optional(),
      sourceUrl: z.string().url().optional(),
      purpose: z.string().min(1).max(80).optional()
    }).strict()).length(4)
  }).strict(),
  siteInventory: websiteSiteInventorySchema,
  coverage: z.object({
    siteEvidence: z.number().min(0).max(1),
    pipelineCompleteness: z.number().min(0).max(1),
    assessedCriteria: z.number().int().nonnegative(),
    applicableCriteria: z.number().int().nonnegative(),
    comparisonEligible: z.boolean(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict(),
  comparability: z.object({
    key: z.string().regex(/^comparison@sha256:[a-f0-9]{64}$/),
    evidenceClass: z.enum([
      "public_observation",
      "artifact_authority",
      "published_observation"
    ]),
    samplingProfileIdentity: z.string().regex(/^route-selection@sha256:[a-f0-9]{64}$/),
    sampledRouteCount: z.number().int().nonnegative(),
    servingContractIdentity: z.string().regex(/^serving-contract@sha256:[a-f0-9]{64}$/),
    referenceAuthorityIdentity: z.string().regex(/^reference-authority@sha256:[a-f0-9]{64}$/),
    inventoryIdentity: z.string().regex(/^assessment-inventory@sha256:[a-f0-9]{64}$/),
    evaluatorIdentities: z.array(z.string().min(1).max(300)).min(1).max(12)
  }).strict(),
  score: z.object({
    rawValue: z.number().min(0).max(100).optional(),
    activeWeight: z.number().min(0).max(100),
    renormalized: z.boolean(),
    scopes: z.object({
      siteAuthor: assessmentScoreScopeSchema
    }).strict()
  }).strict(),
  grade: z.object({
    label: z.literal("Measured Website Health"),
    value: z.number().min(0).max(100),
    band: assessmentVerdictSchema.optional(),
    bandStatus: z.enum([
      "available",
      "suppressed_unscored_dimensions",
      "suppressed_provisional"
    ]),
    provisional: z.boolean(),
    appliedCaps: z.array(z.object({
      id: z.string().min(1).max(180),
      maximum: z.number().min(0).max(100),
      explanation: z.string().min(1).max(500)
    }).strict()).max(20)
  }).strict().optional(),
  release: z.object({
    status: z.enum(["passed", "failed", "not_applicable"]),
    blockers: z.array(z.string().min(1).max(180)).max(40)
  }).strict(),
  dimensions: z.array(assessmentDimensionSchema).length(10),
  evaluators: z.array(z.object({
    kind: z.enum(["deterministic", "model", "human"]),
    identity: z.string().min(1).max(180),
    status: z.enum(["completed", "unavailable", "not_configured"]),
    modelId: z.string().min(1).max(180).optional(),
    promptIdentity: z.string().min(1).max(180).optional(),
    evidenceSetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    generatedAt: z.string().datetime({ offset: true }),
    inputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional()
  }).strict()).min(1).max(12),
  summary: z.object({
    strengths: z.array(z.string().min(1).max(500)).max(12),
    opportunities: z.array(z.string().min(1).max(500)).max(12),
    criticalFailures: z.array(z.string().min(1).max(500)).max(12)
  }).strict()
}).strict();

export const websiteAssessmentSchema = websiteHealthReportSchema;
export type WebsiteHealthReport = z.infer<typeof websiteHealthReportSchema>;
export type WebsiteAssessment = WebsiteHealthReport;
export type WebsiteAssessmentTargetKind = z.infer<typeof websiteAssessmentTargetKindSchema>;
export type AssessmentDimensionId = z.infer<typeof assessmentDimensionIdSchema>;
export type AssessmentCriterionStatus = z.infer<typeof assessmentCriterionStatusSchema>;
export type AssessmentImpact = z.infer<typeof assessmentImpactSchema>;
export type AssessmentCertainty = z.infer<typeof assessmentCertaintySchema>;
export type AssessmentApplicability = z.infer<typeof assessmentApplicabilitySchema>;
export type AssessmentControlOwner = z.infer<typeof assessmentControlOwnerSchema>;
export type AssessmentEvaluatorType = z.infer<typeof assessmentEvaluatorTypeSchema>;
export type AssessmentReleaseDisposition = z.infer<typeof assessmentReleaseDispositionSchema>;
export type AssessmentUnknownReason = z.infer<typeof assessmentUnknownReasonSchema>;
export type AssessmentScopeUnit = z.infer<typeof assessmentScopeUnitSchema>;
export type AssessmentAggregation = z.infer<typeof assessmentAggregationSchema>;
export type AssessmentEvidenceTier = z.infer<typeof assessmentEvidenceTierSchema>;
export type AssessmentDimensionState = z.infer<typeof assessmentDimensionStateSchema>;
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
export type WebsiteSiteInventory = z.infer<typeof websiteSiteInventorySchema>;

export type AssessmentCriterionInput = Pick<
  AssessmentCriterion,
  "id" | "status" | "certainty" | "explanation" | "evidence"
> & {
  dimensionId?: AssessmentDimensionId;
  title?: string;
  impact?: AssessmentImpact;
  applicability?: AssessmentApplicability;
  businessConsequence?: string;
  recommendation?: string;
  confidence?: number;
  unknownReason?: AssessmentUnknownReason;
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
