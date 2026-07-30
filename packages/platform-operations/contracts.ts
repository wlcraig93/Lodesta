export type WebsiteSetupStatus = "queued" | "processing" | "linked" | "failed" | "canceled";

export type WebsiteSetupFailureCode =
  | "source_invalid"
  | "source_unsuitable"
  | "crawl_temporarily_unavailable"
  | "crawl_robots_disallowed"
  | "crawl_unsupported_content"
  | "crawl_primary_unavailable"
  | "bootstrap_failed"
  | "worker_interrupted";

export type WebsiteSetup = {
  id: string;
  ownerUserId: string;
  sourceUrl: string;
  normalizedSource: string;
  reportingTimezone: string;
  prospectReportId?: string;
  sourceRevision: number;
  status: WebsiteSetupStatus;
  siteId?: string;
  sessionId?: string;
  runId?: string;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  creationRequestHash: string;
  lockedBy?: string;
  lockedAt?: string;
  failureCode?: WebsiteSetupFailureCode;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateWebsiteSetupInput = {
  ownerUserId: string;
  sourceUrl: string;
  normalizedSource: string;
  reportingTimezone: string;
  prospectReportId?: string;
  idempotencyKey: string;
  creationRequestHash: string;
};

export type WebsiteSetupSourceUpdate = {
  setupId: string;
  ownerUserId: string;
  sourceUrl: string;
  normalizedSource: string;
};

export type AdoptionInvitation = {
  id: string;
  siteId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
  consumedByUserId?: string;
};

export type DomainRecord = {
  id: string;
  siteId: string;
  hostname: string;
  status: "pending_verification" | "provisioning" | "active" | "attention_required" | "expired" | "conflict";
  ownershipProofStatus: "pending" | "verified";
  routingStatus: "pending" | "active";
  providerStatus: "pending" | "active" | "invalid";
  certificateStatus: "pending" | "active" | "invalid";
  verificationName: string;
  verificationValue: string;
  routingName: string;
  routingTarget: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  providerHostnameId?: string;
  ownershipVerifiedAt?: string;
  activatedAt?: string;
  attentionRequiredAt?: string;
  providerInvalidCount: number;
  firstProviderInvalidAt?: string;
  lastProviderInvalidAt?: string;
  executionFailureCount: number;
  lastExecutionError?: string;
};

export type RegisterDomainInput = {
  siteId: string;
  hostname: string;
};

export type SiteRedirectRule = {
  id: string;
  siteId: string;
  sourcePath: string;
  destinationPath: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type UpsertSiteRedirectInput = {
  siteId: string;
  sourcePath: string;
  destinationPath: string;
};

export function validateSiteRedirectInput(input: UpsertSiteRedirectInput, publishedRoutes: string[]) {
  const sourcePath = normalizeSiteRedirectPath(input.sourcePath);
  const destinationPath = normalizeSiteRedirectPath(input.destinationPath);
  const routes = new Set(publishedRoutes.map(normalizeSiteRedirectPath));
  if (sourcePath === "/") throw new Error("The homepage cannot be a redirect source.");
  if (sourcePath === destinationPath) throw new Error("A redirect cannot point to itself.");
  if (routes.has(sourcePath)) throw new Error("The redirect source is still a live page.");
  if (!routes.has(destinationPath)) throw new Error("The redirect destination must be a live published page.");
  return { ...input, sourcePath, destinationPath };
}

export function normalizeSiteRedirectPath(input: string) {
  const value = input.trim();
  if (!value || value.length > 512 || value.includes("?") || value.includes("#") || value.includes("\\") || /%2f|%5c|%2e/i.test(value)) {
    throw new Error("Redirect paths must be plain internal paths without queries, fragments, or encoded separators.");
  }
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/$/, "") : withLeadingSlash;
  if (normalized !== "/" && !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(normalized)) {
    throw new Error("Redirect paths must use lowercase URL slugs.");
  }
  return normalized;
}

export function redirectsStrandedByRoutes(redirects: SiteRedirectRule[], publishedRoutes: string[]) {
  const routes = new Set(publishedRoutes.map(normalizeSiteRedirectPath));
  return redirects.filter((redirect) => redirect.status === "active" && !routes.has(redirect.sourcePath) && !routes.has(redirect.destinationPath));
}

export type SitePreviewGrant = {
  id: string;
  siteId: string;
  siteVersionId: string;
  secretHash: string;
  keyVersion: string;
  secretVersion: number;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
};

export type OutboundCampaign = {
  id: string;
  name: string;
  channel: "direct_mail" | "email" | "phone" | "manual";
  status: "draft" | "running" | "paused" | "completed";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type OutboundProspect = {
  id: string;
  prospectId: string;
  selectionObservationId: string;
  campaignId: string;
  siteId?: string;
  reportId?: string;
  businessName: string;
  vertical?: string;
  sourceUrl?: string;
  previewId?: string;
  mailingCode?: string;
  status: "queued" | "mailed" | "preview_viewed" | "adoption_started" | "adopted" | "published" | "disqualified";
  createdAt: string;
  mailedAt?: string;
  firstReportViewedAt?: string;
  firstPreviewViewedAt?: string;
  adoptionStartedAt?: string;
  adoptedAt?: string;
  publishedAt?: string;
  disqualifiedAt?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type OutboundEvent = {
  id: string;
  campaignId: string;
  prospectId?: string;
  siteId?: string;
  type:
    | "mailer_sent"
    | "report_viewed"
    | "invitation_opened"
    | "preview_viewed"
    | "picker_interaction"
    | "adoption_started"
    | "adoption_completed"
    | "published"
    | "support_contact"
    | "disqualified"
    | "credibility_feedback";
  occurredAt: string;
  value?: number;
  metadata?: Record<string, string | number | boolean>;
};

export type OutboundSummary = {
  campaignId?: string;
  campaigns: number;
  prospects: number;
  mailed: number;
  reportViewed: number;
  invitationOpened: number;
  previewViewed: number;
  pickerInteractions: number;
  adoptionsStarted: number;
  adopted: number;
  published: number;
  disqualified: number;
  supportContacts: number;
  credibilityFeedbackCount: number;
  avgCredibilityScore?: number;
  mailerToPreviewRate: number;
  mailerToReportRate: number;
  mailerToAdoptionRate: number;
  invitationToAdoptionRate: number;
  adoptionToPublishRate: number;
  supportBurdenRate: number;
  verticalBreakdown: Array<{
    vertical: string;
    prospects: number;
    invitationOpened: number;
    adopted: number;
    published: number;
    invitationToAdoptionRate: number;
    mailerToAdoptionRate: number;
  }>;
};

export type CreateOutboundCampaignInput = {
  id?: string;
  name: string;
  channel?: OutboundCampaign["channel"];
  status?: OutboundCampaign["status"];
  metadata?: Record<string, string | number | boolean>;
};

export type UpsertOutboundProspectInput = {
  id?: string;
  prospectId: string;
  selectionObservationId: string;
  campaignId: string;
  siteId?: string;
  reportId?: string;
  previewId?: string;
  mailingCode?: string;
  status?: OutboundProspect["status"];
  metadata?: Record<string, string | number | boolean>;
};

export type RecordOutboundEventInput = {
  campaignId: string;
  prospectId?: string;
  siteId?: string;
  type: OutboundEvent["type"];
  value?: number;
  metadata?: Record<string, string | number | boolean>;
  occurredAt?: string;
};

export type ProspectReportFinding = {
  id: string;
  dimension: string;
  severity: "critical" | "major" | "minor" | "advisory";
  status: "fail" | "warning";
  title: string;
  explanation: string;
  businessConsequence: string;
  evidence: string[];
  recommendation: string;
};
export type ProspectReportAgentReadiness = {
  methodologyIdentity: string;
  coverage: {
    value: number;
    assessedChecks: number;
    applicableChecks: number;
    limitations: string[];
  };
  verified: Array<{
    id: string;
    group: string;
    title: string;
    evidence: string[];
  }>;
  findings: Array<ProspectReportFinding & {
    authority: "cloudflare" | "lodesta";
    countedByAuthority: boolean;
  }>;
  note: string;
};
export type ProspectReportVisualQuality = {
  methodologyIdentity: string;
  coverage: {
    value: number;
    assessedChecks: number;
    applicableChecks: number;
    limitations: string[];
  };
  strengths: Array<{
    id: string;
    group: string;
    title: string;
    evidence: string[];
  }>;
  findings: ProspectReportFinding[];
  note: string;
};
export type BusinessStrengthSignal = {
  id: string;
  label: string;
  status: "strong" | "moderate" | "limited" | "unknown";
  score: number;
  weight: number;
  value?: number;
  explanation: string;
  source: "web_research" | "verified_business_state";
};
export type BusinessStrengthAssessment = {
  schemaVersion: 1;
  kind: "business-strength";
  generatedAt: string;
  source: BusinessStrengthSignal["source"];
  coverage: number;
  score?: number;
  tier?: "high" | "moderate" | "limited";
  signals: BusinessStrengthSignal[];
  limitations: string[];
};
export type ProspectReportStage = { id: string; label: string; status: "queued" | "running" | "completed" | "skipped" | "failed" };
export type ProspectReportGatedPlan = { summary: string; priorities: Array<{ title: string; detail: string }> };
export type ProspectReportAccessPolicy = "email_gate" | "public_link";
export type ProspectPresenceReportResult = {
  schemaVersion: 1;
  kind: "prospect-presence-report";
  generatedAt: string;
  websiteKind: ProspectWebsiteKind;
  sourceUrl?: string;
  sourceHost?: string;
  assessmentId?: string;
  coverage?: {
    value: number;
    assessedCriteria: number;
    applicableCriteria: number;
    limitations: string[];
  };
  siteUnderstanding: {
    businessName?: string;
    primaryLocation?: string;
    services: string[];
    customerJourneys: string[];
  };
  whatsWorking: Array<{ id: string; dimension: string; title: string; evidence: string[] }>;
  findings: ProspectReportFinding[];
  agentReadiness?: ProspectReportAgentReadiness;
  visualQuality?: ProspectReportVisualQuality;
  stages: ProspectReportStage[];
  gatedPlan: ProspectReportGatedPlan;
};
export type ProspectWebsiteKind = "owned_website" | "no_website" | "social_or_aggregator";
export type ProspectReportRecord = {
  id: string;
  sourceKey: string;
  accessPolicy: ProspectReportAccessPolicy;
  status: "queued" | "running" | "completed" | "failed";
  assessmentId?: string;
  sourceUrl?: string;
  sourceHost?: string;
  websiteKind: ProspectWebsiteKind;
  result?: ProspectPresenceReportResult;
  businessStrength?: BusinessStrengthAssessment;
  errorCode?: string;
  resolutionUsage?: {
    modelId: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    searchCalls: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
export type ProspectReportLead = { id: string; reportId: string; email: string; contactName?: string; phone?: string; ipHash?: string; metadata?: Record<string, string | number | boolean>; createdAt: string };
export type ProspectReportAccessGrant = {
  id: string;
  reportId: string;
  leadId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type CreateProspectReportInput = { id?: string; sourceKey: string; accessPolicy: ProspectReportAccessPolicy; sourceUrl?: string; sourceHost?: string; websiteKind: ProspectWebsiteKind; assessmentId?: string; businessStrength?: BusinessStrengthAssessment; resolutionUsage?: ProspectReportRecord["resolutionUsage"] };
export type UpdateProspectReportInput = { reportId: string; status?: ProspectReportRecord["status"]; accessPolicy?: ProspectReportAccessPolicy; assessmentId?: string; sourceUrl?: string; sourceHost?: string; websiteKind?: ProspectWebsiteKind; result?: ProspectPresenceReportResult; errorCode?: string; clearError?: boolean; completedAt?: string };
export type CreateProspectReportLeadInput = { reportId: string; email: string; contactName?: string; phone?: string; ipHash?: string; metadata?: Record<string, string | number | boolean> };

export type WebsiteAssessmentRecord = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  targetKind: WebsiteAssessmentTargetKind;
  sourceKey: string;
  sourceUrl?: string;
  siteId?: string;
  artifactId?: string;
  versionId?: string;
  rubricIdentity: string;
  scannerIdentity: string;
  assessment?: WebsiteAssessment;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CreateWebsiteAssessmentInput = {
  id?: string;
  targetKind: WebsiteAssessmentTargetKind;
  sourceKey: string;
  sourceUrl?: string;
  siteId?: string;
  artifactId?: string;
  versionId?: string;
  rubricIdentity: string;
  scannerIdentity: string;
};

export type UpdateWebsiteAssessmentInput = {
  assessmentId: string;
  status?: WebsiteAssessmentRecord["status"];
  assessment?: WebsiteAssessment;
  errorCode?: string;
  clearError?: boolean;
  completedAt?: string;
};

export type WebsiteAssessmentJob = {
  id: string;
  assessmentId: string;
  prospectReportId?: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedBy?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
import type { WebsiteAssessment, WebsiteAssessmentTargetKind } from "@/packages/website-assessment/contracts";
