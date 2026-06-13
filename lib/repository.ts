import type { BusinessServiceRecord, FactCandidate } from "./business-evidence";
import type {
  AgentModelCallRecord,
  AgentRunDetail,
  AgentRunRecord,
  AgentRunSource,
  AgentRunSpanRecord,
  AgentRunStatus,
  AnalyticsEvent,
  AnalyticsSummary,
  ClaimRecord,
  DomainRecord,
  Experiment,
  ExperimentAnalysis,
  ExperimentLearning,
  FormDefinition,
  GenerationQaReadiness,
  Inquiry,
  InquiryAiEnrichment,
  InquiryDelivery,
  InquiryEvent,
  SiteArtifactRecord,
  JobKind,
  JobRecord,
  OptimizationFinding,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  OutboundSummary,
  PreviewToken,
  ProspectPresenceReportResult,
  ProspectReportLead,
  ProspectReportRecord,
  SiteBundle,
  SiteCandidateRecord,
  SiteCandidateStatus,
  SiteVersion,
} from "./models";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import type { AiEditResult } from "./ai-editor";
import type { BusinessProfileUpdateInput } from "./business-profile-update";
import type { UpdateSiteDesignInput, UpdateSiteDesignResult } from "./design";
import type { EditorGuardrailIssue } from "./editor-guardrails";
import type { UpdateFormSettingsInput, UpdateFormSettingsResult } from "./form-settings";
import type { UpdateOwnerAssetsInput, UpdateOwnerAssetsResult } from "./owner-assets";
import type { OptimizationChangeSummary } from "./optimization";
import {
  updateBusinessProfile,
  analyticsSummary,
  applyAiEditToSite,
  applyFindingToDraft,
  assignExperiment,
  concludeExperimentWithLearning,
  createAndStoreSite,
  createClaim,
  completeClaimCheckout,
  dismissFinding,
  createPreviewToken,
  createSiteCandidate as createSiteCandidateStore,
  listSiteArtifacts as listSiteArtifactsStore,
  createOutboundCampaign,
  createProspectReport as createProspectReportStore,
  createProspectReportLead as createProspectReportLeadStore,
  getForms,
  getDomainById,
  getDomainByHostname,
  getProspectReport as getProspectReportStore,
  getSiteBundle,
  getSiteBundleBySlug,
  getSiteCandidate as getSiteCandidateStore,
  updateSiteCandidateBundle as updateSiteCandidateBundleStore,
  listAnalyticsEvents,
  listClaims,
  listDomains,
  listExperiments,
  listExperimentLearnings,
  listInquiries,
  listInquiryDeliveries,
  listInquiryEvents,
  listOutboundCampaigns,
  listOutboundEvents,
  listOutboundProspects,
  listPreviewTokens,
  findActiveProspectReportByPlaceId as findActiveProspectReportByPlaceIdStore,
  findReusableProspectReportByPlaceId as findReusableProspectReportByPlaceIdStore,
  listSiteCandidates as listSiteCandidatesStore,
  listSiteBundles,
  mergeBusinesses as mergeBusinessesStore,
  outboundSummary,
  publishDraft,
  publishVersion,
  acceptSiteCandidateAsSite as acceptSiteCandidateAsSiteStore,
  acceptSiteCandidateAsVersion as acceptSiteCandidateAsVersionStore,
  recordAnalyticsEvent,
  recordClaimCheckoutSession,
  createInquiryFromForm as createInquiryFromFormStore,
  recordOutboundEvent,
  recordInquiryDelivery,
  registerDomain,
  restoreVersionToDraft,
  resolvePreviewToken,
  runAndStoreAudit,
  saveSiteVersion,
  updateExperiment,
  updateFormSettings,
  updateInquiryAiEnrichment,
  updateInquiryNotificationState,
  updateInquiryStatus,
  countRecentInquiries,
  getInquiry,
  updateDomain,
  updateOwnerAssets,
  updateProspectReport as updateProspectReportStore,
  updateSiteDesign as updateSiteDesignStore,
  updateSectionProps,
  upsertSiteArtifact as upsertSiteArtifactStore,
  replaceFactCandidates as replaceFactCandidatesStore,
  listFactCandidates as listFactCandidatesStore,
  replaceProposedBusinessServices as replaceProposedBusinessServicesStore,
  listBusinessServices as listBusinessServicesStore,
  updateBusinessService as updateBusinessServiceStore,
  upsertOutboundProspect
} from "./store";
import {
  enqueueJob,
  getJob,
  listJobs,
  processAllQueuedJobs as processAllQueuedJobsStore,
  processNextJob as processNextJobStore,
  type JobExecutionContext
} from "./jobs";
import { supabaseRepository } from "./supabase/repository";
import { createCheckoutSession, type CheckoutSessionResult } from "./billing";
import { refreshCustomHostnameStatus, registerCustomHostname, type DomainVerification } from "./domains";
import { prepareIntakeInput } from "./intake-pipeline";
import { getProcessWorkerId } from "./worker-identity";
import type {
  CreateOutboundCampaignInput,
  RecordOutboundEventInput,
  UpsertOutboundProspectInput
} from "./outbound";
import type { CreateInquiryFromFormInput, CreateInquiryFromFormResult } from "./inquiries";
import { aggregateNotificationState, executeInquiryNotificationWorkflows } from "./workflows";
import { runInquiryAiEnrichmentJob } from "./groq-inquiry-ai";

