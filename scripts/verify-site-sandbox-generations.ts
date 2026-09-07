import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  generationPromotionBoundaries,
  promoteGenerationTransaction,
  type GenerationPromotionBoundary
} from "../workers/site-sandbox/src/generation-transaction";

const oldRevision = "a".repeat(64);
const newRevision = "b".repeat(64);

const [workerSource, workflowSource, browserGateSource, packageSource, previewServerSource] = await Promise.all([
  readFile("workers/site-sandbox/src/index.ts", "utf8"),
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("packages/site-verification/browser-gate.ts", "utf8"),
  readFile("workers/site-sandbox/scaffold/package.json", "utf8"),
  readFile("workers/site-sandbox/scaffold/platform/preview-server.mjs", "utf8")
]);
for (const required of [
  "generationsRoot",
  "operationsRoot",
  "mutationLock",
  "active.next",
  "mv -Tf",
  "operation_payload_conflict",
  "active_generation_invalid",
  "writeOperationJournal",
  "garbageCollectGenerations"
]) {
  assert(workerSource.includes(required), `Sandbox generation protocol is missing ${required}.`);
}
assert(!workflowSource.includes("ensureBuildSandbox(isUninitializedSandboxRevision(error))"), "Controller still retries a transient build against the existing sandbox.");
assert(workflowSource.match(/executeWithFreshSandboxRecovery/g)?.length === 3, "Controller mutations do not share the bounded fresh-sandbox recovery policy.");
assert(workerSource.includes("promoteGenerationTransaction"), "The worker does not use the fault-injectable production promotion transaction.");
assert(workerSource.includes("const lockPath = `${sessionRoot}/preview-start.lock`"), "Preview coordination is still coupled to an active generation.");
assert(!workerSource.includes("stopPreviewProcesses"), "Hot generation promotion still stops the preview server.");
assert(!workerSource.includes("await sandbox.killAllProcesses();"), "Hot generation promotion still uses kill-all process shutdown.");
assert(packageSource.includes('"preview": "node platform/preview-server.mjs"'), "The sandbox does not use the stable preview server.");
assert(previewServerSource.includes('const defaultRoot = "/workspace/site/active/dist"'), "The preview server is not bound to the atomic active-generation pointer.");
assert(workerSource.includes("node /opt/lodesta-site-scaffold/platform/preview-server.mjs"), "The deployed preview does not execute the immutable stable server directly.");
assert(workerSource.includes("{ cwd: sessionRoot }"), "The preview server working directory still resolves inside a disposable generation.");
assert(!workerSource.includes("targetRevision: archivedRevision"), "Restore can overwrite an existing generation instead of creating a distinct candidate.");
assert(browserGateSource.includes("verifyEveryPreparedRoute"), "Final verification does not fetch every prepared route.");
const staticReleasePreflight = workflowSource.indexOf("prepared.findings.some(isTechnicalReleaseBlocker)");
const releaseBrowserSweep = workflowSource.indexOf("const browserGate = await runArtifactBrowserGate", staticReleasePreflight);
assert(staticReleasePreflight >= 0, "Release verification does not preflight deterministic blockers before browser capture.");
assert(releaseBrowserSweep > staticReleasePreflight, "Release verification starts browser capture before deterministic blocker preflight.");
assert.match(
  workflowSource.slice(staticReleasePreflight),
  /const selectedRoutes = selectedVisualRoutes[\s\S]*const releaseBrowserRoutePaths = \[\.\.\.new Set[\s\S]*routePaths: releaseBrowserRoutePaths/,
  "Release verification does not retain every canonical visual-review route before evaluation."
);

await verifyFreshMutationLock();
await verifyQueuedJournalRace();
await verifyPreparationObserver();
await verifyCompletedOperationPoll();
await verifyAmbiguousPromotionResponse();
const fixture = await mkdtemp(join(tmpdir(), "lodesta-generation-protocol-"));
try {
  for (const fault of generationPromotionBoundaries) {
    const root = join(fixture, fault);
    const generations = join(root, "generations");
    await mkdir(join(root, "operations"), { recursive: true });
    await writeGeneration(generations, oldRevision, "old", "operation-old");
    await writeGeneration(generations, newRevision, "new", "operation-new");
    await symlink(`generations/${oldRevision}`, join(root, "active"));
    let pointerReplaced = false;
    await promoteWithFault(root, fault, () => {
      pointerReplaced = true;
    }).catch((error) => {
      assert.equal((error as Error).message, `simulated_process_termination:${fault}`);
    });
    const visible = await completeGeneration(root);
    assert(["old", "new"].includes(visible), `Fault ${fault} exposed a mixed generation.`);
    const renameCompleted = generationPromotionBoundaries.indexOf(fault) >= generationPromotionBoundaries.indexOf("after_pointer_rename");
    assert.equal(pointerReplaced, renameCompleted, `Fault ${fault} reported the wrong pointer state.`);
    assert.equal(visible, renameCompleted ? "new" : "old", `Fault ${fault} selected the wrong atomic side.`);
    if (renameCompleted) {
      const activeMetadata = JSON.parse(await readFile(join(generations, newRevision, "generation.json"), "utf8")) as {
        operationId?: string;
        result?: { revision?: string };
      };
      assert.equal(activeMetadata.operationId, "operation-new", `Fault ${fault} lost active operation metadata.`);
      assert.equal(activeMetadata.result?.revision, newRevision, `Fault ${fault} cannot recover success from active generation metadata.`);
    }
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  immutableGenerations: "pass",
  atomicPointerFaults: "pass",
  boundedFreshSandboxReplay: "pass"
})}\n`);

// Execute the actual Worker function against a deterministic filesystem/RPC
// adapter. Pause precisely between exclusive mkdir and metadata publication.
// No Cloudflare runtime, network, or real workspace mutation is involved.
async function verifyFreshMutationLock() {
  const source = ts.createSourceFile("worker.ts", workerSource, ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement)
    && statement.name?.text === "acquireMutationLock");
  assert(declaration);
  const compiled = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  class Conflict extends Error {
    constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
  }
  let exists = false;
  let metadata: { operationId: string; startedAt?: string } | undefined;
  let writes = 0;
  let releaseFirst!: () => void;
  let firstEntered!: () => void;
  const paused = new Promise<void>(resolve => { releaseFirst = resolve; });
  const entered = new Promise<void>(resolve => { firstEntered = resolve; });
  const sandbox = {
    mkdir: async () => undefined,
    exec: async (command: string) => {
      if (command === "mkdir /fixture/mutation.lock") {
        if (exists) return { success: false };
        exists = true;
        return { success: true };
      }
      if (command === "rm -rf /fixture/mutation.lock") { exists = false; metadata = undefined; return { success: true }; }
      throw new Error(`Unexpected fixture command: ${command}`);
    },
    writeFile: async (_path: string, content: string) => {
      if (++writes === 1) { firstEntered(); await paused; }
      metadata = JSON.parse(content);
    },
    listProcesses: async () => []
  };
  const acquire = new Function("sessionRoot", "mutationLock", "operationStaleAfterMs", "readJson", "SandboxOperationError", "disposeRpcAll",
    `${compiled}; return acquireMutationLock;`)("/fixture", "/fixture/mutation.lock", 240_000,
    async () => metadata, Conflict, () => undefined) as (adapter: typeof sandbox, operationId: string) => Promise<void>;
  const first = acquire(sandbox, "operation-first");
  await entered;
  try {
    await assert.rejects(acquire(sandbox, "operation-second"), error => error instanceof Conflict && error.status === 409,
      "A concurrent request stole a fresh lock before its metadata was written.");
    assert.equal(writes, 1, "Only the exclusive mkdir winner may publish lock metadata.");
  } finally {
    releaseFirst();
    await first;
  }
  assert.equal(metadata?.operationId, "operation-first");
  metadata!.startedAt = "1970-01-01T00:00:00.000Z";
  await assert.rejects(acquire(sandbox, "operation-third"), error => error instanceof Conflict && error.status === 409,
    "Old metadata does not grant a different request permission to delete another execution's lock.");
  assert.equal(writes, 1);
}

async function verifyQueuedJournalRace() {
  const completed = { operationId: "same-operation", status: "succeeded", phase: "complete", result: { revision: newRevision } };
  let reads = 0;
  let released = 0;
  const start = productionWorkerFunction("startQueuedOperation", {
    mutationLock: "/fixture/mutation.lock",
    readOperationJournal: async () => ++reads === 1 ? { ...completed, status: "queued", phase: "queued" } : completed,
    acquireMutationLock: async () => undefined,
    transitionOperation: async () => { throw new Error("A stale queued poll started another mutation."); }
  });
  const result = await start({ exec: async (command: string) => {
    assert.equal(command, "rm -rf /fixture/mutation.lock");
    released++;
    return { success: true };
  } }, "session", "https://sandbox.example", "same-operation");
  assert.equal(result, completed);
  assert.equal(reads, 2);
  assert.equal(released, 1);
}

async function verifyPreparationObserver() {
  const journal = { operationId: "same-operation", status: "running", phase: "preparing", phaseStartedAt: "1970-01-01T00:00:00.000Z" };
  const status = productionWorkerFunction("operationStatus", {
    readOperationJournal: async () => journal,
    publicOperationStatus: (value: unknown) => value
  });
  const result = await status({}, "session", "https://sandbox.example", journal.operationId,
    () => { throw new Error("A status poll scheduled destructive preparation recovery."); });
  assert.equal(result, journal, "A poll without proof of a completed preparation must not reset its journal or remove its lock.");
}

function productionWorkerFunction(name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile("worker.ts", workerSource, ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert(declaration, `Missing production Worker function ${name}`);
  const compiled = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return ${name};`)(...Object.values(bindings));
}

