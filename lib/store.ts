import type {
  AnalyticsEvent,
  ClaimRecord,
  DomainRecord,
  Experiment,
  FormDefinition,
  LeadSubmission,
  OptimizationFinding,
  PreviewToken,
  SiteBundle,
  WorkflowDelivery
} from "./models";
import { runAudit } from "./audit";
import { createSiteFromInput } from "./intake";
import { applySuggestedEdit } from "./optimization";
import { sampleSiteBundle } from "./sample-data";
import { summarizeAnalytics } from "./analytics";
import { mergeFindings, recommendFromAnalytics } from "./analytics-insights";
import { applyAiEditToBundle } from "./ai-editor";
import { updateSiteDesignBundle, type UpdateSiteDesignInput } from "./design";
import { applySiteIdentity, makeUniqueSlug } from "./site-identity";
import { applyVerifiedFacts } from "./fact-verification";
import { applyBusinessProfileUpdate, type BusinessProfileUpdateInput } from "./business-profile-update";

type StoreState = {
  bundles: Map<string, SiteBundle>;
  slugToSiteId: Map<string, string>;
  submissions: LeadSubmission[];
  analyticsEvents: AnalyticsEvent[];
  claims: ClaimRecord[];
  domains: DomainRecord[];
  previewTokens: PreviewToken[];
  workflowDeliveries: WorkflowDelivery[];
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
    claims: [],
    previewTokens: [
      {
        token: "demo-token",
        siteId: sampleSiteBundle.businessProfile.siteId,
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

export function createAndStoreSite(input: { url?: string; prompt?: string; crawl?: Parameters<typeof createSiteFromInput>[0]["crawl"] }) {
  const bundle = createSiteFromInput(input);
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
  bundle.optimizationFindings = buildOptimizationFindings(bundle);
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
    bundle
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

export function updateBusinessProfile(input: BusinessProfileUpdateInput) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  return applyBusinessProfileUpdate(bundle, input);
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
  return mergeFindings(
    runAudit(bundle.businessProfile, bundle.siteModel),
    recommendFromAnalytics(bundle, analyticsSummary(bundle.businessProfile.siteId))
  );
}

export function assignExperiment(input: { siteId: string; sessionId: string; experimentId?: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return { assigned: false as const, reason: "Unknown site" };
  const experiment =
    bundle.experiments.find((candidate) => candidate.id === input.experimentId) ??
    bundle.experiments.find((candidate) => candidate.status === "running");
  if (!experiment) return { assigned: false as const, reason: "No running experiment" };
  const hash = hashString(`${input.siteId}:${input.sessionId}:${experiment.id}`);
  const holdoutPercent = clampHoldout(experiment.holdoutPercent);
  const bucket = (hash % 10000) / 10000;
  const control = experiment.variants.find((variant) => String(variant.id ?? "") === "control") ?? experiment.variants[0];
  const treatmentVariants = experiment.variants.filter((variant) => String(variant.id ?? "") !== String(control?.id ?? ""));
  const holdout = Boolean(control && holdoutPercent > 0 && bucket < holdoutPercent);
  const availableVariants = holdout ? [control] : treatmentVariants.length ? treatmentVariants : experiment.variants;
  const variant = availableVariants[hash % availableVariants.length];
  return {
    assigned: true as const,
    experimentId: experiment.id,
    primaryMetric: experiment.primaryMetric,
    holdout,
    variant
  };
}

export function listExperiments(siteId: string): Experiment[] {
  return getSiteBundle(siteId)?.experiments ?? [];
}

export function getForms(siteId: string): FormDefinition[] {
  return getSiteBundle(siteId)?.extensionModel.forms ?? [];
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
    finding: applied.finding
  };
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
  const claim = {
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
  checkoutSessionId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  completedAt?: string;
}) {
  const claim = state().claims.find(
    (candidate) =>
      (input.claimId && candidate.id === input.claimId) ||
      (input.checkoutSessionId && candidate.stripeCheckoutSessionId === input.checkoutSessionId)
  );
  if (!claim) return null;

  claim.status = "claimed";
  claim.claimedAt = input.completedAt ?? new Date().toISOString();
  claim.stripeCustomerId = input.stripeCustomerId ?? claim.stripeCustomerId;
  claim.stripeSubscriptionId = input.stripeSubscriptionId ?? claim.stripeSubscriptionId;
  claim.stripeCheckoutSessionId = input.checkoutSessionId ?? claim.stripeCheckoutSessionId;
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
  const domain = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    hostname: input.hostname.toLowerCase(),
    kind: "custom" as const,
    status: "pending" as const,
    provider: input.provider ?? ("cloudflare_for_saas" as const),
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
  if (!metadata) return undefined;
  const sanitized: NonNullable<AnalyticsEvent["metadata"]> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/password|token|secret|email|phone|name|message/i.test(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
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
