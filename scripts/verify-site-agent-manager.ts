import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import { defaultSiteAuthoringModelSettings, validateSiteAuthoringModelSettingsUpdate } from "../lib/operator-settings";
import {
  WebsiteManagerAgent,
  createAuthoringContextPacket,
  assertCompleteWorkspace,
  classifyModelProviderError,
  managerLimitsForKind,
  maximumRunCostUsd,
  SiteAuthoringTerminalError,
  usageForModel,
  type ManagerRunEvent,
  type ManagerResponsesClient,
  type ManagerToolCall,
  type ManagerToolRuntime,
  type WorkspaceSourceFile
} from "../packages/site-agent";
import { WorkspaceManagerRuntime } from "../packages/site-platform/manager-runtime";
import { validateWorkspaceSourcePolicy } from "../packages/site-agent/source-policy";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const buildInput = buildSyntheticSiteInput();
const authoringContext = createAuthoringContextPacket({ buildInput, snapshots: [] });
assert.equal(defaultSiteAuthoringModelSettings().siteAgentProvider, "openai", "OpenRouter changed the active site-agent provider.");
assert(validateSiteAuthoringModelSettingsUpdate({
  siteAgentProvider: "openrouter",
  siteAgentModel: "openai/gpt-5.6-sol",
  ingestionModel: "gpt-5.6-sol",
  version: 0
}).ok, "Provider-qualified OpenRouter settings were rejected.");
assert(!validateSiteAuthoringModelSettingsUpdate({
  siteAgentProvider: "openrouter",
  siteAgentModel: "gpt-5.6-sol",
  ingestionModel: "gpt-5.6-sol",
  version: 0
}).ok, "Unqualified OpenRouter model settings were accepted.");
const siteSource = `import React from "react";
import { Fact } from "../platform/sdk";
import { Hero } from "./components/Hero";
export const siteDefinition = {
  siteName: "Northstar Collision Repair",
  routes: [{ path: "/", title: "Northstar Collision Repair", description: "Collision repair", element: <main><Hero /><h1><Fact id="business:name" /></h1></main> }]
};`;
const heroSource = `import React from "react";
export function Hero() { return <section className="hero">Collision repair, clearly explained.</section>; }`;
const cssSource = `body{margin:0;color:#111;background:#fff;font:16px Arial,sans-serif}`;
const heroCss = `.hero{padding:4rem 2rem;font-size:2rem}`;
const files: WorkspaceSourceFile[] = [
  { path: "src/site.tsx", content: siteSource },
  { path: "src/styles.css", content: cssSource },
  { path: "src/components/Hero.tsx", content: heroSource },
  { path: "src/components/hero.css", content: heroCss }
];
const workspaceHash = sha256(stableJson([...files].sort((left, right) => left.path.localeCompare(right.path))));
const inspectionHash = `sha256:${"9".repeat(64)}` as const;
const imageDigest = `sha256:${"8".repeat(64)}` as const;

const policyFindings = validateWorkspaceSourcePolicy(files);
assert.deepEqual(policyFindings, [], `multi-file workspace was rejected: ${JSON.stringify(policyFindings)}`);
assert.equal(assertCompleteWorkspace(files).length, 4, "complete workspace discarded local modules");
assert(validateWorkspaceSourcePolicy([...files, { path: "src/unsafe.ts", content: `import fs from "node:fs";` }]).some((finding) => finding.id === "source.import_module"), "non-allowlisted package import passed source policy");
assert(validateWorkspaceSourcePolicy([...files, { path: "src/escape.ts", content: `import { Fact } from "../../platform/sdk";` }]).some((finding) => finding.id === "source.import_module"), "source-root traversal passed source policy");
assert(validateWorkspaceSourcePolicy([...files, { path: "src/network.ts", content: `export const value = fetch("https://example.com")` }]).some((finding) => finding.id === "source.network"), "network access passed source policy");

