import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import { normalizeOpenAiModelCatalog, normalizeOpenRouterModelCatalog } from "../lib/model-catalog";
import { defaultSiteAuthoringModelSettings, validateSiteAuthoringModelSettingsUpdate } from "../lib/operator-settings";
import {
  WebsiteManagerAgent,
  createAuthoringContextPacket,
  assertCompleteWorkspace,
  classifyModelProviderError,
  managerGuardrailsForKind,
  managerGuardrailsAfterPriorUsage,
  siteAgentRunGuardrailsForKind,
  SiteAuthoringTerminalError,
  usageForModel,
  websiteManagerSystemPrompt,
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
for (const siteAgentModel of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]) {
  assert(validateSiteAuthoringModelSettingsUpdate({
    siteAgentProvider: "openai",
    siteAgentModel,
    ingestionModel: "gpt-5.6-sol",
    version: 0
  }).ok, `${siteAgentModel} was rejected as a direct OpenAI website-manager model.`);
}
const openAiModels = normalizeOpenAiModelCatalog({
  data: [
    { id: "gpt-5.6-sol", created: 1_700_000_000, owned_by: "openai" },
    { id: "gpt-5.6-terra", created: 1_700_000_001, owned_by: "openai" },
    { id: "gpt-5.6-luna", created: 1_700_000_002, owned_by: "openai" },
    { id: "gpt-5.5", created: 1_700_000_003, owned_by: "openai" },
    { id: "whisper-1", created: 1_600_000_000, owned_by: "openai" }
  ]
});
assert.equal(openAiModels.length, 5, "OpenAI catalog models were discarded.");
for (const modelId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]) {
  assert.equal(openAiModels.find((model) => model.id === modelId)?.siteAgentAvailability, "selectable", `${modelId} was not selectable for site authoring.`);
}
assert.equal(openAiModels.find((model) => model.id === "gpt-5.6-terra")?.inputUsdPerMillion, 2.5, "Direct OpenAI Terra input pricing was missing from the catalog.");
assert.equal(openAiModels.find((model) => model.id === "gpt-5.6-luna")?.outputUsdPerMillion, 6, "Direct OpenAI Luna output pricing was missing from the catalog.");
assert.equal(openAiModels.find((model) => model.id === "whisper-1")?.siteAgentAvailability, "pricing_unconfigured", "Unpriced OpenAI model lost its explicit selection reason.");
const openRouterModels = normalizeOpenRouterModelCatalog({
  data: [
    {
      id: "openai/gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      context_length: 400_000,
      pricing: { prompt: "0.000005", completion: "0.00003" },
      supported_parameters: ["tools", "tool_choice", "reasoning", "structured_outputs"]
    },
    {
      id: "example/text-only",
      name: "Text only",
      supported_parameters: ["temperature"]
    }
  ]
});
assert.equal(openRouterModels.length, 2, "OpenRouter catalog models were discarded.");
const openRouterSiteAgentModel = openRouterModels.find((model) => model.id === "openai/gpt-5.6-sol");
assert.equal(openRouterSiteAgentModel?.siteAgentAvailability, "selectable", "Capable OpenRouter model was not selectable for site authoring.");
assert.equal(openRouterSiteAgentModel?.inputUsdPerMillion, 5, "OpenRouter input pricing was not normalized per million tokens.");
assert.equal(openRouterSiteAgentModel?.outputUsdPerMillion, 30, "OpenRouter output pricing was not normalized per million tokens.");
assert.equal(openRouterModels.find((model) => model.id === "example/text-only")?.siteAgentAvailability, "capabilities_missing", "OpenRouter capability exclusions lost their explicit reason.");
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
assert(websiteManagerSystemPrompt.includes("statically discoverable"), "manager prompt lost the static source-structure rule");
assert(websiteManagerSystemPrompt.includes("sensitive metadata claim requires the same visible Fact"), "manager prompt lost route-visible evidence binding for sensitive metadata");
assert(websiteManagerSystemPrompt.includes("Omit unsupported sensitive claims"), "manager prompt lost the concise unsupported-claim rule");

