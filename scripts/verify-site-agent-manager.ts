import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import { normalizeOpenAiModelCatalog, normalizeOpenRouterModelCatalog } from "../lib/model-catalog";
import { defaultSiteAuthoringModelSettings, validateSiteAuthoringModelSettingsUpdate } from "../lib/operator-settings";
import {
  WebsiteManagerAgent,
  DeterministicManagerHistory,
  createManagerDiscussionBrief,
  createSiteAuthoringBrief,
  anthropicMessagesRequest,
  anthropicMessagesResponse,
  establishProviderAuthoringCapabilities,
  assertCompleteWorkspace,
  classifySiteAuthoringFailure,
  classifyModelProviderError,
  managerGuardrailsForKind,
  managerGuardrailsAfterPriorUsage,
  openRouterRequestHeaders,
  projectToolsForProvider,
  siteAgentRunGuardrailsForKind,
  SiteAuthoringTerminalError,
  usageForModel,
  websiteManagerSystemPrompt,
  websiteManagerTools,
  type ManagerRunEvent,
  type ManagerResponsesClient,
  type ManagerToolCall,
  type ManagerToolRuntime,
  type WorkspaceSourceFile
} from "../packages/site-agent";
import { WorkspaceManagerRuntime } from "../packages/site-platform/manager-runtime";
import { verificationBlockerFeedback } from "../packages/site-platform/verification-feedback";
import { validateWorkspaceSourcePolicy } from "../packages/site-agent/source-policy";
import { managerToolArguments } from "../packages/site-agent/contracts";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const buildInput = buildSyntheticSiteInput();
const authoringBrief = createSiteAuthoringBrief({ buildInput, snapshots: [] });
assert.deepEqual(
  authoringBrief.facts.map((fact) => fact.id).sort(),
  buildInput.publicFacts.map((fact) => fact.id).sort(),
  "the model-facing brief omitted retained public facts"
);
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
      id: "anthropic/claude-opus-5",
      name: "Claude Opus 5",
      context_length: 1_000_000,
      pricing: { prompt: "0.000005", completion: "0.00003" },
      supported_parameters: ["tools", "tool_choice", "reasoning", "structured_outputs"]
    },
    {
      id: "moonshotai/kimi-k3",
      name: "Kimi K3",
      context_length: 1_048_576,
      pricing: { prompt: "0.000001", completion: "0.000003" },
      supported_parameters: ["tools", "tool_choice", "reasoning", "structured_outputs"]
    },
    {
      id: "openai/gpt-5.6-sol",
      name: "Unestablished OpenRouter Sol",
      supported_parameters: ["tools", "tool_choice", "reasoning", "structured_outputs"]
    },
    {
      id: "example/text-only",
      name: "Text only",
      supported_parameters: ["temperature"]
    }
  ]
});
assert.equal(openRouterModels.length, 4, "OpenRouter catalog models were discarded.");
const openRouterSiteAgentModel = openRouterModels.find((model) => model.id === "anthropic/claude-opus-5");
assert.equal(openRouterSiteAgentModel?.siteAgentAvailability, "selectable", "Established Opus route was not selectable for site authoring.");
assert.equal(openRouterModels.find((model) => model.id === "moonshotai/kimi-k3")?.siteAgentAvailability, "selectable", "Established Kimi route was not selectable for site authoring.");
assert.equal(openRouterSiteAgentModel?.inputUsdPerMillion, 5, "OpenRouter input pricing was not normalized per million tokens.");
assert.equal(openRouterSiteAgentModel?.outputUsdPerMillion, 30, "OpenRouter output pricing was not normalized per million tokens.");
assert.equal(openRouterModels.find((model) => model.id === "openai/gpt-5.6-sol")?.siteAgentAvailability, "capabilities_missing", "Unknown OpenRouter routes remained selectable.");
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
assert.deepEqual(
  validateWorkspaceSourcePolicy([...files, { path: "src/alias.tsx", content: `import { Fact } from "#lodesta-sdk"; export const Alias = () => <Fact id="fact_phone" />;` }]),
  [],
  "the canonical Lodesta SDK subpath import was rejected"
);
assert(validateWorkspaceSourcePolicy([...files, { path: "src/unsafe.ts", content: `import fs from "node:fs";` }]).some((finding) => finding.id === "source.import_module"), "non-allowlisted package import passed source policy");
assert(validateWorkspaceSourcePolicy([...files, { path: "src/escape.ts", content: `import { Fact } from "../../platform/sdk";` }]).some((finding) => finding.id === "source.import_module"), "source-root traversal passed source policy");
assert(validateWorkspaceSourcePolicy([...files, { path: "src/network.ts", content: `export const value = fetch("https://example.com")` }]).some((finding) => finding.id === "source.network"), "network access passed source policy");
assert(websiteManagerSystemPrompt.includes("creative context rather than a markup protocol"), "manager prompt did not make facts contextual rather than procedural");
assert(websiteManagerSystemPrompt.includes("optional convenience components, not requirements"), "manager prompt still requires factual SDK wrappers");
assert(websiteManagerSystemPrompt.includes("checks only technical release safety and operability"), "manager prompt did not narrow the release contract");
assert(!websiteManagerSystemPrompt.includes("same visible Fact"), "obsolete route-visible fact-binding protocol remains in the prompt");
assert(!websiteManagerSystemPrompt.includes("Never hand-write or hand-format"), "obsolete phone-formatting protocol remains in the prompt");

