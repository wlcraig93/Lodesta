import type {
  AnalyticsEvent,
  ClaimRecord,
  DomainRecord,
  Experiment,
  ExperimentLearning,
  FormDefinition,
  LeadSubmission,
  OptimizationFinding,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  PreviewToken,
  SiteBundle,
  WorkflowDelivery
} from "./models";
import { runAudit } from "./audit";
import { createSiteFromInput } from "./intake";
import { applySuggestedEdit, preserveFindingLifecycle } from "./optimization";
import { sampleSiteBundle } from "./sample-data";
import { summarizeAnalytics } from "./analytics";
import { mergeFindings, recommendFromAnalytics } from "./analytics-insights";
import { analyzeExperiment } from "./experiment-analysis";
import { createExperimentLearning } from "./experiment-learning";
import { applyAiEditToBundle } from "./ai-editor";
import { validateBusinessProfileUpdate, validateSectionUpdate } from "./editor-guardrails";
import { updateSiteDesignBundle, type UpdateSiteDesignInput } from "./design";
import { applySiteIdentity, makeUniqueSlug } from "./site-identity";
import { applyVerifiedFacts } from "./fact-verification";
import { applyBusinessProfileUpdate, type BusinessProfileUpdateInput } from "./business-profile-update";
import { applyFormSettingsUpdate, type UpdateFormSettingsInput } from "./form-settings";
import { applyOwnerAssetsUpdate, type UpdateOwnerAssetsInput } from "./owner-assets";
import { restoreVersionToDraftBundle } from "./site-versions";
import { sanitizeAnalyticsMetadata } from "./privacy";
import {
  applyOutboundEventToProspect,
  newOutboundCampaign,
  newOutboundEvent,
  newOutboundProspect,
  summarizeOutbound,
  type CreateOutboundCampaignInput,
  type RecordOutboundEventInput,
  type UpsertOutboundProspectInput
} from "./outbound";

type StoreState = {
  bundles: Map<string, SiteBundle>;
  slugToSiteId: Map<string, string>;
  submissions: LeadSubmission[];
  analyticsEvents: AnalyticsEvent[];
  claims: ClaimRecord[];
  domains: DomainRecord[];
  previewTokens: PreviewToken[];
  workflowDeliveries: WorkflowDelivery[];
  outboundCampaigns: OutboundCampaign[];
  outboundProspects: OutboundProspect[];
  outboundEvents: OutboundEvent[];
  experimentLearnings: ExperimentLearning[];
};

const globalStore = globalThis as typeof globalThis & {
  __lodestaStore?: StoreState;
};

function createInitialState(): StoreState {
  const bundles = new Map<string, SiteBundle>();
  const slugToSiteId = new Map<string, string>();
  bundles.set(sampleSiteBundle.businessProfile.siteId, structuredClone(sampleSiteBundle));
  slugToSiteId.set(sampleSiteBundle.siteModel.slug, sampleSiteBundle.businessProfile.siteId);
  return {
    bundles,
    slugToSiteId,
    submissions: [],
    analyticsEvents: [],
    workflowDeliveries: [],
    outboundCampaigns: [],
    outboundProspects: [],
    outboundEvents: [],
    experimentLearnings: [],
    claims: [],
    previewTokens: [
      {
        token: "demo-token",
        siteId: sampleSiteBundle.businessProfile.siteId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        createdAt: new Date().toISOString()
      }
    ],
    domains: [
      {
        id: "domain_joes_platform",
        siteId: sampleSiteBundle.businessProfile.siteId,
        hostname: `app.local/${sampleSiteBundle.siteModel.slug}`,
        kind: "platform_slug",
        status: "active",
        provider: "railway",
        createdAt: new Date().toISOString()
      }
    ]
  };
}

function state() {
  globalStore.__lodestaStore ??= createInitialState();
  globalStore.__lodestaStore.claims ??= [];
  globalStore.__lodestaStore.domains ??= [];
  globalStore.__lodestaStore.previewTokens ??= [];
  globalStore.__lodestaStore.workflowDeliveries ??= [];
  globalStore.__lodestaStore.outboundCampaigns ??= [];
  globalStore.__lodestaStore.outboundProspects ??= [];
  globalStore.__lodestaStore.outboundEvents ??= [];
  globalStore.__lodestaStore.experimentLearnings ??= [];
  return globalStore.__lodestaStore;
}

