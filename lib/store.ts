import type { BusinessServiceRecord, FactCandidate } from "./business-evidence";
import type {
  AnalyticsEvent,
  ClaimRecord,
  DomainRecord,
  Experiment,
  ExperimentLearning,
  FormDefinition,
  Inquiry,
  InquiryAiEnrichment,
  InquiryDelivery,
  InquiryEvent,
  SiteArtifactRecord,
  OptimizationFinding,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  PreviewToken,
  ProspectPresenceReportResult,
  ProspectReportLead,
  ProspectReportRecord,
  SiteBundle,
  SiteCandidateRecord,
  SiteCandidateStatus,
  SiteVersion,
} from "./models";
import { runAudit } from "./audit";
import { createSiteV3FromInput } from "./intake";
import { applySuggestedEdit, preserveFindingLifecycle } from "./optimization";
import { applyV3SectionUpdate } from "./v3-editor";
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
import { claimVerificationSatisfies, type ClaimVerificationLevel } from "./owner-access";
import { applyBusinessProfileUpdate, type BusinessProfileUpdateInput } from "./business-profile-update";
import { applyFormSettingsUpdate, type UpdateFormSettingsInput } from "./form-settings";
import { applyOwnerAssetsUpdate, type UpdateOwnerAssetsInput } from "./owner-assets";
import { restoreVersionToDraftBundle } from "./site-versions";
import { sanitizeAnalyticsMetadata } from "./privacy";
import { markAllVersionsOwnerTouched, markVersionOwnerTouched } from "./site-version-metadata";
import { copyCandidateArtifactToSite } from "./site-artifacts";
import { businessIdForProfile, withBusinessBundleFields } from "./business-model";
import { assertBundleVersionsV3, assertSiteVersionV3 } from "./site-version-v3";
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
import {
  type CreateInquiryFromFormInput,
  type CreateInquiryFromFormResult,
  extractInquiryContact,
  inquiryDedupeKey,
  inquiryMessageText
} from "./inquiries";

type StoreState = {
  bundles: Map<string, SiteBundle>;
  slugToSiteId: Map<string, string>;
  siteCandidates: Map<string, SiteCandidateRecord>;
  inquiries: Inquiry[];
  inquiryEvents: InquiryEvent[];
  inquiryDeliveries: InquiryDelivery[];
  analyticsEvents: AnalyticsEvent[];
  claims: ClaimRecord[];
  domains: DomainRecord[];
  previewTokens: PreviewToken[];
  outboundCampaigns: OutboundCampaign[];
  outboundProspects: OutboundProspect[];
  outboundEvents: OutboundEvent[];
  prospectReports: ProspectReportRecord[];
  prospectReportLeads: ProspectReportLead[];
  experimentLearnings: ExperimentLearning[];
  siteArtifacts: SiteArtifactRecord[];
};

const globalStore = globalThis as typeof globalThis & {
  __lodestaStore?: StoreState;
};

