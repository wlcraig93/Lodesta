import type { SiteAgentApiProvider } from "@/packages/site-contracts";
import { sha256, stableJson } from "@/packages/business-data";
import { getModelCatalog, type ModelCatalog } from "@/lib/model-catalog";
import { SiteAuthoringTerminalError } from "./failures";
import {
  establishedOpenRouterAuthoringRoutes,
  isEstablishedOpenRouterAuthoringRoute
} from "./provider-routes";

type CapabilityEvidence =
  | { mechanism: "request_parameter"; detail: string }
  | { mechanism: "documented_provider_guarantee"; detail: string }
  | { mechanism: "runtime_usage_validation"; detail: string }
  | { mechanism: "retained_probe"; detail: string }
  | { mechanism: "unsupported"; detail: string };

export type ProviderAuthoringCapabilities = {
  schemaVersion: 1;
  kind: "provider-authoring-capabilities";
  descriptorIdentity: `sha256:${string}`;
  probeIdentity: `sha256:${string}`;
  apiProvider: SiteAgentApiProvider;
  modelId: string;
  routeFamily: "openai" | "openrouter_anthropic" | "openrouter_moonshot";
  transport: "openai_responses" | "openrouter_responses" | "openrouter_anthropic_messages";
  contextWindowTokens: number;
  cacheStrategy:
    | "openai_implicit_explicit"
    | "anthropic_explicit"
    | "moonshot_provider_implicit";
  strictToolStrategy: "responses_strict_tools" | "anthropic_beta_strict_tools";
  eligibleZdrUpstreams: string[];
  serialToolExecution: CapabilityEvidence;
  statelessRequests: CapabilityEvidence;
  strictToolSchemas: CapabilityEvidence;
  costTelemetry: CapabilityEvidence;
  cacheTelemetry: CapabilityEvidence;
  promptCaching: CapabilityEvidence;
  reasoningControls: CapabilityEvidence;
  contextCompaction: CapabilityEvidence;
  requestFields: Record<string, "accepted" | "stripped" | "translated">;
};

export type ProviderCapabilityCheck = {
  schemaVersion: 1;
  kind: "provider-capability-check";
  descriptorIdentity: `sha256:${string}`;
  probeIdentity: `sha256:${string}`;
  apiProvider: SiteAgentApiProvider;
  modelId: string;
  status: "established";
  checkedAt: string;
};

const checks = new Map<string, ProviderCapabilityCheck>();
const openAiContextWindowTokens = {
  "gpt-5.6-sol": 1_050_000,
  "gpt-5.6-terra": 1_050_000,
  "gpt-5.6-luna": 1_050_000,
  "gpt-5.5": 1_050_000
} as const;

export function providerAuthoringCapabilities(
  apiProvider: SiteAgentApiProvider,
  modelId: string,
  contextWindowTokens: number
): ProviderAuthoringCapabilities {
  const declared = declaredCapabilities(apiProvider, modelId, contextWindowTokens);
  const descriptorIdentity = sha256(stableJson({
    schemaVersion: 1,
    kind: "provider-authoring-capabilities",
    ...declared
  }));
  const probeIdentity = sha256(stableJson(probeEvidence(apiProvider, modelId, declared)));
  return {
    schemaVersion: 1,
    kind: "provider-authoring-capabilities",
    descriptorIdentity,
    probeIdentity,
    ...declared
  };
}

export async function establishProviderAuthoringCapabilities(
  apiProvider: SiteAgentApiProvider,
  modelId: string,
  options: {
    loadOpenRouterCatalog?: () => Promise<ModelCatalog>;
    contextWindowTokens?: number;
  } = {}
) {
  if (apiProvider === "openrouter" && !isEstablishedOpenRouterAuthoringRoute(modelId)) {
    throw capabilitiesMissing(apiProvider, modelId);
  }
  const contextWindowTokens = options.contextWindowTokens
    ?? await contextWindowForRoute(apiProvider, modelId, options.loadOpenRouterCatalog);
  const descriptor = providerAuthoringCapabilities(apiProvider, modelId, contextWindowTokens);
  const key = `${apiProvider}:${modelId}:${descriptor.descriptorIdentity}:${descriptor.probeIdentity}`;
  let check = checks.get(key);
  if (!check) {
    check = {
      schemaVersion: 1,
      kind: "provider-capability-check",
      descriptorIdentity: descriptor.descriptorIdentity,
      probeIdentity: descriptor.probeIdentity,
      apiProvider,
      modelId,
      status: "established",
      checkedAt: new Date().toISOString()
    };
    checks.set(key, check);
  }
  return { descriptor, check };
}

