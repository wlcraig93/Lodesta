import OpenAI from "openai";
import { sourceSnapshotSchema, type SourceSnapshot } from "@/packages/site-contracts";
import { usageForModel } from "@/packages/site-agent/run-policy";
import { assertOpenAiStrictJsonSchema } from "@/packages/site-agent/strict-tool-schema";
import { sha256, stableJson } from "./hash";

const researchModel = "gpt-5.6-sol";
const googleAggregateRatingResearchModel = "gpt-5.6-luna";
const maximumOutputTokens = 6_000;
const webSearchCallEstimateUsd = 0.01;
const googleAggregateRatingOutputTokens = 1_200;

export type WebResearchUsage = {
  modelId: typeof researchModel | typeof googleAggregateRatingResearchModel;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  searchCalls: number;
  durationMs: number;
};

export type GoogleAggregateRatingObservation = {
  kind: "google_aggregate_rating";
  status: "matched";
  provider: "google";
  businessName: string;
  locality?: string;
  rating: number;
  reviewCount?: number;
  profileUrl?: string;
  observedAt: string;
  identityEvidence: string;
};

const googleAggregateRatingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["matched", "ambiguous", "not_found"] },
    businessName: { type: ["string", "null"] },
    locality: { type: ["string", "null"] },
    rating: { type: ["number", "null"] },
    reviewCount: { type: ["integer", "null"] },
    profileUrl: { type: ["string", "null"] },
    identityEvidence: { type: "string" }
  },
  required: [
    "status",
    "businessName",
    "locality",
    "rating",
    "reviewCount",
    "profileUrl",
    "identityEvidence"
  ]
} as const;

type GoogleAggregateRatingResponse = {
  status: "matched" | "ambiguous" | "not_found";
  businessName: string | null;
  locality: string | null;
  rating: number | null;
  reviewCount: number | null;
  profileUrl: string | null;
  identityEvidence: string;
};

/**
 * Performs the one narrow third-party lookup needed by a blank website build.
 * This uses visible web-search evidence, never Google Places or Maps APIs. A
 * completed but ambiguous lookup is still retained so absence is auditable and
 * does not trigger another hidden lookup later in the same run.
 */
export async function researchGoogleAggregateRating(input: {
  businessId: string;
  businessName: string;
  locality?: string;
  phone?: string;
  address?: string;
  sourceUrl?: string;
  capturedAt?: string;
  signal?: AbortSignal;
}): Promise<{ snapshot: SourceSnapshot; usage: WebResearchUsage } | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !input.businessName.trim()) return undefined;
  assertOpenAiStrictJsonSchema(googleAggregateRatingSchema, "google_aggregate_rating_research");
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const startedAt = Date.now();
  try {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
    const response = await client.responses.create({
      model: googleAggregateRatingResearchModel,
      reasoning: { effort: "low" },
      store: false,
      tools: [{ type: "web_search", search_context_size: "low" }],
      include: ["web_search_call.action.sources"],
      max_output_tokens: googleAggregateRatingOutputTokens,
      instructions: [
        "Find only the current aggregate Google rating for exactly one US small business using visible web-search evidence.",
        "This is browser research; do not call Google Places, Maps Platform, or any paid business-data API.",
        "Return matched only when business identity and geography are unambiguous from the supplied name, locality, first-party website, phone, address, or equivalent corroboration.",
        "For a matched business, copy the exact rating shown by Google, the review count when visible, and a Google profile or reviews URL when visible.",
        "Never return or quote individual review prose. Return ambiguous rather than choosing between plausible locations or businesses."
      ].join(" "),
      input: [
        `Business: ${input.businessName}`,
        input.locality ? `Locality: ${input.locality}` : undefined,
        input.phone ? `Phone: ${input.phone}` : undefined,
        input.address ? `Address: ${input.address}` : undefined,
        input.sourceUrl ? `First-party website: ${input.sourceUrl}` : undefined
      ].filter(Boolean).join("\n"),
      text: {
        format: {
          type: "json_schema",
          name: "google_aggregate_rating_research",
          strict: true,
          schema: googleAggregateRatingSchema
        }
      }
    }, input.signal ? { signal: input.signal } : undefined);
    if (response.status !== "completed" || !response.output_text.trim()) return undefined;
    const parsed = JSON.parse(response.output_text) as GoogleAggregateRatingResponse;
    const observation = validatedGoogleAggregateRatingObservation(parsed, capturedAt);
    const sources = consultedUrls(response.output);
    const searchCalls = response.output.filter((item) => item.type === "web_search_call").length;
    const modelUsage = usageForModel(googleAggregateRatingResearchModel, response.usage, Date.now() - startedAt);
    const usage: WebResearchUsage = {
      modelId: googleAggregateRatingResearchModel,
      inputTokens: modelUsage.inputTokens,
      cachedInputTokens: modelUsage.cachedInputTokens,
      outputTokens: modelUsage.outputTokens,
      estimatedCostUsd: modelUsage.costUsd + searchCalls * webSearchCallEstimateUsd,
      searchCalls,
      durationMs: modelUsage.durationMs
    };
    const payload = {
      kind: "google_aggregate_rating_research",
      observation: observation ?? {
        kind: "google_aggregate_rating",
        status: parsed.status,
        provider: "google",
        observedAt: capturedAt,
        identityEvidence: parsed.identityEvidence.trim().slice(0, 1_000)
      },
      sources,
      provenance: {
        provider: "openai",
        modelId: googleAggregateRatingResearchModel,
        tool: "web_search",
        maximumOutputTokens: googleAggregateRatingOutputTokens,
        generatedAt: capturedAt
      },
      usage
    };
    return { snapshot: webResearchSnapshot(input.businessId, input.sourceUrl, capturedAt, payload), usage };
  } catch {
    return undefined;
  }
}