function createInitialState(): StoreState {
  const bundles = new Map<string, SiteBundle>();
  const slugToSiteId = new Map<string, string>();
  const sampleBundle = assertBundleVersionsV3(withBusinessBundleFields(structuredClone(sampleSiteBundle)), "initial sample bundle");
  bundles.set(sampleBundle.businessProfile.siteId, sampleBundle);
  slugToSiteId.set(sampleBundle.siteModel.slug, sampleBundle.businessProfile.siteId);
  return {
    bundles,
    slugToSiteId,
    siteCandidates: new Map(),
    inquiries: [],
    inquiryEvents: [],
    inquiryDeliveries: [],
    analyticsEvents: [],
    outboundCampaigns: [],
    outboundProspects: [],
    outboundEvents: [],
    prospectReports: [],
    prospectReportLeads: [],
    experimentLearnings: [],
    siteArtifacts: [],
    claims: [],
    previewTokens: [
      {
        token: "demo-token",
        siteId: sampleSiteBundle.businessProfile.siteId,
        versionId: sampleSiteBundle.siteModel.versions[0]?.id,
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
  globalStore.__lodestaStore.siteCandidates ??= new Map();
  globalStore.__lodestaStore.claims ??= [];
  globalStore.__lodestaStore.domains ??= [];
  globalStore.__lodestaStore.previewTokens ??= [];
  globalStore.__lodestaStore.inquiries ??= [];
  globalStore.__lodestaStore.inquiryEvents ??= [];
  globalStore.__lodestaStore.inquiryDeliveries ??= [];
  globalStore.__lodestaStore.outboundCampaigns ??= [];
  globalStore.__lodestaStore.outboundProspects ??= [];
  globalStore.__lodestaStore.outboundEvents ??= [];
  globalStore.__lodestaStore.prospectReports ??= [];
  globalStore.__lodestaStore.prospectReportLeads ??= [];
  globalStore.__lodestaStore.experimentLearnings ??= [];
  globalStore.__lodestaStore.siteArtifacts ??= [];
  return globalStore.__lodestaStore;
}

export function listSiteBundles() {
  return Array.from(state().bundles.values()).map((bundle) => assertBundleVersionsV3(bundle, "store list bundle"));
}

export function getSiteBundle(siteId: string) {
  const bundle = state().bundles.get(siteId) ?? null;
  return bundle ? assertBundleVersionsV3(bundle, "store get bundle") : null;
}

export function getSiteBundleBySlug(slug: string) {
  const siteId = state().slugToSiteId.get(slug);
  return siteId ? getSiteBundle(siteId) : null;
}

export function createAndStoreSite(input: Parameters<typeof createSiteV3FromInput>[0]) {
  let bundle = withBusinessBundleFields(createSiteV3FromInput({ ...input, experimentLearnings: listExperimentLearnings({ status: "active" }) }));
  const store = state();
  applySiteIdentity(bundle, makeUniqueSlug(bundle.siteModel.slug, store.slugToSiteId.keys()));
  bundle = withBusinessBundleFields(bundle, { businessId: bundle.business?.id });
  assertBundleVersionsV3(bundle, "store create bundle");
  store.bundles.set(bundle.businessProfile.siteId, bundle);
  store.slugToSiteId.set(bundle.siteModel.slug, bundle.businessProfile.siteId);
  return bundle;
}

export function createSiteCandidate(input: {
  id?: string;
  businessId?: string;
  agentRunId?: string;
  bundle: SiteBundle;
  sourceUrl?: string;
  sourceHost?: string;
  intendedSiteId?: string;
  status?: SiteCandidateStatus;
  candidatePurpose?: SiteCandidateRecord["candidatePurpose"];
}) {
  const now = new Date().toISOString();
  const businessId = input.businessId ?? businessIdForProfile(input.bundle.businessProfile);
  const bundle = assertBundleVersionsV3(withBusinessBundleFields(input.bundle, { businessId, now }), "store candidate bundle");
  const sourceUrl = input.sourceUrl ?? bundle.presenceAssessment.sourceUrl;
  const candidate: SiteCandidateRecord = {
    id: input.id ?? `sitecand_${crypto.randomUUID().replace(/-/g, "")}`,
    businessId,
    agentRunId: input.agentRunId,
    sourceUrl,
    sourceHost: input.sourceHost ?? hostFromUrl(sourceUrl),
    businessName: bundle.businessProfile.name,
    vertical: bundle.businessProfile.vertical,
    candidateSlug: bundle.siteModel.slug,
    bundle: structuredClone(bundle),
    status: input.status ?? "ready",
    candidatePurpose: input.candidatePurpose ?? "customer_prospect",
    intendedSiteId: input.intendedSiteId,
    createdAt: now,
    updatedAt: now
  };
  state().siteCandidates.set(candidate.id, candidate);
  return structuredClone(candidate);
}

const factCandidatesByBusiness = new Map<string, FactCandidate[]>();
const businessServicesByBusiness = new Map<string, BusinessServiceRecord[]>();

export function replaceFactCandidates(businessId: string, candidates: FactCandidate[]) {
  factCandidatesByBusiness.set(businessId, candidates.map((candidate) => ({ ...candidate })));
  return structuredClone(factCandidatesByBusiness.get(businessId) ?? []);
}

export function listFactCandidates(businessId: string) {
  return structuredClone(factCandidatesByBusiness.get(businessId) ?? []);
}

export function replaceProposedBusinessServices(businessId: string, records: BusinessServiceRecord[]) {
  // Replace machine-proposed rows; owner-decided rows (active/hidden/rejected) persist.
  const existing = businessServicesByBusiness.get(businessId) ?? [];
  const ownerDecided = existing.filter((record) => record.status !== "proposed");
  const decidedKeys = new Set(ownerDecided.map((record) => record.serviceDefinitionId ?? `custom:${record.customName?.toLowerCase()}`));
  const fresh = records.filter((record) => !decidedKeys.has(record.serviceDefinitionId ?? `custom:${record.customName?.toLowerCase()}`));
  businessServicesByBusiness.set(businessId, [...ownerDecided, ...fresh.map((record) => ({ ...record }))]);
  return structuredClone(businessServicesByBusiness.get(businessId) ?? []);
}

export function listBusinessServices(businessId: string) {
  return structuredClone(businessServicesByBusiness.get(businessId) ?? []);
}

export function updateBusinessService(input: { id: string; status: "active" | "hidden" | "rejected"; confirmedBy: string }) {
  for (const records of businessServicesByBusiness.values()) {
    const record = records.find((entry) => entry.id === input.id);
    if (record) {
      record.status = input.status;
      record.confirmationSource = "owner";
      record.confirmedBy = input.confirmedBy;
      record.confirmedAt = new Date().toISOString();
      record.updatedAt = record.confirmedAt;
      return structuredClone(record);
    }
  }
  return null;
}

export function upsertSiteArtifact(artifact: SiteArtifactRecord) {
  const artifacts = state().siteArtifacts;
  const index = artifacts.findIndex((candidate) => candidate.id === artifact.id);
  const next = structuredClone(artifact);
  if (index >= 0) artifacts[index] = next;
  else artifacts.push(next);
  return structuredClone(next);
}

export function listSiteArtifacts(filter: {
  siteCandidateId?: string;
  siteId?: string;
  scope?: SiteArtifactRecord["scope"];
  artifactType?: SiteArtifactRecord["artifactType"];
} = {}) {
  return state()
    .siteArtifacts.filter((artifact) => {
      if (filter.siteCandidateId && artifact.siteCandidateId !== filter.siteCandidateId) return false;
      if (filter.siteId && artifact.siteId !== filter.siteId) return false;
      if (filter.scope && artifact.scope !== filter.scope) return false;
      if (filter.artifactType && artifact.artifactType !== filter.artifactType) return false;
      return true;
    })
    .map((artifact) => structuredClone(artifact));
}

export function listSiteCandidates(filter: {
  status?: SiteCandidateStatus;
  candidatePurpose?: SiteCandidateRecord["candidatePurpose"];
  sourceHost?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 100));
  const candidates = Array.from(state().siteCandidates.values())
    .filter((candidate) => !filter.status || candidate.status === filter.status)
    .filter((candidate) => !filter.candidatePurpose || candidate.candidatePurpose === filter.candidatePurpose)
    .filter((candidate) => !filter.sourceHost || candidate.sourceHost === filter.sourceHost)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    candidates: candidates.slice(offset, offset + limit).map((candidate) => structuredClone(candidate)),
    total: candidates.length
  };
}

export function getSiteCandidate(candidateId: string) {
  const candidate = state().siteCandidates.get(candidateId);
  if (!candidate) return null;
  // Candidate reads stay unchecked so admin repair surfaces can soft-check
  // stale stored schemas (siteVersionV3Issue) instead of crashing; writes
  // and render paths keep the strict assert.
  return structuredClone(candidate);
}

export function updateSiteCandidateBundle(candidateId: string, bundle: SiteBundle) {
  const candidate = state().siteCandidates.get(candidateId);
  if (!candidate) return null;
  candidate.bundle = structuredClone(assertBundleVersionsV3(bundle, "store update candidate bundle"));
  return structuredClone(candidate);
}

export function archiveSiteCandidates(candidateIds: string[]) {
  const store = state();
  const now = new Date().toISOString();
  const uniqueIds = Array.from(new Set(candidateIds.map((id) => id.trim()).filter(Boolean))).slice(0, 100);
  const archived: SiteCandidateRecord[] = [];
  for (const candidateId of uniqueIds) {
    const candidate = store.siteCandidates.get(candidateId);
    if (!candidate || candidate.status === "accepted") continue;
    candidate.status = "archived";
    candidate.updatedAt = now;
    archived.push(structuredClone(candidate));
  }
  return archived;
}

export function mergeBusinesses(input: { sourceBusinessId: string; targetBusinessId: string }) {
  const sourceBusinessId = input.sourceBusinessId.trim();
  const targetBusinessId = input.targetBusinessId.trim();
  if (!sourceBusinessId || !targetBusinessId) return { ok: false as const, reason: "Source and target business ids are required." };
  if (sourceBusinessId === targetBusinessId) return { ok: false as const, reason: "Source and target business ids must differ." };

  const store = state();
  const knownBusinessIds = new Set<string>();
  for (const bundle of store.bundles.values()) {
    if (bundle.business?.id) knownBusinessIds.add(bundle.business.id);
  }
  for (const candidate of store.siteCandidates.values()) {
    knownBusinessIds.add(candidate.businessId);
    if (candidate.bundle.business?.id) knownBusinessIds.add(candidate.bundle.business.id);
  }
  if (!knownBusinessIds.has(sourceBusinessId)) return { ok: false as const, reason: "Source business not found." };
  if (!knownBusinessIds.has(targetBusinessId)) return { ok: false as const, reason: "Target business not found." };

  const now = new Date().toISOString();
  let movedSites = 0;
  let movedSiteCandidates = 0;
  let movedLocations = 0;
  for (const bundle of store.bundles.values()) {
    if (bundle.business?.id !== sourceBusinessId) continue;
    const locationCount = bundle.locations?.length ?? 0;
    const nextBundle = assertBundleVersionsV3(withBusinessBundleFields(bundle, { businessId: targetBusinessId, now }), "store merge site bundle");
    nextBundle.locations = nextBundle.locations?.map((location) => ({ ...location, businessId: targetBusinessId, updatedAt: now }));
    store.bundles.set(nextBundle.businessProfile.siteId, nextBundle);
    movedSites += 1;
    movedLocations += locationCount;
  }
  for (const candidate of store.siteCandidates.values()) {
    if (candidate.businessId !== sourceBusinessId && candidate.bundle.business?.id !== sourceBusinessId) continue;
    candidate.businessId = targetBusinessId;
    candidate.bundle = assertBundleVersionsV3(withBusinessBundleFields(candidate.bundle, { businessId: targetBusinessId, now }), "store merge candidate bundle");
    candidate.bundle.locations = candidate.bundle.locations?.map((location) => ({ ...location, businessId: targetBusinessId, updatedAt: now }));
    candidate.updatedAt = now;
    movedSiteCandidates += 1;
  }
  return {
    ok: true as const,
    sourceBusinessId,
    targetBusinessId,
    movedSites,
    movedSiteCandidates,
    movedLocations
  };
}

export function acceptSiteCandidateAsSite(candidateId: string) {
  const store = state();
  const candidate = store.siteCandidates.get(candidateId);
  if (!candidate) return null;
  if (candidate.status === "accepted" && candidate.acceptedSiteId) {
    const existingBundle = getSiteBundle(candidate.acceptedSiteId);
    if (!existingBundle) return { ok: false as const, reason: "Accepted site no longer exists." };
    if (candidate.intendedSiteId) {
      return { ok: false as const, reason: "Site candidate was already accepted as a site version." };
    }
    return {
      ok: true as const,
      candidate: structuredClone(candidate),
      bundle: existingBundle,
      acceptedSiteId: candidate.acceptedSiteId
    };
  }
  const ready = assertCandidateAcceptable(candidate);
  if (!ready.ok) return ready;
  if (candidate.intendedSiteId) {
    return { ok: false as const, reason: "Site candidate is intended for an existing site version." };
  }

  const acceptedAt = new Date().toISOString();
  let bundle = structuredClone(candidate.bundle);
  applySiteIdentity(bundle, makeUniqueSlug(bundle.siteModel.slug, store.slugToSiteId.keys()));
  bundle = assertBundleVersionsV3(withBusinessBundleFields(bundle, { businessId: candidate.businessId, now: acceptedAt }), "store accepted candidate bundle");
  store.bundles.set(bundle.businessProfile.siteId, bundle);
  store.slugToSiteId.set(bundle.siteModel.slug, bundle.businessProfile.siteId);
  copySelectedArtifactsToSite({
    candidateId,
    siteId: bundle.businessProfile.siteId,
    acceptedAt
  });
  candidate.status = "accepted";
  candidate.acceptedSiteId = bundle.businessProfile.siteId;
  candidate.acceptedVersionId = bundle.siteModel.versions[0]?.id;
  candidate.acceptedAt = acceptedAt;
  candidate.updatedAt = candidate.acceptedAt;
  return {
    ok: true as const,
    candidate: structuredClone(candidate),
    bundle,
    acceptedSiteId: bundle.businessProfile.siteId,
    acceptedVersionId: candidate.acceptedVersionId
  };
}

export function acceptSiteCandidateAsVersion(input: { candidateId: string; siteId: string }) {
  const store = state();
  const candidate = store.siteCandidates.get(input.candidateId);
  if (!candidate) return null;
  const targetBundle = getSiteBundle(input.siteId);
  if (!targetBundle) return { ok: false as const, reason: "Target site not found." };
  if (candidate.status === "accepted" && candidate.acceptedSiteId) {
    if (!candidate.intendedSiteId || candidate.acceptedSiteId !== input.siteId || !candidate.acceptedVersionId) {
      return { ok: false as const, reason: "Site candidate was already accepted into a different target." };
    }
    return {
      ok: true as const,
      candidate: structuredClone(candidate),
      bundle: targetBundle,
      acceptedSiteId: candidate.acceptedSiteId,
      acceptedVersionId: candidate.acceptedVersionId
    };
  }
  const ready = assertCandidateAcceptable(candidate);
  if (!ready.ok) return ready;
  if (candidate.intendedSiteId && candidate.intendedSiteId !== input.siteId) {
    return { ok: false as const, reason: "Site candidate is intended for a different site." };
  }

  const acceptedAt = new Date().toISOString();
  const version = siteVersionFromCandidate({
    candidateBundle: candidate.bundle,
    targetBundle,
    acceptedAt
  });
  if (!version) return { ok: false as const, reason: "Site candidate has no renderable version." };

  targetBundle.siteModel.versions.unshift(version);
  copySelectedArtifactsToSite({
    candidateId: input.candidateId,
    siteId: input.siteId,
    acceptedAt
  });
  candidate.status = "accepted";
  candidate.intendedSiteId = input.siteId;
  candidate.acceptedSiteId = input.siteId;
  candidate.acceptedVersionId = version.id;
  candidate.acceptedAt = acceptedAt;
  candidate.updatedAt = acceptedAt;

  return {
    ok: true as const,
    candidate: structuredClone(candidate),
    bundle: targetBundle,
    acceptedSiteId: input.siteId,
    acceptedVersionId: version.id
  };
}

function assertCandidateAcceptable(candidate: SiteCandidateRecord) {
  if (candidate.status === "blocked") {
    return { ok: false as const, reason: "Blocked site candidates cannot be accepted." };
  }
  if (candidate.status === "archived") {
    return { ok: false as const, reason: "Archived site candidates cannot be accepted." };
  }
  if (candidate.status !== "ready") {
    return { ok: false as const, reason: "Only ready site candidates can be accepted." };
  }
  return { ok: true as const };
}

function siteVersionFromCandidate(input: {
  candidateBundle: SiteBundle;
  targetBundle: SiteBundle;
  acceptedAt: string;
}): SiteVersion | null {
  const candidateBundle = structuredClone(input.candidateBundle);
  applySiteIdentity(candidateBundle, input.targetBundle.siteModel.slug);
  assertBundleVersionsV3(candidateBundle, "store accepted candidate version bundle");
  const candidateVersion =
    candidateBundle.siteModel.versions.find((version) => version.status === "draft") ??
    candidateBundle.siteModel.versions[0];
  if (!candidateVersion) return null;
  const version = structuredClone(assertSiteVersionV3(candidateVersion, "accepted candidate version"));
  version.id = nextAcceptedVersionId(input.targetBundle, input.acceptedAt);
  version.status = "draft";
  version.createdAt = input.acceptedAt;
  version.theme ??= structuredClone(candidateBundle.siteModel.theme);
  return version;
}

function nextAcceptedVersionId(bundle: SiteBundle, acceptedAt: string) {
  const seed = Date.parse(acceptedAt);
  const base = `version_${bundle.siteModel.slug}_candidate_${Number.isFinite(seed) ? seed : Date.now()}`;
  const existing = new Set(bundle.siteModel.versions.map((version) => version.id));
  let candidate = base;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}

function copySelectedArtifactsToSite(input: { candidateId: string; siteId: string; acceptedAt: string }) {
  const store = state();
  const selectedArtifacts = store.siteArtifacts.filter(
    (artifact) => artifact.siteCandidateId === input.candidateId && artifact.scope === "candidate_selected"
  );
  for (const artifact of selectedArtifacts) {
    const acceptedArtifact = copyCandidateArtifactToSite({
      artifact,
      managedSiteId: input.siteId,
      acceptedAt: input.acceptedAt
    });
    const existingIndex = store.siteArtifacts.findIndex((candidate) => candidate.id === acceptedArtifact.id);
    if (existingIndex >= 0) store.siteArtifacts[existingIndex] = acceptedArtifact;
    else store.siteArtifacts.push(acceptedArtifact);
  }
}

export function createPreviewToken(input: { siteId: string; expiresAt?: string; versionId?: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const versionId =
    input.versionId ??
    bundle.siteModel.versions.find((version) => version.status === "draft")?.id ??
    bundle.siteModel.versions[0]?.id;
  const previewToken: PreviewToken = {
    token: `preview_${crypto.randomUUID().replace(/-/g, "")}`,
    siteId: input.siteId,
    versionId,
    expiresAt: input.expiresAt,
    createdAt: new Date().toISOString()
  };
  state().previewTokens.push(previewToken);
  return previewToken;
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
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

export function createProspectReport(input: {
  id?: string;
  placeId: string;
  sourceUrl?: string;
  sourceHost?: string;
  websiteKind: ProspectReportRecord["websiteKind"];
  jobId?: string;
}) {
  const active = findActiveProspectReportByPlaceId(input.placeId);
  if (active) return active;
  const now = new Date().toISOString();
  const report: ProspectReportRecord = {
    id: input.id ?? `prospect_report_${crypto.randomUUID().replace(/-/g, "")}`,
    placeId: input.placeId,
    status: "queued",
    jobId: input.jobId,
    sourceUrl: input.sourceUrl,
    sourceHost: input.sourceHost,
    websiteKind: input.websiteKind,
    createdAt: now,
    updatedAt: now
  };
  state().prospectReports.push(report);
  return structuredClone(report);
}

export function getProspectReport(reportId: string) {
  return structuredClone(state().prospectReports.find((report) => report.id === reportId) ?? null);
}

export function findActiveProspectReportByPlaceId(placeId: string) {
  return structuredClone(
    state().prospectReports.find((report) => report.placeId === placeId && (report.status === "queued" || report.status === "running")) ??
      null
  );
}

export function findReusableProspectReportByPlaceId(placeId: string, since: string) {
  return structuredClone(
    state()
      .prospectReports.filter(
        (report) => report.placeId === placeId && report.status === "completed" && report.completedAt && report.completedAt >= since
      )
      .sort((left, right) => right.completedAt!.localeCompare(left.completedAt!))[0] ?? null
  );
}

export function updateProspectReport(input: {
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
}) {
  const reports = state().prospectReports;
  const index = reports.findIndex((report) => report.id === input.reportId);
  if (index < 0) return null;
  const existing = reports[index];
  const updated: ProspectReportRecord = {
    ...existing,
    status: input.status ?? existing.status,
    jobId: input.jobId ?? existing.jobId,
    sourceUrl: input.sourceUrl ?? existing.sourceUrl,
    sourceHost: input.sourceHost ?? existing.sourceHost,
    websiteKind: input.websiteKind ?? existing.websiteKind,
    result: input.result ?? existing.result,
    unlockedAt: input.unlockedAt ?? existing.unlockedAt,
    leadId: input.leadId ?? existing.leadId,
    errorCode: input.errorCode ?? existing.errorCode,
    completedAt: input.completedAt ?? existing.completedAt,
    updatedAt: new Date().toISOString()
  };
  reports[index] = updated;
  return structuredClone(updated);
}

export function createProspectReportLead(input: {
  reportId: string;
  email: string;
  contactName?: string;
  phone?: string;
  ipHash?: string;
  metadata?: Record<string, string | number | boolean>;
}) {
  const report = state().prospectReports.find((candidate) => candidate.id === input.reportId);
  if (!report) return null;
  const now = new Date().toISOString();
  const lead: ProspectReportLead = {
    id: `prospect_lead_${crypto.randomUUID().replace(/-/g, "")}`,
    reportId: input.reportId,
    email: input.email.toLowerCase(),
    contactName: input.contactName,
    phone: input.phone,
    ipHash: input.ipHash,
    metadata: input.metadata,
    createdAt: now
  };
  state().prospectReportLeads.push(lead);
  updateProspectReport({ reportId: input.reportId, unlockedAt: now, leadId: lead.id });
  return structuredClone(lead);
}

export function saveSiteVersion(input: { siteId: string; version: SiteBundle["siteModel"]["versions"][number] }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const index = bundle.siteModel.versions.findIndex((version) => version.id === input.version.id);
  if (index < 0) return null;
  bundle.siteModel.versions[index] = input.version;
  return bundle;
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

  const applied = applyV3SectionUpdate(bundle, input);
  if (!applied.ok) return applied;
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
  const result = updateSiteDesignBundle(bundle, input);
  if (result.ok) {
    const draft = bundle.siteModel.versions.find((version) => version.id === result.draftVersionId);
    if (draft) markVersionOwnerTouched(draft);
  }
  return result;
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
  const draft = bundle.siteModel.versions.find((version) => version.id === result.draftVersionId);
  if (draft) markVersionOwnerTouched(draft);
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
    bundle: markProfileUpdated(applyBusinessProfileUpdate(bundle, input)),
    guardrailWarnings: guardrails.warnings
  };
}

export function updateOwnerAssets(input: UpdateOwnerAssetsInput) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const result = applyOwnerAssetsUpdate(bundle, input);
  if (result.ok) markAllVersionsOwnerTouched(bundle);
  return result;
}

export function createInquiryFromForm(input: CreateInquiryFromFormInput): CreateInquiryFromFormResult {
  const store = state();
  const now = new Date().toISOString();
  const contact = extractInquiryContact(input.form, input.payload);
  const dedupeKey = inquiryDedupeKey({
    siteId: input.siteId,
    formId: input.form.id,
    contactEmailNormalized: contact.contactEmailNormalized,
    contactPhoneNormalized: contact.contactPhoneNormalized,
    payload: input.payload
  });
  const duplicateEvent = store.inquiryEvents
    .filter((event) => event.siteId === input.siteId && event.type === "form_submission" && event.dedupeKey === dedupeKey)
    .filter((event) => Date.now() - new Date(event.createdAt).getTime() <= 2 * 60_000)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  if (duplicateEvent) {
    const event: InquiryEvent = {
      id: crypto.randomUUID(),
      siteId: input.siteId,
      inquiryId: duplicateEvent.inquiryId,
      type: "form_submission",
      actor: "visitor",
      messageText: inquiryMessageText(input.form, input.payload),
      payload: structuredClone(input.payload),
      sourceUrl: input.sourceUrl,
      pageId: input.pageId,
      formId: input.form.id,
      dedupeKey,
      metadata: {
        ...input.metadata,
        contactExtractionStatus: contact.status,
        contactExtractionNotes: contact.notes,
        dedupe: true,
        duplicateOfEventId: duplicateEvent.id,
        dedupeWindowSeconds: 120,
        visitorId: input.visitorId,
        ipHash: input.ipHash,
        userAgent: input.userAgent
      },
      createdAt: now
    };
    store.inquiryEvents.push(event);
    const inquiry = store.inquiries.find((candidate) => candidate.id === duplicateEvent.inquiryId);
    if (!inquiry) throw new Error("Duplicate inquiry was not found.");
    return { inquiry: structuredClone(inquiry), event: structuredClone(event), duplicate: true };
  }

  const inquiry: Inquiry = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    sourceChannel: "form",
    contactName: contact.contactName,
    contactEmail: contact.contactEmail,
    contactEmailNormalized: contact.contactEmailNormalized,
    contactPhone: contact.contactPhone,
    contactPhoneNormalized: contact.contactPhoneNormalized,
    status: "new",
    notificationState: "queued",
    aiEnrichmentState: "queued",
    createdAt: now,
    updatedAt: now
  };
  const event: InquiryEvent = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    inquiryId: inquiry.id,
    type: "form_submission",
    actor: "visitor",
    messageText: inquiryMessageText(input.form, input.payload),
    payload: structuredClone(input.payload),
    sourceUrl: input.sourceUrl,
    pageId: input.pageId,
    formId: input.form.id,
    dedupeKey,
    metadata: {
      ...input.metadata,
      contactExtractionStatus: contact.status,
      contactExtractionNotes: contact.notes,
      visitorId: input.visitorId,
      ipHash: input.ipHash,
      userAgent: input.userAgent
    },
    createdAt: now
  };
  store.inquiries.push(inquiry);
  store.inquiryEvents.push(event);
  return { inquiry: structuredClone(inquiry), event: structuredClone(event), duplicate: false };
}