let inspections = 0;
const managerRuntime = runtime({ onInspect: () => { inspections += 1; } });
const requests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const progress: number[] = [];
const managerEvents: ManagerRunEvent[] = [];
let rejectedOwnerActivityOpeningSpan = false;
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
  onEvents: async (events) => {
    if (!rejectedOwnerActivityOpeningSpan && events.some((event) => event.name === "build_preview" && event.status === "running")) {
      rejectedOwnerActivityOpeningSpan = true;
      throw new Error("synthetic owner activity persistence failure");
    }
    managerEvents.push(...events);
  },
  onProgress: async ({ responseIndex }) => { progress.push(responseIndex); }
});
assert.equal(completed.completion.workspaceHash, workspaceHash);
assert.equal(managerRuntime.finalCheckpoint(), "checkpoint_passed");
assert.equal(inspections, 1, "finish without inspect_site did not run final verification exactly once");
assert.deepEqual(completed.toolRecords.map((record) => record.name), ["write_file", "write_file", "apply_patch", "build_preview", "finish"]);
assert.deepEqual(progress, [1, 2, 3, 4, 5]);
assert.equal(rejectedOwnerActivityOpeningSpan, true, "slow owner-visible tools did not emit a running span");
assert(managerEvents.some((event) => event.name === "build_preview" && event.status === "succeeded"), "a failed opening-span write interrupted tool execution or its terminal event");
const finishSpans = managerEvents.filter((event) => event.name === "finish");
assert.equal(finishSpans.length, 2, "slow tool spans were not opened and closed exactly once");
assert.equal(finishSpans[0]?.id, finishSpans[1]?.id, "running and terminal tool spans did not preserve event identity");
assert(requests.every((request) => toolNames(request).join(",") === "list_files,read_file,write_file,delete_file,apply_patch,create_image,build_preview,inspect_site,request_input,finish"), "manager tool set drifted from the workspace, inspection, and media protocol");
assert(!JSON.stringify(requests[0]?.input).includes("agentAccessPolicy"), "serving-only agent policy leaked into authoring context");
assert(!JSON.stringify(requests[0]?.input).toLowerCase().includes("rawcrawl"), "raw crawl payload leaked into authoring context");
assert((requests.at(-1)?.input as unknown[]).length > (requests[1]?.input as unknown[]).length, "manager discarded earlier tool history instead of retaining the conversation");
assert(requests.every((request) => request.reasoning?.effort === "high"), "website-manager reasoning effort drifted from high");
assert(requests.every((request) => request.text?.verbosity === "low"), "website-manager text verbosity drifted from low");

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
assert.equal(output(await direct.execute(toolCall("inspect_1", "inspect_site", {}))).cached, false);
assert.equal(output(await direct.execute(toolCall("inspect_2", "inspect_site", {}))).cached, true);
assert.equal(inspectCalls, 1, "unchanged verification was rerun");

let failedInspectionCalls = 0;
const compactRuntime = runtime({
  initialFiles: files,
  onInspect: () => { failedInspectionCalls += 1; },
  inspectionSummary: {
    ok: false,
    findings: Array.from({ length: 14 }, (_, index) => ({ id: `finding_${index}`, severity: "warning", message: `Finding ${index}` })),
    blockers: [{ id: "blocking_finding", severity: "error", area: "claim", message: "A hard blocker." }],
    advisories: Array.from({ length: 12 }, (_, index) => ({ id: `advisory_${index}`, severity: "warning", message: `Advisory ${index}` }))
  }
});
await compactRuntime.execute(toolCall("compact_build", "build_preview", {}));
const compactInspectionExecution = await compactRuntime.execute(toolCall("compact_inspection", "inspect_site", {}));
const compactInspection = output(compactInspectionExecution);
assert(!("findings" in compactInspection), "inspection repeated the full finding set in model context");
assert.equal((compactInspection.blockers as unknown[]).length, 1, "inspection omitted a hard blocker");
assert(!("advisories" in compactInspection), "failed inspection sent subjective advisories alongside blockers");
assert.equal(compactInspection.advisoryCount, 12, "inspection lost the full advisory count");
assert.equal(compactInspection.advisoriesOmitted, true, "inspection did not disclose omitted advisory context");
assert(Array.isArray(compactInspectionExecution.diagnosticOutput.findings), "operator diagnostics lost the complete finding set");
const cachedCompactInspection = output(await compactRuntime.execute(toolCall("compact_inspection_cached", "inspect_site", {})));
assert.equal(cachedCompactInspection.cached, true, "failed inspection was not served from the workspace-hash cache");
assert(String(cachedCompactInspection.guidance).includes("Edit the workspace source"), "cached inspection failure omitted repair guidance");
assert.equal(failedInspectionCalls, 1, "unchanged failed inspection reran verification");
await compactRuntime.execute(toolCall("compact_inspection_mutation", "write_file", { path: "src/styles.css", content: `${cssSource}\narticle{display:block}` }));
await compactRuntime.execute(toolCall("compact_build_after_mutation", "build_preview", {}));
await compactRuntime.execute(toolCall("compact_inspection_after_mutation", "inspect_site", {}));
assert.equal(failedInspectionCalls, 2, "workspace mutation did not invalidate the failed-inspection cache");