export type CreateSiteInput = {
  url?: string;
  prompt?: string;
};

export type CreateSiteOptions = {
  telemetry?: AgentTelemetryRecorder;
};

export type CreateSiteCandidateInput = {
  id?: string;
  businessId?: string;
  agentRunId?: string;
  bundle: SiteBundle;
  sourceUrl?: string;
  sourceHost?: string;
  intendedSiteId?: string;
  status?: SiteCandidateStatus;
};

export type ListSiteCandidatesFilter = {
  status?: SiteCandidateStatus;
  sourceHost?: string;
  limit?: number;
  offset?: number;
};

/**
 * Lightweight candidate listing shape for queue-style surfaces. Carries the
 * few bundle-derived facts those surfaces show (readiness, screenshot and
 * compile state) without transferring the multi-megabyte bundle itself.
 */
export type SiteCandidateSummary = {
  id: string;
  businessName: string;
  vertical: SiteCandidateRecord["vertical"];
  status: SiteCandidateStatus;
  sourceUrl?: string;
  sourceHost?: string;
  candidateSlug: string;
  acceptedSiteId?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
  readiness: GenerationQaReadiness;
  hasScreenshot: boolean;
  compiled: boolean;
};

export type ListSiteCandidateSummariesResult = {
  summaries: SiteCandidateSummary[];
  total: number;
};

export function siteCandidateSummaryFromRecord(record: SiteCandidateRecord): SiteCandidateSummary {
  const versions = record.bundle.siteModel.versions;
  const version = versions.find((candidateVersion) => candidateVersion.status === "draft") ?? versions[0];
  return {
    id: record.id,
    businessName: record.businessName,
    vertical: record.vertical,
    status: record.status,
    sourceUrl: record.sourceUrl,
    sourceHost: record.sourceHost,
    candidateSlug: record.candidateSlug,
    acceptedSiteId: record.acceptedSiteId,
    acceptedAt: record.acceptedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    readiness: version?.generationQa?.readiness ?? "unavailable",
    hasScreenshot: Boolean(version?.generationQa?.primaryScreenshot),
    compiled: Boolean(version)
  };
}

export type ListSiteCandidatesResult = {
  candidates: SiteCandidateRecord[];
  total: number;
};

export type ListSiteArtifactsFilter = {
  siteCandidateId?: string;
  siteId?: string;
  scope?: SiteArtifactRecord["scope"];
  artifactType?: SiteArtifactRecord["artifactType"];
};

export type AcceptSiteCandidateResult =
  | {
      ok: true;
      candidate: SiteCandidateRecord;
      bundle: SiteBundle;
      acceptedSiteId: string;
      acceptedVersionId?: string;
    }
  | {
      ok: false;
      reason: string;
    };

export type AcceptSiteCandidateAsVersionInput = {
  candidateId: string;
  siteId: string;
};

export type CreateAgentRunInput = {
  runType: string;
  agentType: string;
  status?: AgentRunStatus;
  actorType?: string;
  actorId?: string;
  source: AgentRunSource;
  sourceUrl?: string;
  sourceHost?: string;
  targetType?: string;
  targetId?: string;
  inputSummary?: string;
  outputSummary?: string;
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  notes?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  endedAt?: string;
};

export type UpdateAgentRunInput = {
  runId: string;
  status?: AgentRunStatus;
  targetType?: string | null;
  targetId?: string | null;
  outputSummary?: string | null;
  outputJson?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  tags?: string[];
  notes?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  endedAt?: string | null;
};

export type CreateAgentRunSpanInput = {
  runId: string;
  parentSpanId?: string;
  spanType: string;
  name: string;
  status?: AgentRunStatus;
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  artifactRefs?: Record<string, unknown>;
  errorMessage?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};

export type UpdateAgentRunSpanInput = {
  spanId: string;
  status?: AgentRunStatus;
  outputJson?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  artifactRefs?: Record<string, unknown>;
  errorMessage?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
};

export type RecordAgentModelCallInput = {
  runId: string;
  spanId?: string;
  provider: string;
  model: string;
  endpoint: string;
  operation: string;
  status: AgentRunStatus;
  requestJson?: Record<string, unknown>;
  responseJson?: Record<string, unknown>;
  usageJson?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  errorMessage?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};

