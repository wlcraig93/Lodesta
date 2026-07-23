export type WebsiteSetupStatus = "queued" | "processing" | "linked" | "failed" | "canceled";

export type WebsiteSetupFailureCode =
  | "website_crawl_failed"
  | "bootstrap_failed"
  | "worker_interrupted";

export type WebsiteSetup = {
  id: string;
  ownerUserId: string;
  sourceUrl: string;
  normalizedSource: string;
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

export type SitePreviewToken = {
  token: string;
  siteId: string;
  siteVersionId: string;
  expiresAt?: string;
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
  campaignId: string;
  siteId?: string;
  businessName: string;
  vertical?: string;
  sourceUrl?: string;
  previewToken?: string;
  mailingCode?: string;
  status: "queued" | "mailed" | "preview_viewed" | "adoption_started" | "adopted" | "published" | "disqualified";
  createdAt: string;
  mailedAt?: string;
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
  name: string;
  channel?: OutboundCampaign["channel"];
  status?: OutboundCampaign["status"];
  metadata?: Record<string, string | number | boolean>;
};

export type UpsertOutboundProspectInput = {
  id?: string;
  campaignId: string;
  siteId?: string;
  businessName: string;
  vertical?: string;
  sourceUrl?: string;
  previewToken?: string;
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

export type ProspectReportBucketId = "search_visibility" | "website_conversion" | "local_content_coverage" | "trust_mobile_readiness";
export type ProspectReportSignal = { id: string; label: string; passed: boolean; points: number; maxPoints: number; source: "crawl" | "render"; evidence: string };
export type ProspectReportBucket = { id: ProspectReportBucketId; label: string; score?: number; scoredSignals: number; maxPoints: number; points: number; status: "scored" | "not_enough_signal"; signals: ProspectReportSignal[] };
export type ProspectReportFinding = { id: string; bucketId: ProspectReportBucketId; bucketLabel: string; severity: "fail" | "warning"; title: string; consequence: string; evidence: string; lodestaFix: string };
export type ProspectReportStage = { id: string; label: string; status: "queued" | "running" | "completed" | "skipped" | "failed" };
export type ProspectReportGatedPlan = { summary: string; priorities: Array<{ title: string; detail: string }> };
export type ProspectPresenceReportResult = {
  version: "prospect-presence-report-v1";
  generatedAt: string;
  websiteKind: ProspectWebsiteKind;
  sourceUrl?: string;
  sourceHost?: string;
  overallScore: number;
  overallLabel: string;
  scoreSource: "crawl_standard" | "no_owned_website";
  buckets: ProspectReportBucket[];
  findings: ProspectReportFinding[];
  stages: ProspectReportStage[];
  gatedPlan: ProspectReportGatedPlan;
};
export type ProspectWebsiteKind = "owned_website" | "no_website" | "social_or_aggregator";
export type ProspectReportRecord = {
  id: string;
  placeId: string;
  status: "queued" | "running" | "completed" | "failed";
  jobId?: string;
  sourceUrl?: string;
  sourceHost?: string;
  websiteKind: ProspectWebsiteKind;
  result?: ProspectPresenceReportResult;
  unlockedAt?: string;
  leadId?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
export type ProspectReportLead = { id: string; reportId: string; email: string; contactName?: string; phone?: string; ipHash?: string; metadata?: Record<string, string | number | boolean>; createdAt: string };

export type CreateProspectReportInput = { id?: string; placeId: string; sourceUrl?: string; sourceHost?: string; websiteKind: ProspectWebsiteKind; jobId?: string };
export type UpdateProspectReportInput = { reportId: string; status?: ProspectReportRecord["status"]; jobId?: string; sourceUrl?: string; sourceHost?: string; websiteKind?: ProspectWebsiteKind; result?: ProspectPresenceReportResult; unlockedAt?: string; leadId?: string; errorCode?: string; completedAt?: string };
export type CreateProspectReportLeadInput = { reportId: string; email: string; contactName?: string; phone?: string; ipHash?: string; metadata?: Record<string, string | number | boolean> };

export type ProspectReportJob = {
  id: string;
  reportId: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedBy?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
