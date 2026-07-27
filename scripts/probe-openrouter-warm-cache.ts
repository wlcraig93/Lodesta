import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createSiteAuthoringBrief,
  anthropicMessagesRequest,
  anthropicMessagesResponse,
  managerBuildContext,
  managerToolArguments,
  managerToolNameSchema,
  openRouterRequestHeaders,
  projectToolsForProvider,
  providerAuthoringCapabilities,
  siteAgentReasoningEffort,
  siteAgentTextVerbosity,
  websiteManagerSystemPrompt,
  websiteManagerTools
} from "../packages/site-agent";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";
import { createMediaContactSheet } from "../packages/site-verification";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");

const responsesEndpoint = "https://openrouter.ai/api/v1/responses";
const anthropicMessagesEndpoint = "https://openrouter.ai/api/v1/messages";
const aggregateHardMaximumUsd = 3;
const reportDirectory = join(process.cwd(), ".data", "openrouter-authoring-probes");
const selected = await retainedPrimeInput();
const snapshots = (await Promise.all(
  selected.buildInput.sourceSnapshotIds.map((id) => sitePlatformRepository.getSourceSnapshot(id))
)).filter((value): value is NonNullable<typeof value> => Boolean(value));
const brief = createSiteAuthoringBrief({ buildInput: selected.buildInput, snapshots });
const mediaBytes = await retainedMediaSheet(selected.buildInput);
if (!mediaBytes) throw new Error("openrouter_warm_probe_requires_retained_prime_media");

const stableText = JSON.stringify(managerBuildContext({
  authoringBrief: brief,
  instruction: "Transport validation only. Call list_files exactly once on every turn. Do not author, mutate, build, inspect, or finish.",
  kind: "initial_build"
}));
const mediaDataUrl = `data:image/png;base64,${mediaBytes.toString("base64")}`;
const routes = [
  {
    key: "opus" as const,
    model: "anthropic/claude-opus-5",
    contextWindowTokens: 1_000_000,
    upstream: "amazon-bedrock",
    providerPattern: /amazon|bedrock/i,
    explicitCache: true,
    minimumContinuity: 0.9
  },
  {
    key: "kimi" as const,
    model: "moonshotai/kimi-k3",
    contextWindowTokens: 1_048_576,
    upstream: "moonshotai",
    providerPattern: /moonshot/i,
    explicitCache: false,
    minimumContinuity: 0.8
  }
];

let aggregateCostUsd = 0;
const routeReports: Array<Record<string, unknown>> = [];

