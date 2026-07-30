import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  applyProviderExecutionFailure,
  applyProviderObservation,
  inspectDomainDns,
  newDomainVerification,
  refreshCustomHostnameStatus,
  registerCustomHostname
} from "@/lib/domains";
import {
  applyOutboundEventToProspect,
  newOutboundCampaign,
  newOutboundEvent,
  newOutboundProspect,
  summarizeOutbound
} from "@/packages/acquisition/outbound";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { sitePlatformRepository } from "@/packages/platform-data";
import { websiteAssessmentSchema } from "@/packages/website-assessment/contracts";
import {
  prospectAffiliationId,
  prospectContactId,
  prospectIdForCanonicalKey,
  prospectLicenseId,
  prospectLocationId,
  prospectObservationId,
  type CreateProspectObservationInput,
  type Prospect,
  type ProspectAffiliation,
  type ProspectCandidate,
  type ProspectCandidateQuery,
  type ProspectContact,
  type ProspectImportRecord,
  type ProspectLicense,
  type ProspectLocation,
  type ProspectObservation,
  type ProspectSource,
  type ProspectSourceRun,
  type UpsertProspectAffiliationInput,
  type UpsertProspectContactInput,
  type UpsertProspectInput,
  type UpsertProspectLicenseInput,
  type UpsertProspectLocationInput,
  type UpsertProspectSourceInput,
  type UpsertProspectSourceRunInput
} from "@/packages/prospect-research";
import {
  businessStrengthAssessmentSchema,
  prospectPresenceReportResultSchema
} from "./assessment-schemas";
import type {
  AdoptionInvitation,
  CreateWebsiteSetupInput,
  CreateOutboundCampaignInput,
  CreateProspectReportInput,
  CreateProspectReportLeadInput,
  CreateWebsiteAssessmentInput,
  DomainRecord,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  OutboundSummary,
  ProspectReportLead,
  ProspectReportAccessGrant,
  ProspectReportAccessPolicy,
  ProspectReportRecord,
  RecordOutboundEventInput,
  RegisterDomainInput,
  SiteRedirectRule,
  SitePreviewGrant,
  UpsertSiteRedirectInput,
  UpdateProspectReportInput,
  UpdateWebsiteAssessmentInput,
  WebsiteAssessmentJob,
  WebsiteAssessmentRecord,
  WebsiteSetupFailureCode,
  WebsiteSetupSourceUpdate,
  WebsiteSetup,
  UpsertOutboundProspectInput
} from "./contracts";

export interface PlatformOperationsRepository {
  createAdoptionInvitation(input: { siteId: string; tokenHash: string; expiresAt: string }): Promise<AdoptionInvitation>;
  findAdoptionInvitation(tokenHash: string): Promise<AdoptionInvitation | null>;
  consumeAdoptionInvitation(input: { tokenHash: string; ownerUserId: string }): Promise<AdoptionInvitation | null>;
  createWebsiteSetup(input: CreateWebsiteSetupInput): Promise<WebsiteSetup>;
  getWebsiteSetup(setupId: string): Promise<WebsiteSetup | null>;
  listWebsiteSetupsForOwner(ownerUserId: string): Promise<WebsiteSetup[]>;
  listWebsiteSetups(siteId?: string): Promise<WebsiteSetup[]>;
  updateWebsiteSetupSource(input: WebsiteSetupSourceUpdate): Promise<WebsiteSetup | null>;
  cancelWebsiteSetup(input: { setupId: string; ownerUserId: string }): Promise<WebsiteSetup | null>;
  retryWebsiteSetup(input: { setupId: string; ownerUserId: string }): Promise<WebsiteSetup | null>;
  claimWebsiteSetup(setupId: string, workerId: string): Promise<WebsiteSetup | null>;
  claimNextWebsiteSetup(workerId: string): Promise<WebsiteSetup | null>;
  linkWebsiteSetup(input: { setupId: string; sourceRevision: number; siteId: string; sessionId: string; runId: string }): Promise<WebsiteSetup | null>;
  failWebsiteSetup(input: { setupId: string; sourceRevision: number; failureCode: WebsiteSetupFailureCode; failureReason: string; siteId?: string }): Promise<WebsiteSetup | null>;
  createPreviewGrant(input: {
    id?: string;
    siteId: string;
    siteVersionId: string;
    secretHash: string;
    keyVersion: string;
    secretVersion?: number;
    expiresAt: string;
  }): Promise<SitePreviewGrant>;
  getPreviewGrant(previewId: string): Promise<SitePreviewGrant | null>;
  listPreviewGrants(siteId?: string): Promise<SitePreviewGrant[]>;
  revokePreviewGrant(previewId: string): Promise<SitePreviewGrant | null>;
  registerDomain(input: RegisterDomainInput): Promise<DomainRecord | null>;
  refreshDomain(input: { domainId: string }): Promise<DomainRecord | null>;
  listDomains(siteId?: string): Promise<DomainRecord[]>;
  getDomainById(domainId: string): Promise<DomainRecord | null>;
  getDomainByHostname(hostname: string): Promise<DomainRecord | null>;
  upsertRedirect(input: UpsertSiteRedirectInput): Promise<SiteRedirectRule>;
  setRedirectStatus(input: { redirectId: string; status: SiteRedirectRule["status"] }): Promise<SiteRedirectRule | null>;
  listRedirects(siteId: string): Promise<SiteRedirectRule[]>;
  getRedirectById(redirectId: string): Promise<SiteRedirectRule | null>;
  resolveRedirect(siteId: string, sourcePath: string): Promise<SiteRedirectRule | null>;
  upsertProspect(input: UpsertProspectInput): Promise<Prospect>;
  getProspect(prospectId: string): Promise<Prospect | null>;
  listProspectCandidates(input?: ProspectCandidateQuery): Promise<ProspectCandidate[]>;
  countProspectCandidates(input?: ProspectCandidateQuery): Promise<number>;
  upsertProspectLocation(input: UpsertProspectLocationInput): Promise<ProspectLocation>;
  listProspectLocations(prospectId: string): Promise<ProspectLocation[]>;
  upsertProspectLicense(input: UpsertProspectLicenseInput): Promise<ProspectLicense>;
  listProspectLicenses(prospectId: string): Promise<ProspectLicense[]>;
  upsertProspectAffiliation(input: UpsertProspectAffiliationInput): Promise<ProspectAffiliation>;
  listProspectAffiliations(prospectId: string): Promise<ProspectAffiliation[]>;
  upsertProspectSource(input: UpsertProspectSourceInput): Promise<ProspectSource>;
  listProspectSources(vertical?: string): Promise<ProspectSource[]>;
  upsertProspectSourceRun(input: UpsertProspectSourceRunInput): Promise<ProspectSourceRun>;
  listProspectSourceRuns(sourceId?: string): Promise<ProspectSourceRun[]>;
  pruneProspectSourceSnapshots(input: Array<{
    sourceId: string;
    retainedCanonicalKeys: string[];
  }>): Promise<{
    prospects: number;
    locations: number;
    licenses: number;
    affiliations: number;
    observations: number;
    contacts: number;
  }>;
  createProspectObservation(input: CreateProspectObservationInput): Promise<ProspectObservation>;
  upsertProspectContact(input: UpsertProspectContactInput): Promise<ProspectContact>;
  listProspectContacts(prospectId: string): Promise<ProspectContact[]>;
  importProspectResearch(records: ProspectImportRecord[]): Promise<{
    prospects: number;
    locations: number;
    licenses: number;
    affiliations: number;
    observations: number;
    contacts: number;
  }>;
  createOutboundCampaign(input: CreateOutboundCampaignInput): Promise<OutboundCampaign>;
  listOutboundCampaigns(): Promise<OutboundCampaign[]>;
  upsertOutboundProspect(input: UpsertOutboundProspectInput): Promise<OutboundProspect>;
  getOutboundProspect(prospectId: string): Promise<OutboundProspect | null>;
  listOutboundProspects(campaignId?: string): Promise<OutboundProspect[]>;
  findOutboundProspectByPreviewId(previewId: string): Promise<OutboundProspect | null>;
  findOutboundProspectByReportId(reportId: string): Promise<OutboundProspect | null>;
  attachOutboundProspectReport(prospectId: string, reportId: string): Promise<OutboundProspect | null>;
  recordOutboundReportView(reportId: string, occurredAt?: string): Promise<boolean>;
  recordOutboundEvent(input: RecordOutboundEventInput): Promise<OutboundEvent>;
  listOutboundEvents(campaignId?: string): Promise<OutboundEvent[]>;
  outboundSummary(campaignId?: string): Promise<OutboundSummary>;
  createProspectReport(input: CreateProspectReportInput): Promise<ProspectReportRecord>;
  getProspectReport(reportId: string): Promise<ProspectReportRecord | null>;
  listProspectReports(limit?: number): Promise<ProspectReportRecord[]>;
  findActiveProspectReportBySourceKey(sourceKey: string, accessPolicy: ProspectReportAccessPolicy): Promise<ProspectReportRecord | null>;
  findReusableProspectReportBySourceKey(sourceKey: string, accessPolicy: ProspectReportAccessPolicy, since: string): Promise<ProspectReportRecord | null>;
  updateProspectReport(input: UpdateProspectReportInput): Promise<ProspectReportRecord | null>;
  createProspectReportLead(input: CreateProspectReportLeadInput): Promise<ProspectReportLead | null>;
  createProspectReportAccessGrant(input: {
    reportId: string;
    leadId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<ProspectReportAccessGrant>;
  findActiveProspectReportAccessGrant(reportId: string, tokenHash: string): Promise<ProspectReportAccessGrant | null>;
  markProspectReportAccessGrantUsed(grantId: string): Promise<void>;
  createWebsiteAssessment(input: CreateWebsiteAssessmentInput): Promise<WebsiteAssessmentRecord>;
  getWebsiteAssessment(assessmentId: string): Promise<WebsiteAssessmentRecord | null>;
  listWebsiteAssessments(input?: { siteId?: string; sourceKey?: string; ids?: string[]; limit?: number }): Promise<WebsiteAssessmentRecord[]>;
  updateWebsiteAssessment(input: UpdateWebsiteAssessmentInput): Promise<WebsiteAssessmentRecord | null>;
  enqueueWebsiteAssessmentJob(input: { assessmentId: string; prospectReportId?: string }): Promise<WebsiteAssessmentJob>;
  claimNextWebsiteAssessmentJob(workerId: string): Promise<WebsiteAssessmentJob | null>;
  completeWebsiteAssessmentJob(jobId: string): Promise<void>;
  failWebsiteAssessmentJob(jobId: string, error: string): Promise<void>;
}

export class IdempotencyKeyConflictError extends Error {
  readonly code = "idempotency_key_conflict";
  constructor() {
    super("This idempotency key was already used for a different website source.");
    this.name = "IdempotencyKeyConflictError";
  }
}

export class ConcurrentProjectLimitError extends Error {
  readonly code = "concurrent_project_limit";
  constructor() {
    super("Finish or cancel an active build before starting another.");
    this.name = "ConcurrentProjectLimitError";
  }
}

type LocalState = {
  adoptionInvitations: AdoptionInvitation[];
  websiteSetups: WebsiteSetup[];
  previewGrants: SitePreviewGrant[];
  domains: DomainRecord[];
  redirects: SiteRedirectRule[];
  researchProspects: Prospect[];
  prospectLocations: ProspectLocation[];
  prospectLicenses: ProspectLicense[];
  prospectAffiliations: ProspectAffiliation[];
  prospectSources: ProspectSource[];
  prospectSourceRuns: ProspectSourceRun[];
  prospectObservations: ProspectObservation[];
  prospectContacts: ProspectContact[];
  campaigns: OutboundCampaign[];
  prospects: OutboundProspect[];
  events: OutboundEvent[];
  reports: ProspectReportRecord[];
  leads: ProspectReportLead[];
  reportAccessGrants: ProspectReportAccessGrant[];
  websiteAssessments: WebsiteAssessmentRecord[];
  websiteAssessmentJobs: WebsiteAssessmentJob[];
};

const emptyState = (): LocalState => ({
  adoptionInvitations: [],
  websiteSetups: [],
  previewGrants: [],
  domains: [],
  redirects: [],
  researchProspects: [],
  prospectLocations: [],
  prospectLicenses: [],
  prospectAffiliations: [],
  prospectSources: [],
  prospectSourceRuns: [],
  prospectObservations: [],
  prospectContacts: [],
  campaigns: [],
  prospects: [],
  events: [],
  reports: [],
  leads: [],
  reportAccessGrants: [],
  websiteAssessments: [],
  websiteAssessmentJobs: []
});

export class LocalPlatformOperationsRepository implements PlatformOperationsRepository {
  private queue = Promise.resolve();
  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "operations.json")) {}

  async createAdoptionInvitation(input: { siteId: string; tokenHash: string; expiresAt: string }) {
    const invitation: AdoptionInvitation = {
      id: `invitation_${crypto.randomUUID().replaceAll("-", "")}`,
      siteId: input.siteId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString()
    };
    await this.write((store) => {
      if (store.adoptionInvitations.some((item) => item.tokenHash === input.tokenHash)) throw new Error("Adoption token already exists.");
      store.adoptionInvitations.push(invitation);
    });
    return invitation;
  }
  async findAdoptionInvitation(tokenHash: string) {
    const invitation = (await this.read()).adoptionInvitations.find((item) => item.tokenHash === tokenHash);
    if (!invitation || invitation.consumedAt || Date.parse(invitation.expiresAt) <= Date.now()) return null;
    return structuredClone(invitation);
  }
  async consumeAdoptionInvitation(input: { tokenHash: string; ownerUserId: string }) {
    let result: AdoptionInvitation | null = null;
    await this.write(async (store) => {
      const invitation = store.adoptionInvitations.find((item) => item.tokenHash === input.tokenHash);
      if (!invitation || invitation.consumedAt || Date.parse(invitation.expiresAt) <= Date.now()) return;
      const site = await sitePlatformRepository.assignSiteOwnerIfUnowned(invitation.siteId, input.ownerUserId);
      if (!site || site.ownerUserId !== input.ownerUserId) return;
      invitation.consumedAt = new Date().toISOString();
      invitation.consumedByUserId = input.ownerUserId;
      result = structuredClone(invitation);
    });
    return result;
  }

