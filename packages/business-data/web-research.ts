import OpenAI from "openai";
import { sourceSnapshotSchema, type SourceSnapshot } from "@/packages/site-contracts";
import { usageForModel } from "@/packages/site-agent/run-policy";
import { sha256, stableJson } from "./hash";

const researchModel = "gpt-5.6-sol";
const maximumOutputTokens = 6_000;
const webSearchCallEstimateUsd = 0.01;

export type WebResearchUsage = {
  modelId: typeof researchModel;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  searchCalls: number;
  durationMs: number;
};

export async function researchBusiness(input: {
  businessId: string;
  sourceUrl?: string;
  businessName?: string;
  locality?: string;
  capturedAt?: string;
  signal?: AbortSignal;
}): Promise<{ snapshot: SourceSnapshot; usage: WebResearchUsage } | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const queryIdentity = [
    input.businessName ? `Business: ${input.businessName}` : undefined,
    input.locality ? `Locality: ${input.locality}` : undefined,
    input.sourceUrl ? `First-party website: ${input.sourceUrl}` : undefined
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
    const contentHash = sha256(stableJson(payload));
    const snapshotIdentity = sha256(stableJson({
      businessId: input.businessId,
      contentHash
    }));
    return {
      snapshot: sourceSnapshotSchema.parse({
        schemaVersion: 1,
        id: `source_web_research_${snapshotIdentity.slice(7, 31)}`,
        businessId: input.businessId,
        sourceType: "web_research",
        sourceUrl: input.sourceUrl,
        contentHash,
        capturedAt,
        payload
      }),
      usage
    };
  } catch {
    return undefined;
  }
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
