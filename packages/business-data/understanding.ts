import { z } from "zod";
import { getAgentModelSettings } from "@/lib/operator-settings";
import type { CrawlAssessment } from "@/lib/crawler";
import type { PublicPresenceEnrichment } from "@/lib/public-presence";
import type { VerticalContextModuleV1 } from "@/packages/site-contracts";

const schema = z.object({
  schemaVersion: z.literal("website-understanding-v1"),
  vertical: z.string().min(1).max(80),
  verticalConfidence: z.number().min(0).max(1),
  cleanedServices: z.array(z.object({ name: z.string().min(2).max(100) }).strict()).max(24),
  primaryConversionGoal: z.enum(["call_first", "form_first", "visit_first"]),
  businessStory: z.object({ summary: z.string().min(20).max(600), distinctives: z.array(z.string().min(2).max(180)).max(8) }).strict().nullable(),
  brandExpression: z.object({
    voiceRegister: z.enum(["direct", "warm", "premium", "technical", "plainspoken"]),
    paletteSeed: z.object({ preferredHex: z.string().regex(/^#[0-9a-f]{6}$/i).nullable() }).strict()
  }).strict()
}).strict();

export type WebsiteUnderstandingV1 = z.infer<typeof schema>;

export async function understandWebsite(input: {
  sourceUrl: string;
  crawl: CrawlAssessment;
  supportedVerticals: VerticalContextModuleV1[];
  publicPresence?: PublicPresenceEnrichment;
  signal?: AbortSignal;
}): Promise<WebsiteUnderstandingV1> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for production website ingestion.");
  const supportedVerticalIds = input.supportedVerticals.filter((module) => module.status === "active").map((module) => module.id);
  if (!supportedVerticalIds.length) throw new Error("Website ingestion requires at least one active vertical context module.");
  const settings = await getAgentModelSettings();
  const model = process.env.LODESTA_INGESTION_MODEL ?? settings.settings.ingestionModel;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      max_output_tokens: 5_000,
      input: [
        { role: "system", content: [{ type: "input_text", text: `Extract a conservative business understanding for Lodesta. Classify only to one of the supplied active vertical IDs when the source clearly matches that module's aliases and classification signals. Never invent services, proof, history, or brand facts. Return unsupported for every other vertical.\n\nActive vertical modules:\n${JSON.stringify(input.supportedVerticals.map((module) => ({ id: module.id, aliases: module.aliases, classificationSignals: module.classificationSignals })))}` }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify({ sourceUrl: input.sourceUrl, extractedFacts: input.crawl.extractedFacts, pageSummaries: input.crawl.pageSummaries.map((page) => ({ url: page.url, title: page.title, purposeTags: page.purposeTags, text: page.sourceTextBlocks.map((block) => block.displayText).join("\n").slice(0, 12_000) })), publicPresence: input.publicPresence }) }] }
      ],
      text: { verbosity: "low", format: { type: "json_schema", name: "website_understanding_v1", strict: true, schema: jsonSchema(supportedVerticalIds) } }
    }),
    signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000)
  });
  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!response.ok) throw new Error(openAiError(payload) ?? `Business understanding failed with HTTP ${response.status}.`);
  const text = responseText(payload);
  if (!text) throw new Error("Business understanding returned no structured output.");
  const understanding = schema.parse(JSON.parse(text));
  if (understanding.vertical !== "unsupported" && !supportedVerticalIds.includes(understanding.vertical)) {
    throw new Error(`Business understanding returned an unregistered vertical: ${understanding.vertical}.`);
  }
  return understanding;
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

function jsonSchema(supportedVerticalIds: string[]) {
  return {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "vertical", "verticalConfidence", "cleanedServices", "primaryConversionGoal", "businessStory", "brandExpression"],
  properties: {
    schemaVersion: { type: "string", const: "website-understanding-v1" },
    vertical: { type: "string", enum: [...supportedVerticalIds, "unsupported"] },
    verticalConfidence: { type: "number", minimum: 0, maximum: 1 },
    cleanedServices: { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" } } } },
    primaryConversionGoal: { type: "string", enum: ["call_first", "form_first", "visit_first"] },
    businessStory: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["summary", "distinctives"], properties: { summary: { type: "string" }, distinctives: { type: "array", maxItems: 8, items: { type: "string" } } } }] },
    brandExpression: { type: "object", additionalProperties: false, required: ["voiceRegister", "paletteSeed"], properties: { voiceRegister: { type: "string", enum: ["direct", "warm", "premium", "technical", "plainspoken"] }, paletteSeed: { type: "object", additionalProperties: false, required: ["preferredHex"], properties: { preferredHex: { type: ["string", "null"] } } } } }
  }
  };
}
