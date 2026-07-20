import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCheckoutSession } from "@/lib/billing";
import { refreshCustomHostnameStatus, registerCustomHostname } from "@/lib/domains";
import { claimVerificationSatisfies } from "@/lib/owner-access";
import {
  applyOutboundEventToProspect,
  newOutboundCampaign,
  newOutboundEvent,
  newOutboundProspect,
  summarizeOutbound
} from "@/lib/outbound";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { sitePlatformRepository } from "@/packages/platform-data";
import type {
  ClaimRecord,
  ClaimWithCheckout,
  CompleteClaimCheckoutInput,
  CreateClaimInput,
  CreateOutboundCampaignInput,
  CreateProspectReportInput,
  CreateProspectReportLeadInput,
  DomainRecord,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  OutboundSummary,
  ProspectReportJobV1,
  ProspectReportLead,
  ProspectReportRecord,
  RecordOutboundEventInput,
  RegisterDomainInput,
  SiteRedirectRuleV1,
  SitePreviewTokenV1,
  UpsertSiteRedirectInput,
  UpdateProspectReportInput,
  UpsertOutboundProspectInput
} from "./contracts";

export interface PlatformOperationsRepository {
  createClaim(input: CreateClaimInput): Promise<ClaimWithCheckout | null>;
  completeClaimCheckout(input: CompleteClaimCheckoutInput): Promise<ClaimRecord | null>;
  listClaims(siteId?: string): Promise<ClaimRecord[]>;
  createPreviewToken(input: { siteId: string; siteVersionId: string; expiresAt?: string }): Promise<SitePreviewTokenV1>;
  resolvePreviewToken(token: string): Promise<SitePreviewTokenV1 | null>;
  listPreviewTokens(siteId?: string): Promise<SitePreviewTokenV1[]>;
  registerDomain(input: RegisterDomainInput): Promise<DomainRecord | null>;
  refreshDomain(input: { domainId: string }): Promise<DomainRecord | null>;
  listDomains(siteId?: string): Promise<DomainRecord[]>;
  getDomainById(domainId: string): Promise<DomainRecord | null>;
  getDomainByHostname(hostname: string): Promise<DomainRecord | null>;
  upsertRedirect(input: UpsertSiteRedirectInput): Promise<SiteRedirectRuleV1>;
  setRedirectStatus(input: { redirectId: string; status: SiteRedirectRuleV1["status"] }): Promise<SiteRedirectRuleV1 | null>;
  listRedirects(siteId: string): Promise<SiteRedirectRuleV1[]>;
  getRedirectById(redirectId: string): Promise<SiteRedirectRuleV1 | null>;
  resolveRedirect(siteId: string, sourcePath: string): Promise<SiteRedirectRuleV1 | null>;
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
  enqueueProspectReportJob(reportId: string): Promise<ProspectReportJobV1>;
  claimNextProspectReportJob(workerId: string): Promise<ProspectReportJobV1 | null>;
  completeProspectReportJob(jobId: string): Promise<void>;
  failProspectReportJob(jobId: string, error: string): Promise<void>;
}

type LocalState = {
  claims: ClaimRecord[];
  previewTokens: SitePreviewTokenV1[];
  domains: DomainRecord[];
  redirects: SiteRedirectRuleV1[];
  campaigns: OutboundCampaign[];
  prospects: OutboundProspect[];
  events: OutboundEvent[];
  reports: ProspectReportRecord[];
  leads: ProspectReportLead[];
  jobs: ProspectReportJobV1[];
};

const emptyState = (): LocalState => ({ claims: [], previewTokens: [], domains: [], redirects: [], campaigns: [], prospects: [], events: [], reports: [], leads: [], jobs: [] });

