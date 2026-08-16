import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  AnalyticsCollectionHealth,
  AnalyticsCollectionReason,
  AnalyticsEvent,
  AnalyticsReport,
  AnalyticsReportQuery,
  Inquiry,
  InquiryEvent,
  InquiryStatus
} from "./contracts";
import { analyticsReportFromDatabase, buildAnalyticsReport } from "@/lib/analytics";
import {
  extractInquiryContact,
  inquiryDedupeKey,
  inquiryMessageText,
  type InquiryFormDefinition
} from "@/lib/inquiries";
import { sanitizeAnalyticsMetadata } from "@/lib/privacy";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { configuredRepositoryMode } from "@/packages/execution-environment";

export type CreateCapabilityInquiryInput = {
  siteId: string;
  form: InquiryFormDefinition;
  pageId?: string;
  visitorId?: string;
  payload: Record<string, string>;
  metadata?: Record<string, string | number | boolean>;
  sourceUrl?: string;
  userAgent?: string;
  ipHash?: string;
  analyticsEvent?: AnalyticsEvent;
};

export type CreateCapabilityInquiryResult = {
  inquiry: Inquiry;
  event: InquiryEvent;
  duplicate: boolean;
};

export interface SiteCapabilityRepository {
  createInquiryFromForm(input: CreateCapabilityInquiryInput): Promise<CreateCapabilityInquiryResult>;
  listInquiries(siteId?: string): Promise<Inquiry[]>;
  getInquiry(siteId: string, inquiryId: string): Promise<Inquiry | null>;
  listInquiryEvents(inquiryId: string): Promise<InquiryEvent[]>;
  updateInquiryStatus(input: { siteId: string; inquiryId: string; status: InquiryStatus }): Promise<Inquiry | null>;
  recordAnalyticsEvent(event: AnalyticsEvent): Promise<{ event: AnalyticsEvent; duplicate: boolean }>;
  recordAnalyticsCollection(siteId: string, reason: AnalyticsCollectionReason, at?: string): Promise<void>;
  listAnalyticsEvents(siteId: string): Promise<AnalyticsEvent[]>;
  analyticsReport(siteId: string, query: AnalyticsReportQuery): Promise<AnalyticsReport>;
}

type LocalCapabilityState = {
  inquiries: Inquiry[];
  inquiryEvents: InquiryEvent[];
  analyticsEvents: AnalyticsEvent[];
  analyticsCollection: Record<string, AnalyticsCollectionHealth>;
};

const emptyLocalState = (): LocalCapabilityState => ({ inquiries: [], inquiryEvents: [], analyticsEvents: [], analyticsCollection: {} });