let inspections = 0;
const managerRuntime = runtime({ onInspect: () => { inspections += 1; } });
const requests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const progress: number[] = [];
const managerEvents: ManagerRunEvent[] = [];
let rejectedOwnerActivityOpeningSpan = false;
const manager = new WebsiteManagerAgent(queueClient([
  call("create_workspace", "apply_patch", { files: [
    { path: "src/site.tsx", content: siteSource },
    { path: "src/styles.css", content: cssSource },
    { path: "src/components/Hero.tsx", content: heroSource },
    { path: "src/components/hero.css", content: heroCss }
  ] }),
  call("build", "build_preview", {}),
  call("finish", "finish", finishArgs())
], (params) => requests.push(params)));
const completed = await manager.run({
  buildInput,
  authoringBrief,
  instruction: "Create the initial site.",
  kind: "initial_build",
  route: { apiProvider: "openai", modelId: "gpt-5.6-terra" },
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
assert.equal(completed.modelId, "gpt-5.6-terra", "The manager did not retain the run-pinned initial-build model.");
assert.equal(managerRuntime.finalCheckpoint(), "checkpoint_passed");
assert.equal(inspections, 1, "finish without inspect_site did not run final verification exactly once");
assert.deepEqual(completed.toolRecords.map((record) => record.name), ["apply_patch", "build_preview", "finish"]);
assert.deepEqual(progress, [1, 2, 3]);
assert.equal(rejectedOwnerActivityOpeningSpan, true, "slow owner-visible tools did not emit a running span");
assert(managerEvents.some((event) => event.name === "build_preview" && event.status === "succeeded"), "a failed opening-span write interrupted tool execution or its terminal event");
const finishSpans = managerEvents.filter((event) => event.name === "finish");
assert.equal(finishSpans.length, 2, "slow tool spans were not opened and closed exactly once");
assert.equal(finishSpans[0]?.id, finishSpans[1]?.id, "running and terminal tool spans did not preserve event identity");
assert(requests.every((request) => toolNames(request).join(",") === "list_files,search_files,read_files,apply_patch,create_image,build_preview,inspect_site,finish"), "the model-facing authoring surface is not the intended minimal tool set");
assert(!JSON.stringify(requests[0]?.input).includes("agentAccessPolicy"), "serving-only agent policy leaked into authoring context");
assert(!JSON.stringify(requests[0]?.input).toLowerCase().includes("rawcrawl"), "raw crawl payload leaked into authoring context");
const initialPrompt = JSON.stringify(requests[0]?.input);
assert.equal(initialPrompt.match(/site-authoring-brief/g)?.length, 1, "the prompt did not contain exactly one authoring projection");
assert(!initialPrompt.includes(buildInput.inputHash), "brief provenance leaked into the model prompt");
assert(
  (requests[1]?.input as unknown as Array<Record<string, unknown>>).some((item) => item.call_id === "create_workspace"),
  "a successful patch was not retained for the following request"
);
assert(
  (requests[2]?.input as unknown as Array<Record<string, unknown>>).some((item) => item.call_id === "create_workspace"),
  "append-only replay rewrote a successful prior patch"
);
for (let index = 1; index < requests.length; index += 1) {
  const previous = requests[index - 1]!.input as unknown[];
  const current = requests[index]!.input as unknown[];
  assert.deepEqual(
    current.slice(0, previous.length),
    previous,
    `request ${index + 1} did not preserve the complete prior request as an exact prefix`
  );
}
assert(requests.every((request) => stableJson((request.input as unknown[])[0]) === stableJson((requests[0]?.input as unknown[])[0])), "the stable prompt prefix changed across turns");
assert(requests.every((request) => request.reasoning?.effort === "high"), "website-manager reasoning effort drifted from high");
assert(requests.every((request) => request.text?.verbosity === "low"), "website-manager text verbosity drifted from low");
assert(requests.every((request) => request.model === "gpt-5.6-terra"), "A manager request drifted from the run-pinned initial-build model.");
assert(requests.every((request) => request.prompt_cache_options?.mode === "implicit" && request.prompt_cache_options.ttl === "30m"), "GPT-5.6 cache options were not applied consistently.");
assert(requests.every((request) => typeof request.prompt_cache_key === "string" && request.prompt_cache_key === requests[0]?.prompt_cache_key), "The non-PII prompt cache key changed within a run.");
assert(
  JSON.stringify(requests[0]?.input).includes('"prompt_cache_breakpoint":{"mode":"explicit"}'),
  "The stable authoring prefix omitted its explicit GPT-5.6 cache breakpoint."
);
const succeededModelEvents = managerEvents.filter((event) => event.kind === "model_request" && event.status === "succeeded");
assert.equal(new Set(succeededModelEvents.map((event) => event.summary.stablePrefixHash)).size, 1, "stable-prefix telemetry changed across requests");
assert(succeededModelEvents.every((event) => typeof event.summary.activeTailBytes === "number"), "active-tail telemetry was not recorded");
assert.equal(typeof succeededModelEvents[0]?.summary.initialPromptBytes, "number", "initial prompt telemetry was not recorded");
assert.equal((succeededModelEvents[0]?.payload?.request as Record<string, unknown>)?.briefProvenance === undefined, false, "authoring brief provenance was not retained outside the prompt");
assert.equal(completed.telemetry.modelRequests, 3);
assert.equal(completed.telemetry.firstSuccessfulBuildMs !== undefined, true);

const discussionBrief = createManagerDiscussionBrief({
  buildInput,
  message: "Make the hero calmer.",
  selection: { route: "/", label: "Hero" },
  currentFiles: files
});
assert(!JSON.stringify(discussionBrief).includes(heroSource), "manager discussion retained complete workspace source bodies");
assert.equal(discussionBrief.workspace?.files.find((file) => file.path === "src/components/Hero.tsx")?.bytes, Buffer.byteLength(heroSource));
assert.deepEqual(discussionBrief.routes.current, ["/"]);

const testOpenRouterCatalog = async () => ({
  provider: "openrouter" as const,
  fetchedAt: "2026-07-26T00:00:00.000Z",
  models: [{
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    contextLength: 1_000_000,
    siteAgentAvailability: "selectable" as const
  }, {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    contextLength: 1_048_576,
    siteAgentAvailability: "selectable" as const
  }, {
    id: "example/unpriced-authoring-model",
    name: "Unpriced fixture",
    contextLength: 128_000,
    siteAgentAvailability: "selectable" as const
  }]
});
const capabilityOne = await establishProviderAuthoringCapabilities("openrouter", "anthropic/claude-opus-5", { loadOpenRouterCatalog: testOpenRouterCatalog });
const capabilityTwo = await establishProviderAuthoringCapabilities("openrouter", "anthropic/claude-opus-5", { loadOpenRouterCatalog: testOpenRouterCatalog });
assert.equal(capabilityOne.descriptor.schemaVersion, 1);
assert.equal(capabilityOne.descriptor.contextWindowTokens, 1_000_000);
assert.equal(capabilityOne.check.checkedAt, capabilityTwo.check.checkedAt, "provider capability checks were not cached by route and descriptor");
assert.equal(capabilityOne.descriptor.requestFields.parallel_tool_calls, "translated");
assert.equal(capabilityOne.descriptor.requestFields.provider_require_parameters, "stripped");
assert.notEqual(capabilityOne.descriptor.descriptorIdentity, capabilityOne.descriptor.probeIdentity, "declared configuration and observed probe evidence were conflated.");
assert.equal(
  openRouterRequestHeaders(capabilityOne.descriptor)["x-anthropic-beta"],
  "structured-outputs-2025-11-13",
  "Opus lost the strict-tool beta header."
);
const kimiCapability = await establishProviderAuthoringCapabilities("openrouter", "moonshotai/kimi-k3", { loadOpenRouterCatalog: testOpenRouterCatalog });
assert.equal(openRouterRequestHeaders(kimiCapability.descriptor)["x-anthropic-beta"], undefined, "Kimi received an Anthropic-only header.");
const opusToolProjection = JSON.stringify(projectToolsForProvider(websiteManagerTools, capabilityOne.descriptor));
assert(!opusToolProjection.includes('"pattern"'), "Anthropic received a regex constraint unsupported by strict tool use.");
assert(!opusToolProjection.includes('"minLength"') && !opusToolProjection.includes('"maxItems"'), "Anthropic received unsupported strict-schema bounds.");
assert(opusToolProjection.includes("Must match"), "Removed Anthropic constraints were not retained as tool guidance.");
assert(JSON.stringify(projectToolsForProvider(websiteManagerTools, kimiCapability.descriptor)).includes('"pattern"'), "Kimi's established tool schema was unnecessarily weakened.");

const adapterRequest = anthropicMessagesRequest({
  model: "anthropic/claude-opus-5",
  instructions: "Author a verified site.",
  input: [{
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: "Stable authoring brief." },
      {
        type: "input_image",
        image_url: "data:image/png;base64,aGVsbG8=",
        detail: "high",
        prompt_cache_breakpoint: { mode: "explicit" }
      }
    ]
  }, {
    type: "function_call",
    call_id: "adapter_previous_call",
    name: "list_files",
    arguments: "{}"
  }, {
    type: "function_call_output",
    call_id: "adapter_previous_call",
    output: JSON.stringify({ ok: true, files: [] })
  }, {
    type: "message",
    role: "user",
    content: [{
      type: "input_text",
      text: "Current deterministic workspace state.",
      prompt_cache_breakpoint: { mode: "explicit" }
    }]
  }],
  tools: projectToolsForProvider(websiteManagerTools, capabilityOne.descriptor),
  tool_choice: "required",
  parallel_tool_calls: false,
  store: false,
  reasoning: { effort: "high" },
  max_output_tokens: 4096,
  provider: {
    only: ["amazon-bedrock"],
    allow_fallbacks: false,
    data_collection: "deny",
    zdr: true
  },
  session_id: "adapter-session"
} as never) as Record<string, unknown>;
assert.equal(adapterRequest.model, "anthropic/claude-opus-5");
assert.equal(countOccurrences(adapterRequest, "cache_control"), 2, "Anthropic Messages did not receive exactly the stable and rolling cache controls.");
assert.equal(countOccurrences(adapterRequest, "prompt_cache_breakpoint"), 0, "An internal Responses cache marker leaked onto the Anthropic wire.");
assert.equal(countOccurrences(adapterRequest, "strict"), websiteManagerTools.length, "Strict tool declarations were lost in Anthropic translation.");
assert.equal((adapterRequest.tool_choice as Record<string, unknown>)?.type, "any");
assert.equal((adapterRequest.tool_choice as Record<string, unknown>)?.disable_parallel_tool_use, true);
assert.equal((adapterRequest.provider as Record<string, unknown>)?.zdr, true);
assert.equal(adapterRequest.session_id, "adapter-session");
assert.equal(adapterRequest.store, undefined, "A Responses-only store field leaked onto the Anthropic wire.");
assert.equal(adapterRequest.parallel_tool_calls, undefined, "A Responses-only parallel_tool_calls field leaked onto the Anthropic wire.");