export type ListAgentRunsFilter = {
  search?: string;
  status?: AgentRunStatus;
  runType?: string;
  agentType?: string;
  source?: AgentRunSource;
  sourceHost?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type ListAgentRunsResult = {
  runs: AgentRunRecord[];
  total: number;
};

export type UpdateSectionInput = {
  siteId: string;
  pageId: string;
  sectionId: string;
  props: Record<string, unknown>;
};

const localAgentRuns = new Map<string, AgentRunRecord>();
const localAgentRunSpans = new Map<string, AgentRunSpanRecord>();
const localAgentModelCalls = new Map<string, AgentModelCallRecord>();

export type CreateClaimInput = {
  siteId: string;
  ownerUserId?: string;
  ownerEmail?: string;
  verifiedFacts?: string[];
  acceptedTerms: boolean;
  acceptedManagement: boolean;
};

export type RegisterDomainInput = {
  siteId: string;
  hostname: string;
  provider?: "railway" | "cloudflare_for_saas";
  providerHostnameId?: string;
};

export type CompleteClaimCheckoutInput = {
  claimId?: string;
  siteId?: string;
  checkoutSessionId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  completedAt?: string;
};

export type UpdateInquiryStatusInput = {
  siteId: string;
  inquiryId: string;
  status: Inquiry["status"];
};

export type CreateProspectReportInput = {
  id?: string;
  placeId: string;
  sourceUrl?: string;
  sourceHost?: string;
  websiteKind: ProspectReportRecord["websiteKind"];
  jobId?: string;
};

export type UpdateProspectReportInput = {
  reportId: string;
  status?: ProspectReportRecord["status"];
  jobId?: string;
  sourceUrl?: string;
  sourceHost?: string;
  websiteKind?: ProspectReportRecord["websiteKind"];
  result?: ProspectPresenceReportResult;
  unlockedAt?: string;
  leadId?: string;
  errorCode?: string;
  completedAt?: string;
};

export type CreateProspectReportLeadInput = {
  reportId: string;
  email: string;
  contactName?: string;
  phone?: string;
  ipHash?: string;
  metadata?: Record<string, string | number | boolean>;
};

type SectionUpdateResult =
  | { ok: false; reason: string; issues?: EditorGuardrailIssue[]; qa?: unknown }
  | { ok: true; bundle: SiteBundle; guardrailWarnings?: EditorGuardrailIssue[] }
  | null;
type DesignUpdateResult = UpdateSiteDesignResult | null;
type PublishResult = { ok: false; reason: string } | { ok: true; bundle: SiteBundle } | null;
type BusinessProfileUpdateResult =
  | { ok: false; reason: string; issues?: EditorGuardrailIssue[]; qa?: unknown }
  | { ok: true; bundle: SiteBundle; guardrailWarnings?: EditorGuardrailIssue[] }
  | null;
type ExperimentAssignment =
  | { assigned: false; reason: string }
  | {
      assigned: true;
      experimentId: string;
      surface: Experiment["surface"];
      variant: Record<string, unknown>;
      primaryMetric: Experiment["primaryMetric"];
      holdout: boolean;
    };
type ApplyFindingResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      draftCreated: boolean;
      qaRequired: boolean;
      finding: OptimizationFinding;
      changeSummary: OptimizationChangeSummary;
    }
  | null;
type RestoreVersionResult =
  | { ok: false; reason: string }
  | { ok: true; bundle: SiteBundle; draftVersionId: string; restoredFromVersionId: string }
  | null;
type DismissFindingResult =
  | { ok: false; reason: string }
  | { ok: true; finding: OptimizationFinding }
  | null;
type AiEditRepositoryResult = AiEditResult | null;
type PreviewResolveResult = { token: PreviewToken; bundle: SiteBundle } | null;
type ExperimentUpdateResult = { ok: false; reason: string } | { ok: true; experiment: Experiment } | null;
type ExperimentLearningResult =
  | { ok: false; reason: string; analysis?: ExperimentAnalysis }
  | { ok: true; experiment: Experiment; learning: ExperimentLearning; analysis: ExperimentAnalysis }
  | null;
type ClaimResult = (ClaimRecord & {
  checkout: CheckoutSessionResult;
}) | null;
type DomainResult = (DomainRecord & {
  verification: DomainVerification;
}) | null;
export type BusinessMergeResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      sourceBusinessId: string;
      targetBusinessId: string;
      movedSites: number;
      movedSiteCandidates: number;
      movedLocations: number;
    };

