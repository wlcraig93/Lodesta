import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");

const endpoint = "https://openrouter.ai/api/v1/responses";
const model = "anthropic/claude-opus-5";
const upstream = "amazon-bedrock";
const aggregateCostCeilingUsd = 0.25;
const sessionId = `lodesta-openrouter-parameter-isolation-${randomUUID()}`;
const shortPrefix = Array.from({ length: 48 }, (_, index) => `probe-${index} alpha beta`).join("\n");

type Stage = {
  key: string;
  adds: string[];
  tools: boolean;
  toolChoiceRequired: boolean;
  strictTools: boolean;
  anthropicStrictHeader: boolean;
  reasoning: boolean;
  cacheAndAffinity: boolean;
  store: boolean;
  parallelToolCalls: boolean;
};

const stages: Stage[] = [
  {
    key: "route_only",
    adds: ["provider.only", "provider.allow_fallbacks", "provider.data_collection", "provider.zdr", "provider.require_parameters"],
    tools: false,
    toolChoiceRequired: false,
    strictTools: false,
    anthropicStrictHeader: false,
    reasoning: false,
    cacheAndAffinity: false,
    store: false,
    parallelToolCalls: false
  },
  {
    key: "tools_available",
    adds: ["tools"],
    tools: true,
    toolChoiceRequired: false,
    strictTools: false,
    anthropicStrictHeader: false,
    reasoning: false,
    cacheAndAffinity: false,
    store: false,
    parallelToolCalls: false
  },
  {
    key: "required_tools",
    adds: ["tool_choice.required"],
    tools: true,
    toolChoiceRequired: true,
    strictTools: false,
    anthropicStrictHeader: false,
    reasoning: false,
    cacheAndAffinity: false,
    store: false,
    parallelToolCalls: false
  },
  {
    key: "strict_tools",
    adds: ["tools.strict", "x-anthropic-beta"],
    tools: true,
    toolChoiceRequired: true,
    strictTools: true,
    anthropicStrictHeader: true,
    reasoning: false,
    cacheAndAffinity: false,
    store: false,
    parallelToolCalls: false
  },
  {
    key: "reasoning",
    adds: ["reasoning.effort.high"],
    tools: true,
    toolChoiceRequired: true,
    strictTools: true,
    anthropicStrictHeader: true,
    reasoning: true,
    cacheAndAffinity: false,
    store: false,
    parallelToolCalls: false
  },
  {
    key: "cache_affinity",
    adds: ["prompt_cache_breakpoint", "session_id"],
    tools: true,
    toolChoiceRequired: true,
    strictTools: true,
    anthropicStrictHeader: true,
    reasoning: true,
    cacheAndAffinity: true,
    store: false,
    parallelToolCalls: false
  },
  {
    key: "stateless",
    adds: ["store.false"],
    tools: true,
    toolChoiceRequired: true,
    strictTools: true,
    anthropicStrictHeader: true,
    reasoning: true,
    cacheAndAffinity: true,
    store: true,
    parallelToolCalls: false
  },
  {
    key: "serial_tools",
    adds: ["parallel_tool_calls.false"],
    tools: true,
    toolChoiceRequired: true,
    strictTools: true,
    anthropicStrictHeader: true,
    reasoning: true,
    cacheAndAffinity: true,
    store: true,
    parallelToolCalls: true
  }
];

const results: Array<Record<string, unknown>> = [];
let aggregateCostUsd = 0;
let firstRejectedControl: string[] | undefined;