const adapterResponse = anthropicMessagesResponse({
  id: "msg_adapter",
  model: "anthropic/claude-opus-5",
  stop_reason: "tool_use",
  content: [{
    type: "thinking",
    thinking: "Inspect the workspace.",
    signature: "retained-signature"
  }, {
    type: "tool_use",
    id: "adapter_call",
    name: "list_files",
    input: {}
  }],
  usage: {
    input_tokens: 100,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 80,
    output_tokens: 12,
    cost: 0.123,
    cost_details: { upstream_inference_cost: 0.1 }
  },
  openrouter_metadata: {
    endpoints: { available: [{ selected: true, provider: "Amazon Bedrock" }] }
  }
});
assert.equal(adapterResponse.usage.input_tokens, 200, "Anthropic input accounting did not include cache reads and writes.");
assert.equal(adapterResponse.usage.input_tokens_details.cached_tokens, 80);
assert.equal(adapterResponse.usage.input_tokens_details.cache_write_tokens, 20);
assert.equal(adapterResponse.usage.cost, 0.123);
assert(adapterResponse.output.some((item) => (item as unknown as Record<string, unknown>).type === "anthropic_thinking"), "Anthropic thinking was not retained for explicit replay.");
assert(adapterResponse.output.some((item) => item.type === "function_call"), "Anthropic tool use was not normalized for the manager.");
const adapterReplay = anthropicMessagesRequest({
  model: "anthropic/claude-opus-5",
  instructions: "Author a verified site.",
  input: [
    { type: "message", role: "user", content: "Continue." },
    ...adapterResponse.output,
    {
      type: "function_call_output",
      call_id: "adapter_call",
      output: JSON.stringify({ ok: true, files: [] })
    }
  ],
  tools: projectToolsForProvider(websiteManagerTools, capabilityOne.descriptor),
  tool_choice: "required",
  parallel_tool_calls: false,
  max_output_tokens: 4096,
  provider: { only: ["amazon-bedrock"], allow_fallbacks: false, zdr: true }
} as never);
assert.equal(countOccurrences(adapterReplay, "signature"), 1, "Signed Anthropic thinking did not survive replay.");
assert.equal(countOccurrences(adapterReplay, "tool_use_id"), 1, "Anthropic tool output did not survive replay.");
let unknownOpenRouterRequests = 0;
let unknownOpenRouterFailure: unknown;
try {
  await new WebsiteManagerAgent(queueClient([
    call("unknown_route_must_not_run", "list_files", {})
  ], () => { unknownOpenRouterRequests += 1; }), testOpenRouterCatalog).run({
    buildInput,
    authoringBrief,
    instruction: "Reject unestablished OpenRouter authoring routes before inference.",
    kind: "edit",
    route: { apiProvider: "openrouter", modelId: "openai/gpt-5.6-sol" },
    runtime: runtime({ initialFiles: files })
  });
} catch (error) {
  unknownOpenRouterFailure = error;
}
assert(
  unknownOpenRouterFailure instanceof SiteAuthoringTerminalError
    && unknownOpenRouterFailure.message.startsWith("provider_authoring_capabilities_missing:"),
  "An unestablished OpenRouter route did not fail before authoring."
);
assert.equal(unknownOpenRouterRequests, 0, "An unestablished OpenRouter route reached the provider.");