function declaredCapabilities(
  apiProvider: SiteAgentApiProvider,
  modelId: string,
  contextWindowTokens: number
): Omit<ProviderAuthoringCapabilities, "schemaVersion" | "kind" | "descriptorIdentity" | "probeIdentity"> {
  if (apiProvider === "openai") {
    if (!Object.hasOwn(openAiContextWindowTokens, modelId)) throw capabilitiesMissing(apiProvider, modelId);
    return {
      apiProvider,
      modelId,
      routeFamily: "openai",
      transport: "openai_responses",
      contextWindowTokens,
      cacheStrategy: "openai_implicit_explicit",
      strictToolStrategy: "responses_strict_tools",
      eligibleZdrUpstreams: [],
      serialToolExecution: { mechanism: "request_parameter", detail: "parallel_tool_calls=false" },
      statelessRequests: { mechanism: "request_parameter", detail: "store=false with explicit replay" },
      strictToolSchemas: { mechanism: "request_parameter", detail: "strict=true on every function tool" },
      costTelemetry: { mechanism: "runtime_usage_validation", detail: "provider usage or catalog estimate; unavailable is terminal" },
      cacheTelemetry: { mechanism: "runtime_usage_validation", detail: "input_tokens_details.cached_tokens" },
      promptCaching: { mechanism: "request_parameter", detail: "prompt_cache_key, implicit 30m mode, and a stable explicit breakpoint" },
      reasoningControls: { mechanism: "request_parameter", detail: "reasoning.effort=high and reasoning.context=all_turns" },
      contextCompaction: {
        mechanism: "request_parameter",
        detail: "context_management compaction with a 200000-token threshold"
      },
      requestFields: {
        context_management: "accepted",
        include: "accepted",
        parallel_tool_calls: "accepted",
        store: "accepted",
        text: "accepted",
        reasoning: "accepted",
        prompt_cache_key: "accepted",
        prompt_cache_options: "accepted",
        prompt_cache_breakpoint: "accepted"
      }
    };
  }

  if (!isEstablishedOpenRouterAuthoringRoute(modelId)) throw capabilitiesMissing(apiProvider, modelId);
  const route = establishedOpenRouterAuthoringRoutes[modelId];
  const anthropic = route.routeFamily === "openrouter_anthropic";
  return {
    apiProvider,
    modelId,
    routeFamily: route.routeFamily,
    transport: anthropic ? "openrouter_anthropic_messages" : "openrouter_responses",
    contextWindowTokens,
    cacheStrategy: anthropic ? "anthropic_explicit" : "moonshot_provider_implicit",
    strictToolStrategy: anthropic ? "anthropic_beta_strict_tools" : "responses_strict_tools",
    eligibleZdrUpstreams: [...route.eligibleZdrUpstreams],
    serialToolExecution: {
      mechanism: "retained_probe",
      detail: "parallel_tool_calls=false is sent; unexpected multiple calls are recovered serially and recorded"
    },
    statelessRequests: {
      mechanism: "request_parameter",
      detail: anthropic
        ? "Anthropic Messages is stateless with explicit append-only replay"
        : "store=false with explicit append-only replay"
    },
    strictToolSchemas: {
      mechanism: "retained_probe",
      detail: anthropic
        ? "strict tools with the Anthropic structured-output beta header"
        : "strict tools accepted by the Moonshot Responses route"
    },
    costTelemetry: {
      mechanism: "runtime_usage_validation",
      detail: "OpenRouter usage.cost is required on every response"
    },
    cacheTelemetry: {
      mechanism: "runtime_usage_validation",
      detail: "OpenRouter input cache reads and writes are retained per response"
    },
    promptCaching: anthropic
      ? {
          mechanism: "retained_probe",
          detail: "Internal prompt_cache_breakpoint markers are translated to native Anthropic Messages cache_control blocks"
        }
      : {
          mechanism: "documented_provider_guarantee",
          detail: "Moonshot automatic prefix caching; no explicit Anthropic controls"
        },
    reasoningControls: {
      mechanism: "request_parameter",
      detail: "reasoning.effort=high"
    },
    contextCompaction: {
      mechanism: "unsupported",
      detail: "OpenAI Responses compaction is not sent through unestablished OpenRouter provider routes"
    },
    requestFields: {
      context_management: "stripped",
      include: "stripped",
      parallel_tool_calls: anthropic ? "translated" : "accepted",
      store: anthropic ? "stripped" : "accepted",
      text: anthropic ? "stripped" : "accepted",
      reasoning: anthropic ? "translated" : "accepted",
      prompt_cache_key: "stripped",
      prompt_cache_options: "stripped",
      prompt_cache_breakpoint: anthropic ? "translated" : "stripped",
      x_anthropic_beta: anthropic ? "accepted" : "stripped",
      provider: "translated",
      provider_require_parameters: "stripped",
      session_id: "translated"
    }
  };
}

