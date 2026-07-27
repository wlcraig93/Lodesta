import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem
} from "openai/resources/responses/responses";
import { sha256, stableJson } from "../packages/business-data";
import {
  createSiteAuthoringBrief,
  managerBuildContext,
  usageForModel,
  websiteManagerSystemPrompt,
  websiteManagerTools
} from "../packages/site-agent";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";
import { createMediaContactSheet } from "../packages/site-verification";

const model = "gpt-5.6-sol";
const aggregateCeilingUsd = 2;
const reportDirectory = join(process.cwd(), ".data", "site-agent-cache-probes");
const explicitRunId = process.env.LODESTA_CACHE_PROBE_RUN_ID?.trim();

type ProbeRequest = {
  index: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  costUsd: number;
  costSource: string;
  stablePrefixBytes: number;
  tailBytes: number;
  requestBytes: number;
  latencyMs: number;
  requestId: string;
  servedModel: string;
};

type ProbeShape = {
  key: "separate_image" | "no_image" | "combined_image";
  requests: ProbeRequest[];
  continuityRate: number;
  totalCostUsd: number;
};

const client = new OpenAI();
const selected = await retainedProbeInput();
const snapshots = (await Promise.all(
  selected.buildInput.sourceSnapshotIds.map((id) => sitePlatformRepository.getSourceSnapshot(id))
)).filter((value): value is NonNullable<typeof value> => Boolean(value));
const brief = createSiteAuthoringBrief({ buildInput: selected.buildInput, snapshots });
const mediaBytes = await retainedMediaSheet(selected.buildInput);
if (!mediaBytes) throw new Error("cache_probe_requires_retained_media");

const text = JSON.stringify(managerBuildContext({
  authoringBrief: brief,
  instruction: "Cache instrumentation only. Call list_files once per request and do not author or mutate source.",
  kind: "initial_build"
}));
const mediaDataUrl = `data:image/png;base64,${mediaBytes.toString("base64")}`;
const cacheKeyBase = sha256(stableJson({
  schemaVersion: 1,
  kind: "site-agent-cache-probe",
  publicBuildInputHash: selected.buildInput.inputHash,
  model
})).slice("sha256:".length);

const shapes: ProbeShape[] = [];
let aggregateCostUsd = 0;

shapes.push(await runShape("separate_image", 4));
shapes.push(await runShape("no_image", 2));

let imageCaching = imageCacheAssessment(shapes);
if (imageCaching.status !== "confirmed") {
  shapes.push(await runShape("combined_image", 4));
  imageCaching = imageCacheAssessment(shapes);
}