/**
 * Converts a browser-observed prospect fact into the same immutable evidence
 * shape used by live web research. Exact website matching happens at the
 * caller; this function deliberately carries no prospect lookup or fallback
 * behavior of its own.
 */
export function retainedProspectGoogleAggregateRatingSnapshot(input: {
  businessId: string;
  businessName: string;
  sourceUrl: string;
  rating: number;
  reviewCount?: number;
  locality?: string;
  googleBusinessName?: string;
  observedAt: string;
}): SourceSnapshot | undefined {
  if (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5) return undefined;
  const reviewCount = input.reviewCount !== undefined
    && Number.isInteger(input.reviewCount)
    && input.reviewCount >= 0
    ? input.reviewCount
    : undefined;
  const businessName = input.googleBusinessName?.trim() || input.businessName.trim();
  if (!businessName || Number.isNaN(Date.parse(input.observedAt))) return undefined;
  return webResearchSnapshot(input.businessId, input.sourceUrl, input.observedAt, {
    kind: "google_aggregate_rating_research",
    observation: {
      kind: "google_aggregate_rating",
      status: "matched",
      provider: "google",
      businessName,
      ...(input.locality?.trim() ? { locality: input.locality.trim() } : {}),
      rating: input.rating,
      ...(reviewCount !== undefined ? { reviewCount } : {}),
      observedAt: input.observedAt,
      identityEvidence: "Retained browser prospect observation matched to the exact first-party website."
    },
    sources: [input.sourceUrl],
    provenance: {
      provider: "browser_prospect_research",
      tool: "visible_browser_observation",
      generatedAt: input.observedAt
    }
  });
}

export function googleAggregateRatingObservationFromSnapshot(
  snapshot: SourceSnapshot
): GoogleAggregateRatingObservation | undefined {
  if (snapshot.sourceType !== "web_research" || snapshot.payload.kind !== "google_aggregate_rating_research") {
    return undefined;
  }
  const value = snapshot.payload.observation;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return validatedGoogleAggregateRatingObservation({
    status: record.status as GoogleAggregateRatingResponse["status"],
    businessName: typeof record.businessName === "string" ? record.businessName : null,
    locality: typeof record.locality === "string" ? record.locality : null,
    rating: typeof record.rating === "number" ? record.rating : null,
    reviewCount: typeof record.reviewCount === "number" ? record.reviewCount : null,
    profileUrl: typeof record.profileUrl === "string" ? record.profileUrl : null,
    identityEvidence: typeof record.identityEvidence === "string" ? record.identityEvidence : ""
  }, typeof record.observedAt === "string" ? record.observedAt : snapshot.capturedAt);
}

