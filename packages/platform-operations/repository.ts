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
  prospectContactId,
  prospectIdForCanonicalKey,
  prospectLocationId,
  prospectImportSchema,
  prospectExplorerFields,
  prospectExplorerValue,
  normalizeProspectPhone,
  type Prospect,
  type ProspectCandidate,
  type ProspectCandidateContact,
  type ProspectCandidateFilter,
  type ProspectCandidateQuery,
  type ProspectContact,
  type ProspectExplorerFieldKey,
  type ProspectImportRecord,
  type ProspectLocation,
  type UpsertProspectContactInput,
  type UpsertProspectInput,
  type UpsertProspectLocationInput
} from "@/packages/prospect-research";
import {
  businessStrengthAssessmentSchema,
  prospectPresenceReportResultSchema
} from "./assessment-schemas";
import type {
  AdoptionInvitation,
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
  UpsertOutboundProspectInput
} from "./contracts";

export interface PlatformOperationsRepository {
  createAdoptionInvitation(input: { siteId: string; tokenHash: string; expiresAt: string }): Promise<AdoptionInvitation>;
  findAdoptionInvitation(tokenHash: string): Promise<AdoptionInvitation | null>;
  consumeAdoptionInvitation(input: { tokenHash: string; ownerUserId: string }): Promise<AdoptionInvitation | null>;
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
  upsertProspectContact(input: UpsertProspectContactInput): Promise<ProspectContact>;
  listProspectContacts(prospectId: string): Promise<ProspectContact[]>;
  importProspectResearch(records: ProspectImportRecord[]): Promise<{
    prospects: number;
    locations: number;
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

type LocalState = {
  adoptionInvitations: AdoptionInvitation[];
  previewGrants: SitePreviewGrant[];
  domains: DomainRecord[];
  redirects: SiteRedirectRule[];
  researchProspects: Prospect[];
  prospectLocations: ProspectLocation[];
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
  previewGrants: [],
  domains: [],
  redirects: [],
  researchProspects: [],
  prospectLocations: [],
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
  constructor(private readonly path = process.env.LODESTA_PLATFORM_OPERATIONS_LOCAL_PATH?.trim()
    || resolve(process.cwd(), ".data", "site-platform", "operations.json")) {}

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
        store.prospectContacts,
        store.prospectLocations
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
        store.prospectContacts,
        store.prospectLocations
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
  async upsertProspectContact(input: UpsertProspectContactInput) {
    let result!: ProspectContact;
    await this.write((store) => {
      if (!store.researchProspects.some((item) => item.id === input.prospectId)) throw new Error("Unknown prospect.");
      const id = input.id ?? prospectContactProjectionId(input);
      const existing = findExistingProspectContact(store.prospectContacts, input, id);
      result = prospectContactValue({ ...input, id }, existing);
      if (result.isPrimary) {
        for (const contact of store.prospectContacts) {
          if (contact.prospectId === input.prospectId && contact.id !== result.id) contact.isPrimary = false;
        }
      }
      if (existing) Object.assign(existing, result);
      else store.prospectContacts.push(result);
    });
    return structuredClone(result);
  }
  async listProspectContacts(prospectId: string) {
    return (await this.read()).prospectContacts
      .filter((item) => item.prospectId === prospectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((item) => structuredClone(item));
  }
  async importProspectResearch(records: ProspectImportRecord[]) {
    records = records.length ? prospectImportSchema.parse({ records }).records : [];
    assertUniqueProspectImportRecords(records);
    const counts = {
      prospects: 0,
      locations: 0,
      contacts: 0
    };
    await this.write((store) => {
      for (const record of records) {
        const existingProspect = store.researchProspects.find((item) =>
          item.canonicalKey === normalizedCanonicalKey(record.prospect.canonicalKey) || item.id === record.prospect.id
        );
        assertCanonicalProspectResearchUpdate(existingProspect, record);
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
        for (const contactInput of record.contacts ?? []) {
          const normalizedContact = { ...contactInput, prospectId: prospect.id };
          const id = normalizedContact.id ?? prospectContactProjectionId(normalizedContact);
          const existingContact = findExistingProspectContact(store.prospectContacts, normalizedContact, id);
          const contact = prospectContactValue({ ...normalizedContact, id }, existingContact);
          if (contact.isPrimary) {
            for (const candidate of store.prospectContacts) {
              if (candidate.prospectId === prospect.id && candidate.id !== contact.id) candidate.isPrimary = false;
            }
          }
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
      if (!store.campaigns.some((item) => item.id === input.campaignId)) throw new Error("Unknown campaign.");
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
    return { ...emptyState(), ...JSON.parse(raw) as Partial<LocalState> };
  }
  private write(operation: (state: LocalState) => void | Promise<void>) {
    const next = this.queue.then(async () => { const state = await this.read(); await operation(state); await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`); await rename(temp, this.path); });
    this.queue = next.catch(() => undefined); return next;
  }
}

type AdoptionInvitationRow = { id: string; site_id: string; token_hash: string; expires_at: string; created_at: string; consumed_at: string | null; consumed_by_user_id: string | null };
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
  vertical: string | null;
  research_state: Prospect["researchState"];
  website_url: string | null;
  website_platform: string | null;
  website_agency_provider: string | null;
  business_email: string | null;
  created_at: string;
  updated_at: string;
};
type ProspectLocationRow = {
  id: string;
  prospect_id: string;
  canonical_key: string;
  kind: ProspectLocation["kind"];
  location_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  county: string | null;
  phone: string | null;
  google_place_id: string | null;
  google_business_name: string | null;
  google_category: string | null;
  google_address: string | null;
  google_phone: string | null;
  google_website_url: string | null;
  google_maps_url: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  latitude: number | null;
  longitude: number | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};
type ProspectContactRow = {
  id: string;
  prospect_id: string;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};
type ProspectCurrentRow = ProspectResearchRow & {
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
  county: string | null;
  location_phone: string | null;
  google_business_name: string | null;
  google_category: string | null;
  google_address: string | null;
  google_phone: string | null;
  google_website_url: string | null;
  google_maps_url: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_place_id: string | null;
  primary_contact_name: string | null;
  primary_contact_role: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  outreach_email: string | null;
  outreach_phone: string | null;
  contact_details: unknown;
};
type ProspectRow = { id: string; prospect_id: string; campaign_id: string; site_id: string | null; report_id: string | null; preview_id: string | null; mailing_code: string | null; status: OutboundProspect["status"]; metadata: unknown; created_at: string; mailed_at: string | null; first_report_viewed_at: string | null; first_preview_viewed_at: string | null; adoption_started_at: string | null; adopted_at: string | null; published_at: string | null; disqualified_at: string | null };
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
    for (const filter of input.filters ?? []) query = applySupabaseProspectFilter(query, filter);
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
    for (const filter of input.filters ?? []) query = applySupabaseProspectFilter(query, filter);
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
  async upsertProspectContact(input: UpsertProspectContactInput) {
    const existing = findExistingProspectContact(await this.listProspectContacts(input.prospectId), input);
    return this.persistProspectContact(prospectContactValue(input, existing));
  }
  async listProspectContacts(prospectId: string) {
    return (await data<ProspectContactRow[]>(this.client.from("prospect_contacts")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("updated_at", { ascending: false }), "List prospect contacts")).map(prospectContactFromRow);
  }
  async importProspectResearch(records: ProspectImportRecord[]) {
    records = records.length ? prospectImportSchema.parse({ records }).records : [];
    assertUniqueProspectImportRecords(records);
    if (!records.length) return {
      prospects: 0,
      locations: 0,
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
    const prospects = records.map((record) => {
      const existing = existingByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey));
      assertCanonicalProspectResearchUpdate(existing, record);
      return prospectValue(record.prospect, existing);
    });
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
    const incomingContactInputs = records.flatMap((record) => {
      const prospect = prospectByCanonicalKey.get(normalizedCanonicalKey(record.prospect.canonicalKey));
      if (!prospect) throw new Error(`Imported prospect was not returned for ${record.prospect.canonicalKey}.`);
      return (record.contacts ?? []).map((contact) => ({ ...contact, prospectId: prospect.id }));
    });
    const existingContacts: ProspectContact[] = [];
    for (const prospectIdBatch of batches([...new Set(incomingContactInputs.map((contact) => contact.prospectId))], 250)) {
      if (!prospectIdBatch.length) continue;
      existingContacts.push(...(await data<ProspectContactRow[]>(this.client.from("prospect_contacts")
        .select("*")
        .in("prospect_id", prospectIdBatch), "Find imported contacts")).map(prospectContactFromRow));
    }
    const contacts = deduplicateProspectContacts(incomingContactInputs.map((contact) =>
      prospectContactValue(contact, findExistingProspectContact(existingContacts, contact))
    ));
    if (locations.length) {
      for (const batch of batches(locations.map(prospectLocationToRow), 250)) {
        await data(this.client.from("prospect_locations")
          .upsert(batch, { onConflict: "prospect_id,canonical_key", ignoreDuplicates: false })
          .select("id"), "Import prospect locations");
      }
    }
    if (contacts.length) {
      for (const contact of contacts) await this.persistProspectContact(contact);
    }
    return {
      prospects: prospects.length,
      locations: locations.length,
      contacts: contacts.length
    };
  }

  async createOutboundCampaign(input: CreateOutboundCampaignInput) { const value = newOutboundCampaign(input); return campaignFromRow(await data<CampaignRow>(this.client.from("outbound_campaigns").upsert({ id: value.id, name: value.name, channel: value.channel, status: value.status, metadata: value.metadata ?? {}, created_at: value.createdAt, started_at: value.startedAt, ended_at: value.endedAt }, { onConflict: "id", ignoreDuplicates: false }).select("*").single(), "Create campaign")); }
  async listOutboundCampaigns() { return (await data<CampaignRow[]>(this.client.from("outbound_campaigns").select("*").order("created_at", { ascending: false }), "List campaigns")).map(campaignFromRow); }
  async upsertOutboundProspect(input: UpsertOutboundProspectInput) {
    const prospect = await this.getProspect(input.prospectId);
    if (!prospect) throw new Error("Unknown canonical prospect.");
    const value = newOutboundProspect({
      ...input,
      businessName: prospect.businessName,
      vertical: prospect.vertical,
      sourceUrl: prospect.websiteUrl
    });
    const row = await data<ProspectRow>(this.client.from("outbound_prospects").upsert({
      id: value.id,
      prospect_id: value.prospectId,
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

  private async persistProspectContact(value: ProspectContact) {
    if (value.isPrimary) {
      const demotion = await this.client.from("prospect_contacts")
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq("prospect_id", value.prospectId)
        .neq("id", value.id)
        .eq("is_primary", true);
      if (demotion.error) throw new Error(`Demote existing primary prospect contact: ${demotion.error.message}`);
    }
    const row = await data<ProspectContactRow>(this.client.from("prospect_contacts")
      .upsert(prospectContactToRow(value), { onConflict: "id", ignoreDuplicates: false })
      .select("*")
      .single(), "Upsert prospect contact");
    return prospectContactFromRow(row);
  }

  private async applyEvent(id: string, event: OutboundEvent) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("id", id).maybeSingle(), "Read event prospect"); if (!row) return; const value = await this.outboundProspectFromMembership(row); applyOutboundEventToProspect(value, event); await data(this.client.from("outbound_prospects").update({ site_id: value.siteId, status: value.status, mailed_at: value.mailedAt, first_report_viewed_at: value.firstReportViewedAt, first_preview_viewed_at: value.firstPreviewViewedAt, adoption_started_at: value.adoptionStartedAt, adopted_at: value.adoptedAt, published_at: value.publishedAt, disqualified_at: value.disqualifiedAt }).eq("id", id).select("id").single(), "Update event prospect"); }
}

export const platformOperationsRepository: PlatformOperationsRepository = process.env.LODESTA_REPOSITORY === "local"
  ? new LocalPlatformOperationsRepository()
  : new SupabasePlatformOperationsRepository();

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
function outboundProspectFromRows(row: ProspectRow, prospect: Prospect): OutboundProspect { return { id: row.id, prospectId: row.prospect_id, campaignId: row.campaign_id, siteId: row.site_id ?? undefined, reportId: row.report_id ?? undefined, businessName: prospect.businessName, vertical: prospect.vertical, sourceUrl: prospect.websiteUrl, previewId: row.preview_id ?? undefined, mailingCode: row.mailing_code ?? undefined, status: row.status, metadata: row.metadata as OutboundProspect["metadata"], createdAt: row.created_at, mailedAt: row.mailed_at ?? undefined, firstReportViewedAt: row.first_report_viewed_at ?? undefined, firstPreviewViewedAt: row.first_preview_viewed_at ?? undefined, adoptionStartedAt: row.adoption_started_at ?? undefined, adoptedAt: row.adopted_at ?? undefined, publishedAt: row.published_at ?? undefined, disqualifiedAt: row.disqualified_at ?? undefined }; }
function prospectValue(input: UpsertProspectInput, existing?: Prospect): Prospect {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? input.id ?? prospectIdForCanonicalKey(input.canonicalKey),
    canonicalKey: normalizedCanonicalKey(input.canonicalKey),
    businessName: input.businessName.trim(),
    vertical: optionalText(input.vertical) ?? existing?.vertical,
    researchState: input.researchState ?? existing?.researchState ?? "pending",
    websiteUrl: optionalText(input.websiteUrl) ?? existing?.websiteUrl,
    websitePlatform: optionalText(input.websitePlatform) ?? existing?.websitePlatform,
    websiteAgencyProvider: optionalText(input.websiteAgencyProvider) ?? existing?.websiteAgencyProvider,
    businessEmail: optionalText(input.businessEmail)?.toLowerCase() ?? existing?.businessEmail,
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
    locationName: optionalText(input.locationName),
    addressLine1: optionalText(input.addressLine1),
    addressLine2: optionalText(input.addressLine2),
    locality: optionalText(input.locality),
    region: optionalText(input.region)?.toUpperCase(),
    postalCode: optionalText(input.postalCode),
    countryCode: input.countryCode.trim().toUpperCase(),
    county: optionalText(input.county),
    phone: normalizeProspectPhone(input.phone),
    googlePlaceId: optionalText(input.googlePlaceId),
    googleBusinessName: optionalText(input.googleBusinessName),
    googleCategory: optionalText(input.googleCategory),
    googleAddress: optionalText(input.googleAddress),
    googlePhone: normalizeProspectPhone(input.googlePhone),
    googleWebsiteUrl: optionalText(input.googleWebsiteUrl),
    googleMapsUrl: optionalText(input.googleMapsUrl),
    googleRating: input.googleRating,
    googleReviewCount: input.googleReviewCount,
    latitude: input.latitude,
    longitude: input.longitude,
    isPrimary: input.isPrimary || existing?.isPrimary || false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function assertCanonicalProspectResearchUpdate(existing: Prospect | undefined, record: ProspectImportRecord) {
  if (existing && normalizeIdentityName(existing.businessName) !== normalizeIdentityName(record.prospect.businessName)) {
    throw new Error("A source import cannot silently change the canonical business name.");
  }
}

function normalizeIdentityName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function prospectContactProjectionId(input: UpsertProspectContactInput) {
  return prospectContactId(input);
}
function prospectContactValue(input: UpsertProspectContactInput, existing?: ProspectContact): ProspectContact {
  const now = new Date().toISOString();
  const email = optionalText(input.email)?.toLowerCase();
  const phone = normalizeProspectPhone(input.phone);
  const fullName = optionalText(input.fullName);
  if (!fullName) throw new Error("A prospect contact requires a name.");
  return {
    id: existing?.id ?? input.id ?? prospectContactProjectionId(input),
    prospectId: input.prospectId,
    fullName,
    roleTitle: optionalText(input.roleTitle),
    email,
    phone,
    isPrimary: input.isPrimary,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
function findExistingProspectContact(
  contacts: ProspectContact[],
  input: { prospectId: string; id?: string; fullName: string; email?: string; phone?: string },
  deterministicId?: string
) {
  const fullName = normalizeIdentityName(input.fullName);
  return contacts.find((contact) => contact.prospectId === input.prospectId && (
    contact.id === input.id
    || contact.id === deterministicId
    || normalizeIdentityName(contact.fullName) === fullName
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
    Object.assign(existing, {
      fullName: preferred.fullName,
      roleTitle: preferred.roleTitle ?? existing.roleTitle ?? contact.roleTitle,
      email: existing.email ?? contact.email,
      phone: existing.phone ?? contact.phone,
      isPrimary: existing.isPrimary || contact.isPrimary,
      createdAt: existing.createdAt < contact.createdAt ? existing.createdAt : contact.createdAt,
      updatedAt: existing.updatedAt > contact.updatedAt ? existing.updatedAt : contact.updatedAt
    });
    for (const key of new Set([...keys, ...prospectContactIdentityKeys(existing)])) {
      byIdentity.set(key, existing);
    }
  }
  for (const prospectId of new Set(result.map((contact) => contact.prospectId))) {
    const primaries = result
      .filter((contact) => contact.prospectId === prospectId && contact.isPrimary)
      .sort((left, right) => prospectContactPriority({ ...right, isPrimary: false }) - prospectContactPriority({ ...left, isPrimary: false })
        || Number(Boolean(right.email)) - Number(Boolean(left.email))
        || Number(Boolean(right.phone)) - Number(Boolean(left.phone))
        || right.updatedAt.localeCompare(left.updatedAt));
    for (const contact of primaries.slice(1)) contact.isPrimary = false;
  }
  return result;
}
function prospectContactIdentityKeys(contact: ProspectContact) {
  return [
    `id:${contact.id}`,
    `name:${contact.prospectId}:${normalizeIdentityName(contact.fullName)}`
  ].filter((value): value is string => Boolean(value));
}

function preferredProspectContact(left: ProspectContact, right: ProspectContact) {
  const leftScore = prospectContactPriority(left) + Number(Boolean(left.email)) + Number(Boolean(left.phone));
  const rightScore = prospectContactPriority(right) + Number(Boolean(right.email)) + Number(Boolean(right.phone));
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;
  return right.updatedAt > left.updatedAt ? right : left;
}
function prospectCandidateValue(
  prospect: Prospect,
  contacts: ProspectContact[],
  locations: ProspectLocation[]
): ProspectCandidate {
  const primaryLocation = locations
    .filter((location) => location.prospectId === prospect.id)
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary)
      || Number(Boolean(right.googlePlaceId)) - Number(Boolean(left.googlePlaceId))
      || right.updatedAt.localeCompare(left.updatedAt))[0];
  const activeContacts = contacts
    .filter((contact) => contact.prospectId === prospect.id)
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary)
      || prospectContactPriority(right) - prospectContactPriority(left)
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.id.localeCompare(left.id));
  const primaryContact = activeContacts[0];
  return {
    ...prospect,
    primaryAddressLine1: primaryLocation?.addressLine1,
    primaryAddressLine2: primaryLocation?.addressLine2,
    primaryLocality: primaryLocation?.locality,
    primaryRegion: primaryLocation?.region,
    primaryPostalCode: primaryLocation?.postalCode,
    primaryCountryCode: primaryLocation?.countryCode,
    county: primaryLocation?.county,
    locationPhone: primaryLocation?.phone,
    googleBusinessName: primaryLocation?.googleBusinessName,
    googleCategory: primaryLocation?.googleCategory,
    googleAddress: primaryLocation?.googleAddress,
    googlePhone: primaryLocation?.googlePhone,
    googleWebsiteUrl: primaryLocation?.googleWebsiteUrl,
    googleMapsUrl: primaryLocation?.googleMapsUrl,
    googleRating: primaryLocation?.googleRating,
    googleReviewCount: primaryLocation?.googleReviewCount,
    googlePlaceId: primaryLocation?.googlePlaceId,
    primaryContactName: primaryContact?.fullName,
    primaryContactRole: primaryContact?.roleTitle,
    primaryContactEmail: primaryContact?.email,
    primaryContactPhone: primaryContact?.phone,
    outreachEmail: primaryContact?.email ?? prospect.businessEmail,
    outreachPhone: primaryContact?.phone ?? primaryLocation?.phone ?? primaryLocation?.googlePhone,
    contacts: activeContacts.map(prospectCandidateContactValue)
  };
}
function prospectContactPriority(contact: Pick<ProspectContact, "roleTitle" | "isPrimary">) {
  if (contact.isPrimary) return 1_000;
  const role = contact.roleTitle?.toLowerCase() ?? "";
  if (/owner|founder|principal/.test(role)) return 100;
  if (/president|chief executive|ceo|managing member|partner/.test(role)) return 90;
  if (/manager/.test(role)) return 70;
  if (/operator/.test(role)) return 50;
  if (/applicator/.test(role)) return 40;
  return 10;
}
function matchesProspectQuery(candidate: ProspectCandidate, input: ProspectCandidateQuery) {
  const search = input.search?.trim().toLowerCase();
  return (!search || candidate.businessName.toLowerCase().includes(search))
    && (input.filters ?? []).every((filter) => matchesProspectFilter(candidate, filter));
}
function matchesProspectFilter(candidate: ProspectCandidate, filter: ProspectCandidateFilter) {
  const field = prospectExplorerFields[filter.field];
  const candidateValue = prospectExplorerValue(candidate, filter.field);
  if (filter.operator === "is_empty") return candidateValue === undefined || candidateValue === "";
  if (filter.operator === "is_not_empty") return candidateValue !== undefined && candidateValue !== "";
  if (candidateValue === undefined || !filter.value) return false;
  const filterValue = prospectFilterValue(filter);
  if (filter.operator === "contains") {
    return String(candidateValue).toLocaleLowerCase().includes(String(filterValue).toLocaleLowerCase());
  }
  if (filter.operator === "equals") return candidateValue === filterValue;
  if (filter.operator === "not_equals") return candidateValue !== filterValue;
  const comparison = field.kind === "date"
    ? Date.parse(String(candidateValue)) - Date.parse(String(filterValue))
    : Number(candidateValue) - Number(filterValue);
  if (filter.operator === "greater_than") return comparison > 0;
  if (filter.operator === "greater_than_or_equal") return comparison >= 0;
  if (filter.operator === "less_than") return comparison < 0;
  return comparison <= 0;
}
type ProspectSupabaseFilterQuery<T> = {
  eq(column: string, value: unknown): T;
  neq(column: string, value: unknown): T;
  gt(column: string, value: unknown): T;
  gte(column: string, value: unknown): T;
  lt(column: string, value: unknown): T;
  lte(column: string, value: unknown): T;
  ilike(column: string, pattern: string): T;
  is(column: string, value: null): T;
  not(column: string, operator: string, value: unknown): T;
};
function applySupabaseProspectFilter<T extends ProspectSupabaseFilterQuery<T>>(query: T, filter: ProspectCandidateFilter): T {
  const value = prospectFilterValue(filter);
  if (filter.operator === "contains") return query.ilike(filter.field, `%${String(value)}%`);
  if (filter.operator === "equals") return query.eq(filter.field, value);
  if (filter.operator === "not_equals") return query.neq(filter.field, value);
  if (filter.operator === "greater_than") return query.gt(filter.field, value);
  if (filter.operator === "greater_than_or_equal") return query.gte(filter.field, value);
  if (filter.operator === "less_than") return query.lt(filter.field, value);
  if (filter.operator === "less_than_or_equal") return query.lte(filter.field, value);
  if (filter.operator === "is_empty") return query.is(filter.field, null);
  return query.not(filter.field, "is", null);
}
function prospectFilterValue(filter: ProspectCandidateFilter): string | number {
  const value = filter.value ?? "";
  const kind = prospectExplorerFields[filter.field].kind;
  if (kind === "number") return Number(value);
  return value;
}
function compareProspectCandidates(
  left: ProspectCandidate,
  right: ProspectCandidate,
  input: ProspectCandidateQuery
) {
  const direction = input.sortDirection ?? defaultProspectSortDirection(input.sortBy);
  const field = input.sortBy ?? "business_name";
  const result = compareProspectValues(prospectExplorerValue(left, field), prospectExplorerValue(right, field), direction);
  return result
    || left.businessName.localeCompare(right.businessName)
    || left.id.localeCompare(right.id);
}
function compareProspectValues(left: string | number | boolean | undefined, right: string | number | boolean | undefined, direction: "asc" | "desc") {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}
function prospectSortColumn(sortBy?: ProspectCandidateQuery["sortBy"]) { return sortBy ?? "business_name"; }
function defaultProspectSortDirection(sortBy?: ProspectCandidateQuery["sortBy"]): "asc" | "desc" {
  if (!sortBy) return "asc";
  return ["number", "date"].includes(prospectExplorerFields[sortBy].kind) ? "desc" : "asc";
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
    vertical: row.vertical ?? undefined,
    researchState: row.research_state,
    websiteUrl: row.website_url ?? undefined,
    websitePlatform: row.website_platform ?? undefined,
    websiteAgencyProvider: row.website_agency_provider ?? undefined,
    businessEmail: row.business_email ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectCandidateFromRow(row: ProspectCurrentRow): ProspectCandidate {
  return {
    ...prospectResearchFromRow(row),
    primaryAddressLine1: row.address_line_1 ?? undefined,
    primaryAddressLine2: row.address_line_2 ?? undefined,
    primaryLocality: row.locality ?? undefined,
    primaryRegion: row.region ?? undefined,
    primaryPostalCode: row.postal_code ?? undefined,
    primaryCountryCode: row.country_code ?? undefined,
    county: row.county ?? undefined,
    locationPhone: row.location_phone ?? undefined,
    googleBusinessName: row.google_business_name ?? undefined,
    googleCategory: row.google_category ?? undefined,
    googleAddress: row.google_address ?? undefined,
    googlePhone: row.google_phone ?? undefined,
    googleWebsiteUrl: row.google_website_url ?? undefined,
    googleMapsUrl: row.google_maps_url ?? undefined,
    googleRating: row.google_rating ?? undefined,
    googleReviewCount: row.google_review_count ?? undefined,
    googlePlaceId: row.google_place_id ?? undefined,
    primaryContactName: row.primary_contact_name ?? undefined,
    primaryContactRole: row.primary_contact_role ?? undefined,
    primaryContactEmail: row.primary_contact_email ?? undefined,
    primaryContactPhone: row.primary_contact_phone ?? undefined,
    outreachEmail: row.outreach_email ?? undefined,
    outreachPhone: row.outreach_phone ?? undefined,
    contacts: prospectCandidateContactsFromUnknown(row.contact_details)
  };
}
function prospectLocationFromRow(row: ProspectLocationRow): ProspectLocation {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    canonicalKey: row.canonical_key,
    kind: row.kind,
    locationName: row.location_name ?? undefined,
    addressLine1: row.address_line_1 ?? undefined,
    addressLine2: row.address_line_2 ?? undefined,
    locality: row.locality ?? undefined,
    region: row.region ?? undefined,
    postalCode: row.postal_code ?? undefined,
    countryCode: row.country_code,
    county: row.county ?? undefined,
    phone: row.phone ?? undefined,
    googlePlaceId: row.google_place_id ?? undefined,
    googleBusinessName: row.google_business_name ?? undefined,
    googleCategory: row.google_category ?? undefined,
    googleAddress: row.google_address ?? undefined,
    googlePhone: row.google_phone ?? undefined,
    googleWebsiteUrl: row.google_website_url ?? undefined,
    googleMapsUrl: row.google_maps_url ?? undefined,
    googleRating: row.google_rating ?? undefined,
    googleReviewCount: row.google_review_count ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectContactFromRow(row: ProspectContactRow): ProspectContact {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    fullName: row.full_name,
    roleTitle: row.role_title ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function prospectCandidateContactValue(contact: ProspectContact): ProspectCandidateContact {
  return {
    id: contact.id,
    fullName: contact.fullName,
    roleTitle: contact.roleTitle,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary
  };
}
function prospectCandidateContactsFromUnknown(value: unknown): ProspectCandidateContact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const contact = item as Record<string, unknown>;
    if (typeof contact.id !== "string" || typeof contact.fullName !== "string") return [];
    return [{
      id: contact.id,
      fullName: contact.fullName,
      roleTitle: typeof contact.roleTitle === "string" ? contact.roleTitle : undefined,
      email: typeof contact.email === "string" ? contact.email : undefined,
      phone: typeof contact.phone === "string" ? contact.phone : undefined,
      isPrimary: contact.isPrimary === true
    }];
  });
}
function prospectToRow(value: Prospect) {
  return {
    id: value.id,
    canonical_key: value.canonicalKey,
    business_name: value.businessName,
    vertical: value.vertical ?? null,
    research_state: value.researchState,
    website_url: value.websiteUrl ?? null,
    website_platform: value.websitePlatform ?? null,
    website_agency_provider: value.websiteAgencyProvider ?? null,
    business_email: value.businessEmail ?? null,
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
    location_name: value.locationName ?? null,
    address_line_1: value.addressLine1 ?? null,
    address_line_2: value.addressLine2 ?? null,
    locality: value.locality ?? null,
    region: value.region ?? null,
    postal_code: value.postalCode ?? null,
    country_code: value.countryCode,
    county: value.county ?? null,
    phone: value.phone ?? null,
    google_place_id: value.googlePlaceId ?? null,
    google_business_name: value.googleBusinessName ?? null,
    google_category: value.googleCategory ?? null,
    google_address: value.googleAddress ?? null,
    google_phone: value.googlePhone ?? null,
    google_website_url: value.googleWebsiteUrl ?? null,
    google_maps_url: value.googleMapsUrl ?? null,
    google_rating: value.googleRating ?? null,
    google_review_count: value.googleReviewCount ?? null,
    latitude: value.latitude ?? null,
    longitude: value.longitude ?? null,
    is_primary: value.isPrimary,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}
function prospectContactToRow(value: ProspectContact) {
  return {
    id: value.id,
    prospect_id: value.prospectId,
    full_name: value.fullName,
    role_title: value.roleTitle ?? null,
    email: value.email ?? null,
    phone: value.phone ?? null,
    is_primary: value.isPrimary,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
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
async function data<T = unknown>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); if (result.data === null) throw new Error(`${operation}: no data returned`); return result.data; }
async function maybe<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); return result.data; }
