import { z } from "zod";
import type { Inquiry, InquiryAiEnrichment, InquiryEvent, SiteBundle } from "./models";

export const INQUIRY_AI_SCHEMA_VERSION = "inquiry_ai_v1";
export const INQUIRY_AI_PROMPT_VERSION = "inquiry_triage_v1";

export type InquiryAiRepository = {
  getSiteBundle(siteId: string): Promise<SiteBundle | null>;
  getInquiry(siteId: string, inquiryId: string): Promise<Inquiry | null>;
  listInquiryEvents(inquiryId: string): Promise<InquiryEvent[]>;
  updateInquiryAiEnrichment(input: {
    siteId: string;
    inquiryId: string;
    state: Inquiry["aiEnrichmentState"];
    enrichment?: InquiryAiEnrichment;
    error?: string;
  }): Promise<Inquiry | null>;
  countRecentInquiries(siteId: string, since: string): Promise<number>;
};

const aiResponseSchema = z.object({
  intent: z.enum([
    "quote_request",
    "booking_request",
    "service_question",
    "general_question",
    "complaint",
    "sales_or_vendor",
    "spam",
    "unknown"
  ]),
  urgency: z.enum(["urgent", "normal", "low", "unknown"]),
  spamLikelihood: z.enum(["low", "medium", "high", "unknown"]),
  serviceInterest: z.string().nullable(),
  contactPreference: z.enum(["email", "phone", "unknown"]).nullable(),
  summary: z.string(),
  missingInfo: z.array(z.string()),
  suggestedNextAction: z.string(),
  recommendedStatus: z.enum(["needs_reply", "spam", "archived"]),
  confidence: z.number().min(0).max(1),
  safetyFlags: z.array(z.string())
});

export async function runInquiryAiEnrichmentJob(repository: InquiryAiRepository, input: { siteId: string; inquiryId: string }) {
  const inquiry = await repository.getInquiry(input.siteId, input.inquiryId);
  if (!inquiry) return { skipped: true, reason: "Inquiry not found." };
  if (inquiry.aiEnrichmentState === "succeeded" && inquiry.aiEnrichment) {
    return { skipped: true, reason: "Inquiry already has AI enrichment." };
  }

  const bundle = await repository.getSiteBundle(input.siteId);
  if (!bundle) return { skipped: true, reason: "Site not found." };

  const config = inquiryAiConfig();
  if (!config.ok) {
    await repository.updateInquiryAiEnrichment({
      siteId: input.siteId,
      inquiryId: input.inquiryId,
      state: "skipped",
      error: config.reason
    });
    return { skipped: true, reason: config.reason };
  }

  const recentCount = await repository.countRecentInquiries(input.siteId, new Date(Date.now() - 60 * 60_000).toISOString());
  if (recentCount > config.rateLimitPerSitePerHour) {
    const reason = `Inquiry AI enrichment skipped because this site exceeded ${config.rateLimitPerSitePerHour} inquiries in the last hour.`;
    await repository.updateInquiryAiEnrichment({
      siteId: input.siteId,
      inquiryId: input.inquiryId,
      state: "rate_limited",
      error: reason
    });
    return { skipped: true, reason };
  }

  await repository.updateInquiryAiEnrichment({
    siteId: input.siteId,
    inquiryId: input.inquiryId,
    state: "processing"
  });

  const events = (await repository.listInquiryEvents(input.inquiryId)).filter((event) => !isDuplicateEvent(event));
  const body = groqRequestBody({
    model: config.model,
    bundle,
    inquiry,
    events
  });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const message = groqErrorMessage(payload) ?? `Groq inquiry AI failed with status ${response.status}`;
      await repository.updateInquiryAiEnrichment({
        siteId: input.siteId,
        inquiryId: input.inquiryId,
        state: response.status === 429 ? "rate_limited" : "retrying",
        error: message
      });
      throw new Error(message);
    }
    const parsed = aiResponseSchema.parse(JSON.parse(extractGroqContent(payload)));
    const now = new Date().toISOString();
    const enrichment: InquiryAiEnrichment = {
      schemaVersion: INQUIRY_AI_SCHEMA_VERSION,
      promptVersion: INQUIRY_AI_PROMPT_VERSION,
      provider: "groq",
      model: config.model,
      ...parsed,
      createdAt: now
    };
    await repository.updateInquiryAiEnrichment({
      siteId: input.siteId,
      inquiryId: input.inquiryId,
      state: "succeeded",
      enrichment
    });
    return {
      ok: true,
      provider: "groq",
      model: config.model,
      recommendedStatus: enrichment.recommendedStatus,
      confidence: enrichment.confidence
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repository.updateInquiryAiEnrichment({
      siteId: input.siteId,
      inquiryId: input.inquiryId,
      state: message.toLowerCase().includes("rate") ? "rate_limited" : "retrying",
      error: message
    });
    throw error;
  }
}