const parallelResponse = call("parallel_one", "list_files", {});
parallelResponse.output.push({
  type: "function_call",
  call_id: "parallel_two",
  name: "read_files",
  arguments: JSON.stringify({ files: [{ path: "src/site.tsx", startLine: null, endLine: null }] }),
  status: "completed"
});
let parallelToolExecutions = 0;
const parallelBaseRuntime = runtime({ initialFiles: files });
const parallelCompleted = await new WebsiteManagerAgent(queueClient([
  parallelResponse,
  call("parallel_build", "build_preview", {}),
  call("parallel_finish", "finish", finishArgs())
])).run({
  buildInput,
  authoringBrief,
  instruction: "Continue safely when a provider returns several read-only calls.",
  kind: "edit",
  route: { apiProvider: "openai", modelId: "gpt-5.6-terra" },
  runtime: {
    stateSummary: () => parallelBaseRuntime.stateSummary(),
    execute: async (toolCallValue) => {
      parallelToolExecutions += 1;
      return parallelBaseRuntime.execute(toolCallValue);
    }
  }
});
assert.equal(parallelCompleted.telemetry.parallelToolViolations, 1, "provider multi-call behavior was not recorded.");
assert.equal(parallelToolExecutions, 4, "multiple read-only calls were not executed serially before completion.");

const parallelMutation = call("parallel_mutation_one", "write_file", { path: "src/styles.css", content: `${cssSource}\n/* first mutation */` });
parallelMutation.output.push({
  type: "function_call",
  call_id: "parallel_mutation_two",
  name: "write_file",
  arguments: JSON.stringify({ path: "src/site.tsx", content: "export const shouldNotExecute = true;" }),
  status: "completed"
});
const mutationRuntime = runtime({ initialFiles: files });
const mutationCompleted = await new WebsiteManagerAgent(queueClient([
  parallelMutation,
  call("parallel_mutation_build", "build_preview", {}),
  call("parallel_mutation_finish", "finish", finishArgs())
])).run({
  buildInput,
  authoringBrief,
  instruction: "Execute only the first mutation from an unexpected multi-call response.",
  kind: "edit",
  route: { apiProvider: "openai", modelId: "gpt-5.6-terra" },
  runtime: mutationRuntime
});
assert.equal(mutationCompleted.telemetry.parallelToolViolations, 1);
assert.equal(mutationRuntime.currentFiles().find((file) => file.path === "src/site.tsx")?.content, siteSource, "a deferred parallel mutation reached the workspace.");
assert.equal(mutationCompleted.toolRecords.find((record) => record.callId === "parallel_mutation_two")?.output.error, "deferred_due_to_serial_tool_contract");

const compactHistory = new DeterministicManagerHistory([{
  role: "user",
  type: "message",
  content: [{ type: "input_text", text: "stable" }]
}]);
const readResponse = [{ type: "function_call", call_id: "read_history", name: "read_files", arguments: JSON.stringify({ files: [{ path: "src/site.tsx", startLine: null, endLine: null }] }) }] as never;
const readOutput = { type: "function_call_output", call_id: "read_history", output: JSON.stringify({ ok: true, files: [{ ok: true, path: "src/site.tsx", contentHash: sha256(siteSource), content: siteSource }] }) } as never;
compactHistory.noteTool({
  responseItems: readResponse,
  functionOutput: readOutput,
  responseIndex: 1,
  callId: "read_history",
  toolName: "read_files",
  status: "succeeded",
  arguments: { files: [{ path: "src/site.tsx", startLine: null, endLine: null }] },
  diagnostic: { ok: true, files: [{ ok: true, path: "src/site.tsx", contentHash: sha256(siteSource), startLine: 1, endLine: 4, bytes: Buffer.byteLength(siteSource) }] },
  workspaceHashBefore: workspaceHash,
  workspaceHashAfter: workspaceHash,
  workspaceMutated: false
});
assert(
  compactHistory.activeTailItems(2).some((item) =>
    item.type === "function_call_output" && item.call_id === "read_history"),
  "raw read output did not survive until a subsequent mutation or build"
);
compactHistory.noteTool({
  responseItems: [] as never,
  functionOutput: { type: "function_call_output", call_id: "build_history", output: JSON.stringify({ ok: true }) } as never,
  responseIndex: 2,
  callId: "build_history",
  toolName: "build_preview",
  status: "succeeded",
  arguments: {},
  diagnostic: { ok: true, workspaceHash },
  workspaceHashBefore: workspaceHash,
  workspaceHashAfter: workspaceHash,
  workspaceMutated: false
});
assert(
  compactHistory.activeTailItems(3).some((item) =>
    item.type === "function_call_output" && item.call_id === "read_history"),
  "append-only history rewrote a raw read at a build boundary"
);
compactHistory.noteTool({
  responseItems: readResponse,
  functionOutput: readOutput,
  responseIndex: 3,
  callId: "read_history_again",
  toolName: "read_files",
  status: "succeeded",
  arguments: { files: [{ path: "src/site.tsx", startLine: null, endLine: null }] },
  diagnostic: { ok: true, files: [{ ok: true, path: "src/site.tsx", contentHash: sha256(siteSource), startLine: 1, endLine: 4, bytes: Buffer.byteLength(siteSource) }] },
  workspaceHashBefore: workspaceHash,
  workspaceHashAfter: workspaceHash,
  workspaceMutated: false
});
assert.equal(compactHistory.unchangedPathRereads(), 1, "an unchanged path reread was not counted");
const imageHistory = new DeterministicManagerHistory([]);
const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
imageHistory.noteTool({
  responseItems: [{
    type: "function_call",
    call_id: "image_history",
    name: "create_image",
    arguments: JSON.stringify({ purpose: "hero", alt: "Abstract texture" })
  }] as never,
  functionOutput: {
    type: "function_call_output",
    call_id: "image_history",
    output: [
      { type: "input_text", text: JSON.stringify({ ok: true, assetId: "asset_history" }) },
      { type: "input_image", image_url: `data:image/png;base64,${onePixelPng}`, detail: "high" }
    ]
  } as never,
  responseIndex: 1,
  callId: "image_history",
  toolName: "create_image",
  status: "succeeded",
  arguments: { purpose: "hero", alt: "Abstract texture" },
  diagnostic: { ok: true, assetId: "asset_history", contentHash: sha256(Buffer.from(onePixelPng, "base64")) },
  workspaceHashBefore: workspaceHash,
  workspaceHashAfter: workspaceHash,
  workspaceMutated: false
});
assert(JSON.stringify(imageHistory.activeTailItems(2)).includes(onePixelPng), "new image pixels were not retained for one following request");
assert(JSON.stringify(imageHistory.activeTailItems(3)).includes(onePixelPng), "append-only history discarded retained image pixels");
assert.deepEqual(
  classifySiteAuthoringFailure(new Error("workspace_uninitialized: sandbox revision is uninitialized")),
  {
    code: "sandbox_unavailable",
    category: "platform",
    retryableByOwner: false,
    message: "workspace_uninitialized: sandbox revision is uninitialized"
  },
  "an uninitialized sandbox revision was classified as a model failure"
);