  async createWebsiteSetup(input: CreateWebsiteSetupInput) {
    const now = new Date().toISOString();
    let result!: WebsiteSetup;
    await this.write((store) => {
      const existing = store.websiteSetups.find((item) =>
        item.ownerUserId === input.ownerUserId && item.idempotencyKey === input.idempotencyKey
      );
      if (existing) {
        if (existing.creationRequestHash !== input.creationRequestHash) throw new IdempotencyKeyConflictError();
        result = structuredClone(existing);
        return;
      }
      const active = store.websiteSetups.filter((item) =>
        item.ownerUserId === input.ownerUserId && ["queued", "processing"].includes(item.status)
      ).length;
      if (active >= 3) throw new ConcurrentProjectLimitError();
      result = {
        id: `setup_${crypto.randomUUID().replaceAll("-", "")}`,
        ownerUserId: input.ownerUserId,
        sourceUrl: input.sourceUrl,
        normalizedSource: input.normalizedSource,
        reportingTimezone: input.reportingTimezone,
        prospectReportId: input.prospectReportId,
        sourceRevision: 1,
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        idempotencyKey: input.idempotencyKey,
        creationRequestHash: input.creationRequestHash,
        createdAt: now,
        updatedAt: now
      };
      store.websiteSetups.push(result);
    });
    return result;
  }
  async getWebsiteSetup(setupId: string) { return structuredClone((await this.read()).websiteSetups.find((item) => item.id === setupId) ?? null); }
  async listWebsiteSetupsForOwner(ownerUserId: string) { return (await this.read()).websiteSetups.filter((item) => item.ownerUserId === ownerUserId).sort(byCreatedDesc); }
  async listWebsiteSetups(siteId?: string) { return (await this.read()).websiteSetups.filter((item) => !siteId || item.siteId === siteId).sort(byCreatedDesc); }
  async updateWebsiteSetupSource(input: WebsiteSetupSourceUpdate) {
    let result: WebsiteSetup | null = null;
    await this.write((store) => {
      const setup = store.websiteSetups.find((item) => item.id === input.setupId && item.ownerUserId === input.ownerUserId);
      if (!setup || !["queued", "processing", "failed"].includes(setup.status)) return;
      if (setup.status === "failed" && store.websiteSetups.filter((item) =>
        item.ownerUserId === input.ownerUserId && ["queued", "processing"].includes(item.status)
      ).length >= 3) throw new ConcurrentProjectLimitError();
      setup.sourceUrl = input.sourceUrl;
      setup.normalizedSource = input.normalizedSource;
      setup.sourceRevision += 1;
      setup.status = "queued";
      setup.failureCode = undefined;
      setup.failureReason = undefined;
      setup.siteId = undefined;
      setup.sessionId = undefined;
      setup.runId = undefined;
      setup.lockedAt = undefined;
      setup.lockedBy = undefined;
      setup.updatedAt = new Date().toISOString();
      result = structuredClone(setup);
    });
    return result;
  }
  async cancelWebsiteSetup(input: { setupId: string; ownerUserId: string }) {
    let result: WebsiteSetup | null = null;
    await this.write((store) => {
      const setup = store.websiteSetups.find((item) => item.id === input.setupId && item.ownerUserId === input.ownerUserId);
      if (!setup || setup.status === "canceled") return;
      setup.status = "canceled";
      setup.lockedAt = undefined;
      setup.lockedBy = undefined;
      setup.updatedAt = new Date().toISOString();
      result = structuredClone(setup);
    });
    return result;
  }
  async retryWebsiteSetup(input: { setupId: string; ownerUserId: string }) {
    let result: WebsiteSetup | null = null;
    await this.write((store) => {
      const setup = store.websiteSetups.find((item) => item.id === input.setupId && item.ownerUserId === input.ownerUserId);
      if (!setup || setup.status !== "failed" || !isRetriableSetupFailure(setup.failureCode)) return;
      if (store.websiteSetups.filter((item) =>
        item.ownerUserId === input.ownerUserId && ["queued", "processing"].includes(item.status)
      ).length >= 3) throw new ConcurrentProjectLimitError();
      setup.status = "queued";
      setup.failureCode = undefined;
      setup.failureReason = undefined;
      setup.lockedAt = undefined;
      setup.lockedBy = undefined;
      setup.updatedAt = new Date().toISOString();
      result = structuredClone(setup);
    });
    return result;
  }
  async claimWebsiteSetup(setupId: string, workerId: string) {
    let result: WebsiteSetup | null = null;
    await this.write((store) => {
      const setup = store.websiteSetups.find((item) => item.id === setupId && item.status === "queued");
      if (!setup) return;
      setup.status = "processing";
      setup.attempts += 1;
      setup.lockedBy = workerId;
      setup.lockedAt = new Date().toISOString();
      setup.updatedAt = setup.lockedAt;
      result = structuredClone(setup);
    });
    return result;
  }
  async claimNextWebsiteSetup(workerId: string) {
    let result: WebsiteSetup | null = null;
    await this.write((store) => {
      const staleBefore = Date.now() - 75 * 60_000;
      const setup = store.websiteSetups
        .filter((item) => item.status === "queued" || (item.status === "processing" && item.lockedAt && Date.parse(item.lockedAt) < staleBefore))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!setup) return;
      setup.status = "processing";
      setup.attempts += 1;
      setup.lockedBy = workerId;
      setup.lockedAt = new Date().toISOString();
      setup.updatedAt = setup.lockedAt;
      result = structuredClone(setup);
    });
    return result;
  }
  async linkWebsiteSetup(input: { setupId: string; sourceRevision: number; siteId: string; sessionId: string; runId: string }) {
    let result: WebsiteSetup | null = null;
    await this.write(async (store) => {
      const setup = store.websiteSetups.find((item) => item.id === input.setupId && item.status === "processing" && item.sourceRevision === input.sourceRevision);
      if (!setup) return;
      const site = await sitePlatformRepository.assignSiteOwnerIfUnowned(input.siteId, setup.ownerUserId);
      if (!site || site.ownerUserId !== setup.ownerUserId) return;
      Object.assign(setup, { status: "linked", siteId: input.siteId, sessionId: input.sessionId, runId: input.runId, lockedBy: undefined, lockedAt: undefined, updatedAt: new Date().toISOString() } satisfies Partial<WebsiteSetup>);
      result = structuredClone(setup);
    });
    return result;
  }
  async failWebsiteSetup(input: { setupId: string; sourceRevision: number; failureCode: WebsiteSetupFailureCode; failureReason: string; siteId?: string }) {
    let result: WebsiteSetup | null = null;
    await this.write((store) => {
      const setup = store.websiteSetups.find((item) => item.id === input.setupId && item.status === "processing" && item.sourceRevision === input.sourceRevision);
      if (!setup) return;
      Object.assign(setup, { status: "failed", failureCode: input.failureCode, failureReason: input.failureReason, siteId: input.siteId, lockedBy: undefined, lockedAt: undefined, updatedAt: new Date().toISOString() } satisfies Partial<WebsiteSetup>);
      result = structuredClone(setup);
    });
    return result;
  }

  async createPreviewGrant(input: {
    id?: string;
    siteId: string;
    siteVersionId: string;
    secretHash: string;
    keyVersion: string;
    secretVersion?: number;
    expiresAt: string;
  }) {
    const [site, version] = await Promise.all([sitePlatformRepository.getSite(input.siteId), sitePlatformRepository.getSiteVersion(input.siteVersionId)]);
    if (!site || !version || version.siteId !== site.id) throw new Error("Preview version does not belong to the site.");
    const grant: SitePreviewGrant = {
      id: input.id ?? `preview_${crypto.randomUUID().replaceAll("-", "")}`,
      siteId: input.siteId,
      siteVersionId: input.siteVersionId,
      secretHash: input.secretHash,
      keyVersion: input.keyVersion,
      secretVersion: input.secretVersion ?? 1,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString()
    };
    await this.write((store) => {
      const existing = store.previewGrants.find((item) => item.id === grant.id);
      if (existing) {
        if (existing.siteId !== grant.siteId || existing.siteVersionId !== grant.siteVersionId || existing.secretHash !== grant.secretHash) {
          throw new Error("Preview grant idempotency conflict.");
        }
        Object.assign(grant, existing);
        return;
      }
      store.previewGrants.push(grant);
    });
    return grant;
  }
  async getPreviewGrant(previewId: string) {
    const found = (await this.read()).previewGrants.find((item) => item.id === previewId);
    if (!found) return null;
    return structuredClone(found);
  }
  async listPreviewGrants(siteId?: string) { return (await this.read()).previewGrants.filter((item) => !siteId || item.siteId === siteId).sort(byCreatedDesc); }
  async revokePreviewGrant(previewId: string) {
    let result: SitePreviewGrant | null = null;
    await this.write((store) => {
      const grant = store.previewGrants.find((item) => item.id === previewId);
      if (!grant) return;
      grant.revokedAt ??= new Date().toISOString();
      result = structuredClone(grant);
    });
    return result;
  }

  async registerDomain(input: RegisterDomainInput) {
    if (!await sitePlatformRepository.getSite(input.siteId)) return null;
    const domain = newDomainVerification(input);
    await this.write((store) => { store.domains.push(domain); });
    return domain;
  }
  async refreshDomain(input: { domainId: string }) {
    const existing = await this.getDomainById(input.domainId);
    if (!existing) return null;
    let result: DomainRecord | null = null;
    await this.write(async (store) => {
      const domain = store.domains.find((item) => item.id === input.domainId);
      if (!domain) return;
      const now = new Date();
      if (domain.ownershipProofStatus === "pending" && Date.parse(domain.expiresAt) <= now.getTime()) {
        Object.assign(domain, { status: "expired", updatedAt: now.toISOString() } satisfies Partial<DomainRecord>);
        result = structuredClone(domain);
        return;
      }
      const dns = await inspectDomainDns(domain);
      domain.routingStatus = dns.routing ? "active" : "pending";
      if (dns.ownershipProof && domain.ownershipProofStatus === "pending") {
        const conflict = store.domains.some((item) =>
          item.id !== domain.id && item.hostname === domain.hostname && item.ownershipProofStatus === "verified" &&
          !["expired", "conflict"].includes(item.status)
        );
        if (conflict) {
          Object.assign(domain, { status: "conflict", updatedAt: now.toISOString() } satisfies Partial<DomainRecord>);
          result = structuredClone(domain);
          return;
        }
        domain.ownershipProofStatus = "verified";
        domain.ownershipVerifiedAt = now.toISOString();
        domain.status = "provisioning";
      }
      if (domain.ownershipProofStatus === "pending") {
        domain.updatedAt = now.toISOString();
        result = structuredClone(domain);
        return;
      }
      try {
        const observation = domain.providerHostnameId
          ? await refreshCustomHostnameStatus({ hostname: domain.hostname, providerHostnameId: domain.providerHostnameId })
          : await registerCustomHostname({ hostname: domain.hostname });
        Object.assign(domain, applyProviderObservation(domain, observation, now));
      } catch (error) {
        Object.assign(domain, applyProviderExecutionFailure(domain, error, now));
      }
      if (domain.routingStatus !== "active" && domain.status === "active") {
        domain.status = "attention_required";
        domain.attentionRequiredAt ??= now.toISOString();
      }
      result = structuredClone(domain);
    });
    return result;
  }
  async listDomains(siteId?: string) { return (await this.read()).domains.filter((item) => !siteId || item.siteId === siteId).sort(byCreatedDesc); }
  async getDomainById(id: string) { return structuredClone((await this.read()).domains.find((item) => item.id === id) ?? null); }
  async getDomainByHostname(hostname: string) { return structuredClone((await this.read()).domains.find((item) => item.hostname === hostname.toLowerCase() && item.status === "active") ?? null); }

  async upsertRedirect(input: UpsertSiteRedirectInput) {
    const now = new Date().toISOString();
    let result!: SiteRedirectRule;
    await this.write((store) => {
      const existing = store.redirects.find((item) => item.siteId === input.siteId && item.sourcePath === input.sourcePath);
      if (existing) {
        existing.destinationPath = input.destinationPath;
        existing.status = "active";
        existing.updatedAt = now;
        result = structuredClone(existing);
      } else {
        result = {
          id: `redirect_${crypto.randomUUID().replaceAll("-", "")}`,
          siteId: input.siteId,
          sourcePath: input.sourcePath,
          destinationPath: input.destinationPath,
          status: "active",
          createdAt: now,
          updatedAt: now
        };
        store.redirects.push(result);
      }
    });
    return result;
  }
  async setRedirectStatus(input: { redirectId: string; status: SiteRedirectRule["status"] }) {
    let result: SiteRedirectRule | null = null;
    await this.write((store) => {
      const redirect = store.redirects.find((item) => item.id === input.redirectId);
      if (!redirect) return;
      redirect.status = input.status;
      redirect.updatedAt = new Date().toISOString();
      result = structuredClone(redirect);
    });
    return result;
  }
  async listRedirects(siteId: string) { return (await this.read()).redirects.filter((item) => item.siteId === siteId).sort(byCreatedDesc); }
  async getRedirectById(redirectId: string) { return structuredClone((await this.read()).redirects.find((item) => item.id === redirectId) ?? null); }
  async resolveRedirect(siteId: string, sourcePath: string) {
    return structuredClone((await this.read()).redirects.find((item) => item.siteId === siteId && item.sourcePath === sourcePath && item.status === "active") ?? null);
  }

  async upsertProspect(input: UpsertProspectInput) {
    let result!: Prospect;
    await this.write((store) => {
      const canonicalKey = normalizedCanonicalKey(input.canonicalKey);
      const existing = store.researchProspects.find((item) => item.canonicalKey === canonicalKey || item.id === input.id);
      result = prospectValue(input, existing);
      if (existing) Object.assign(existing, result);
      else store.researchProspects.push(result);
    });
    return structuredClone(result);
  }
  async getProspect(prospectId: string) {
    return structuredClone((await this.read()).researchProspects.find((item) => item.id === prospectId) ?? null);
  }
  async listProspectCandidates(input: ProspectCandidateQuery = {}) {
    const store = await this.read();
    const offset = prospectQueryOffset(input.offset);
    return store.researchProspects
      .map((prospect) => prospectCandidateValue(
        prospect,
        store.prospectObservations,
        store.prospectContacts,
        store.prospectLocations,
        store.prospectLicenses
      ))
      .filter((candidate) => matchesProspectQuery(candidate, input))
      .sort((left, right) => compareProspectCandidates(left, right, input))
      .slice(offset, offset + prospectQueryLimit(input.limit))
      .map((candidate) => structuredClone(candidate));
  }
  async countProspectCandidates(input: ProspectCandidateQuery = {}) {
    const store = await this.read();
    return store.researchProspects
      .map((prospect) => prospectCandidateValue(
        prospect,
        store.prospectObservations,
        store.prospectContacts,
        store.prospectLocations,
        store.prospectLicenses
      ))
      .filter((candidate) => matchesProspectQuery(candidate, input))
      .length;
  }
  async upsertProspectLocation(input: UpsertProspectLocationInput) {
    let result!: ProspectLocation;
    await this.write((store) => {
      if (!store.researchProspects.some((item) => item.id === input.prospectId)) throw new Error("Unknown prospect.");
      const id = input.id ?? prospectLocationId(input.prospectId, input.canonicalKey);
      const existing = store.prospectLocations.find((item) =>
        item.id === id || (item.prospectId === input.prospectId && item.canonicalKey === normalizedCanonicalKey(input.canonicalKey))
      );
      result = prospectLocationValue({ ...input, id }, existing);
      if (input.isPrimary) {
        for (const location of store.prospectLocations) {
          if (location.prospectId === input.prospectId && location.id !== result.id) location.isPrimary = false;
        }
      }
      if (existing) Object.assign(existing, result);
      else store.prospectLocations.push(result);
    });
    return structuredClone(result);
  }
  async listProspectLocations(prospectId: string) {
    return (await this.read()).prospectLocations
      .filter((item) => item.prospectId === prospectId)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }
  async upsertProspectLicense(input: UpsertProspectLicenseInput) {
    let result!: ProspectLicense;
    await this.write((store) => {
      if (!store.researchProspects.some((item) => item.id === input.prospectId)) throw new Error("Unknown prospect.");
      if (input.locationId && !store.prospectLocations.some((item) =>
        item.id === input.locationId && item.prospectId === input.prospectId
      )) throw new Error("License location does not belong to the prospect.");
      if (!store.prospectSources.some((item) => item.id === input.sourceId)) throw new Error("Unknown prospect source.");
      const id = input.id ?? prospectLicenseId(input);
      const existing = store.prospectLicenses.find((item) => item.id === id);
      result = prospectLicenseValue({ ...input, id }, existing);
      if (existing) Object.assign(existing, result);
      else store.prospectLicenses.push(result);
    });
    return structuredClone(result);
  }
  async listProspectLicenses(prospectId: string) {
    return (await this.read()).prospectLicenses
      .filter((item) => item.prospectId === prospectId)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }
  async upsertProspectAffiliation(input: UpsertProspectAffiliationInput) {
    let result!: ProspectAffiliation;
    await this.write((store) => {
      if (!store.researchProspects.some((item) => item.id === input.prospectId)) throw new Error("Unknown prospect.");
      if (input.relatedProspectId && !store.researchProspects.some((item) => item.id === input.relatedProspectId)) {
        throw new Error("Unknown related prospect.");
      }
      const id = input.id ?? prospectAffiliationId(input);
      const existing = store.prospectAffiliations.find((item) => item.id === id);
      result = prospectAffiliationValue({ ...input, id }, existing);
      if (existing) Object.assign(existing, result);
      else store.prospectAffiliations.push(result);
    });
    return structuredClone(result);
  }
  async listProspectAffiliations(prospectId: string) {
    return (await this.read()).prospectAffiliations
      .filter((item) => item.prospectId === prospectId)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }
  async upsertProspectSource(input: UpsertProspectSourceInput) {
    let result!: ProspectSource;
    await this.write((store) => {
      const existing = store.prospectSources.find((item) => item.id === input.id);
      result = prospectSourceValue(input, existing);
      if (existing) Object.assign(existing, result);
      else store.prospectSources.push(result);
    });
    return structuredClone(result);
  }
  async listProspectSources(vertical?: string) {
    return (await this.read()).prospectSources
      .filter((item) => !vertical || item.vertical === vertical)
      .sort((left, right) => left.jurisdiction.localeCompare(right.jurisdiction) || left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }
  async upsertProspectSourceRun(input: UpsertProspectSourceRunInput) {
    let result!: ProspectSourceRun;
    await this.write((store) => {
      if (!store.prospectSources.some((item) => item.id === input.sourceId)) throw new Error("Unknown prospect source.");
      const existing = store.prospectSourceRuns.find((item) => item.id === input.id);
      result = prospectSourceRunValue(input, existing);
      if (existing) Object.assign(existing, result);
      else store.prospectSourceRuns.push(result);
    });
    return structuredClone(result);
  }
  async listProspectSourceRuns(sourceId?: string) {
    return (await this.read()).prospectSourceRuns
      .filter((item) => !sourceId || item.sourceId === sourceId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }
  async pruneProspectSourceSnapshots(input: Array<{ sourceId: string; retainedCanonicalKeys: string[] }>) {
    const counts = {
      prospects: 0,
      locations: 0,
      licenses: 0,
      affiliations: 0,
      observations: 0,
      contacts: 0
    };
    const retainedBySource = new Map(input.map((snapshot) => [
      snapshot.sourceId,
      new Set(snapshot.retainedCanonicalKeys.map(normalizedCanonicalKey))
    ]));
    await this.write((store) => {
      const removableProspectIds = new Set(store.researchProspects
        .filter((prospect) => {
          const sourceId = typeof prospect.metadata?.acquisitionSource === "string"
            ? prospect.metadata.acquisitionSource
            : undefined;
          if (!sourceId) return false;
          const retained = retainedBySource.get(sourceId);
          return retained ? !retained.has(normalizedCanonicalKey(prospect.canonicalKey)) : false;
        })
        .map((prospect) => prospect.id));
      if (!removableProspectIds.size) return;

      const selectedProspect = store.prospects.find((prospect) => removableProspectIds.has(prospect.prospectId));
      if (selectedProspect) {
        throw new Error(`Cannot prune prospect ${selectedProspect.prospectId}; it is selected into outbound work.`);
      }
      const linkedObservation = store.prospectObservations.find((observation) =>
        removableProspectIds.has(observation.prospectId)
        && Boolean(observation.websiteAssessmentId || observation.prospectReportId)
      );
      if (linkedObservation) {
        throw new Error(`Cannot prune prospect ${linkedObservation.prospectId}; its observation is linked to a report or assessment.`);
      }

      const before = {
        prospects: store.researchProspects.length,
        locations: store.prospectLocations.length,
        licenses: store.prospectLicenses.length,
        affiliations: store.prospectAffiliations.length,
        observations: store.prospectObservations.length,
        contacts: store.prospectContacts.length
      };
      store.prospectAffiliations = store.prospectAffiliations.filter((affiliation) =>
        !removableProspectIds.has(affiliation.prospectId)
        && (!affiliation.relatedProspectId || !removableProspectIds.has(affiliation.relatedProspectId))
      );
      store.prospectContacts = store.prospectContacts.filter((contact) => !removableProspectIds.has(contact.prospectId));
      store.prospectObservations = store.prospectObservations.filter((observation) =>
        !removableProspectIds.has(observation.prospectId)
      );
      store.prospectLicenses = store.prospectLicenses.filter((license) => !removableProspectIds.has(license.prospectId));
      store.prospectLocations = store.prospectLocations.filter((location) => !removableProspectIds.has(location.prospectId));
      store.researchProspects = store.researchProspects.filter((prospect) => !removableProspectIds.has(prospect.id));
      counts.prospects = before.prospects - store.researchProspects.length;
      counts.locations = before.locations - store.prospectLocations.length;
      counts.licenses = before.licenses - store.prospectLicenses.length;
      counts.affiliations = before.affiliations - store.prospectAffiliations.length;
      counts.observations = before.observations - store.prospectObservations.length;
      counts.contacts = before.contacts - store.prospectContacts.length;
    });
    return counts;
  }
  async createProspectObservation(input: CreateProspectObservationInput) {
    let result!: ProspectObservation;
    await this.write((store) => {
      if (!store.researchProspects.some((item) => item.id === input.prospectId)) throw new Error("Unknown prospect.");
      const existing = store.prospectObservations.find((item) => item.prospectId === input.prospectId && item.inputHash === input.inputHash);
      if (existing) {
        result = structuredClone(existing);
        return;
      }
      result = prospectObservationValue(input);
      store.prospectObservations.push(result);
    });
    return structuredClone(result);
  }
  async upsertProspectContact(input: UpsertProspectContactInput) {
    let result!: ProspectContact;
    await this.write((store) => {
      if (!store.researchProspects.some((item) => item.id === input.prospectId)) throw new Error("Unknown prospect.");
      const id = input.id ?? prospectContactId(input);
      const existing = findExistingProspectContact(store.prospectContacts, input, id);
      result = prospectContactValue({ ...input, id }, existing);
      if (existing) Object.assign(existing, result);
      else store.prospectContacts.push(result);
    });
    return structuredClone(result);
  }
  async listProspectContacts(prospectId: string) {
    return (await this.read()).prospectContacts
      .filter((item) => item.prospectId === prospectId)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .map((item) => structuredClone(item));
  }
  async importProspectResearch(records: ProspectImportRecord[]) {
    assertUniqueProspectImportRecords(records);
    const counts = {
      prospects: 0,
      locations: 0,
      licenses: 0,
      affiliations: 0,
      observations: 0,
      contacts: 0
    };
    await this.write((store) => {
      for (const record of records) {
        const existingProspect = store.researchProspects.find((item) =>
          item.canonicalKey === normalizedCanonicalKey(record.prospect.canonicalKey) || item.id === record.prospect.id
        );
        const prospect = prospectValue(record.prospect, existingProspect);
        if (existingProspect) Object.assign(existingProspect, prospect);
        else store.researchProspects.push(prospect);
        counts.prospects += 1;

        for (const locationInput of record.locations ?? []) {
          const normalizedLocation = { ...locationInput, prospectId: prospect.id };
          const id = normalizedLocation.id ?? prospectLocationId(prospect.id, normalizedLocation.canonicalKey);
          const existingLocation = store.prospectLocations.find((item) =>
            item.id === id || (item.prospectId === prospect.id
              && item.canonicalKey === normalizedCanonicalKey(normalizedLocation.canonicalKey))
          );
          const location = prospectLocationValue({ ...normalizedLocation, id }, existingLocation);
          if (location.isPrimary) {
            for (const candidate of store.prospectLocations) {
              if (candidate.prospectId === prospect.id && candidate.id !== location.id) candidate.isPrimary = false;
            }
          }
          if (existingLocation) Object.assign(existingLocation, location);
          else store.prospectLocations.push(location);
          counts.locations += 1;
        }
        for (const licenseInput of record.licenses ?? []) {
          const normalizedLicense = { ...licenseInput, prospectId: prospect.id };
          const id = normalizedLicense.id ?? prospectLicenseId(normalizedLicense);
          const existingLicense = store.prospectLicenses.find((item) => item.id === id);
          const license = prospectLicenseValue({ ...normalizedLicense, id }, existingLicense);
          if (existingLicense) Object.assign(existingLicense, license);
          else store.prospectLicenses.push(license);
          counts.licenses += 1;
        }
        for (const affiliationInput of record.affiliations ?? []) {
          const normalizedAffiliation = { ...affiliationInput, prospectId: prospect.id };
          const id = normalizedAffiliation.id ?? prospectAffiliationId(normalizedAffiliation);
          const existingAffiliation = store.prospectAffiliations.find((item) => item.id === id);
          const affiliation = prospectAffiliationValue({ ...normalizedAffiliation, id }, existingAffiliation);
          if (existingAffiliation) Object.assign(existingAffiliation, affiliation);
          else store.prospectAffiliations.push(affiliation);
          counts.affiliations += 1;
        }
        if (record.observation) {
          const observationInput = { ...record.observation, prospectId: prospect.id };
          const existingObservation = store.prospectObservations.find((item) =>
            item.prospectId === prospect.id && item.inputHash === observationInput.inputHash
          );
          if (!existingObservation) {
            store.prospectObservations.push(prospectObservationValue(observationInput));
            counts.observations += 1;
          }
        }
        for (const contactInput of record.contacts ?? []) {
          const normalizedContact = { ...contactInput, prospectId: prospect.id };
          const id = normalizedContact.id ?? prospectContactId(normalizedContact);
          const existingContact = findExistingProspectContact(store.prospectContacts, normalizedContact, id);
          const contact = prospectContactValue({ ...normalizedContact, id }, existingContact);
          if (existingContact) Object.assign(existingContact, contact);
          else store.prospectContacts.push(contact);
          counts.contacts += 1;
        }
      }
    });
    return counts;
  }

  async createOutboundCampaign(input: CreateOutboundCampaignInput) { const value = newOutboundCampaign(input); await this.write((s) => { const existing = s.campaigns.find((item) => item.id === value.id); if (!existing) s.campaigns.push(value); else Object.assign(value, existing); }); return value; }
  async listOutboundCampaigns() { return (await this.read()).campaigns.sort(byCreatedDesc); }
  async upsertOutboundProspect(input: UpsertOutboundProspectInput) {
    let result!: OutboundProspect;
    await this.write((store) => {
      const prospect = store.researchProspects.find((item) => item.id === input.prospectId);
      if (!prospect) throw new Error("Unknown canonical prospect.");
      if (prospect.doNotContact || prospect.status !== "active") throw new Error("Suppressed, converted, or archived prospects cannot be added to a campaign.");
      const observation = store.prospectObservations.find((item) => item.id === input.selectionObservationId && item.prospectId === prospect.id);
      if (!observation) throw new Error("Campaign selection must reference an observation for the canonical prospect.");
      const existing = input.id ? store.prospects.find((item) => item.id === input.id) : undefined;
      const value = newOutboundProspect({
        ...input,
        businessName: prospect.businessName,
        vertical: prospect.vertical,
        sourceUrl: prospect.websiteUrl
      });
      if (existing) { Object.assign(existing, value, { createdAt: existing.createdAt, metadata: input.metadata ?? existing.metadata }); result = structuredClone(existing); }
      else { result = value; store.prospects.push(result); }
    });
    return result;
  }
  async getOutboundProspect(prospectId: string) { return structuredClone((await this.read()).prospects.find((item) => item.id === prospectId) ?? null); }
  async listOutboundProspects(campaignId?: string) { return (await this.read()).prospects.filter((item) => !campaignId || item.campaignId === campaignId).sort(byCreatedDesc); }
  async findOutboundProspectByPreviewId(previewId: string) { return structuredClone((await this.read()).prospects.find((item) => item.previewId === previewId) ?? null); }
  async findOutboundProspectByReportId(reportId: string) { return structuredClone((await this.read()).prospects.find((item) => item.reportId === reportId) ?? null); }
  async attachOutboundProspectReport(prospectId: string, reportId: string) {
    let result: OutboundProspect | null = null;
    await this.write((store) => {
      const prospect = store.prospects.find((item) => item.id === prospectId);
      if (!prospect) return;
      prospect.reportId = reportId;
      prospect.firstReportViewedAt = undefined;
      result = structuredClone(prospect);
    });
    return result;
  }
  async recordOutboundReportView(reportId: string, occurredAt = new Date().toISOString()) {
    let recorded = false;
    await this.write((store) => {
      const prospect = store.prospects.find((item) => item.reportId === reportId);
      if (!prospect || prospect.firstReportViewedAt) return;
      prospect.firstReportViewedAt = occurredAt;
      store.events.push(newOutboundEvent({
        campaignId: prospect.campaignId,
        prospectId: prospect.id,
        siteId: prospect.siteId,
        type: "report_viewed",
        occurredAt,
        metadata: { reportId }
      }));
      recorded = true;
    });
    return recorded;
  }
  async recordOutboundEvent(input: RecordOutboundEventInput) {
    const event = newOutboundEvent(input);
    await this.write((store) => {
      store.events.push(event);
      const prospect = event.prospectId
        ? store.prospects.find((item) => item.id === event.prospectId)
        : store.prospects.find((item) => item.campaignId === event.campaignId && item.siteId === event.siteId);
      if (prospect) applyOutboundEventToProspect(prospect, event);
    });
    return event;
  }
  async listOutboundEvents(campaignId?: string) { return (await this.read()).events.filter((item) => !campaignId || item.campaignId === campaignId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)); }
  async outboundSummary(campaignId?: string) { return summarizeOutbound(await this.listOutboundCampaigns(), await this.listOutboundProspects(campaignId), await this.listOutboundEvents(campaignId), campaignId); }

  async createProspectReport(input: CreateProspectReportInput) {
    const now = new Date().toISOString();
    const report: ProspectReportRecord = { id: input.id ?? `prospect_report_${crypto.randomUUID().replaceAll("-", "")}`, sourceKey: input.sourceKey, accessPolicy: input.accessPolicy, status: "queued", assessmentId: input.assessmentId, sourceUrl: input.sourceUrl, sourceHost: input.sourceHost, websiteKind: input.websiteKind, businessStrength: input.businessStrength, resolutionUsage: input.resolutionUsage, createdAt: now, updatedAt: now };
    await this.write((store) => { store.reports.push(report); });
    return report;
  }
  async getProspectReport(id: string) { return structuredClone((await this.read()).reports.find((item) => item.id === id) ?? null); }
  async listProspectReports(limit = 50) { return (await this.read()).reports.sort(byCreatedDesc).slice(0, Math.max(1, Math.min(limit, 500))); }
  async findActiveProspectReportBySourceKey(sourceKey: string, accessPolicy: ProspectReportAccessPolicy) { return structuredClone((await this.read()).reports.filter((item) => item.sourceKey === sourceKey && item.accessPolicy === accessPolicy && ["queued", "running"].includes(item.status)).sort(byCreatedDesc)[0] ?? null); }
  async findReusableProspectReportBySourceKey(sourceKey: string, accessPolicy: ProspectReportAccessPolicy, since: string) { return structuredClone((await this.read()).reports.filter((item) => item.sourceKey === sourceKey && item.accessPolicy === accessPolicy && item.status === "completed" && (item.completedAt ?? "") >= since).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0] ?? null); }
  async updateProspectReport(input: UpdateProspectReportInput) {
    let result: ProspectReportRecord | null = null;
    await this.write((store) => {
      const report = store.reports.find((item) => item.id === input.reportId);
      if (!report) return;
      Object.assign(report, Object.fromEntries(Object.entries(input).filter(([key, value]) => !["reportId", "clearError"].includes(key) && value !== undefined)), { updatedAt: new Date().toISOString() });
      if (input.clearError) delete report.errorCode;
      result = structuredClone(report);
    });
    return result;
  }
  async createProspectReportLead(input: CreateProspectReportLeadInput) {
    if (!await this.getProspectReport(input.reportId)) return null;
    let result!: ProspectReportLead;
    await this.write((store) => {
      const email = input.email.trim().toLowerCase();
      const existing = store.leads.find((item) => item.reportId === input.reportId && item.email.toLowerCase() === email);
      if (existing) {
        existing.contactName = input.contactName ?? existing.contactName;
        existing.phone = input.phone ?? existing.phone;
        existing.ipHash = input.ipHash ?? existing.ipHash;
        existing.metadata = { ...existing.metadata, ...input.metadata };
        result = structuredClone(existing);
        return;
      }
      const lead: ProspectReportLead = { id: `prospect_lead_${crypto.randomUUID().replaceAll("-", "")}`, reportId: input.reportId, email, contactName: input.contactName, phone: input.phone, ipHash: input.ipHash, metadata: input.metadata, createdAt: new Date().toISOString() };
      store.leads.push(lead);
      result = structuredClone(lead);
    });
    return result;
  }
  async createProspectReportAccessGrant(input: { reportId: string; leadId: string; tokenHash: string; expiresAt: string }) {
    const grant: ProspectReportAccessGrant = {
      id: `prospect_report_grant_${crypto.randomUUID().replaceAll("-", "")}`,
      ...input,
      createdAt: new Date().toISOString()
    };
    await this.write((store) => { store.reportAccessGrants.push(grant); });
    return structuredClone(grant);
  }
  async findActiveProspectReportAccessGrant(reportId: string, tokenHash: string) {
    return structuredClone((await this.read()).reportAccessGrants.find((grant) =>
      grant.reportId === reportId
      && grant.tokenHash === tokenHash
      && Date.parse(grant.expiresAt) > Date.now()
    ) ?? null);
  }
  async markProspectReportAccessGrantUsed(grantId: string) {
    await this.write((store) => {
      const grant = store.reportAccessGrants.find((item) => item.id === grantId);
      if (grant) grant.lastUsedAt = new Date().toISOString();
    });
  }
  async createWebsiteAssessment(input: CreateWebsiteAssessmentInput) {
    const now = new Date().toISOString();
    const assessment: WebsiteAssessmentRecord = {
      id: input.id ?? `website_assessment_${crypto.randomUUID().replaceAll("-", "")}`,
      status: "queued",
      targetKind: input.targetKind,
      sourceKey: input.sourceKey,
      sourceUrl: input.sourceUrl,
      siteId: input.siteId,
      artifactId: input.artifactId,
      versionId: input.versionId,
      rubricIdentity: input.rubricIdentity,
      scannerIdentity: input.scannerIdentity,
      createdAt: now,
      updatedAt: now
    };
    await this.write((store) => { store.websiteAssessments.push(assessment); });
    return assessment;
  }
  async getWebsiteAssessment(assessmentId: string) {
    return structuredClone((await this.read()).websiteAssessments.find((item) => item.id === assessmentId) ?? null);
  }
  async listWebsiteAssessments(input: { siteId?: string; sourceKey?: string; ids?: string[]; limit?: number } = {}) {
    const ids = input.ids ? new Set(input.ids.slice(0, 500)) : undefined;
    return (await this.read()).websiteAssessments
      .filter((item) => (!input.siteId || item.siteId === input.siteId) && (!input.sourceKey || item.sourceKey === input.sourceKey) && (!ids || ids.has(item.id)))
      .sort(byCreatedDesc)
      .slice(0, Math.max(1, Math.min(input.limit ?? 100, 500)));
  }
  async updateWebsiteAssessment(input: UpdateWebsiteAssessmentInput) {
    let result: WebsiteAssessmentRecord | null = null;
    await this.write((store) => {
      const assessment = store.websiteAssessments.find((item) => item.id === input.assessmentId);
      if (!assessment) return;
      if (assessment.status === "completed" && (input.assessment || input.status && input.status !== "completed")) {
        throw new Error("Completed website assessments are immutable.");
      }
      Object.assign(assessment, Object.fromEntries(Object.entries(input).filter(([key, value]) => !["assessmentId", "clearError"].includes(key) && value !== undefined)), { updatedAt: new Date().toISOString() });
      if (input.clearError) delete assessment.errorCode;
      result = structuredClone(assessment);
    });
    return result;
  }
  async enqueueWebsiteAssessmentJob(input: { assessmentId: string; prospectReportId?: string }) {
    const now = new Date().toISOString();
    const job: WebsiteAssessmentJob = { id: `website_assessment_job_${crypto.randomUUID().replaceAll("-", "")}`, assessmentId: input.assessmentId, prospectReportId: input.prospectReportId, status: "queued", attempts: 0, maxAttempts: 2, runAfter: now, createdAt: now, updatedAt: now };
    await this.write((store) => { store.websiteAssessmentJobs.push(job); });
    return job;
  }
  async claimNextWebsiteAssessmentJob(workerId: string) {
    let result: WebsiteAssessmentJob | null = null;
    await this.write((store) => {
      const staleBefore = Date.now() - 30 * 60_000;
      const job = store.websiteAssessmentJobs
        .filter((item) => (item.status === "queued" && item.runAfter <= new Date().toISOString()) || (item.status === "running" && item.updatedAt && Date.parse(item.updatedAt) < staleBefore))
        .sort(byCreatedDesc)
        .at(-1);
      if (!job) return;
      job.status = "running"; job.attempts += 1; job.lockedBy = workerId; job.updatedAt = new Date().toISOString(); result = structuredClone(job);
    });
    return result;
  }
  async completeWebsiteAssessmentJob(jobId: string) { await this.write((store) => { const job = store.websiteAssessmentJobs.find((item) => item.id === jobId); if (job) { job.status = "completed"; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt; } }); }
  async failWebsiteAssessmentJob(jobId: string, error: string) { await this.write((store) => { const job = store.websiteAssessmentJobs.find((item) => item.id === jobId); if (!job) return; job.error = error; job.status = job.attempts < job.maxAttempts ? "queued" : "failed"; job.runAfter = new Date(Date.now() + 30_000).toISOString(); job.lockedBy = undefined; job.completedAt = job.status === "failed" ? new Date().toISOString() : undefined; job.updatedAt = new Date().toISOString(); }); }

  private async read() {
    const raw = await readFile(this.path, "utf8").catch(() => undefined);
    if (!raw) return emptyState();
    const state = { ...emptyState(), ...JSON.parse(raw) as Partial<LocalState> };
    state.researchProspects = state.researchProspects.map((prospect) => ({
      ...prospect,
      ownershipScope: prospect.ownershipScope ?? "unknown"
    }));
    return state;
  }
  private write(operation: (state: LocalState) => void | Promise<void>) {
    const next = this.queue.then(async () => { const state = await this.read(); await operation(state); await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`); await rename(temp, this.path); });
    this.queue = next.catch(() => undefined); return next;
  }
}

type AdoptionInvitationRow = { id: string; site_id: string; token_hash: string; expires_at: string; created_at: string; consumed_at: string | null; consumed_by_user_id: string | null };
type WebsiteSetupRow = { id: string; owner_user_id: string; source_url: string; normalized_source: string; reporting_timezone: string; prospect_report_id: string | null; source_revision: number; status: WebsiteSetup["status"]; site_id: string | null; session_id: string | null; run_id: string | null; attempts: number; max_attempts: number; idempotency_key: string; creation_request_hash: string; locked_by: string | null; locked_at: string | null; failure_code: WebsiteSetupFailureCode | null; failure_reason: string | null; created_at: string; updated_at: string };
type PreviewGrantRow = {
  id: string;
  site_id: string;
  site_version_id: string;
  secret_hash: string;
  key_version: string;
  secret_version: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};
type DomainRow = {
  id: string;
  site_id: string;
  hostname: string;
  status: DomainRecord["status"];
  ownership_proof_status: DomainRecord["ownershipProofStatus"];
  routing_status: DomainRecord["routingStatus"];
  provider_status: DomainRecord["providerStatus"];
  certificate_status: DomainRecord["certificateStatus"];
  verification_name: string;
  verification_value: string;
  routing_name: string;
  routing_target: string;
  expires_at: string;
  provider_hostname_id: string | null;
  ownership_verified_at: string | null;
  activated_at: string | null;
  attention_required_at: string | null;
  provider_invalid_count: number;
  first_provider_invalid_at: string | null;
  last_provider_invalid_at: string | null;
  execution_failure_count: number;
  last_execution_error: string | null;
  created_at: string;
  updated_at: string;
};
type RedirectRow = { id: string; site_id: string; source_path: string; destination_path: string; status: SiteRedirectRule["status"]; created_at: string; updated_at: string };
type CampaignRow = { id: string; name: string; channel: OutboundCampaign["channel"]; status: OutboundCampaign["status"]; metadata: unknown; created_at: string; started_at: string | null; ended_at: string | null };
type ProspectResearchRow = {
  id: string;
  canonical_key: string;
  business_name: string;
  legal_business_name: string | null;
  dba_name: string | null;
  vertical: string | null;
  industry_code: string | null;
  ownership_scope: Prospect["ownershipScope"];
  status: Prospect["status"];
  website_kind: Prospect["websiteKind"];
  website_url: string | null;
  website_host: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  phone: string | null;
  do_not_contact: boolean;
  suppression_reason: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};
type ProspectLocationRow = {
  id: string;
  prospect_id: string;
  canonical_key: string;
  kind: ProspectLocation["kind"];
  status: ProspectLocation["status"];
  location_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  county: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_primary: boolean;
  source_id: string | null;
  source_run_id: string | null;
  source_record_key: string | null;
  observed_at: string;
  created_at: string;
  updated_at: string;
};
type ProspectLicenseRow = {
  id: string;
  prospect_id: string;
  location_id: string | null;
  jurisdiction: string;
  regulator: string;
  license_type: string;
  license_number: string;
  status: ProspectLicense["status"];
  classifications: string[];
  issued_at: string | null;
  renewed_at: string | null;
  expires_at: string | null;
  responsible_person_name: string | null;
  responsible_person_title: string | null;
  source_id: string;
  source_run_id: string | null;
  source_url: string;
  source_record_key: string | null;
  observed_at: string;
  evidence: unknown;
  created_at: string;
  updated_at: string;
};
type ProspectAffiliationRow = {
  id: string;
  prospect_id: string;
  related_prospect_id: string | null;
  related_organization_name: string;
  affiliation_type: ProspectAffiliation["affiliationType"];
  confidence: ProspectAffiliation["confidence"];
  source_url: string | null;
  observed_at: string;
  evidence: unknown;
  created_at: string;
  updated_at: string;
};
type ProspectSourceRow = {
  id: string;
  vertical: string;
  jurisdiction: string;
  authority_name: string;
  source_name: string;
  source_url: string;
  access_method: ProspectSource["accessMethod"];
  coverage_status: ProspectSource["coverageStatus"];
  record_scope: ProspectSource["recordScope"];
  refresh_cadence: string | null;
  expected_record_count: number | null;
  access_notes: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};
type ProspectSourceRunRow = {
  id: string;
  source_id: string;
  status: ProspectSourceRun["status"];
  started_at: string;
  finished_at: string | null;
  snapshot_at: string | null;
  source_hash: string | null;
  records_seen: number;
  organizations_upserted: number;
  locations_upserted: number;
  licenses_upserted: number;
  contacts_upserted: number;
  rejected_records: number;
  error: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};
type ProspectObservationRow = {
  id: string;
  schema_version: 1;
  prospect_id: string;
  source_type: ProspectObservation["sourceType"];
  source_url: string | null;
  observed_at: string;
  website_kind: ProspectObservation["websiteKind"];
  website_url: string | null;
  review_rating: number | null;
  review_count: number | null;
  years_in_business: number | null;
  cms: string | null;
  site_builder: string | null;
  managed_provider: string | null;
  agency_status: ProspectObservation["agencyStatus"];
  agency_name: string | null;
  website_assessment_id: string | null;
  prospect_report_id: string | null;
  business_strength_score: number | null;
  website_opportunity_score: number | null;
  reachability_score: number | null;
  priority_score: number | null;
  scoring_model: string | null;
  verification_status: ProspectObservation["verificationStatus"];
  verification_score: number | null;
  operating_status: ProspectObservation["operatingStatus"];
  target_fit_status: ProspectObservation["targetFitStatus"];
  target_fit_reason: string | null;
  evidence_coverage: number;
  producer: string;
  methodology_identity: string;
  input_hash: string;
  notes: string | null;
  evidence: unknown;
  created_at: string;
};
type ProspectContactRow = {
  id: string;
  prospect_id: string;
  contact_type: ProspectContact["contactType"];
  full_name: string | null;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  source_type: ProspectContact["sourceType"];
  source_url: string | null;
  verification_status: ProspectContact["verificationStatus"];
  outreach_eligible: boolean;
  observed_at: string;
  suppressed_at: string | null;
  suppression_reason: string | null;
  created_at: string;
  updated_at: string;
};
type ProspectCurrentRow = ProspectResearchRow & {
  latest_observation_id: string | null;
  latest_observed_at: string | null;
  review_rating: number | null;
  review_count: number | null;
  years_in_business: number | null;
  cms: string | null;
  site_builder: string | null;
  managed_provider: string | null;
  agency_status: ProspectObservation["agencyStatus"] | null;
  agency_name: string | null;
  website_assessment_id: string | null;
  prospect_report_id: string | null;
  business_strength_score: number | null;
  website_opportunity_score: number | null;
  reachability_score: number | null;
  priority_score: number | null;
  scoring_model: string | null;
  verification_status: ProspectObservation["verificationStatus"] | null;
  verification_score: number | null;
  operating_status: ProspectObservation["operatingStatus"] | null;
  target_fit_status: ProspectObservation["targetFitStatus"] | null;
  target_fit_reason: string | null;
  evidence_coverage: number | null;
  owner_name: string | null;
  public_email: string | null;
  contact_count: number;
  location_count: number;
  active_license_count: number;
};
type ProspectRow = { id: string; prospect_id: string; selection_observation_id: string; campaign_id: string; site_id: string | null; report_id: string | null; preview_id: string | null; mailing_code: string | null; status: OutboundProspect["status"]; metadata: unknown; created_at: string; mailed_at: string | null; first_report_viewed_at: string | null; first_preview_viewed_at: string | null; adoption_started_at: string | null; adopted_at: string | null; published_at: string | null; disqualified_at: string | null };
type EventRow = { id: string; campaign_id: string; prospect_id: string | null; site_id: string | null; type: OutboundEvent["type"]; occurred_at: string; value: number | null; metadata: unknown };
type ReportRow = { id: string; source_key: string; access_policy: ProspectReportRecord["accessPolicy"]; status: ProspectReportRecord["status"]; assessment_id: string | null; source_url: string | null; source_host: string | null; website_kind: ProspectReportRecord["websiteKind"]; report_json: unknown; business_strength_json: unknown; resolution_usage: unknown; error_code: string | null; created_at: string; updated_at: string; completed_at: string | null };
type LeadRow = { id: string; report_id: string; email: string; contact_name: string | null; phone: string | null; ip_hash: string | null; metadata: unknown; created_at: string };
type ReportAccessGrantRow = { id: string; report_id: string; lead_id: string; token_hash: string; expires_at: string; created_at: string; last_used_at: string | null };
type WebsiteAssessmentRow = { id: string; status: WebsiteAssessmentRecord["status"]; target_kind: WebsiteAssessmentRecord["targetKind"]; source_key: string; source_url: string | null; site_id: string | null; artifact_id: string | null; version_id: string | null; rubric_identity: string; scanner_identity: string; assessment_json: unknown; error_code: string | null; created_at: string; updated_at: string; completed_at: string | null };
type WebsiteAssessmentJobRow = { id: string; assessment_id: string; prospect_report_id: string | null; status: WebsiteAssessmentJob["status"]; error: string | null; attempts: number; max_attempts: number; run_after: string; locked_by: string | null; created_at: string; updated_at: string; completed_at: string | null };

class SupabasePlatformOperationsRepository implements PlatformOperationsRepository {
  private get client() { return getSupabaseAdminClient(); }

  async createAdoptionInvitation(input: { siteId: string; tokenHash: string; expiresAt: string }) {
    const row = await data<AdoptionInvitationRow>(this.client.from("adoption_invitations").insert({
      id: `invitation_${crypto.randomUUID().replaceAll("-", "")}`,
      site_id: input.siteId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt
    }).select("*").single(), "Create adoption invitation");
    return adoptionInvitationFromRow(row);
  }
  async findAdoptionInvitation(tokenHash: string) {
    const row = await maybe<AdoptionInvitationRow>(this.client.from("adoption_invitations").select("*")
      .eq("token_hash", tokenHash).is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle(), "Find adoption invitation");
    return row ? adoptionInvitationFromRow(row) : null;
  }
  async consumeAdoptionInvitation(input: { tokenHash: string; ownerUserId: string }) {
    const row = await maybe<AdoptionInvitationRow>(this.client.rpc("consume_adoption_invitation", {
      target_token_hash: input.tokenHash,
      target_owner_user_id: input.ownerUserId
    }).maybeSingle(), "Consume adoption invitation");
    return row ? adoptionInvitationFromRow(row) : null;
  }

  async createWebsiteSetup(input: CreateWebsiteSetupInput) {
    const result = await this.client.rpc("create_website_setup", {
      target_owner_user_id: input.ownerUserId,
      target_source_url: input.sourceUrl,
      target_normalized_source: input.normalizedSource,
      target_reporting_timezone: input.reportingTimezone,
      target_prospect_report_id: input.prospectReportId,
      target_idempotency_key: input.idempotencyKey,
      target_creation_request_hash: input.creationRequestHash
    }).maybeSingle();
    if (result.error) {
      if (/idempotency_key_conflict/i.test(result.error.message)) throw new IdempotencyKeyConflictError();
      if (/concurrent_project_limit/i.test(result.error.message)) throw new ConcurrentProjectLimitError();
      throw new Error(`Create website setup: ${result.error.message}`);
    }
    if (!result.data) throw new Error("Create website setup: no data returned");
    return websiteSetupFromRow(result.data as WebsiteSetupRow);
  }
  async getWebsiteSetup(setupId: string) { const row = await maybe<WebsiteSetupRow>(this.client.from("website_setups").select("*").eq("id", setupId).maybeSingle(), "Get website setup"); return row ? websiteSetupFromRow(row) : null; }
  async listWebsiteSetupsForOwner(ownerUserId: string) { return (await data<WebsiteSetupRow[]>(this.client.from("website_setups").select("*").eq("owner_user_id", ownerUserId).order("created_at", { ascending: false }), "List owner website setups")).map(websiteSetupFromRow); }
  async listWebsiteSetups(siteId?: string) { let query = this.client.from("website_setups").select("*").order("created_at", { ascending: false }); if (siteId) query = query.eq("site_id", siteId); return (await data<WebsiteSetupRow[]>(query, "List website setups")).map(websiteSetupFromRow); }
  async updateWebsiteSetupSource(input: WebsiteSetupSourceUpdate) {
    const result = await this.client.rpc("update_website_setup_source", {
      target_setup_id: input.setupId,
      target_owner_user_id: input.ownerUserId,
      target_source_url: input.sourceUrl,
      target_normalized_source: input.normalizedSource
    }).maybeSingle();
    if (result.error) {
      if (/concurrent_project_limit/i.test(result.error.message)) throw new ConcurrentProjectLimitError();
      throw new Error(`Update website setup source: ${result.error.message}`);
    }
    const row = result.data as WebsiteSetupRow | null;
    return row ? websiteSetupFromRow(row) : null;
  }
  async cancelWebsiteSetup(input: { setupId: string; ownerUserId: string }) {
    const row = await maybe<WebsiteSetupRow>(this.client.rpc("cancel_website_setup", {
      target_setup_id: input.setupId,
      target_owner_user_id: input.ownerUserId
    }).maybeSingle(), "Cancel website setup");
    return row ? websiteSetupFromRow(row) : null;
  }
  async retryWebsiteSetup(input: { setupId: string; ownerUserId: string }) {
    const result = await this.client.rpc("retry_website_setup", {
      target_setup_id: input.setupId,
      target_owner_user_id: input.ownerUserId
    }).maybeSingle();
    if (result.error) {
      if (/concurrent_project_limit/i.test(result.error.message)) throw new ConcurrentProjectLimitError();
      throw new Error(`Retry website setup: ${result.error.message}`);
    }
    const row = result.data as WebsiteSetupRow | null;
    return row ? websiteSetupFromRow(row) : null;
  }
  async claimWebsiteSetup(setupId: string, workerId: string) {
    const setup = await this.getWebsiteSetup(setupId);
    if (!setup || setup.status !== "queued") return null;
    const lockedAt = new Date().toISOString();
    const row = await maybe<WebsiteSetupRow>(
      this.client
        .from("website_setups")
        .update({
          status: "processing",
          attempts: setup.attempts + 1,
          locked_by: workerId,
          locked_at: lockedAt,
          updated_at: lockedAt
        })
        .eq("id", setup.id)
        .eq("status", "queued")
        .eq("source_revision", setup.sourceRevision)
        .eq("attempts", setup.attempts)
        .select("*")
        .maybeSingle(),
      "Claim website setup"
    );
    return row ? websiteSetupFromRow(row) : null;
  }
  async claimNextWebsiteSetup(workerId: string) { const row = await maybe<WebsiteSetupRow>(this.client.rpc("claim_next_website_setup", { worker_id: workerId }).maybeSingle(), "Claim website setup"); return row ? websiteSetupFromRow(row) : null; }
  async linkWebsiteSetup(input: { setupId: string; sourceRevision: number; siteId: string; sessionId: string; runId: string }) {
    const row = await maybe<WebsiteSetupRow>(this.client.rpc("link_website_setup", {
      target_setup_id: input.setupId,
      target_source_revision: input.sourceRevision,
      target_site_id: input.siteId,
      target_session_id: input.sessionId,
      target_run_id: input.runId
    }).maybeSingle(), "Link website setup");
    return row ? websiteSetupFromRow(row) : null;
  }
  async failWebsiteSetup(input: { setupId: string; sourceRevision: number; failureCode: WebsiteSetupFailureCode; failureReason: string; siteId?: string }) {
    const row = await maybe<WebsiteSetupRow>(this.client.from("website_setups").update({ status: "failed", site_id: input.siteId ?? null, failure_code: input.failureCode, failure_reason: input.failureReason, locked_by: null, locked_at: null, updated_at: new Date().toISOString() }).eq("id", input.setupId).eq("status", "processing").eq("source_revision", input.sourceRevision).select("*").maybeSingle(), "Fail website setup");
    return row ? websiteSetupFromRow(row) : null;
  }

  async createPreviewGrant(input: {
    id?: string;
    siteId: string;
    siteVersionId: string;
    secretHash: string;
    keyVersion: string;
    secretVersion?: number;
    expiresAt: string;
  }) {
    const version = await sitePlatformRepository.getSiteVersion(input.siteVersionId);
    if (!version || version.siteId !== input.siteId) throw new Error("Preview version does not belong to the site.");
    const row = await data<PreviewGrantRow>(this.client.from("preview_grants").upsert({
      id: input.id ?? `preview_${crypto.randomUUID().replaceAll("-", "")}`,
      site_id: input.siteId,
      site_version_id: input.siteVersionId,
      secret_hash: input.secretHash,
      key_version: input.keyVersion,
      secret_version: input.secretVersion ?? 1,
      expires_at: input.expiresAt
    }, { onConflict: "id", ignoreDuplicates: false }).select("*").single(), "Create preview grant");
    return previewGrantFromRow(row);
  }
  async getPreviewGrant(previewId: string) { const row = await maybe<PreviewGrantRow>(this.client.from("preview_grants").select("*").eq("id", previewId).maybeSingle(), "Get preview grant"); return row ? previewGrantFromRow(row) : null; }
  async listPreviewGrants(siteId?: string) { let query = this.client.from("preview_grants").select("*").order("created_at", { ascending: false }); if (siteId) query = query.eq("site_id", siteId); return (await data<PreviewGrantRow[]>(query, "List preview grants")).map(previewGrantFromRow); }
  async revokePreviewGrant(previewId: string) { const row = await maybe<PreviewGrantRow>(this.client.from("preview_grants").update({ revoked_at: new Date().toISOString() }).eq("id", previewId).is("revoked_at", null).select("*").maybeSingle(), "Revoke preview grant"); return row ? previewGrantFromRow(row) : this.getPreviewGrant(previewId); }

  async registerDomain(input: RegisterDomainInput) {
    if (!await sitePlatformRepository.getSite(input.siteId)) return null;
    const value = newDomainVerification(input);
    const row = await data<DomainRow>(this.client.from("domains").insert(domainToRow(value)).select("*").single(), "Register domain");
    return domainFromRow(row);
  }
  async refreshDomain(input: { domainId: string }) {
    let existing = await this.getDomainById(input.domainId);
    if (!existing) return null;
    const now = new Date();
    if (existing.ownershipProofStatus === "pending" && Date.parse(existing.expiresAt) <= now.getTime()) {
      return this.updateDomain({ ...existing, status: "expired", updatedAt: now.toISOString() });
    }

    let dns: Awaited<ReturnType<typeof inspectDomainDns>>;
    try {
      dns = await inspectDomainDns(existing);
    } catch (error) {
      return this.updateDomain(applyProviderExecutionFailure(existing, error, now));
    }
    existing = { ...existing, routingStatus: dns.routing ? "active" : "pending", updatedAt: now.toISOString() };

    if (dns.ownershipProof && existing.ownershipProofStatus === "pending") {
      const verified = await maybe<DomainRow>(this.client.rpc("claim_domain_ownership", {
        domain_id: existing.id,
        verified_at: now.toISOString()
      }).maybeSingle(), "Claim verified domain");
      if (!verified) return this.updateDomain({ ...existing, status: "conflict" });
      existing = { ...domainFromRow(verified), routingStatus: existing.routingStatus };
    }
    if (existing.ownershipProofStatus === "pending") return this.updateDomain(existing);

    let next: DomainRecord;
    try {
      const observation = existing.providerHostnameId
        ? await refreshCustomHostnameStatus({ hostname: existing.hostname, providerHostnameId: existing.providerHostnameId })
        : await registerCustomHostname({ hostname: existing.hostname });
      next = applyProviderObservation(existing, observation, now);
    } catch (error) {
      next = applyProviderExecutionFailure(existing, error, now);
    }
    if (next.routingStatus !== "active" && next.status === "active") {
      next = { ...next, status: "attention_required", attentionRequiredAt: next.attentionRequiredAt ?? now.toISOString() };
    }
    return this.updateDomain(next);
  }
  async listDomains(siteId?: string) { let query = this.client.from("domains").select("*").order("created_at", { ascending: false }); if (siteId) query = query.eq("site_id", siteId); return (await data<DomainRow[]>(query, "List domains")).map(domainFromRow); }
  async getDomainById(id: string) { const row = await maybe<DomainRow>(this.client.from("domains").select("*").eq("id", id).maybeSingle(), "Get domain"); return row ? domainFromRow(row) : null; }
  async getDomainByHostname(hostname: string) { const row = await maybe<DomainRow>(this.client.from("domains").select("*").eq("hostname", hostname.toLowerCase()).eq("status", "active").maybeSingle(), "Resolve domain"); return row ? domainFromRow(row) : null; }

  private async updateDomain(value: DomainRecord) {
    const row = await data<DomainRow>(this.client.from("domains").update(domainToRow(value)).eq("id", value.id).select("*").single(), "Update domain");
    return domainFromRow(row);
  }

  async upsertRedirect(input: UpsertSiteRedirectInput) {
    const now = new Date().toISOString();
    const row = await data<RedirectRow>(this.client.from("site_redirects").upsert({
      site_id: input.siteId,
      source_path: input.sourcePath,
      destination_path: input.destinationPath,
      status: "active",
      updated_at: now
    }, { onConflict: "site_id,source_path", ignoreDuplicates: false }).select("*").single(), "Upsert site redirect");
    return redirectFromRow(row);
  }
  async setRedirectStatus(input: { redirectId: string; status: SiteRedirectRule["status"] }) {
    const row = await maybe<RedirectRow>(this.client.from("site_redirects").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", input.redirectId).select("*").maybeSingle(), "Update site redirect");
    return row ? redirectFromRow(row) : null;
  }
  async listRedirects(siteId: string) { return (await data<RedirectRow[]>(this.client.from("site_redirects").select("*").eq("site_id", siteId).order("created_at", { ascending: false }), "List site redirects")).map(redirectFromRow); }
  async getRedirectById(id: string) { const row = await maybe<RedirectRow>(this.client.from("site_redirects").select("*").eq("id", id).maybeSingle(), "Get site redirect"); return row ? redirectFromRow(row) : null; }
  async resolveRedirect(siteId: string, sourcePath: string) { const row = await maybe<RedirectRow>(this.client.from("site_redirects").select("*").eq("site_id", siteId).eq("source_path", sourcePath).eq("status", "active").maybeSingle(), "Resolve site redirect"); return row ? redirectFromRow(row) : null; }

  async upsertProspect(input: UpsertProspectInput) {
    const canonicalKey = normalizedCanonicalKey(input.canonicalKey);
    const existing = await maybe<ProspectResearchRow>(this.client.from("prospects")
      .select("*")
      .eq("canonical_key", canonicalKey)
      .maybeSingle(), "Find canonical prospect");
    const value = prospectValue(input, existing ? prospectResearchFromRow(existing) : undefined);
    const row = await data<ProspectResearchRow>(this.client.from("prospects").upsert(prospectToRow(value), {
      onConflict: "canonical_key",
      ignoreDuplicates: false
    }).select("*").single(), "Upsert canonical prospect");
    return prospectResearchFromRow(row);
  }
  async getProspect(prospectId: string) {
    const row = await maybe<ProspectResearchRow>(this.client.from("prospects").select("*").eq("id", prospectId).maybeSingle(), "Get canonical prospect");
    return row ? prospectResearchFromRow(row) : null;
  }
  async listProspectCandidates(input: ProspectCandidateQuery = {}) {
    let query = this.client.from("prospect_current").select("*");
    if (input.search) query = query.ilike("business_name", `%${input.search.trim()}%`);
    if (input.vertical) query = query.eq("vertical", input.vertical);
    if (input.industryCode) query = query.eq("industry_code", input.industryCode);
    if (input.region) query = query.eq("region", input.region.toUpperCase());
    if (input.websiteKind) query = query.eq("website_kind", input.websiteKind);
    if (input.cms) query = query.eq("cms", input.cms);
    if (input.managedProvider) query = query.eq("managed_provider", input.managedProvider);
    if (input.agencyStatus) query = query.eq("agency_status", input.agencyStatus);
    if (input.verificationStatus) query = query.eq("verification_status", input.verificationStatus);
    if (input.operatingStatus) query = query.eq("operating_status", input.operatingStatus);
    if (input.targetFitStatus) query = query.eq("target_fit_status", input.targetFitStatus);
    if (input.ownershipScope) query = query.eq("ownership_scope", input.ownershipScope);
    if (input.minimumLocationCount !== undefined) query = query.gte("location_count", input.minimumLocationCount);
    if (input.minimumActiveLicenseCount !== undefined) query = query.gte("active_license_count", input.minimumActiveLicenseCount);
    if (input.minimumReviewCount !== undefined) query = query.gte("review_count", input.minimumReviewCount);
    if (input.minimumPriorityScore !== undefined) query = query.gte("priority_score", input.minimumPriorityScore);
    if (input.minimumVerificationScore !== undefined) query = query.gte("verification_score", input.minimumVerificationScore);
    const sortColumn = prospectSortColumn(input.sortBy);
    const ascending = (input.sortDirection ?? defaultProspectSortDirection(input.sortBy)) === "asc";
    const offset = prospectQueryOffset(input.offset);
    const limit = prospectQueryLimit(input.limit);
    query = query.order(sortColumn, { ascending, nullsFirst: false });
    if (sortColumn !== "business_name") query = query.order("business_name", { ascending: true });
    const rows = await data<ProspectCurrentRow[]>(query
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1), "List prospect candidates");
    return rows.map(prospectCandidateFromRow);
  }
  async countProspectCandidates(input: ProspectCandidateQuery = {}) {
    let query = this.client.from("prospect_current").select("id", { count: "exact", head: true });
    if (input.search) query = query.ilike("business_name", `%${input.search.trim()}%`);
    if (input.vertical) query = query.eq("vertical", input.vertical);
    if (input.industryCode) query = query.eq("industry_code", input.industryCode);
    if (input.region) query = query.eq("region", input.region.toUpperCase());
    if (input.websiteKind) query = query.eq("website_kind", input.websiteKind);
    if (input.cms) query = query.eq("cms", input.cms);
    if (input.managedProvider) query = query.eq("managed_provider", input.managedProvider);
    if (input.agencyStatus) query = query.eq("agency_status", input.agencyStatus);
    if (input.verificationStatus) query = query.eq("verification_status", input.verificationStatus);
    if (input.operatingStatus) query = query.eq("operating_status", input.operatingStatus);
    if (input.targetFitStatus) query = query.eq("target_fit_status", input.targetFitStatus);
    if (input.ownershipScope) query = query.eq("ownership_scope", input.ownershipScope);
    if (input.minimumLocationCount !== undefined) query = query.gte("location_count", input.minimumLocationCount);
    if (input.minimumActiveLicenseCount !== undefined) query = query.gte("active_license_count", input.minimumActiveLicenseCount);
    if (input.minimumReviewCount !== undefined) query = query.gte("review_count", input.minimumReviewCount);
    if (input.minimumPriorityScore !== undefined) query = query.gte("priority_score", input.minimumPriorityScore);
    if (input.minimumVerificationScore !== undefined) query = query.gte("verification_score", input.minimumVerificationScore);
    const result = await query;
    if (result.error) throw new Error(`Count prospect candidates: ${result.error.message}`);
    return result.count ?? 0;
  }
  async upsertProspectLocation(input: UpsertProspectLocationInput) {
    const value = prospectLocationValue(input);
    const row = await data<ProspectLocationRow>(this.client.from("prospect_locations")
      .upsert(prospectLocationToRow(value), { onConflict: "prospect_id,canonical_key", ignoreDuplicates: false })
      .select("*")
      .single(), "Upsert prospect location");
    return prospectLocationFromRow(row);
  }
  async listProspectLocations(prospectId: string) {
    return (await data<ProspectLocationRow[]>(this.client.from("prospect_locations")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("is_primary", { ascending: false })
      .order("id", { ascending: true }), "List prospect locations")).map(prospectLocationFromRow);
  }
  async upsertProspectLicense(input: UpsertProspectLicenseInput) {
    const value = prospectLicenseValue(input);
    const row = await data<ProspectLicenseRow>(this.client.from("prospect_licenses")
      .upsert(prospectLicenseToRow(value), {
        onConflict: "prospect_id,jurisdiction,regulator,license_type,license_number",
        ignoreDuplicates: false
      })
      .select("*")
      .single(), "Upsert prospect license");
    return prospectLicenseFromRow(row);
  }
  async listProspectLicenses(prospectId: string) {
    return (await data<ProspectLicenseRow[]>(this.client.from("prospect_licenses")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("observed_at", { ascending: false }), "List prospect licenses")).map(prospectLicenseFromRow);
  }
  async upsertProspectAffiliation(input: UpsertProspectAffiliationInput) {
    const value = prospectAffiliationValue(input);
    const row = await data<ProspectAffiliationRow>(this.client.from("prospect_affiliations")
      .upsert(prospectAffiliationToRow(value), { onConflict: "id", ignoreDuplicates: false })
      .select("*")
      .single(), "Upsert prospect affiliation");
    return prospectAffiliationFromRow(row);
  }
  async listProspectAffiliations(prospectId: string) {
    return (await data<ProspectAffiliationRow[]>(this.client.from("prospect_affiliations")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("observed_at", { ascending: false }), "List prospect affiliations")).map(prospectAffiliationFromRow);
  }
  async upsertProspectSource(input: UpsertProspectSourceInput) {
    const value = prospectSourceValue(input);
    const row = await data<ProspectSourceRow>(this.client.from("prospect_sources")
      .upsert(prospectSourceToRow(value), { onConflict: "id", ignoreDuplicates: false })
      .select("*")
      .single(), "Upsert prospect source");
    return prospectSourceFromRow(row);
  }
  async listProspectSources(vertical?: string) {
    let query = this.client.from("prospect_sources").select("*").order("jurisdiction", { ascending: true });
    if (vertical) query = query.eq("vertical", vertical);
    return (await data<ProspectSourceRow[]>(query, "List prospect sources")).map(prospectSourceFromRow);
  }
  async upsertProspectSourceRun(input: UpsertProspectSourceRunInput) {
    const value = prospectSourceRunValue(input);
    const row = await data<ProspectSourceRunRow>(this.client.from("prospect_source_runs")
      .upsert(prospectSourceRunToRow(value), { onConflict: "id", ignoreDuplicates: false })
      .select("*")
      .single(), "Upsert prospect source run");
    return prospectSourceRunFromRow(row);
  }
  async listProspectSourceRuns(sourceId?: string) {
    let query = this.client.from("prospect_source_runs").select("*").order("started_at", { ascending: false });
    if (sourceId) query = query.eq("source_id", sourceId);
    return (await data<ProspectSourceRunRow[]>(query, "List prospect source runs")).map(prospectSourceRunFromRow);
  }
  async pruneProspectSourceSnapshots(input: Array<{ sourceId: string; retainedCanonicalKeys: string[] }>) {
    const counts = {
      prospects: 0,
      locations: 0,
      licenses: 0,
      affiliations: 0,
      observations: 0,
      contacts: 0
    };
    for (const snapshot of input) {
      const result = await data<Record<keyof typeof counts, number>>(this.client.rpc(
        "prune_prospect_source_snapshot",
        {
          p_source_id: snapshot.sourceId,
          p_retained_canonical_keys: snapshot.retainedCanonicalKeys.map(normalizedCanonicalKey)
        }
      ), `Prune prospect source snapshot ${snapshot.sourceId}`);
      for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
        counts[key] += Number(result[key] ?? 0);
      }
    }
    return counts;
  }
  async createProspectObservation(input: CreateProspectObservationInput) {
    const existing = await maybe<ProspectObservationRow>(this.client.from("prospect_observations")
      .select("*")
      .eq("prospect_id", input.prospectId)
      .eq("input_hash", input.inputHash)
      .maybeSingle(), "Find prospect observation");
    if (existing) return prospectObservationFromRow(existing);
    const value = prospectObservationValue(input);
    const row = await data<ProspectObservationRow>(this.client.from("prospect_observations")
      .insert(prospectObservationToRow(value))
      .select("*")
      .single(), "Create prospect observation");
    return prospectObservationFromRow(row);
  }
  async upsertProspectContact(input: UpsertProspectContactInput) {
    const existing = await this.findExistingProspectContact(input);
    const value = prospectContactValue(input, existing);
    const row = await data<ProspectContactRow>(this.client.from("prospect_contacts")
      .upsert(prospectContactToRow(value), { onConflict: "id", ignoreDuplicates: false })
      .select("*")
      .single(), "Upsert prospect contact");
    return prospectContactFromRow(row);
  }
  async listProspectContacts(prospectId: string) {
    return (await data<ProspectContactRow[]>(this.client.from("prospect_contacts")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("observed_at", { ascending: false }), "List prospect contacts")).map(prospectContactFromRow);
  }
  async importProspectResearch(records: ProspectImportRecord[]) {
    assertUniqueProspectImportRecords(records);
    if (!records.length) return {
      prospects: 0,
      locations: 0,
      licenses: 0,
      affiliations: 0,
      observations: 0,
      contacts: 0
    };
    const canonicalKeys = [...new Set(records.map((record) => normalizedCanonicalKey(record.prospect.canonicalKey)))];
    const existingRows: ProspectResearchRow[] = [];
    for (const canonicalKeyBatch of batches(canonicalKeys, 250)) {
      existingRows.push(...await data<ProspectResearchRow[]>(this.client.from("prospects")
        .select("*")
        .in("canonical_key", canonicalKeyBatch), "Find imported prospects"));
    }
    const existingByCanonicalKey = new Map(existingRows.map((row) => [row.canonical_key, prospectResearchFromRow(row)]));
    const prospects = records.map((record) => prospectValue(
      record.prospect,
      existingByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey))
    ));
    const prospectRows: ProspectResearchRow[] = [];
    for (const batch of batches(prospects.map(prospectToRow), 250)) {
      prospectRows.push(...await data<ProspectResearchRow[]>(this.client.from("prospects")
        .upsert(batch, { onConflict: "canonical_key", ignoreDuplicates: false })
        .select("*"), "Import prospects"));
    }
    const prospectByCanonicalKey = new Map(prospectRows.map((row) => [row.canonical_key, prospectResearchFromRow(row)]));
    const locations = records.flatMap((record) => {
      const prospect = prospectByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey));
      if (!prospect) throw new Error(`Imported prospect was not returned for ${record.prospect.canonicalKey}.`);
      return (record.locations ?? []).map((location) => prospectLocationValue({ ...location, prospectId: prospect.id }));
    });
    const licenses = deduplicateProspectLicenses(records.flatMap((record) => {
      const prospect = prospectByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey));
      if (!prospect) throw new Error(`Imported prospect was not returned for ${record.prospect.canonicalKey}.`);
      return (record.licenses ?? []).map((license) => prospectLicenseValue({ ...license, prospectId: prospect.id }));
    }));
    const affiliations = records.flatMap((record) => {
      const prospect = prospectByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey));
      if (!prospect) throw new Error(`Imported prospect was not returned for ${record.prospect.canonicalKey}.`);
      return (record.affiliations ?? []).map((affiliation) =>
        prospectAffiliationValue({ ...affiliation, prospectId: prospect.id })
      );
    });
    const observations = records.flatMap((record) => {
      if (!record.observation) return [];
      const prospect = prospectByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey));
      if (!prospect) throw new Error(`Imported prospect was not returned for ${record.prospect.canonicalKey}.`);
      return [prospectObservationValue({ ...record.observation, prospectId: prospect.id })];
    });
    const importedProspectIds = [...prospectByCanonicalKey.values()].map((prospect) => prospect.id);
    const existingContactRows: ProspectContactRow[] = [];
    for (const prospectIdBatch of batches(importedProspectIds, 250)) {
      existingContactRows.push(...await data<ProspectContactRow[]>(this.client.from("prospect_contacts")
        .select("*")
        .in("prospect_id", prospectIdBatch), "Find imported prospect contacts"));
    }
    const existingContacts = existingContactRows.map(prospectContactFromRow);
    const contacts = deduplicateProspectContacts(records.flatMap((record) => {
      const prospect = prospectByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey));
      if (!prospect) throw new Error(`Imported prospect was not returned for ${record.prospect.canonicalKey}.`);
      return (record.contacts ?? []).map((contact) => {
        const input = { ...contact, prospectId: prospect.id };
        return prospectContactValue(input, findExistingProspectContact(existingContacts, input));
      });
    }));
    if (locations.length) {
      for (const batch of batches(locations.map(prospectLocationToRow), 250)) {
        await data(this.client.from("prospect_locations")
          .upsert(batch, { onConflict: "prospect_id,canonical_key", ignoreDuplicates: false })
          .select("id"), "Import prospect locations");
      }
    }
    if (licenses.length) {
      for (const batch of batches(licenses.map(prospectLicenseToRow), 250)) {
        await data(this.client.from("prospect_licenses")
          .upsert(batch, {
            onConflict: "prospect_id,jurisdiction,regulator,license_type,license_number",
            ignoreDuplicates: false
          })
          .select("id"), "Import prospect licenses");
      }
    }
    if (affiliations.length) {
      for (const batch of batches(affiliations.map(prospectAffiliationToRow), 250)) {
        await data(this.client.from("prospect_affiliations")
          .upsert(batch, { onConflict: "id", ignoreDuplicates: false })
          .select("id"), "Import prospect affiliations");
      }
    }
    if (observations.length) {
      for (const batch of batches(observations.map(prospectObservationToRow), 250)) {
        await data(this.client.from("prospect_observations")
          .upsert(batch, {
            onConflict: "prospect_id,input_hash",
            ignoreDuplicates: true
          })
          .select("id"), "Import prospect observations");
      }
    }
    if (contacts.length) {
      for (const batch of batches(contacts.map(prospectContactToRow), 250)) {
        await data(this.client.from("prospect_contacts")
          .upsert(batch, { onConflict: "id", ignoreDuplicates: false })
          .select("id"), "Import prospect contacts");
      }
    }
    return {
      prospects: prospects.length,
      locations: locations.length,
      licenses: licenses.length,
      affiliations: affiliations.length,
      observations: observations.length,
      contacts: contacts.length
    };
  }

  async createOutboundCampaign(input: CreateOutboundCampaignInput) { const value = newOutboundCampaign(input); return campaignFromRow(await data<CampaignRow>(this.client.from("outbound_campaigns").upsert({ id: value.id, name: value.name, channel: value.channel, status: value.status, metadata: value.metadata ?? {}, created_at: value.createdAt, started_at: value.startedAt, ended_at: value.endedAt }, { onConflict: "id", ignoreDuplicates: false }).select("*").single(), "Create campaign")); }
  async listOutboundCampaigns() { return (await data<CampaignRow[]>(this.client.from("outbound_campaigns").select("*").order("created_at", { ascending: false }), "List campaigns")).map(campaignFromRow); }
  async upsertOutboundProspect(input: UpsertOutboundProspectInput) {
    const prospect = await this.getProspect(input.prospectId);
    if (!prospect) throw new Error("Unknown canonical prospect.");
    if (prospect.doNotContact || prospect.status !== "active") throw new Error("Suppressed, converted, or archived prospects cannot be added to a campaign.");
    const observation = await maybe<ProspectObservationRow>(this.client.from("prospect_observations")
      .select("*")
      .eq("id", input.selectionObservationId)
      .eq("prospect_id", input.prospectId)
      .maybeSingle(), "Validate campaign selection observation");
    if (!observation) throw new Error("Campaign selection must reference an observation for the canonical prospect.");
    const value = newOutboundProspect({
      ...input,
      businessName: prospect.businessName,
      vertical: prospect.vertical,
      sourceUrl: prospect.websiteUrl
    });
    const row = await data<ProspectRow>(this.client.from("outbound_prospects").upsert({
      id: value.id,
      prospect_id: value.prospectId,
      selection_observation_id: value.selectionObservationId,
      campaign_id: value.campaignId,
      site_id: value.siteId,
      report_id: value.reportId,
      preview_id: value.previewId,
      mailing_code: value.mailingCode,
      status: value.status,
      metadata: value.metadata ?? {},
      created_at: value.createdAt
    }).select("*").single(), "Upsert campaign prospect");
    return outboundProspectFromRows(row, prospect);
  }
  async getOutboundProspect(prospectId: string) {
    const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("id", prospectId).maybeSingle(), "Get outbound prospect");
    return row ? this.outboundProspectFromMembership(row) : null;
  }
  async listOutboundProspects(campaignId?: string) {
    let query = this.client.from("outbound_prospects").select("*").order("created_at", { ascending: false });
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const rows = await data<ProspectRow[]>(query, "List prospects");
    if (!rows.length) return [];
    const researchRows = await data<ProspectResearchRow[]>(this.client.from("prospects").select("*").in("id", [...new Set(rows.map((row) => row.prospect_id))]), "Join canonical prospects");
    const byId = new Map(researchRows.map((row) => [row.id, prospectResearchFromRow(row)]));
    return rows.map((row) => {
      const prospect = byId.get(row.prospect_id);
      if (!prospect) throw new Error(`Campaign prospect ${row.id} references a missing canonical prospect.`);
      return outboundProspectFromRows(row, prospect);
    });
  }
  async findOutboundProspectByPreviewId(previewId: string) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("preview_id", previewId).maybeSingle(), "Find prospect"); return row ? this.outboundProspectFromMembership(row) : null; }
  async findOutboundProspectByReportId(reportId: string) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("report_id", reportId).maybeSingle(), "Find prospect by report"); return row ? this.outboundProspectFromMembership(row) : null; }
  async attachOutboundProspectReport(prospectId: string, reportId: string) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").update({ report_id: reportId, first_report_viewed_at: null }).eq("id", prospectId).select("*").maybeSingle(), "Attach outbound prospect report"); return row ? this.outboundProspectFromMembership(row) : null; }
  async recordOutboundReportView(reportId: string, occurredAt = new Date().toISOString()) { const value = await data<boolean>(this.client.rpc("record_outbound_report_view", { target_report_id: reportId, target_occurred_at: occurredAt }), "Record outbound report view"); return value; }
  async recordOutboundEvent(input: RecordOutboundEventInput) { const value = newOutboundEvent(input); const row = await data<EventRow>(this.client.from("outbound_events").insert({ id: value.id, campaign_id: value.campaignId, prospect_id: value.prospectId, site_id: value.siteId, type: value.type, occurred_at: value.occurredAt, value: value.value, metadata: value.metadata ?? {} }).select("*").single(), "Record outbound event"); const event = eventFromRow(row); const prospectId = event.prospectId ?? (event.siteId ? (await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("campaign_id", event.campaignId).eq("site_id", event.siteId).maybeSingle(), "Find prospect by site"))?.id : undefined); if (prospectId) await this.applyEvent(prospectId, event); return event; }
  async listOutboundEvents(campaignId?: string) { let query = this.client.from("outbound_events").select("*").order("occurred_at", { ascending: false }); if (campaignId) query = query.eq("campaign_id", campaignId); return (await data<EventRow[]>(query, "List outbound events")).map(eventFromRow); }
  async outboundSummary(campaignId?: string) { return summarizeOutbound(await this.listOutboundCampaigns(), await this.listOutboundProspects(campaignId), await this.listOutboundEvents(campaignId), campaignId); }

  async createProspectReport(input: CreateProspectReportInput) { const now = new Date().toISOString(); return reportFromRow(await data<ReportRow>(this.client.from("prospect_reports").insert({ id: input.id ?? `prospect_report_${crypto.randomUUID().replaceAll("-", "")}`, source_key: input.sourceKey, access_policy: input.accessPolicy, status: "queued", assessment_id: input.assessmentId, source_url: input.sourceUrl, source_host: input.sourceHost, website_kind: input.websiteKind, business_strength_json: input.businessStrength, resolution_usage: input.resolutionUsage, created_at: now, updated_at: now }).select("*").single(), "Create report")); }
  async getProspectReport(id: string) { const row = await maybe<ReportRow>(this.client.from("prospect_reports").select("*").eq("id", id).maybeSingle(), "Get report"); return row ? reportFromRow(row) : null; }
  async listProspectReports(limit = 50) { return (await data<ReportRow[]>(this.client.from("prospect_reports").select("*").order("created_at", { ascending: false }).limit(Math.max(1, Math.min(limit, 500))), "List prospect reports")).map(reportFromRow); }
  async findActiveProspectReportBySourceKey(sourceKey: string, accessPolicy: ProspectReportAccessPolicy) { const row = await maybe<ReportRow>(this.client.from("prospect_reports").select("*").eq("source_key", sourceKey).eq("access_policy", accessPolicy).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle(), "Find active report"); return row ? reportFromRow(row) : null; }
  async findReusableProspectReportBySourceKey(sourceKey: string, accessPolicy: ProspectReportAccessPolicy, since: string) { const row = await maybe<ReportRow>(this.client.from("prospect_reports").select("*").eq("source_key", sourceKey).eq("access_policy", accessPolicy).eq("status", "completed").gte("completed_at", since).order("completed_at", { ascending: false }).limit(1).maybeSingle(), "Find reusable report"); return row ? reportFromRow(row) : null; }
  async updateProspectReport(input: UpdateProspectReportInput) { const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }; const map: Record<string, string> = { status: "status", accessPolicy: "access_policy", assessmentId: "assessment_id", sourceUrl: "source_url", sourceHost: "source_host", websiteKind: "website_kind", result: "report_json", errorCode: "error_code", completedAt: "completed_at" }; for (const [key, column] of Object.entries(map)) { const value = input[key as keyof UpdateProspectReportInput]; if (value !== undefined) patch[column] = value; } if (input.clearError) patch.error_code = null; const row = await maybe<ReportRow>(this.client.from("prospect_reports").update(patch).eq("id", input.reportId).select("*").maybeSingle(), "Update report"); return row ? reportFromRow(row) : null; }
  async createProspectReportLead(input: CreateProspectReportLeadInput) { const row = await maybe<LeadRow>(this.client.rpc("create_or_reuse_prospect_report_lead", { target_report_id: input.reportId, target_email: input.email, target_contact_name: input.contactName ?? "", target_phone: input.phone ?? "", target_ip_hash: input.ipHash ?? null, target_metadata: input.metadata ?? {} }).maybeSingle(), "Create or reuse report lead"); return row ? leadFromRow(row) : null; }
  async createProspectReportAccessGrant(input: { reportId: string; leadId: string; tokenHash: string; expiresAt: string }) { const row = await data<ReportAccessGrantRow>(this.client.from("prospect_report_access_grants").insert({ id: `prospect_report_grant_${crypto.randomUUID().replaceAll("-", "")}`, report_id: input.reportId, lead_id: input.leadId, token_hash: input.tokenHash, expires_at: input.expiresAt }).select("*").single(), "Create report access grant"); return reportAccessGrantFromRow(row); }
  async findActiveProspectReportAccessGrant(reportId: string, tokenHash: string) { const row = await maybe<ReportAccessGrantRow>(this.client.from("prospect_report_access_grants").select("*").eq("report_id", reportId).eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle(), "Find report access grant"); return row ? reportAccessGrantFromRow(row) : null; }
  async markProspectReportAccessGrantUsed(grantId: string) { await data(this.client.from("prospect_report_access_grants").update({ last_used_at: new Date().toISOString() }).eq("id", grantId).select("id").single(), "Mark report access grant used"); }
  async createWebsiteAssessment(input: CreateWebsiteAssessmentInput) { const now = new Date().toISOString(); const row = await data<WebsiteAssessmentRow>(this.client.from("website_assessments").insert({ id: input.id ?? `website_assessment_${crypto.randomUUID().replaceAll("-", "")}`, status: "queued", target_kind: input.targetKind, source_key: input.sourceKey, source_url: input.sourceUrl, site_id: input.siteId, artifact_id: input.artifactId, version_id: input.versionId, rubric_identity: input.rubricIdentity, scanner_identity: input.scannerIdentity, created_at: now, updated_at: now }).select("*").single(), "Create website assessment"); return websiteAssessmentFromRow(row); }
  async getWebsiteAssessment(assessmentId: string) { const row = await maybe<WebsiteAssessmentRow>(this.client.from("website_assessments").select("*").eq("id", assessmentId).maybeSingle(), "Get website assessment"); return row ? websiteAssessmentFromRow(row) : null; }
  async listWebsiteAssessments(input: { siteId?: string; sourceKey?: string; ids?: string[]; limit?: number } = {}) { if (input.ids && !input.ids.length) return []; let query = this.client.from("website_assessments").select("*").order("created_at", { ascending: false }).limit(Math.max(1, Math.min(input.limit ?? 100, 500))); if (input.siteId) query = query.eq("site_id", input.siteId); if (input.sourceKey) query = query.eq("source_key", input.sourceKey); if (input.ids?.length) query = query.in("id", input.ids.slice(0, 500)); return (await data<WebsiteAssessmentRow[]>(query, "List website assessments")).map(websiteAssessmentFromRow); }
  async updateWebsiteAssessment(input: UpdateWebsiteAssessmentInput) { const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }; const map: Record<string, string> = { status: "status", assessment: "assessment_json", errorCode: "error_code", completedAt: "completed_at" }; for (const [key, column] of Object.entries(map)) { const value = input[key as keyof UpdateWebsiteAssessmentInput]; if (value !== undefined) patch[column] = value; } if (input.clearError) patch.error_code = null; const row = await maybe<WebsiteAssessmentRow>(this.client.from("website_assessments").update(patch).eq("id", input.assessmentId).select("*").maybeSingle(), "Update website assessment"); return row ? websiteAssessmentFromRow(row) : null; }
  async enqueueWebsiteAssessmentJob(input: { assessmentId: string; prospectReportId?: string }) { const now = new Date().toISOString(); const row = await data<WebsiteAssessmentJobRow>(this.client.from("website_assessment_jobs").insert({ id: `website_assessment_job_${crypto.randomUUID().replaceAll("-", "")}`, assessment_id: input.assessmentId, prospect_report_id: input.prospectReportId, status: "queued", attempts: 0, max_attempts: 2, run_after: now, created_at: now, updated_at: now }).select("*").single(), "Enqueue website assessment job"); return websiteAssessmentJobFromRow(row); }
  async claimNextWebsiteAssessmentJob(workerId: string) { const row = await maybe<WebsiteAssessmentJobRow>(this.client.rpc("claim_website_assessment_job", { worker_id: workerId }).maybeSingle(), "Claim website assessment job"); return row ? websiteAssessmentJobFromRow(row) : null; }
  async completeWebsiteAssessmentJob(jobId: string) { const now = new Date().toISOString(); await data(this.client.from("website_assessment_jobs").update({ status: "completed", completed_at: now, updated_at: now }).eq("id", jobId).select("id").single(), "Complete website assessment job"); }
  async failWebsiteAssessmentJob(jobId: string, error: string) { const row = await data<WebsiteAssessmentJobRow>(this.client.from("website_assessment_jobs").select("*").eq("id", jobId).single(), "Read failed website assessment job"); const retry = row.attempts < row.max_attempts; await data(this.client.from("website_assessment_jobs").update({ status: retry ? "queued" : "failed", error, run_after: retry ? new Date(Date.now() + 30_000).toISOString() : row.run_after, locked_by: null, locked_at: null, updated_at: new Date().toISOString(), completed_at: retry ? null : new Date().toISOString() }).eq("id", jobId).select("id").single(), "Fail website assessment job"); }

  private async outboundProspectFromMembership(row: ProspectRow) {
    const prospect = await this.getProspect(row.prospect_id);
    if (!prospect) throw new Error(`Campaign prospect ${row.id} references a missing canonical prospect.`);
    return outboundProspectFromRows(row, prospect);
  }

  private async findExistingProspectContact(input: UpsertProspectContactInput) {
    if (input.id) {
      const byId = await maybe<ProspectContactRow>(this.client.from("prospect_contacts")
        .select("*")
        .eq("id", input.id)
        .maybeSingle(), "Find prospect contact by ID");
      if (byId) return prospectContactFromRow(byId);
    }
    if (input.email) {
      const byEmail = await maybe<ProspectContactRow>(this.client.from("prospect_contacts")
        .select("*")
        .eq("prospect_id", input.prospectId)
        .eq("email", input.email.trim().toLowerCase())
        .maybeSingle(), "Find prospect contact by email");
      if (byEmail) return prospectContactFromRow(byEmail);
    }
    if (input.phone) {
      const byPhone = await maybe<ProspectContactRow>(this.client.from("prospect_contacts")
        .select("*")
        .eq("prospect_id", input.prospectId)
        .eq("phone", input.phone.trim())
        .maybeSingle(), "Find prospect contact by phone");
      if (byPhone) return prospectContactFromRow(byPhone);
    }
    return undefined;
  }

  private async applyEvent(id: string, event: OutboundEvent) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("id", id).maybeSingle(), "Read event prospect"); if (!row) return; const value = await this.outboundProspectFromMembership(row); applyOutboundEventToProspect(value, event); await data(this.client.from("outbound_prospects").update({ site_id: value.siteId, status: value.status, mailed_at: value.mailedAt, first_report_viewed_at: value.firstReportViewedAt, first_preview_viewed_at: value.firstPreviewViewedAt, adoption_started_at: value.adoptionStartedAt, adopted_at: value.adoptedAt, published_at: value.publishedAt, disqualified_at: value.disqualifiedAt }).eq("id", id).select("id").single(), "Update event prospect"); }
}

export const platformOperationsRepository: PlatformOperationsRepository = process.env.LODESTA_REPOSITORY === "local"
  ? new LocalPlatformOperationsRepository()
  : new SupabasePlatformOperationsRepository();

function websiteSetupFromRow(row: WebsiteSetupRow): WebsiteSetup { return { id: row.id, ownerUserId: row.owner_user_id, sourceUrl: row.source_url, normalizedSource: row.normalized_source, reportingTimezone: row.reporting_timezone ?? "UTC", prospectReportId: row.prospect_report_id ?? undefined, sourceRevision: row.source_revision, status: row.status, siteId: row.site_id ?? undefined, sessionId: row.session_id ?? undefined, runId: row.run_id ?? undefined, attempts: row.attempts, maxAttempts: row.max_attempts, idempotencyKey: row.idempotency_key, creationRequestHash: row.creation_request_hash, lockedBy: row.locked_by ?? undefined, lockedAt: row.locked_at ?? undefined, failureCode: row.failure_code ?? undefined, failureReason: row.failure_reason ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }
function adoptionInvitationFromRow(row: AdoptionInvitationRow): AdoptionInvitation { return { id: row.id, siteId: row.site_id, tokenHash: row.token_hash, expiresAt: row.expires_at, createdAt: row.created_at, consumedAt: row.consumed_at ?? undefined, consumedByUserId: row.consumed_by_user_id ?? undefined }; }
function previewGrantFromRow(row: PreviewGrantRow): SitePreviewGrant { return { id: row.id, siteId: row.site_id, siteVersionId: row.site_version_id, secretHash: row.secret_hash, keyVersion: row.key_version, secretVersion: row.secret_version, expiresAt: row.expires_at, revokedAt: row.revoked_at ?? undefined, createdAt: row.created_at }; }
function domainFromRow(row: DomainRow): DomainRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    hostname: row.hostname,
    status: row.status,
    ownershipProofStatus: row.ownership_proof_status,
    routingStatus: row.routing_status,
    providerStatus: row.provider_status,
    certificateStatus: row.certificate_status,
    verificationName: row.verification_name,
    verificationValue: row.verification_value,
    routingName: row.routing_name,
    routingTarget: row.routing_target,
    expiresAt: row.expires_at,
    providerHostnameId: row.provider_hostname_id ?? undefined,
    ownershipVerifiedAt: row.ownership_verified_at ?? undefined,
    activatedAt: row.activated_at ?? undefined,
    attentionRequiredAt: row.attention_required_at ?? undefined,
    providerInvalidCount: row.provider_invalid_count,
    firstProviderInvalidAt: row.first_provider_invalid_at ?? undefined,
    lastProviderInvalidAt: row.last_provider_invalid_at ?? undefined,
    executionFailureCount: row.execution_failure_count,
    lastExecutionError: row.last_execution_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function domainToRow(value: DomainRecord) {
  return {
    id: value.id,
    site_id: value.siteId,
    hostname: value.hostname,
    status: value.status,
    ownership_proof_status: value.ownershipProofStatus,
    routing_status: value.routingStatus,
    provider_status: value.providerStatus,
    certificate_status: value.certificateStatus,
    verification_name: value.verificationName,
    verification_value: value.verificationValue,
    routing_name: value.routingName,
    routing_target: value.routingTarget,
    expires_at: value.expiresAt,
    provider_hostname_id: value.providerHostnameId ?? null,
    ownership_verified_at: value.ownershipVerifiedAt ?? null,
    activated_at: value.activatedAt ?? null,
    attention_required_at: value.attentionRequiredAt ?? null,
    provider_invalid_count: value.providerInvalidCount,
    first_provider_invalid_at: value.firstProviderInvalidAt ?? null,
    last_provider_invalid_at: value.lastProviderInvalidAt ?? null,
    execution_failure_count: value.executionFailureCount,
    last_execution_error: value.lastExecutionError ?? null,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function redirectFromRow(row: RedirectRow): SiteRedirectRule { return { id: row.id, siteId: row.site_id, sourcePath: row.source_path, destinationPath: row.destination_path, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
function campaignFromRow(row: CampaignRow): OutboundCampaign { return { id: row.id, name: row.name, channel: row.channel, status: row.status, metadata: row.metadata as OutboundCampaign["metadata"], createdAt: row.created_at, startedAt: row.started_at ?? undefined, endedAt: row.ended_at ?? undefined }; }
function outboundProspectFromRows(row: ProspectRow, prospect: Prospect): OutboundProspect { return { id: row.id, prospectId: row.prospect_id, selectionObservationId: row.selection_observation_id, campaignId: row.campaign_id, siteId: row.site_id ?? undefined, reportId: row.report_id ?? undefined, businessName: prospect.businessName, vertical: prospect.vertical, sourceUrl: prospect.websiteUrl, previewId: row.preview_id ?? undefined, mailingCode: row.mailing_code ?? undefined, status: row.status, metadata: row.metadata as OutboundProspect["metadata"], createdAt: row.created_at, mailedAt: row.mailed_at ?? undefined, firstReportViewedAt: row.first_report_viewed_at ?? undefined, firstPreviewViewedAt: row.first_preview_viewed_at ?? undefined, adoptionStartedAt: row.adoption_started_at ?? undefined, adoptedAt: row.adopted_at ?? undefined, publishedAt: row.published_at ?? undefined, disqualifiedAt: row.disqualified_at ?? undefined }; }
function prospectValue(input: UpsertProspectInput, existing?: Prospect): Prospect {
  const now = new Date().toISOString();
  const websiteUrl = input.websiteKind === "owned_website"
    ? optionalText(input.websiteUrl) ?? existing?.websiteUrl
    : undefined;
  const websiteHost = websiteUrl
    ? normalizedWebsiteHost(websiteUrl)
    : input.websiteKind === "owned_website"
      ? optionalText(input.websiteHost) ?? existing?.websiteHost
      : undefined;
  return {
    id: existing?.id ?? input.id ?? prospectIdForCanonicalKey(input.canonicalKey),
    canonicalKey: normalizedCanonicalKey(input.canonicalKey),
    businessName: input.businessName.trim(),
    legalBusinessName: optionalText(input.legalBusinessName) ?? existing?.legalBusinessName,
    dbaName: optionalText(input.dbaName) ?? existing?.dbaName,
    vertical: optionalText(input.vertical) ?? existing?.vertical,
    industryCode: optionalText(input.industryCode) ?? existing?.industryCode,
    ownershipScope: input.ownershipScope ?? existing?.ownershipScope ?? "unknown",
    status: input.status,
    websiteKind: input.websiteKind,
    websiteUrl,
    websiteHost,
    addressLine1: optionalText(input.addressLine1) ?? existing?.addressLine1,
    addressLine2: optionalText(input.addressLine2) ?? existing?.addressLine2,
    locality: optionalText(input.locality) ?? existing?.locality,
    region: optionalText(input.region)?.toUpperCase() ?? existing?.region,
    postalCode: optionalText(input.postalCode) ?? existing?.postalCode,
    countryCode: input.countryCode.trim().toUpperCase(),
    phone: optionalText(input.phone) ?? existing?.phone,
    doNotContact: input.doNotContact,
    suppressionReason: input.doNotContact ? optionalText(input.suppressionReason) ?? existing?.suppressionReason : undefined,
    metadata: { ...existing?.metadata, ...input.metadata },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function prospectLocationValue(input: UpsertProspectLocationInput, existing?: ProspectLocation): ProspectLocation {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? input.id ?? prospectLocationId(input.prospectId, input.canonicalKey),
    prospectId: input.prospectId,
    canonicalKey: normalizedCanonicalKey(input.canonicalKey),
    kind: input.kind,
    status: input.status,
    locationName: optionalText(input.locationName),
    addressLine1: optionalText(input.addressLine1),
    addressLine2: optionalText(input.addressLine2),
    locality: optionalText(input.locality),
    region: optionalText(input.region)?.toUpperCase(),
    postalCode: optionalText(input.postalCode),
    countryCode: input.countryCode.trim().toUpperCase(),
    county: optionalText(input.county),
    phone: optionalText(input.phone),
    latitude: input.latitude,
    longitude: input.longitude,
    isPrimary: input.isPrimary,
    sourceId: optionalText(input.sourceId),
    sourceRunId: optionalText(input.sourceRunId),
    sourceRecordKey: optionalText(input.sourceRecordKey),
    observedAt: input.observedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function prospectLicenseValue(input: UpsertProspectLicenseInput, existing?: ProspectLicense): ProspectLicense {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? input.id ?? prospectLicenseId(input),
    prospectId: input.prospectId,
    locationId: optionalText(input.locationId),
    jurisdiction: input.jurisdiction.trim().toUpperCase(),
    regulator: input.regulator.trim(),
    licenseType: input.licenseType.trim(),
    licenseNumber: input.licenseNumber.trim(),
    status: input.status,
    classifications: [...new Set(input.classifications.map((value) => value.trim()).filter(Boolean))],
    issuedAt: optionalText(input.issuedAt),
    renewedAt: optionalText(input.renewedAt),
    expiresAt: optionalText(input.expiresAt),
    responsiblePersonName: optionalText(input.responsiblePersonName),
    responsiblePersonTitle: optionalText(input.responsiblePersonTitle),
    sourceId: input.sourceId,
    sourceRunId: optionalText(input.sourceRunId),
    sourceUrl: input.sourceUrl,
    sourceRecordKey: optionalText(input.sourceRecordKey),
    observedAt: input.observedAt,
    evidence: input.evidence,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function prospectAffiliationValue(
  input: UpsertProspectAffiliationInput,
  existing?: ProspectAffiliation
): ProspectAffiliation {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? input.id ?? prospectAffiliationId(input),
    prospectId: input.prospectId,
    relatedProspectId: optionalText(input.relatedProspectId),
    relatedOrganizationName: input.relatedOrganizationName.trim(),
    affiliationType: input.affiliationType,
    confidence: input.confidence,
    sourceUrl: optionalText(input.sourceUrl),
    observedAt: input.observedAt,
    evidence: input.evidence,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function prospectSourceValue(input: UpsertProspectSourceInput, existing?: ProspectSource): ProspectSource {
  const now = new Date().toISOString();
  return {
    ...input,
    jurisdiction: input.jurisdiction.trim().toUpperCase(),
    lastCheckedAt: optionalText(input.lastCheckedAt),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function prospectSourceRunValue(input: UpsertProspectSourceRunInput, existing?: ProspectSourceRun): ProspectSourceRun {
  const now = new Date().toISOString();
  return {
    ...input,
    finishedAt: optionalText(input.finishedAt),
    snapshotAt: optionalText(input.snapshotAt),
    sourceHash: optionalText(input.sourceHash),
    error: optionalText(input.error),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function prospectObservationValue(input: CreateProspectObservationInput): ProspectObservation {
  return {
    ...input,
    id: input.id ?? prospectObservationId(input.prospectId, input.inputHash),
    schemaVersion: 1,
    sourceUrl: optionalText(input.sourceUrl),
    websiteUrl: optionalText(input.websiteUrl),
    cms: optionalText(input.cms),
    siteBuilder: optionalText(input.siteBuilder),
    managedProvider: optionalText(input.managedProvider),
    agencyName: optionalText(input.agencyName),
    websiteAssessmentId: optionalText(input.websiteAssessmentId),
    prospectReportId: optionalText(input.prospectReportId),
    scoringModel: optionalText(input.scoringModel),
    verificationStatus: input.verificationStatus ?? "unverified",
    operatingStatus: input.operatingStatus ?? "unknown",
    targetFitStatus: input.targetFitStatus ?? "unknown",
    targetFitReason: optionalText(input.targetFitReason),
    notes: optionalText(input.notes),
    createdAt: new Date().toISOString()
  };
}
function prospectContactValue(input: UpsertProspectContactInput, existing?: ProspectContact): ProspectContact {
  const now = new Date().toISOString();
  const email = optionalText(input.email)?.toLowerCase();
  const phone = optionalText(input.phone);
  const fullName = optionalText(input.fullName);
  if (!email && !phone && !fullName) throw new Error("A prospect contact requires a name, email, or phone.");
  if (input.verificationStatus === "public_source" && !input.sourceUrl) throw new Error("A public-source contact requires a source URL.");
  if (input.outreachEligible && !["public_source", "owner_verified"].includes(input.verificationStatus)) {
    throw new Error("Unverified contact data cannot be marked outreach eligible.");
  }
  return {
    id: existing?.id ?? input.id ?? prospectContactId({ ...input, email, phone, fullName }),
    prospectId: input.prospectId,
    contactType: input.contactType,
    fullName,
    roleTitle: optionalText(input.roleTitle),
    email,
    phone,
    sourceType: input.sourceType,
    sourceUrl: optionalText(input.sourceUrl),
    verificationStatus: input.verificationStatus,
    outreachEligible: input.outreachEligible,
    observedAt: input.observedAt,
    suppressedAt: optionalText(input.suppressedAt),
    suppressionReason: optionalText(input.suppressionReason),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function findExistingProspectContact(
  contacts: ProspectContact[],
  input: { prospectId: string; id?: string; email?: string; phone?: string },
  deterministicId?: string
) {
  const email = optionalText(input.email)?.toLowerCase();
  const phone = optionalText(input.phone);
  return contacts.find((contact) => contact.prospectId === input.prospectId && (
    contact.id === input.id
    || contact.id === deterministicId
    || Boolean(email && contact.email?.toLowerCase() === email)
    || Boolean(phone && contact.phone === phone)
  ));
}
function deduplicateProspectContacts(contacts: ProspectContact[]) {
  const result: ProspectContact[] = [];
  const byIdentity = new Map<string, ProspectContact>();
  for (const contact of contacts) {
    const keys = prospectContactIdentityKeys(contact);
    const existing = keys.flatMap((key) => byIdentity.get(key) ?? [])[0];
    if (!existing) {
      result.push(contact);
      for (const key of keys) byIdentity.set(key, contact);
      continue;
    }
    const preferred = preferredProspectContact(existing, contact);
    if (preferred !== existing) {
      Object.assign(existing, preferred, {
        id: existing.id,
        createdAt: existing.createdAt < preferred.createdAt ? existing.createdAt : preferred.createdAt
      });
    }
    for (const key of new Set([...keys, ...prospectContactIdentityKeys(existing)])) {
      byIdentity.set(key, existing);
    }
  }
  return result;
}
function deduplicateProspectLicenses(licenses: ProspectLicense[]) {
  const byId = new Map<string, ProspectLicense>();
  for (const license of licenses) {
    const existing = byId.get(license.id);
    if (!existing || license.observedAt > existing.observedAt) byId.set(license.id, license);
  }
  return [...byId.values()];
}
function prospectContactIdentityKeys(contact: ProspectContact) {
  return [
    `id:${contact.id}`,
    contact.email ? `email:${contact.prospectId}:${contact.email.toLowerCase()}` : undefined,
    contact.phone ? `phone:${contact.prospectId}:${contact.phone}` : undefined
  ].filter((value): value is string => Boolean(value));
}
function preferredProspectContact(left: ProspectContact, right: ProspectContact) {
  const leftScore = Number(left.contactType === "owner") * 10
    + Number(Boolean(left.fullName))
    + Number(Boolean(left.email))
    + Number(Boolean(left.phone));
  const rightScore = Number(right.contactType === "owner") * 10
    + Number(Boolean(right.fullName))
    + Number(Boolean(right.email))
    + Number(Boolean(right.phone));
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;
  return right.observedAt > left.observedAt ? right : left;
}
function prospectCandidateValue(
  prospect: Prospect,
  observations: ProspectObservation[],
  contacts: ProspectContact[],
  locations: ProspectLocation[],
  licenses: ProspectLicense[]
): ProspectCandidate {
  const latest = observations
    .filter((observation) => observation.prospectId === prospect.id)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id))[0];
  const activeContacts = contacts.filter((contact) => contact.prospectId === prospect.id && !contact.suppressedAt);
  const sourcedContacts = activeContacts.filter((contact) => ["public_source", "owner_verified"].includes(contact.verificationStatus));
  const ownerName = sourcedContacts.find((contact) => contact.contactType === "owner" && contact.fullName)?.fullName;
  const publicEmail = prospect.doNotContact
    ? undefined
    : sourcedContacts.find((contact) => contact.outreachEligible && contact.email)?.email;
  return {
    ...prospect,
    latestObservationId: latest?.id,
    latestObservedAt: latest?.observedAt,
    reviewRating: latest?.reviewRating,
    reviewCount: latest?.reviewCount,
    yearsInBusiness: latest?.yearsInBusiness,
    cms: latest?.cms,
    siteBuilder: latest?.siteBuilder,
    managedProvider: latest?.managedProvider,
    agencyStatus: latest?.agencyStatus,
    agencyName: latest?.agencyName,
    websiteAssessmentId: latest?.websiteAssessmentId,
    prospectReportId: latest?.prospectReportId,
    businessStrengthScore: latest?.businessStrengthScore,
    websiteOpportunityScore: latest?.websiteOpportunityScore,
    reachabilityScore: latest?.reachabilityScore,
    priorityScore: latest?.priorityScore,
    scoringModel: latest?.scoringModel,
    verificationStatus: latest?.verificationStatus,
    verificationScore: latest?.verificationScore,
    operatingStatus: latest?.operatingStatus,
    targetFitStatus: latest?.targetFitStatus,
    targetFitReason: latest?.targetFitReason,
    evidenceCoverage: latest?.evidenceCoverage,
    ownerName,
    publicEmail,
    contactCount: activeContacts.length,
    locationCount: locations.filter((location) => location.prospectId === prospect.id && location.status !== "inactive").length,
    activeLicenseCount: licenses.filter((license) => license.prospectId === prospect.id && license.status === "active").length
  };
}
function matchesProspectQuery(candidate: ProspectCandidate, input: ProspectCandidateQuery) {
  const search = input.search?.trim().toLowerCase();
  return (!search || [candidate.businessName, candidate.websiteHost, candidate.locality].some((value) => value?.toLowerCase().includes(search)))
    && (!input.vertical || candidate.vertical === input.vertical)
    && (!input.industryCode || candidate.industryCode === input.industryCode)
    && (!input.region || candidate.region === input.region.toUpperCase())
    && (!input.websiteKind || candidate.websiteKind === input.websiteKind)
    && (!input.cms || candidate.cms === input.cms)
    && (!input.managedProvider || candidate.managedProvider === input.managedProvider)
    && (!input.agencyStatus || candidate.agencyStatus === input.agencyStatus)
    && (!input.verificationStatus || candidate.verificationStatus === input.verificationStatus)
    && (!input.operatingStatus || candidate.operatingStatus === input.operatingStatus)
    && (!input.targetFitStatus || candidate.targetFitStatus === input.targetFitStatus)
    && (!input.ownershipScope || candidate.ownershipScope === input.ownershipScope)
    && (input.minimumLocationCount === undefined || candidate.locationCount >= input.minimumLocationCount)
    && (input.minimumActiveLicenseCount === undefined || candidate.activeLicenseCount >= input.minimumActiveLicenseCount)
    && (input.minimumReviewCount === undefined || (candidate.reviewCount ?? -1) >= input.minimumReviewCount)
    && (input.minimumPriorityScore === undefined || (candidate.priorityScore ?? -1) >= input.minimumPriorityScore)
    && (input.minimumVerificationScore === undefined || (candidate.verificationScore ?? -1) >= input.minimumVerificationScore);
}
function compareProspectCandidates(
  left: ProspectCandidate,
  right: ProspectCandidate,
  input: ProspectCandidateQuery
) {
  const direction = input.sortDirection ?? defaultProspectSortDirection(input.sortBy);
  let result = 0;
  if (input.sortBy === "business_name") result = compareProspectText(left.businessName, right.businessName, direction);
  else if (input.sortBy === "state") result = compareProspectText(left.region, right.region, direction);
  else if (input.sortBy === "reviews") result = compareProspectNumber(left.reviewCount, right.reviewCount, direction);
  else if (input.sortBy === "verification") result = compareProspectNumber(left.verificationScore, right.verificationScore, direction);
  else if (input.sortBy === "observed_at") result = compareProspectText(left.latestObservedAt, right.latestObservedAt, direction);
  else result = compareProspectNumber(left.priorityScore, right.priorityScore, direction);
  return result
    || left.businessName.localeCompare(right.businessName)
    || left.id.localeCompare(right.id);
}
function compareProspectNumber(left: number | undefined, right: number | undefined, direction: "asc" | "desc") {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return direction === "asc" ? left - right : right - left;
}
function compareProspectText(left: string | undefined, right: string | undefined, direction: "asc" | "desc") {
  if (!left) return right ? 1 : 0;
  if (!right) return -1;
  return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
}
function prospectSortColumn(sortBy?: ProspectCandidateQuery["sortBy"]) {
  if (sortBy === "business_name") return "business_name";
  if (sortBy === "state") return "region";
  if (sortBy === "reviews") return "review_count";
  if (sortBy === "verification") return "verification_score";
  if (sortBy === "observed_at") return "latest_observed_at";
  return "priority_score";
}
function defaultProspectSortDirection(sortBy?: ProspectCandidateQuery["sortBy"]): "asc" | "desc" {
  return ["business_name", "state"].includes(sortBy ?? "") ? "asc" : "desc";
}
function prospectQueryLimit(limit?: number) { return Math.max(1, Math.min(limit ?? 100, 1_000)); }
function prospectQueryOffset(offset?: number) { return Math.max(0, Math.floor(offset ?? 0)); }
function assertUniqueProspectImportRecords(records: ProspectImportRecord[]) {
  const keys = records.map((record) => normalizedCanonicalKey(record.prospect.canonicalKey));
  if (new Set(keys).size !== keys.length) throw new Error("A prospect import batch cannot contain duplicate canonical keys.");
}
function batches<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
function prospectResearchFromRow(row: ProspectResearchRow): Prospect {
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    businessName: row.business_name,
    legalBusinessName: row.legal_business_name ?? undefined,
    dbaName: row.dba_name ?? undefined,
    vertical: row.vertical ?? undefined,
    industryCode: row.industry_code ?? undefined,
    ownershipScope: row.ownership_scope,
    status: row.status,
    websiteKind: row.website_kind,
    websiteUrl: row.website_url ?? undefined,
    websiteHost: row.website_host ?? undefined,
    addressLine1: row.address_line_1 ?? undefined,
    addressLine2: row.address_line_2 ?? undefined,
    locality: row.locality ?? undefined,
    region: row.region ?? undefined,
    postalCode: row.postal_code ?? undefined,
    countryCode: row.country_code,
    phone: row.phone ?? undefined,
    doNotContact: row.do_not_contact,
    suppressionReason: row.suppression_reason ?? undefined,
    metadata: row.metadata as Prospect["metadata"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectCandidateFromRow(row: ProspectCurrentRow): ProspectCandidate {
  return {
    ...prospectResearchFromRow(row),
    latestObservationId: row.latest_observation_id ?? undefined,
    latestObservedAt: row.latest_observed_at ?? undefined,
    reviewRating: row.review_rating ?? undefined,
    reviewCount: row.review_count ?? undefined,
    yearsInBusiness: row.years_in_business ?? undefined,
    cms: row.cms ?? undefined,
    siteBuilder: row.site_builder ?? undefined,
    managedProvider: row.managed_provider ?? undefined,
    agencyStatus: row.agency_status ?? undefined,
    agencyName: row.agency_name ?? undefined,
    websiteAssessmentId: row.website_assessment_id ?? undefined,
    prospectReportId: row.prospect_report_id ?? undefined,
    businessStrengthScore: row.business_strength_score ?? undefined,
    websiteOpportunityScore: row.website_opportunity_score ?? undefined,
    reachabilityScore: row.reachability_score ?? undefined,
    priorityScore: row.priority_score ?? undefined,
    scoringModel: row.scoring_model ?? undefined,
    verificationStatus: row.verification_status ?? undefined,
    verificationScore: row.verification_score ?? undefined,
    operatingStatus: row.operating_status ?? undefined,
    targetFitStatus: row.target_fit_status ?? undefined,
    targetFitReason: row.target_fit_reason ?? undefined,
    evidenceCoverage: row.evidence_coverage ?? undefined,
    ownerName: row.owner_name ?? undefined,
    publicEmail: row.public_email ?? undefined,
    contactCount: row.contact_count,
    locationCount: row.location_count,
    activeLicenseCount: row.active_license_count
  };
}
function prospectLocationFromRow(row: ProspectLocationRow): ProspectLocation {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    canonicalKey: row.canonical_key,
    kind: row.kind,
    status: row.status,
    locationName: row.location_name ?? undefined,
    addressLine1: row.address_line_1 ?? undefined,
    addressLine2: row.address_line_2 ?? undefined,
    locality: row.locality ?? undefined,
    region: row.region ?? undefined,
    postalCode: row.postal_code ?? undefined,
    countryCode: row.country_code,
    county: row.county ?? undefined,
    phone: row.phone ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    isPrimary: row.is_primary,
    sourceId: row.source_id ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    sourceRecordKey: row.source_record_key ?? undefined,
    observedAt: row.observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectLicenseFromRow(row: ProspectLicenseRow): ProspectLicense {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    locationId: row.location_id ?? undefined,
    jurisdiction: row.jurisdiction,
    regulator: row.regulator,
    licenseType: row.license_type,
    licenseNumber: row.license_number,
    status: row.status,
    classifications: row.classifications,
    issuedAt: row.issued_at ?? undefined,
    renewedAt: row.renewed_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    responsiblePersonName: row.responsible_person_name ?? undefined,
    responsiblePersonTitle: row.responsible_person_title ?? undefined,
    sourceId: row.source_id,
    sourceRunId: row.source_run_id ?? undefined,
    sourceUrl: row.source_url,
    sourceRecordKey: row.source_record_key ?? undefined,
    observedAt: row.observed_at,
    evidence: row.evidence as ProspectLicense["evidence"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectAffiliationFromRow(row: ProspectAffiliationRow): ProspectAffiliation {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    relatedProspectId: row.related_prospect_id ?? undefined,
    relatedOrganizationName: row.related_organization_name,
    affiliationType: row.affiliation_type,
    confidence: row.confidence,
    sourceUrl: row.source_url ?? undefined,
    observedAt: row.observed_at,
    evidence: row.evidence as ProspectAffiliation["evidence"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectSourceFromRow(row: ProspectSourceRow): ProspectSource {
  return {
    id: row.id,
    vertical: row.vertical,
    jurisdiction: row.jurisdiction,
    authorityName: row.authority_name,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    accessMethod: row.access_method,
    coverageStatus: row.coverage_status,
    recordScope: row.record_scope,
    refreshCadence: row.refresh_cadence ?? undefined,
    expectedRecordCount: row.expected_record_count ?? undefined,
    accessNotes: row.access_notes ?? undefined,
    lastCheckedAt: row.last_checked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectSourceRunFromRow(row: ProspectSourceRunRow): ProspectSourceRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    snapshotAt: row.snapshot_at ?? undefined,
    sourceHash: row.source_hash ?? undefined,
    recordsSeen: row.records_seen,
    organizationsUpserted: row.organizations_upserted,
    locationsUpserted: row.locations_upserted,
    licensesUpserted: row.licenses_upserted,
    contactsUpserted: row.contacts_upserted,
    rejectedRecords: row.rejected_records,
    error: row.error ?? undefined,
    metadata: row.metadata as ProspectSourceRun["metadata"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectObservationFromRow(row: ProspectObservationRow): ProspectObservation {
  return {
    schemaVersion: 1,
    id: row.id,
    prospectId: row.prospect_id,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? undefined,
    observedAt: row.observed_at,
    websiteKind: row.website_kind,
    websiteUrl: row.website_url ?? undefined,
    reviewRating: row.review_rating ?? undefined,
    reviewCount: row.review_count ?? undefined,
    yearsInBusiness: row.years_in_business ?? undefined,
    cms: row.cms ?? undefined,
    siteBuilder: row.site_builder ?? undefined,
    managedProvider: row.managed_provider ?? undefined,
    agencyStatus: row.agency_status,
    agencyName: row.agency_name ?? undefined,
    websiteAssessmentId: row.website_assessment_id ?? undefined,
    prospectReportId: row.prospect_report_id ?? undefined,
    businessStrengthScore: row.business_strength_score ?? undefined,
    websiteOpportunityScore: row.website_opportunity_score ?? undefined,
    reachabilityScore: row.reachability_score ?? undefined,
    priorityScore: row.priority_score ?? undefined,
    scoringModel: row.scoring_model ?? undefined,
    verificationStatus: row.verification_status,
    verificationScore: row.verification_score ?? undefined,
    operatingStatus: row.operating_status,
    targetFitStatus: row.target_fit_status,
    targetFitReason: row.target_fit_reason ?? undefined,
    evidenceCoverage: row.evidence_coverage,
    producer: row.producer,
    methodologyIdentity: row.methodology_identity,
    inputHash: row.input_hash,
    notes: row.notes ?? undefined,
    evidence: row.evidence as ProspectObservation["evidence"],
    createdAt: row.created_at
  };
}
function prospectContactFromRow(row: ProspectContactRow): ProspectContact {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    contactType: row.contact_type,
    fullName: row.full_name ?? undefined,
    roleTitle: row.role_title ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? undefined,
    verificationStatus: row.verification_status,
    outreachEligible: row.outreach_eligible,
    observedAt: row.observed_at,
    suppressedAt: row.suppressed_at ?? undefined,
    suppressionReason: row.suppression_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectToRow(value: Prospect) {
  return {
    id: value.id,
    canonical_key: value.canonicalKey,
    business_name: value.businessName,
    legal_business_name: value.legalBusinessName ?? null,
    dba_name: value.dbaName ?? null,
    vertical: value.vertical ?? null,
    industry_code: value.industryCode ?? null,
    ownership_scope: value.ownershipScope,
    status: value.status,
    website_kind: value.websiteKind,
    website_url: value.websiteUrl ?? null,
    website_host: value.websiteHost ?? null,
    address_line_1: value.addressLine1 ?? null,
    address_line_2: value.addressLine2 ?? null,
    locality: value.locality ?? null,
    region: value.region ?? null,
    postal_code: value.postalCode ?? null,
    country_code: value.countryCode,
    phone: value.phone ?? null,
    do_not_contact: value.doNotContact,
    suppression_reason: value.suppressionReason ?? null,
    metadata: value.metadata ?? {},
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function prospectLocationToRow(value: ProspectLocation) {
  return {
    id: value.id,
    prospect_id: value.prospectId,
    canonical_key: value.canonicalKey,
    kind: value.kind,
    status: value.status,
    location_name: value.locationName ?? null,
    address_line_1: value.addressLine1 ?? null,
    address_line_2: value.addressLine2 ?? null,
    locality: value.locality ?? null,
    region: value.region ?? null,
    postal_code: value.postalCode ?? null,
    country_code: value.countryCode,
    county: value.county ?? null,
    phone: value.phone ?? null,
    latitude: value.latitude ?? null,
    longitude: value.longitude ?? null,
    is_primary: value.isPrimary,
    source_id: value.sourceId ?? null,
    source_run_id: value.sourceRunId ?? null,
    source_record_key: value.sourceRecordKey ?? null,
    observed_at: value.observedAt,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function prospectLicenseToRow(value: ProspectLicense) {
  return {
    id: value.id,
    prospect_id: value.prospectId,
    location_id: value.locationId ?? null,
    jurisdiction: value.jurisdiction,
    regulator: value.regulator,
    license_type: value.licenseType,
    license_number: value.licenseNumber,
    status: value.status,
    classifications: value.classifications,
    issued_at: value.issuedAt ?? null,
    renewed_at: value.renewedAt ?? null,
    expires_at: value.expiresAt ?? null,
    responsible_person_name: value.responsiblePersonName ?? null,
    responsible_person_title: value.responsiblePersonTitle ?? null,
    source_id: value.sourceId,
    source_run_id: value.sourceRunId ?? null,
    source_url: value.sourceUrl,
    source_record_key: value.sourceRecordKey ?? null,
    observed_at: value.observedAt,
    evidence: value.evidence ?? {},
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function prospectAffiliationToRow(value: ProspectAffiliation) {
  return {
    id: value.id,
    prospect_id: value.prospectId,
    related_prospect_id: value.relatedProspectId ?? null,
    related_organization_name: value.relatedOrganizationName,
    affiliation_type: value.affiliationType,
    confidence: value.confidence,
    source_url: value.sourceUrl ?? null,
    observed_at: value.observedAt,
    evidence: value.evidence ?? {},
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function prospectSourceToRow(value: ProspectSource) {
  return {
    id: value.id,
    vertical: value.vertical,
    jurisdiction: value.jurisdiction,
    authority_name: value.authorityName,
    source_name: value.sourceName,
    source_url: value.sourceUrl,
    access_method: value.accessMethod,
    coverage_status: value.coverageStatus,
    record_scope: value.recordScope,
    refresh_cadence: value.refreshCadence ?? null,
    expected_record_count: value.expectedRecordCount ?? null,
    access_notes: value.accessNotes ?? null,
    last_checked_at: value.lastCheckedAt ?? null,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function prospectSourceRunToRow(value: ProspectSourceRun) {
  return {
    id: value.id,
    source_id: value.sourceId,
    status: value.status,
    started_at: value.startedAt,
    finished_at: value.finishedAt ?? null,
    snapshot_at: value.snapshotAt ?? null,
    source_hash: value.sourceHash ?? null,
    records_seen: value.recordsSeen,
    organizations_upserted: value.organizationsUpserted,
    locations_upserted: value.locationsUpserted,
    licenses_upserted: value.licensesUpserted,
    contacts_upserted: value.contactsUpserted,
    rejected_records: value.rejectedRecords,
    error: value.error ?? null,
    metadata: value.metadata ?? {},
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function prospectObservationToRow(value: ProspectObservation) {
  return {
    id: value.id,
    schema_version: 1,
    prospect_id: value.prospectId,
    source_type: value.sourceType,
    source_url: value.sourceUrl ?? null,
    observed_at: value.observedAt,
    website_kind: value.websiteKind,
    website_url: value.websiteUrl ?? null,
    review_rating: value.reviewRating ?? null,
    review_count: value.reviewCount ?? null,
    years_in_business: value.yearsInBusiness ?? null,
    cms: value.cms ?? null,
    site_builder: value.siteBuilder ?? null,
    managed_provider: value.managedProvider ?? null,
    agency_status: value.agencyStatus,
    agency_name: value.agencyName ?? null,
    website_assessment_id: value.websiteAssessmentId ?? null,
    prospect_report_id: value.prospectReportId ?? null,
    business_strength_score: value.businessStrengthScore ?? null,
    website_opportunity_score: value.websiteOpportunityScore ?? null,
    reachability_score: value.reachabilityScore ?? null,
    priority_score: value.priorityScore ?? null,
    scoring_model: value.scoringModel ?? null,
    verification_status: value.verificationStatus,
    verification_score: value.verificationScore ?? null,
    operating_status: value.operatingStatus,
    target_fit_status: value.targetFitStatus,
    target_fit_reason: value.targetFitReason ?? null,
    evidence_coverage: value.evidenceCoverage,
    producer: value.producer,
    methodology_identity: value.methodologyIdentity,
    input_hash: value.inputHash,
    notes: value.notes ?? null,
    evidence: value.evidence ?? {},
    created_at: value.createdAt
  };
}
function prospectContactToRow(value: ProspectContact) {
  return {
    id: value.id,
    prospect_id: value.prospectId,
    contact_type: value.contactType,
    full_name: value.fullName ?? null,
    role_title: value.roleTitle ?? null,
    email: value.email ?? null,
    phone: value.phone ?? null,
    source_type: value.sourceType,
    source_url: value.sourceUrl ?? null,
    verification_status: value.verificationStatus,
    outreach_eligible: value.outreachEligible,
    observed_at: value.observedAt,
    suppressed_at: value.suppressedAt ?? null,
    suppression_reason: value.suppressionReason ?? null,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function normalizedWebsiteHost(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    throw new Error(`Invalid prospect website URL: ${value}`);
  }
}
function optionalText(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
function normalizedCanonicalKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error("Prospect canonical key is required.");
  return normalized;
}
function eventFromRow(row: EventRow): OutboundEvent { return { id: row.id, campaignId: row.campaign_id, prospectId: row.prospect_id ?? undefined, siteId: row.site_id ?? undefined, type: row.type, occurredAt: row.occurred_at, value: row.value ?? undefined, metadata: row.metadata as OutboundEvent["metadata"] }; }
function reportFromRow(row: ReportRow): ProspectReportRecord {
  const report = row.report_json === null ? undefined : prospectPresenceReportResultSchema.safeParse(row.report_json);
  const businessStrength = row.business_strength_json === null ? undefined : businessStrengthAssessmentSchema.safeParse(row.business_strength_json);
  return {
    id: row.id,
    sourceKey: row.source_key,
    accessPolicy: row.access_policy,
    status: row.status,
    assessmentId: row.assessment_id ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    sourceHost: row.source_host ?? undefined,
    websiteKind: row.website_kind,
    result: report?.success ? report.data : undefined,
    businessStrength: businessStrength?.success ? businessStrength.data : undefined,
    resolutionUsage: row.resolution_usage as ProspectReportRecord["resolutionUsage"] | undefined,
    errorCode: row.error_code ?? (report && !report.success ? "stale_schema_rebuild_required" : undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined
  };
}
function leadFromRow(row: LeadRow): ProspectReportLead { return { id: row.id, reportId: row.report_id, email: row.email, contactName: row.contact_name ?? undefined, phone: row.phone ?? undefined, ipHash: row.ip_hash ?? undefined, metadata: row.metadata as ProspectReportLead["metadata"], createdAt: row.created_at }; }
function reportAccessGrantFromRow(row: ReportAccessGrantRow): ProspectReportAccessGrant { return { id: row.id, reportId: row.report_id, leadId: row.lead_id, tokenHash: row.token_hash, expiresAt: row.expires_at, createdAt: row.created_at, lastUsedAt: row.last_used_at ?? undefined }; }
function websiteAssessmentFromRow(row: WebsiteAssessmentRow): WebsiteAssessmentRecord { const parsed = row.assessment_json === null ? undefined : websiteAssessmentSchema.safeParse(row.assessment_json); return { id: row.id, status: row.status, targetKind: row.target_kind, sourceKey: row.source_key, sourceUrl: row.source_url ?? undefined, siteId: row.site_id ?? undefined, artifactId: row.artifact_id ?? undefined, versionId: row.version_id ?? undefined, rubricIdentity: row.rubric_identity, scannerIdentity: row.scanner_identity, assessment: parsed && parsed.success ? parsed.data : undefined, errorCode: row.error_code ?? (parsed && !parsed.success ? "stale_schema_rebuild_required" : undefined), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined }; }
function websiteAssessmentJobFromRow(row: WebsiteAssessmentJobRow): WebsiteAssessmentJob { return { id: row.id, assessmentId: row.assessment_id, prospectReportId: row.prospect_report_id ?? undefined, status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts, runAfter: row.run_after, lockedBy: row.locked_by ?? undefined, error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined }; }
function byCreatedDesc<T extends { createdAt: string }>(a: T, b: T) { return b.createdAt.localeCompare(a.createdAt); }
function isRetriableSetupFailure(code?: WebsiteSetupFailureCode) { return code === "crawl_temporarily_unavailable" || code === "bootstrap_failed" || code === "worker_interrupted"; }
async function data<T = unknown>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); if (result.data === null) throw new Error(`${operation}: no data returned`); return result.data; }
async function maybe<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); return result.data; }