export type LodestaRepository = {
  listSiteBundles(): Promise<SiteBundle[]>;
  getSiteBundle(siteId: string): Promise<SiteBundle | null>;
  getSiteBundleBySlug(slug: string): Promise<SiteBundle | null>;
  createAndStoreSite(input: CreateSiteInput, options?: CreateSiteOptions): Promise<SiteBundle>;
  createSiteCandidate(input: CreateSiteCandidateInput): Promise<SiteCandidateRecord>;
  listSiteCandidates(filter?: ListSiteCandidatesFilter): Promise<ListSiteCandidatesResult>;
  listSiteCandidateSummaries(filter?: ListSiteCandidatesFilter): Promise<ListSiteCandidateSummariesResult>;
  getSiteCandidate(candidateId: string): Promise<SiteCandidateRecord | null>;
  updateSiteCandidateBundle(candidateId: string, bundle: SiteBundle): Promise<SiteCandidateRecord | null>;
  acceptSiteCandidateAsSite(candidateId: string): Promise<AcceptSiteCandidateResult | null>;
  acceptSiteCandidateAsVersion(input: AcceptSiteCandidateAsVersionInput): Promise<AcceptSiteCandidateResult | null>;
  mergeBusinesses(input: { sourceBusinessId: string; targetBusinessId: string }): Promise<BusinessMergeResult>;
  upsertSiteArtifact(artifact: SiteArtifactRecord): Promise<SiteArtifactRecord>;
  replaceFactCandidates(businessId: string, candidates: FactCandidate[]): Promise<FactCandidate[]>;
  listFactCandidates(businessId: string): Promise<FactCandidate[]>;
  replaceProposedBusinessServices(businessId: string, records: BusinessServiceRecord[]): Promise<BusinessServiceRecord[]>;
  listBusinessServices(businessId: string): Promise<BusinessServiceRecord[]>;
  updateBusinessService(input: { id: string; status: "active" | "hidden" | "rejected"; confirmedBy: string }): Promise<BusinessServiceRecord | null>;
  listSiteArtifacts(filter?: ListSiteArtifactsFilter): Promise<SiteArtifactRecord[]>;
  createPreviewToken(input: { siteId: string; expiresAt?: string; versionId?: string }): Promise<PreviewToken | null>;
  resolvePreviewToken(token: string): Promise<PreviewResolveResult>;
  listPreviewTokens(siteId?: string): Promise<PreviewToken[]>;
  saveSiteVersion(input: { siteId: string; version: SiteVersion }): Promise<SiteBundle | null>;
  runAndStoreAudit(siteId: string): Promise<OptimizationFinding[] | null>;
  updateSectionProps(input: UpdateSectionInput): Promise<SectionUpdateResult>;
  updateSiteDesign(input: UpdateSiteDesignInput): Promise<DesignUpdateResult>;
  publishDraft(siteId: string): Promise<PublishResult>;
  publishVersion(input: { siteId: string; versionId: string }): Promise<PublishResult>;
  restoreVersionToDraft(input: { siteId: string; versionId: string }): Promise<RestoreVersionResult>;
  updateBusinessProfile(input: BusinessProfileUpdateInput): Promise<BusinessProfileUpdateResult>;
  updateOwnerAssets(input: UpdateOwnerAssetsInput): Promise<UpdateOwnerAssetsResult | null>;
  createInquiryFromForm(input: CreateInquiryFromFormInput): Promise<CreateInquiryFromFormResult>;
  listInquiries(siteId?: string): Promise<Inquiry[]>;
  getInquiry(siteId: string, inquiryId: string): Promise<Inquiry | null>;
  updateInquiryStatus(input: UpdateInquiryStatusInput): Promise<Inquiry | null>;
  updateInquiryNotificationState(input: { siteId: string; inquiryId: string; state: Inquiry["notificationState"] }): Promise<Inquiry | null>;
  updateInquiryAiEnrichment(input: {
    siteId: string;
    inquiryId: string;
    state: Inquiry["aiEnrichmentState"];
    enrichment?: InquiryAiEnrichment;
    error?: string;
  }): Promise<Inquiry | null>;
  listInquiryEvents(inquiryId: string): Promise<InquiryEvent[]>;
  countRecentInquiries(siteId: string, since: string): Promise<number>;
  recordInquiryDelivery(input: Omit<InquiryDelivery, "id" | "createdAt">): Promise<InquiryDelivery>;
  listInquiryDeliveries(siteId?: string): Promise<InquiryDelivery[]>;
  processInquiryNotification(input: { siteId: string; inquiryId: string }): Promise<Record<string, unknown>>;
  processInquiryAiEnrichment(input: { siteId: string; inquiryId: string }): Promise<Record<string, unknown>>;
  recordAnalyticsEvent(event: AnalyticsEvent): Promise<AnalyticsEvent>;
  listAnalyticsEvents(siteId?: string): Promise<AnalyticsEvent[]>;
  analyticsSummary(siteId: string): Promise<AnalyticsSummary>;
  assignExperiment(input: { siteId: string; sessionId: string; experimentId?: string }): Promise<ExperimentAssignment>;
  analyzeExperiments(siteId: string): Promise<ExperimentAnalysis[]>;
  listExperiments(siteId: string): Promise<Experiment[]>;
  updateExperiment(input: {
    siteId: string;
    experimentId: string;
    status: Experiment["status"];
    holdoutPercent?: number;
  }): Promise<ExperimentUpdateResult>;
  concludeExperimentWithLearning(input: { siteId: string; experimentId: string }): Promise<ExperimentLearningResult>;
  listExperimentLearnings(filter?: { siteId?: string; status?: ExperimentLearning["status"] }): Promise<ExperimentLearning[]>;
  getForms(siteId: string): Promise<FormDefinition[]>;
  updateFormSettings(input: UpdateFormSettingsInput): Promise<UpdateFormSettingsResult | null>;
  applyFindingToDraft(input: { siteId: string; findingId: string }): Promise<ApplyFindingResult>;
  dismissFinding(input: { siteId: string; findingId: string }): Promise<DismissFindingResult>;
  applyAiEdit(input: { siteId: string; message: string }): Promise<AiEditRepositoryResult>;
  createClaim(input: CreateClaimInput): Promise<ClaimResult>;
  completeClaimCheckout(input: CompleteClaimCheckoutInput): Promise<ClaimRecord | null>;
  listClaims(siteId?: string): Promise<ClaimRecord[]>;
  registerDomain(input: RegisterDomainInput): Promise<DomainResult>;
  refreshDomain(input: { domainId: string }): Promise<DomainRecord | null>;
  listDomains(siteId?: string): Promise<DomainRecord[]>;
  getDomainById(domainId: string): Promise<DomainRecord | null>;
  getDomainByHostname(hostname: string): Promise<DomainRecord | null>;
  createOutboundCampaign(input: CreateOutboundCampaignInput): Promise<OutboundCampaign>;
  listOutboundCampaigns(): Promise<OutboundCampaign[]>;
  upsertOutboundProspect(input: UpsertOutboundProspectInput): Promise<OutboundProspect>;
  listOutboundProspects(campaignId?: string): Promise<OutboundProspect[]>;
  recordOutboundEvent(input: RecordOutboundEventInput): Promise<OutboundEvent>;
  listOutboundEvents(campaignId?: string): Promise<OutboundEvent[]>;
  outboundSummary(campaignId?: string): Promise<OutboundSummary>;
  createProspectReport(input: CreateProspectReportInput): Promise<ProspectReportRecord>;
  getProspectReport(reportId: string): Promise<ProspectReportRecord | null>;
  findActiveProspectReportByPlaceId(placeId: string): Promise<ProspectReportRecord | null>;
  findReusableProspectReportByPlaceId(placeId: string, since: string): Promise<ProspectReportRecord | null>;
  updateProspectReport(input: UpdateProspectReportInput): Promise<ProspectReportRecord | null>;
  createProspectReportLead(input: CreateProspectReportLeadInput): Promise<ProspectReportLead | null>;
  enqueueJob(kind: JobKind, payload: Record<string, unknown>): Promise<JobRecord>;
  listJobs(status?: JobRecord["status"]): Promise<JobRecord[]>;
  getJob(id: string): Promise<JobRecord | null>;
  processNextJob(): Promise<JobRecord | null>;
  processAllQueuedJobs(limit?: number): Promise<JobRecord[]>;
  createAgentRun(input: CreateAgentRunInput): Promise<AgentRunRecord | null>;
  updateAgentRun(input: UpdateAgentRunInput): Promise<AgentRunRecord | null>;
  createAgentRunSpan(input: CreateAgentRunSpanInput): Promise<AgentRunSpanRecord | null>;
  updateAgentRunSpan(input: UpdateAgentRunSpanInput): Promise<AgentRunSpanRecord | null>;
  recordAgentModelCall(input: RecordAgentModelCallInput): Promise<AgentModelCallRecord | null>;
  listAgentRuns(filter?: ListAgentRunsFilter): Promise<ListAgentRunsResult>;
  getAgentRunDetail(runId: string): Promise<AgentRunDetail | null>;
  updateAgentRunNotes(input: { runId: string; notes?: string; tags?: string[] }): Promise<AgentRunRecord | null>;
  cleanupAgentTelemetry(input?: { olderThanDays?: number; limit?: number }): Promise<{ deleted: number; cutoff: string }>;
};

