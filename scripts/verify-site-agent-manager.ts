import assert from "node:assert/strict";
import { sha256, stableJson } from "../packages/business-data";
import {
  WebsiteManagerAgent,
  assertCompleteWorkspace,
  type ManagerResponsesClient,
  type ManagerToolCall,
  type ManagerToolRuntime,
  type WorkspaceSourceFile
} from "../packages/site-agent";
import { WorkspaceManagerRuntime } from "../packages/site-platform/manager-runtime";
import { validateWorkspaceSourcePolicy } from "../packages/site-agent/source-policy";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const buildInput = buildSyntheticSiteInput();
const siteSource = `import React from "react";
import { Fact } from "../platform/sdk";
import { Hero } from "./components/Hero";
export const siteDefinition = {
  siteName: "Northstar Collision Repair",
  factDeclarations: [], capabilityBindings: [],
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
assert(requests.every((request) => toolNames(request).join(",") === "list_files,read_file,write_file,delete_file,apply_patch,build_preview,inspect_site,request_input,finish"), "manager tool set drifted from the simple workspace protocol");
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
])).run({ buildInput, instruction: "Recover from a malformed tool call.", kind: "initial_build", runtime: recoveryRuntime });
assert(recovery.completion, "a correctable tool argument error terminated the manager run");

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
  ,clarificationBeforeMutation: "pass"
}));

function runtime(options: { initialFiles?: WorkspaceSourceFile[]; onBuild?: () => void; onInspect?: () => void; inspectionSummary?: Record<string, unknown> } = {}) {
  let revision = 0;
  return new WorkspaceManagerRuntime<string>({
    kind: options.initialFiles ? "edit" : "initial_build",
    publicBuildInputId: buildInput.id,
    toolchainVersion: "toolchain-test-v1",
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

function queueClient(responses: ReturnType<typeof call>[], onCreate?: (params: Parameters<ManagerResponsesClient["create"]>[0]) => void): ManagerResponsesClient {
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
