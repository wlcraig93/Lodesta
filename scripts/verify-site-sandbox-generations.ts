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
await verifyOperationJournalReads();
await verifySubmissionJournalReadSafety();
await verifyQueuedJournalRace();
await verifyPreparationObserver();
await verifyCompletedOperationPoll();
await verifyAmbiguousPromotionResponse();
await verifyConcurrentFinalizationPoll();
await verifyRequestBoundOperationLifetime();
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

async function verifyOperationJournalReads() {
  class Conflict extends Error {
    constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
  }
  const operationId = "c".repeat(64);
  const journal = { schemaVersion: 1, operationId, status: "running", phase: "validating" };
  const read = productionWorkerFunction("readOperationJournal", {
    operationsRoot: "/fixture/operations",
    SandboxOperationError: Conflict
  }) as (sandbox: {
    exists(path: string): Promise<{ exists: boolean }>;
    readFile(path: string, options: { encoding: string }): Promise<{ content: string }>;
  }, operationId: string) => Promise<unknown>;
  const adapter = (exists: () => Promise<{ exists: boolean }>, readFile: () => Promise<{ content: string }>) => ({ exists, readFile });

  assert.equal(await read(adapter(async () => ({ exists: false }), async () => { throw new Error("unexpected read"); }), operationId), undefined,
    "An explicitly absent journal did not remain the sole not-found case.");
  const existsFailure = new TypeError("simulated exists RPC failure");
  await assert.rejects(read(adapter(async () => { throw existsFailure; }, async () => ({ content: "" })), operationId), error => error === existsFailure,
    "An exists RPC failure was misreported as a missing journal.");
  const readFailure = new TypeError("simulated readFile RPC failure");
  await assert.rejects(read(adapter(async () => ({ exists: true }), async () => { throw readFailure; }), operationId), error => error === readFailure,
    "A readFile RPC failure was misreported as a missing journal.");
  for (const content of ["{not-json", "null", JSON.stringify({ ...journal, operationId: "wrong" }), JSON.stringify({ ...journal, schemaVersion: 2 })]) {
    await assert.rejects(
      read(adapter(async () => ({ exists: true }), async () => ({ content })), operationId),
      error => error instanceof Conflict && error.status === 500 && error.payload.error === "operation_journal_invalid",
      "Malformed or mismatched retained journal bytes did not fail loudly."
    );
  }
  assert.deepEqual(await read(adapter(async () => ({ exists: true }), async () => ({ content: JSON.stringify(journal) })), operationId), journal);

  const status = productionWorkerFunction("operationStatus", {
    readOperationJournal: read,
    SandboxOperationError: Conflict,
    publicOperationStatus: productionWorkerFunction("publicOperationStatus", {}),
    startQueuedOperation: async () => { throw new Error("unexpected queued operation"); },
    advanceRunningOperation: async () => { throw new Error("unexpected running operation"); }
  });
  const fetchStatus = (sandbox: unknown) => productionWorkerFetch({
    authorized: () => true,
    sandboxFor: async () => sandbox,
    operationStatus: status,
    json: (body: unknown, responseStatus = 200) => Response.json(body, { status: responseStatus }),
    SandboxOperationError: Conflict
  });
  const missingResponse = await fetchStatus(adapter(async () => ({ exists: false }), async () => ({ content: "" })))(
    new Request(`https://sandbox.example/v1/sessions/session/operations/${operationId}`), {}, { waitUntil: () => undefined });
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "operation_not_found", operationId });
  const transportResponse = await fetchStatus(adapter(async () => { throw existsFailure; }, async () => ({ content: "" })))(
    new Request(`https://sandbox.example/v1/sessions/session/operations/${operationId}`), {}, { waitUntil: () => undefined });
  assert.equal(transportResponse.status, 500);
  assert.equal((await transportResponse.json() as { error?: string }).error, "sandbox_operation_failed",
    "The GET handler misreported a journal transport failure as operation_not_found.");
  const malformedResponse = await fetchStatus(adapter(async () => ({ exists: true }), async () => ({ content: "null" })))(
    new Request(`https://sandbox.example/v1/sessions/session/operations/${operationId}`), {}, { waitUntil: () => undefined });
  assert.equal(malformedResponse.status, 500);
  assert.deepEqual(await malformedResponse.json(), { error: "operation_journal_invalid", operationId });
}