function probeEvidence(
  apiProvider: SiteAgentApiProvider,
  modelId: string,
  descriptor: ReturnType<typeof declaredCapabilities>
) {
  if (apiProvider === "openai") {
    return {
      schemaVersion: 1,
      kind: "provider-authoring-probe-evidence",
      route: `${apiProvider}:${modelId}`,
      outcome: "established",
      observedControls: [
        "strict_tools",
        "parallel_tool_calls=false",
        "store=false",
        "encrypted_reasoning",
        "reasoning.context=all_turns",
        "context_management.compaction",
        "prompt_cache_options",
        "prompt_cache_breakpoint"
      ]
    };
  }
  return {
    schemaVersion: 1,
    kind: "provider-authoring-probe-evidence",
    route: `${apiProvider}:${modelId}`,
    routeFamily: descriptor.routeFamily,
    upstreams: descriptor.eligibleZdrUpstreams,
    outcome: modelId === "anthropic/claude-opus-5"
      ? "established_with_anthropic_messages_transport"
      : "established_with_provider_implicit_caching",
    observedControls: modelId === "anthropic/claude-opus-5"
      ? [
          "anthropic_messages_transport",
          "strict_nested_tool",
          "tool_choice=any",
          "disable_parallel_tool_use=true",
          "adaptive_thinking",
          "effort=high",
          "usage.cost",
          "openrouter_metadata",
          "native_cache_control_write_and_read",
          "x-anthropic-beta"
        ]
      : [
          "tools",
          "tool_choice=required",
          "parallel_tool_calls=false",
          "store=false",
          "reasoning=high",
          "usage.cost",
          "openrouter_metadata",
          "provider_implicit_cache"
        ],
    rejectedControls: modelId === "anthropic/claude-opus-5"
      ? [
          "OpenRouter Responses provider.require_parameters with tools",
          "OpenRouter Responses strict tools on Amazon Bedrock",
          "OpenRouter Responses explicit cache breakpoints"
        ]
      : []
  };
}

async function contextWindowForRoute(
  apiProvider: SiteAgentApiProvider,
  modelId: string,
  loadOpenRouterCatalog: (() => Promise<ModelCatalog>) | undefined
) {
  if (apiProvider === "openai") {
    const contextWindowTokens = openAiContextWindowTokens[modelId as keyof typeof openAiContextWindowTokens];
    if (contextWindowTokens) return contextWindowTokens;
  } else if (isEstablishedOpenRouterAuthoringRoute(modelId)) {
    const catalog = await (loadOpenRouterCatalog ?? (() => getModelCatalog("openrouter")))();
    const catalogContext = catalog.models.find((model) => model.id === modelId)?.contextLength;
    return catalogContext ?? establishedOpenRouterAuthoringRoutes[modelId].contextWindowTokens;
  }
  throw capabilitiesMissing(apiProvider, modelId);
}

function capabilitiesMissing(apiProvider: SiteAgentApiProvider, modelId: string) {
  return new SiteAuthoringTerminalError(
    "unknown_internal_failure",
    "platform",
    false,
    `provider_authoring_capabilities_missing:${apiProvider}:${modelId}`
  );
}