let inspections = 0;
const managerRuntime = runtime({ onInspect: () => { inspections += 1; } });
const requests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const progress: number[] = [];
const manager = new WebsiteManagerAgent(queueClient([
  call("write_site", "write_file", { path: "src/site.tsx", content: siteSource }),
  call("write_styles", "write_file", { path: "src/styles.css", content: cssSource }),
  call("write_hero", "apply_patch", { files: [
    { path: "src/components/Hero.tsx", content: heroSource },
    { path: "src/components/hero.css", content: heroCss }
  ] }),
  call("build", "build_preview", {}),
  call("finish", "finish", finishArgs())
], (params) => requests.push(params)));
const completed = await manager.run({
  buildInput,
  authoringContext,
  instruction: "Create the initial site.",
  kind: "initial_build",
  runtime: managerRuntime,
  onProgress: async ({ responseIndex }) => { progress.push(responseIndex); }
});
assert.equal(completed.completion.workspaceHash, workspaceHash);
assert.equal(managerRuntime.finalCheckpoint(), "checkpoint_passed");
assert.equal(inspections, 1, "finish without inspect_site did not run final verification exactly once");
assert.deepEqual(completed.toolRecords.map((record) => record.name), ["write_file", "write_file", "apply_patch", "build_preview", "finish"]);
assert.deepEqual(progress, [1, 2, 3, 4, 5]);
assert(requests.every((request) => toolNames(request).join(",") === "list_files,read_file,write_file,delete_file,apply_patch,create_image,build_preview,request_input,finish"), "manager tool set drifted from the workspace and media protocol");
assert(!JSON.stringify(requests[0]?.input).includes("agentAccessPolicy"), "serving-only agent policy leaked into authoring context");
assert(!JSON.stringify(requests[0]?.input).toLowerCase().includes("rawcrawl"), "raw crawl payload leaked into authoring context");
assert((requests.at(-1)?.input as unknown[]).length > (requests[1]?.input as unknown[]).length, "manager discarded earlier tool history instead of retaining the conversation");

let buildCalls = 0;
let inspectCalls = 0;
const direct = runtime({ initialFiles: files, onBuild: () => { buildCalls += 1; }, onInspect: () => { inspectCalls += 1; } });
const listed = output(await direct.execute(toolCall("list", "list_files", {})));
assert.equal((listed.files as unknown[]).length, 4);
const read = output(await direct.execute(toolCall("read", "read_file", { path: "src/components/Hero.tsx", startLine: null, endLine: null })));
assert(String(read.content).includes("function Hero"));
await direct.execute(toolCall("build_1", "build_preview", {}));
assert.equal(output(await direct.execute(toolCall("build_2", "build_preview", {}))).cached, true);
assert.equal(buildCalls, 1, "unchanged build was rerun");
await direct.execute(toolCall("inspect_1", "inspect_site", {}));
await direct.execute(toolCall("inspect_2", "inspect_site", {}));
assert.equal(inspectCalls, 1, "unchanged verification was rerun");

const compactRuntime = runtime({
  initialFiles: files,
  inspectionSummary: {
    ok: false,
    findings: Array.from({ length: 14 }, (_, index) => ({ id: `finding_${index}`, severity: "warning", message: `Finding ${index}` })),
    blockers: [{ id: "blocking_finding", severity: "error", message: "A hard blocker." }],
    advisories: Array.from({ length: 12 }, (_, index) => ({ id: `advisory_${index}`, severity: "warning", message: `Advisory ${index}` }))
  }
});
await compactRuntime.execute(toolCall("compact_build", "build_preview", {}));
const compactInspection = output(await compactRuntime.execute(toolCall("compact_inspection", "inspect_site", {})));
assert(!("findings" in compactInspection), "inspection repeated the full finding set in model context");
assert.equal((compactInspection.blockers as unknown[]).length, 1, "inspection omitted a hard blocker");
assert.equal((compactInspection.advisories as unknown[]).length, 8, "inspection did not bound advisory examples");
assert.equal(compactInspection.advisoryCount, 12, "inspection lost the full advisory count");
assert.equal(compactInspection.advisoriesTruncated, true, "inspection did not disclose truncated advisory examples");