let failedBuildCalls = 0;
const failedBuildRuntime = runtime({
  initialFiles: files,
  onBuild: () => { failedBuildCalls += 1; },
  buildError: new Error("synthetic compiler diagnostic")
});
const firstBuildFailure = output(await failedBuildRuntime.execute(toolCall("failed_build_1", "build_preview", {})));
const cachedBuildFailure = output(await failedBuildRuntime.execute(toolCall("failed_build_2", "build_preview", {})));
assert.equal(firstBuildFailure.cached, false, "first failed build was marked cached");
assert.equal(cachedBuildFailure.cached, true, "unchanged failed build was not served from cache");
assert.equal(cachedBuildFailure.failureFingerprint, firstBuildFailure.failureFingerprint, "failed-build cache changed the deterministic fingerprint");
assert(String(cachedBuildFailure.guidance).includes("Edit the workspace source"), "cached build failure omitted repair guidance");
assert.equal(failedBuildCalls, 1, "unchanged failed build reran the sandbox compiler");
await failedBuildRuntime.execute(toolCall("repair_failed_build", "write_file", { path: "src/styles.css", content: `${cssSource}\nmain{display:block}` }));
await failedBuildRuntime.execute(toolCall("failed_build_after_mutation", "build_preview", {}));
assert.equal(failedBuildCalls, 2, "workspace mutation did not invalidate the failed-build cache");

const claimBlockerRuntime = runtime({
  initialFiles: files,
  inspectionImages: true,
  inspectionSummary: {
    ok: false,
    blockers: [{ id: "claim_blocker", severity: "error", area: "claim", message: "Unsupported claim." }],
    advisories: []
  }
});
await claimBlockerRuntime.execute(toolCall("claim_build", "build_preview", {}));
const claimInspection = await claimBlockerRuntime.execute(toolCall("claim_inspect", "inspect_site", {}));
assert.equal(typeof claimInspection.modelOutput, "string", "nonvisual blocker attached a verification image");

const visualBlockerRuntime = runtime({
  initialFiles: files,
  inspectionImages: true,
  inspectionSummary: {
    ok: false,
    blockers: [{ id: "render_blocker", severity: "error", area: "render", message: "Content is clipped." }],
    advisories: []
  }
});
await visualBlockerRuntime.execute(toolCall("visual_build", "build_preview", {}));
const visualInspection = await visualBlockerRuntime.execute(toolCall("visual_inspect", "inspect_site", {}));
assert(Array.isArray(visualInspection.modelOutput), "visual blocker omitted the verification image");

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

