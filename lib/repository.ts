import type {
  AnalyticsEvent,
  AnalyticsSummary,
  ClaimRecord,
  DomainRecord,
  Experiment,
  ExperimentAnalysis,
  FormDefinition,
  JobKind,
  JobRecord,
  LeadSubmission,
  OptimizationFinding,
  PreviewToken,
  SiteBundle,
  WorkflowDelivery
} from "./models";
import type { AiEditResult } from "./ai-editor";
import type { BusinessProfileUpdateInput } from "./business-profile-update";
import type { UpdateSiteDesignInput, UpdateSiteDesignResult } from "./design";
import {
  updateBusinessProfile,
  analyticsSummary,
  applyAiEditToSite,
  applyFindingToDraft,
  assignExperiment,
  createAndStoreSite,
  createClaim,
  completeClaimCheckout,
  createPreviewToken,
  getForms,
  getSiteBundle,
  getSiteBundleBySlug,
  listAnalyticsEvents,
  listClaims,
  listDomains,
  listExperiments,
  listFormSubmissions,
  listWorkflowDeliveries,
  listPreviewTokens,
  listSiteBundles,
  publishDraft,
  publishVersion,
  recordAnalyticsEvent,
  recordFormSubmission,
  recordWorkflowDelivery,
  registerDomain,
  resolvePreviewToken,
  runAndStoreAudit,
  updateLeadStatus,
  updateSiteDesign as updateSiteDesignStore,
  updateSectionProps
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
import { registerCustomHostname, type DomainVerification } from "./domains";
import { crawlUrl } from "./crawler";

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

type SectionUpdateResult = { ok: false; reason: string } | { ok: true; bundle: SiteBundle } | null;
type DesignUpdateResult = UpdateSiteDesignResult | null;
type PublishResult = { ok: false; reason: string } | { ok: true; bundle: SiteBundle } | null;
type ExperimentAssignment =
  | { assigned: false; reason: string }
  | {
      assigned: true;
      experimentId: string;
      variant: Record<string, unknown>;
      primaryMetric: Experiment["primaryMetric"];
      holdout: boolean;
    };
type ApplyFindingResult =
  | { ok: false; reason: string }
  | { ok: true; draftCreated: boolean; qaRequired: boolean; finding: OptimizationFinding }
  | null;
type AiEditRepositoryResult = AiEditResult | null;
type PreviewResolveResult = { token: PreviewToken; bundle: SiteBundle } | null;
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
  updateBusinessProfile(input: BusinessProfileUpdateInput): Promise<SiteBundle | null>;
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
  getForms(siteId: string): Promise<FormDefinition[]>;
  applyFindingToDraft(input: { siteId: string; findingId: string }): Promise<ApplyFindingResult>;
  applyAiEdit(input: { siteId: string; message: string }): Promise<AiEditRepositoryResult>;
  createClaim(input: CreateClaimInput): Promise<ClaimResult>;
  completeClaimCheckout(input: CompleteClaimCheckoutInput): Promise<ClaimRecord | null>;
  listClaims(siteId?: string): Promise<ClaimRecord[]>;
  registerDomain(input: RegisterDomainInput): Promise<DomainResult>;
  listDomains(siteId?: string): Promise<DomainRecord[]>;
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
    const crawl = input.url ? await crawlUrl(input.url) : undefined;
    return createAndStoreSite({ ...input, crawl });
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
  async updateBusinessProfile(input) {
    return updateBusinessProfile(input);
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
  async getForms(siteId) {
    return getForms(siteId);
  },
  async applyFindingToDraft(input) {
    return applyFindingToDraft(input);
  },
  async applyAiEdit(input) {
    return applyAiEditToSite(input);
  },
  async createClaim(input) {
    const claim = createClaim(input);
    const bundle = claim ? getSiteBundle(input.siteId) : null;
    if (!claim || !bundle) return null;
    return {
      ...claim,
      checkout: await createCheckoutSession({
        claimId: claim.id,
        siteId: input.siteId,
        siteSlug: bundle.siteModel.slug,
        siteName: bundle.businessProfile.name,
        ownerEmail: input.ownerEmail
      })
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
    const verification = await registerCustomHostname({ hostname: input.hostname.toLowerCase() });
    const domain = registerDomain({
      ...input,
      providerHostnameId: verification.providerHostnameId,
      verification
    });
    return domain ? { ...domain, verification } : null;
  },
  async listDomains(siteId) {
    return listDomains(siteId);
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
    createAndStoreSite: localRepository.createAndStoreSite,
    createPreviewToken: localRepository.createPreviewToken,
    getSiteBundle: localRepository.getSiteBundle,
    runAndStoreAudit: localRepository.runAndStoreAudit,
    analyticsSummary: localRepository.analyticsSummary,
    analyzeExperiments: localRepository.analyzeExperiments,
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