const verificationFeedback = verificationBlockerFeedback([
  ...Array.from({ length: 105 }, (_, index) => ({
    code: `blocker_${index}`,
    severity: "error",
    route: index % 2 === 0 ? "/" : "/services",
    area: "functional",
    message: `Actionable blocker ${index}.`
  })),
  {
    code: "blocker_0",
    severity: "ERROR",
    route: "/",
    area: "functional",
    message: "  Actionable   blocker 0.  "
  }
]);
assert.equal(verificationFeedback.uniqueBlockerCount, 105, "verification blockers were not deduplicated before the cap");
assert.equal(verificationFeedback.returnedBlockerCount, 100, "verification feedback did not retain the existing 100-blocker cap");
assert.equal(verificationFeedback.blockersTruncated, true, "truncated verification feedback did not disclose truncation");

let buildCalls = 0;
let inspectCalls = 0;
const direct = runtime({ initialFiles: files, onBuild: () => { buildCalls += 1; }, onInspect: () => { inspectCalls += 1; } });
const listed = output(await direct.execute(toolCall("list", "list_files", {})));
assert.equal((listed.files as unknown[]).length, 4);
const searched = output(await direct.execute(toolCall("search", "search_files", {
  query: "collision repair",
  paths: [],
  caseSensitive: false
})));
assert((searched.matches as unknown[]).length >= 1, "workspace search did not find literal source text");
const read = output(await direct.execute(toolCall("read", "read_files", { files: [
  { path: "src/components/Hero.tsx", startLine: null, endLine: null },
  { path: "src/components/hero.css", startLine: 1, endLine: 1 }
] })));
assert.equal((read.files as unknown[]).length, 2, "batched source read did not return every requested file.");
const readHero = (read.files as Array<Record<string, unknown>>)[0]!;
assert(JSON.stringify(readHero.lines).includes("function Hero"));
const editedHero = await direct.execute(toolCall("edit", "edit_file", {
  path: "src/components/Hero.tsx",
  expectedContentHash: readHero.contentHash,
  edits: [{ startLine: 2, endLine: 2, content: "  return <header className=\"hero hero--edited\">Welcome</header>;" }]
}));
assert.equal(output(editedHero).unchanged, false, "targeted edit did not mutate its exact line.");
assert(direct.currentFiles().find((file) => file.path === "src/components/Hero.tsx")?.content.includes("hero--edited"));
const staleEdit = output(await direct.execute(toolCall("stale_edit", "edit_file", {
  path: "src/components/Hero.tsx",
  expectedContentHash: readHero.contentHash,
  edits: [{ startLine: 2, endLine: 2, content: "  return <header>Stale</header>;" }]
})));
assert.equal(staleEdit.error, "workspace_file_changed", "stale targeted edit changed source instead of failing.");
const overlappingEdit = output(await direct.execute(toolCall("overlap_edit", "edit_file", {
  path: "src/components/Hero.tsx",
  expectedContentHash: output(editedHero).contentHash,
  edits: [
    { startLine: 1, endLine: 2, content: "export function Hero() {" },
    { startLine: 2, endLine: 2, content: "  return <header>Overlap</header>;" }
  ]
})));
assert.equal(overlappingEdit.error, "invalid_targeted_edit", "overlapping targeted edits were accepted.");
await direct.execute(toolCall("restore_after_edit_test", "write_file", { path: "src/components/Hero.tsx", content: heroSource }));
await direct.execute(toolCall("build_1", "build_preview", {}));
assert.equal(output(await direct.execute(toolCall("build_2", "build_preview", {}))).cached, true);
assert.equal(buildCalls, 1, "unchanged build was rerun");
assert.equal(output(await direct.execute(toolCall("inspect_1", "inspect_site", {}))).cached, false);
assert.equal(output(await direct.execute(toolCall("inspect_2", "inspect_site", {}))).cached, true);
assert.equal(inspectCalls, 1, "unchanged verification was rerun");

