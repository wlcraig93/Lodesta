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
import type {
  AdoptionInvitation,
  CreateWebsiteSetupInput,
  CreateOutboundCampaignInput,
  CreateProspectReportInput,
  CreateProspectReportLeadInput,
  DomainRecord,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  OutboundSummary,
  ProspectReportJob,
  ProspectReportLead,
  ProspectReportRecord,
  RecordOutboundEventInput,
  RegisterDomainInput,
  SiteRedirectRule,
  SitePreviewToken,
  UpsertSiteRedirectInput,
  UpdateProspectReportInput,
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
  claimNextWebsiteSetup(workerId: string): Promise<WebsiteSetup | null>;
  linkWebsiteSetup(input: { setupId: string; sourceRevision: number; siteId: string; sessionId: string; runId: string }): Promise<WebsiteSetup | null>;
  failWebsiteSetup(input: { setupId: string; sourceRevision: number; failureCode: WebsiteSetupFailureCode; failureReason: string; siteId?: string }): Promise<WebsiteSetup | null>;
  createPreviewToken(input: { siteId: string; siteVersionId: string; expiresAt?: string }): Promise<SitePreviewToken>;
  resolvePreviewToken(token: string): Promise<SitePreviewToken | null>;
  listPreviewTokens(siteId?: string): Promise<SitePreviewToken[]>;
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
  createOutboundCampaign(input: CreateOutboundCampaignInput): Promise<OutboundCampaign>;
  listOutboundCampaigns(): Promise<OutboundCampaign[]>;
  upsertOutboundProspect(input: UpsertOutboundProspectInput): Promise<OutboundProspect>;
  listOutboundProspects(campaignId?: string): Promise<OutboundProspect[]>;
  findOutboundProspectByPreviewToken(previewToken: string): Promise<OutboundProspect | null>;
  recordOutboundEvent(input: RecordOutboundEventInput): Promise<OutboundEvent>;
  listOutboundEvents(campaignId?: string): Promise<OutboundEvent[]>;
  outboundSummary(campaignId?: string): Promise<OutboundSummary>;
  createProspectReport(input: CreateProspectReportInput): Promise<ProspectReportRecord>;
  getProspectReport(reportId: string): Promise<ProspectReportRecord | null>;
  findActiveProspectReportByPlaceId(placeId: string): Promise<ProspectReportRecord | null>;
  findReusableProspectReportByPlaceId(placeId: string, since: string): Promise<ProspectReportRecord | null>;
  updateProspectReport(input: UpdateProspectReportInput): Promise<ProspectReportRecord | null>;
  createProspectReportLead(input: CreateProspectReportLeadInput): Promise<ProspectReportLead | null>;
  enqueueProspectReportJob(reportId: string): Promise<ProspectReportJob>;
  claimNextProspectReportJob(workerId: string): Promise<ProspectReportJob | null>;
  completeProspectReportJob(jobId: string): Promise<void>;
  failProspectReportJob(jobId: string, error: string): Promise<void>;
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
  previewTokens: SitePreviewToken[];
  domains: DomainRecord[];
  redirects: SiteRedirectRule[];
  campaigns: OutboundCampaign[];
  prospects: OutboundProspect[];
  events: OutboundEvent[];
  reports: ProspectReportRecord[];
  leads: ProspectReportLead[];
  prospectReportJobs: ProspectReportJob[];
};

