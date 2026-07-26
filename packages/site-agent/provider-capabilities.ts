import type { SiteAgentApiProvider } from "@/packages/site-contracts";
import { sha256, stableJson } from "@/packages/business-data";
import { SiteAuthoringTerminalError } from "./failures";

type CapabilityEvidence =
  | { mechanism: "request_parameter"; detail: string }
  | { mechanism: "documented_provider_guarantee"; detail: string }
  | { mechanism: "runtime_usage_validation"; detail: string };

export type ProviderAuthoringCapabilities = {
  schemaVersion: 1;
  kind: "provider-authoring-capabilities";
  descriptorIdentity: `sha256:${string}`;
  apiProvider: SiteAgentApiProvider;
  modelId: string;
  serialToolExecution: CapabilityEvidence;
  statelessRequests: CapabilityEvidence;
  strictToolSchemas: CapabilityEvidence;
  costTelemetry: CapabilityEvidence;
  cacheTelemetry: CapabilityEvidence;
  reasoningControls: CapabilityEvidence;
  requestFields: Record<string, "accepted" | "stripped" | "translated">;
};

export type ProviderCapabilityCheck = {
  schemaVersion: 1;
  kind: "provider-capability-check";
  descriptorIdentity: `sha256:${string}`;
  apiProvider: SiteAgentApiProvider;
  modelId: string;
  status: "established";
  checkedAt: string;
};

const checks = new Map<string, ProviderCapabilityCheck>();

export function providerAuthoringCapabilities(
  apiProvider: SiteAgentApiProvider,
  modelId: string
): ProviderAuthoringCapabilities {
  const behavior: Omit<
    ProviderAuthoringCapabilities,
    "schemaVersion" | "kind" | "descriptorIdentity" | "apiProvider" | "modelId"
  > = apiProvider === "openai"
    ? {
        serialToolExecution: { mechanism: "request_parameter" as const, detail: "parallel_tool_calls=false" },
        statelessRequests: { mechanism: "request_parameter" as const, detail: "store=false with explicit replay" },
        strictToolSchemas: { mechanism: "request_parameter" as const, detail: "strict=true on every function tool" },
        costTelemetry: { mechanism: "runtime_usage_validation" as const, detail: "provider usage or catalog estimate; unavailable is terminal" },
        cacheTelemetry: { mechanism: "runtime_usage_validation" as const, detail: "input_tokens_details.cached_tokens" },
        reasoningControls: { mechanism: "request_parameter" as const, detail: "reasoning.effort" },
        requestFields: {
          include: "accepted" as const,
          parallel_tool_calls: "accepted" as const,
          store: "accepted" as const,
          text: "accepted" as const,
          reasoning: "accepted" as const
        }
      }
    : {
        serialToolExecution: {
          mechanism: "request_parameter" as const,
          detail: "parallel_tool_calls=false is supported by the OpenRouter Responses API"
        },
        statelessRequests: {
          mechanism: "documented_provider_guarantee" as const,
          detail: "OpenRouter Responses requests are stateless; store=false is also sent"
        },
        strictToolSchemas: {
          mechanism: "request_parameter" as const,
          detail: "strict=true tool schemas are sent through the Responses-compatible endpoint"
        },
        costTelemetry: {
          mechanism: "runtime_usage_validation" as const,
          detail: "cost_details or catalog estimate; unavailable is terminal"
        },
        cacheTelemetry: {
          mechanism: "runtime_usage_validation" as const,
          detail: "usage.input_tokens_details.cached_tokens when the routed provider reports it"
        },
        reasoningControls: {
          mechanism: "request_parameter" as const,
          detail: "portable reasoning.effort"
        },
        requestFields: {
          include: "stripped" as const,
          parallel_tool_calls: "accepted" as const,
          store: "accepted" as const,
          text: "accepted" as const,
          reasoning: "accepted" as const,
          provider: "translated" as const,
          session_id: "translated" as const
        }
      };
  const descriptorIdentity = sha256(stableJson({
    schemaVersion: 1,
    apiProvider,
    modelId,
    ...behavior
  }));
  return {
    schemaVersion: 1,
    kind: "provider-authoring-capabilities",
    descriptorIdentity,
    apiProvider,
    modelId,
    ...behavior
  };
}

export function establishProviderAuthoringCapabilities(
  apiProvider: SiteAgentApiProvider,
  modelId: string
) {
  const descriptor = providerAuthoringCapabilities(apiProvider, modelId);
  const key = `${apiProvider}:${modelId}:${descriptor.descriptorIdentity}`;
  let check = checks.get(key);
  if (!check) {
    check = {
      schemaVersion: 1,
      kind: "provider-capability-check",
      descriptorIdentity: descriptor.descriptorIdentity,
      apiProvider,
      modelId,
      status: "established",
      checkedAt: new Date().toISOString()
    };
    checks.set(key, check);
  }
  if (!descriptor.serialToolExecution || !descriptor.statelessRequests || !descriptor.strictToolSchemas || !descriptor.costTelemetry) {
    throw new SiteAuthoringTerminalError(
      "unknown_internal_failure",
      "platform",
      false,
      `provider_authoring_capabilities_unestablished:${apiProvider}:${modelId}`
    );
  }
  return { descriptor, check };
}
