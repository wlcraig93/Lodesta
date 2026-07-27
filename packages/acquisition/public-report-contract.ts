import { z } from "zod";

const websiteKindSchema = z.enum(["owned_website", "no_website", "social_or_aggregator"]);
const severitySchema = z.enum(["critical", "major", "minor", "advisory"]);
const findingSchema = z.object({
  id: z.string(),
  dimension: z.string(),
  severity: severitySchema,
  status: z.enum(["fail", "warning"]),
  title: z.string(),
  explanation: z.string(),
  businessConsequence: z.string(),
  evidence: z.array(z.string()),
  recommendation: z.string()
}).strict();
const strengthSchema = z.object({
  id: z.string(),
  dimension: z.string(),
  title: z.string(),
  evidence: z.array(z.string())
}).strict();
const evidenceCoverageSchema = z.object({
  value: z.number(),
  assessedChecks: z.number(),
  applicableChecks: z.number(),
  limitations: z.array(z.string())
}).strict();
const siteUnderstandingSchema = z.object({
  businessName: z.string().optional(),
  primaryLocation: z.string().optional(),
  services: z.array(z.string()),
  customerJourneys: z.array(z.string())
}).strict();

export const publicProspectReportResultSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("prospect-presence-report"),
  generatedAt: z.string(),
  websiteKind: websiteKindSchema,
  sourceUrl: z.string().optional(),
  sourceHost: z.string().optional(),
  assessmentId: z.string().optional(),
  coverage: z.object({
    value: z.number(),
    assessedCriteria: z.number(),
    applicableCriteria: z.number(),
    limitations: z.array(z.string())
  }).strict().optional(),
  siteUnderstanding: siteUnderstandingSchema,
  whatsWorking: z.array(strengthSchema),
  findings: z.array(findingSchema),
  agentReadiness: z.object({
    methodologyIdentity: z.string(),
    coverage: evidenceCoverageSchema,
    verified: z.array(z.object({
      id: z.string(),
      group: z.string(),
      title: z.string(),
      evidence: z.array(z.string())
    }).strict()),
    findings: z.array(findingSchema.extend({
      authority: z.enum(["cloudflare", "lodesta"]),
      countedByAuthority: z.boolean()
    }).strict()),
    note: z.string()
  }).strict().optional(),
  visualQuality: z.object({
    methodologyIdentity: z.string(),
    coverage: evidenceCoverageSchema,
    strengths: z.array(z.object({
      id: z.string(),
      group: z.string(),
      title: z.string(),
      evidence: z.array(z.string())
    }).strict()),
    findings: z.array(findingSchema),
    note: z.string()
  }).strict().optional(),
  stages: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(["queued", "running", "completed", "skipped", "failed"])
  }).strict()),
  gatedPlan: z.object({
    summary: z.string(),
    priorities: z.array(z.object({
      title: z.string(),
      detail: z.string()
    }).strict())
  }).strict()
}).strict();

export const publicProspectReportTeaserSchema = z.object({
  siteUnderstanding: siteUnderstandingSchema,
  strength: strengthSchema.optional(),
  finding: findingSchema.optional(),
  limitations: z.array(z.string()),
  additionalFindingCount: z.number().int().nonnegative(),
  planAvailable: z.boolean(),
  maintenanceMessage: z.string().optional()
}).strict();

export const publicProspectReportSchema = z.object({
  id: z.string().regex(/^prospect_report_[a-f0-9]{32}$/i),
  status: z.enum(["queued", "running", "completed", "failed"]),
  websiteKind: websiteKindSchema,
  sourceUrl: z.string().optional(),
  sourceHost: z.string().optional(),
  access: z.object({
    policy: z.enum(["email_gate", "public_link"]),
    granted: z.boolean()
  }).strict(),
  teaser: publicProspectReportTeaserSchema.optional(),
  result: publicProspectReportResultSchema.optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional()
}).strict();

export const prospectReportResponseSchema = z.object({
  error: z.string().optional(),
  report: publicProspectReportSchema.optional(),
  reused: z.boolean().optional(),
  ignored: z.boolean().optional()
}).strict();

export const prospectReportLeadResponseSchema = z.object({
  error: z.string().optional(),
  accepted: z.boolean().optional(),
  ignored: z.boolean().optional(),
  report: publicProspectReportSchema.optional(),
  emailDelivery: z.object({
    status: z.enum(["sent", "skipped", "failed"]),
    message: z.string()
  }).strict().optional()
}).strict();

export type PublicProspectReport = z.infer<typeof publicProspectReportSchema>;
export type PublicProspectReportResult = z.infer<typeof publicProspectReportResultSchema>;
export type PublicProspectReportTeaser = z.infer<typeof publicProspectReportTeaserSchema>;
