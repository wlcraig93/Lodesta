import { z } from "zod";
import type {
  BusinessStrengthAssessment,
  ProspectPresenceReportResult
} from "./contracts";

const publicFindingSchema = z.object({
  id: z.string().min(1).max(180),
  dimension: z.string().min(1).max(180),
  controlOwner: z.enum(["site_author", "lodesta_platform", "source_research", "shared"]),
  severity: z.enum(["critical", "major", "minor", "advisory"]),
  status: z.enum(["fail", "warning"]),
  title: z.string().min(1).max(240),
  explanation: z.string().min(1).max(2_000),
  businessConsequence: z.string().min(1).max(1_000),
  evidence: z.array(z.string().min(1).max(2_000)).max(30),
  recommendation: z.string().min(1).max(1_000)
}).strict();

const publicStrengthSchema = z.object({
  id: z.string().min(1).max(180),
  dimension: z.string().min(1).max(180),
  controlOwner: z.enum(["site_author", "lodesta_platform", "source_research", "shared"]),
  title: z.string().min(1).max(240),
  evidence: z.array(z.string().min(1).max(2_000)).max(30)
}).strict();

const advisoryCoverageSchema = z.object({
  value: z.number().min(0).max(1),
  assessedChecks: z.number().int().nonnegative(),
  applicableChecks: z.number().int().nonnegative(),
  limitations: z.array(z.string().min(1).max(500)).max(40)
}).strict();

const siteInventorySchema = z.object({
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
    id: z.enum(["home", "service", "location", "about", "contact", "faq", "proof", "comparison", "editorial", "legal", "other"]),
    label: z.string().min(1).max(80),
    count: z.number().int().nonnegative()
  }).strict()).length(11)
}).strict();

export const prospectPresenceReportResultSchema: z.ZodType<ProspectPresenceReportResult> = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("prospect-website-health-report"),
  generatedAt: z.string().datetime({ offset: true }),
  websiteKind: z.enum(["owned_website", "no_website", "social_or_aggregator"]),
  sourceUrl: z.string().url().optional(),
  sourceHost: z.string().min(1).max(300).optional(),
  assessmentId: z.string().min(1).max(180).optional(),
  coverage: z.object({
    siteEvidence: z.number().min(0).max(1),
    pipelineCompleteness: z.number().min(0).max(1),
    assessedCriteria: z.number().int().nonnegative(),
    applicableCriteria: z.number().int().nonnegative(),
    provisional: z.boolean(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict().optional(),
  snapshot: z.object({
    verifiedChecks: z.number().int().nonnegative(),
    opportunityChecks: z.number().int().nonnegative(),
    unverifiedChecks: z.number().int().nonnegative(),
    assessedChecks: z.number().int().nonnegative(),
    applicableChecks: z.number().int().nonnegative()
  }).strict().optional(),
  methodology: z.object({
    producerIdentity: z.string().min(1).max(180),
    registryIdentity: z.string().min(1).max(180),
    scannerIdentity: z.string().min(1).max(180),
    routeSelectionIdentity: z.string().min(1).max(180)
  }).strict().optional(),
  grade: z.object({
    withheld: z.literal(true),
    note: z.string().min(1).max(1_000)
  }).strict().optional(),
  dimensions: z.array(z.object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(180),
    state: z.enum(["scored", "not_yet_scored", "insufficient_evidence", "not_applicable"]),
    reviewMode: z.enum(["measured", "advisory"]),
    siteEvidence: z.number().min(0).max(1),
    pipelineCompleteness: z.number().min(0).max(1),
    verifiedChecks: z.number().int().nonnegative(),
    opportunityChecks: z.number().int().nonnegative(),
    unverifiedChecks: z.number().int().nonnegative(),
    notApplicableChecks: z.number().int().nonnegative()
  }).strict()).max(20).optional(),
  siteInventory: siteInventorySchema.optional(),
  siteUnderstanding: z.object({
    businessName: z.string().min(1).max(240).optional(),
    primaryLocation: z.string().min(1).max(300).optional(),
    services: z.array(z.string().min(1).max(240)).max(60),
    customerJourneys: z.array(z.string().min(1).max(300)).max(20)
  }).strict(),
  whatsWorking: z.array(publicStrengthSchema).max(12),
  findings: z.array(publicFindingSchema).max(20),
  agentReadiness: z.object({
    methodologyIdentity: z.string().min(1).max(180),
    coverage: advisoryCoverageSchema,
    verified: z.array(z.object({
      id: z.string().min(1).max(180),
      group: z.string().min(1).max(120),
      title: z.string().min(1).max(240),
      evidence: z.array(z.string().min(1).max(2_000)).max(30)
    }).strict()).max(20),
    findings: z.array(publicFindingSchema.extend({
      authority: z.enum(["cloudflare", "lodesta"]),
      countedByAuthority: z.boolean()
    }).strict()).max(20),
    note: z.string().min(1).max(1_000)
  }).strict().optional(),
  visualQuality: z.object({
    methodologyIdentity: z.string().min(1).max(180),
    coverage: advisoryCoverageSchema,
    strengths: z.array(z.object({
      id: z.string().min(1).max(180),
      group: z.string().min(1).max(120),
      title: z.string().min(1).max(240),
      evidence: z.array(z.string().min(1).max(2_000)).max(30)
    }).strict()).max(20),
    findings: z.array(publicFindingSchema).max(20),
    note: z.string().min(1).max(1_000)
  }).strict().optional(),
  stages: z.array(z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(180),
    status: z.enum(["queued", "running", "completed", "skipped", "failed"])
  }).strict()).max(20),
  gatedPlan: z.object({
    summary: z.string().min(1).max(2_000),
    priorities: z.array(z.object({
      title: z.string().min(1).max(240),
      detail: z.string().min(1).max(2_000)
    }).strict()).max(12)
  }).strict()
}).strict();

export const businessStrengthAssessmentSchema: z.ZodType<BusinessStrengthAssessment> = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("business-strength"),
  generatedAt: z.string().datetime({ offset: true }),
  source: z.enum(["web_research", "verified_business_state"]),
  coverage: z.number().min(0).max(1),
  score: z.number().min(0).max(100).optional(),
  tier: z.enum(["high", "moderate", "limited"]).optional(),
  signals: z.array(z.object({
    id: z.string().min(1).max(180),
    label: z.string().min(1).max(180),
    status: z.enum(["strong", "moderate", "limited", "unknown"]),
    score: z.number().min(0).max(100),
    weight: z.number().positive().max(100),
    value: z.number().optional(),
    explanation: z.string().min(1).max(1_000),
    source: z.enum(["web_research", "verified_business_state"])
  }).strict()).max(20),
  limitations: z.array(z.string().min(1).max(500)).max(20)
}).strict();