const emptyState = (): LocalState => ({ adoptionInvitations: [], websiteSetups: [], previewTokens: [], domains: [], redirects: [], campaigns: [], prospects: [], events: [], reports: [], leads: [], prospectReportJobs: [] });

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

  async createPreviewToken(input: { siteId: string; siteVersionId: string; expiresAt?: string }) {
    const [site, version] = await Promise.all([sitePlatformRepository.getSite(input.siteId), sitePlatformRepository.getSiteVersion(input.siteVersionId)]);
    if (!site || !version || version.siteId !== site.id) throw new Error("Preview version does not belong to the site.");
    const token = { token: crypto.randomUUID().replaceAll("-", ""), siteId: input.siteId, siteVersionId: input.siteVersionId, expiresAt: input.expiresAt, createdAt: new Date().toISOString() };
    await this.write((store) => { store.previewTokens.push(token); });
    return token;
  }
  async resolvePreviewToken(token: string) {
    const found = (await this.read()).previewTokens.find((item) => item.token === token);
    if (!found || (found.expiresAt && Date.parse(found.expiresAt) <= Date.now())) return null;
    return structuredClone(found);
  }
  async listPreviewTokens(siteId?: string) { return (await this.read()).previewTokens.filter((item) => !siteId || item.siteId === siteId).sort(byCreatedDesc); }

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

  async createOutboundCampaign(input: CreateOutboundCampaignInput) { const value = newOutboundCampaign(input); await this.write((s) => { s.campaigns.push(value); }); return value; }
  async listOutboundCampaigns() { return (await this.read()).campaigns.sort(byCreatedDesc); }
  async upsertOutboundProspect(input: UpsertOutboundProspectInput) {
    let result!: OutboundProspect;
    await this.write((store) => {
      const existing = input.id ? store.prospects.find((item) => item.id === input.id) : undefined;
      if (existing) { Object.assign(existing, input, { businessName: input.businessName.trim(), metadata: input.metadata ?? existing.metadata }); result = structuredClone(existing); }
      else { result = newOutboundProspect(input); store.prospects.push(result); }
    });
    return result;
  }
  async listOutboundProspects(campaignId?: string) { return (await this.read()).prospects.filter((item) => !campaignId || item.campaignId === campaignId).sort(byCreatedDesc); }
  async findOutboundProspectByPreviewToken(token: string) { return structuredClone((await this.read()).prospects.find((item) => item.previewToken === token) ?? null); }
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
    const report: ProspectReportRecord = { id: input.id ?? `prospect_report_${crypto.randomUUID().replaceAll("-", "")}`, placeId: input.placeId, status: "queued", jobId: input.jobId, sourceUrl: input.sourceUrl, sourceHost: input.sourceHost, websiteKind: input.websiteKind, createdAt: now, updatedAt: now };
    await this.write((store) => { store.reports.push(report); });
    return report;
  }
  async getProspectReport(id: string) { return structuredClone((await this.read()).reports.find((item) => item.id === id) ?? null); }
  async findActiveProspectReportByPlaceId(placeId: string) { return structuredClone((await this.read()).reports.filter((item) => item.placeId === placeId && ["queued", "running"].includes(item.status)).sort(byCreatedDesc)[0] ?? null); }
  async findReusableProspectReportByPlaceId(placeId: string, since: string) { return structuredClone((await this.read()).reports.filter((item) => item.placeId === placeId && item.status === "completed" && (item.completedAt ?? "") >= since).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0] ?? null); }
  async updateProspectReport(input: UpdateProspectReportInput) {
    let result: ProspectReportRecord | null = null;
    await this.write((store) => {
      const report = store.reports.find((item) => item.id === input.reportId);
      if (!report) return;
      Object.assign(report, Object.fromEntries(Object.entries(input).filter(([key, value]) => key !== "reportId" && value !== undefined)), { updatedAt: new Date().toISOString() });
      result = structuredClone(report);
    });
    return result;
  }
  async createProspectReportLead(input: CreateProspectReportLeadInput) {
    if (!await this.getProspectReport(input.reportId)) return null;
    const lead: ProspectReportLead = { id: `prospect_lead_${crypto.randomUUID().replaceAll("-", "")}`, reportId: input.reportId, email: input.email.toLowerCase(), contactName: input.contactName, phone: input.phone, ipHash: input.ipHash, metadata: input.metadata, createdAt: new Date().toISOString() };
    await this.write((store) => { store.leads.push(lead); const report = store.reports.find((item) => item.id === input.reportId); if (report) { report.unlockedAt = lead.createdAt; report.leadId = lead.id; report.updatedAt = lead.createdAt; } });
    return lead;
  }
  async enqueueProspectReportJob(reportId: string) {
    const now = new Date().toISOString();
    const job: ProspectReportJob = { id: `prospect_job_${crypto.randomUUID().replaceAll("-", "")}`, reportId, status: "queued", attempts: 0, maxAttempts: 2, runAfter: now, createdAt: now, updatedAt: now };
    await this.write((store) => { store.prospectReportJobs.push(job); });
    return job;
  }
  async claimNextProspectReportJob(workerId: string) {
    let result: ProspectReportJob | null = null;
    await this.write((store) => {
      const job = store.prospectReportJobs.filter((item) => item.status === "queued" && item.runAfter <= new Date().toISOString()).sort(byCreatedDesc).at(-1);
      if (!job) return;
      job.status = "running"; job.attempts += 1; job.lockedBy = workerId; job.updatedAt = new Date().toISOString(); result = structuredClone(job);
    });
    return result;
  }
  async completeProspectReportJob(jobId: string) { await this.write((store) => { const job = store.prospectReportJobs.find((item) => item.id === jobId); if (job) { job.status = "completed"; job.updatedAt = new Date().toISOString(); } }); }
  async failProspectReportJob(jobId: string, error: string) { await this.write((store) => { const job = store.prospectReportJobs.find((item) => item.id === jobId); if (!job) return; job.error = error; job.status = job.attempts < job.maxAttempts ? "queued" : "failed"; job.runAfter = new Date(Date.now() + 30_000).toISOString(); job.updatedAt = new Date().toISOString(); }); }

  private async read() {
    const raw = await readFile(this.path, "utf8").catch(() => undefined);
    return raw ? { ...emptyState(), ...JSON.parse(raw) as Partial<LocalState> } : emptyState();
  }
  private write(operation: (state: LocalState) => void | Promise<void>) {
    const next = this.queue.then(async () => { const state = await this.read(); await operation(state); await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`); await rename(temp, this.path); });
    this.queue = next.catch(() => undefined); return next;
  }
}

type AdoptionInvitationRow = { id: string; site_id: string; token_hash: string; expires_at: string; created_at: string; consumed_at: string | null; consumed_by_user_id: string | null };
type WebsiteSetupRow = { id: string; owner_user_id: string; source_url: string; normalized_source: string; source_revision: number; status: WebsiteSetup["status"]; site_id: string | null; session_id: string | null; run_id: string | null; attempts: number; max_attempts: number; idempotency_key: string; creation_request_hash: string; locked_by: string | null; locked_at: string | null; failure_code: WebsiteSetupFailureCode | null; failure_reason: string | null; created_at: string; updated_at: string };
type PreviewTokenRow = { token: string; site_id: string; site_version_id: string | null; expires_at: string | null; created_at: string };
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
type ProspectRow = { id: string; campaign_id: string; site_id: string | null; business_name: string; vertical: OutboundProspect["vertical"] | null; source_url: string | null; preview_token: string | null; mailing_code: string | null; status: OutboundProspect["status"]; metadata: unknown; created_at: string; mailed_at: string | null; first_preview_viewed_at: string | null; adoption_started_at: string | null; adopted_at: string | null; published_at: string | null; disqualified_at: string | null };
type EventRow = { id: string; campaign_id: string; prospect_id: string | null; site_id: string | null; type: OutboundEvent["type"]; occurred_at: string; value: number | null; metadata: unknown };
type ReportRow = { id: string; place_id: string; status: ProspectReportRecord["status"]; job_id: string | null; source_url: string | null; source_host: string | null; website_kind: ProspectReportRecord["websiteKind"]; report_json: unknown; unlocked_at: string | null; lead_id: string | null; error_code: string | null; created_at: string; updated_at: string; completed_at: string | null };
type LeadRow = { id: string; report_id: string; email: string; contact_name: string | null; phone: string | null; ip_hash: string | null; metadata: unknown; created_at: string };
type JobRow = { id: string; report_id: string; status: ProspectReportJob["status"]; error: string | null; attempts: number; max_attempts: number; run_after: string; locked_by: string | null; created_at: string; updated_at: string };

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

  async createPreviewToken(input: { siteId: string; siteVersionId: string; expiresAt?: string }) {
    const version = await sitePlatformRepository.getSiteVersion(input.siteVersionId);
    if (!version || version.siteId !== input.siteId) throw new Error("Preview version does not belong to the site.");
    const row = await data<PreviewTokenRow>(this.client.from("preview_tokens").insert({ token: crypto.randomUUID().replaceAll("-", ""), site_id: input.siteId, site_version_id: input.siteVersionId, expires_at: input.expiresAt }).select("*").single(), "Create preview token");
    return previewFromRow(row);
  }
  async resolvePreviewToken(token: string) { const row = await maybe<PreviewTokenRow>(this.client.from("preview_tokens").select("*").eq("token", token).maybeSingle(), "Resolve preview token"); if (!row || !row.site_version_id || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null; return previewFromRow(row); }
  async listPreviewTokens(siteId?: string) { let query = this.client.from("preview_tokens").select("*").not("site_version_id", "is", null).order("created_at", { ascending: false }); if (siteId) query = query.eq("site_id", siteId); return (await data<PreviewTokenRow[]>(query, "List preview tokens")).map(previewFromRow); }

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

  async createOutboundCampaign(input: CreateOutboundCampaignInput) { const value = newOutboundCampaign(input); return campaignFromRow(await data<CampaignRow>(this.client.from("outbound_campaigns").insert({ id: value.id, name: value.name, channel: value.channel, status: value.status, metadata: value.metadata ?? {}, created_at: value.createdAt, started_at: value.startedAt, ended_at: value.endedAt }).select("*").single(), "Create campaign")); }
  async listOutboundCampaigns() { return (await data<CampaignRow[]>(this.client.from("outbound_campaigns").select("*").order("created_at", { ascending: false }), "List campaigns")).map(campaignFromRow); }
  async upsertOutboundProspect(input: UpsertOutboundProspectInput) { const value = newOutboundProspect(input); return prospectFromRow(await data<ProspectRow>(this.client.from("outbound_prospects").upsert({ id: value.id, campaign_id: value.campaignId, site_id: value.siteId, business_name: value.businessName, vertical: value.vertical, source_url: value.sourceUrl, preview_token: value.previewToken, mailing_code: value.mailingCode, status: value.status, metadata: value.metadata ?? {}, created_at: value.createdAt }).select("*").single(), "Upsert prospect")); }
  async listOutboundProspects(campaignId?: string) { let query = this.client.from("outbound_prospects").select("*").order("created_at", { ascending: false }); if (campaignId) query = query.eq("campaign_id", campaignId); return (await data<ProspectRow[]>(query, "List prospects")).map(prospectFromRow); }
  async findOutboundProspectByPreviewToken(token: string) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("preview_token", token).maybeSingle(), "Find prospect"); return row ? prospectFromRow(row) : null; }
  async recordOutboundEvent(input: RecordOutboundEventInput) { const value = newOutboundEvent(input); const row = await data<EventRow>(this.client.from("outbound_events").insert({ id: value.id, campaign_id: value.campaignId, prospect_id: value.prospectId, site_id: value.siteId, type: value.type, occurred_at: value.occurredAt, value: value.value, metadata: value.metadata ?? {} }).select("*").single(), "Record outbound event"); const event = eventFromRow(row); const prospectId = event.prospectId ?? (event.siteId ? (await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("campaign_id", event.campaignId).eq("site_id", event.siteId).maybeSingle(), "Find prospect by site"))?.id : undefined); if (prospectId) await this.applyEvent(prospectId, event); return event; }
  async listOutboundEvents(campaignId?: string) { let query = this.client.from("outbound_events").select("*").order("occurred_at", { ascending: false }); if (campaignId) query = query.eq("campaign_id", campaignId); return (await data<EventRow[]>(query, "List outbound events")).map(eventFromRow); }
  async outboundSummary(campaignId?: string) { return summarizeOutbound(await this.listOutboundCampaigns(), await this.listOutboundProspects(campaignId), await this.listOutboundEvents(campaignId), campaignId); }

  async createProspectReport(input: CreateProspectReportInput) { const now = new Date().toISOString(); return reportFromRow(await data<ReportRow>(this.client.from("prospect_reports").insert({ id: input.id ?? `prospect_report_${crypto.randomUUID().replaceAll("-", "")}`, place_id: input.placeId, status: "queued", job_id: input.jobId, source_url: input.sourceUrl, source_host: input.sourceHost, website_kind: input.websiteKind, created_at: now, updated_at: now }).select("*").single(), "Create report")); }
  async getProspectReport(id: string) { const row = await maybe<ReportRow>(this.client.from("prospect_reports").select("*").eq("id", id).maybeSingle(), "Get report"); return row ? reportFromRow(row) : null; }
  async findActiveProspectReportByPlaceId(placeId: string) { const row = await maybe<ReportRow>(this.client.from("prospect_reports").select("*").eq("place_id", placeId).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle(), "Find active report"); return row ? reportFromRow(row) : null; }
  async findReusableProspectReportByPlaceId(placeId: string, since: string) { const row = await maybe<ReportRow>(this.client.from("prospect_reports").select("*").eq("place_id", placeId).eq("status", "completed").gte("completed_at", since).order("completed_at", { ascending: false }).limit(1).maybeSingle(), "Find reusable report"); return row ? reportFromRow(row) : null; }
  async updateProspectReport(input: UpdateProspectReportInput) { const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }; const map: Record<string, string> = { status: "status", jobId: "job_id", sourceUrl: "source_url", sourceHost: "source_host", websiteKind: "website_kind", result: "report_json", unlockedAt: "unlocked_at", leadId: "lead_id", errorCode: "error_code", completedAt: "completed_at" }; for (const [key, column] of Object.entries(map)) { const value = input[key as keyof UpdateProspectReportInput]; if (value !== undefined) patch[column] = value; } const row = await maybe<ReportRow>(this.client.from("prospect_reports").update(patch).eq("id", input.reportId).select("*").maybeSingle(), "Update report"); return row ? reportFromRow(row) : null; }
  async createProspectReportLead(input: CreateProspectReportLeadInput) { const now = new Date().toISOString(); const row = await data<LeadRow>(this.client.from("prospect_report_leads").insert({ id: `prospect_lead_${crypto.randomUUID().replaceAll("-", "")}`, report_id: input.reportId, email: input.email.toLowerCase(), contact_name: input.contactName, phone: input.phone, ip_hash: input.ipHash, metadata: input.metadata ?? {}, created_at: now }).select("*").single(), "Create report lead"); await this.updateProspectReport({ reportId: input.reportId, unlockedAt: now, leadId: row.id }); return leadFromRow(row); }
  async enqueueProspectReportJob(reportId: string) { const now = new Date().toISOString(); const row = await data<JobRow>(this.client.from("prospect_report_jobs").insert({ id: `prospect_job_${crypto.randomUUID().replaceAll("-", "")}`, report_id: reportId, status: "queued", attempts: 0, max_attempts: 2, run_after: now, created_at: now, updated_at: now }).select("*").single(), "Enqueue report job"); return jobFromRow(row); }
  async claimNextProspectReportJob(workerId: string) { const row = await maybe<JobRow>(this.client.rpc("claim_prospect_report_job", { worker_id: workerId }).maybeSingle(), "Claim report job"); return row ? jobFromRow(row) : null; }
  async completeProspectReportJob(jobId: string) { await data(this.client.from("prospect_report_jobs").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId).select("id").single(), "Complete report job"); }
  async failProspectReportJob(jobId: string, error: string) { const row = await data<JobRow>(this.client.from("prospect_report_jobs").select("*").eq("id", jobId).single(), "Read failed report job"); const retry = row.attempts < row.max_attempts; await data(this.client.from("prospect_report_jobs").update({ status: retry ? "queued" : "failed", error, run_after: retry ? new Date(Date.now() + 30_000).toISOString() : row.run_after, locked_by: null, locked_at: null, updated_at: new Date().toISOString(), completed_at: retry ? null : new Date().toISOString() }).eq("id", jobId).select("id").single(), "Fail report job"); }

  private async applyEvent(id: string, event: OutboundEvent) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("id", id).maybeSingle(), "Read event prospect"); if (!row) return; const value = prospectFromRow(row); applyOutboundEventToProspect(value, event); await data(this.client.from("outbound_prospects").update({ site_id: value.siteId, status: value.status, mailed_at: value.mailedAt, first_preview_viewed_at: value.firstPreviewViewedAt, adoption_started_at: value.adoptionStartedAt, adopted_at: value.adoptedAt, published_at: value.publishedAt, disqualified_at: value.disqualifiedAt }).eq("id", id).select("id").single(), "Update event prospect"); }
}

export const platformOperationsRepository: PlatformOperationsRepository = process.env.LODESTA_REPOSITORY === "local"
  ? new LocalPlatformOperationsRepository()
  : new SupabasePlatformOperationsRepository();

function websiteSetupFromRow(row: WebsiteSetupRow): WebsiteSetup { return { id: row.id, ownerUserId: row.owner_user_id, sourceUrl: row.source_url, normalizedSource: row.normalized_source, sourceRevision: row.source_revision, status: row.status, siteId: row.site_id ?? undefined, sessionId: row.session_id ?? undefined, runId: row.run_id ?? undefined, attempts: row.attempts, maxAttempts: row.max_attempts, idempotencyKey: row.idempotency_key, creationRequestHash: row.creation_request_hash, lockedBy: row.locked_by ?? undefined, lockedAt: row.locked_at ?? undefined, failureCode: row.failure_code ?? undefined, failureReason: row.failure_reason ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }
function adoptionInvitationFromRow(row: AdoptionInvitationRow): AdoptionInvitation { return { id: row.id, siteId: row.site_id, tokenHash: row.token_hash, expiresAt: row.expires_at, createdAt: row.created_at, consumedAt: row.consumed_at ?? undefined, consumedByUserId: row.consumed_by_user_id ?? undefined }; }
function previewFromRow(row: PreviewTokenRow): SitePreviewToken { if (!row.site_version_id) throw new Error("Preview token does not reference a site version."); return { token: row.token, siteId: row.site_id, siteVersionId: row.site_version_id, expiresAt: row.expires_at ?? undefined, createdAt: row.created_at }; }
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
function prospectFromRow(row: ProspectRow): OutboundProspect { return { id: row.id, campaignId: row.campaign_id, siteId: row.site_id ?? undefined, businessName: row.business_name, vertical: row.vertical ?? undefined, sourceUrl: row.source_url ?? undefined, previewToken: row.preview_token ?? undefined, mailingCode: row.mailing_code ?? undefined, status: row.status, metadata: row.metadata as OutboundProspect["metadata"], createdAt: row.created_at, mailedAt: row.mailed_at ?? undefined, firstPreviewViewedAt: row.first_preview_viewed_at ?? undefined, adoptionStartedAt: row.adoption_started_at ?? undefined, adoptedAt: row.adopted_at ?? undefined, publishedAt: row.published_at ?? undefined, disqualifiedAt: row.disqualified_at ?? undefined }; }
function eventFromRow(row: EventRow): OutboundEvent { return { id: row.id, campaignId: row.campaign_id, prospectId: row.prospect_id ?? undefined, siteId: row.site_id ?? undefined, type: row.type, occurredAt: row.occurred_at, value: row.value ?? undefined, metadata: row.metadata as OutboundEvent["metadata"] }; }
function reportFromRow(row: ReportRow): ProspectReportRecord { return { id: row.id, placeId: row.place_id, status: row.status, jobId: row.job_id ?? undefined, sourceUrl: row.source_url ?? undefined, sourceHost: row.source_host ?? undefined, websiteKind: row.website_kind, result: row.report_json as ProspectReportRecord["result"] | undefined, unlockedAt: row.unlocked_at ?? undefined, leadId: row.lead_id ?? undefined, errorCode: row.error_code ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined }; }
function leadFromRow(row: LeadRow): ProspectReportLead { return { id: row.id, reportId: row.report_id, email: row.email, contactName: row.contact_name ?? undefined, phone: row.phone ?? undefined, ipHash: row.ip_hash ?? undefined, metadata: row.metadata as ProspectReportLead["metadata"], createdAt: row.created_at }; }
function jobFromRow(row: JobRow): ProspectReportJob { return { id: row.id, reportId: row.report_id, status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts, runAfter: row.run_after, lockedBy: row.locked_by ?? undefined, error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }
function byCreatedDesc<T extends { createdAt: string }>(a: T, b: T) { return b.createdAt.localeCompare(a.createdAt); }
function isRetriableSetupFailure(code?: WebsiteSetupFailureCode) { return code === "crawl_temporarily_unavailable" || code === "bootstrap_failed" || code === "worker_interrupted"; }
async function data<T = unknown>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); if (result.data === null) throw new Error(`${operation}: no data returned`); return result.data; }
async function maybe<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); return result.data; }
