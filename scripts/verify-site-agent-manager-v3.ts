import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import {
  WebsiteManagerAgent,
  type ManagerResponsesClientV3,
  type ManagerToolCallV3,
  type ManagerToolRuntimeV3,
  type WorkspaceSourceFile
} from "../packages/site-agent";
import { WorkspaceManagerRuntimeV3 } from "../packages/site-platform/manager-runtime";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const buildInput = buildSyntheticSiteInput();
const siteSource = `import React from "react";
import { Fact } from "../platform/sdk";
export const siteDefinition = {
  siteName: "Northstar Collision Repair",
  designRationale: "A direct test workspace for manager protocol verification.",
  claims: [], capabilityBindings: [],
  routes: [{ path: "/", title: "Northstar Collision Repair", description: "Collision repair", element: <main><h1><Fact id="business:name" /></h1></main> }]
};`;
const cssSource = "body{margin:0;color:#111;background:#fff;font:16px Arial,sans-serif}h1{letter-spacing:0}";
const files: WorkspaceSourceFile[] = [
  { path: "src/site.tsx", content: siteSource },
  { path: "src/styles.css", content: cssSource }
];
const workspaceHash = sha256(stableJson(files));
const inspectionHash = `sha256:${"9".repeat(64)}` as const;
const imageDigest = `sha256:${"8".repeat(64)}` as const;

const validCalls = [
  call("call_write_site", "write_file", { path: "src/site.tsx", content: siteSource }),
  call("call_write_css", "write_file", { path: "src/styles.css", content: cssSource }),
  call("call_build", "build_preview", { expectedWorkspaceHash: workspaceHash }),
  call("call_inspect", "inspect_candidate", { expectedWorkspaceHash: workspaceHash, expectedSandboxRevision: "sandbox_revision_1" }),
  call("call_finish", "finish", finishArgs())
];
const validRuntime = runtime();
let persistedAcceptedPlan: unknown;
const responseProgress: Array<{ responseIndex: number; inputTokens: number; outputTokens: number; cumulativeInputTokens: number }> = [];
const validResult = await new WebsiteManagerAgent(queueClient(validCalls)).run({
  buildInput,
  instruction: "Create the initial site.",
  kind: "initial_build",
  runtime: validRuntime,
  onPlanAccepted: async (plan) => { persistedAcceptedPlan = plan; },
  onProgress: async ({ responseIndex, responseUsage, usage }) => {
    responseProgress.push({ responseIndex, inputTokens: responseUsage.inputTokens, outputTokens: responseUsage.outputTokens, cumulativeInputTokens: usage.inputTokens });
  }
});
assert.equal(validResult.completion.workspaceHash, workspaceHash);
assert.deepEqual(persistedAcceptedPlan, validResult.sitePlan, "accepted plan was not exposed for immediate durable persistence");
assert.equal(validRuntime.finalCheckpoint(), "checkpoint_passed");
assert.deepEqual(validResult.traces.map((trace) => trace.name), ["set_site_plan", "write_file", "write_file", "build_preview", "inspect_candidate", "finish"]);
assert.equal(responseProgress.length, 5, "Manager did not emit one usage diagnostic per model response.");
assert.deepEqual(responseProgress.map((item) => item.responseIndex), [1, 2, 3, 4, 5]);
assert(responseProgress.every((item) => item.inputTokens === 10 && item.outputTokens === 5), "Per-response usage was not isolated from cumulative usage.");
assert.deepEqual(responseProgress.map((item) => item.cumulativeInputTokens), [20, 30, 40, 50, 60]);

const planningRequests: Array<Parameters<ManagerResponsesClientV3["create"]>[0]> = [];
const { schemaVersion: _planSchemaVersion, ...planArguments } = sitePlan();
const isolatedPlanning = await new WebsiteManagerAgent(rawQueueClient([
  call("premature_workspace_tool", "read_workspace", { path: "src/site.tsx", startLine: 1, endLine: 10 }),
  call("corrected_site_plan", "set_site_plan", planArguments),
  ...validCalls
], (params) => planningRequests.push(params))).run({
  buildInput,
  instruction: "Prove planning attempts do not consume the working budget.",
  kind: "initial_build",
  runtime: runtime(),
  limits: { maxResponses: 5, maxToolCalls: 5 }
});
assert.equal(isolatedPlanning.planningAttempts, 2, "Premature workspace access did not consume exactly one isolated planning attempt.");
assert.equal(isolatedPlanning.responses, 5, "Planning attempts consumed the working response budget.");
assert(!JSON.stringify(planningRequests[0]?.input).includes("agentAccessPolicy"), "Serving-only agent policy leaked into manager context.");
assert(!JSON.stringify(planningRequests[0]?.input).toLowerCase().includes("rawcrawl"), "Raw crawl data leaked into manager context.");