const initialGuardrails = managerGuardrailsForKind("initial_build");
const editGuardrails = managerGuardrailsForKind("edit");
assert.deepEqual(initialGuardrails, { maxCostUsd: 15, maxConsecutiveIdenticalFailures: 3 });
assert.deepEqual(editGuardrails, { maxCostUsd: 8, maxConsecutiveIdenticalFailures: 3 });
const guardrailStart = "2026-07-24T12:00:00.000Z";
assert.deepEqual(siteAgentRunGuardrailsForKind("initial_build", guardrailStart), {
  deadlineAt: "2026-07-24T13:00:00.000Z",
  maxCostUsd: 15,
  maxConsecutiveIdenticalFailures: 3
});
assert.deepEqual(siteAgentRunGuardrailsForKind("edit", guardrailStart), {
  deadlineAt: "2026-07-24T12:25:00.000Z",
  maxCostUsd: 8,
  maxConsecutiveIdenticalFailures: 3
});
assert.deepEqual(managerGuardrailsAfterPriorUsage(initialGuardrails, {
  inputTokens: 25_000,
  outputTokens: 2_000,
  costUsd: 4.25,
  costSource: "catalog_estimate"
}), {
  maxCostUsd: 10.75,
  maxConsecutiveIdenticalFailures: 3
}, "research cost was not deducted from the authoring fuse");
assert.throws(
  () => managerGuardrailsAfterPriorUsage(editGuardrails, {
    inputTokens: 100,
    outputTokens: 10,
    costUsd: 0,
    costSource: "unavailable"
  }),
  (error) => error instanceof SiteAuthoringTerminalError && error.code === "cost_telemetry_unavailable",
  "unmetered research was allowed to continue into authoring"
);
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

const unavailableCostProviderOverride = process.env.LODESTA_SITE_AGENT_PROVIDER;
const unavailableCostModelOverride = process.env.LODESTA_SITE_AGENT_MODEL;
const unavailableCostBaseRuntime = runtime({ initialFiles: files });
let unavailableCostToolCalls = 0;
let unavailableCostFailure: unknown;
process.env.LODESTA_SITE_AGENT_PROVIDER = "openrouter";
process.env.LODESTA_SITE_AGENT_MODEL = "example/unpriced-authoring-model";
try {
  await new WebsiteManagerAgent(queueClient([
    call("unmetered_must_not_execute", "list_files", {})
  ])).run({
    buildInput,
    authoringContext,
    instruction: "Fail closed when provider and catalog cost telemetry are unavailable.",
    kind: "edit",
    runtime: {
      stateSummary: () => unavailableCostBaseRuntime.stateSummary(),
      execute: async (toolCallValue) => {
        unavailableCostToolCalls += 1;
        return unavailableCostBaseRuntime.execute(toolCallValue);
      }
    }
  });
} catch (error) {
  unavailableCostFailure = error;
} finally {
  if (unavailableCostProviderOverride === undefined) delete process.env.LODESTA_SITE_AGENT_PROVIDER;
  else process.env.LODESTA_SITE_AGENT_PROVIDER = unavailableCostProviderOverride;
  if (unavailableCostModelOverride === undefined) delete process.env.LODESTA_SITE_AGENT_MODEL;
  else process.env.LODESTA_SITE_AGENT_MODEL = unavailableCostModelOverride;
}
assert(unavailableCostFailure instanceof SiteAuthoringTerminalError && unavailableCostFailure.code === "cost_telemetry_unavailable", "missing cost telemetry did not fail closed");
assert.equal(unavailableCostToolCalls, 0, "an unmetered model response was allowed to mutate or inspect the workspace");

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

let persistedCostUsage = 0;
let costFailure: unknown;
const costFuseRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
try {
  await new WebsiteManagerAgent(queueClient([
    meteredCall("over_cost", "list_files", {}, 100, 10, 0.75)
  ], (params) => costFuseRequests.push(params))).run({
    buildInput,
    authoringContext,
    instruction: "Stop before another response after the cost fuse is reached.",
    kind: "edit",
    guardrails: { maxCostUsd: 0.5, maxConsecutiveIdenticalFailures: 3 },
    runtime: runtime({ initialFiles: files }),
    onUsage: async ({ usage }) => { persistedCostUsage = usage.costUsd; }
  });
} catch (error) {
  costFailure = error;
}
assert(costFailure instanceof SiteAuthoringTerminalError && costFailure.code === "cost_limit_exhausted", "cost fuse lost its terminal classification");
assert.equal(persistedCostUsage, 0.75, "the response that crossed the cost fuse was not persisted before termination");
assert.equal(costFuseRequests.length, 1, "cost fuse allowed another model request");

const imageCostRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const imageCostEvents: ManagerRunEvent[] = [];
let persistedImageCostUsage = 0;
let imageCostFailure: unknown;
const imageCostBaseRuntime = runtime({ initialFiles: files });
try {
  await new WebsiteManagerAgent(queueClient([
    call("metered_image", "create_image", {
      action: "generate",
      purpose: "hero",
      prompt: "A restrained, text-free abstract hero background.",
      sourceAssetIds: [],
      size: "1024x1024",
      alt: "Abstract hero background"
    }),
    call("image_cost_must_not_run", "list_files", {})
  ], (params) => imageCostRequests.push(params))).run({
    buildInput,
    authoringContext,
    instruction: "Include generated media in the authoring cost fuse.",
    kind: "edit",
    guardrails: { maxCostUsd: 0.5, maxConsecutiveIdenticalFailures: 3 },
    runtime: {
      stateSummary: () => imageCostBaseRuntime.stateSummary(),
      execute: async (toolCallValue) => {
        if (toolCallValue.name !== "create_image") return imageCostBaseRuntime.execute(toolCallValue);
        return {
          modelOutput: JSON.stringify({ ok: true, assetId: "asset_metered" }),
          diagnosticOutput: { ok: true, assetId: "asset_metered" },
          metering: {
            apiProvider: "openai" as const,
            modelId: "gpt-image-2",
            servedModelId: "gpt-image-2",
            usage: {
              inputTokens: 100,
              cachedInputTokens: 0,
              reasoningTokens: 0,
              outputTokens: 25_000,
              costUsd: 0.75,
              costSource: "catalog_estimate" as const,
              upstreamInferenceCostUsd: 0,
              durationMs: 250
            }
          }
        };
      }
    },
    onProgress: async ({ usage }) => { persistedImageCostUsage = usage.costUsd; },
    onEvents: async (events) => { imageCostEvents.push(...events); }
  });
} catch (error) {
  imageCostFailure = error;
}
assert(imageCostFailure instanceof SiteAuthoringTerminalError && imageCostFailure.code === "cost_limit_exhausted", "generated-media cost did not contribute to the authoring fuse");
assert.equal(imageCostRequests.length, 1, "generated-media cost allowed another model request after crossing the fuse");
assert(persistedImageCostUsage > 0.75, "generated-media cost was not combined with the authoring response cost");
const imageCostEvent = imageCostEvents.find((event) => event.name === "create_image" && event.status === "succeeded");
assert.equal(imageCostEvent?.modelId, "gpt-image-2", "generated-media telemetry lost its model identity");
assert.equal(imageCostEvent?.costUsd, 0.75, "generated-media telemetry lost its request cost");

const unavailableImageCostRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
let unavailableImageCostFailure: unknown;
try {
  await new WebsiteManagerAgent(queueClient([
    call("unmetered_image", "create_image", {
      action: "generate",
      purpose: "section",
      prompt: "A restrained, text-free section image.",
      sourceAssetIds: [],
      size: "1024x1024",
      alt: "Abstract section image"
    }),
    call("unmetered_image_must_not_run", "list_files", {})
  ], (params) => unavailableImageCostRequests.push(params))).run({
    buildInput,
    authoringContext,
    instruction: "Fail closed when generated-media cost cannot be measured.",
    kind: "edit",
    runtime: {
      stateSummary: () => imageCostBaseRuntime.stateSummary(),
      execute: async (toolCallValue) => {
        if (toolCallValue.name !== "create_image") return imageCostBaseRuntime.execute(toolCallValue);
        return {
          modelOutput: JSON.stringify({ ok: true, assetId: "asset_unmetered" }),
          diagnosticOutput: { ok: true, assetId: "asset_unmetered" },
          metering: {
            apiProvider: "openai" as const,
            modelId: "gpt-image-2",
            usage: {
              inputTokens: 0,
              cachedInputTokens: 0,
              reasoningTokens: 0,
              outputTokens: 0,
              costUsd: 0,
              costSource: "unavailable" as const,
              upstreamInferenceCostUsd: 0,
              durationMs: 250
            }
          }
        };
      }
    }
  });
} catch (error) {
  unavailableImageCostFailure = error;
}
assert(unavailableImageCostFailure instanceof SiteAuthoringTerminalError && unavailableImageCostFailure.code === "cost_telemetry_unavailable", "unmetered generated media was allowed to continue");
assert.equal(unavailableImageCostRequests.length, 1, "unmetered generated media consumed another model request");

const finishAtBoundaryRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const realDateNow = Date.now;
let simulatedDateNow = realDateNow();
let finishAtBoundary: Awaited<ReturnType<WebsiteManagerAgent["run"]>>;
Date.now = () => simulatedDateNow;
try {
  finishAtBoundary = await new WebsiteManagerAgent(queueClient([
    meteredCall("boundary_build", "build_preview", {}, 1_000_000, 20_000, 0.25),
    meteredCall("boundary_inspect", "inspect_site", {}, 1_000_000, 20_000, 0.25),
    meteredCall("boundary_finish", "finish", finishArgs(), 1_000_000, 20_000, 0.25)
  ], (params) => {
    finishAtBoundaryRequests.push(params);
    simulatedDateNow += 5 * 60_000;
  })).run({
    buildInput,
    authoringContext,
    instruction: "Retain a verified candidate when the already-paid finish response crosses the cost fuse.",
    kind: "edit",
    guardrails: { maxCostUsd: 0.6, maxConsecutiveIdenticalFailures: 3 },
    runtime: runtime({ initialFiles: files })
  });
} finally {
  Date.now = realDateNow;
}
assert.equal(finishAtBoundary.completion.ownerMessage, finishArgs().ownerMessage);
assert.equal(finishAtBoundary.usage.inputTokens, 3_000_000, "productive run was still constrained by the retired cumulative input budget");
assert.equal(finishAtBoundary.usage.outputTokens, 60_000, "productive run was still constrained by the retired cumulative output budget");
assert.equal(finishAtBoundary.usage.costUsd, 0.75, "terminal cost overage was not retained");
assert(finishAtBoundary.usage.durationMs >= 15 * 60_000, "productive run was still constrained by the retired 12-minute manager deadline");
assert.equal(finishAtBoundaryRequests.length, 3, "terminal overage consumed an additional model request");
assert(finishAtBoundaryRequests.every((request) => request.max_output_tokens === 64_000), "per-turn output allowance still shrank with cumulative usage");

const stalledRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
let stalledFailure: unknown;
try {
  await new WebsiteManagerAgent(queueClient([
    call("stall_build", "build_preview", {}),
    call("stall_finish_1", "finish", finishArgs()),
    call("stall_read", "read_file", { path: "src/site.tsx", startLine: null, endLine: null }),
    call("stall_finish_2", "finish", finishArgs()),
    call("stall_finish_3", "finish", finishArgs()),
    call("stall_must_not_run", "list_files", {})
  ], (params) => stalledRequests.push(params))).run({
    buildInput,
    authoringContext,
    instruction: "Stop after the same deterministic release failure repeats.",
    kind: "edit",
    guardrails: { maxCostUsd: 8, maxConsecutiveIdenticalFailures: 3 },
    runtime: runtime({
      initialFiles: files,
      inspectionSummary: {
        ok: false,
        blockers: [{ id: "same_blocker", severity: "error", area: "claim", message: "Same deterministic blocker." }],
        advisories: []
      }
    })
  });
} catch (error) {
  stalledFailure = error;
}
assert(stalledFailure instanceof SiteAuthoringTerminalError && stalledFailure.code === "authoring_stalled", "identical release failures did not terminate as authoring_stalled");
assert.equal(stalledRequests.length, 5, "manager requested another model turn after the third identical failure");