function inquiryAiConfig():
  | { ok: true; apiKey: string; model: string; timeoutMs: number; rateLimitPerSitePerHour: number }
  | { ok: false; reason: string } {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, reason: "GROQ_API_KEY is not set; inquiry AI enrichment skipped." };
  if (process.env.NODE_ENV === "production" && process.env.LODESTA_GROQ_ZDR_CONFIRMED !== "true") {
    return { ok: false, reason: "Groq data controls/ZDR must be confirmed before enabling inquiry AI enrichment outside dev." };
  }
  return {
    ok: true,
    apiKey,
    model: process.env.LODESTA_INQUIRY_AI_MODEL || "openai/gpt-oss-120b",
    timeoutMs: clampEnvNumber("LODESTA_INQUIRY_AI_TIMEOUT_MS", 8000, 1000, 60000),
    rateLimitPerSitePerHour: clampEnvNumber("LODESTA_INQUIRY_AI_RATE_LIMIT_PER_SITE_PER_HOUR", 20, 1, 1000)
  };
}

function groqRequestBody(input: { model: string; bundle: SiteBundle; inquiry: Inquiry; events: InquiryEvent[] }) {
  return {
    model: input.model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You classify inbound inquiries for a US local business on Lodesta.",
          "Return only schema-valid JSON.",
          "Do not promise pricing, availability, legal or medical advice, or business commitments.",
          "recommendedStatus is advisory only and must be one of needs_reply, spam, or archived."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify(inquiryPromptContext(input.bundle, input.inquiry, input.events))
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lodesta_inquiry_triage",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "intent",
            "urgency",
            "spamLikelihood",
            "serviceInterest",
            "contactPreference",
            "summary",
            "missingInfo",
            "suggestedNextAction",
            "recommendedStatus",
            "confidence",
            "safetyFlags"
          ],
          properties: {
            intent: {
              type: "string",
              enum: ["quote_request", "booking_request", "service_question", "general_question", "complaint", "sales_or_vendor", "spam", "unknown"]
            },
            urgency: { type: "string", enum: ["urgent", "normal", "low", "unknown"] },
            spamLikelihood: { type: "string", enum: ["low", "medium", "high", "unknown"] },
            serviceInterest: { type: ["string", "null"] },
            contactPreference: { type: ["string", "null"], enum: ["email", "phone", "unknown", null] },
            summary: { type: "string" },
            missingInfo: { type: "array", items: { type: "string" } },
            suggestedNextAction: { type: "string" },
            recommendedStatus: { type: "string", enum: ["needs_reply", "spam", "archived"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            safetyFlags: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  };
}

function inquiryPromptContext(bundle: SiteBundle, inquiry: Inquiry, events: InquiryEvent[]) {
  const business = bundle.businessProfile;
  return {
    business: {
      name: business.name,
      vertical: business.vertical,
      categories: business.categories,
      description: business.description,
      services: business.services,
      serviceAreas: business.serviceAreas,
      hasPhone: Boolean(business.phone),
      hasEmail: Boolean(business.email),
      hasBookingLinks: business.bookingLinks.length > 0
    },
    inquiry: {
      id: inquiry.id,
      sourceChannel: inquiry.sourceChannel,
      contactName: inquiry.contactName,
      contactEmail: inquiry.contactEmail,
      contactPhone: inquiry.contactPhone,
      status: inquiry.status
    },
    events: events.map((event) => ({
      type: event.type,
      actor: event.actor,
      messageText: event.messageText,
      formId: event.formId,
      pageId: event.pageId,
      payload: event.payload,
      metadata: publicEventMetadata(event.metadata),
      createdAt: event.createdAt
    }))
  };
}

function publicEventMetadata(metadata: InquiryEvent["metadata"]) {
  if (!metadata) return undefined;
  const { ipHash: _ipHash, visitorId: _visitorId, userAgent: _userAgent, ...rest } = metadata;
  return rest;
}

function isDuplicateEvent(event: InquiryEvent) {
  return event.metadata?.dedupe === true;
}

function extractGroqContent(payload: unknown) {
  if (!payload || typeof payload !== "object") throw new Error("Groq response was not an object.");
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) throw new Error("Groq response did not include choices.");
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  if (typeof first?.message?.content !== "string") throw new Error("Groq response did not include message content.");
  return first.message.content;
}

function groqErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : undefined;
}

function clampEnvNumber(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[key]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