export function listSiteBundles() {
  return Array.from(state().bundles.values());
}

export function getSiteBundle(siteId: string) {
  return state().bundles.get(siteId) ?? null;
}

export function getSiteBundleBySlug(slug: string) {
  const siteId = state().slugToSiteId.get(slug);
  return siteId ? getSiteBundle(siteId) : null;
}

export function createAndStoreSite(input: Parameters<typeof createSiteFromInput>[0]) {
  const bundle = createSiteFromInput({ ...input, experimentLearnings: listExperimentLearnings({ status: "active" }) });
  const store = state();
  applySiteIdentity(bundle, makeUniqueSlug(bundle.siteModel.slug, store.slugToSiteId.keys()));
  store.bundles.set(bundle.businessProfile.siteId, bundle);
  store.slugToSiteId.set(bundle.siteModel.slug, bundle.businessProfile.siteId);
  return bundle;
}

export function createPreviewToken(input: { siteId: string; expiresAt?: string }) {
  if (!getSiteBundle(input.siteId)) return null;
  const previewToken: PreviewToken = {
    token: `preview_${crypto.randomUUID().replace(/-/g, "")}`,
    siteId: input.siteId,
    expiresAt: input.expiresAt,
    createdAt: new Date().toISOString()
  };
  state().previewTokens.push(previewToken);
  return previewToken;
}

export function resolvePreviewToken(token: string) {
  const previewToken = state().previewTokens.find((candidate) => candidate.token === token);
  if (!previewToken) return null;
  if (previewToken.expiresAt && new Date(previewToken.expiresAt).getTime() < Date.now()) return null;
  const bundle = getSiteBundle(previewToken.siteId);
  return bundle ? { token: previewToken, bundle } : null;
}

export function listPreviewTokens(siteId?: string) {
  return state()
    .previewTokens.filter((previewToken) => !siteId || previewToken.siteId === siteId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function runAndStoreAudit(siteId: string) {
  const bundle = getSiteBundle(siteId);
  if (!bundle) return null;
  bundle.optimizationFindings = preserveFindingLifecycle(
    buildOptimizationFindings(bundle),
    bundle.optimizationFindings
  );
  return bundle.optimizationFindings;
}

export function updateSectionProps(input: {
  siteId: string;
  pageId: string;
  sectionId: string;
  props: Record<string, unknown>;
}) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const guardrails = validateSectionUpdate(bundle, input);
  if (!guardrails.ok) {
    return {
      ok: false as const,
      reason: guardrails.reason,
      issues: guardrails.issues,
      qa: guardrails.qa
    };
  }

  const draftVersion =
    bundle.siteModel.versions.find((version) => version.status === "draft") ??
    clonePublishedAsDraft(bundle);
  const page = draftVersion.pages.find((candidate) => candidate.id === input.pageId);
  const section = page?.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) return null;

  for (const [key, value] of Object.entries(input.props)) {
    const policy = section.fieldPolicies[key];
    if (!policy || (policy.editScope !== "owner_choice" && policy.editScope !== "owner_freetext")) {
      return {
        ok: false as const,
        reason: `Field ${key} is not editable by owner controls.`
      };
    }
    section.props[key] = value;
  }

  bundle.optimizationFindings = buildOptimizationFindings(bundle);
  return {
    ok: true as const,
    bundle,
    guardrailWarnings: guardrails.warnings
  };
}

export function updateSiteDesign(input: UpdateSiteDesignInput) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  return updateSiteDesignBundle(bundle, input);
}

export function publishDraft(siteId: string) {
  const bundle = getSiteBundle(siteId);
  if (!bundle) return null;
  const draft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (!draft) return { ok: false as const, reason: "No draft version exists." };
  return publishVersion({ siteId, versionId: draft.id });
}

