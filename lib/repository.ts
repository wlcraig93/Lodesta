import type {
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
  pruneAnalyticsEvents,
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
import type {
  CreateOutboundCampaignInput,
  RecordOutboundEventInput,
  UpsertOutboundProspectInput
} from "./outbound";

export type CreateSiteInput = {
  url?: string;
  prompt?: string;
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

export type PruneAnalyticsEventsInput = {
  before: string;
  siteId?: string;
};

export type PruneAnalyticsEventsResult = {
  deleted: number;
  before: string;
  siteId?: string;
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
  createAndStoreSite(input: CreateSiteInput): Promise<SiteBundle>;
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
  pruneAnalyticsEvents(input: PruneAnalyticsEventsInput): Promise<PruneAnalyticsEventsResult>;
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
  async createAndStoreSite(input) {
    return createAndStoreSite(await prepareIntakeInput(input));
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
  async pruneAnalyticsEvents(input) {
    return pruneAnalyticsEvents(input);
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
  }
};

function createLocalJobContext(): JobExecutionContext {
  return {
    workerId: process.env.LODESTA_WORKER_ID ?? "local-worker",
    createAndStoreSite: localRepository.createAndStoreSite,
    createPreviewToken: localRepository.createPreviewToken,
    getSiteBundle: localRepository.getSiteBundle,
    runAndStoreAudit: localRepository.runAndStoreAudit,
    analyticsSummary: localRepository.analyticsSummary,
    pruneAnalyticsEvents: localRepository.pruneAnalyticsEvents,
    analyzeExperiments: localRepository.analyzeExperiments,
    listExperimentLearnings: (siteId) => localRepository.listExperimentLearnings({ siteId }),
    listFormSubmissions: localRepository.listFormSubmissions
  };
}

export function getRepository(): LodestaRepository {
  const backend = process.env.LODESTA_REPOSITORY ?? "local";
  if (backend === "supabase") return supabaseRepository;
  if (backend !== "local") throw new Error(`Unsupported LODESTA_REPOSITORY value: ${backend}`);
  return localRepository;
}

export const repository = getRepository();