let invalidPlanExecutions = 0;
const invalidPlan = { ...planArguments, routes: [{ ...planArguments.routes[0], sourceFactIds: ["unknown_fact"] }] };
await assert.rejects(new WebsiteManagerAgent(rawQueueClient([
  call("invalid_site_plan_1", "set_site_plan", invalidPlan),
  call("invalid_site_plan_2", "set_site_plan", invalidPlan)
])).run({
  buildInput,
  instruction: "Reject invalid evidence references.",
  kind: "initial_build",
  runtime: runtime({ onExecute: () => { invalidPlanExecutions += 1; } })
}), /manager_site_plan_rejected/);
assert.equal(invalidPlanExecutions, 0, "Rejected planning attempts executed a workspace tool.");

const finishGraceRequests: Array<Parameters<ManagerResponsesClientV3["create"]>[0]> = [];
const finishGraceResult = await new WebsiteManagerAgent(queueClient(validCalls, (params) => finishGraceRequests.push(params))).run({
  buildInput,
  instruction: "Create and use the terminal finish grace.",
  kind: "initial_build",
  runtime: runtime(),
  limits: { maxResponses: 4, maxToolCalls: 4 }
});
assert.equal(finishGraceResult.responses, 5, "A passing final inspection did not receive one terminal finish-only response.");
const finishGraceRequest = finishGraceRequests.at(-1);
assert.deepEqual((finishGraceRequest?.tools ?? []).map((tool) => tool.type === "function" ? tool.name : tool.type), ["finish"], "Terminal finish grace exposed a non-finish tool.");
assert.deepEqual(finishGraceRequest?.tool_choice, { type: "function", name: "finish" }, "Terminal finish grace did not force the finish tool.");

const compactedInputs: unknown[][] = [];
await new WebsiteManagerAgent(queueClient(validCalls, (params) => {
  compactedInputs.push(params.input as unknown[]);
})).run({ buildInput, instruction: "Create with compact history.", kind: "initial_build", runtime: runtime() });
assert.deepEqual(compactedInputs.map((input) => input.length), [2, 2, 4, 6, 6, 6], "Manager history did not isolate planning and retain exactly the latest two working protocol frames.");
assert(compactedInputs.slice(1).every((input) => JSON.stringify(input.at(-1)).includes("Deterministic current runtime state")), "Deterministic runtime state was not the final working context item on each turn.");

const reasoningInputs: unknown[][] = [];
await new WebsiteManagerAgent(queueClient(validCalls.map((response, index) => ({
  ...response,
  output: [{ type: "reasoning", id: `reasoning_${index}`, summary: [], encrypted_content: `encrypted_${index}` }, ...response.output]
}) as never), (params) => { reasoningInputs.push(params.input as unknown[]); })).run({
  buildInput, instruction: "Create with encrypted reasoning frames.", kind: "initial_build", runtime: runtime()
});
const retainedFrame = reasoningInputs[2]?.slice(1, -1) as Array<{ type?: string }>;
assert.deepEqual(retainedFrame.map((item) => item.type), ["reasoning", "function_call", "function_call_output"], "Compaction separated encrypted reasoning from its function call frame.");