const resetRuntime = scriptedFailureRuntime([
  { fingerprint: `sha256:${"1".repeat(64)}` },
  { fingerprint: `sha256:${"1".repeat(64)}` },
  { fingerprint: `sha256:${"2".repeat(64)}` },
  { fingerprint: `sha256:${"2".repeat(64)}` }
]);
const resetResult = await new WebsiteManagerAgent(queueClient([
  call("reset_failure_1", "build_preview", {}),
  call("reset_failure_2", "build_preview", {}),
  call("reset_different_1", "build_preview", {}),
  call("reset_different_2", "build_preview", {}),
  call("reset_mutation", "write_file", { path: "src/styles.css", content: `${cssSource}\nsection{display:block}` }),
  call("reset_finish", "finish", finishArgs())
])).run({
  buildInput,
  authoringContext,
  instruction: "Different diagnostics and source mutation reset the exact failure streak.",
  kind: "edit",
  runtime: resetRuntime
});
assert(resetResult.completion, "changed diagnostics or source mutation failed to reset the exact failure streak");

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
  costFusePersistence: "pass",
  generatedMediaCostFuse: "pass",
  terminalBoundaryCompletion: "pass",
  deterministicStallDetection: "pass",
  deterministicStallReset: "pass",
  openRouterRoute: "pass",
  perTurnCostTelemetry: "pass",
  runawayGuardrails: "pass"
}));

function runtime(options: {
  initialFiles?: WorkspaceSourceFile[];
  onBuild?: () => void;
  onInspect?: () => void;
  buildError?: Error;
  inspectionSummary?: Record<string, unknown>;
  inspectionImages?: boolean;
  inspectError?: Error;
} = {}) {
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
      if (options.buildError) throw options.buildError;
      revision += 1;
      return { revision: `sandbox_revision_${revision}`, buildDurationMs: 12, previewPath: "/private-preview" };
    },
    inspect: async () => {
      options.onInspect?.();
      if (options.inspectError) throw options.inspectError;
      return {
        passed: options.inspectionSummary ? false : true,
        inspectionHash,
        modelSummary: options.inspectionSummary ?? { ok: true, inspectionHash },
        diagnosticSummary: {
          ok: true,
          inspectionHash,
          findings: options.inspectionSummary
            ? [
                ...(Array.isArray(options.inspectionSummary.blockers) ? options.inspectionSummary.blockers : []),
                ...(Array.isArray(options.inspectionSummary.advisories) ? options.inspectionSummary.advisories : [])
              ]
            : []
        },
        images: options.inspectionImages
          ? [{ type: "input_image" as const, image_url: "data:image/png;base64,AA==", detail: "high" as const }]
          : undefined,
        checkpoint: options.inspectionSummary ? undefined : "checkpoint_passed"
      };
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

function meteredCall(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  inputTokens: number,
  outputTokens: number,
  cost: number
) {
  return {
    ...call(callId, name, args),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
      cost
    }
  };
}

function scriptedFailureRuntime(failures: Array<{ fingerprint: `sha256:${string}` }>): ManagerToolRuntime {
  let currentWorkspaceHash = workspaceHash;
  const queue = [...failures];
  return {
    stateSummary() {
      return { workspace: { hash: currentWorkspaceHash } };
    },
    async execute(toolCallValue) {
      if (toolCallValue.name === "build_preview") {
        const failure = queue.shift();
        if (!failure) throw new Error("scripted_release_failure_queue_exhausted");
        const value = {
          ok: false,
          error: "build_failed",
          workspaceHash: currentWorkspaceHash,
          failureFingerprint: failure.fingerprint
        };
        return { modelOutput: JSON.stringify(value), diagnosticOutput: value };
      }
      if (toolCallValue.name === "write_file") {
        currentWorkspaceHash = `sha256:${"7".repeat(64)}`;
        const value = { ok: true, workspaceHash: currentWorkspaceHash };
        return { modelOutput: JSON.stringify(value), diagnosticOutput: value };
      }
      if (toolCallValue.name === "finish") {
        const completion = {
          schemaVersion: "manager-completion" as const,
          ownerMessage: String(toolCallValue.arguments.ownerMessage),
          workspaceHash: currentWorkspaceHash,
          sandboxRevision: "sandbox_revision_reset",
          publicBuildInputId: buildInput.id,
          toolchainVersion: "toolchain-test",
          sandboxImageDigest: imageDigest,
          inspectionHash
        };
        return {
          modelOutput: JSON.stringify({ ok: true, completed: true }),
          diagnosticOutput: { ok: true, completed: true },
          completion
        };
      }
      const value = { ok: true, workspaceHash: currentWorkspaceHash };
      return { modelOutput: JSON.stringify(value), diagnosticOutput: value };
    }
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