export async function researchBusiness(input: {
  businessId: string;
  sourceUrl?: string;
  businessName?: string;
  locality?: string;
  query?: string;
  domains?: string[];
  capturedAt?: string;
  signal?: AbortSignal;
}): Promise<{ snapshot: SourceSnapshot; usage: WebResearchUsage } | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const queryIdentity = [
    input.query ? `Research question: ${input.query}` : undefined,
    input.businessName ? `Business: ${input.businessName}` : undefined,
    input.locality ? `Locality: ${input.locality}` : undefined,
    input.sourceUrl ? `First-party website: ${input.sourceUrl}` : undefined,
    input.domains?.length ? `Prefer these domains: ${input.domains.join(", ")}` : undefined
  ].filter(Boolean).join("\n");
  if (!queryIdentity) return undefined;

  const startedAt = Date.now();
  try {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
    const response = await client.responses.create({
      model: researchModel,
      store: false,
      tools: [{ type: "web_search", search_context_size: "high" }],
      include: ["web_search_call.action.sources"],
      max_output_tokens: maximumOutputTokens,
      instructions: [
        "Research this US small business deeply enough to brief a website designer.",
        "Prioritize the first-party website, then reputable directories, social profiles, news, and review platforms.",
        "Summarize services, positioning, customer themes, reputation patterns, locality, differentiators, and useful design/copy context.",
        "When visible Google Search or Maps evidence unambiguously matches the business and location, report the exact current Google rating, review count, Google Maps or reviews URL, and capture date; omit these values when identity or geography is ambiguous, and never reproduce individual third-party review text.",
        "Clearly distinguish first-party statements from third-party observations. Do not present research as verified public facts.",
        "Cite the source URLs inline."
      ].join(" "),
      input: queryIdentity
    }, input.signal ? { signal: input.signal } : undefined);
    if (response.status !== "completed" || !response.output_text.trim()) return undefined;

    const sources = consultedUrls(response.output);
    const searchCalls = response.output.filter((item) => item.type === "web_search_call").length;
    const modelUsage = usageForModel(researchModel, response.usage, Date.now() - startedAt);
    const usage: WebResearchUsage = {
      modelId: researchModel,
      inputTokens: modelUsage.inputTokens,
      cachedInputTokens: modelUsage.cachedInputTokens,
      outputTokens: modelUsage.outputTokens,
      estimatedCostUsd: modelUsage.costUsd + searchCalls * webSearchCallEstimateUsd,
      searchCalls,
      durationMs: modelUsage.durationMs
    };
    const capturedAt = input.capturedAt ?? new Date().toISOString();
    const payload = {
      report: response.output_text,
      sources,
      coverage: sources.length ? "researched" : "report_only",
      provenance: {
        provider: "openai",
        modelId: researchModel,
        tool: "web_search",
        maximumOutputTokens,
        generatedAt: capturedAt
      },
      usage
    };
    return {
      snapshot: webResearchSnapshot(input.businessId, input.sourceUrl, capturedAt, payload),
      usage
    };
  } catch {
    return undefined;
  }
}

function validatedGoogleAggregateRatingObservation(
  value: GoogleAggregateRatingResponse,
  observedAt: string
): GoogleAggregateRatingObservation | undefined {
  if (
    value.status !== "matched"
    || typeof value.businessName !== "string"
    || !value.businessName.trim()
    || typeof value.rating !== "number"
    || !Number.isFinite(value.rating)
    || value.rating < 1
    || value.rating > 5
    || !value.identityEvidence.trim()
  ) return undefined;
  const reviewCount = typeof value.reviewCount === "number"
    && Number.isInteger(value.reviewCount)
    && value.reviewCount >= 0
    ? value.reviewCount
    : undefined;
  const profileUrl = googleProfileUrl(value.profileUrl);
  return {
    kind: "google_aggregate_rating",
    status: "matched",
    provider: "google",
    businessName: value.businessName.trim().slice(0, 200),
    ...(value.locality?.trim() ? { locality: value.locality.trim().slice(0, 200) } : {}),
    rating: value.rating,
    ...(reviewCount !== undefined ? { reviewCount } : {}),
    ...(profileUrl ? { profileUrl } : {}),
    observedAt,
    identityEvidence: value.identityEvidence.trim().slice(0, 1_000)
  };
}

function googleProfileUrl(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && (host === "google.com" || host.endsWith(".google.com"))
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function webResearchSnapshot(
  businessId: string,
  sourceUrl: string | undefined,
  capturedAt: string,
  payload: Record<string, unknown>
) {
  const contentHash = sha256(stableJson(payload));
  const snapshotIdentity = sha256(stableJson({ businessId, contentHash }));
  return sourceSnapshotSchema.parse({
    schemaVersion: 1,
    id: `source_web_research_${snapshotIdentity.slice(7, 31)}`,
    businessId,
    sourceType: "web_research",
    sourceUrl,
    contentHash,
    capturedAt,
    payload
  });
}

function consultedUrls(output: unknown) {
  const values = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "url" && typeof entry === "string" && /^https?:\/\//i.test(entry)) values.add(entry);
      else visit(entry);
    }
  };
  visit(output);
  return [...values].sort();
}