const direct = runtime();
assert.equal(output(await direct.execute(toolCall("direct_build_early", "build_preview", { expectedWorkspaceHash: workspaceHash }))).error, "workspace_hash_conflict");
await direct.execute(toolCall("direct_write_site", "write_file", { path: "src/site.tsx", content: siteSource }));
await direct.execute(toolCall("direct_write_css", "write_file", { path: "src/styles.css", content: cssSource }));
await direct.execute(toolCall("direct_build", "build_preview", { expectedWorkspaceHash: workspaceHash }));
await direct.execute(toolCall("direct_inspect", "inspect_candidate", { expectedWorkspaceHash: workspaceHash, expectedSandboxRevision: "sandbox_revision_1" }));
const cssHash = sha256(cssSource);
await direct.execute(toolCall("direct_patch", "apply_patch", { files: [{
  path: "src/styles.css", expectedContentHash: cssHash,
  replacements: [{ oldText: "color:#111", newText: "color:#222" }]
}] }));
assert.equal(output(await direct.execute(toolCall("direct_stale_finish", "finish", finishArgs()))).error, "finish_requires_passing_objective_inspection");
const anchorFailure = output(await direct.execute(toolCall("direct_anchor_failure", "apply_patch", {
  files: [{
    path: "src/styles.css", expectedContentHash: sha256("body{margin:0;color:#222;background:#fff;font:16px Arial,sans-serif}h1{letter-spacing:0}"),
    replacements: [
      { oldText: "color:#222", newText: "color:#333" },
      { oldText: "not present anchor", newText: "replacement" }
    ]
  }]
})));
assert.equal(anchorFailure.error, "patch_anchor_not_found");
assert(anchorFailure.sourceWindow && typeof anchorFailure.sourceWindow === "object", "Patch-anchor failure did not return a source window.");
assert(direct.currentFiles().find((file) => file.path === "src/styles.css")?.content.includes("color:#222"), "A failed patch batch partially mutated the workspace.");
const batchResult = output(await direct.execute(toolCall("direct_batch_patch", "apply_patch", {
  files: [{
    path: "src/styles.css", expectedContentHash: sha256("body{margin:0;color:#222;background:#fff;font:16px Arial,sans-serif}h1{letter-spacing:0}"),
    replacements: [
      { oldText: "color:#222", newText: "color:#333" },
      { oldText: "letter-spacing:0", newText: "letter-spacing:0.01em" }
    ]
  }]
})));
assert.equal(batchResult.patchesApplied, 2);
assert(direct.currentFiles().find((file) => file.path === "src/styles.css")?.content.includes("color:#333"), "A successful patch batch did not apply all replacements.");
assert.equal(direct.metrics().appliedReplacements, 3, "A failed atomic patch batch consumed the applied-replacement budget.");
const search = output(await direct.execute(toolCall("direct_search", "search_workspace", { query: "color:#333", path: null, maxResults: 10 })));
assert.equal((search.matches as unknown[]).length, 1, "Literal workspace search did not return the exact source match.");

let cachedBuildCalls = 0;
let cachedInspectionCalls = 0;
const cacheRuntime = runtime({
  initialFiles: files,
  onBuild: () => { cachedBuildCalls += 1; },
  onInspect: () => { cachedInspectionCalls += 1; }
});
await cacheRuntime.execute(toolCall("cache_build_1", "build_preview", { expectedWorkspaceHash: workspaceHash }));
const cachedBuild = output(await cacheRuntime.execute(toolCall("cache_build_2", "build_preview", { expectedWorkspaceHash: workspaceHash })));
await cacheRuntime.execute(toolCall("cache_inspect_1", "inspect_candidate", { expectedWorkspaceHash: workspaceHash, expectedSandboxRevision: "sandbox_revision_1" }));
const cachedInspection = output(await cacheRuntime.execute(toolCall("cache_inspect_2", "inspect_candidate", { expectedWorkspaceHash: workspaceHash, expectedSandboxRevision: "sandbox_revision_1" })));
assert.equal(cachedBuild.cached, true);
assert.equal(cachedInspection.cached, true);
assert.equal(cachedBuildCalls, 1, "Same-state build cache invoked the sandbox twice.");
assert.equal(cachedInspectionCalls, 1, "Same-state inspection cache invoked verification twice.");