async function verifySubmissionJournalReadSafety() {
  const operationId = "d".repeat(64);
  const payloadHash = "e".repeat(64);
  const input = { action: "apply", expectedRevision: oldRevision, files: [], publicInputJson: "{}" };
  class Conflict extends Error {
    constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
  }
  const readOperationJournal = productionWorkerFunction("readOperationJournal", {
    operationsRoot: "/fixture/operations",
    SandboxOperationError: Conflict
  });
  const submit = productionWorkerFunction("submitGeneration", {
    canonicalFiles: (files: unknown) => files,
    canonicalJson: JSON.stringify,
    digest: async (value: string) => value.includes(":apply:") ? operationId : payloadHash,
    readOperationJournal,
    operationsRoot: "/fixture/operations",
    readActiveGeneration: async () => ({ operationId: "another-operation", revision: oldRevision }),
    operationRequestPath: () => "/fixture/operations/request.json",
    writeOperationJournal: async (_sandbox: unknown, journal: unknown) => { writes.push({ kind: "journal", journal }); }
  });
  const writes: unknown[] = [];
  const commands: string[] = [];
  const sandbox = (exists: () => Promise<{ exists: boolean }>, readFile: () => Promise<{ content: string }>) => ({
    exists,
    readFile,
    mkdir: async () => undefined,
    exec: async (command: string) => { commands.push(command); return { success: true }; },
    writeFile: async (path: string, content: string) => { writes.push({ kind: "file", path, content }); }
  });

  for (const fixture of [{
    name: "exists RPC failure",
    error: new TypeError("simulated retained journal exists RPC failure"),
    adapter: () => sandbox(async () => { throw new TypeError("simulated retained journal exists RPC failure"); }, async () => ({ content: "" }))
  }, {
    name: "readFile RPC failure",
    error: new TypeError("simulated retained journal readFile RPC failure"),
    adapter: () => sandbox(async () => ({ exists: true }), async () => { throw new TypeError("simulated retained journal readFile RPC failure"); })
  }, {
    name: "malformed JSON",
    error: undefined,
    adapter: () => sandbox(async () => ({ exists: true }), async () => ({ content: "{not-json" }))
  }]) {
    await assert.rejects(submit(fixture.adapter(), "session", input), error => fixture.error
      ? error instanceof TypeError && error.message === fixture.error.message
      : error instanceof Conflict && error.payload.error === "operation_journal_invalid",
    `Submission continued after an initial ${fixture.name}.`);
    assert.deepEqual(commands, [], `Submission acquired a lock after an initial ${fixture.name}.`);
    assert.deepEqual(writes, [], `Submission wrote bytes after an initial ${fixture.name}.`);
  }

  let readAttempts = 0;
  const secondReadFailure = new TypeError("simulated second journal read RPC failure");
  await assert.rejects(submit(sandbox(async () => {
    readAttempts += 1;
    if (readAttempts === 1) return { exists: false };
    throw secondReadFailure;
  }, async () => ({ content: "" })), "session", input), error => error === secondReadFailure,
  "Submission continued after the journal re-read under its acceptance lock failed.");
  assert.deepEqual(commands, [
    `mkdir /fixture/operations/${operationId}.accept.lock`,
    `rm -rf /fixture/operations/${operationId}.accept.lock`
  ], "Submission did not release only its acquired lock after the second journal read failed.");
  assert.deepEqual(writes, [], "Submission wrote bytes after its second journal read failed.");

  commands.length = 0;
  const accepted = await submit(sandbox(async () => ({ exists: false }), async () => ({ content: "" })), "session", input) as { operationId?: string; status?: string };
  assert.equal(accepted.operationId, operationId);
  assert.equal(accepted.status, "queued", "A truly absent journal was not accepted as a new queued operation.");
  assert.equal(writes.length, 2, "A new operation did not write exactly one request and one journal.");

  writes.length = 0;
  commands.length = 0;
  const retained = { schemaVersion: 1, operationId, payloadHash, status: "running", phase: "validating" };
  const replayed = await submit(sandbox(async () => ({ exists: true }), async () => ({ content: JSON.stringify(retained) })), "session", input) as { submissionReplayed?: boolean };
  assert.equal(replayed.submissionReplayed, true, "An existing journal was not replayed.");
  assert.deepEqual(commands, [], "Existing-journal replay acquired an acceptance lock.");
  assert.deepEqual(writes, [], "Existing-journal replay rewrote retained bytes.");
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
    publicOperationStatus: (value: unknown) => value,
    startQueuedOperation: async () => { throw new Error("A preparing observer restarted preparation."); },
    advanceRunningOperation: async () => { throw new Error("A preparing observer attempted destructive recovery."); }
  });
  const result = await status({}, "session", "https://sandbox.example", journal.operationId);
  assert.equal(result, journal, "A poll without proof of a completed preparation must not reset its journal or remove its lock.");
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixtureEntered(promise: Promise<void>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Fixture did not enter ${label}.`)), 5_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// An event-loop checkpoint drains already-runnable promise callbacks without
// timing a real RPC or pretending a short sleep proves that work is blocked.
function fixtureCheckpoint() {
  return new Promise<void>(resolve => setImmediate(resolve));
}

function productionWorkerFetch(bindings: Record<string, unknown>) {
  const source = ts.createSourceFile("worker.ts", workerSource, ts.ScriptTarget.Latest, true);
  const exported = source.statements.find(statement => ts.isExportAssignment(statement) && !statement.isExportEquals);
  assert(exported && ts.isExportAssignment(exported), "Missing production Worker default export.");
  const compiled = ts.transpileModule(`const productionWorker = ${exported.expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return productionWorker.fetch;`)(...Object.values(bindings)) as
    (request: Request, env: object, context: { waitUntil(work: Promise<unknown>): void }) => Promise<Response>;
}

async function verifyConcurrentFinalizationPoll() {
  for (const fails of [false, true]) {
    const promoting = { operationId: "concurrent-finalize", status: "running", phase: "promoting", candidateRevision: newRevision };
    const completed = { ...promoting, status: "succeeded", phase: "complete", result: { revision: newRevision } };
    let current = promoting;
    let lockExists = false;
    let removals = 0;
    let finalizers = 0;
    const entered = deferred<void>();
    const release = deferred<void>();
    const failure = new Error("deferred finalizer failed");
    const advance = productionWorkerFunction("advanceRunningOperation", {
      operationsRoot: "/fixture/operations",
      readOperationJournal: async () => current,
      finalizeBuiltOperation: async () => {
        finalizers++;
        entered.resolve();
        await release.promise;
        if (fails) throw failure;
        current = completed;
        return completed;
      },
      advanceBuildProcess: async () => { throw new Error("A promoting operation advanced a build process."); }
    });
    const sandbox = { exec: async (command: string) => {
      if (command === "mkdir /fixture/operations/concurrent-finalize.finalize.lock") {
        if (lockExists) return { success: false };
        lockExists = true;
        return { success: true };
      }
      assert.equal(command, "rm -rf /fixture/operations/concurrent-finalize.finalize.lock");
      removals++;
      lockExists = false;
      return { success: true };
    } };
    const first = advance(sandbox, "session", "https://sandbox.example", promoting) as Promise<unknown>;
    const observed = first.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      await fixtureEntered(entered.promise, "finalizer");
      assert.equal(await advance(sandbox, "session", "https://sandbox.example", promoting), promoting);
      assert.equal(finalizers, 1, "A second poll duplicated a still-running finalizer.");
      assert.equal(removals, 0, "A losing poll removed the active finalization lock.");
      assert.equal(lockExists, true, "A second poll stole a live finalization lock.");
    } finally {
      release.resolve();
      await observed;
    }
    const result = await observed;
    assert.equal(result.error, fails ? failure : undefined, "Finalizer failures must propagate after lock release.");
    if (!fails) assert.equal(result.value, completed);
    assert.equal(finalizers, 1);
    assert.equal(removals, 1, "Only the finalization owner may release its lock, including on failure.");
    assert.equal(lockExists, false);
  }
}

async function verifyRequestBoundOperationLifetime() {
  const failures: Error[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
      process.stdout.write(`${JSON.stringify({ fixture: name, status: "pass" })}\n`);
    } catch (error) {
      const failure = new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      failures.push(failure);
      process.stdout.write(`${JSON.stringify({ fixture: name, status: "fail", error: failure.message })}\n`);
    }
  };
  await check("POST apply accepts without background mutation", async () => {
    const accepted = { operationId: "c".repeat(64), status: "queued", phase: "queued" };
    let starts = 0;
    let scheduled = 0;
    const fetch = productionWorkerFetch({
      authorized: () => true,
      sandboxFor: async () => ({}),
      json: (body: unknown, status = 200) => Response.json(body, { status }),
      validateApply: (body: unknown) => body,
      applyGeneration: async () => accepted,
      publicOperationStatus: productionWorkerFunction("publicOperationStatus", {}),
      startQueuedOperation: async () => { starts++; return accepted; },
      SandboxOperationError: class extends Error {}
    });
    const response = await fetch(new Request("http://127.0.0.1/v1/sessions/session/apply", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: oldRevision, files: [] })
    }), {}, { waitUntil: work => { scheduled++; void work.catch(() => undefined); } });
    assert.equal(response.status, 202);
    assert.equal((await response.json() as { status: string }).status, "queued");
    assert.equal(starts, 0, "POST acceptance started preparation outside a polling request.");
    assert.equal(scheduled, 0, "POST acceptance used waitUntil for generation work.");
  });
  for (const phase of ["queued", "promoting"] as const) {
    for (const fails of [false, true]) {
      for (const viaFetch of [false, true]) {
        await check(`${viaFetch ? "GET handler" : "operationStatus"} awaits ${phase} ${fails ? "failure" : "completion"}`,
          () => verifyDeferredStatus(phase, fails, viaFetch));
      }
    }
  }
  assert.equal(failures.length, 0, `Request-bound lifecycle fixtures failed:\n${failures.map(error => error.message).join("\n")}`);
}

async function verifyDeferredStatus(phase: "queued" | "promoting", fails: boolean, viaFetch: boolean) {
  const initial = { operationId: "d".repeat(64), status: phase === "queued" ? "queued" : "running", phase };
  const updated = phase === "queued"
    ? { ...initial, status: "running", phase: "validating" }
    : { ...initial, status: "succeeded", phase: "complete", result: { revision: newRevision } };
  const entered = deferred<void>();
  const release = deferred<void>();
  const failure = new Error(`deferred ${phase} failure`);
  let starts = 0;
  let advances = 0;
  let scheduled = 0;
  const work = async () => {
    entered.resolve();
    await release.promise;
    if (fails) throw failure;
    return updated;
  };
  const status = productionWorkerFunction("operationStatus", {
    readOperationJournal: async () => initial,
    publicOperationStatus: productionWorkerFunction("publicOperationStatus", {}),
    startQueuedOperation: async () => { starts++; assert.equal(phase, "queued"); return work(); },
    advanceRunningOperation: async () => { advances++; assert.equal(phase, "promoting"); return work(); }
  });
  const schedule = (background: Promise<unknown>) => { scheduled++; void background.catch(() => undefined); };
  const fetch = productionWorkerFetch({
    authorized: () => true,
    sandboxFor: async () => ({}),
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    operationStatus: status,
    SandboxOperationError: class extends Error {}
  });
  // The extra callback captures the pre-fix signature for the red regression;
  // after its removal it is ignored, and neither path may schedule background work.
  const pending = (viaFetch
    ? fetch(new Request(`http://127.0.0.1/v1/sessions/session/operations/${initial.operationId}`), {}, { waitUntil: schedule })
    : status({}, "session", "https://sandbox.example", initial.operationId, schedule)) as Promise<unknown>;
  let settled = false;
  const observed = pending.then(value => { settled = true; return { value, error: undefined }; }, error => {
    settled = true; return { value: undefined, error };
  });
  let returnedWhileDeferred = false;
  try {
    await fixtureEntered(entered.promise, `${phase} work`);
    await fixtureCheckpoint();
    returnedWhileDeferred = settled;
  } finally {
    release.resolve();
    await observed;
  }
  const outcome = await observed;
  assert.equal(returnedWhileDeferred, false, `${viaFetch ? "GET response" : "Status"} returned while ${phase} work was unfinished.`);
  assert.equal(scheduled, 0, "Generation work escaped into a background request lifetime.");
  assert.equal(starts, phase === "queued" ? 1 : 0);
  assert.equal(advances, phase === "promoting" ? 1 : 0);
  if (viaFetch) {
    assert.equal(outcome.error, undefined);
    const response = outcome.value as Response;
    assert.equal(response.status, fails ? 500 : 200);
    const body = await response.json();
    assert.deepEqual(body, fails ? { error: "sandbox_operation_failed", detail: failure.message }
      : JSON.parse(JSON.stringify(productionWorkerFunction("publicOperationStatus", {})(updated))));
  } else if (fails) {
    assert.equal(outcome.error, failure, "operationStatus swallowed its awaited operation failure.");
  } else {
    assert.equal(outcome.error, undefined);
    assert.deepEqual(outcome.value, productionWorkerFunction("publicOperationStatus", {})(updated), "operationStatus returned its stale pre-advance journal.");
  }
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
