import { createHash } from "node:crypto";
import { z } from "zod";
import { getAgentModelSettings } from "@/lib/operator-settings";
import type { PublicPresenceEnrichment } from "@/lib/public-presence";
import type { WebsiteGenerationIngestionV2 } from "./generation-crawler";

const evidenceReferenceSchema = z.object({
  sourceBlockId: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  startToken: z.number().int().nonnegative(),
  endToken: z.number().int().positive(),
  quote: z.string().min(1).max(1200),
  evidenceClass: z.enum(["first_party", "third_party", "unknown"])
}).strict();

const evidencedText = (maximum: number) => z.object({
  value: z.string().min(1).max(maximum),
  evidence: z.array(evidenceReferenceSchema).min(1).max(8)
}).strict();

const modelSchema = z.object({
  schemaVersion: z.literal("website-understanding-v3"),
  businessName: evidencedText(200),
  observedCategory: evidencedText(120).extend({ confidence: z.number().min(0).max(1) }).strict(),
  cleanedServices: z.array(evidencedText(160)).max(24),
  primaryConversion: z.object({
    goal: z.enum(["call_first", "form_first", "booking_first", "visit_first"]),
    evidence: z.array(evidenceReferenceSchema).min(1).max(8)
  }).strict(),
  locationOrServiceArea: evidencedText(240),
  businessStory: z.object({
    summary: z.string().min(20).max(600),
    distinctives: z.array(z.string().min(2).max(180)).max(8),
    evidence: z.array(evidenceReferenceSchema).min(1).max(8)
  }).strict().nullable(),
  brandExpression: z.object({
    voiceRegister: z.enum(["direct", "warm", "premium", "technical", "plainspoken"]),
    evidence: z.array(evidenceReferenceSchema).min(1).max(8),
    paletteSeed: z.object({ preferredHex: z.null() }).strict()
  }).strict()
}).strict();

type ModelUnderstandingV3 = z.infer<typeof modelSchema>;
export type WebsiteUnderstandingV3 = ModelUnderstandingV3 & {
  provenance: {
    producer: "website-understanding";
    model: string;
    promptVersion: "website-understanding-v3.0";
    inputHash: `sha256:${string}`;
    generatedAt: string;
    attempts: number;
  };
};

export class WebsiteUnderstandingValidationError extends Error {
  readonly code = "website_understanding_validation_failed";
  constructor(readonly failures: string[]) {
    super(`Website understanding could not establish minimum reconstructible knowledge: ${failures.join("; ")}`);
  }
}

export async function understandWebsite(input: {
  sourceUrl: string;
  ingestion: WebsiteGenerationIngestionV2;
  publicPresence?: PublicPresenceEnrichment;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  modelOverride?: string;
}): Promise<WebsiteUnderstandingV3> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for production website ingestion.");
  const settings = input.modelOverride ? undefined : await getAgentModelSettings();
  const model = input.modelOverride ?? process.env.LODESTA_INGESTION_MODEL ?? settings!.settings.ingestionModel;
  const modelInput = {
    sourceUrl: input.sourceUrl,
    coverage: input.ingestion.coverage,
    sourceBlocks: input.ingestion.modelBlocks,
    publicPresenceContext: input.publicPresence
  };
  const inputHash = sha256(JSON.stringify(modelInput));
  let validationFailures: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await (input.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        max_output_tokens: 8_000,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "Create conservative typed knowledge for a local-business website. Every output item must cite exact supplied source block token spans, quote the reconstructed display text exactly, preserve the supplied source URL and evidence class, and avoid third-party reviews as business claims. Public-presence context may help interpretation but is never valid evidence. Do not infer a palette color from prose; preferredHex must be null." }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify({
              ...modelInput,
              priorValidationFailures: validationFailures,
              requiredKnowledge: ["businessName", "offering or category", "conversion path", "location or service area"]
            }) }]
          }
        ],
        text: { verbosity: "low", format: { type: "json_schema", name: "website_understanding_v3", strict: true, schema: jsonSchema() } }
      }),
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000)
    });
    const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok) throw new Error(openAiError(payload) ?? `Business understanding failed with HTTP ${response.status}.`);
    const text = responseText(payload);
    if (!text) throw new Error("Business understanding returned no structured output.");
    try {
      const understanding = modelSchema.parse(JSON.parse(text));
      validationFailures = validateUnderstandingEvidence(understanding, input.ingestion);
      if (!validationFailures.length) {
        return {
          ...understanding,
          provenance: {
            producer: "website-understanding",
            model,
            promptVersion: "website-understanding-v3.0",
            inputHash,
            generatedAt: new Date().toISOString(),
            attempts: attempt
          }
        };
      }
    } catch (error) {
      validationFailures = error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).slice(0, 40)
        : [error instanceof Error ? error.message : String(error)];
    }
  }
  throw new WebsiteUnderstandingValidationError(validationFailures);
}