const oscillating = runtime({ initialFiles: files });
await oscillating.execute(toolCall("oscillate_1", "apply_patch", { files: [{ path: "src/styles.css", expectedContentHash: sha256(cssSource), replacements: [{ oldText: "color:#111", newText: "color:#222" }] }] }));
await oscillating.execute(toolCall("oscillate_2", "apply_patch", { files: [{ path: "src/styles.css", expectedContentHash: sha256(cssSource.replace("#111", "#222")), replacements: [{ oldText: "color:#222", newText: "color:#111" }] }] }));
await oscillating.execute(toolCall("oscillate_3", "apply_patch", { files: [{ path: "src/styles.css", expectedContentHash: sha256(cssSource), replacements: [{ oldText: "color:#111", newText: "color:#222" }] }] }));
await assert.rejects(
  oscillating.execute(toolCall("oscillate_4", "apply_patch", { files: [{ path: "src/styles.css", expectedContentHash: sha256(cssSource.replace("#111", "#222")), replacements: [{ oldText: "color:#222", newText: "color:#111" }] }] })),
  /manager_no_progress/
);

const longSource = Array.from({ length: 1600 }, (_, index) => `// source line ${index + 1}`).join("\n");
const readRuntime = runtime({ initialFiles: [
  { path: "src/site.tsx", content: longSource },
  { path: "src/styles.css", content: cssSource }
] });
assert.equal(output(await readRuntime.execute(toolCall("read_first_window", "read_workspace", {
  path: "src/site.tsx", startLine: 1, endLine: 800
}))).ok, true);
assert.equal(output(await readRuntime.execute(toolCall("read_second_window", "read_workspace", {
  path: "src/site.tsx", startLine: 801, endLine: 1600
}))).ok, true);
const oversizedLineWindow = output(await readRuntime.execute(toolCall("read_oversized_lines", "read_workspace", {
  path: "src/site.tsx", startLine: 1, endLine: 801
})));
assert.equal(oversizedLineWindow.error, "read_window_too_large");
assert.equal(oversizedLineWindow.maxLines, 800);
assert.equal(readRuntime.metrics().readLines, 1600, "Per-call read windows were incorrectly treated as a cumulative limit.");
const oversizedByteRuntime = runtime({ initialFiles: [
  { path: "src/site.tsx", content: "x".repeat(96 * 1024 + 1) },
  { path: "src/styles.css", content: cssSource }
] });
const oversizedByteWindow = output(await oversizedByteRuntime.execute(toolCall("read_oversized_bytes", "read_workspace", {
  path: "src/site.tsx", startLine: 1, endLine: 1
})));
assert.equal(oversizedByteWindow.error, "read_window_too_large");
assert.equal(oversizedByteWindow.maxBytes, 96 * 1024);

const patchBudgetSource = Array.from({ length: 29 }, (_, index) => `[anchor-${String(index).padStart(2, "0")}]`).join("\n");
const patchBudgetRuntime = runtime({ initialFiles: [
  { path: "src/site.tsx", content: patchBudgetSource },
  { path: "src/styles.css", content: cssSource }
] });
const rejectedBudgetBatch = output(await patchBudgetRuntime.execute(toolCall("patch_rejected_budget_batch", "apply_patch", {
  files: [{
    path: "src/site.tsx",
    expectedContentHash: sha256(patchBudgetSource),
    replacements: [
      ...Array.from({ length: 29 }, (_, index) => ({
        oldText: `[anchor-${String(index).padStart(2, "0")}]`,
        newText: `[changed-${String(index).padStart(2, "0")}]`
      })),
      { oldText: "[missing-anchor]", newText: "[changed-missing]" }
    ]
  }]
})));
assert.equal(rejectedBudgetBatch.error, "patch_anchor_not_found");
assert.equal(patchBudgetRuntime.currentFiles()[0]?.content, patchBudgetSource, "A rejected budget batch mutated source.");
const acceptedAfterRejectedBatch = output(await patchBudgetRuntime.execute(toolCall("patch_after_rejected_budget_batch", "apply_patch", {
  files: [{
    path: "src/site.tsx",
    expectedContentHash: sha256(patchBudgetSource),
    replacements: [
      { oldText: "[anchor-00]", newText: "[changed-00]" },
      { oldText: "[anchor-01]", newText: "[changed-01]" }
    ]
  }]
})));
assert.equal(acceptedAfterRejectedBatch.patchesApplied, 2);
assert.equal(patchBudgetRuntime.metrics().appliedReplacements, 2, "Rejected replacements were counted as applied.");
assert.equal(patchBudgetRuntime.metrics().anchorFailures, 1, "Rejected anchors did not retain their independent failure accounting.");

