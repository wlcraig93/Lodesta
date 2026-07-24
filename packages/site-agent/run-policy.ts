import type { ManagerModelUsage, ManagerRunLimits } from "./contracts";

export const siteAgentModelPricing = {
  "gpt-5.6-sol": {
    inputUsdPerMillion: 5,
    cachedInputUsdPerMillion: 0.5,
    outputUsdPerMillion: 30
  }
} as const;

export type SupportedSiteAgentModel = keyof typeof siteAgentModelPricing;

export function isSupportedSiteAgentModel(modelId: string): modelId is SupportedSiteAgentModel {
  return Object.hasOwn(siteAgentModelPricing, modelId);
}

export function managerLimitsForKind(kind: "initial_build" | "edit" | "rebase"): ManagerRunLimits {
  return kind === "initial_build"
    ? { maxInputTokens: 650_000, maxOutputTokens: 40_000, maxDurationMs: 12 * 60_000 }
    : { maxInputTokens: 250_000, maxOutputTokens: 25_000, maxDurationMs: 8 * 60_000 };
}

export function usageForModel(
  modelId: string,
  value: {
    input_tokens?: number | null;
    input_tokens_details?: { cached_tokens?: number | null } | null;
    output_tokens?: number | null;
    output_tokens_details?: { reasoning_tokens?: number | null } | null;
    cost?: number | null;
    cost_details?: { upstream_inference_cost?: number | null } | null;
  } | null | undefined,
  durationMs: number
): ManagerModelUsage {
  const inputTokens = value?.input_tokens ?? 0;
  const cachedInputTokens = Math.min(inputTokens, value?.input_tokens_details?.cached_tokens ?? 0);
  const reasoningTokens = Math.min(value?.output_tokens ?? 0, value?.output_tokens_details?.reasoning_tokens ?? 0);
  const outputTokens = value?.output_tokens ?? 0;
  const pricing = modelPricing(modelId);
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const catalogEstimateUsd = pricing
    ? (
        uncachedInputTokens * pricing.inputUsdPerMillion
        + cachedInputTokens * pricing.cachedInputUsdPerMillion
        + outputTokens * pricing.outputUsdPerMillion
      ) / 1_000_000
    : undefined;
  const providerCostUsd = nonnegativeFinite(value?.cost);
  return {
    inputTokens,
    cachedInputTokens,
    reasoningTokens,
    outputTokens,
    costUsd: providerCostUsd ?? catalogEstimateUsd ?? 0,
    costSource: providerCostUsd !== undefined ? "provider_reported" : catalogEstimateUsd !== undefined ? "catalog_estimate" : "unavailable",
    upstreamInferenceCostUsd: nonnegativeFinite(value?.cost_details?.upstream_inference_cost) ?? 0,
    durationMs
  };
}

export function maximumRunCostUsd(modelId: string, limits: ManagerRunLimits) {
  const pricing = modelPricing(modelId);
  return pricing
    ? (limits.maxInputTokens * pricing.inputUsdPerMillion + limits.maxOutputTokens * pricing.outputUsdPerMillion) / 1_000_000
    : undefined;
}

function modelPricing(modelId: string) {
  if (isSupportedSiteAgentModel(modelId)) return siteAgentModelPricing[modelId];
  const unqualified = modelId.startsWith("openai/") ? modelId.slice("openai/".length) : "";
  return unqualified && isSupportedSiteAgentModel(unqualified) ? siteAgentModelPricing[unqualified] : undefined;
}

function nonnegativeFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