export class LocalPlatformOperationsRepository implements PlatformOperationsRepository {
  private queue = Promise.resolve();
  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "operations.json")) {}

  async createClaim(input: CreateClaimInput) {
    if (!claimVerificationSatisfies(input.verificationLevel)) return null;
    const site = await sitePlatformRepository.getSite(input.siteId);
    if (!site) return null;
    const state = await sitePlatformRepository.getBusinessState(site.businessId);
    if (!state) return null;
    const now = new Date().toISOString();
    const claim: ClaimRecord = {
      id: crypto.randomUUID(), siteId: site.id, ownerUserId: input.ownerUserId,
      ownerEmail: input.ownerEmail?.toLowerCase(), verificationLevel: input.verificationLevel,
      verificationMethod: input.verificationMethod, verifiedBy: input.verifiedBy,
      verifiedAt: input.verifiedAt ?? now, outboundCampaignId: input.outboundCampaignId,
      outboundProspectId: input.outboundProspectId, verifiedFacts: input.verifiedFacts ?? [],
      acceptedTermsAt: input.acceptedTerms ? now : undefined,
      acceptedManagementAt: input.acceptedManagement ? now : undefined,
      assetRightsAcceptedAt: input.acceptedAssetRights ? now : undefined,
      attestedAssetIds: input.attestedAssetIds ?? [], status: "checkout_required", createdAt: now
    };
    const checkout = await createCheckoutSession({
      claimId: claim.id, siteId: site.id, siteSlug: site.slug,
      siteName: state.identity.name, ownerEmail: input.ownerEmail
    });
    claim.stripeCheckoutSessionId = checkout.sessionId;
    await this.write((store) => { store.claims.push(claim); });
    return { ...claim, checkout };
  }

  async completeClaimCheckout(input: CompleteClaimCheckoutInput) {
    let result: ClaimRecord | null = null;
    await this.write((store) => {
      const claim = input.claimId
        ? store.claims.find((item) => item.id === input.claimId)
        : store.claims.find((item) => item.stripeCheckoutSessionId === input.checkoutSessionId);
      if (!claim || (input.siteId && claim.siteId !== input.siteId)) return;
      if (input.checkoutSessionId && claim.stripeCheckoutSessionId && claim.stripeCheckoutSessionId !== input.checkoutSessionId) return;
      claim.status = "claimed";
      claim.claimedAt = input.completedAt ?? new Date().toISOString();
      claim.stripeCustomerId = input.stripeCustomerId ?? claim.stripeCustomerId;
      claim.stripeSubscriptionId = input.stripeSubscriptionId ?? claim.stripeSubscriptionId;
      claim.stripeCheckoutSessionId = input.checkoutSessionId ?? claim.stripeCheckoutSessionId;
      result = structuredClone(claim);
    });
    return result;
  }
  async listClaims(siteId?: string) { return (await this.read()).claims.filter((item) => !siteId || item.siteId === siteId).sort(byCreatedDesc); }

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
    const provider = input.provider ?? "cloudflare_for_saas";
    const verification = provider === "railway"
      ? { type: "cname" as const, value: process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "customers.lodesta.example", configured: true, note: "Configure the custom domain in Railway." }
      : await registerCustomHostname({ hostname: input.hostname.toLowerCase() });
    const domain: DomainRecord = {
      id: crypto.randomUUID(), siteId: input.siteId, hostname: input.hostname.toLowerCase(), kind: "custom",
      status: provider === "railway" ? "active" : "pending", provider,
      providerHostnameId: verification.providerHostnameId, verification, createdAt: new Date().toISOString()
    };
    await this.write((store) => { store.domains.push(domain); });
    return domain;
  }
  async refreshDomain(input: { domainId: string }) {
    const existing = await this.getDomainById(input.domainId);
    if (!existing) return null;
    const refreshed = await refreshCustomHostnameStatus({ provider: existing.provider, hostname: existing.hostname, providerHostnameId: existing.providerHostnameId, verification: existing.verification });
    let result: DomainRecord | null = null;
    await this.write((store) => {
      const domain = store.domains.find((item) => item.id === input.domainId);
      if (!domain) return;
      domain.status = refreshed.status;
      domain.providerHostnameId = refreshed.verification?.providerHostnameId ?? domain.providerHostnameId;
      domain.verification = refreshed.verification ?? domain.verification;
      result = structuredClone(domain);
    });
    return result;
  }
  async listDomains(siteId?: string) { return (await this.read()).domains.filter((item) => !siteId || item.siteId === siteId).sort(byCreatedDesc); }
  async getDomainById(id: string) { return structuredClone((await this.read()).domains.find((item) => item.id === id) ?? null); }
  async getDomainByHostname(hostname: string) { return structuredClone((await this.read()).domains.find((item) => item.hostname === hostname.toLowerCase()) ?? null); }

  async upsertRedirect(input: UpsertSiteRedirectInput) {
    const now = new Date().toISOString();
    let result!: SiteRedirectRuleV1;
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
  async setRedirectStatus(input: { redirectId: string; status: SiteRedirectRuleV1["status"] }) {
    let result: SiteRedirectRuleV1 | null = null;
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
    const job: ProspectReportJobV1 = { id: `prospect_job_${crypto.randomUUID().replaceAll("-", "")}`, reportId, status: "queued", attempts: 0, maxAttempts: 2, runAfter: now, createdAt: now, updatedAt: now };
    await this.write((store) => { store.jobs.push(job); });
    return job;
  }
  async claimNextProspectReportJob(workerId: string) {
    let result: ProspectReportJobV1 | null = null;
    await this.write((store) => {
      const job = store.jobs.filter((item) => item.status === "queued" && item.runAfter <= new Date().toISOString()).sort(byCreatedDesc).at(-1);
      if (!job) return;
      job.status = "running"; job.attempts += 1; job.lockedBy = workerId; job.updatedAt = new Date().toISOString(); result = structuredClone(job);
    });
    return result;
  }
  async completeProspectReportJob(jobId: string) { await this.write((store) => { const job = store.jobs.find((item) => item.id === jobId); if (job) { job.status = "completed"; job.updatedAt = new Date().toISOString(); } }); }
  async failProspectReportJob(jobId: string, error: string) { await this.write((store) => { const job = store.jobs.find((item) => item.id === jobId); if (!job) return; job.error = error; job.status = job.attempts < job.maxAttempts ? "queued" : "failed"; job.runAfter = new Date(Date.now() + 30_000).toISOString(); job.updatedAt = new Date().toISOString(); }); }

  private async read() {
    const raw = await readFile(this.path, "utf8").catch(() => undefined);
    return raw ? { ...emptyState(), ...JSON.parse(raw) as Partial<LocalState> } : emptyState();
  }
  private write(operation: (state: LocalState) => void | Promise<void>) {
    const next = this.queue.then(async () => { const state = await this.read(); await operation(state); await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`); await rename(temp, this.path); });
    this.queue = next.catch(() => undefined); return next;
  }
}

type ClaimRow = { id: string; site_id: string; owner_user_id: string | null; owner_email: string | null; verification_level: ClaimRecord["verificationLevel"]; verification_method: string | null; verified_by: string | null; verified_at: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null; stripe_checkout_session_id: string | null; status: ClaimRecord["status"]; fact_verification: unknown; created_at: string; claimed_at: string | null };
type PreviewTokenRow = { token: string; site_id: string; site_version_v4_id: string | null; expires_at: string | null; created_at: string };
type DomainRow = { id: string; site_id: string; hostname: string; kind: DomainRecord["kind"]; status: DomainRecord["status"]; provider: DomainRecord["provider"]; provider_hostname_id: string | null; verification: unknown; created_at: string };
type RedirectRow = { id: string; site_id: string; source_path: string; destination_path: string; status: SiteRedirectRuleV1["status"]; created_at: string; updated_at: string };
type CampaignRow = { id: string; name: string; channel: OutboundCampaign["channel"]; status: OutboundCampaign["status"]; metadata: unknown; created_at: string; started_at: string | null; ended_at: string | null };
type ProspectRow = { id: string; campaign_id: string; site_id: string | null; business_name: string; vertical: OutboundProspect["vertical"] | null; source_url: string | null; preview_token: string | null; mailing_code: string | null; status: OutboundProspect["status"]; metadata: unknown; created_at: string; mailed_at: string | null; first_preview_viewed_at: string | null; claim_started_at: string | null; claimed_at: string | null; published_at: string | null; disqualified_at: string | null };
type EventRow = { id: string; campaign_id: string; prospect_id: string | null; site_id: string | null; type: OutboundEvent["type"]; occurred_at: string; value: number | null; metadata: unknown };
type ReportRow = { id: string; place_id: string; status: ProspectReportRecord["status"]; job_id: string | null; source_url: string | null; source_host: string | null; website_kind: ProspectReportRecord["websiteKind"]; report_json: unknown; unlocked_at: string | null; lead_id: string | null; error_code: string | null; created_at: string; updated_at: string; completed_at: string | null };
type LeadRow = { id: string; report_id: string; email: string; contact_name: string | null; phone: string | null; ip_hash: string | null; metadata: unknown; created_at: string };
type JobRow = { id: string; status: ProspectReportJobV1["status"]; payload: unknown; error: string | null; attempts: number; max_attempts: number; run_after: string; locked_by: string | null; created_at: string; updated_at: string };

class SupabasePlatformOperationsRepository implements PlatformOperationsRepository {
  private get client() { return getSupabaseAdminClient(); }

  async createClaim(input: CreateClaimInput) {
    if (!claimVerificationSatisfies(input.verificationLevel)) return null;
    const site = await sitePlatformRepository.getSite(input.siteId);
    if (!site) return null;
    const state = await sitePlatformRepository.getBusinessState(site.businessId);
    if (!state) return null;
    const now = new Date().toISOString();
    const row = await data<ClaimRow>(this.client.from("claims").insert({
      id: crypto.randomUUID(), site_id: input.siteId, owner_user_id: input.ownerUserId,
      owner_email: input.ownerEmail?.toLowerCase(), verification_level: input.verificationLevel ?? "unverified",
      verification_method: input.verificationMethod, verified_by: input.verifiedBy,
      verified_at: input.verifiedAt ?? now, status: "checkout_required",
      fact_verification: { verifiedFacts: input.verifiedFacts ?? [], acceptedTermsAt: input.acceptedTerms ? now : undefined,
        acceptedManagementAt: input.acceptedManagement ? now : undefined, assetRightsAcceptedAt: input.acceptedAssetRights ? now : undefined,
        attestedAssetIds: input.attestedAssetIds ?? [], outboundCampaignId: input.outboundCampaignId, outboundProspectId: input.outboundProspectId }
    }).select("*").single(), "Create claim");
    const checkout = await createCheckoutSession({ claimId: row.id, siteId: site.id, siteSlug: site.slug, siteName: state.identity.name, ownerEmail: input.ownerEmail });
    if (checkout.sessionId) await data(this.client.from("claims").update({ stripe_checkout_session_id: checkout.sessionId }).eq("id", row.id).select("id").single(), "Store checkout session");
    return { ...claimFromRow(row), stripeCheckoutSessionId: checkout.sessionId, checkout };
  }

  async completeClaimCheckout(input: CompleteClaimCheckoutInput) {
    if (!input.claimId && !input.checkoutSessionId) return null;
    let query = this.client.from("claims").select("*");
    query = input.claimId ? query.eq("id", input.claimId) : query.eq("stripe_checkout_session_id", input.checkoutSessionId);
    const existing = await maybe<ClaimRow>(query.maybeSingle(), "Find claim");
    if (!existing || (input.siteId && existing.site_id !== input.siteId)) return null;
    if (input.checkoutSessionId && existing.stripe_checkout_session_id && existing.stripe_checkout_session_id !== input.checkoutSessionId) return null;
    const row = await data<ClaimRow>(this.client.from("claims").update({ status: "claimed", claimed_at: input.completedAt ?? new Date().toISOString(), stripe_customer_id: input.stripeCustomerId ?? existing.stripe_customer_id, stripe_subscription_id: input.stripeSubscriptionId ?? existing.stripe_subscription_id, stripe_checkout_session_id: input.checkoutSessionId ?? existing.stripe_checkout_session_id }).eq("id", existing.id).select("*").single(), "Complete claim");
    return claimFromRow(row);
  }
  async listClaims(siteId?: string) { let query = this.client.from("claims").select("*").order("created_at", { ascending: false }); if (siteId) query = query.eq("site_id", siteId); return (await data<ClaimRow[]>(query, "List claims")).map(claimFromRow); }

  async createPreviewToken(input: { siteId: string; siteVersionId: string; expiresAt?: string }) {
    const version = await sitePlatformRepository.getSiteVersion(input.siteVersionId);
    if (!version || version.siteId !== input.siteId) throw new Error("Preview version does not belong to the site.");
    const row = await data<PreviewTokenRow>(this.client.from("preview_tokens").insert({ token: crypto.randomUUID().replaceAll("-", ""), site_id: input.siteId, site_version_v4_id: input.siteVersionId, expires_at: input.expiresAt }).select("*").single(), "Create preview token");
    return previewFromRow(row);
  }
  async resolvePreviewToken(token: string) { const row = await maybe<PreviewTokenRow>(this.client.from("preview_tokens").select("*").eq("token", token).maybeSingle(), "Resolve preview token"); if (!row || !row.site_version_v4_id || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null; return previewFromRow(row); }
  async listPreviewTokens(siteId?: string) { let query = this.client.from("preview_tokens").select("*").not("site_version_v4_id", "is", null).order("created_at", { ascending: false }); if (siteId) query = query.eq("site_id", siteId); return (await data<PreviewTokenRow[]>(query, "List preview tokens")).map(previewFromRow); }

  async registerDomain(input: RegisterDomainInput) {
    if (!await sitePlatformRepository.getSite(input.siteId)) return null;
    const provider = input.provider ?? "cloudflare_for_saas";
    const verification = provider === "railway" ? { type: "cname" as const, value: process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "customers.lodesta.example", configured: true, note: "Configure the custom domain in Railway." } : await registerCustomHostname({ hostname: input.hostname.toLowerCase() });
    const row = await data<DomainRow>(this.client.from("domains").insert({ id: crypto.randomUUID(), site_id: input.siteId, hostname: input.hostname.toLowerCase(), kind: "custom", status: provider === "railway" ? "active" : "pending", provider, provider_hostname_id: verification.providerHostnameId, verification }).select("*").single(), "Register domain");
    return domainFromRow(row);
  }
  async refreshDomain(input: { domainId: string }) { const existing = await this.getDomainById(input.domainId); if (!existing) return null; const refreshed = await refreshCustomHostnameStatus({ provider: existing.provider, hostname: existing.hostname, providerHostnameId: existing.providerHostnameId, verification: existing.verification }); const row = await data<DomainRow>(this.client.from("domains").update({ status: refreshed.status, provider_hostname_id: refreshed.verification?.providerHostnameId ?? existing.providerHostnameId, verification: refreshed.verification ?? existing.verification }).eq("id", input.domainId).select("*").single(), "Refresh domain"); return domainFromRow(row); }
  async listDomains(siteId?: string) { let query = this.client.from("domains").select("*").order("created_at", { ascending: false }); if (siteId) query = query.eq("site_id", siteId); return (await data<DomainRow[]>(query, "List domains")).map(domainFromRow); }
  async getDomainById(id: string) { const row = await maybe<DomainRow>(this.client.from("domains").select("*").eq("id", id).maybeSingle(), "Get domain"); return row ? domainFromRow(row) : null; }
  async getDomainByHostname(hostname: string) { const row = await maybe<DomainRow>(this.client.from("domains").select("*").eq("hostname", hostname.toLowerCase()).maybeSingle(), "Resolve domain"); return row ? domainFromRow(row) : null; }

  async upsertRedirect(input: UpsertSiteRedirectInput) {
    const now = new Date().toISOString();
    const row = await data<RedirectRow>(this.client.from("site_redirects_v1").upsert({
      site_id: input.siteId,
      source_path: input.sourcePath,
      destination_path: input.destinationPath,
      status: "active",
      updated_at: now
    }, { onConflict: "site_id,source_path", ignoreDuplicates: false }).select("*").single(), "Upsert site redirect");
    return redirectFromRow(row);
  }
  async setRedirectStatus(input: { redirectId: string; status: SiteRedirectRuleV1["status"] }) {
    const row = await maybe<RedirectRow>(this.client.from("site_redirects_v1").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", input.redirectId).select("*").maybeSingle(), "Update site redirect");
    return row ? redirectFromRow(row) : null;
  }
  async listRedirects(siteId: string) { return (await data<RedirectRow[]>(this.client.from("site_redirects_v1").select("*").eq("site_id", siteId).order("created_at", { ascending: false }), "List site redirects")).map(redirectFromRow); }
  async getRedirectById(id: string) { const row = await maybe<RedirectRow>(this.client.from("site_redirects_v1").select("*").eq("id", id).maybeSingle(), "Get site redirect"); return row ? redirectFromRow(row) : null; }
  async resolveRedirect(siteId: string, sourcePath: string) { const row = await maybe<RedirectRow>(this.client.from("site_redirects_v1").select("*").eq("site_id", siteId).eq("source_path", sourcePath).eq("status", "active").maybeSingle(), "Resolve site redirect"); return row ? redirectFromRow(row) : null; }

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
  async enqueueProspectReportJob(reportId: string) { const now = new Date().toISOString(); const row = await data<JobRow>(this.client.from("jobs").insert({ id: `prospect_job_${crypto.randomUUID().replaceAll("-", "")}`, kind: "prospect_presence_report", status: "queued", payload: { reportId }, attempts: 0, max_attempts: 2, run_after: now, created_at: now, updated_at: now }).select("*").single(), "Enqueue report job"); return jobFromRow(row); }
  async claimNextProspectReportJob(workerId: string) { const row = await maybe<JobRow>(this.client.rpc("claim_prospect_report_job_v1", { worker_id: workerId }).maybeSingle(), "Claim report job"); return row ? jobFromRow(row) : null; }
  async completeProspectReportJob(jobId: string) { await data(this.client.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId).select("id").single(), "Complete report job"); }
  async failProspectReportJob(jobId: string, error: string) { const row = await data<JobRow>(this.client.from("jobs").select("*").eq("id", jobId).single(), "Read failed report job"); const retry = row.attempts < row.max_attempts; await data(this.client.from("jobs").update({ status: retry ? "queued" : "failed", error, run_after: retry ? new Date(Date.now() + 30_000).toISOString() : row.run_after, locked_by: null, locked_at: null, updated_at: new Date().toISOString(), completed_at: retry ? null : new Date().toISOString() }).eq("id", jobId).select("id").single(), "Fail report job"); }

  private async applyEvent(id: string, event: OutboundEvent) { const row = await maybe<ProspectRow>(this.client.from("outbound_prospects").select("*").eq("id", id).maybeSingle(), "Read event prospect"); if (!row) return; const value = prospectFromRow(row); applyOutboundEventToProspect(value, event); await data(this.client.from("outbound_prospects").update({ site_id: value.siteId, status: value.status, mailed_at: value.mailedAt, first_preview_viewed_at: value.firstPreviewViewedAt, claim_started_at: value.claimStartedAt, claimed_at: value.claimedAt, published_at: value.publishedAt, disqualified_at: value.disqualifiedAt }).eq("id", id).select("id").single(), "Update event prospect"); }
}

export const platformOperationsRepository: PlatformOperationsRepository = process.env.LODESTA_REPOSITORY === "local"
  ? new LocalPlatformOperationsRepository()
  : new SupabasePlatformOperationsRepository();

function claimFromRow(row: ClaimRow): ClaimRecord { const facts = (row.fact_verification ?? {}) as Record<string, unknown>; return { id: row.id, siteId: row.site_id, ownerUserId: row.owner_user_id ?? undefined, ownerEmail: row.owner_email ?? undefined, verificationLevel: row.verification_level ?? "unverified", verificationMethod: row.verification_method ?? undefined, verifiedBy: row.verified_by ?? undefined, verifiedAt: row.verified_at ?? undefined, outboundCampaignId: stringValue(facts.outboundCampaignId), outboundProspectId: stringValue(facts.outboundProspectId), verifiedFacts: stringArray(facts.verifiedFacts), acceptedTermsAt: stringValue(facts.acceptedTermsAt), acceptedManagementAt: stringValue(facts.acceptedManagementAt), assetRightsAcceptedAt: stringValue(facts.assetRightsAcceptedAt), attestedAssetIds: stringArray(facts.attestedAssetIds), status: row.status, createdAt: row.created_at, claimedAt: row.claimed_at ?? undefined, stripeCustomerId: row.stripe_customer_id ?? undefined, stripeSubscriptionId: row.stripe_subscription_id ?? undefined, stripeCheckoutSessionId: row.stripe_checkout_session_id ?? undefined }; }
function previewFromRow(row: PreviewTokenRow): SitePreviewTokenV1 { if (!row.site_version_v4_id) throw new Error("Preview token does not reference a V4 version."); return { token: row.token, siteId: row.site_id, siteVersionId: row.site_version_v4_id, expiresAt: row.expires_at ?? undefined, createdAt: row.created_at }; }
function domainFromRow(row: DomainRow): DomainRecord { return { id: row.id, siteId: row.site_id, hostname: row.hostname, kind: row.kind, status: row.status, provider: row.provider, providerHostnameId: row.provider_hostname_id ?? undefined, verification: row.verification as DomainRecord["verification"], createdAt: row.created_at }; }
function redirectFromRow(row: RedirectRow): SiteRedirectRuleV1 { return { id: row.id, siteId: row.site_id, sourcePath: row.source_path, destinationPath: row.destination_path, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
function campaignFromRow(row: CampaignRow): OutboundCampaign { return { id: row.id, name: row.name, channel: row.channel, status: row.status, metadata: row.metadata as OutboundCampaign["metadata"], createdAt: row.created_at, startedAt: row.started_at ?? undefined, endedAt: row.ended_at ?? undefined }; }
function prospectFromRow(row: ProspectRow): OutboundProspect { return { id: row.id, campaignId: row.campaign_id, siteId: row.site_id ?? undefined, businessName: row.business_name, vertical: row.vertical ?? undefined, sourceUrl: row.source_url ?? undefined, previewToken: row.preview_token ?? undefined, mailingCode: row.mailing_code ?? undefined, status: row.status, metadata: row.metadata as OutboundProspect["metadata"], createdAt: row.created_at, mailedAt: row.mailed_at ?? undefined, firstPreviewViewedAt: row.first_preview_viewed_at ?? undefined, claimStartedAt: row.claim_started_at ?? undefined, claimedAt: row.claimed_at ?? undefined, publishedAt: row.published_at ?? undefined, disqualifiedAt: row.disqualified_at ?? undefined }; }
function eventFromRow(row: EventRow): OutboundEvent { return { id: row.id, campaignId: row.campaign_id, prospectId: row.prospect_id ?? undefined, siteId: row.site_id ?? undefined, type: row.type, occurredAt: row.occurred_at, value: row.value ?? undefined, metadata: row.metadata as OutboundEvent["metadata"] }; }
function reportFromRow(row: ReportRow): ProspectReportRecord { return { id: row.id, placeId: row.place_id, status: row.status, jobId: row.job_id ?? undefined, sourceUrl: row.source_url ?? undefined, sourceHost: row.source_host ?? undefined, websiteKind: row.website_kind, result: row.report_json as ProspectReportRecord["result"] | undefined, unlockedAt: row.unlocked_at ?? undefined, leadId: row.lead_id ?? undefined, errorCode: row.error_code ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined }; }
function leadFromRow(row: LeadRow): ProspectReportLead { return { id: row.id, reportId: row.report_id, email: row.email, contactName: row.contact_name ?? undefined, phone: row.phone ?? undefined, ipHash: row.ip_hash ?? undefined, metadata: row.metadata as ProspectReportLead["metadata"], createdAt: row.created_at }; }
function jobFromRow(row: JobRow): ProspectReportJobV1 { const payload = row.payload as { reportId?: string }; if (!payload.reportId) throw new Error("Prospect report job is missing reportId."); return { id: row.id, reportId: payload.reportId, status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts, runAfter: row.run_after, lockedBy: row.locked_by ?? undefined, error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }
function stringValue(value: unknown) { return typeof value === "string" ? value : undefined; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function byCreatedDesc<T extends { createdAt: string }>(a: T, b: T) { return b.createdAt.localeCompare(a.createdAt); }
async function data<T = unknown>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); if (result.data === null) throw new Error(`${operation}: no data returned`); return result.data; }
async function maybe<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); return result.data; }