export function validateUnderstandingEvidence(understanding: ModelUnderstandingV3, ingestion: WebsiteGenerationIngestionV2) {
  const failures: string[] = [];
  const blocks = new Map(ingestion.modelBlocks.map((block) => [block.id, block]));
  const groups: Array<[string, z.infer<typeof evidenceReferenceSchema>[]]> = [
    ["businessName", understanding.businessName.evidence],
    ["observedCategory", understanding.observedCategory.evidence],
    ...understanding.cleanedServices.map((service, index) => [`cleanedServices.${index}`, service.evidence] as [string, z.infer<typeof evidenceReferenceSchema>[]]),
    ["primaryConversion", understanding.primaryConversion.evidence],
    ["locationOrServiceArea", understanding.locationOrServiceArea.evidence],
    ["brandExpression", understanding.brandExpression.evidence],
    ...(understanding.businessStory ? [["businessStory", understanding.businessStory.evidence] as [string, z.infer<typeof evidenceReferenceSchema>[]]] : [])
  ];
  for (const [label, references] of groups) {
    for (const [index, reference] of references.entries()) {
      const block = blocks.get(reference.sourceBlockId);
      if (!block) { failures.push(`${label}.evidence.${index}: unknown source block`); continue; }
      if (block.sourceUrl !== reference.sourceUrl) failures.push(`${label}.evidence.${index}: source URL mismatch`);
      if (block.evidenceClass !== reference.evidenceClass) failures.push(`${label}.evidence.${index}: evidence class mismatch`);
      const first = block.canonicalTokens[reference.startToken];
      const last = block.canonicalTokens[reference.endToken - 1];
      if (!first || !last || reference.endToken <= reference.startToken) {
        failures.push(`${label}.evidence.${index}: invalid token span`);
        continue;
      }
      const reconstructed = block.displayText.slice(first.displayStart, last.displayEnd);
      if (reconstructed !== reference.quote) failures.push(`${label}.evidence.${index}: quote is not reconstructible`);
    }
  }
  const firstParty = (references: z.infer<typeof evidenceReferenceSchema>[]) => references.some((reference) => reference.evidenceClass === "first_party");
  if (!firstParty(understanding.businessName.evidence)) failures.push("businessName: first-party evidence required");
  if (!understanding.cleanedServices.some((service) => firstParty(service.evidence)) && !firstParty(understanding.observedCategory.evidence)) failures.push("offeringOrCategory: first-party evidence required");
  if (!firstParty(understanding.primaryConversion.evidence)) failures.push("primaryConversion: first-party evidence required");
  if (!firstParty(understanding.locationOrServiceArea.evidence)) failures.push("locationOrServiceArea: first-party evidence required");
  return [...new Set(failures)];
}

function responseText(payload: Record<string, unknown> | undefined) {
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (record.type === "output_text" && typeof record.text === "string") return record.text;
      if (record.type === "refusal" && typeof record.refusal === "string") throw new Error(record.refusal);
    }
  }
  return undefined;
}

function openAiError(payload: Record<string, unknown> | undefined) {
  const value = payload?.error;
  return value && typeof value === "object" && typeof (value as Record<string, unknown>).message === "string"
    ? (value as Record<string, unknown>).message as string
    : undefined;
}

function jsonSchema() {
  const evidence = {
    type: "object", additionalProperties: false,
    required: ["sourceBlockId", "sourceUrl", "startToken", "endToken", "quote", "evidenceClass"],
    properties: {
      sourceBlockId: { type: "string" }, sourceUrl: { type: "string" }, startToken: { type: "integer", minimum: 0 }, endToken: { type: "integer", minimum: 1 }, quote: { type: "string" }, evidenceClass: { type: "string", enum: ["first_party", "third_party", "unknown"] }
    }
  };
  const text = { type: "object", additionalProperties: false, required: ["value", "evidence"], properties: { value: { type: "string" }, evidence: { type: "array", minItems: 1, maxItems: 8, items: evidence } } };
  return {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "businessName", "observedCategory", "cleanedServices", "primaryConversion", "locationOrServiceArea", "businessStory", "brandExpression"],
    properties: {
      schemaVersion: { type: "string", const: "website-understanding-v3" },
      businessName: text,
      observedCategory: { type: "object", additionalProperties: false, required: ["value", "confidence", "evidence"], properties: { value: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence: { type: "array", minItems: 1, maxItems: 8, items: evidence } } },
      cleanedServices: { type: "array", maxItems: 24, items: text },
      primaryConversion: { type: "object", additionalProperties: false, required: ["goal", "evidence"], properties: { goal: { type: "string", enum: ["call_first", "form_first", "booking_first", "visit_first"] }, evidence: { type: "array", minItems: 1, maxItems: 8, items: evidence } } },
      locationOrServiceArea: text,
      businessStory: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["summary", "distinctives", "evidence"], properties: { summary: { type: "string" }, distinctives: { type: "array", maxItems: 8, items: { type: "string" } }, evidence: { type: "array", minItems: 1, maxItems: 8, items: evidence } } }] },
      brandExpression: { type: "object", additionalProperties: false, required: ["voiceRegister", "evidence", "paletteSeed"], properties: { voiceRegister: { type: "string", enum: ["direct", "warm", "premium", "technical", "plainspoken"] }, evidence: { type: "array", minItems: 1, maxItems: 8, items: evidence }, paletteSeed: { type: "object", additionalProperties: false, required: ["preferredHex"], properties: { preferredHex: { type: "null" } } } } }
    }
  };
}

function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}` as const; }