const terminalTraceEvents: Array<{ kind: string; name: string; status: string; payload?: Record<string, unknown>; errorCode?: string }> = [];
const managerBudgetSource = Array.from({ length: 31 }, (_, index) => `[budget-${String(index).padStart(2, "0")}]`).join("\n");
const managerBudgetRuntime = runtime({ initialFiles: [
  { path: "src/site.tsx", content: managerBudgetSource },
  { path: "src/styles.css", content: cssSource }
] });
const firstBudgetReplacements = Array.from({ length: 30 }, (_, index) => ({
  oldText: `[budget-${String(index).padStart(2, "0")}]`,
  newText: `[changed-${String(index).padStart(2, "0")}]`
}));
const afterFirstBudgetPatch = firstBudgetReplacements.reduce((source, replacement) => source.replace(replacement.oldText, replacement.newText), managerBudgetSource);
await assert.rejects(
  new WebsiteManagerAgent(queueClient([
    call("manager_budget_1", "apply_patch", { files: [{ path: "src/site.tsx", expectedContentHash: sha256(managerBudgetSource), replacements: firstBudgetReplacements }] }),
    call("manager_budget_2", "apply_patch", { files: [{ path: "src/site.tsx", expectedContentHash: sha256(afterFirstBudgetPatch), replacements: [{ oldText: "[budget-30]", newText: "[changed-30]" }] }] })
  ])).run({
    buildInput,
    instruction: "Exercise terminal patch accounting.",
    kind: "focused_edit",
    runtime: managerBudgetRuntime,
    onTrace: async (events) => { terminalTraceEvents.push(...events); }
  }),
  /manager_patch_budget_exhausted/
);
const terminalToolFailure = terminalTraceEvents.find((event) => event.kind === "tool_call" && event.name === "apply_patch" && event.errorCode === "manager_patch_budget_exhausted");
assert(terminalToolFailure?.status === "failed", "Terminal runtime failure did not close its tool span.");
assert(Array.isArray((terminalToolFailure.payload?.arguments as { files?: unknown[] } | undefined)?.files), "Terminal runtime failure omitted attempted tool arguments from its private payload.");
assert((terminalToolFailure.payload?.traceResult as { error?: string } | undefined)?.error === "manager_patch_budget_exhausted", "Terminal runtime failure omitted its result from the private payload.");

let executions = 0;
const countedRuntime = runtime({ onExecute: () => { executions += 1; } });
const replayCalls = [validCalls[0], validCalls[0], ...validCalls.slice(1)];
await new WebsiteManagerAgent(queueClient(replayCalls)).run({
  buildInput, instruction: "Create the initial site.", kind: "initial_build", runtime: countedRuntime
});
assert.equal(executions, 5, "Same-input call_id replay executed the tool twice.");

await assert.rejects(
  new WebsiteManagerAgent(queueClient([
    call("call_reused", "write_file", { path: "src/site.tsx", content: siteSource }),
    call("call_reused", "write_file", { path: "src/site.tsx", content: `${siteSource}\n` })
  ])).run({ buildInput, instruction: "Create.", kind: "initial_build", runtime: runtime() }),
  /manager_call_id_reused_with_different_input/
);

let zeroCallExecutions = 0;
await assert.rejects(
  new WebsiteManagerAgent(queueClient([{ ...validCalls[0], output: [] } as never])).run({
    buildInput,
    instruction: "Create.",
    kind: "initial_build",
    runtime: runtime({ onExecute: () => { zeroCallExecutions += 1; } })
  }),
  /manager_tool_protocol_expected_one_call_received_0/
);
assert.equal(zeroCallExecutions, 0, "A zero-call protocol violation executed a runtime tool.");

let multipleCallExecutions = 0;
await assert.rejects(
  new WebsiteManagerAgent(queueClient([{
    ...validCalls[0],
    output: [validCalls[0].output[0], validCalls[1].output[0]]
  } as never])).run({
    buildInput,
    instruction: "Create.",
    kind: "initial_build",
    runtime: runtime({ onExecute: () => { multipleCallExecutions += 1; } })
  }),
  /manager_tool_protocol_expected_one_call_received_2/
);
assert.equal(multipleCallExecutions, 0, "A multiple-call protocol violation executed a runtime tool.");

