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
    ? { maxInputTokens: 500_000, maxOutputTokens: 50_000, maxDurationMs: 12 * 60_000 }
    : { maxInputTokens: 250_000, maxOutputTokens: 25_000, maxDurationMs: 8 * 60_000 };
}

export function usageForModel(
  modelId: string,
  value: {
    input_tokens?: number | null;
    input_tokens_details?: { cached_tokens?: number | null } | null;
    output_tokens?: number | null;
  } | null | undefined,
  durationMs: number
): ManagerModelUsage {
  const inputTokens = value?.input_tokens ?? 0;
  const cachedInputTokens = Math.min(inputTokens, value?.input_tokens_details?.cached_tokens ?? 0);
  const outputTokens = value?.output_tokens ?? 0;
  const pricing = isSupportedSiteAgentModel(modelId) ? siteAgentModelPricing[modelId] : undefined;
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    estimatedCostUsd: pricing
      ? (
          uncachedInputTokens * pricing.inputUsdPerMillion
          + cachedInputTokens * pricing.cachedInputUsdPerMillion
          + outputTokens * pricing.outputUsdPerMillion
        ) / 1_000_000
      : 0,
    costEstimateStatus: pricing ? "configured" : "unavailable",
    durationMs
  };
}

export function maximumRunCostUsd(modelId: string, limits: ManagerRunLimits) {
  const pricing = isSupportedSiteAgentModel(modelId) ? siteAgentModelPricing[modelId] : undefined;
  return pricing
    ? (limits.maxInputTokens * pricing.inputUsdPerMillion + limits.maxOutputTokens * pricing.outputUsdPerMillion) / 1_000_000
    : undefined;
}
