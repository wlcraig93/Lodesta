import { z } from "zod";
import type { BusinessUnderstandingV2, CleanedServiceV2, Vertical } from "./models";
import type { CrawlAssessment } from "./crawler";
import type { PublicPresenceEnrichment } from "./public-presence";
import { getOpenAiRuntimeSettings } from "./operator-settings";
import { extractOpenAiUsage, sanitizeTelemetryPayload, type AgentTelemetryRecorder } from "./agent-telemetry";
import {
  elapsedOpenAiCallMs,
  extractOpenAiResponseText,
  openAiErrorMessage,
  openAiResponseIncompleteReason
} from "./openai-generation";
import { openAiRequestSignal } from "./openai-timeout";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";
import type { EvidenceKind, EvidenceProposal } from "./evidence-ledger";

export const understandingVerticalValues = [
  "restaurant",
  "auto_body",
  "auto_services",
  "beauty_salon",
  "med_spa",
  "law_firm",
  "dental",
  "home_services",
  "fitness",
  "real_estate",
  "landscaping",
  "veterinary",
  "creative_studio",
  "general_local"
] as const satisfies readonly Vertical[];

const conversionGoalValues = ["call_first", "form_first", "booking_first", "visit_first"] as const;
const factFieldValues = ["name", "phone", "address", "hours", "services", "service_areas", "reviews"] as const;
const brandExpressionMoodValues = ["clinical", "warm", "premium", "technical", "neighborhood", "bold", "quiet"] as const;
const brandExpressionFontPostureValues = ["utility", "editorial", "condensed", "rounded", "premium"] as const;
const brandExpressionVoiceRegisterValues = ["direct", "warm", "premium", "technical", "plainspoken"] as const;
const brandExpressionPaletteSeedStrategyValues = ["logo_color", "photo_color", "category_default", "neutral"] as const;
const evidenceKindValues = [
  "testimonial",
  "credential",
  "warranty",
  "insurance_support",
  "award",
  "years_in_business",
  "offer"
] as const satisfies readonly EvidenceKind[];

/** Minimum LLM vertical confidence treated as trustworthy over the keyword fallback. */
export const understandingVerticalConfidenceFloor = 0.55;

const understandingSchema = z.object({
  vertical: z.enum(understandingVerticalValues),
  verticalConfidence: z.number().min(0).max(1),
  detectedSubverticals: z.array(z.string().min(1).max(60)).max(6),
  cleanedServices: z
    .array(
      z.object({
        name: z.string().min(2).max(70),
        price: z.string().min(1).max(60).nullable(),
        sourceText: z.string().min(1).max(200),
        confidence: z.number().min(0).max(1)
      })
    )
    .max(8),
  hours: z
    .array(
      z.object({
        label: z.string().min(2).max(40),
        value: z.string().min(2).max(60)
      })
    )
    .max(7),
  primaryConversionGoal: z.enum(conversionGoalValues),
  urgentServiceSignals: z.array(z.string().min(1).max(80)).max(6),
  businessStory: z
    .object({
      summary: z.string().min(30).max(400),
      distinctives: z.array(z.string().min(3).max(120)).max(5)
    })
    .nullable(),
  brandExpression: z.object({
    mood: z.enum(brandExpressionMoodValues),
    fontPosture: z.enum(brandExpressionFontPostureValues),
    voiceRegister: z.enum(brandExpressionVoiceRegisterValues),
    paletteSeed: z.object({
      strategy: z.enum(brandExpressionPaletteSeedStrategyValues),
      preferredHex: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
      candidateRank: z.number().int().min(0).max(7).nullable()
    }),
    rationale: z.string().min(10).max(240)
  }),
  evidenceProposals: z.array(z.object({
    kind: z.enum(evidenceKindValues),
    proposedText: z.string().min(1).max(320),
    sourceUrl: z.string().url(),
    sourceBlockId: z.string().min(1).max(160),
    attribution: z.string().min(1).max(120).nullable()
  })).max(24),
  factConfidence: z
    .array(
      z.object({
        field: z.enum(factFieldValues),
        confidence: z.number().min(0).max(1),
        sourceBacked: z.boolean()
      })
    )
    .max(7),
  notes: z.array(z.string().min(1).max(200)).max(6)
});

export type BusinessUnderstandingInput = {
  sourceUrl?: string;
  prompt?: string;
  crawl?: CrawlAssessment;
  publicPresence?: PublicPresenceEnrichment;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
};

export async function createOpenAiBusinessUnderstanding(
  input: BusinessUnderstandingInput
): Promise<BusinessUnderstandingV2 | undefined> {
  return createOpenAiBusinessUnderstandingAttempt(input, 0);
}