export function publishVersion(input: { siteId: string; versionId: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const target = bundle.siteModel.versions.find((version) => version.id === input.versionId);
  if (!target) return { ok: false as const, reason: "Version not found." };
  for (const version of bundle.siteModel.versions) {
    if (version.status === "published") version.status = "draft";
  }
  target.status = "published";
  if (target.theme) bundle.siteModel.theme = structuredClone(target.theme);
  bundle.optimizationFindings = buildOptimizationFindings(bundle);
  return { ok: true as const, bundle };
}

export function restoreVersionToDraft(input: { siteId: string; versionId: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const result = restoreVersionToDraftBundle(bundle, { versionId: input.versionId });
  if (!result.ok) return result;
  bundle.optimizationFindings = buildOptimizationFindings(bundle);
  return result;
}

export function updateBusinessProfile(input: BusinessProfileUpdateInput) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const guardrails = validateBusinessProfileUpdate(bundle, input);
  if (!guardrails.ok) {
    return {
      ok: false as const,
      reason: guardrails.reason,
      issues: guardrails.issues,
      qa: guardrails.qa
    };
  }
  return {
    ok: true as const,
    bundle: applyBusinessProfileUpdate(bundle, input),
    guardrailWarnings: guardrails.warnings
  };
}

export function updateOwnerAssets(input: UpdateOwnerAssetsInput) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  return applyOwnerAssetsUpdate(bundle, input);
}

export function recordFormSubmission(input: {
  siteId: string;
  formId: string;
  pageId?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, string | number | boolean>;
  sourceUrl?: string;
  userAgent?: string;
  ipHash?: string;
}) {
  const submission: LeadSubmission = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    formId: input.formId,
    pageId: input.pageId,
    payload: input.payload,
    metadata: input.metadata,
    submittedAt: new Date().toISOString(),
    sourceUrl: input.sourceUrl,
    userAgent: input.userAgent,
    ipHash: input.ipHash,
    status: "new"
  };
  state().submissions.push(submission);
  return submission;
}

export function listFormSubmissions(siteId?: string) {
  return state().submissions.filter((submission) => !siteId || submission.siteId === siteId);
}

export function updateLeadStatus(input: { siteId: string; submissionId: string; status: LeadSubmission["status"] }) {
  const submission = state().submissions.find(
    (candidate) => candidate.siteId === input.siteId && candidate.id === input.submissionId
  );
  if (!submission) return null;
  submission.status = input.status;
  return submission;
}

export function recordWorkflowDelivery(input: Omit<WorkflowDelivery, "id" | "createdAt">) {
  const delivery: WorkflowDelivery = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };
  state().workflowDeliveries.push(delivery);
  return delivery;
}