const exactEditCss = heroCss.replace("2rem", "2.25rem");
await direct.execute(toolCall("exact_edit", "write_file", { path: "src/components/hero.css", content: exactEditCss }));
assert.equal(direct.currentFiles().find((file) => file.path === "src/components/Hero.tsx")?.content, heroSource, "exact style edit broadened into unrelated source");
assert.equal(output(await direct.execute(toolCall("finish_stale", "finish", finishArgs()))).error, "finish_requires_current_successful_build");
await direct.execute(toolCall("build_after_edit", "build_preview", {}));
const finishedAfterEdit = await direct.execute(toolCall("finish_after_edit", "finish", finishArgs()));
assert(finishedAfterEdit.completion, "finish did not verify and retain the edited workspace");
assert.equal(inspectCalls, 2, "finalization did not use the same inspection function after mutation");

const atomic = runtime({ initialFiles: files });
const duplicate = output(await atomic.execute(toolCall("duplicate", "apply_patch", { files: [
  { path: "src/components/hero.css", content: "first" },
  { path: "src/components/hero.css", content: "second" }
] })));
assert.equal(duplicate.error, "patch_file_duplicated");
assert.equal(atomic.currentFiles().find((file) => file.path === "src/components/hero.css")?.content, heroCss, "rejected atomic patch partially mutated source");
await atomic.execute(toolCall("organize", "apply_patch", { files: [
  { path: "src/components/hero.css", content: exactEditCss },
  { path: "src/components/unused.ts", content: "export const unused = true;" }
] }));
await atomic.execute(toolCall("delete", "delete_file", { path: "src/components/unused.ts" }));
assert(!atomic.currentFiles().some((file) => file.path.endsWith("unused.ts")));

const clarificationRuntime = runtime();
const clarification = await clarificationRuntime.execute(toolCall("clarify", "request_input", { question: "Which phone number should be primary?" }));
assert.equal(clarification.needsInput?.question, "Which phone number should be primary?");
await clarificationRuntime.execute(toolCall("clarify_mutation", "write_file", { path: "src/site.tsx", content: siteSource }));
assert.equal(output(await clarificationRuntime.execute(toolCall("clarify_late", "request_input", { question: "Which phone number should be primary?" }))).error, "input_can_only_be_requested_before_workspace_mutation");

const recoveryRuntime = runtime();
const recovery = await new WebsiteManagerAgent(queueClient([
  call("bad_read", "read_file", { path: "src/site.tsx", startLine: "bad", endLine: null }),
  call("recover_site", "write_file", { path: "src/site.tsx", content: siteSource }),
  call("recover_styles", "write_file", { path: "src/styles.css", content: cssSource }),
  call("recover_hero", "apply_patch", { files: [
    { path: "src/components/Hero.tsx", content: heroSource },
    { path: "src/components/hero.css", content: heroCss }
  ] }),
  call("recover_build", "build_preview", {}),
  call("recover_finish", "finish", finishArgs())
])).run({ buildInput, authoringContext, instruction: "Recover from a malformed tool call.", kind: "initial_build", runtime: recoveryRuntime });
assert(recovery.completion, "a correctable tool argument error terminated the manager run");

const initialLimits = managerLimitsForKind("initial_build");
const editLimits = managerLimitsForKind("edit");
assert.deepEqual(initialLimits, { maxInputTokens: 650_000, maxOutputTokens: 40_000, maxDurationMs: 12 * 60_000 });
assert.deepEqual(editLimits, { maxInputTokens: 250_000, maxOutputTokens: 25_000, maxDurationMs: 8 * 60_000 });
assert.equal(maximumRunCostUsd("gpt-5.6-sol", initialLimits), 4.45, "initial Sol cost ceiling drifted");
assert.equal(maximumRunCostUsd("gpt-5.6-sol", editLimits), 2, "edit Sol cost ceiling drifted");
assert.equal(usageForModel("gpt-5.6-sol", {
  input_tokens: 1_000,
  input_tokens_details: { cached_tokens: 800 },
  output_tokens: 100
}, 25).costUsd, 0.0044, "cached input was charged at the full input rate");
const quotaFailure = classifyModelProviderError({ status: 429, error: { code: "insufficient_quota" } });
assert(quotaFailure.code === "provider_quota_exhausted" && !quotaFailure.retryableByOwner, "quota exhaustion was exposed as owner-retryable");
const openRouterCreditsFailure = classifyModelProviderError({ status: 402, error: { code: 402, message: "Insufficient credits" } });
assert(openRouterCreditsFailure.code === "provider_quota_exhausted" && !openRouterCreditsFailure.retryableByOwner, "OpenRouter credit exhaustion lost its provider quota classification");
const transientProviderFailure = classifyModelProviderError({ status: 429, error: { code: "rate_limit_exceeded" } });
assert(transientProviderFailure.code === "provider_temporarily_unavailable" && transientProviderFailure.retryableByOwner, "temporary provider rate limit was not retryable");