async function verifyCompletedOperationPoll() {
  const completed = { operationId: "same-operation", status: "succeeded", phase: "complete", result: { revision: newRevision } };
  const stale = { ...completed, status: "running", phase: "validating", processId: "build-process", candidateRevision: newRevision };
  let failures = 0;
  const advance = productionWorkerFunction("advanceRunningOperation", {
    operationsRoot: "/fixture/operations",
    readOperationJournal: async () => completed,
    generationPath: () => "/fixture/candidate",
    operationValidationMarker: () => "/fixture/marker",
    parseSourcePolicyResult: () => ({}),
    failOperation: async () => { failures++; return { ...completed, status: "failed" }; },
    disposeRpc: () => undefined,
    SandboxOperationError: class extends Error {}
  });
  const result = await advance({
    exec: async () => ({ success: true }),
    exists: async () => ({ exists: false }),
    getProcess: async () => null,
    getProcessLogs: async () => ({ stdout: "", stderr: "" })
  }, "session", "https://sandbox.example", stale);
  assert.equal(result, completed, "A delayed poll treated a completed/cleaned build process as failure and attempted candidate cleanup.");
  assert.equal(failures, 0);
}

async function verifyAmbiguousPromotionResponse() {
  const journal = { operationId: "same-operation", status: "running", phase: "promoting", candidateRevision: newRevision,
    createdAt: new Date().toISOString(), phaseTimings: {}, timestamps: {} };
  const result = { ok: true, revision: newRevision, phaseTimings: {} };
  let failures = 0;
  const finalize = productionWorkerFunction("finalizeBuiltOperation", {
    generationPath: () => "/fixture/candidate", readOperationJournal: async () => journal,
    operationRequestPath: () => "/fixture/request.json", readJson: async () => ({ files: [], publicInputJson: "{}" }),
    writeGenerationMetadata: async () => undefined, digest: async () => "hash", canonicalJson: JSON.stringify,
    promoteGenerationTransaction: async () => { throw new Error("lost response after atomic pointer rename"); },
    readActiveGeneration: async () => ({ operationId: journal.operationId, result }),
    writeOperationJournal: async () => undefined,
    cleanupOperationProcess: async () => undefined,
    mutationLock: "/fixture/mutation.lock",
    failOperation: async () => { failures++; return { ...journal, status: "failed" }; }
  });
  const completed = await finalize({ getContainerPlacementId: async () => "placement", writeFile: async () => undefined,
    exec: async () => ({ success: true }) },
    "session", "https://sandbox.example", journal);
  assert.equal(completed.status, "succeeded", "An ambiguous pointer-rename response must not delete the committed active generation.");
  assert.equal(completed.result, result);
  assert.equal(failures, 0);
}