for (const stage of stages) {
  if (aggregateCostUsd >= aggregateCostCeilingUsd) {
    throw new Error(`openrouter_parameter_probe_cost_ceiling_exhausted:${aggregateCostUsd.toFixed(6)}`);
  }
  const request = requestFor(stage);
  const requestJson = JSON.stringify(request);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://lodesta.com",
      "X-OpenRouter-Title": "Lodesta",
      "X-OpenRouter-Metadata": "enabled",
      ...(stage.anthropicStrictHeader
        ? { "x-anthropic-beta": "structured-outputs-2025-11-13" }
        : {})
    },
    body: requestJson
  });
  const payload = parseJson(await response.text());
  const record = asRecord(payload);
  const usage = asRecord(record?.usage);
  const costUsd = optionalNonNegativeNumber(usage?.cost);
  aggregateCostUsd += costUsd;

  const result = {
    stage: stage.key,
    addedControls: stage.adds,
    accepted: response.ok,
    status: response.status,
    requestHash: sha256(requestJson),
    requestBytes: Buffer.byteLength(requestJson),
    requestIdentity: typeof record?.id === "string" ? record.id : undefined,
    selectedUpstream: selectedUpstreamProvider(record?.openrouter_metadata),
    inputTokens: optionalNonNegativeNumber(usage?.input_tokens),
    cachedInputTokens: optionalNonNegativeNumber(asRecord(usage?.input_tokens_details)?.cached_tokens),
    cacheWriteTokens: optionalNonNegativeNumber(asRecord(usage?.input_tokens_details)?.cache_write_tokens),
    outputTokens: optionalNonNegativeNumber(usage?.output_tokens),
    costUsd,
    latencyMs: Date.now() - startedAt,
    toolCallValid: stage.toolChoiceRequired && response.ok ? validProbeToolCall(record?.output) : undefined,
    errorCode: response.ok ? undefined : asRecord(record?.error)?.code,
    errorMessage: response.ok ? undefined : boundedString(asRecord(record?.error)?.message)
  };
  results.push(result);

  if (aggregateCostUsd > aggregateCostCeilingUsd) {
    throw new Error(
      `openrouter_parameter_probe_cost_ceiling_exhausted:${aggregateCostUsd.toFixed(6)}:${aggregateCostCeilingUsd.toFixed(2)}`
    );
  }
  if (!response.ok) {
    firstRejectedControl = stage.adds;
    break;
  }
  if (stage.toolChoiceRequired && !result.toolCallValid) {
    firstRejectedControl = stage.adds;
    break;
  }
}

const createdAt = new Date().toISOString();
const report = {
  schemaVersion: 1,
  kind: "openrouter-authoring-parameter-isolation",
  createdAt,
  model,
  pinnedUpstream: upstream,
  aggregateCostCeilingUsd,
  aggregateCostUsd,
  firstRejectedControl,
  results
};
const reportDirectory = join(process.cwd(), ".data", "openrouter-authoring-probes");
await mkdir(reportDirectory, { recursive: true });
const reportPath = join(reportDirectory, `${createdAt.replaceAll(":", "-")}-parameter-isolation.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({
  ok: !firstRejectedControl,
  reportPath,
  aggregateCostUsd,
  firstRejectedControl,
  stages: results.map((result) => ({
    stage: result.stage,
    accepted: result.accepted,
    status: result.status,
    selectedUpstream: result.selectedUpstream,
    costUsd: result.costUsd,
    errorCode: result.errorCode
  }))
}, null, 2));
if (firstRejectedControl) process.exitCode = 2;

function requestFor(stage: Stage) {
  const content = [{
    type: "input_text",
    text: stage.tools ? `${shortPrefix}\nCall record_contract_probe now.` : `${shortPrefix}\nReply with OK.`,
    ...(stage.cacheAndAffinity ? { prompt_cache_breakpoint: { mode: "explicit" } } : {})
  }];
  return {
    model,
    input: [{ type: "message", role: "user", content }],
    ...(stage.tools
      ? {
          tools: [{
            type: "function",
            name: "record_contract_probe",
            description: "Record the exact transport-contract probe result.",
            strict: stage.strictTools,
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["result"],
              properties: {
                result: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "count"],
                  properties: {
                    label: { type: "string", enum: ["openrouter-contract"] },
                    count: { type: "integer", minimum: 1, maximum: 1 }
                  }
                }
              }
            }
          }],
          ...(stage.toolChoiceRequired ? { tool_choice: "required" } : {})
        }
      : {}),
    ...(stage.reasoning ? { reasoning: { effort: "high" } } : {}),
    ...(stage.cacheAndAffinity ? { session_id: sessionId } : {}),
    ...(stage.store ? { store: false } : {}),
    ...(stage.parallelToolCalls ? { parallel_tool_calls: false } : {}),
    max_output_tokens: stage.tools ? 256 : 32,
    provider: {
      only: [upstream],
      allow_fallbacks: false,
      data_collection: "deny",
      zdr: true,
      require_parameters: true
    }
  };
}

function validProbeToolCall(value: unknown) {
  if (!Array.isArray(value)) return false;
  const call = value.map(asRecord).find((item) => item?.type === "function_call");
  if (!call || call.name !== "record_contract_probe" || typeof call.arguments !== "string") return false;
  const args = asRecord(parseJson(call.arguments));
  const result = asRecord(args?.result);
  return result?.label === "openrouter-contract" && result.count === 1;
}

function selectedUpstreamProvider(value: unknown) {
  const metadata = asRecord(value);
  const endpoints = asRecord(metadata?.endpoints);
  const available = Array.isArray(endpoints?.available) ? endpoints.available : [];
  const selected = available.map(asRecord).find((item) => item?.selected === true);
  return typeof selected?.provider === "string" ? selected.provider : undefined;
}

function optionalNonNegativeNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { error: { code: "invalid_json", message: value.slice(0, 200) } };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function boundedString(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.length > 400 ? `${value.slice(0, 380)}...` : value;
}