export function listWorkflowDeliveries(siteId?: string) {
  return state()
    .workflowDeliveries.filter((delivery) => !siteId || delivery.siteId === siteId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function recordAnalyticsEvent(event: AnalyticsEvent) {
  const sanitized: AnalyticsEvent = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    metadata: sanitizeMetadata(event.metadata)
  };
  state().analyticsEvents.push(sanitized);
  return sanitized;
}

export function listAnalyticsEvents(siteId?: string) {
  return state().analyticsEvents.filter((event) => !siteId || event.siteId === siteId);
}

export function analyticsSummary(siteId: string) {
  return summarizeAnalytics(siteId, listAnalyticsEvents(siteId));
}

function buildOptimizationFindings(bundle: SiteBundle) {
  const nextFindings = mergeFindings(
    runAudit(bundle.businessProfile, bundle.siteModel),
    recommendFromAnalytics(bundle, analyticsSummary(bundle.businessProfile.siteId))
  );
  return preserveFindingLifecycle(nextFindings, bundle.optimizationFindings);
}

export function assignExperiment(input: { siteId: string; sessionId: string; experimentId?: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return { assigned: false as const, reason: "Unknown site" };
  const experiment = input.experimentId
    ? bundle.experiments.find((candidate) => candidate.id === input.experimentId)
    : bundle.experiments.find((candidate) => candidate.status === "running");
  if (!experiment) return { assigned: false as const, reason: "No running experiment" };
  if (experiment.status !== "running") return { assigned: false as const, reason: "Experiment is not opted in." };
  const hash = hashString(`${input.siteId}:${input.sessionId}:${experiment.id}`);
  const holdoutPercent = clampHoldout(experiment.holdoutPercent);
  const bucket = (hash % 10000) / 10000;
  const control = experiment.variants.find((variant) => String(variant.id ?? "") === "control") ?? experiment.variants[0];
  const treatmentVariants = experiment.variants.filter((variant) => String(variant.id ?? "") !== String(control?.id ?? ""));
  const holdout = Boolean(control && holdoutPercent > 0 && bucket < holdoutPercent);
  const learnedDefaults = treatmentVariants.filter((variant) => variant.learnedDefault === true);
  const availableVariants = holdout
    ? [control]
    : learnedDefaults.length
      ? learnedDefaults
      : treatmentVariants.length
        ? treatmentVariants
        : experiment.variants;
  const variant = availableVariants[hash % availableVariants.length];
  return {
    assigned: true as const,
    experimentId: experiment.id,
    surface: experiment.surface,
    primaryMetric: experiment.primaryMetric,
    holdout,
    variant
  };
}

export function listExperiments(siteId: string): Experiment[] {
  return getSiteBundle(siteId)?.experiments ?? [];
}

export function listExperimentLearnings(filter: { siteId?: string; status?: ExperimentLearning["status"] } = {}) {
  return state()
    .experimentLearnings.filter(
      (learning) => (!filter.siteId || learning.siteId === filter.siteId) && (!filter.status || learning.status === filter.status)
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function updateExperiment(input: {
  siteId: string;
  experimentId: string;
  status: Experiment["status"];
  holdoutPercent?: number;
}) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const experiment = bundle.experiments.find((candidate) => candidate.id === input.experimentId);
  if (!experiment) return { ok: false as const, reason: "Experiment not found." };

  const now = new Date().toISOString();
  experiment.status = input.status;
  experiment.updatedAt = now;
  if (typeof input.holdoutPercent === "number") experiment.holdoutPercent = clampHoldout(input.holdoutPercent);

  if (input.status === "running") {
    experiment.startedAt ??= now;
    experiment.rolledBackAt = undefined;
  }
  if (input.status === "concluded") experiment.concludedAt = now;
  if (input.status === "rolled_back") {
    experiment.rolledBackAt = now;
    rollbackExperimentLearnings(input.experimentId, now);
  }

  return { ok: true as const, experiment };
}

export function concludeExperimentWithLearning(input: { siteId: string; experimentId: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const experiment = bundle.experiments.find((candidate) => candidate.id === input.experimentId);
  if (!experiment) return { ok: false as const, reason: "Experiment not found." };
  const analysis = analyzeExperiment(experiment, listAnalyticsEvents(input.siteId));
  const createdAt = new Date().toISOString();
  const learningResult = createExperimentLearning({ siteId: input.siteId, experiment, analysis, createdAt });
  if (!learningResult.ok) return learningResult;

  experiment.status = "concluded";
  experiment.concludedAt = createdAt;
  experiment.updatedAt = createdAt;
  const existingIndex = state().experimentLearnings.findIndex((learning) => learning.id === learningResult.learning.id);
  if (existingIndex >= 0) state().experimentLearnings[existingIndex] = learningResult.learning;
  else state().experimentLearnings.push(learningResult.learning);
  bundle.experimentLearnings = listExperimentLearnings({ siteId: input.siteId });
  return { ok: true as const, experiment, learning: learningResult.learning, analysis };
}

function rollbackExperimentLearnings(experimentId: string, rolledBackAt: string) {
  for (const learning of state().experimentLearnings) {
    if (learning.experimentId !== experimentId || learning.status === "rolled_back") continue;
    learning.status = "rolled_back";
    learning.rolledBackAt = rolledBackAt;
  }
}

export function getForms(siteId: string): FormDefinition[] {
  return getSiteBundle(siteId)?.extensionModel.forms ?? [];
}

export function updateFormSettings(input: UpdateFormSettingsInput) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  return applyFormSettingsUpdate(bundle, input);
}

export function applyFindingToDraft(input: { siteId: string; findingId: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const finding = bundle.optimizationFindings.find((candidate) => candidate.id === input.findingId);
  if (!finding) return { ok: false as const, reason: "Finding not found." };

  const applied = applySuggestedEdit(bundle, finding);
  if (!applied.ok) return applied;
  return {
    ok: true as const,
    draftCreated: true,
    qaRequired: true,
    finding: applied.finding,
    changeSummary: applied.changeSummary
  };
}

export function dismissFinding(input: { siteId: string; findingId: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const finding = bundle.optimizationFindings.find((candidate) => candidate.id === input.findingId);
  if (!finding) return { ok: false as const, reason: "Finding not found." };
  if (finding.status === "applied") return { ok: false as const, reason: "Applied findings cannot be dismissed." };
  finding.status = "dismissed";
  return { ok: true as const, finding };
}

export function applyAiEditToSite(input: { siteId: string; message: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const result = applyAiEditToBundle(bundle, input.message);
  if (result.mutated || result.operations.some((operation) => operation.type === "run_audit")) {
    bundle.optimizationFindings = buildOptimizationFindings(bundle);
    result.findings = bundle.optimizationFindings;
  }
  return result;
}

export function createClaim(input: {
  siteId: string;
  ownerUserId?: string;
  ownerEmail?: string;
  verifiedFacts?: string[];
  acceptedTerms: boolean;
  acceptedManagement: boolean;
}) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const acceptedAt = new Date().toISOString();
  applyVerifiedFacts(bundle.businessProfile, input.verifiedFacts ?? []);
  const claim: ClaimRecord = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    ownerUserId: input.ownerUserId,
    ownerEmail: input.ownerEmail?.toLowerCase(),
    verifiedFacts: input.verifiedFacts ?? [],
    acceptedTermsAt: input.acceptedTerms ? acceptedAt : undefined,
    acceptedManagementAt: input.acceptedManagement ? acceptedAt : undefined,
    status: "checkout_required" as const,
    createdAt: new Date().toISOString()
  };
  state().claims.push(claim);
  return {
    ...claim,
    checkout: {
      required: true as const,
      provider: "stripe" as const,
      mode: "subscription" as const,
      configured: false,
      message: "Stripe checkout is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID to create live checkout sessions."
    }
  };
}

export function completeClaimCheckout(input: {
  claimId?: string;
  siteId?: string;
  checkoutSessionId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  completedAt?: string;
}) {
  if (!input.claimId && !input.checkoutSessionId) return null;
  const claim = input.claimId
    ? state().claims.find((candidate) => candidate.id === input.claimId)
    : state().claims.find((candidate) => candidate.stripeCheckoutSessionId === input.checkoutSessionId);
  if (!claim) return null;
  if (input.siteId && claim.siteId !== input.siteId) return null;
  if (input.checkoutSessionId) {
    const sessionClaim = state().claims.find((candidate) => candidate.stripeCheckoutSessionId === input.checkoutSessionId);
    if (sessionClaim && sessionClaim.id !== claim.id) return null;
    if (claim.stripeCheckoutSessionId && claim.stripeCheckoutSessionId !== input.checkoutSessionId) return null;
  }

  claim.status = "claimed";
  claim.claimedAt = input.completedAt ?? new Date().toISOString();
  claim.stripeCustomerId = input.stripeCustomerId ?? claim.stripeCustomerId;
  claim.stripeSubscriptionId = input.stripeSubscriptionId ?? claim.stripeSubscriptionId;
  claim.stripeCheckoutSessionId = input.checkoutSessionId ?? claim.stripeCheckoutSessionId;
  return claim;
}

export function recordClaimCheckoutSession(claimId: string, checkoutSessionId: string) {
  const sessionOwner = state().claims.find(
    (candidate) => candidate.stripeCheckoutSessionId === checkoutSessionId && candidate.id !== claimId
  );
  if (sessionOwner) return null;
  const claim = state().claims.find((candidate) => candidate.id === claimId);
  if (!claim) return null;
  claim.stripeCheckoutSessionId = checkoutSessionId;
  return claim;
}

export function listClaims(siteId?: string) {
  return state().claims.filter((claim) => !siteId || claim.siteId === siteId);
}

export function registerDomain(input: {
  siteId: string;
  hostname: string;
  provider?: "railway" | "cloudflare_for_saas";
  providerHostnameId?: string;
  verification?: DomainRecord["verification"];
}) {
  if (!getSiteBundle(input.siteId)) return null;
  const verification = input.verification ?? {
    type: "cname" as const,
    value: "customers.lodesta.example",
    configured: false,
    note: "Cloudflare for SaaS hostname verification will replace this placeholder."
  };
  const provider = input.provider ?? ("cloudflare_for_saas" as const);
  const domain = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    hostname: input.hostname.toLowerCase(),
    kind: "custom" as const,
    status: provider === "railway" ? ("active" as const) : ("pending" as const),
    provider,
    providerHostnameId: input.providerHostnameId,
    verification,
    createdAt: new Date().toISOString()
  };
  state().domains.push(domain);
  return {
    ...domain,
    verification
  };
}

export function listDomains(siteId?: string) {
  return state().domains.filter((domain) => !siteId || domain.siteId === siteId);
}

export function getDomainByHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return state().domains.find((domain) => domain.hostname.toLowerCase() === normalized) ?? null;
}

export function getDomainById(domainId: string) {
  return state().domains.find((domain) => domain.id === domainId) ?? null;
}

export function updateDomain(input: {
  domainId: string;
  status?: DomainRecord["status"];
  verification?: DomainRecord["verification"];
  providerHostnameId?: string;
}) {
  const domain = state().domains.find((candidate) => candidate.id === input.domainId);
  if (!domain) return null;
  if (input.status) domain.status = input.status;
  if (input.verification) domain.verification = input.verification;
  if (input.providerHostnameId) domain.providerHostnameId = input.providerHostnameId;
  return { ...domain };
}

export function createOutboundCampaign(input: CreateOutboundCampaignInput) {
  const campaign = newOutboundCampaign(input);
  state().outboundCampaigns.push(campaign);
  return campaign;
}

export function listOutboundCampaigns() {
  return [...state().outboundCampaigns].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function upsertOutboundProspect(input: UpsertOutboundProspectInput) {
  const existing = input.id
    ? state().outboundProspects.find((candidate) => candidate.id === input.id)
    : undefined;
  if (existing) {
    Object.assign(existing, {
      ...input,
      businessName: input.businessName.trim(),
      metadata: input.metadata ?? existing.metadata
    });
    return existing;
  }
  const prospect = newOutboundProspect(input);
  state().outboundProspects.push(prospect);
  return prospect;
}

export function listOutboundProspects(campaignId?: string) {
  return state()
    .outboundProspects.filter((prospect) => !campaignId || prospect.campaignId === campaignId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function recordOutboundEvent(input: RecordOutboundEventInput) {
  const event = newOutboundEvent(input);
  state().outboundEvents.push(event);
  const prospect = event.prospectId
    ? state().outboundProspects.find((candidate) => candidate.id === event.prospectId)
    : event.siteId
      ? state().outboundProspects.find((candidate) => candidate.campaignId === event.campaignId && candidate.siteId === event.siteId)
      : undefined;
  if (prospect) applyOutboundEventToProspect(prospect, event);
  return event;
}

export function listOutboundEvents(campaignId?: string) {
  return state()
    .outboundEvents.filter((event) => !campaignId || event.campaignId === campaignId)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function outboundSummary(campaignId?: string) {
  return summarizeOutbound(state().outboundCampaigns, state().outboundProspects, state().outboundEvents, campaignId);
}

function clonePublishedAsDraft(bundle: SiteBundle) {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) {
    existingDraft.theme ??= structuredClone(bundle.siteModel.theme);
    return existingDraft;
  }
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(published);
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  draft.theme ??= structuredClone(bundle.siteModel.theme);
  bundle.siteModel.versions.unshift(draft);
  return draft;
}

function sanitizeMetadata(metadata: AnalyticsEvent["metadata"]) {
  return sanitizeAnalyticsMetadata(metadata);
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clampHoldout(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.5, value));
}