for (const route of routes) {
  const capabilities = providerAuthoringCapabilities("openrouter", route.model, route.contextWindowTokens);
  let noImageControl: Awaited<ReturnType<typeof makeRequest>> | undefined;
  if (route.key === "opus") {
    noImageControl = await makeRequest({
      route,
      capabilities,
      input: stablePrefix(false, false),
      sessionId: `lodesta-opus-image-control-${randomUUID()}`,
      label: "no_image_control"
    });
    aggregateCostUsd += noImageControl.costUsd;
    assertAggregateFuse();
  }

  const retainedTail: unknown[] = [];
  const requests: Array<Awaited<ReturnType<typeof makeRequest>> & {
    stablePrefixHash: string;
    stablePrefixBytes: number;
    retainedTailHash: string;
    retainedTailBytes: number;
    projectionPreservedRetainedHistory: boolean;
    continuityCoverage?: number;
  }> = [];
  const prefix = stablePrefix(true, route.explicitCache);
  const stablePrefixJson = JSON.stringify(prefix);
  const stablePrefixHash = sha256(stablePrefixJson);
  let routeCostUsd = noImageControl?.costUsd ?? 0;
  let routeCeilingUsd: number | undefined;

  for (let index = 1; index <= 4; index += 1) {
    const runtimeState = {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `Current deterministic workspace state:\n${JSON.stringify({
          schemaVersion: 1,
          probe: true,
          requestIndex: index,
          workspace: { files: [], hash: sha256("empty-probe-workspace") }
        })}`
      }]
    };
    retainedTail.push(runtimeState);
    const beforeProjection = JSON.stringify(retainedTail);
    const projectedTail = route.explicitCache
      ? withRollingBreakpoint(retainedTail)
      : [...retainedTail];
    const afterProjection = JSON.stringify(retainedTail);
    const request = await makeRequest({
      route,
      capabilities,
      input: [...prefix, ...projectedTail],
      sessionId: `lodesta-openrouter-warm-${route.key}-${selected.run.id}`,
      label: `warm_${index}`
    });
    aggregateCostUsd += request.costUsd;
    routeCostUsd += request.costUsd;
    if (index === 1) {
      routeCeilingUsd = Math.max(1, 1.5 * request.costUsd * 4);
    }
    assertAggregateFuse();
    if (routeCeilingUsd !== undefined && routeCostUsd > routeCeilingUsd) {
      throw new Error(`openrouter_warm_probe_route_fuse_exhausted:${route.key}:${routeCostUsd.toFixed(6)}:${routeCeilingUsd.toFixed(6)}`);
    }
    const previous = requests.at(-1);
    requests.push({
      ...request,
      stablePrefixHash,
      stablePrefixBytes: Buffer.byteLength(stablePrefixJson),
      retainedTailHash: sha256(beforeProjection),
      retainedTailBytes: Buffer.byteLength(beforeProjection),
      projectionPreservedRetainedHistory: beforeProjection === afterProjection,
      continuityCoverage: previous && previous.inputTokens > 0
        ? request.cachedInputTokens / previous.inputTokens
        : undefined
    });
    retainedTail.push(...request.output);
    for (const call of request.calls) {
      retainedTail.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify({
          ok: true,
          probe: true,
          files: [],
          workspaceHash: sha256("empty-probe-workspace")
        })
      });
    }
  }

  const continuity = requests.slice(1).map((request) => request.continuityCoverage ?? 0);
  const imageTokenContribution = route.key === "opus" && noImageControl
    ? Math.max(0, requests[0]!.inputTokens - noImageControl.inputTokens)
    : undefined;
  const cachedImageTokens = imageTokenContribution !== undefined && noImageControl
    ? Math.max(0, requests[1]!.cachedInputTokens - noImageControl.inputTokens)
    : undefined;
  const imageCacheCoverage = imageTokenContribution && cachedImageTokens !== undefined
    ? cachedImageTokens / imageTokenContribution
    : undefined;
  const routeAccepted = route.key === "opus"
    ? (
        requests[0]!.cacheWriteTokens > 0
        && continuity.every((coverage) => coverage >= route.minimumContinuity)
        && (imageCacheCoverage ?? 0) >= 0.9
      )
    : (
        (requests[2]!.continuityCoverage ?? 0) >= route.minimumContinuity
        && (requests[3]!.continuityCoverage ?? 0) >= route.minimumContinuity
      );
  const invariantsPass = requests.every((request) =>
    request.projectionPreservedRetainedHistory
    && request.inputTokens / route.contextWindowTokens < 0.2
    && request.selectedUpstream !== undefined
    && route.providerPattern.test(request.selectedUpstream)
  ) && new Set(requests.map((request) => request.stablePrefixHash)).size === 1;

  routeReports.push({
    key: route.key,
    requestedModel: route.model,
    pinnedUpstream: route.upstream,
    descriptorIdentity: capabilities.descriptorIdentity,
    probeIdentity: capabilities.probeIdentity,
    routeCeilingUsd,
    routeCostUsd,
    accepted: routeAccepted && invariantsPass,
    continuity,
    imageTokenContribution,
    cachedImageTokens,
    imageCacheCoverage,
    noImageControl: noImageControl ? metricProjection(noImageControl) : undefined,
    requests: requests.map(metricProjection)
  });
}