export const localRepository: LodestaRepository = {
  async listSiteBundles() {
    return listSiteBundles();
  },
  async getSiteBundle(siteId) {
    return getSiteBundle(siteId);
  },
  async getSiteBundleBySlug(slug) {
    return getSiteBundleBySlug(slug);
  },
  async createAndStoreSite(input, options) {
    const bundle = createAndStoreSite(await prepareIntakeInput(input, { telemetry: options?.telemetry }));
    const persistenceSpan = await options?.telemetry?.startSpan({
      spanType: "persistence",
      name: "Persist generated site",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        slug: bundle.siteModel.slug,
        businessName: bundle.businessProfile.name
      }
    });
    await persistenceSpan?.end({
      outputJson: {
        siteId: bundle.businessProfile.siteId,
        slug: bundle.siteModel.slug,
        versions: bundle.siteModel.versions.length,
        forms: bundle.extensionModel.forms.length,
        findings: bundle.optimizationFindings.length
      }
    });
    return bundle;
  },
  async createSiteCandidate(input) {
    return createSiteCandidateStore(input);
  },
  async listSiteCandidates(filter) {
    return listSiteCandidatesStore(filter);
  },
  async listSiteCandidateSummaries(filter) {
    const result = listSiteCandidatesStore(filter);
    return { summaries: result.candidates.map(siteCandidateSummaryFromRecord), total: result.total };
  },
  async getSiteCandidate(candidateId) {
    return getSiteCandidateStore(candidateId);
  },
  async updateSiteCandidateBundle(candidateId, bundle) {
    return updateSiteCandidateBundleStore(candidateId, bundle);
  },
  async acceptSiteCandidateAsSite(candidateId) {
    return acceptSiteCandidateAsSiteStore(candidateId);
  },
  async acceptSiteCandidateAsVersion(input) {
    return acceptSiteCandidateAsVersionStore(input);
  },
  async mergeBusinesses(input) {
    return mergeBusinessesStore(input);
  },
  async upsertSiteArtifact(artifact) {
    return upsertSiteArtifactStore(artifact);
  },
  async replaceFactCandidates(businessId, candidates) {
    return replaceFactCandidatesStore(businessId, candidates);
  },
  async listFactCandidates(businessId) {
    return listFactCandidatesStore(businessId);
  },
  async replaceProposedBusinessServices(businessId, records) {
    return replaceProposedBusinessServicesStore(businessId, records);
  },
  async listBusinessServices(businessId) {
    return listBusinessServicesStore(businessId);
  },
  async updateBusinessService(input) {
    return updateBusinessServiceStore(input);
  },
  async listSiteArtifacts(filter) {
    return listSiteArtifactsStore(filter);
  },
  async createPreviewToken(input) {
    return createPreviewToken(input);
  },
  async resolvePreviewToken(token) {
    return resolvePreviewToken(token);
  },
  async listPreviewTokens(siteId) {
    return listPreviewTokens(siteId);
  },
  async saveSiteVersion(input) {
    return saveSiteVersion(input);
  },
  async runAndStoreAudit(siteId) {
    return runAndStoreAudit(siteId);
  },
  async updateSectionProps(input) {
    return updateSectionProps(input);
  },
  async updateSiteDesign(input) {
    return updateSiteDesignStore(input);
  },
  async publishDraft(siteId) {
    return publishDraft(siteId);
  },
  async publishVersion(input) {
    return publishVersion(input);
  },
  async restoreVersionToDraft(input) {
    return restoreVersionToDraft(input);
  },
  async updateBusinessProfile(input) {
    return updateBusinessProfile(input);
  },
  async updateOwnerAssets(input) {
    return updateOwnerAssets(input);
  },
  async createInquiryFromForm(input) {
    const result = createInquiryFromFormStore(input);
    if (!result.duplicate) {
      await enqueueJob("inquiry_notification", { siteId: result.inquiry.siteId, inquiryId: result.inquiry.id, maxAttempts: 3 });
      await enqueueJob("inquiry_ai_enrichment", { siteId: result.inquiry.siteId, inquiryId: result.inquiry.id, maxAttempts: 3 });
    }
    return result;
  },
  async listInquiries(siteId) {
    return listInquiries(siteId);
  },
  async getInquiry(siteId, inquiryId) {
    return getInquiry(siteId, inquiryId);
  },
  async updateInquiryStatus(input) {
    return updateInquiryStatus(input);
  },
  async updateInquiryNotificationState(input) {
    return updateInquiryNotificationState(input);
  },
  async updateInquiryAiEnrichment(input) {
    return updateInquiryAiEnrichment(input);
  },
  async listInquiryEvents(inquiryId) {
    return listInquiryEvents(inquiryId);
  },
  async countRecentInquiries(siteId, since) {
    return countRecentInquiries(siteId, since);
  },
  async recordInquiryDelivery(input) {
    return recordInquiryDelivery(input);
  },
  async listInquiryDeliveries(siteId) {
    return listInquiryDeliveries(siteId);
  },
  async processInquiryNotification(input) {
    return processInquiryNotification(localRepository, input);
  },
  async processInquiryAiEnrichment(input) {
    return runInquiryAiEnrichmentJob(localRepository, input);
  },
  async recordAnalyticsEvent(event) {
    return recordAnalyticsEvent(event);
  },
  async listAnalyticsEvents(siteId) {
    return listAnalyticsEvents(siteId);
  },
  async analyticsSummary(siteId) {
    return analyticsSummary(siteId);
  },
  async assignExperiment(input) {
    return assignExperiment(input);
  },
  async analyzeExperiments(siteId) {
    const { analyzeExperiments } = await import("./experiment-analysis");
    const bundle = getSiteBundle(siteId);
    return bundle ? analyzeExperiments(bundle.experiments, listAnalyticsEvents(siteId)) : [];
  },
  async listExperiments(siteId) {
    return listExperiments(siteId);
  },
  async updateExperiment(input) {
    return updateExperiment(input);
  },
  async concludeExperimentWithLearning(input) {
    return concludeExperimentWithLearning(input);
  },
  async listExperimentLearnings(filter) {
    return listExperimentLearnings(filter);
  },
  async getForms(siteId) {
    return getForms(siteId);
  },
  async updateFormSettings(input) {
    return updateFormSettings(input);
  },
  async applyFindingToDraft(input) {
    return applyFindingToDraft(input);
  },
  async dismissFinding(input) {
    return dismissFinding(input);
  },
  async applyAiEdit(input) {
    return applyAiEditToSite(input);
  },
  async createClaim(input) {
    const claim = createClaim(input);
    const bundle = claim ? getSiteBundle(input.siteId) : null;
    if (!claim || !bundle) return null;
    const checkout = await createCheckoutSession({
      claimId: claim.id,
      siteId: input.siteId,
      siteSlug: bundle.siteModel.slug,
      siteName: bundle.businessProfile.name,
      ownerEmail: input.ownerEmail
    });
    let storedClaim: ClaimRecord = claim;
    if (checkout.sessionId) {
      const recordedClaim = recordClaimCheckoutSession(claim.id, checkout.sessionId);
      if (!recordedClaim) return null;
      storedClaim = recordedClaim;
    }
    return {
      ...storedClaim,
      stripeCheckoutSessionId: checkout.sessionId ?? claim.stripeCheckoutSessionId,
      checkout
    };
  },
  async completeClaimCheckout(input) {
    return completeClaimCheckout(input);
  },
  async listClaims(siteId) {
    return listClaims(siteId);
  },
  async registerDomain(input) {
    if (!getSiteBundle(input.siteId)) return null;
    const verification = input.provider === "railway"
      ? {
          type: "cname" as const,
          value: process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "customers.lodesta.example",
          configured: true,
          note: "Railway/manual custom domain. Configure DNS/custom domain in Railway, then traffic can resolve through the app."
        }
      : await registerCustomHostname({ hostname: input.hostname.toLowerCase() });
    const domain = registerDomain({
      ...input,
      providerHostnameId: verification.providerHostnameId,
      verification
    });
    return domain ? { ...domain, verification } : null;
  },
  async refreshDomain(input) {
    const domain = getDomainById(input.domainId);
    if (!domain) return null;
    const providerStatus = await refreshCustomHostnameStatus({
      provider: domain.provider,
      hostname: domain.hostname,
      providerHostnameId: domain.providerHostnameId,
      verification: domain.verification
    });
    return updateDomain({
      domainId: domain.id,
      status: providerStatus.status,
      verification: providerStatus.verification,
      providerHostnameId: providerStatus.verification?.providerHostnameId ?? domain.providerHostnameId
    });
  },
  async listDomains(siteId) {
    return listDomains(siteId);
  },
  async getDomainById(domainId) {
    return getDomainById(domainId);
  },
  async getDomainByHostname(hostname) {
    return getDomainByHostname(hostname);
  },
  async createOutboundCampaign(input) {
    return createOutboundCampaign(input);
  },
  async listOutboundCampaigns() {
    return listOutboundCampaigns();
  },
  async upsertOutboundProspect(input) {
    return upsertOutboundProspect(input);
  },
  async listOutboundProspects(campaignId) {
    return listOutboundProspects(campaignId);
  },
  async recordOutboundEvent(input) {
    return recordOutboundEvent(input);
  },
  async listOutboundEvents(campaignId) {
    return listOutboundEvents(campaignId);
  },
  async outboundSummary(campaignId) {
    return outboundSummary(campaignId);
  },
  async createProspectReport(input) {
    return createProspectReportStore(input);
  },
  async getProspectReport(reportId) {
    return getProspectReportStore(reportId);
  },
  async findActiveProspectReportByPlaceId(placeId) {
    return findActiveProspectReportByPlaceIdStore(placeId);
  },
  async findReusableProspectReportByPlaceId(placeId, since) {
    return findReusableProspectReportByPlaceIdStore(placeId, since);
  },
  async updateProspectReport(input) {
    return updateProspectReportStore(input);
  },
  async createProspectReportLead(input) {
    return createProspectReportLeadStore(input);
  },
  enqueueJob,
  listJobs,
  getJob,
  async processNextJob() {
    return processNextJobStore(createLocalJobContext());
  },
  async processAllQueuedJobs(limit) {
    return processAllQueuedJobsStore(limit, createLocalJobContext());
  },
  async createAgentRun(input) {
    const timestamp = new Date().toISOString();
    const run: AgentRunRecord = {
      id: `run_${crypto.randomUUID().replace(/-/g, "")}`,
      runType: input.runType,
      agentType: input.agentType,
      status: input.status ?? "running",
      actorType: input.actorType,
      actorId: input.actorId,
      source: input.source,
      sourceUrl: input.sourceUrl,
      sourceHost: input.sourceHost,
      targetType: input.targetType,
      targetId: input.targetId,
      inputSummary: input.inputSummary,
      outputSummary: input.outputSummary,
      inputJson: input.inputJson,
      outputJson: input.outputJson,
      metadata: input.metadata,
      tags: input.tags ?? [],
      notes: input.notes,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt ?? timestamp,
      endedAt: input.endedAt,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    localAgentRuns.set(run.id, run);
    return run;
  },
  async updateAgentRun(input) {
    const existing = localAgentRuns.get(input.runId);
    if (!existing) return null;
    const updated: AgentRunRecord = {
      ...existing,
      status: input.status ?? existing.status,
      targetType: input.targetType ?? existing.targetType,
      targetId: input.targetId ?? existing.targetId,
      outputSummary: input.outputSummary ?? existing.outputSummary,
      outputJson: input.outputJson ?? existing.outputJson,
      metadata: input.metadata ?? existing.metadata,
      tags: input.tags ?? existing.tags,
      notes: input.notes ?? existing.notes,
      errorCode: input.errorCode ?? existing.errorCode,
      errorMessage: input.errorMessage ?? existing.errorMessage,
      endedAt: input.endedAt ?? existing.endedAt,
      updatedAt: new Date().toISOString()
    };
    localAgentRuns.set(updated.id, updated);
    return updated;
  },
  async createAgentRunSpan(input) {
    const timestamp = new Date().toISOString();
    const span: AgentRunSpanRecord = {
      id: `span_${crypto.randomUUID().replace(/-/g, "")}`,
      runId: input.runId,
      parentSpanId: input.parentSpanId,
      spanType: input.spanType,
      name: input.name,
      status: input.status ?? "running",
      inputJson: input.inputJson,
      outputJson: input.outputJson,
      metadata: input.metadata,
      artifactRefs: input.artifactRefs,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt ?? timestamp,
      endedAt: input.endedAt,
      durationMs: input.durationMs
    };
    localAgentRunSpans.set(span.id, span);
    return span;
  },
  async updateAgentRunSpan(input) {
    const existing = localAgentRunSpans.get(input.spanId);
    if (!existing) return null;
    const updated: AgentRunSpanRecord = {
      ...existing,
      status: input.status ?? existing.status,
      outputJson: input.outputJson ?? existing.outputJson,
      metadata: input.metadata ?? existing.metadata,
      artifactRefs: input.artifactRefs ?? existing.artifactRefs,
      errorMessage: input.errorMessage ?? existing.errorMessage,
      endedAt: input.endedAt ?? existing.endedAt,
      durationMs: input.durationMs ?? existing.durationMs
    };
    localAgentRunSpans.set(updated.id, updated);
    return updated;
  },
  async recordAgentModelCall(input) {
    const timestamp = new Date().toISOString();
    const call: AgentModelCallRecord = {
      id: `model_${crypto.randomUUID().replace(/-/g, "")}`,
      runId: input.runId,
      spanId: input.spanId,
      provider: input.provider,
      model: input.model,
      endpoint: input.endpoint,
      operation: input.operation,
      status: input.status,
      requestJson: input.requestJson,
      responseJson: input.responseJson,
      usageJson: input.usageJson,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheCreationTokens: input.cacheCreationTokens,
      cacheReadTokens: input.cacheReadTokens,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt ?? timestamp,
      endedAt: input.endedAt,
      durationMs: input.durationMs
    };
    localAgentModelCalls.set(call.id, call);
    return call;
  },
  async listAgentRuns(filter = {}) {
    const search = filter.search?.toLowerCase();
    const runs = Array.from(localAgentRuns.values())
      .filter((run) => !filter.status || run.status === filter.status)
      .filter((run) => !filter.runType || run.runType === filter.runType)
      .filter((run) => !filter.agentType || run.agentType === filter.agentType)
      .filter((run) => !filter.source || run.source === filter.source)
      .filter((run) => !filter.sourceHost || run.sourceHost === filter.sourceHost)
      .filter((run) => !filter.targetType || run.targetType === filter.targetType)
      .filter((run) => !filter.targetId || run.targetId === filter.targetId)
      .filter((run) => !filter.from || run.createdAt >= filter.from)
      .filter((run) => !filter.to || run.createdAt <= filter.to)
      .filter(
        (run) =>
          !search ||
          [run.inputSummary, run.outputSummary, run.sourceUrl, run.targetName, run.targetSlug]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(search))
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? runs.length;
    return { runs: runs.slice(offset, offset + limit), total: runs.length };
  },
  async getAgentRunDetail(runId) {
    const run = localAgentRuns.get(runId);
    if (!run) return null;
    const spans = Array.from(localAgentRunSpans.values()).filter((span) => span.runId === runId);
    const modelCalls = Array.from(localAgentModelCalls.values()).filter((call) => call.runId === runId);
    const tokenTotals = tokenTotalsForModelCalls(modelCalls);
    return { run: { ...run, tokenTotals, modelCallCount: modelCalls.length }, spans, modelCalls, tokenTotals };
  },
  async updateAgentRunNotes(input) {
    const existing = localAgentRuns.get(input.runId);
    if (!existing) return null;
    const updated: AgentRunRecord = {
      ...existing,
      notes: input.notes,
      tags: input.tags ?? existing.tags,
      updatedAt: new Date().toISOString()
    };
    localAgentRuns.set(updated.id, updated);
    return updated;
  },
  async cleanupAgentTelemetry() {
    return { deleted: 0, cutoff: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString() };
  }
};