let malformedArgumentExecutions = 0;
const malformedArgumentEvents: Array<{ kind: string; status: string; errorCode?: string; payload?: Record<string, unknown> }> = [];
await assert.rejects(new WebsiteManagerAgent(queueClient([
  call("call_malformed_arguments", "read_workspace", { path: "src/site.tsx", startLine: "one", endLine: 1 })
])).run({
  buildInput,
  instruction: "Return malformed tool arguments.",
  kind: "focused_edit",
  runtime: runtime({ initialFiles: files, onExecute: () => { malformedArgumentExecutions += 1; } }),
  onTrace: async (events) => { malformedArgumentEvents.push(...events); }
}));
assert.equal(malformedArgumentExecutions, 0, "Malformed tool arguments reached the runtime.");
const malformedModelSpan = malformedArgumentEvents.find((event) => event.kind === "model_request" && event.status === "succeeded" && event.payload);
const malformedTurnSpan = malformedArgumentEvents.find((event) => event.kind === "turn" && event.status === "failed");
assert(malformedModelSpan?.payload?.response, "Malformed tool arguments lost the model response envelope.");
assert(malformedTurnSpan?.errorCode && malformedTurnSpan.errorCode.length <= 160, "Malformed tool arguments did not retain a bounded trace error.");

await assert.rejects(
  new WebsiteManagerAgent(queueClient([
    call("call_limit_1", "read_workspace", { path: "src/site.tsx", startLine: 1, endLine: 1 }),
    call("call_limit_2", "read_workspace", { path: "src/site.tsx", startLine: 1, endLine: 1 })
  ])).run({
    buildInput, instruction: "Keep reading forever.", kind: "focused_edit", runtime: runtime({ initialFiles: files }),
    limits: { maxResponses: 2, maxToolCalls: 2 }
  }),
  /manager_response_limit_exhausted/
);

const editRuntime = runtime({ initialFiles: files });
assert.equal(output(await editRuntime.execute(toolCall("edit_write", "write_file", { path: "src/styles.css", content: cssSource }))).error, "write_file_not_available_after_initial_authoring");

let critiqueRequest: Record<string, unknown> | undefined;
const critiqueClient: ManagerResponsesClientV3 = {
  async create(params) {
    critiqueRequest = params as unknown as Record<string, unknown>;
    return {
      status: "completed",
      output_text: JSON.stringify({
        schemaVersion: "manager-candidate-critique-v1",
        verdict: "ship",
        summary: "The requested task is visibly complete.",
        findings: []
      }),
      output: [],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
    } as never;
  }
};
await new WebsiteManagerAgent(critiqueClient).critiqueCandidate({
  buildInput,
  visualThesis: "A direct visual thesis.",
  contentArchitecture: "A concise route architecture.",
  taskInstruction: "Create the initial site.",
  taskKind: "initial_build",
  routes: [{ path: "/", title: "Home", description: "Homepage" }],
  contactSheet: Buffer.from("critic-contact-sheet")
});
const critiqueFormat = (critiqueRequest?.text as { format?: { schema?: Record<string, unknown> } } | undefined)?.format;
const critiqueSchema = critiqueFormat?.schema as { properties?: { findings?: { items?: { properties?: { route?: Record<string, unknown> } } } } } | undefined;
assert.equal(critiqueSchema?.properties?.findings?.items?.properties?.route?.pattern, "^/", "Critic JSON schema permits a non-route finding target.");
const critiqueInput = JSON.stringify(critiqueRequest?.input);
assert(critiqueInput.includes("must exactly equal one of the supplied route paths"), "Critic prompt omitted the supplied-route constraint.");

console.log(JSON.stringify({
  ok: true,
  stateMachine: "pass",
  atomicExactPatchBatch: "pass",
  perCallReadBudget: "pass",
  appliedReplacementAccounting: "pass",
  failClosedToolProtocol: "pass",
  finishInvalidation: "pass",
  callIdIdempotency: "pass",
  compactProtocolFrames: "pass",
  literalWorkspaceSearch: "pass",
  sameStateCaching: "pass",
  terminalFinishGrace: "pass",
  terminalFailureTrace: "pass",
  malformedProtocolTrace: "pass",
  oscillationDetection: "pass",
  runawayBounds: "pass",
  editWriteFileRejection: "pass",
  criticRouteContract: "pass"
}));

