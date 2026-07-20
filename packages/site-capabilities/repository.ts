import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AnalyticsEvent, AnalyticsSummary, Inquiry, InquiryEvent, InquiryStatus } from "./contracts";
import { summarizeAnalytics } from "@/lib/analytics";
import {
  extractInquiryContact,
  inquiryDedupeKey,
  inquiryMessageText,
  type InquiryFormDefinition
} from "@/lib/inquiries";
import { sanitizeAnalyticsMetadata } from "@/lib/privacy";
import { getSupabaseAdminClient } from "@/lib/supabase/client";

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
};

export type CreateCapabilityInquiryResult = {
  inquiry: Inquiry;
  event: InquiryEvent;
  duplicate: boolean;
};

export interface SiteCapabilityRepository {
  createInquiryFromForm(input: CreateCapabilityInquiryInput): Promise<CreateCapabilityInquiryResult>;
  listInquiries(siteId?: string): Promise<Inquiry[]>;
  listInquiryEvents(inquiryId: string): Promise<InquiryEvent[]>;
  updateInquiryStatus(input: { siteId: string; inquiryId: string; status: InquiryStatus }): Promise<Inquiry | null>;
  recordAnalyticsEvent(event: AnalyticsEvent): Promise<AnalyticsEvent>;
  listAnalyticsEvents(siteId: string): Promise<AnalyticsEvent[]>;
  analyticsSummary(siteId: string): Promise<AnalyticsSummary>;
}

type LocalCapabilityState = {
  inquiries: Inquiry[];
  inquiryEvents: InquiryEvent[];
  analyticsEvents: AnalyticsEvent[];
};

const emptyLocalState = (): LocalCapabilityState => ({ inquiries: [], inquiryEvents: [], analyticsEvents: [] });

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
      const duplicate = state.inquiryEvents.find((event) => event.dedupeKey === dedupeKey);
      const existing = duplicate ? state.inquiries.find((inquiry) => inquiry.id === duplicate.inquiryId) : undefined;
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
      result = { inquiry, event, duplicate: Boolean(existing) };
    });
    if (!result) throw new Error("Inquiry write did not complete.");
    return result;
  }

  async listInquiries(siteId?: string) {
    return (await this.read()).inquiries.filter((inquiry) => !siteId || inquiry.siteId === siteId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    const sanitized = sanitizedAnalyticsEvent(event);
    await this.write((state) => { state.analyticsEvents.push(sanitized); });
    return sanitized;
  }

  async listAnalyticsEvents(siteId: string) {
    return (await this.read()).analyticsEvents.filter((event) => event.siteId === siteId).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async analyticsSummary(siteId: string) { return summarizeAnalytics(siteId, await this.listAnalyticsEvents(siteId)); }

  private async read() {
    const raw = await readFile(this.path, "utf8").catch(() => undefined);
    return raw ? JSON.parse(raw) as LocalCapabilityState : emptyLocalState();
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
  site_id: string; session_id: string; visitor_id: string | null; page_id: string | null;
  event_type: AnalyticsEvent["eventType"]; event: unknown; occurred_at: string;
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
        p_message_text: inquiryMessageText(input.form, input.payload) ?? null, p_dedupe_key: dedupeKey
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

  async listInquiryEvents(inquiryId: string) {
    const rows = await requireData<InquiryEventRow[]>(this.client.from("inquiry_events").select("*").eq("inquiry_id", inquiryId).order("created_at", { ascending: false }), "List inquiry events");
    return rows.map(rowToInquiryEvent);
  }

  async updateInquiryStatus(input: { siteId: string; inquiryId: string; status: InquiryStatus }) {
    const row = await requireData<InquiryRow | null>(this.client.from("inquiries").update({ status: input.status }).eq("site_id", input.siteId).eq("id", input.inquiryId).select("*").maybeSingle(), "Update inquiry status");
    return row ? rowToInquiry(row) : null;
  }

  async recordAnalyticsEvent(event: AnalyticsEvent) {
    const sanitized = sanitizedAnalyticsEvent(event);
    await requireData(this.client.from("analytics_events").insert({
      id: crypto.randomUUID(), site_id: sanitized.siteId, session_id: sanitized.sessionId,
      visitor_id: sanitized.visitorId, page_id: sanitized.pageId, event_type: sanitized.eventType,
      event: sanitized, occurred_at: sanitized.timestamp
    }).select("id").single(), "Record analytics event");
    return sanitized;
  }

  async listAnalyticsEvents(siteId: string) {
    const rows = await requireData<AnalyticsRow[]>(this.client.from("analytics_events").select("*").eq("site_id", siteId).order("occurred_at", { ascending: false }), "List analytics events");
    return rows.map(rowToAnalyticsEvent);
  }

  async analyticsSummary(siteId: string) { return summarizeAnalytics(siteId, await this.listAnalyticsEvents(siteId)); }
}

export const siteCapabilityRepository: SiteCapabilityRepository = process.env.LODESTA_REPOSITORY === "local"
  ? new LocalSiteCapabilityRepository()
  : new SupabaseSiteCapabilityRepository();

function sanitizedAnalyticsEvent(event: AnalyticsEvent): AnalyticsEvent {
  return { ...event, timestamp: event.timestamp || new Date().toISOString(), metadata: sanitizeAnalyticsMetadata(event.metadata) };
}

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
  const event = row.event as AnalyticsEvent;
  return {
    ...event, siteId: row.site_id, sessionId: row.session_id,
    visitorId: row.visitor_id ?? event.visitorId, pageId: row.page_id ?? event.pageId,
    eventType: row.event_type, timestamp: event.timestamp ?? row.occurred_at
  };
}

async function requireData<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, operation: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${operation}: ${error.message}`);
  return data as T;
}