const previousModelOverride = process.env.LODESTA_SITE_AGENT_MODEL;
let unpricedModelRequests = 0;
let unpricedModelFailure: unknown;
process.env.LODESTA_SITE_AGENT_MODEL = "unpriced-site-agent-model";
try {
  await new WebsiteManagerAgent(queueClient([
    call("must_not_run_unpriced", "list_files", {})
  ], () => { unpricedModelRequests += 1; })).run({
    buildInput,
    authoringContext,
    instruction: "Reject an unpriced operator model before requesting it.",
    kind: "edit",
    runtime: runtime({ initialFiles: files })
  });
} catch (error) {
  unpricedModelFailure = error;
} finally {
  if (previousModelOverride === undefined) delete process.env.LODESTA_SITE_AGENT_MODEL;
  else process.env.LODESTA_SITE_AGENT_MODEL = previousModelOverride;
}
assert(unpricedModelFailure instanceof SiteAuthoringTerminalError && unpricedModelFailure.message.startsWith("site_agent_model_pricing_missing:"), "unpriced operator model was not rejected");
assert.equal(unpricedModelRequests, 0, "an unpriced operator model reached the provider");

const previousProviderOverride = process.env.LODESTA_SITE_AGENT_PROVIDER;
const previousOpenRouterModelOverride = process.env.LODESTA_SITE_AGENT_MODEL;
const openRouterRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const openRouterEvents: ManagerRunEvent[] = [];
process.env.LODESTA_SITE_AGENT_PROVIDER = "openrouter";
process.env.LODESTA_SITE_AGENT_MODEL = "openai/gpt-5.6-sol";
let openRouterResult: Awaited<ReturnType<WebsiteManagerAgent["run"]>> | undefined;
try {
  openRouterResult = await new WebsiteManagerAgent(queueClient([
    {
      ...call("openrouter_build", "build_preview", {}),
      id: "gen_openrouter_turn_1",
      model: "openai/gpt-5.6-sol",
      usage: {
        input_tokens: 20,
        output_tokens: 8,
        total_tokens: 28,
        input_tokens_details: { cached_tokens: 5, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 3 },
        cost: 0.0015,
        cost_details: { upstream_inference_cost: 0.0012 }
      },
      openrouter_metadata: {
        endpoints: { available: [{ provider: "OpenAI", model: "openai/gpt-5.6-sol", selected: true }] }
      }
    },
    {
      ...call("openrouter_finish", "finish", finishArgs()),
      id: "gen_openrouter_turn_2",
      model: "openai/gpt-5.6-sol",
      usage: {
        input_tokens: 30,
        output_tokens: 10,
        total_tokens: 40,
        input_tokens_details: { cached_tokens: 10, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 4 },
        cost: 0.0025,
        cost_details: { upstream_inference_cost: 0.002 }
      },
      openrouter_metadata: {
        endpoints: { available: [{ provider: "OpenAI", model: "openai/gpt-5.6-sol", selected: true }] }
      }
    }
  ], (params) => openRouterRequests.push(params))).run({
    buildInput,
    authoringContext,
    runId: "run_openrouter_test",
    instruction: "Exercise the inactive OpenRouter route.",
    kind: "edit",
    runtime: runtime({ initialFiles: files }),
    onEvents: async (events) => { openRouterEvents.push(...events); }
  });
} finally {
  if (previousProviderOverride === undefined) delete process.env.LODESTA_SITE_AGENT_PROVIDER;
  else process.env.LODESTA_SITE_AGENT_PROVIDER = previousProviderOverride;
  if (previousOpenRouterModelOverride === undefined) delete process.env.LODESTA_SITE_AGENT_MODEL;
  else process.env.LODESTA_SITE_AGENT_MODEL = previousOpenRouterModelOverride;
}
assert(openRouterResult, "OpenRouter route did not complete.");
assert.equal(openRouterResult.apiProvider, "openrouter");
assert.equal(openRouterResult.usage.costUsd, 0.004, "OpenRouter provider-reported per-turn cost was not aggregated.");
assert.equal(openRouterResult.usage.costSource, "provider_reported");
assert.equal(openRouterResult.usage.reasoningTokens, 7);
const routedRequest = openRouterRequests[0] as Parameters<ManagerResponsesClient["create"]>[0] & {
  provider?: { data_collection?: string; zdr?: boolean; require_parameters?: boolean };
  session_id?: string;
};
assert.deepEqual(routedRequest.provider, { data_collection: "deny", zdr: true, require_parameters: true });
assert.equal(routedRequest.session_id, "run_openrouter_test");
const billedTurn = openRouterEvents.find((event) => event.kind === "model_request" && event.status === "succeeded");
assert(billedTurn, "OpenRouter model turn telemetry was not emitted.");
assert.equal(billedTurn.apiProvider, "openrouter");
assert.equal(billedTurn.upstreamProvider, "OpenAI");
assert.equal(billedTurn.providerRequestId, "gen_openrouter_turn_1");
assert.equal(billedTurn.costUsd, 0.0015);
assert.equal(billedTurn.costSource, "provider_reported");
assert.equal(billedTurn.upstreamInferenceCostUsd, 0.0012);

const terminalRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
let terminalFailure: unknown;
try {
  await new WebsiteManagerAgent(queueClient([
    call("terminal_build", "build_preview", {}),
    call("terminal_inspect", "inspect_site", {}),
    call("must_not_run", "list_files", {})
  ], (params) => terminalRequests.push(params))).run({
    buildInput,
    authoringContext,
    instruction: "Stop on a platform contract failure.",
    kind: "edit",
    runtime: runtime({
      initialFiles: files,
      inspectError: new SiteAuthoringTerminalError(
        "artifact_contract_invalid",
        "platform",
        false,
        "synthetic_artifact_contract_invalid"
      )
    })
  });
} catch (error) {
  terminalFailure = error;
}
assert(terminalFailure instanceof SiteAuthoringTerminalError && terminalFailure.code === "artifact_contract_invalid", "platform contract failure lost its terminal classification");
assert.equal(terminalRequests.length, 2, "platform contract failure consumed another model request");

let persistedLimitUsage = 0;
let limitFailure: unknown;
try {
  await new WebsiteManagerAgent(queueClient([
    call("over_budget", "list_files", {})
  ])).run({
    buildInput,
    authoringContext,
    instruction: "Stop after recording the response that exhausts the input budget.",
    kind: "edit",
    limits: { maxInputTokens: 5, maxOutputTokens: 25_000, maxDurationMs: 8 * 60_000 },
    runtime: runtime({ initialFiles: files }),
    onUsage: async ({ usage }) => { persistedLimitUsage = usage.inputTokens; }
  });
} catch (error) {
  limitFailure = error;
}
assert(limitFailure instanceof SiteAuthoringTerminalError && limitFailure.code === "input_budget_exhausted", "input budget exhaustion lost its terminal classification");
assert.equal(persistedLimitUsage, 10, "the response that exhausted the input budget was not persisted before termination");

const finishAtBoundaryRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const finishAtBoundary = await new WebsiteManagerAgent(queueClient([
  call("boundary_build", "build_preview", {}),
  call("boundary_inspect", "inspect_site", {}),
  call("boundary_finish", "finish", finishArgs())
], (params) => finishAtBoundaryRequests.push(params))).run({
  buildInput,
  authoringContext,
  instruction: "Retain a verified candidate when the already-paid finish response crosses the input limit.",
  kind: "edit",
  limits: { maxInputTokens: 25, maxOutputTokens: 25_000, maxDurationMs: 8 * 60_000 },
  runtime: runtime({ initialFiles: files })
});
assert.equal(finishAtBoundary.completion.ownerMessage, finishArgs().ownerMessage);
assert.equal(finishAtBoundary.usage.inputTokens, 30, "terminal response usage was not retained");
assert.equal(finishAtBoundaryRequests.length, 3, "terminal overage consumed an additional model request");

console.log(JSON.stringify({
  ok: true,
  multiFileWorkspace: "pass",
  safeImportBoundary: "pass",
  simpleToolLoop: "pass",
  optionalInspection: "pass",
  sharedVerification: "pass",
  exactEditScope: "pass",
  atomicFilePatch: "pass",
  fullConversationHistory: "pass",
  correctableToolErrors: "pass"
  ,clarificationBeforeMutation: "pass",
  pricedModelEnforcement: "pass",
  terminalPlatformErrors: "pass",
  exhaustedUsagePersistence: "pass",
  terminalBoundaryCompletion: "pass",
  openRouterRoute: "pass",
  perTurnCostTelemetry: "pass",
  boundedCost: "pass"
}));

function runtime(options: { initialFiles?: WorkspaceSourceFile[]; onBuild?: () => void; onInspect?: () => void; inspectionSummary?: Record<string, unknown>; inspectError?: Error } = {}) {
  let revision = 0;
  return new WorkspaceManagerRuntime<string>({
    kind: options.initialFiles ? "edit" : "initial_build",
    publicBuildInputId: buildInput.id,
    toolchainVersion: "toolchain-test",
    sandboxImageDigest: imageDigest,
    initialFiles: options.initialFiles,
    initialSandboxRevision: "sandbox_revision_0",
    applyBuild: async () => {
      options.onBuild?.();
      revision += 1;
      return { revision: `sandbox_revision_${revision}`, buildDurationMs: 12, previewPath: "/private-preview" };
    },
    inspect: async () => {
      options.onInspect?.();
      if (options.inspectError) throw options.inspectError;
      return { passed: options.inspectionSummary ? false : true, inspectionHash, modelSummary: options.inspectionSummary ?? { ok: true, inspectionHash }, diagnosticSummary: { ok: true, inspectionHash }, checkpoint: options.inspectionSummary ? undefined : "checkpoint_passed" };
    }
  });
}

function finishArgs() {
  return {
    ownerMessage: "Built the private candidate and verified every route."
  };
}

function call(callId: string, name: string, args: Record<string, unknown>) {
  return {
    status: "completed" as const,
    output_text: "",
    output: [{ type: "function_call" as const, call_id: callId, name, arguments: JSON.stringify(args), status: "completed" as const }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
  };
}

type FakeManagerResponse = Omit<ReturnType<typeof call>, "usage"> & {
  id?: string;
  model?: string;
  usage: ReturnType<typeof call>["usage"] & {
    cost?: number;
    cost_details?: { upstream_inference_cost?: number };
  };
  openrouter_metadata?: unknown;
};

function queueClient(responses: FakeManagerResponse[], onCreate?: (params: Parameters<ManagerResponsesClient["create"]>[0]) => void): ManagerResponsesClient {
  const queue = [...responses];
  return { async create(params) { onCreate?.(params); const next = queue.shift(); if (!next) throw new Error("fake_response_queue_exhausted"); return next as never; } };
}

function toolCall(callId: string, name: ManagerToolCall["name"], args: Record<string, unknown>): ManagerToolCall {
  return { callId, name, arguments: args };
}

function output(result: Awaited<ReturnType<ManagerToolRuntime["execute"]>>) {
  return JSON.parse(result.modelOutput as string) as Record<string, unknown>;
}

function toolNames(request: Parameters<ManagerResponsesClient["create"]>[0]) {
  return (request.tools ?? []).map((tool) => tool.type === "function" ? tool.name : tool.type);
}