async function createOpenAiBusinessUnderstandingAttempt(
  input: BusinessUnderstandingInput,
  attempt: 0 | 1
): Promise<BusinessUnderstandingV2 | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  if (!input.crawl && !input.publicPresence && !input.prompt) return undefined;
  const runtimeSettings = await getOpenAiRuntimeSettings();
  const context = understandingContext(input);

  const body = {
    model: runtimeSettings.settings.generationModel,
    reasoning: { effort: "low" },
    max_output_tokens: attempt === 0 ? 5200 : 6400,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You classify and normalize source facts about a US local small business for Lodesta site generation.",
              "Return only schema-valid JSON through Structured Outputs.",
              "Choose the most specific vertical. auto_services covers tire shops, mechanics, oil change, brakes, and general car repair; auto_body covers collision, paint, and body work.",
              "cleanedServices must be human-readable customer-facing service names derived from source text. Move price language into the price field. Drop navigation fragments, mangled scrapes, and duplicates. Never invent services that are not in the source.",
              "hours must be a structured weekly schedule. Discard live status strings (for example 'currently closed', 'open again on ...'), specific dates, and anything that is not a recurring weekly schedule.",
              "factConfidence reflects how strongly each field is supported by the provided source material.",
              "businessStory: capture what makes this business THIS business when the source reveals it — founders, family ownership, history, mascots or personalities, neighborhood roots, anything a customer would remember. Quote-level fidelity to the source; null when the source has no story.",
              "brandExpression: make bounded taste calls only. Choose mood, voice register, and font posture from the allowed values. Choose a palette seed strategy from source evidence; use preferredHex only when an explicit extracted candidate is provided, otherwise null. This is not layout design.",
              "evidenceProposals: identify only testimonials, credentials, warranties, insurance support, awards, years-in-business statements, and offers that are explicitly present in a supplied sourceTextBlock. proposedText must copy one exact contiguous span from displayText without paraphrasing. sourceUrl and sourceBlockId must exactly match that block. A testimonial must be one block, 40 to 240 characters, and at least 7 words. attribution is null unless the exact name or attribution is in the same or immediately adjacent supplied block. Omit doubtful evidence rather than repairing or summarizing it.",
              "Do not invent facts, prices, credentials, reviews, or offers."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(context)
          }
        ]
      }
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "lodesta_business_understanding_v2",
        strict: true,
        schema: understandingResponseJsonSchema
      }
    }
  };

  const startedAt = new Date().toISOString();
  let recorded = false;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: openAiRequestSignal(undefined, input.signal)
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    const endedAt = new Date().toISOString();
    const incompleteReason = response.ok ? openAiResponseIncompleteReason(payload) : undefined;
    await input.telemetry?.recordModelCall({
      spanId: input.spanId,
      provider: "openai",
      model: body.model,
      endpoint: "/v1/responses",
      operation: "business_understanding",
      status: response.ok && !incompleteReason ? "completed" : "failed",
      requestJson: sanitizeTelemetryPayload(body),
      responseJson: sanitizeTelemetryPayload(payload),
      ...extractOpenAiUsage(payload),
      errorMessage: response.ok
        ? incompleteReason
          ? `Incomplete response (${incompleteReason})`
          : undefined
        : openAiErrorMessage(payload) ?? `HTTP ${response.status}`,
      startedAt,
      endedAt,
      durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
    });
    recorded = true;
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload) ?? `OpenAI business understanding failed with status ${response.status}`);
    }
    if (incompleteReason) {
      throw new Error(`OpenAI business understanding response was incomplete (${incompleteReason}).`);
    }
    const text = extractOpenAiResponseText(payload);
    if (!text) throw new Error("OpenAI business understanding response did not include output text.");
    const parsed = understandingSchema.parse(JSON.parse(text) as unknown);
    return {
      version: "business-understanding-v2",
      source: "openai",
      provenance: createRegenerableArtifactProvenanceV1({
        producerId: "business-understanding-v2",
        producerVersion: "business-understanding-v2",
        modelId: body.model,
        createdAt: endedAt,
        inputs: { context }
      }),
      vertical: parsed.vertical,
      verticalConfidence: parsed.verticalConfidence,
      detectedSubverticals: parsed.detectedSubverticals,
      cleanedServices: parsed.cleanedServices
        .map((service) => ({
          name: service.name,
          price: service.price ?? undefined,
          sourceText: service.sourceText,
          confidence: service.confidence
        }))
        .map((service) => withDeterministicServiceCleanup(service))
        .filter((service): service is CleanedServiceV2 => Boolean(service)),
      hours: parsed.hours.filter((entry) => !isDynamicHoursStatus(entry.value) && !isDynamicHoursStatus(entry.label)),
      primaryConversionGoal: parsed.primaryConversionGoal,
      urgentServiceSignals: parsed.urgentServiceSignals,
      factConfidence: parsed.factConfidence,
      businessStory: parsed.businessStory ?? undefined,
      brandExpression: {
        version: "brand-expression-v1",
        mood: parsed.brandExpression.mood,
        fontPosture: parsed.brandExpression.fontPosture,
        voiceRegister: parsed.brandExpression.voiceRegister,
        paletteSeed: {
          strategy: parsed.brandExpression.paletteSeed.strategy,
          preferredHex: parsed.brandExpression.paletteSeed.preferredHex ?? undefined,
          candidateRank: parsed.brandExpression.paletteSeed.candidateRank ?? undefined
        },
        rationale: parsed.brandExpression.rationale
      },
      evidenceProposals: parsed.evidenceProposals.map((proposal): EvidenceProposal => ({
        kind: proposal.kind,
        proposedText: proposal.proposedText,
        sourceUrl: proposal.sourceUrl,
        sourceBlockId: proposal.sourceBlockId,
        ...(proposal.attribution ? { attribution: proposal.attribution } : {})
      })),
      notes: parsed.notes
    };
  } catch (error) {
    if (!recorded) {
      const endedAt = new Date().toISOString();
      await input.telemetry?.recordModelCall({
        spanId: input.spanId,
        provider: "openai",
        model: body.model,
        endpoint: "/v1/responses",
        operation: "business_understanding",
        status: "failed",
        requestJson: sanitizeTelemetryPayload(body),
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: elapsedOpenAiCallMs(startedAt, endedAt)
      });
    }
    if (attempt === 0 && isRetryableBusinessUnderstandingError(error)) {
      console.warn(
        `OpenAI business understanding attempt was invalid; retrying once with a larger output budget. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return createOpenAiBusinessUnderstandingAttempt(input, 1);
    }
    console.warn(
      `OpenAI business understanding unavailable; using deterministic fallback. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

function isRetryableBusinessUnderstandingError(error: unknown) {
  if (error instanceof SyntaxError || error instanceof z.ZodError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/status\s+4\d\d/.test(message) && !/status\s+(408|429)/.test(message)) return false;
  return /incomplete|json|validation|output text|empty|timeout|timed out|abort|status\s+(408|429|5\d\d)/.test(message);
}

function understandingContext(input: BusinessUnderstandingInput) {
  return {
    sourceUrl: input.sourceUrl,
    prompt: input.prompt,
    crawl: input.crawl
      ? {
          title: input.crawl.title,
          metaDescription: input.crawl.metaDescription,
          extractedFacts: input.crawl.extractedFacts,
          pageSummaries: input.crawl.pageSummaries.slice(0, 12).map((page) => ({
            url: page.url,
            source: page.source,
            purposeTags: page.purposeTags,
            title: page.title,
            metaDescription: page.metaDescription,
            extractedFacts: page.extractedFacts,
            sourceTextBlocks: boundedUnderstandingSourceBlocks(page.sourceTextBlocks ?? [])
          }))
        }
      : undefined,
    publicPresence: input.publicPresence
      ? {
          provider: input.publicPresence.provider,
          signals: input.publicPresence.signals.slice(0, 4).map((signal) => signal.fields)
        }
      : undefined,
    allowedValues: {
      verticals: understandingVerticalValues,
      conversionGoals: conversionGoalValues
    },
    brandExpressionAllowedValues: {
      moods: brandExpressionMoodValues,
      fontPostures: brandExpressionFontPostureValues,
      voiceRegisters: brandExpressionVoiceRegisterValues,
      paletteSeedStrategies: brandExpressionPaletteSeedStrategyValues
    }
  };
}

function boundedUnderstandingSourceBlocks(
  blocks: NonNullable<CrawlAssessment["pageSummaries"][number]["sourceTextBlocks"]>
) {
  let remainingCharacters = 30_000;
  return blocks.slice(0, 100).flatMap((block) => {
    if (remainingCharacters <= 0) return [];
    const displayText = block.displayText.slice(0, remainingCharacters);
    remainingCharacters -= displayText.length;
    return [{ id: block.id, sourceUrl: block.sourceUrl, displayText }];
  });
}

/**
 * Deterministic service-title cleanup. Applied to crawl-extracted services in the
 * no-LLM fallback path and re-applied to LLM output as a safety floor.
 * Returns undefined when the raw text cannot be normalized into a service name.
 */
export function cleanServiceName(raw: string): { name: string; price?: string } | undefined {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (/^(?:&m?dash;|[–—-])\s*/i.test(text)) return undefined;
  if (/^(skip\s+(?:to\s+)?content|view|learn more|read more|show more|close|back|next|previous)$/i.test(text)) return undefined;

  let price: string | undefined;
  const priceMatch = text.match(/(?:\b(?:starting at|starts at|from)\s+)?\$\s*\d[\d.,]*(?:\s*(?:and up|\+))?/i);
  if (priceMatch) {
    const startsAt = /starting at|starts at|from/i.test(priceMatch[0]);
    const amount = priceMatch[0].replace(/.*?(\$\s*\d[\d.,]*)/, "$1").replace(/\s+/g, "");
    price = startsAt ? `Starting at ${amount}` : amount;
    text = text.replace(priceMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Strip orphan trailing number fragments left behind by mangled scrapes
  // (for example "10 Minute Flat Repair 15 2" -> "10 Minute Flat Repair").
  text = text.replace(/(?:\s+\d{1,3}){1,4}$/g, "").trim();
  text = text.replace(/[\s\-–—:|]+$/g, "").trim();

  if (text.length < 3) return undefined;
  if (!/[a-z]/i.test(text)) return undefined;
  if (text.length > 70) text = text.slice(0, 70).trim();
  if (text === text.toUpperCase()) {
    text = text
      .toLowerCase()
      .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
  }
  return { name: text, price };
}

/** Cleans and dedupes a raw extracted service list deterministically. */
export function normalizeServiceList(raw: string[]): CleanedServiceV2[] {
  const seen = new Set<string>();
  const cleaned: CleanedServiceV2[] = [];
  for (const value of raw) {
    const result = cleanServiceName(value);
    if (!result) continue;
    const key = result.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      name: result.name,
      price: result.price,
      sourceText: value,
      confidence: 0.5
    });
  }
  return cleaned;
}

const dayPattern = "(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const dayRangePattern = new RegExp(`^(${dayPattern}(?:\\s*(?:[–—-]|to)\\s*${dayPattern})?)\\b[\\s:–—-]*`, "i");
const dayRangeScanPattern = new RegExp(`(${dayPattern}(?:\\s*(?:[–—-]|to)\\s*${dayPattern})?)\\b[\\s:–—-]*`, "gi");

/** Detects live status strings that must never be stored as recurring hours. */
export function isDynamicHoursStatus(value: string) {
  if (
    /\b(?:currently|right now|at the moment)\b.{0,24}\b(?:open|closed|closing)\b/i.test(value) ||
    /\b(?:open|closed|closing)\b.{0,24}\b(?:currently|right now|at the moment)\b/i.test(value)
  ) return true;
  // "open again"/"opens at 8" are live status; "open on Saturdays" is
  // legitimate recurring-hours copy and must not match.
  if (/\b(open again|opens? at|closing soon|closed now|back open)\b/i.test(value)) return true;
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?\b/i.test(value)) return true;
  if (/\b(?:19|20)\d{2}\b/.test(value) && /\b(open|closed)\b/i.test(value)) return true;
  return false;
}

/**
 * Normalizes a scraped hours record into a structured weekly schedule.
 * Drops dynamic status strings and derives day labels from values when the
 * source keys are junk (for example hours_1..hours_4).
 */
export function normalizeBusinessHours(
  hours: Record<string, string> | undefined
): Array<{ label: string; value: string }> {
  if (!hours) return [];
  const entries: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(hours)) {
    const value = rawValue?.replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (isDynamicHoursStatus(value)) continue;

    const keyIsJunk = /^hours?[_\s-]*\d*$/i.test(rawKey) || /^\d+$/.test(rawKey);
    const segments = keyIsJunk ? splitRecurringHoursSegments(value) : [value];
    for (const segment of segments) {
      let label = keyIsJunk ? "" : rawKey.replace(/_/g, " ").trim();
      let times = segment;

      const closedMatch = segment.match(new RegExp(`\\bclosed\\b[\\s:]*(?:on\\s+)?(${dayPattern})`, "i"));
      if (closedMatch) {
        label = titleCaseDays(closedMatch[1]);
        times = "Closed";
      } else {
        const rangeMatch = segment.match(dayRangePattern);
        if (rangeMatch) {
          label = titleCaseDays(rangeMatch[1]);
          times = segment.slice(rangeMatch[0].length).replace(/^[,:;|]\s*/, "").trim() || segment;
        } else if (!label) {
          continue;
        }
      }

      if (!label) continue;
      times = normalizeHoursValue(times);
      if (!times || isDynamicHoursStatus(times)) continue;
      const dedupeKey = label.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      entries.push({ label, value: times });
    }
  }
  return entries;
}

function splitRecurringHoursSegments(value: string) {
  const matches = [...value.matchAll(dayRangeScanPattern)];
  if (matches.length <= 1) return [value];
  const segments: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? value.length;
    const segment = value
      .slice(start, end)
      .replace(/^[,:;|]\s*/, "")
      .replace(/[,:;|]\s*$/, "")
      .trim();
    if (segment) segments.push(segment);
  }
  return segments.length ? segments : [value];
}

