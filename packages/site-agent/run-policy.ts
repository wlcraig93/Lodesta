import type { ManagerModelUsage, ManagerRunGuardrails } from "./contracts";
import { SiteAuthoringTerminalError } from "./failures";

// Standard direct-OpenAI rates, checked September 5, 2026:
// https://developers.openai.com/api/docs/pricing
// Retained usage is historical evidence; never recompute stored run costs.
export const siteAgentModelPricing = {
  "gpt-6-astra": {
    inputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 1,
    outputUsdPerMillion: 50
  },
  "gpt-5.6-sol": {
    inputUsdPerMillion: 4,
    cachedInputUsdPerMillion: 0.4,
    outputUsdPerMillion: 20
  },
  "gpt-5.6-terra": {
    inputUsdPerMillion: 2,
    cachedInputUsdPerMillion: 0.2,
    outputUsdPerMillion: 12
  },
  "gpt-5.6-luna": {
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    outputUsdPerMillion: 1.2
  },
  "gpt-5.5": {
    inputUsdPerMillion: 5,
    cachedInputUsdPerMillion: 0.5,
    outputUsdPerMillion: 30
  }
} as const;

export type SupportedSiteAgentModel = keyof typeof siteAgentModelPricing;

export const siteAgentReasoningEffort = "high" as const;
export const siteAgentReasoningContext = "all_turns" as const;
export const siteAgentTextVerbosity = "low" as const;
export const siteAgentCompactionThresholdTokens = 200_000;

export const siteAgentRunGuardrailDefaults = {
  initial_build: {
    deadlineMs: 60 * 60_000,
    maxCostUsd: 15,
    maxConsecutiveIdenticalFailures: 3
  },
  edit: {
    deadlineMs: 25 * 60_000,
    maxCostUsd: 8,
    maxConsecutiveIdenticalFailures: 3
  },
  rebase: {
    deadlineMs: 25 * 60_000,
    maxCostUsd: 8,
    maxConsecutiveIdenticalFailures: 3
  }
} as const;

export function isSupportedSiteAgentModel(modelId: string): modelId is SupportedSiteAgentModel {
  return Object.hasOwn(siteAgentModelPricing, modelId);
}

export function managerGuardrailsForKind(kind: "initial_build" | "edit" | "rebase"): ManagerRunGuardrails {
  const defaults = siteAgentRunGuardrailDefaults[kind];
  return {
    maxCostUsd: configuredMaximumCost(defaults.maxCostUsd),
    maxConsecutiveIdenticalFailures: defaults.maxConsecutiveIdenticalFailures
  };
}

export function siteAgentRunGuardrailsForKind(kind: "initial_build" | "edit" | "rebase", startedAt: string) {
  const defaults = siteAgentRunGuardrailDefaults[kind];
  return {
    deadlineAt: new Date(Date.parse(startedAt) + defaults.deadlineMs).toISOString(),
    maxCostUsd: configuredMaximumCost(defaults.maxCostUsd),
    maxConsecutiveIdenticalFailures: defaults.maxConsecutiveIdenticalFailures
  };
}

function configuredMaximumCost(defaultMaximum: number) {
  const configured = Number.parseFloat(process.env.LODESTA_SITE_AGENT_MAX_COST_USD?.trim() ?? "");
  return Number.isFinite(configured) && configured > 0
    ? Math.min(defaultMaximum, configured)
    : defaultMaximum;
}

export function managerGuardrailsAfterPriorUsage(
  guardrails: ManagerRunGuardrails,
  usage: Pick<ManagerModelUsage, "inputTokens" | "outputTokens" | "costUsd" | "costSource">
): ManagerRunGuardrails {
  const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0;
  if (hasUsage && usage.costSource === "unavailable") {
    throw new SiteAuthoringTerminalError("cost_telemetry_unavailable", "platform", false, "research_cost_telemetry_unavailable");
  }
  if (usage.costUsd >= guardrails.maxCostUsd) {
    throw new SiteAuthoringTerminalError(
      "cost_limit_exhausted",
      "budget",
      false,
      `research_exhausted_run_cost_limit:${usage.costUsd.toFixed(6)}:${guardrails.maxCostUsd.toFixed(6)}`
    );
  }
  return {
    maxCostUsd: guardrails.maxCostUsd - usage.costUsd,
    maxConsecutiveIdenticalFailures: guardrails.maxConsecutiveIdenticalFailures
  };
}

export function usageForModel(
  modelId: string,
  value: {
    input_tokens?: number | null;
    input_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null;
    output_tokens?: number | null;
    output_tokens_details?: { reasoning_tokens?: number | null } | null;
    cost?: number | null;
    cost_details?: { upstream_inference_cost?: number | null } | null;
  } | null | undefined,
  durationMs: number
): ManagerModelUsage {
  const inputTokens = value?.input_tokens ?? 0;
  const cachedInputTokens = Math.min(inputTokens, value?.input_tokens_details?.cached_tokens ?? 0);
  const cacheWriteTokens = Math.min(
    inputTokens - cachedInputTokens,
    Math.max(0, value?.input_tokens_details?.cache_write_tokens ?? 0)
  );
  const reasoningTokens = Math.min(value?.output_tokens ?? 0, value?.output_tokens_details?.reasoning_tokens ?? 0);
  const outputTokens = value?.output_tokens ?? 0;
  const pricing = modelPricing(modelId);
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  // The long-context rate applies to the whole request, including cache hits,
  // once total prompt input (not uncached input) exceeds 272K tokens.
  const inputRateMultiplier = inputTokens > 272_000 ? 2 : 1;
  const outputRateMultiplier = inputTokens > 272_000 ? 1.5 : 1;
  const catalogEstimateUsd = pricing
    ? (
        (uncachedInputTokens * pricing.inputUsdPerMillion
          + cacheWriteTokens * pricing.inputUsdPerMillion * 0.25
          + cachedInputTokens * pricing.cachedInputUsdPerMillion) * inputRateMultiplier
        + outputTokens * pricing.outputUsdPerMillion * outputRateMultiplier
      ) / 1_000_000
    : undefined;
  const providerCostUsd = nonnegativeFinite(value?.cost);
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    reasoningTokens,
    outputTokens,
    costUsd: providerCostUsd ?? catalogEstimateUsd ?? 0,
    costSource: providerCostUsd !== undefined ? "provider_reported" : catalogEstimateUsd !== undefined ? "catalog_estimate" : "unavailable",
    upstreamInferenceCostUsd: nonnegativeFinite(value?.cost_details?.upstream_inference_cost) ?? 0,
    durationMs
  };
}

function modelPricing(modelId: string) {
  if (isSupportedSiteAgentModel(modelId)) return siteAgentModelPricing[modelId];
  const unqualified = modelId.startsWith("openai/") ? modelId.slice("openai/".length) : "";
  return unqualified && isSupportedSiteAgentModel(unqualified) ? siteAgentModelPricing[unqualified] : undefined;
}

function nonnegativeFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