const recommendation = chooseShape(shapes, imageCaching.status);
const report = {
  schemaVersion: 1,
  kind: "site-agent-cache-probe-report",
  createdAt: new Date().toISOString(),
  model,
  sourceRunId: selected.run.id,
  publicBuildInputId: selected.buildInput.id,
  publicBuildInputHash: selected.buildInput.inputHash,
  media: {
    bytes: mediaBytes.length,
    assetCount: selected.buildInput.business.assets.length,
    detail: "high"
  },
  aggregateCeilingUsd,
  aggregateCostUsd,
  shapes,
  imageCaching,
  recommendation
};
await mkdir(reportDirectory, { recursive: true });
const reportPath = join(reportDirectory, `${report.createdAt.replaceAll(":", "-")}-${selected.run.id}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2));

async function runShape(key: ProbeShape["key"], requestCount: number): Promise<ProbeShape> {
  const stablePrefix = stablePrefixFor(key);
  const tail: ResponseInputItem[] = [];
  const requests: ProbeRequest[] = [];
  const promptCacheKey = sha256(stableJson({
    cacheKeyBase,
    shape: key
  })).slice("sha256:".length);
  for (let index = 1; index <= requestCount; index += 1) {
    if (aggregateCostUsd >= aggregateCeilingUsd) {
      throw new Error(`cache_probe_cost_ceiling_exhausted:${aggregateCostUsd.toFixed(6)}`);
    }
    const input = [...stablePrefix, ...tail];
    const startedAt = Date.now();
    const response = await client.responses.create({
      model,
      instructions: websiteManagerSystemPrompt,
      input,
      tools: websiteManagerTools,
      tool_choice: "required",
      parallel_tool_calls: false,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: 2_048,
      prompt_cache_key: promptCacheKey,
      prompt_cache_options: { mode: "implicit", ttl: "30m" }
    });
    const durationMs = Date.now() - startedAt;
    const usage = usageForModel(model, response.usage, durationMs);
    aggregateCostUsd += usage.costUsd;
    const request = {
      index,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      reasoningTokens: usage.reasoningTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      costSource: usage.costSource,
      stablePrefixBytes: Buffer.byteLength(stableJson({
        instructions: websiteManagerSystemPrompt,
        tools: websiteManagerTools,
        input: stablePrefix
      })),
      tailBytes: Buffer.byteLength(stableJson(tail)),
      requestBytes: Buffer.byteLength(stableJson({
        instructions: websiteManagerSystemPrompt,
        tools: websiteManagerTools,
        input
      })),
      latencyMs: durationMs,
      requestId: response.id,
      servedModel: response.model
    };
    requests.push(request);
    tail.push(...response.output as ResponseInputItem[]);
    const calls = response.output.filter(
      (item): item is ResponseFunctionToolCall => item.type === "function_call"
    );
    for (const call of calls) {
      tail.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify({
          ok: true,
          probe: true,
          files: [],
          instruction: "Continue the cache probe; call list_files once."
        })
      });
    }
    tail.push({
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: "Continue the cache probe. Call list_files exactly once and do not mutate source."
      }]
    });
  }
  return {
    key,
    requests,
    continuityRate: continuityRate(requests),
    totalCostUsd: sum(requests.map((request) => request.costUsd))
  };
}

function stablePrefixFor(key: ProbeShape["key"]): ResponseInputItem[] {
  const textBlock = {
    type: "input_text" as const,
    text,
    ...(key === "no_image" ? { prompt_cache_breakpoint: { mode: "explicit" as const } } : {})
  };
  const imageBlock = {
    type: "input_image" as const,
    image_url: mediaDataUrl,
    detail: "high" as const,
    prompt_cache_breakpoint: { mode: "explicit" as const }
  };
  if (key === "no_image") {
    return [{ type: "message", role: "user", content: [textBlock] }];
  }
  if (key === "combined_image") {
    return [{ type: "message", role: "user", content: [textBlock, imageBlock] }];
  }
  return [
    { type: "message", role: "user", content: [textBlock] },
    { type: "message", role: "user", content: [imageBlock] }
  ];
}

function continuityRate(requests: ProbeRequest[]) {
  if (requests.length < 2) return 0;
  const eligible = requests.slice(1);
  const passing = eligible.filter(
    (request, index) => request.cachedInputTokens >= requests[index]!.inputTokens * 0.9
  );
  return passing.length / eligible.length;
}

function imageCacheAssessment(values: ProbeShape[]) {
  const image = values.find((shape) => shape.key === "separate_image");
  const control = values.find((shape) => shape.key === "no_image");
  if (!image || !control || image.requests.length < 2 || control.requests.length < 2) {
    return { status: "inconclusive" as const, reason: "missing_control_pairs" };
  }
  const imageTokenContribution = image.requests[0]!.inputTokens - control.requests[0]!.inputTokens;
  const cachedTokenIncrement = image.requests[1]!.cachedInputTokens - control.requests[1]!.cachedInputTokens;
  const coverage = imageTokenContribution > 0
    ? Math.max(0, cachedTokenIncrement) / imageTokenContribution
    : 0;
  return {
    status: coverage >= 0.9 ? "confirmed" as const : "inconclusive" as const,
    imageTokenContribution,
    cachedTokenIncrement,
    coverage
  };
}

function chooseShape(values: ProbeShape[], imageStatus: "confirmed" | "inconclusive") {
  const separate = values.find((shape) => shape.key === "separate_image");
  const combined = values.find((shape) => shape.key === "combined_image");
  if (imageStatus === "confirmed" && separate) {
    return { shape: separate.key, reason: "separate_messages_cache_text_and_image" };
  }
  if (combined && separate) {
    const selected = combined.totalCostUsd < separate.totalCostUsd ? combined : separate;
    return { shape: selected.key, reason: "lower_actual_billable_cost_after_inconclusive_image_probe" };
  }
  return { shape: "thumbnail_phase_required", reason: "real_image_payload_not_proven_cacheable" };
}

async function retainedProbeInput() {
  const runs = explicitRunId
    ? [await sitePlatformRepository.getAgentRun(explicitRunId)].filter(
        (value): value is NonNullable<typeof value> => Boolean(value)
      )
    : (await sitePlatformRepository.listRecentAgentRuns({ limit: 100 }))
        .filter((run) => run.apiProvider === "openai" && run.modelId === model);
  for (const run of runs) {
    const buildInput = await sitePlatformRepository.getPublicBuildInput(run.publicBuildInputId);
    if (buildInput?.business.assets.length) return { run, buildInput };
  }
  throw new Error("cache_probe_retained_sol_input_with_media_not_found");
}

async function retainedMediaSheet(buildInput: Awaited<ReturnType<typeof retainedProbeInput>>["buildInput"]) {
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

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