function createLocalJobContext(): JobExecutionContext {
  return {
    workerId: getProcessWorkerId(),
    generateSite: async (options) => {
      const { generateSite } = await import("./site-candidate-service");
      return generateSite({ ...options, repository: localRepository });
    },
    getSiteBundle: localRepository.getSiteBundle,
    runAndStoreAudit: localRepository.runAndStoreAudit,
    analyticsSummary: localRepository.analyticsSummary,
    analyzeExperiments: localRepository.analyzeExperiments,
    listExperimentLearnings: (siteId) => localRepository.listExperimentLearnings({ siteId }),
    listInquiries: localRepository.listInquiries,
    listInquiryEvents: localRepository.listInquiryEvents,
    processInquiryNotification: (input) => localRepository.processInquiryNotification(input),
    processInquiryAiEnrichment: (input) => localRepository.processInquiryAiEnrichment(input),
    getProspectReport: localRepository.getProspectReport,
    updateProspectReport: localRepository.updateProspectReport,
    cleanupAgentTelemetry: (input) => localRepository.cleanupAgentTelemetry(input)
  };
}

async function processInquiryNotification(
  repository: Pick<
    LodestaRepository,
    | "getSiteBundle"
    | "getInquiry"
    | "listInquiryEvents"
    | "recordInquiryDelivery"
    | "updateInquiryNotificationState"
    | "listInquiryDeliveries"
  >,
  input: { siteId: string; inquiryId: string }
) {
  const [bundle, inquiry] = await Promise.all([
    repository.getSiteBundle(input.siteId),
    repository.getInquiry(input.siteId, input.inquiryId)
  ]);
  if (!bundle || !inquiry) return { skipped: true, reason: "Inquiry or site not found." };
  if (inquiry.notificationState === "completed") return { skipped: true, reason: "Inquiry notifications already completed." };
  await repository.updateInquiryNotificationState({ siteId: input.siteId, inquiryId: input.inquiryId, state: "processing" });
  const event = (await repository.listInquiryEvents(input.inquiryId)).find((candidate) => candidate.type === "form_submission");
  const deliveries = await executeInquiryNotificationWorkflows(bundle, inquiry, event, (delivery) =>
    repository.recordInquiryDelivery(delivery)
  );
  const state = aggregateNotificationState(deliveries);
  await repository.updateInquiryNotificationState({ siteId: input.siteId, inquiryId: input.inquiryId, state });
  return {
    deliveredAt: new Date().toISOString(),
    inquiryId: input.inquiryId,
    deliveries: deliveries.length,
    notificationState: state
  };
}

function tokenTotalsForModelCalls(modelCalls: AgentModelCallRecord[]) {
  const inputTokens = modelCalls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0);
  const outputTokens = modelCalls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
  const cacheCreationTokens = modelCalls.reduce((sum, call) => sum + (call.cacheCreationTokens ?? 0), 0);
  const cacheReadTokens = modelCalls.reduce((sum, call) => sum + (call.cacheReadTokens ?? 0), 0);
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
  };
}

export function getRepository(): LodestaRepository {
  if (process.env.LODESTA_REPOSITORY === "local") return localRepository;
  return supabaseRepository;
}

export const repository = getRepository();