const retainedBuildRuntime = runtime({ initialFiles: files });
await retainedBuildRuntime.execute(toolCall("retained_build", "build_preview", {}));
await retainedBuildRuntime.execute(toolCall("post_build_mutation", "apply_patch", {
  files: [{ path: "src/styles.css", content: `${cssSource}\n.unfinished{display:none}` }]
}));
assert.equal(retainedBuildRuntime.hasAssessableBuild(), true, "a later mutation discarded the last successful build");
assert.equal(retainedBuildRuntime.restoreLastSuccessfulBuild(), true, "the last successful build could not be restored for assessment");
assert.equal(
  retainedBuildRuntime.currentFiles().find((file) => file.path === "src/styles.css")?.content,
  cssSource,
  "restoring the last successful build retained unfinished source"
);

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
const compactInspectionExecution = await compactRuntime.execute(toolCall("compact_inspection", "finish", finishArgs()));
const compactInspection = output(compactInspectionExecution);
assert.equal(compactInspection.buildPerformed, false, "verification failure misreported an unnecessary build.");
assert(!("findings" in compactInspection), "inspection repeated the full finding set in model context");
assert.equal((compactInspection.blockers as unknown[]).length, 1, "inspection omitted a hard blocker");
assert(!("advisories" in compactInspection), "failed inspection sent subjective advisories alongside blockers");
assert.equal(compactInspection.advisoryCount, 12, "inspection lost the full advisory count");
assert.equal(compactInspection.advisoriesOmitted, true, "inspection did not disclose omitted advisory context");
assert(Array.isArray(compactInspectionExecution.diagnosticOutput.findings), "operator diagnostics lost the complete finding set");
const cachedCompactInspection = output(await compactRuntime.execute(toolCall("compact_inspection_cached", "finish", finishArgs())));
assert.equal(cachedCompactInspection.cached, true, "failed inspection was not served from the workspace-hash cache");
assert(String(cachedCompactInspection.guidance).includes("every affected occurrence"), "cached inspection failure omitted grouped cross-route repair guidance");
assert.equal(failedInspectionCalls, 1, "unchanged failed inspection reran verification");
await compactRuntime.execute(toolCall("compact_inspection_mutation", "write_file", { path: "src/styles.css", content: `${cssSource}\narticle{display:block}` }));
await compactRuntime.execute(toolCall("compact_build_after_mutation", "build_preview", {}));
await compactRuntime.execute(toolCall("compact_inspection_after_mutation", "finish", finishArgs()));
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
const automaticBuildFailure = output(await failedBuildRuntime.execute(toolCall("failed_finish_build", "finish", finishArgs())));
assert.equal(automaticBuildFailure.failureStage, "compilation", "finish did not identify its compilation failure stage.");
assert.equal(automaticBuildFailure.buildPerformed, true, "finish did not report its attempted automatic build.");
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
const claimInspection = await claimBlockerRuntime.execute(toolCall("claim_inspect", "finish", finishArgs()));
assert.equal(typeof claimInspection.modelOutput, "string", "nonvisual blocker attached a verification image");
assert(String(output(claimInspection).guidance).includes("every affected occurrence"), "first finish failure omitted grouped cross-route repair guidance");

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
const visualInspection = await visualBlockerRuntime.execute(toolCall("visual_inspect", "finish", finishArgs()));
assert(Array.isArray(visualInspection.modelOutput), "visual blocker omitted the verification image");

const exactEditCss = heroCss.replace("2rem", "2.25rem");
await direct.execute(toolCall("exact_edit", "write_file", { path: "src/components/hero.css", content: exactEditCss }));
assert.equal(direct.currentFiles().find((file) => file.path === "src/components/Hero.tsx")?.content, heroSource, "exact style edit broadened into unrelated source");
const finishedAfterEdit = await direct.execute(toolCall("finish_stale", "finish", finishArgs()));
assert(finishedAfterEdit.completion, "finish did not build, verify, and retain the edited workspace");
assert.equal(finishedAfterEdit.diagnosticOutput.buildPerformed, true, "finish did not report its automatic build.");
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
assert.equal(
  managerToolArguments.finish.parse({ ownerMessage: "x".repeat(1_500) }).ownerMessage.length,
  1_200,
  "an overlong non-factual completion note can still derail an otherwise valid candidate"
);
await clarificationRuntime.execute(toolCall("clarify_mutation", "write_file", { path: "src/site.tsx", content: siteSource }));
assert.equal(output(await clarificationRuntime.execute(toolCall("clarify_late", "request_input", { question: "Which phone number should be primary?" }))).error, "input_can_only_be_requested_before_workspace_mutation");

const recoveryRuntime = runtime();
const recovery = await new WebsiteManagerAgent(queueClient([
  call("bad_read", "read_files", { files: [{ path: "src/site.tsx", startLine: "bad", endLine: null }] }),
  call("recover_site", "write_file", { path: "src/site.tsx", content: siteSource }),
  call("recover_styles", "write_file", { path: "src/styles.css", content: cssSource }),
  call("recover_hero", "apply_patch", { files: [
    { path: "src/components/Hero.tsx", content: heroSource },
    { path: "src/components/hero.css", content: heroCss }
  ] }),
  call("recover_build", "build_preview", {}),
  call("recover_finish", "finish", finishArgs())
])).run({ buildInput, authoringBrief, instruction: "Recover from a malformed tool call.", kind: "initial_build", runtime: recoveryRuntime });
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
assert.equal(usageForModel("gpt-5.6-sol", {
  input_tokens: 1_000,
  input_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
  output_tokens: 100
}, 25).costUsd, 0.004525, "cache writes were not charged at 1.25× the uncached input rate");
const quotaFailure = classifyModelProviderError({ status: 429, error: { code: "insufficient_quota" } });
assert(quotaFailure.code === "provider_quota_exhausted" && !quotaFailure.retryableByOwner, "quota exhaustion was exposed as owner-retryable");
const openRouterCreditsFailure = classifyModelProviderError({ status: 402, error: { code: 402, message: "Insufficient credits" } });
assert(openRouterCreditsFailure.code === "provider_quota_exhausted" && !openRouterCreditsFailure.retryableByOwner, "OpenRouter credit exhaustion lost its provider quota classification");
const transientProviderFailure = classifyModelProviderError({ status: 429, error: { code: "rate_limit_exceeded" } });
assert(transientProviderFailure.code === "provider_temporarily_unavailable" && transientProviderFailure.retryableByOwner, "temporary provider rate limit was not retryable");
const contextFailure = classifyModelProviderError({ status: 400, error: { code: "context_length_exceeded", message: "Maximum context length exceeded." } });
assert(contextFailure.code === "context_capacity_exhausted" && !contextFailure.retryableByOwner, "context overflow remained an unknown provider failure.");
const outputFailure = classifyModelProviderError(new Error("manager_model_incomplete:max_output_tokens"));
assert(outputFailure.code === "output_budget_exhausted" && outputFailure.category === "budget", "maximum output exhaustion was conflated with context capacity.");

