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
  JobKind,
  JobRecord,
  LeadSubmission,
  OptimizationFinding,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  OutboundSummary,
  PreviewToken,
  SiteBundle,
  WorkflowDelivery
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
  createOutboundCampaign,
  getForms,
  getDomainById,
  getDomainByHostname,
  getSiteBundle,
  getSiteBundleBySlug,
  listAnalyticsEvents,
  listClaims,
  listDomains,
  listExperiments,
  listExperimentLearnings,
  listFormSubmissions,
  listOutboundCampaigns,
  listOutboundEvents,
  listOutboundProspects,
  listWorkflowDeliveries,
  listPreviewTokens,
  listSiteBundles,
  outboundSummary,
  publishDraft,
  publishVersion,
  recordAnalyticsEvent,
  recordClaimCheckoutSession,
  recordFormSubmission,
  recordOutboundEvent,
  recordWorkflowDelivery,
  registerDomain,
  restoreVersionToDraft,
  resolvePreviewToken,
  runAndStoreAudit,
  updateExperiment,
  updateFormSettings,
  updateLeadStatus,
  updateDomain,
  updateOwnerAssets,
  updateSiteDesign as updateSiteDesignStore,
  updateSectionProps,
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

export type CreateSiteInput = {
  url?: string;
  prompt?: string;
};

export type CreateSiteOptions = {
  telemetry?: AgentTelemetryRecorder;
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

export type RecordSubmissionInput = {
  siteId: string;
  formId: string;
  pageId?: string;
  visitorId?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, string | number | boolean>;
  sourceUrl?: string;
  userAgent?: string;
  ipHash?: string;
};

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

export type UpdateLeadStatusInput = {
  siteId: string;
  submissionId: string;
  status: LeadSubmission["status"];
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

export type LodestaRepository = {
  listSiteBundles(): Promise<SiteBundle[]>;
  getSiteBundle(siteId: string): Promise<SiteBundle | null>;
  getSiteBundleBySlug(slug: string): Promise<SiteBundle | null>;
  createAndStoreSite(input: CreateSiteInput, options?: CreateSiteOptions): Promise<SiteBundle>;
  createPreviewToken(input: { siteId: string; expiresAt?: string }): Promise<PreviewToken | null>;
  resolvePreviewToken(token: string): Promise<PreviewResolveResult>;
  listPreviewTokens(siteId?: string): Promise<PreviewToken[]>;
  runAndStoreAudit(siteId: string): Promise<OptimizationFinding[] | null>;
  updateSectionProps(input: UpdateSectionInput): Promise<SectionUpdateResult>;
  updateSiteDesign(input: UpdateSiteDesignInput): Promise<DesignUpdateResult>;
  publishDraft(siteId: string): Promise<PublishResult>;
  publishVersion(input: { siteId: string; versionId: string }): Promise<PublishResult>;
  restoreVersionToDraft(input: { siteId: string; versionId: string }): Promise<RestoreVersionResult>;
  updateBusinessProfile(input: BusinessProfileUpdateInput): Promise<BusinessProfileUpdateResult>;
  updateOwnerAssets(input: UpdateOwnerAssetsInput): Promise<UpdateOwnerAssetsResult | null>;
  recordFormSubmission(input: RecordSubmissionInput): Promise<LeadSubmission>;
  listFormSubmissions(siteId?: string): Promise<LeadSubmission[]>;
  updateLeadStatus(input: UpdateLeadStatusInput): Promise<LeadSubmission | null>;
  recordWorkflowDelivery(input: Omit<WorkflowDelivery, "id" | "createdAt">): Promise<WorkflowDelivery>;
  listWorkflowDeliveries(siteId?: string): Promise<WorkflowDelivery[]>;
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
  async createPreviewToken(input) {
    return createPreviewToken(input);
  },
  async resolvePreviewToken(token) {
    return resolvePreviewToken(token);
  },
  async listPreviewTokens(siteId) {
    return listPreviewTokens(siteId);
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
  async recordFormSubmission(input) {
    return recordFormSubmission(input);
  },
  async listFormSubmissions(siteId) {
    return listFormSubmissions(siteId);
  },
  async updateLeadStatus(input) {
    return updateLeadStatus(input);
  },
  async recordWorkflowDelivery(input) {
    return recordWorkflowDelivery(input);
  },
  async listWorkflowDeliveries(siteId) {
    return listWorkflowDeliveries(siteId);
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
  enqueueJob,
  listJobs,
  getJob,
  async processNextJob() {
    return processNextJobStore(createLocalJobContext());
  },
  async processAllQueuedJobs(limit) {
    return processAllQueuedJobsStore(limit, createLocalJobContext());
  },
  async createAgentRun() {
    return null;
  },
  async updateAgentRun() {
    return null;
  },
  async createAgentRunSpan() {
    return null;
  },
  async updateAgentRunSpan() {
    return null;
  },
  async recordAgentModelCall() {
    return null;
  },
  async listAgentRuns() {
    return { runs: [], total: 0 };
  },
  async getAgentRunDetail() {
    return null;
  },
  async updateAgentRunNotes() {
    return null;
  },
  async cleanupAgentTelemetry() {
    return { deleted: 0, cutoff: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString() };
  }
};

function createLocalJobContext(): JobExecutionContext {
  return {
    workerId: getProcessWorkerId(),
    createAndStoreSite: localRepository.createAndStoreSite,
    createPreviewToken: localRepository.createPreviewToken,
    getSiteBundle: localRepository.getSiteBundle,
    runAndStoreAudit: localRepository.runAndStoreAudit,
    analyticsSummary: localRepository.analyticsSummary,
    analyzeExperiments: localRepository.analyzeExperiments,
    listExperimentLearnings: (siteId) => localRepository.listExperimentLearnings({ siteId }),
    listFormSubmissions: localRepository.listFormSubmissions,
    cleanupAgentTelemetry: (input) => localRepository.cleanupAgentTelemetry(input)
  };
}

export function getRepository(): LodestaRepository {
  return supabaseRepository;
}

export const repository = getRepository();