export function listInquiries(siteId?: string) {
  return state()
    .inquiries.filter((inquiry) => !siteId || inquiry.siteId === siteId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((inquiry) => structuredClone(inquiry));
}

export function getInquiry(siteId: string, inquiryId: string) {
  const inquiry = state().inquiries.find((candidate) => candidate.siteId === siteId && candidate.id === inquiryId);
  return inquiry ? structuredClone(inquiry) : null;
}

export function updateInquiryStatus(input: { siteId: string; inquiryId: string; status: Inquiry["status"] }) {
  const inquiry = state().inquiries.find((candidate) => candidate.siteId === input.siteId && candidate.id === input.inquiryId);
  if (!inquiry) return null;
  inquiry.status = input.status;
  inquiry.updatedAt = new Date().toISOString();
  return structuredClone(inquiry);
}

export function updateInquiryNotificationState(input: { siteId: string; inquiryId: string; state: Inquiry["notificationState"] }) {
  const inquiry = state().inquiries.find((candidate) => candidate.siteId === input.siteId && candidate.id === input.inquiryId);
  if (!inquiry) return null;
  inquiry.notificationState = input.state;
  inquiry.updatedAt = new Date().toISOString();
  return structuredClone(inquiry);
}

export function updateInquiryAiEnrichment(input: {
  siteId: string;
  inquiryId: string;
  state: Inquiry["aiEnrichmentState"];
  enrichment?: InquiryAiEnrichment;
  error?: string;
}) {
  const inquiry = state().inquiries.find((candidate) => candidate.siteId === input.siteId && candidate.id === input.inquiryId);
  if (!inquiry) return null;
  inquiry.aiEnrichmentState = input.state;
  if (input.enrichment) {
    inquiry.aiEnrichment = input.enrichment;
    inquiry.aiEnrichedAt = new Date().toISOString();
    inquiry.aiEnrichmentError = undefined;
  }
  if (input.error !== undefined) inquiry.aiEnrichmentError = input.error;
  inquiry.updatedAt = new Date().toISOString();
  return structuredClone(inquiry);
}

export function listInquiryEvents(inquiryId: string) {
  return state()
    .inquiryEvents.filter((event) => event.inquiryId === inquiryId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((event) => structuredClone(event));
}

export function countRecentInquiries(siteId: string, since: string) {
  return state().inquiries.filter((inquiry) => inquiry.siteId === siteId && inquiry.createdAt >= since).length;
}

export function recordInquiryDelivery(input: Omit<InquiryDelivery, "id" | "createdAt">) {
  const existing = state().inquiryDeliveries.find(
    (delivery) =>
      delivery.inquiryId === input.inquiryId &&
      delivery.workflowId === input.workflowId &&
      delivery.destination === input.destination &&
      delivery.target === input.target &&
      delivery.status === "sent"
  );
  if (existing) return structuredClone(existing);
  const delivery: InquiryDelivery = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };
  state().inquiryDeliveries.push(delivery);
  return structuredClone(delivery);
}

export function listInquiryDeliveries(siteId?: string) {
  return state()
    .inquiryDeliveries.filter((delivery) => !siteId || delivery.siteId === siteId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((delivery) => structuredClone(delivery));
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
  const result = applyFormSettingsUpdate(bundle, input);
  if (result.ok) markAllVersionsOwnerTouched(bundle);
  return result;
}

export function applyFindingToDraft(input: { siteId: string; findingId: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const finding = bundle.optimizationFindings.find((candidate) => candidate.id === input.findingId);
  if (!finding) return { ok: false as const, reason: "Finding not found." };

  const applied = applySuggestedEdit(bundle, finding);
  if (!applied.ok) return applied;
  const draft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (draft) markVersionOwnerTouched(draft);
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

export async function applyAiEditToSite(input: { siteId: string; message: string }) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  const result = await applyAiEditToBundle(bundle, input.message);
  if (result.mutated || result.operations.some((operation) => operation.type === "run_audit")) {
    if (result.mutated && result.draftVersionId) {
      const draft = bundle.siteModel.versions.find((version) => version.id === result.draftVersionId);
      if (draft) markVersionOwnerTouched(draft);
    }
    bundle.optimizationFindings = buildOptimizationFindings(bundle);
    result.findings = bundle.optimizationFindings;
  }
  return result;
}

function markProfileUpdated(bundle: SiteBundle) {
  markAllVersionsOwnerTouched(bundle);
  return bundle;
}

export function createClaim(input: {
  siteId: string;
  ownerUserId?: string;
  ownerEmail?: string;
  verificationLevel?: ClaimVerificationLevel;
  verificationMethod?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  outboundCampaignId?: string;
  outboundProspectId?: string;
  verifiedFacts?: string[];
  acceptedTerms: boolean;
  acceptedManagement: boolean;
  acceptedAssetRights?: boolean;
  attestedAssetIds?: string[];
}) {
  const bundle = getSiteBundle(input.siteId);
  if (!bundle) return null;
  if (!claimVerificationSatisfies(input.verificationLevel)) return null;
  const acceptedAt = new Date().toISOString();
  applyVerifiedFacts(bundle.businessProfile, input.verifiedFacts ?? []);
  const claim: ClaimRecord = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    ownerUserId: input.ownerUserId,
    ownerEmail: input.ownerEmail?.toLowerCase(),
    verificationLevel: input.verificationLevel ?? "unverified",
    verificationMethod: input.verificationMethod,
    verifiedBy: input.verifiedBy,
    verifiedAt: input.verifiedAt,
    outboundCampaignId: input.outboundCampaignId,
    outboundProspectId: input.outboundProspectId,
    verifiedFacts: input.verifiedFacts ?? [],
    acceptedTermsAt: input.acceptedTerms ? acceptedAt : undefined,
    acceptedManagementAt: input.acceptedManagement ? acceptedAt : undefined,
    assetRightsAcceptedAt: input.acceptedAssetRights ? acceptedAt : undefined,
    attestedAssetIds: input.attestedAssetIds ?? [],
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

export function findOutboundProspectByPreviewToken(previewToken: string) {
  return state().outboundProspects.find((prospect) => prospect.previewToken === previewToken) ?? null;
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