function runtime(options: { initialFiles?: WorkspaceSourceFile[]; onExecute?: () => void; onBuild?: () => void; onInspect?: () => void } = {}) {
  const inner = new WorkspaceManagerRuntimeV3<string>({
    kind: options.initialFiles ? "focused_edit" : "initial_build",
    publicBuildInputId: buildInput.id,
    toolchainVersion: "toolchain-test-v1",
    sandboxImageDigest: imageDigest,
    initialFiles: options.initialFiles,
    initialSandboxRevision: "sandbox_revision_0",
    maxBuilds: 4,
    maxInspections: 4,
    applyBuild: async () => { options.onBuild?.(); return { revision: "sandbox_revision_1", buildDurationMs: 12, previewPath: "/private-preview" }; },
    inspect: async () => {
      options.onInspect?.();
      return ({
      passed: true,
      inspectionHash,
      modelSummary: { ok: true, inspectionHash },
      traceSummary: { ok: true, inspectionHash },
      checkpoint: "checkpoint_passed"
    }); }
  });
  inner.acceptPlan(sitePlan());
  if (!options.onExecute) return inner;
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return async (value: ManagerToolCallV3) => { options.onExecute?.(); return target.execute(value); };
    }
  });
}

function finishArgs() {
  return {
    visualThesis: "A restrained, high-contrast service identity centered on decisive typography, direct repair language, and calm customer guidance.",
    contentArchitecture: "A concise homepage establishes identity and conversion first, then routes customers through verified services, process context, and contact actions.",
    ownerMessage: "Built the initial private candidate and verified every route.",
    workspaceHash,
    sandboxRevision: "sandbox_revision_1",
    publicBuildInputId: buildInput.id,
    toolchainVersion: "toolchain-test-v1",
    sandboxImageDigest: imageDigest,
    inspectionHash
    ,planHash: sha256(stableJson(sitePlan()))
  };
}

function sitePlan() {
  return {
    schemaVersion: "site-plan-v1" as const,
    routes: [{
      path: "/",
      purpose: "home" as const,
      sourceFactIds: ["business:name", "fact_service_collision"],
      offeringIds: ["offering_collision"],
      ctas: [{ label: "Request an estimate", kind: "form" as const, target: "form_estimate" }],
      capabilities: ["forms" as const]
    }],
    sharedStructure: ["A single site header and footer connect every declared route."],
    visualDirection: {
      thesis: "A restrained repair identity uses decisive type and evidence-led service hierarchy.",
      typography: "Strong editorial headings pair with highly legible service copy.",
      color: "High-contrast neutral surfaces support one purposeful accent color.",
      composition: "Asymmetric service-led sections establish identity before utility content."
    },
    responsiveIntent: {
      navigation: "Navigation condenses without hiding the primary contact path.",
      layout: "Editorial columns stack into a deliberate single-column mobile sequence.",
      conversion: "The estimate action remains visible and comfortably tappable on small screens."
    }
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

function queueClient(responses: ReturnType<typeof call>[], onCreate?: (params: Parameters<ManagerResponsesClientV3["create"]>[0]) => void): ManagerResponsesClientV3 {
  const { schemaVersion: _schemaVersion, ...argumentsValue } = sitePlan();
  const queue = [call("call_site_plan", "set_site_plan", argumentsValue), ...responses];
  return {
    async create(params) {
      onCreate?.(params);
      const next = queue.shift();
      if (!next) throw new Error("fake_response_queue_exhausted");
      return next as never;
    }
  };
}

function rawQueueClient(responses: ReturnType<typeof call>[], onCreate?: (params: Parameters<ManagerResponsesClientV3["create"]>[0]) => void): ManagerResponsesClientV3 {
  const queue = [...responses];
  return {
    async create(params) {
      onCreate?.(params);
      const next = queue.shift();
      if (!next) throw new Error("fake_response_queue_exhausted");
      return next as never;
    }
  };
}

function toolCall(callId: string, name: ManagerToolCallV3["name"], args: Record<string, unknown>): ManagerToolCallV3 {
  return { callId, name, arguments: args };
}

function output(result: Awaited<ReturnType<ManagerToolRuntimeV3["execute"]>>) {
  return JSON.parse(result.modelOutput as string) as Record<string, unknown>;
}