class LocalSiteCapabilityRepository implements SiteCapabilityRepository {
  private queue = Promise.resolve();

  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "capabilities.json")) {}

  async createInquiryFromForm(input: CreateCapabilityInquiryInput) {
    const contact = extractInquiryContact(input.form, input.payload);
    const dedupeKey = inquiryDedupeKey({
      siteId: input.siteId,
      formId: input.form.id,
      contactEmailNormalized: contact.contactEmailNormalized,
      contactPhoneNormalized: contact.contactPhoneNormalized,
      payload: input.payload
    });
    let result: CreateCapabilityInquiryResult | undefined;
    await this.write((state) => {
      const duplicateEvent = state.inquiryEvents.find((event) => event.dedupeKey === dedupeKey);
      const existing = duplicateEvent ? state.inquiries.find((inquiry) => inquiry.id === duplicateEvent.inquiryId) : undefined;
      if (existing && duplicateEvent) {
        result = { inquiry: existing, event: duplicateEvent, duplicate: true };
        return;
      }
      const now = new Date().toISOString();
      const inquiry: Inquiry = existing ?? {
        id: crypto.randomUUID(), siteId: input.siteId, sourceChannel: "form",
        contactName: contact.contactName, contactEmail: contact.contactEmail,
        contactEmailNormalized: contact.contactEmailNormalized, contactPhone: contact.contactPhone,
        contactPhoneNormalized: contact.contactPhoneNormalized, status: "new", notificationState: "queued",
        aiEnrichmentState: "queued", createdAt: now, updatedAt: now
      };
      const event: InquiryEvent = {
        id: crypto.randomUUID(), siteId: input.siteId, inquiryId: inquiry.id, type: "form_submission", actor: "visitor",
        messageText: inquiryMessageText(input.form, input.payload), payload: input.payload, sourceUrl: input.sourceUrl,
        pageId: input.pageId, formId: input.form.id,
        metadata: { ...(input.metadata ?? {}), contactExtractionStatus: contact.status, contactExtractionNotes: contact.notes,
          visitorId: input.visitorId, ipHash: input.ipHash, userAgent: input.userAgent },
        dedupeKey, createdAt: now
      };
      if (!existing) state.inquiries.push(inquiry);
      state.inquiryEvents.push(event);
      if (input.analyticsEvent) {
        const isDuplicateAnalytics = state.analyticsEvents.some((item) => item.siteId === input.analyticsEvent?.siteId && item.eventId === input.analyticsEvent?.eventId);
        if (!isDuplicateAnalytics) {
          state.analyticsEvents.push(input.analyticsEvent);
          incrementLocalCollection(state, input.siteId, "accepted", input.analyticsEvent.occurredAt);
        }
      }
      result = { inquiry, event, duplicate: false };
    });
    if (!result) throw new Error("Inquiry write did not complete.");
    return result;
  }

  async listInquiries(siteId?: string) {
    return (await this.read()).inquiries.filter((inquiry) => !siteId || inquiry.siteId === siteId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getInquiry(siteId: string, inquiryId: string) {
    return (await this.read()).inquiries.find((inquiry) => inquiry.siteId === siteId && inquiry.id === inquiryId) ?? null;
  }

  async listInquiryEvents(inquiryId: string) {
    return (await this.read()).inquiryEvents.filter((event) => event.inquiryId === inquiryId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateInquiryStatus(input: { siteId: string; inquiryId: string; status: InquiryStatus }) {
    let updated: Inquiry | null = null;
    await this.write((state) => {
      const inquiry = state.inquiries.find((item) => item.siteId === input.siteId && item.id === input.inquiryId);
      if (!inquiry) return;
      inquiry.status = input.status;
      inquiry.updatedAt = new Date().toISOString();
      updated = structuredClone(inquiry);
    });
    return updated;
  }

  async recordAnalyticsEvent(event: AnalyticsEvent) {
    let duplicate = false;
    await this.write((state) => {
      duplicate = state.analyticsEvents.some((item) => item.siteId === event.siteId && item.eventId === event.eventId);
      if (!duplicate) state.analyticsEvents.push(event);
      incrementLocalCollection(state, event.siteId, duplicate ? "duplicate" : "accepted", event.occurredAt);
    });
    return { event, duplicate };
  }

  async recordAnalyticsCollection(siteId: string, reason: AnalyticsCollectionReason, at = new Date().toISOString()) {
    await this.write((state) => incrementLocalCollection(state, siteId, reason, at));
  }

  async listAnalyticsEvents(siteId: string) {
    return (await this.read()).analyticsEvents.filter((event) => event.siteId === siteId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  async analyticsReport(siteId: string, query: AnalyticsReportQuery) {
    const state = await this.read();
    return buildAnalyticsReport(siteId, query, state.analyticsEvents.filter((event) => event.siteId === siteId), state.analyticsCollection?.[siteId]);
  }

  private async read() {
    const raw = await readFile(this.path, "utf8").catch(() => undefined);
    if (!raw) return emptyLocalState();
    const parsed = JSON.parse(raw) as Partial<LocalCapabilityState>;
    return {
      inquiries: parsed.inquiries ?? [],
      inquiryEvents: parsed.inquiryEvents ?? [],
      analyticsEvents: (parsed.analyticsEvents ?? []).filter((event) => event.schemaVersion === 1),
      analyticsCollection: parsed.analyticsCollection ?? {}
    };
  }

  private write(operation: (state: LocalCapabilityState) => void | Promise<void>) {
    const next = this.queue.then(async () => {
      const state = await this.read();
      await operation(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, this.path);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

type InquiryRow = {
  id: string; site_id: string; source_channel: Inquiry["sourceChannel"];
  contact_name: string | null; contact_email: string | null; contact_email_normalized: string | null;
  contact_phone: string | null; contact_phone_normalized: string | null; status: Inquiry["status"];
  notification_state: Inquiry["notificationState"]; ai_enrichment_state: Inquiry["aiEnrichmentState"];
  ai_enrichment: unknown; ai_enriched_at: string | null; ai_enrichment_error: string | null;
  created_at: string; updated_at: string;
};

type InquiryEventRow = {
  id: string; site_id: string; inquiry_id: string; type: InquiryEvent["type"]; actor: InquiryEvent["actor"];
  message_text: string | null; payload: unknown; source_url: string | null; page_id: string | null;
  form_id: string | null; metadata: unknown; dedupe_key: string | null; created_at: string;
};

type AnalyticsRow = {
  id: string; schema_version: 1; site_id: string; site_version_id: string; event_id: string;
  event_type: AnalyticsEvent["eventType"]; visitor_key: string; visit_id: string; page_path: string;
  landing_path: string; channel: AnalyticsEvent["channel"]; source: string | null; medium: string | null;
  campaign: string | null; referrer_host: string | null; device_category: AnalyticsEvent["deviceCategory"];
  properties: Record<string, string | number | boolean>; occurred_at: string; created_at: string;
};

class SupabaseSiteCapabilityRepository implements SiteCapabilityRepository {
  private get client() { return getSupabaseAdminClient(); }

  async createInquiryFromForm(input: CreateCapabilityInquiryInput) {
    const contact = extractInquiryContact(input.form, input.payload);
    const dedupeKey = inquiryDedupeKey({
      siteId: input.siteId, formId: input.form.id,
      contactEmailNormalized: contact.contactEmailNormalized,
      contactPhoneNormalized: contact.contactPhoneNormalized, payload: input.payload
    });
    const result = await requireData<{ inquiry: InquiryRow; event: InquiryEventRow; duplicate: boolean }>(
      this.client.rpc("create_inquiry_from_form", {
        p_site_id: input.siteId, p_form_id: input.form.id, p_page_id: input.pageId ?? null,
        p_visitor_id: input.visitorId ?? null, p_payload: input.payload,
        p_metadata: { ...(input.metadata ?? {}), contactExtractionStatus: contact.status, contactExtractionNotes: contact.notes,
          visitorId: input.visitorId, ipHash: input.ipHash, userAgent: input.userAgent },
        p_source_url: input.sourceUrl ?? null, p_user_agent: input.userAgent ?? null, p_ip_hash: input.ipHash ?? null,
        p_contact_name: contact.contactName ?? null, p_contact_email: contact.contactEmail ?? null,
        p_contact_email_normalized: contact.contactEmailNormalized ?? null, p_contact_phone: contact.contactPhone ?? null,
        p_contact_phone_normalized: contact.contactPhoneNormalized ?? null,
        p_message_text: inquiryMessageText(input.form, input.payload) ?? null, p_dedupe_key: dedupeKey,
        p_analytics_event: input.analyticsEvent ?? null
      }),
      "Create inquiry from form"
    );
    return { inquiry: rowToInquiry(result.inquiry), event: rowToInquiryEvent(result.event), duplicate: result.duplicate };
  }

  async listInquiries(siteId?: string) {
    let query = this.client.from("inquiries").select("*").order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<InquiryRow[]>(query, "List inquiries");
    return rows.map(rowToInquiry);
  }

  async getInquiry(siteId: string, inquiryId: string) {
    const row = await requireData<InquiryRow | null>(
      this.client.from("inquiries").select("*").eq("site_id", siteId).eq("id", inquiryId).maybeSingle(),
      "Get inquiry"
    );
    return row ? rowToInquiry(row) : null;
  }

  async listInquiryEvents(inquiryId: string) {
    const rows = await requireData<InquiryEventRow[]>(this.client.from("inquiry_events").select("*").eq("inquiry_id", inquiryId).order("created_at", { ascending: false }), "List inquiry events");
    return rows.map(rowToInquiryEvent);
  }

  async updateInquiryStatus(input: { siteId: string; inquiryId: string; status: InquiryStatus }) {
    const row = await requireData<InquiryRow | null>(this.client.from("inquiries").update({ status: input.status }).eq("site_id", input.siteId).eq("id", input.inquiryId).select("*").maybeSingle(), "Update inquiry status");
    return row ? rowToInquiry(row) : null;
  }

  async recordAnalyticsEvent(event: AnalyticsEvent) {
    const { data, error } = await this.client.from("analytics_events").upsert({
      id: `analytics_${crypto.randomUUID().replaceAll("-", "")}`,
      schema_version: event.schemaVersion,
      site_id: event.siteId,
      site_version_id: event.siteVersionId,
      event_id: event.eventId,
      event_type: event.eventType,
      visitor_key: event.visitorKey,
      visit_id: event.visitId,
      page_path: event.pagePath,
      landing_path: event.landingPath,
      channel: event.channel,
      source: event.source,
      medium: event.medium,
      campaign: event.campaign,
      referrer_host: event.referrerHost,
      device_category: event.deviceCategory,
      properties: event.properties,
      occurred_at: event.occurredAt,
      created_at: event.createdAt
    }, { onConflict: "site_id,event_id", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`Record analytics event: ${error.message}`);
    const duplicate = !data?.length;
    await this.recordAnalyticsCollection(event.siteId, duplicate ? "duplicate" : "accepted", event.occurredAt);
    return { event, duplicate };
  }

  async recordAnalyticsCollection(siteId: string, reason: AnalyticsCollectionReason, at = new Date().toISOString()) {
    await requireData(this.client.rpc("record_analytics_collection", {
      p_site_id: siteId,
      p_reason: reason,
      p_at: at
    }), "Record analytics collection health");
  }

  async listAnalyticsEvents(siteId: string) {
    const rows = await requireData<AnalyticsRow[]>(this.client.from("analytics_events").select("*").eq("site_id", siteId).order("occurred_at", { ascending: false }), "List analytics events");
    return rows.map(rowToAnalyticsEvent);
  }

  async analyticsReport(siteId: string, query: AnalyticsReportQuery) {
    const value = await requireData<unknown>(this.client.rpc("analytics_report", {
      p_site_id: siteId,
      p_from: query.from,
      p_to: query.to,
      p_compare_from: query.compareFrom ?? null,
      p_compare_to: query.compareTo ?? null,
      p_interval: query.interval,
      p_timezone: query.timezone,
      p_channel: query.filters.channel ?? null,
      p_source: query.filters.source ?? null,
      p_page: query.filters.page ?? null,
      p_action: query.filters.action ?? null,
      p_device: query.filters.device ?? null
    }), "Load analytics report");
    return analyticsReportFromDatabase(siteId, query, value);
  }
}

export const siteCapabilityRepository: SiteCapabilityRepository = configuredRepositoryMode() === "local"
  ? new LocalSiteCapabilityRepository()
  : new SupabaseSiteCapabilityRepository();

function rowToInquiry(row: InquiryRow): Inquiry {
  return {
    id: row.id, siteId: row.site_id, sourceChannel: row.source_channel,
    contactName: row.contact_name ?? undefined, contactEmail: row.contact_email ?? undefined,
    contactEmailNormalized: row.contact_email_normalized ?? undefined, contactPhone: row.contact_phone ?? undefined,
    contactPhoneNormalized: row.contact_phone_normalized ?? undefined, status: row.status,
    notificationState: row.notification_state, aiEnrichmentState: row.ai_enrichment_state,
    aiEnrichment: row.ai_enrichment as Inquiry["aiEnrichment"] | undefined,
    aiEnrichedAt: row.ai_enriched_at ?? undefined, aiEnrichmentError: row.ai_enrichment_error ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function rowToInquiryEvent(row: InquiryEventRow): InquiryEvent {
  return {
    id: row.id, siteId: row.site_id, inquiryId: row.inquiry_id, type: row.type, actor: row.actor,
    messageText: row.message_text ?? undefined, payload: row.payload as Record<string, unknown> | undefined,
    sourceUrl: row.source_url ?? undefined, pageId: row.page_id ?? undefined, formId: row.form_id ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined, dedupeKey: row.dedupe_key ?? undefined,
    createdAt: row.created_at
  };
}

function rowToAnalyticsEvent(row: AnalyticsRow): AnalyticsEvent {
  return {
    schemaVersion: row.schema_version, eventId: row.event_id, siteId: row.site_id,
    siteVersionId: row.site_version_id, eventType: row.event_type, visitorKey: row.visitor_key,
    visitId: row.visit_id, pagePath: row.page_path, landingPath: row.landing_path,
    channel: row.channel, source: row.source ?? undefined, medium: row.medium ?? undefined,
    campaign: row.campaign ?? undefined, referrerHost: row.referrer_host ?? undefined,
    deviceCategory: row.device_category, properties: row.properties ?? {},
    occurredAt: row.occurred_at, createdAt: row.created_at
  };
}

function incrementLocalCollection(
  state: LocalCapabilityState,
  siteId: string,
  reason: AnalyticsCollectionReason,
  at: string
) {
  state.analyticsCollection ??= {};
  const health = state.analyticsCollection[siteId] ?? {
    accepted: 0, internal: 0, bot: 0, preview: 0, duplicate: 0, invalid: 0
  };
  health[reason] += 1;
  if (reason === "accepted" && (!health.lastAcceptedAt || health.lastAcceptedAt < at)) health.lastAcceptedAt = at;
  state.analyticsCollection[siteId] = health;
}

async function requireData<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, operation: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${operation}: ${error.message}`);
  return data as T;
}
