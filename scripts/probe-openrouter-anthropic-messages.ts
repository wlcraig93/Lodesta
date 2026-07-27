import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");

const endpoint = "https://openrouter.ai/api/v1/messages";
const aggregateCostCeilingUsd = 0.25;
const sessionId = `lodesta-openrouter-anthropic-messages-${randomUUID()}`;
const prefix = " cache-contract".repeat(5_000);
const tool = {
  name: "record_contract_probe",
  description: "Record the exact Anthropic Messages transport result.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: {
      result: {
        type: "object",
        additionalProperties: false,
        required: ["label", "count"],
        properties: {
          label: { type: "string", enum: ["openrouter-anthropic-messages"] },
          count: { type: "integer" }
        }
      }
    }
  }
};
const messages: unknown[] = [{
  role: "user",
  content: [{
    type: "text",
    text: `${prefix}\nCall record_contract_probe with label openrouter-anthropic-messages and count 1.`,
    cache_control: { type: "ephemeral" }
  }]
}];

const requests: Array<Record<string, unknown>> = [];
let aggregateCostUsd = 0;

for (let index = 1; index <= 2; index += 1) {
  const request = {
    model: "anthropic/claude-opus-5",
    max_tokens: 4_096,
    system: [{
      type: "text",
      text: "This is a transport probe. Call the required tool immediately and emit no prose."
    }],
    messages,
    tools: [tool],
    tool_choice: { type: "any", disable_parallel_tool_use: true },
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    provider: {
      only: ["amazon-bedrock"],
      allow_fallbacks: false,
      data_collection: "deny",
      zdr: true
    },
    session_id: sessionId
  };
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
      "x-anthropic-beta": "structured-outputs-2025-11-13"
    },
    body: requestJson
  });
  const payload = parseJson(await response.text());
  const record = asRecord(payload);
  if (!response.ok) {
    throw new Error(`openrouter_anthropic_messages_rejected:${response.status}:${providerErrorSummary(record?.error)}`);
  }
  const usage = asRecord(record?.usage);
  const costUsd = requiredPositiveNumber(usage?.cost, `request_${index}:cost`);
  aggregateCostUsd += costUsd;
  if (aggregateCostUsd > aggregateCostCeilingUsd) {
    throw new Error(`openrouter_anthropic_messages_cost_ceiling_exhausted:${aggregateCostUsd.toFixed(6)}`);
  }
  const content = Array.isArray(record?.content) ? record.content : [];
  const call = content.map(asRecord).find((block) => block?.type === "tool_use");
  const callInput = asRecord(call?.input);
  const result = asRecord(callInput?.result);
  if (
    typeof call?.id !== "string"
    || call.name !== "record_contract_probe"
    || result?.label !== "openrouter-anthropic-messages"
    || result.count !== 1
  ) {
    throw new Error(`openrouter_anthropic_messages_tool_invalid:${index}`);
  }
  const selectedUpstream = selectedUpstreamProvider(record?.openrouter_metadata);
  if (!selectedUpstream || !/amazon|bedrock/i.test(selectedUpstream)) {
    throw new Error(`openrouter_anthropic_messages_upstream_mismatch:${selectedUpstream ?? "missing"}`);
  }
  requests.push({
    index,
    requestHash: sha256(requestJson),
    requestBytes: Buffer.byteLength(requestJson),
    requestIdentity: typeof record?.id === "string" ? record.id : undefined,
    selectedUpstream,
    inputTokens: requiredNonNegativeNumber(usage?.input_tokens, `request_${index}:input_tokens`),
    cacheCreationInputTokens: optionalNonNegativeNumber(usage?.cache_creation_input_tokens),
    cacheReadInputTokens: optionalNonNegativeNumber(usage?.cache_read_input_tokens),
    outputTokens: requiredNonNegativeNumber(usage?.output_tokens, `request_${index}:output_tokens`),
    costUsd,
    latencyMs: Date.now() - startedAt,
    toolCall: {
      name: call.name,
      idHash: sha256(call.id),
      inputHash: sha256(JSON.stringify(call.input))
    }
  });
  messages.push(
    { role: "assistant", content },
    {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify({ ok: true, probe: true })
      }, {
        type: "text",
        text: "Call record_contract_probe again with the same arguments.",
        cache_control: { type: "ephemeral" }
      }]
    }
  );
}

const accepted = (requests[0]?.cacheCreationInputTokens as number) > 0
  && (requests[1]?.cacheReadInputTokens as number) >= (requests[0]?.inputTokens as number) * 0.9;
const createdAt = new Date().toISOString();
const report = {
  schemaVersion: 1,
  kind: "openrouter-anthropic-messages-transport-probe",
  createdAt,
  model: "anthropic/claude-opus-5",
  pinnedUpstream: "amazon-bedrock",
  aggregateCostCeilingUsd,
  aggregateCostUsd,
  accepted,
  requests
};
const reportDirectory = join(process.cwd(), ".data", "openrouter-authoring-probes");
await mkdir(reportDirectory, { recursive: true });
const reportPath = join(reportDirectory, `${createdAt.replaceAll(":", "-")}-anthropic-messages.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ok: accepted, reportPath, aggregateCostUsd, requests }, null, 2));
if (!accepted) process.exitCode = 2;

function selectedUpstreamProvider(value: unknown) {
  const metadata = asRecord(value);
  const endpoints = asRecord(metadata?.endpoints);
  const available = Array.isArray(endpoints?.available) ? endpoints.available : [];
  const selected = available.map(asRecord).find((item) => item?.selected === true);
  return typeof selected?.provider === "string" ? selected.provider : undefined;
}

function providerErrorSummary(value: unknown) {
  const error = asRecord(value);
  const metadata = asRecord(error?.metadata);
  return JSON.stringify({
    type: error?.type,
    errorType: error?.error_type,
    message: boundedString(error?.message),
    provider: metadata?.provider_name,
    raw: boundedString(metadata?.raw)
  });
}

function requiredPositiveNumber(value: unknown, field: string) {
  const parsed = numeric(value);
  if (parsed === undefined || parsed <= 0) throw new Error(`openrouter_anthropic_messages_metric_missing:${field}`);
  return parsed;
}

function requiredNonNegativeNumber(value: unknown, field: string) {
  const parsed = numeric(value);
  if (parsed === undefined || parsed < 0) throw new Error(`openrouter_anthropic_messages_metric_missing:${field}`);
  return parsed;
}

function optionalNonNegativeNumber(value: unknown) {
  const parsed = numeric(value);
  return parsed !== undefined && parsed >= 0 ? parsed : 0;
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`openrouter_anthropic_messages_invalid_json:${value.slice(0, 120)}`);
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