const accepted = routeReports.every((route) => route.accepted === true);
const createdAt = new Date().toISOString();
const report = {
  schemaVersion: 1,
  kind: "openrouter-authoring-warm-cache-probe",
  createdAt,
  sourceRunId: selected.run.id,
  publicBuildInputId: selected.buildInput.id,
  publicBuildInputHash: selected.buildInput.inputHash,
  media: {
    bytes: mediaBytes.length,
    assets: selected.buildInput.business.assets.length,
    detail: "high"
  },
  aggregateHardMaximumUsd,
  aggregateCostUsd,
  accepted,
  routes: routeReports
};
await mkdir(reportDirectory, { recursive: true });
const reportPath = join(reportDirectory, `${createdAt.replaceAll(":", "-")}-warm-cache.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({
  ok: accepted,
  reportPath,
  aggregateCostUsd,
  routes: routeReports.map((route) => ({
    key: route.key,
    accepted: route.accepted,
    routeCostUsd: route.routeCostUsd,
    continuity: route.continuity,
    imageCacheCoverage: route.imageCacheCoverage
  }))
}, null, 2));
if (!accepted) process.exitCode = 2;

function stablePrefix(withMedia: boolean, explicitCache: boolean) {
  const textBlock = {
    type: "input_text",
    text: stableText,
    ...(!withMedia && explicitCache ? { prompt_cache_breakpoint: { mode: "explicit" } } : {})
  };
  return [{
    type: "message",
    role: "user",
    content: [
      textBlock,
      ...(withMedia
        ? [{
            type: "input_image",
            image_url: mediaDataUrl,
            detail: "high",
            ...(explicitCache ? { prompt_cache_breakpoint: { mode: "explicit" } } : {})
          }]
        : [])
    ]
  }];
}

function withRollingBreakpoint(items: unknown[]) {
  const last = asRecord(items.at(-1));
  if (!last || last.type !== "message" || !Array.isArray(last.content)) return [...items];
  const content = last.content.map((value, index, values) => {
    const block = asRecord(value);
    if (!block || block.type !== "input_text" || index !== values.length - 1) return value;
    return { ...block, prompt_cache_breakpoint: { mode: "explicit" } };
  });
  return [...items.slice(0, -1), { ...last, content }];
}

async function makeRequest(input: {
  route: typeof routes[number];
  capabilities: ReturnType<typeof providerAuthoringCapabilities>;
  input: unknown[];
  sessionId: string;
  label: string;
}) {
  const request = {
    model: input.route.model,
    instructions: websiteManagerSystemPrompt,
    input: input.input,
    tools: projectToolsForProvider(websiteManagerTools, input.capabilities),
    tool_choice: "required",
    parallel_tool_calls: false,
    store: false,
    reasoning: { effort: siteAgentReasoningEffort },
    text: { verbosity: siteAgentTextVerbosity },
    max_output_tokens: 4_096,
    provider: {
      only: [input.route.upstream],
      allow_fallbacks: false,
      data_collection: "deny",
      zdr: true
    },
    session_id: input.sessionId
  };
  const wireRequest = input.route.key === "opus"
    ? anthropicMessagesRequest(request as never)
    : request;
  const wireRequestJson = JSON.stringify(wireRequest);
  const startedAt = Date.now();
  const response = await fetch(
    input.route.key === "opus" ? anthropicMessagesEndpoint : responsesEndpoint,
    {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...openRouterRequestHeaders(input.capabilities, process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://lodesta.com")
    },
    body: wireRequestJson
  });
  const payload = parseJson(await response.text());
  const record = asRecord(payload);
  if (!response.ok) {
    throw new Error(
      `openrouter_warm_probe_rejected:${input.route.key}:${input.label}:${response.status}:${providerErrorSummary(record?.error)}`
    );
  }
  const normalized = input.route.key === "opus"
    ? anthropicMessagesResponse(payload)
    : record;
  const usage = asRecord(normalized?.usage);
  const inputDetails = asRecord(usage?.input_tokens_details);
  const costUsd = requiredPositiveNumber(usage?.cost, `${input.route.key}:${input.label}:cost`);
  const calls = strictToolCalls(normalized?.output, `${input.route.key}:${input.label}`);
  const selectedUpstream = selectedUpstreamProvider(record?.openrouter_metadata);
  if (!selectedUpstream || !input.route.providerPattern.test(selectedUpstream)) {
    throw new Error(`openrouter_warm_probe_upstream_mismatch:${input.route.key}:${selectedUpstream ?? "missing"}`);
  }
  return {
    label: input.label,
    requestHash: sha256(wireRequestJson),
    requestBytes: Buffer.byteLength(wireRequestJson),
    requestIdentity: typeof normalized?.id === "string" ? normalized.id : undefined,
    servedModel: typeof normalized?.model === "string" ? normalized.model : undefined,
    selectedUpstream,
    inputTokens: requiredNonNegativeNumber(usage?.input_tokens, `${input.route.key}:${input.label}:input_tokens`),
    cachedInputTokens: optionalNonNegativeNumber(inputDetails?.cached_tokens),
    cacheWriteTokens: optionalNonNegativeNumber(inputDetails?.cache_write_tokens),
    reasoningTokens: optionalNonNegativeNumber(asRecord(usage?.output_tokens_details)?.reasoning_tokens),
    outputTokens: requiredNonNegativeNumber(usage?.output_tokens, `${input.route.key}:${input.label}:output_tokens`),
    costUsd,
    latencyMs: Date.now() - startedAt,
    calls,
    output: Array.isArray(normalized?.output) ? normalized.output : []
  };
}

function strictToolCalls(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`openrouter_warm_probe_output_missing:${label}`);
  const calls = value.map(asRecord).filter((item) => item?.type === "function_call");
  if (!calls.length) throw new Error(`openrouter_warm_probe_tool_call_missing:${label}`);
  return calls.map((call) => {
    if (typeof call?.name !== "string" || typeof call.call_id !== "string" || typeof call.arguments !== "string") {
      throw new Error(`openrouter_warm_probe_tool_call_invalid:${label}`);
    }
    const name = managerToolNameSchema.parse(call.name);
    managerToolArguments[name].parse(parseJson(call.arguments));
    return { callId: call.call_id, name, argumentsHash: sha256(call.arguments) };
  });
}

function metricProjection(value: Record<string, unknown>) {
  const {
    output: _output,
    calls,
    ...metrics
  } = value;
  return {
    ...metrics,
    calls: Array.isArray(calls) ? calls : []
  };
}

async function retainedPrimeInput() {
  const explicitRunId = process.env.LODESTA_OPENROUTER_PROBE_RUN_ID?.trim();
  const runs = explicitRunId
    ? [await sitePlatformRepository.getAgentRun(explicitRunId)].filter(
        (value): value is NonNullable<typeof value> => Boolean(value)
      )
    : await sitePlatformRepository.listRecentAgentRuns({ limit: 200 });
  for (const run of runs) {
    const buildInput = await sitePlatformRepository.getPublicBuildInput(run.publicBuildInputId);
    if (
      buildInput
      && /prime plumbing/i.test(buildInput.business.name)
      && buildInput.business.assets.length
    ) {
      return { run, buildInput };
    }
  }
  throw new Error("openrouter_warm_probe_retained_prime_input_not_found");
}

async function retainedMediaSheet(buildInput: Awaited<ReturnType<typeof retainedPrimeInput>>["buildInput"]) {
  const blobStore = configuredArtifactBlobStore();
  const retained = await Promise.all(buildInput.business.assets.map(async (asset) => {
    const blob = await blobStore.get(asset.storageKey).catch(() => undefined);
    if (!blob) return undefined;
    const revision = await sitePlatformRepository.getAssetRevision(asset.revisionId).catch(() => undefined);
    const sourcePageUrl = revision?.provenance.origin === "source_website"
      ? revision.provenance.sourcePageUrl
      : undefined;
    const sourceAssetUrl = revision?.provenance.origin === "source_website"
      ? revision.provenance.sourceUrl
      : undefined;
    return { asset, bytes: blob.bytes, sourcePageUrl, sourceAssetUrl };
  }));
  return createMediaContactSheet(
    retained.filter((value): value is NonNullable<typeof value> => Boolean(value))
  );
}

function selectedUpstreamProvider(value: unknown) {
  const metadata = asRecord(value);
  const endpoints = asRecord(metadata?.endpoints);
  const available = Array.isArray(endpoints?.available) ? endpoints.available : [];
  const selected = available.map(asRecord).find((item) => item?.selected === true);
  return typeof selected?.provider === "string" ? selected.provider : undefined;
}

function requiredPositiveNumber(value: unknown, field: string) {
  const parsed = numeric(value);
  if (parsed === undefined || parsed <= 0) throw new Error(`openrouter_warm_probe_metric_missing:${field}`);
  return parsed;
}

function requiredNonNegativeNumber(value: unknown, field: string) {
  const parsed = numeric(value);
  if (parsed === undefined || parsed < 0) throw new Error(`openrouter_warm_probe_metric_missing:${field}`);
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
    throw new Error(`openrouter_warm_probe_invalid_json:${value.slice(0, 120)}`);
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
  if (typeof value !== "string") return "missing_error";
  return value.length > 300 ? `${value.slice(0, 280)}...` : value;
}

function providerErrorSummary(value: unknown) {
  const error = asRecord(value);
  const metadata = asRecord(error?.metadata);
  return JSON.stringify({
    code: error?.code,
    message: boundedString(error?.message),
    provider: metadata?.provider_name,
    raw: boundedString(metadata?.raw)
  });
}

function assertAggregateFuse() {
  if (aggregateCostUsd > aggregateHardMaximumUsd) {
    throw new Error(`openrouter_warm_probe_aggregate_fuse_exhausted:${aggregateCostUsd.toFixed(6)}:${aggregateHardMaximumUsd.toFixed(2)}`);
  }
}