function normalizeHoursValue(value: string) {
  return value
    .replace(/\b(a\.m\.|am)\b/gi, "AM")
    .replace(/\b(p\.m\.|pm)\b/gi, "PM")
    .replace(/\s*([–—-])\s*/g, " $1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Projects normalized hours entries back into the BusinessProfile hours record shape. */
export function hoursRecordFromEntries(entries: Array<{ label: string; value: string }>): Record<string, string> | undefined {
  if (!entries.length) return undefined;
  const record: Record<string, string> = {};
  for (const entry of entries) {
    record[entry.label] = entry.value;
  }
  return record;
}

function titleCaseDays(value: string) {
  return value
    .toLowerCase()
    .replace(/\s*[–—-]\s*/g, " – ")
    .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

function withDeterministicServiceCleanup(service: CleanedServiceV2): CleanedServiceV2 | undefined {
  const cleaned = cleanServiceName(service.name);
  if (!cleaned) return undefined;
  return {
    ...service,
    name: cleaned.name,
    price: service.price ?? cleaned.price
  };
}

const understandingResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "vertical",
    "verticalConfidence",
    "detectedSubverticals",
    "cleanedServices",
    "hours",
    "primaryConversionGoal",
    "urgentServiceSignals",
    "businessStory",
    "brandExpression",
    "evidenceProposals",
    "factConfidence",
    "notes"
  ],
  properties: {
    vertical: { type: "string", enum: understandingVerticalValues },
    verticalConfidence: { type: "number", minimum: 0, maximum: 1 },
    detectedSubverticals: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 60 } },
    cleanedServices: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "price", "sourceText", "confidence"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 70 },
          price: { type: ["string", "null"], minLength: 1, maxLength: 60 },
          sourceText: { type: "string", minLength: 1, maxLength: 200 },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    hours: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: {
          label: { type: "string", minLength: 2, maxLength: 40 },
          value: { type: "string", minLength: 2, maxLength: 60 }
        }
      }
    },
    primaryConversionGoal: { type: "string", enum: conversionGoalValues },
    urgentServiceSignals: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 80 } },
    businessStory: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["summary", "distinctives"],
          properties: {
            summary: { type: "string", minLength: 30, maxLength: 400 },
            distinctives: { type: "array", maxItems: 5, items: { type: "string", minLength: 3, maxLength: 120 } }
          }
        },
        { type: "null" }
      ]
    },
    brandExpression: {
      type: "object",
      additionalProperties: false,
      required: ["mood", "fontPosture", "voiceRegister", "paletteSeed", "rationale"],
      properties: {
        mood: { type: "string", enum: brandExpressionMoodValues },
        fontPosture: { type: "string", enum: brandExpressionFontPostureValues },
        voiceRegister: { type: "string", enum: brandExpressionVoiceRegisterValues },
        paletteSeed: {
          type: "object",
          additionalProperties: false,
          required: ["strategy", "preferredHex", "candidateRank"],
          properties: {
            strategy: { type: "string", enum: brandExpressionPaletteSeedStrategyValues },
            preferredHex: { type: ["string", "null"], pattern: "^#[0-9a-fA-F]{6}$" },
            candidateRank: { type: ["number", "null"], minimum: 0, maximum: 7 }
          }
        },
        rationale: { type: "string", minLength: 10, maxLength: 240 }
      }
    },
    evidenceProposals: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "proposedText", "sourceUrl", "sourceBlockId", "attribution"],
        properties: {
          kind: { type: "string", enum: evidenceKindValues },
          proposedText: { type: "string", minLength: 1, maxLength: 320 },
          sourceUrl: { type: "string" },
          sourceBlockId: { type: "string", minLength: 1, maxLength: 160 },
          attribution: { type: ["string", "null"], minLength: 1, maxLength: 120 }
        }
      }
    },
    factConfidence: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "confidence", "sourceBacked"],
        properties: {
          field: { type: "string", enum: factFieldValues },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceBacked: { type: "boolean" }
        }
      }
    },
    notes: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 200 } }
  }
};