const contextEvents: ManagerRunEvent[] = [];
const contextGuardRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
let contextGuardFailure: unknown;
try {
  await new WebsiteManagerAgent(queueClient([
    meteredCall("context_guard_read", "list_files", {}, 990_000, 10, 0.01),
    call("context_guard_must_not_run", "finish", finishArgs())
  ], (params) => contextGuardRequests.push(params))).run({
    buildInput,
    authoringBrief,
    instruction: "Stop before issuing a request known to exceed usable context capacity.",
    kind: "edit",
    route: { apiProvider: "openai", modelId: "gpt-5.6-sol" },
    runtime: runtime({ initialFiles: files }),
    onEvents: async (events) => { contextEvents.push(...events); }
  });
} catch (error) {
  contextGuardFailure = error;
}
assert(contextGuardFailure instanceof SiteAuthoringTerminalError && contextGuardFailure.code === "context_capacity_exhausted");
assert.equal(contextGuardRequests.length, 1, "a known-impossible next context request reached the provider.");
assert(contextEvents.some((event) => event.name === "context.capacity.warning"), "80% context utilization did not emit a warning event.");

const previousModelOverride = process.env.LODESTA_SITE_AGENT_MODEL;
let unpricedModelRequests = 0;
let unpricedModelFailure: unknown;
process.env.LODESTA_SITE_AGENT_MODEL = "unpriced-site-agent-model";
try {
  await new WebsiteManagerAgent(queueClient([
    call("must_not_run_unpriced", "list_files", {})
  ], () => { unpricedModelRequests += 1; })).run({
    buildInput,
    authoringBrief,
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
process.env.LODESTA_SITE_AGENT_MODEL = "moonshotai/kimi-k3";
let openRouterResult: Awaited<ReturnType<WebsiteManagerAgent["run"]>> | undefined;
try {
  openRouterResult = await new WebsiteManagerAgent(queueClient([
    {
      ...call("openrouter_build", "build_preview", {}),
      id: "gen_openrouter_turn_1",
      model: "moonshotai/kimi-k3",
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
        endpoints: { available: [{ provider: "Moonshot AI", model: "moonshotai/kimi-k3", selected: true }] }
      }
    },
    {
      ...call("openrouter_finish", "finish", finishArgs()),
      id: "gen_openrouter_turn_2",
      model: "moonshotai/kimi-k3",
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
        endpoints: { available: [{ provider: "Moonshot AI", model: "moonshotai/kimi-k3", selected: true }] }
      }
    }
  ], (params) => openRouterRequests.push(params)), testOpenRouterCatalog).run({
    buildInput,
    authoringBrief,
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
  provider?: { only?: string[]; allow_fallbacks?: boolean; data_collection?: string; zdr?: boolean; require_parameters?: boolean };
  session_id?: string;
};
const routedProvider = (routedRequest as unknown as {
  provider?: { only?: string[]; allow_fallbacks?: boolean; data_collection?: string; zdr?: boolean; require_parameters?: boolean };
}).provider;
assert.equal(routedProvider?.require_parameters, undefined, "The broken OpenRouter Responses parameter filter was reintroduced.");
assert.deepEqual(routedProvider, {
  only: ["moonshotai"],
  allow_fallbacks: true,
  data_collection: "deny",
  zdr: true
});
assert.equal(routedRequest.session_id, "run_openrouter_test");
assert.equal(routedRequest.include, undefined, "OpenAI encrypted-reasoning transport fields leaked into OpenRouter.");
assert.equal(routedRequest.parallel_tool_calls, false, "OpenRouter did not receive the documented serial-tool control.");
assert.equal(routedRequest.store, false, "OpenRouter did not receive the documented stateless storage control.");
assert.equal(routedRequest.text?.verbosity, "low", "OpenRouter did not receive the supported text verbosity control.");
assert.equal(routedRequest.reasoning?.effort, "high", "Portable OpenRouter reasoning effort was removed.");
assert.equal(routedRequest.tool_choice, "required", "Portable OpenRouter tool choice was removed.");
assert(!JSON.stringify(routedRequest.input).includes("prompt_cache_breakpoint"), "Kimi received Anthropic cache breakpoints.");
const billedTurn = openRouterEvents.find((event) => event.kind === "model_request" && event.status === "succeeded");
assert(billedTurn, "OpenRouter model turn telemetry was not emitted.");
assert.equal(billedTurn.apiProvider, "openrouter");
assert.equal(billedTurn.upstreamProvider, "Moonshot AI");
assert.equal(billedTurn.providerRequestId, "gen_openrouter_turn_1");
assert.equal(billedTurn.costUsd, 0.0015);
assert.equal(billedTurn.costSource, "provider_reported");
assert.equal(billedTurn.upstreamInferenceCostUsd, 0.0012);

let kimiTransportAttempts = 0;
const kimiRetryEvents: ManagerRunEvent[] = [];
const kimiRetryResult = await new WebsiteManagerAgent({
  async create() {
    kimiTransportAttempts += 1;
    if (kimiTransportAttempts === 1) {
      throw Object.assign(new Error("Provider returned error"), {
        status: 429,
        headers: new Headers({ "Retry-After": "0" })
      });
    }
    if (kimiTransportAttempts === 2) throw new SyntaxError("Unexpected end of JSON input");
    return {
      ...meteredCall("kimi_retry_finish", "finish", finishArgs(), 40, 10, 0.002),
      id: "gen_kimi_retry_success",
      model: "moonshotai/kimi-k3",
      openrouter_metadata: {
        endpoints: { available: [{ provider: "Moonshot AI", model: "moonshotai/kimi-k3", selected: true }] }
      }
    } as never;
  }
}, testOpenRouterCatalog).run({
  buildInput,
  authoringBrief,
  runId: "run_kimi_transport_retry_test",
  instruction: "Retain the run across temporary Moonshot rate limits.",
  kind: "edit",
  route: { apiProvider: "openrouter", modelId: "moonshotai/kimi-k3" },
  runtime: runtime({ initialFiles: files }),
  onEvents: async (events) => { kimiRetryEvents.push(...events); }
});
assert(kimiRetryResult.completion, "Kimi did not resume the same authoring turn after temporary 429 responses.");
assert.equal(kimiTransportAttempts, 3, "Kimi did not use the established delayed retry allowance.");
assert(
  kimiRetryEvents.some((event) => event.kind === "model_request" && event.status === "succeeded" && event.summary.transportRetries === 2),
  "Kimi transport retry count was not retained on the successful model request."
);

const opusRequests: Array<Parameters<ManagerResponsesClient["create"]>[0]> = [];
const opusEvents: ManagerRunEvent[] = [];
const opusResult = await new WebsiteManagerAgent(queueClient([
  {
    ...call("opus_build", "build_preview", {}),
    id: "gen_opus_turn_1",
    model: "anthropic/claude-opus-5",
    usage: {
      input_tokens: 20,
      output_tokens: 8,
      total_tokens: 28,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 16 },
      output_tokens_details: { reasoning_tokens: 3 },
      cost: 0.002
    },
    openrouter_metadata: {
      endpoints: { available: [{ provider: "Amazon Bedrock", model: "anthropic/claude-opus-5", selected: true }] }
    }
  },
  {
    ...call("opus_finish", "finish", finishArgs()),
    id: "gen_opus_turn_2",
    model: "anthropic/claude-opus-5",
    usage: {
      input_tokens: 30,
      output_tokens: 10,
      total_tokens: 40,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 6 },
      output_tokens_details: { reasoning_tokens: 4 },
      cost: 0.0025
    },
    openrouter_metadata: {
      endpoints: { available: [{ provider: "Google", model: "anthropic/claude-opus-5", selected: true }] }
    }
  }
], (params) => opusRequests.push(params)), testOpenRouterCatalog).run({
  buildInput,
  authoringBrief,
  runId: "run_opus_projection_test",
  instruction: "Exercise the established Opus route.",
  kind: "initial_build",
  route: { apiProvider: "openrouter", modelId: "anthropic/claude-opus-5" },
  runtime: runtime({ initialFiles: files }),
  onEvents: async (events) => { opusEvents.push(...events); }
});
assert.equal(opusResult.telemetry.upstreamChanges, 1, "An eligible OpenRouter upstream change was not recorded.");
assert.equal(opusRequests.length, 2);
for (const request of opusRequests) {
  assert(!toolNames(request).includes("request_input"), "Opus initial generation retained the unavailable request_input tool.");
  assert.equal(countOccurrences(request.input, "prompt_cache_breakpoint"), 2, "Opus did not receive exactly one stable and one rolling breakpoint.");
  assert.equal(request.prompt_cache_key, undefined, "OpenAI top-level cache keys leaked into Opus.");
  assert.equal(request.prompt_cache_options, undefined, "OpenAI top-level cache options leaked into Opus.");
  const provider = (request as typeof request & { provider?: { only?: string[]; require_parameters?: boolean } }).provider;
  assert.deepEqual(provider?.only, ["amazon-bedrock", "google-vertex"]);
  assert.equal(provider?.require_parameters, undefined);
}
assert(
  opusEvents.some((event) => event.kind === "model_request" && event.status === "succeeded" && event.summary.upstreamChanged === true),
  "An eligible upstream fallback was not retained as a diagnostic."
);

const unavailableCostProviderOverride = process.env.LODESTA_SITE_AGENT_PROVIDER;
const unavailableCostModelOverride = process.env.LODESTA_SITE_AGENT_MODEL;
const unavailableCostBaseRuntime = runtime({ initialFiles: files });
let unavailableCostToolCalls = 0;
let unavailableCostFailure: unknown;
process.env.LODESTA_SITE_AGENT_PROVIDER = "openrouter";
process.env.LODESTA_SITE_AGENT_MODEL = "moonshotai/kimi-k3";
try {
  await new WebsiteManagerAgent(queueClient([
    call("unmetered_must_not_execute", "list_files", {})
  ]), testOpenRouterCatalog).run({
    buildInput,
    authoringBrief,
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
    authoringBrief,
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
    authoringBrief,
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
    authoringBrief,
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
    authoringBrief,
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
    meteredCall("boundary_build", "build_preview", {}, 700_000, 20_000, 0.25),
    meteredCall("boundary_inspect", "inspect_site", {}, 700_000, 20_000, 0.25),
    meteredCall("boundary_finish", "finish", finishArgs(), 700_000, 20_000, 0.25)
  ], (params) => {
    finishAtBoundaryRequests.push(params);
    simulatedDateNow += 5 * 60_000;
  })).run({
    buildInput,
    authoringBrief,
    instruction: "Retain a verified candidate when the already-paid finish response crosses the cost fuse.",
    kind: "edit",
    guardrails: { maxCostUsd: 0.6, maxConsecutiveIdenticalFailures: 3 },
    runtime: runtime({ initialFiles: files })
  });
} finally {
  Date.now = realDateNow;
}
assert.equal(finishAtBoundary.completion.ownerMessage, finishArgs().ownerMessage);
assert.equal(finishAtBoundary.usage.inputTokens, 2_100_000, "productive run was still constrained by the retired cumulative input budget");
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
    call("stall_read", "read_files", { files: [{ path: "src/site.tsx", startLine: null, endLine: null }] }),
    call("stall_finish_2", "finish", finishArgs()),
    call("stall_finish_3", "finish", finishArgs()),
    call("stall_must_not_run", "list_files", {})
  ], (params) => stalledRequests.push(params))).run({
    buildInput,
    authoringBrief,
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
  authoringBrief,
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
  appendOnlyHistory: "pass",
  correctableToolErrors: "pass",
  clarificationBeforeMutation: "pass",
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
    },
    inspectVisual: async () => {
      options.onInspect?.();
      if (options.inspectError) throw options.inspectError;
      return {
        inspectionHash,
        modelSummary: { visualOnly: true, observation: "Synthetic visual inspection." },
        diagnosticSummary: { visualOnly: true, findings: [] },
        images: options.inspectionImages
          ? [{ type: "input_image" as const, image_url: "data:image/png;base64,AA==", detail: "high" as const }]
          : undefined
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

function countOccurrences(value: unknown, key: string): number {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countOccurrences(item, key), 0);
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value as Record<string, unknown>).reduce(
    (total, [entryKey, item]) => total + (entryKey === key ? 1 : 0) + countOccurrences(item, key),
    0
  );
}