async function writeGeneration(root: string, revision: string, marker: string, operationId: string) {
  const generation = join(root, revision);
  await Promise.all([
    mkdir(join(generation, "src"), { recursive: true }),
    mkdir(join(generation, "dist"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(generation, "src", "site.tsx"), marker),
    writeFile(join(generation, "dist", "index.html"), marker),
    writeFile(join(generation, "public-build-input.json"), JSON.stringify({ marker })),
    writeFile(join(generation, "generation.json"), JSON.stringify({
      schemaVersion: 1,
      revision,
      marker,
      operationId,
      payloadHash: `payload-${marker}`,
      result: { ok: true, revision, operationId }
    }))
  ]);
}

async function promoteWithFault(root: string, fault: GenerationPromotionBoundary, onPointerReplaced: () => void) {
  return promoteGenerationTransaction({
    target: `generations/${newRevision}`,
    journal: { operationId: "operation-new", completed: true },
    adapter: {
      removeNextPointer: () => rm(join(root, "active.next"), { force: true }),
      createNextPointer: (target) => symlink(target, join(root, "active.next")),
      replaceActivePointer: () => rename(join(root, "active.next"), join(root, "active")),
      readActive: async () => JSON.parse(await readFile(join(root, await readlink(join(root, "active")), "generation.json"), "utf8")) as {
        revision: string;
        operationId: string;
      },
      writeOperationJournal: (journal) => writeFile(join(root, "operations", "operation-new.json"), JSON.stringify(journal)),
      cleanupOldGenerations: async () => {
        for (const entry of await readdir(join(root, "generations"))) {
          if (entry !== newRevision) await rm(join(root, "generations", entry), { recursive: true, force: true });
        }
      }
    },
    validateActive: (active) => {
      assert.equal(active.revision, newRevision);
      assert.equal(active.operationId, "operation-new");
    },
    onPointerReplaced,
    faultAtBoundary: (boundary) => {
      if (boundary === fault) throw new Error(`simulated_process_termination:${fault}`);
    }
  });
}

async function completeGeneration(root: string) {
  const target = await readlink(join(root, "active"));
  assert(/^generations\/[a-f0-9]{64}$/.test(target), "Active pointer escaped the generations root.");
  const generation = join(root, target);
  const [source, html, input, metadata] = await Promise.all([
    readFile(join(generation, "src", "site.tsx"), "utf8"),
    readFile(join(generation, "dist", "index.html"), "utf8"),
    readFile(join(generation, "public-build-input.json"), "utf8"),
    readFile(join(generation, "generation.json"), "utf8")
  ]);
  const marker = JSON.parse(input) as { marker: string };
  assert.equal(source, marker.marker);
  assert.equal(html, marker.marker);
  assert.equal((JSON.parse(metadata) as { marker: string }).marker, marker.marker);
  return marker.marker;
}
