import { z } from "zod";
import type {
  BusinessStrengthAssessment,
  ProspectPresenceReportResult
} from "./contracts";

const publicFindingSchema = z.object({
  id: z.string().min(1).max(180),
  dimension: z.string().min(1).max(180),
  severity: z.enum(["critical", "major", "minor", "advisory"]),
  status: z.enum(["fail", "warning"]),
  title: z.string().min(1).max(240),
  explanation: z.string().min(1).max(2_000),
  businessConsequence: z.string().min(1).max(1_000),
  evidence: z.array(z.string().min(1).max(2_000)).max(30),
  recommendation: z.string().min(1).max(1_000)
}).strict();

const publicAgentReadinessSchema = z.object({
  methodologyIdentity: z.string().regex(/^agent-readiness@sha256:[a-f0-9]{64}$/),
  coverage: z.object({
    value: z.number().min(0).max(1),
    assessedChecks: z.number().int().nonnegative(),
    applicableChecks: z.number().int().nonnegative(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict(),
  verified: z.array(z.object({
    id: z.string().min(1).max(180),
    group: z.string().min(1).max(180),
    title: z.string().min(1).max(240),
    evidence: z.array(z.string().min(1).max(2_000)).max(30)
  }).strict()).max(6),
  findings: z.array(publicFindingSchema.extend({
    authority: z.enum(["cloudflare", "lodesta"]),
    countedByAuthority: z.boolean()
  }).strict()).max(6),
  note: z.string().min(1).max(1_000)
}).strict();

const publicVisualQualitySchema = z.object({
  methodologyIdentity: z.string().regex(/^visual-quality@sha256:[a-f0-9]{64}$/),
  coverage: z.object({
    value: z.number().min(0).max(1),
    assessedChecks: z.number().int().nonnegative(),
    applicableChecks: z.number().int().nonnegative(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict(),
  strengths: z.array(z.object({
    id: z.string().min(1).max(180),
    group: z.string().min(1).max(180),
    title: z.string().min(1).max(240),
    evidence: z.array(z.string().min(1).max(2_000)).max(12)
  }).strict()).max(4),
  findings: z.array(publicFindingSchema).max(4),
  note: z.string().min(1).max(1_000)
}).strict().superRefine((value, context) => {
  if (value.strengths.length + value.findings.length > 4) {
    context.addIssue({
      code: "custom",
      path: ["strengths"],
      message: "Visual Quality exposes at most four combined strengths and findings."
    });
  }
});

export const prospectPresenceReportResultSchema: z.ZodType<ProspectPresenceReportResult> = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("prospect-presence-report"),
  generatedAt: z.string().datetime({ offset: true }),
  websiteKind: z.enum(["owned_website", "no_website", "social_or_aggregator"]),
  sourceUrl: z.string().url().optional(),
  sourceHost: z.string().min(1).max(300).optional(),
  assessmentId: z.string().min(1).max(180).optional(),
  coverage: z.object({
    value: z.number().min(0).max(1),
    assessedCriteria: z.number().int().nonnegative(),
    applicableCriteria: z.number().int().nonnegative(),
    limitations: z.array(z.string().min(1).max(500)).max(40)
  }).strict().optional(),
  siteUnderstanding: z.object({
    businessName: z.string().min(1).max(240).optional(),
    primaryLocation: z.string().min(1).max(300).optional(),
    services: z.array(z.string().min(1).max(240)).max(60),
    customerJourneys: z.array(z.string().min(1).max(300)).max(20)
  }).strict(),
  whatsWorking: z.array(z.object({
    id: z.string().min(1).max(180),
    dimension: z.string().min(1).max(180),
    title: z.string().min(1).max(240),
    evidence: z.array(z.string().min(1).max(2_000)).max(30)
  }).strict()).max(12),
  findings: z.array(publicFindingSchema).max(20),
  agentReadiness: publicAgentReadinessSchema.optional(),
  visualQuality: publicVisualQualitySchema.optional(),
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
}).strict().superRefine((report, context) => {
  if (report.websiteKind === "owned_website" && !report.agentReadiness) {
    context.addIssue({
      code: "custom",
      path: ["agentReadiness"],
      message: "Owned-website reports require the canonical Agent Readiness projection."
    });
  }
  if (report.websiteKind === "owned_website" && !report.visualQuality) {
    context.addIssue({
      code: "custom",
      path: ["visualQuality"],
      message: "Owned-website reports require the canonical Visual Quality projection."
    });
  }
});

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
