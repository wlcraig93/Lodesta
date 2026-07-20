import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import {
  WebsiteManagerAgent,
  type ManagerResponsesClientV2,
  type ManagerToolCallV2,
  type ManagerToolRuntimeV2,
  type WorkspaceSourceFile
} from "../packages/site-agent";
import { WorkspaceManagerRuntimeV2 } from "../packages/site-platform/manager-runtime";
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
const validResult = await new WebsiteManagerAgent(queueClient(validCalls)).run({
  buildInput, instruction: "Create the initial site.", kind: "initial_build", runtime: validRuntime
});
assert.equal(validResult.completion.workspaceHash, workspaceHash);
assert.equal(validRuntime.finalCheckpoint(), "checkpoint_passed");
assert.deepEqual(validResult.traces.map((trace) => trace.name), ["write_file", "write_file", "build_preview", "inspect_candidate", "finish"]);

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

console.log(JSON.stringify({
  ok: true,
  stateMachine: "pass",
  atomicExactPatchBatch: "pass",
  perCallReadBudget: "pass",
  appliedReplacementAccounting: "pass",
  failClosedToolProtocol: "pass",
  finishInvalidation: "pass",
  callIdIdempotency: "pass",
  runawayBounds: "pass",
  editWriteFileRejection: "pass"
}));

function runtime(options: { initialFiles?: WorkspaceSourceFile[]; onExecute?: () => void } = {}) {
  const inner = new WorkspaceManagerRuntimeV2<string>({
    kind: options.initialFiles ? "focused_edit" : "initial_build",
    publicBuildInputId: buildInput.id,
    toolchainVersion: "toolchain-test-v1",
    sandboxImageDigest: imageDigest,
    initialFiles: options.initialFiles,
    initialSandboxRevision: "sandbox_revision_0",
    maxBuilds: 4,
    maxInspections: 4,
    applyBuild: async () => ({ revision: "sandbox_revision_1", buildDurationMs: 12, previewPath: "/private-preview" }),
    inspect: async () => ({
      passed: true,
      inspectionHash,
      modelSummary: { ok: true, inspectionHash },
      traceSummary: { ok: true, inspectionHash },
      checkpoint: "checkpoint_passed"
    })
  });
  if (!options.onExecute) return inner;
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return async (value: ManagerToolCallV2) => { options.onExecute?.(); return target.execute(value); };
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

function queueClient(responses: ReturnType<typeof call>[]): ManagerResponsesClientV2 {
  const queue = [...responses];
  return {
    async create() {
      const next = queue.shift();
      if (!next) throw new Error("fake_response_queue_exhausted");
      return next as never;
    }
  };
}

function toolCall(callId: string, name: ManagerToolCallV2["name"], args: Record<string, unknown>): ManagerToolCallV2 {
  return { callId, name, arguments: args };
}

function output(result: Awaited<ReturnType<ManagerToolRuntimeV2["execute"]>>) {
  return JSON.parse(result.modelOutput as string) as Record<string, unknown>;
}
