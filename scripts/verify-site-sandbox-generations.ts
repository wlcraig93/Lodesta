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
assert.equal(
  workerSource.match(/await sandbox\.killAllProcesses\(\);/g)?.length,
  1,
  "Only workspace bootstrap may use kill-all process shutdown."
);
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
await verifyBootstrapStartFailureShortCircuit();
await verifyOperationJournalReads();
await verifySubmissionJournalReadSafety();
await verifyQueuedJournalRace();
await verifyPreWorkLockOwnershipCleanup();
await verifyPreparationObserver();
await verifyAbandonedPreparationOwner();
await verifyProcessStartJournalAmbiguity();
await verifyExplicitJournalAbsenceAfterCompilation();
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
  boundedFreshSandboxReplay: "pass",
  abandonedPreparingOwner: "pass",
  postProcessJournalAmbiguity: "pass",
  explicitJournalAbsence: "pass"
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

async function verifyBootstrapStartFailureShortCircuit() {
  const startFailure = Object.assign(
    new Error("Container failed to start: simulated bootstrap failure"),
    { code: "INTERNAL_ERROR" }
  );
  let workspaceMutationCalls = 0;
  const bootstrap = productionWorkerFunction("bootstrapWorkspace", {}) as (
    sandbox: {
      killAllProcesses(): Promise<void>;
      mkdir(): Promise<void>;
      exec(): Promise<{ success: boolean }>;
      writeFile(): Promise<void>;
    },
    sessionId: string,
    publicBuildInput: unknown
  ) => Promise<string>;
  const sandbox = {
    killAllProcesses: async () => { throw startFailure; },
    mkdir: async () => { workspaceMutationCalls += 1; },
    exec: async () => { workspaceMutationCalls += 1; return { success: true }; },
    writeFile: async () => { workspaceMutationCalls += 1; }
  };

  await assert.rejects(
    bootstrap(sandbox, "session-bootstrap-start-failure", {}),
    error => error === startFailure,
    "Bootstrap hid the first container-start failure."
  );
  assert.equal(workspaceMutationCalls, 0, "Bootstrap mutated the workspace after container startup failed.");

  const fetch = productionWorkerFetch({
    authorized: () => true,
    sandboxFor: async () => sandbox,
    bootstrapWorkspace: bootstrap,
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    SandboxOperationError: class extends Error {}
  });
  const response = await fetch(new Request("http://127.0.0.1/v1/sessions/session/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicBuildInput: {} })
  }), {}, { waitUntil: () => undefined });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "INTERNAL_ERROR",
    detail: startFailure.message
  }, "The Worker did not preserve the installed SDK startup code for controller retry classification.");
  assert.equal(workspaceMutationCalls, 0, "The routed bootstrap mutated the workspace after container startup failed.");
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
    readFile(path: string, options: { encoding: string }): Promise<{ content: string }>;
  }, operationId: string) => Promise<unknown>;
  const adapter = (readFile: () => Promise<{ content: string }>) => ({ readFile });
  const sdkError = (code: string, message: string) => Object.assign(new Error(message), {
    errorResponse: { code, message, context: {}, httpStatus: code === "FILE_NOT_FOUND" ? 404 : 500,
      timestamp: "2026-09-17T00:00:00.000Z" }
  });

  let directReads = 0;
  const missing = sdkError("FILE_NOT_FOUND", "simulated structured missing journal");
  assert.equal(await read(adapter(async () => { directReads += 1; throw missing; }), operationId), undefined,
    "A structured FILE_NOT_FOUND journal read did not remain the sole not-found case.");
  assert.equal(directReads, 1, "Journal absence performed more than one filesystem read.");

  const inheritedErrorResponse = new Error("simulated inherited SDK response");
  Object.setPrototypeOf(inheritedErrorResponse, {
    errorResponse: { code: "FILE_NOT_FOUND", message: inheritedErrorResponse.message }
  });
  const inheritedCode = Object.assign(Object.create({ code: "FILE_NOT_FOUND" }) as Record<string, unknown>, {
    message: "simulated inherited SDK response code"
  });
  const inheritedCodeResponse = Object.assign(new Error("simulated inherited SDK response code"), {
    errorResponse: inheritedCode
  });
  const rawEnoent = Object.assign(new Error("simulated raw system ENOENT"), { code: "ENOENT" });
  const propagatedErrors = [
    sdkError("RPC_TRANSPORT_ERROR", "simulated read RPC interruption"),
    sdkError("FILESYSTEM_ERROR", "journal not found because the filesystem read failed"),
    sdkError("PERMISSION_DENIED", "simulated journal permission failure"),
    Object.assign(new Error("simulated top-level code lost its SDK response"), { code: "FILE_NOT_FOUND" }),
    rawEnoent,
    Object.assign(new Error("File not found: simulated journal"), { name: "FileNotFoundError" }),
    Object.assign(new Error("simulated null SDK response"), { errorResponse: null }),
    Object.assign(new Error("simulated string SDK response"), { errorResponse: "FILE_NOT_FOUND" }),
    Object.assign(new Error("simulated SDK response without a code"), { errorResponse: { message: "missing code" } }),
    inheritedErrorResponse,
    inheritedCodeResponse,
    new TypeError("simulated readFile RPC failure")
  ];
  for (const readFailure of propagatedErrors) {
    await assert.rejects(
      read(adapter(async () => { throw readFailure; }), operationId),
      error => error === readFailure,
      `A ${"code" in readFailure ? readFailure.code : readFailure.name} journal read failure was misreported as missing.`
    );
  }
  for (const content of ["{not-json", "null", JSON.stringify({ ...journal, operationId: "wrong" }), JSON.stringify({ ...journal, schemaVersion: 2 })]) {
    await assert.rejects(
      read(adapter(async () => ({ content })), operationId),
      error => error instanceof Conflict && error.status === 500 && error.payload.error === "operation_journal_invalid",
      "Malformed or mismatched retained journal bytes did not fail loudly."
    );
  }
  assert.deepEqual(await read(adapter(async () => ({ content: JSON.stringify(journal) })), operationId), journal);

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
  const missingResponse = await fetchStatus(adapter(async () => { throw missing; }))(
    new Request(`http://127.0.0.1/v1/sessions/session/operations/${operationId}`), {}, { waitUntil: () => undefined });
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "operation_not_found", operationId });
  const transportFailure = propagatedErrors[0];
  const transportResponse = await fetchStatus(adapter(async () => { throw transportFailure; }))(
    new Request(`http://127.0.0.1/v1/sessions/session/operations/${operationId}`), {}, { waitUntil: () => undefined });
  assert.equal(transportResponse.status, 500);
  assert.equal((await transportResponse.json() as { error?: string }).error, "sandbox_operation_failed",
    "The GET handler misreported a journal transport failure as operation_not_found.");
  const rawEnoentResponse = await fetchStatus(adapter(async () => { throw rawEnoent; }))(
    new Request(`http://127.0.0.1/v1/sessions/session/operations/${operationId}`), {}, { waitUntil: () => undefined });
  assert.equal(rawEnoentResponse.status, 500);
  assert.equal((await rawEnoentResponse.json() as { error?: string }).error, "sandbox_operation_failed",
    "A raw ENOENT was broadened into operation_not_found.");
  const malformedResponse = await fetchStatus(adapter(async () => ({ content: "null" })))(
    new Request(`http://127.0.0.1/v1/sessions/session/operations/${operationId}`), {}, { waitUntil: () => undefined });
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
  const sandbox = (readFile: () => Promise<{ content: string }>) => ({
    readFile,
    mkdir: async () => undefined,
    exec: async (command: string) => { commands.push(command); return { success: true }; },
    writeFile: async (path: string, content: string) => { writes.push({ kind: "file", path, content }); }
  });
  const sdkError = (code: string, message: string) => Object.assign(new Error(message), {
    errorResponse: { code, message, context: {}, httpStatus: code === "FILE_NOT_FOUND" ? 404 : 500,
      timestamp: "2026-09-17T00:00:00.000Z" }
  });
  const missing = () => sdkError("FILE_NOT_FOUND", "simulated structured missing journal");

  for (const fixture of [{
    name: "readFile RPC failure",
    error: new TypeError("simulated retained journal readFile RPC failure"),
    adapter: () => sandbox(async () => { throw new TypeError("simulated retained journal readFile RPC failure"); })
  }, {
    name: "filesystem failure containing not-found prose",
    error: sdkError("FILESYSTEM_ERROR", "journal not found because its filesystem read failed"),
    adapter: () => sandbox(async () => { throw sdkError("FILESYSTEM_ERROR", "journal not found because its filesystem read failed"); })
  }, {
    name: "malformed JSON",
    error: undefined,
    adapter: () => sandbox(async () => ({ content: "{not-json" }))
  }]) {
    await assert.rejects(submit(fixture.adapter(), "session", input), error => fixture.error
      ? error instanceof Error && error.message === fixture.error.message
      : error instanceof Conflict && error.payload.error === "operation_journal_invalid",
    `Submission continued after an initial ${fixture.name}.`);
    assert.deepEqual(commands, [], `Submission acquired a lock after an initial ${fixture.name}.`);
    assert.deepEqual(writes, [], `Submission wrote bytes after an initial ${fixture.name}.`);
  }

  let readAttempts = 0;
  const secondReadFailure = new TypeError("simulated second journal read RPC failure");
  await assert.rejects(submit(sandbox(async () => {
    readAttempts += 1;
    if (readAttempts === 1) throw missing();
    throw secondReadFailure;
  }), "session", input), error => error === secondReadFailure,
  "Submission continued after the journal re-read under its acceptance lock failed.");
  assert.deepEqual(commands, [
    `mkdir /fixture/operations/${operationId}.accept.lock`,
    `rm -rf /fixture/operations/${operationId}.accept.lock`
  ], "Submission did not release only its acquired lock after the second journal read failed.");
  assert.deepEqual(writes, [], "Submission wrote bytes after its second journal read failed.");

  commands.length = 0;
  const accepted = await submit(sandbox(async () => { throw missing(); }), "session", input) as { operationId?: string; status?: string };
  assert.equal(accepted.operationId, operationId);
  assert.equal(accepted.status, "queued", "A truly absent journal was not accepted as a new queued operation.");
  assert.equal(writes.length, 2, "A new operation did not write exactly one request and one journal.");

  writes.length = 0;
  commands.length = 0;
  const retained = { schemaVersion: 1, operationId, payloadHash, status: "running", phase: "validating" };
  const replayed = await submit(sandbox(async () => ({ content: JSON.stringify(retained) })), "session", input) as { submissionReplayed?: boolean };
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

async function verifyPreWorkLockOwnershipCleanup() {
  class Conflict extends Error {
    constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
  }

  const operationId = "e".repeat(64);
  const queued = {
    schemaVersion: 1,
    operationId,
    payloadHash: "payload",
    status: "queued",
    phase: "queued",
    createdAt: "2026-09-18T18:58:23.718Z",
    updatedAt: "2026-09-18T18:58:23.718Z",
    phaseStartedAt: "2026-09-18T18:58:23.718Z",
    timestamps: { queued: "2026-09-18T18:58:23.718Z" },
    phaseTimings: {}
  };

  const readFailure = new TypeError("simulated post-acquisition journal read failure");
  let reads = 0;
  let lockOwned = false;
  let releases = 0;
  let transitions = 0;
  let failures = 0;
  const start = productionWorkerFunction("startQueuedOperation", {
    readOperationJournal: async () => {
      if (++reads === 1) return queued;
      throw readFailure;
    },
    acquireMutationLock: async () => { lockOwned = true; },
    mutationLock: "/fixture/mutation.lock",
    transitionOperation: async () => { transitions++; return queued; },
    failOperation: async () => { failures++; return queued; },
    SandboxOperationError: Conflict
  });
  await assert.rejects(start({ exec: async (command: string) => {
    assert.equal(command, "rm -rf /fixture/mutation.lock");
    assert.equal(lockOwned, true, "A non-owner attempted to release the mutation lock.");
    lockOwned = false;
    releases++;
    throw new TypeError("simulated committed removal response loss");
  } }, "session", "https://sandbox.example", operationId), error => error === readFailure);
  assert.equal(lockOwned, false, "A failed post-acquisition journal read stranded its owned lock.");
  assert.equal(releases, 1, "The pre-work owner did not release its lock exactly once.");
  assert.equal(transitions, 0, "A failed journal re-read entered preparation.");
  assert.equal(failures, 0, "A read failure marked the retained queued journal failed.");

  let competitorDeletes = 0;
  const competitor = productionWorkerFunction("startQueuedOperation", {
    readOperationJournal: async () => queued,
    acquireMutationLock: async () => { throw new Conflict(409, { error: "operation_in_progress" }); },
    mutationLock: "/fixture/mutation.lock",
    SandboxOperationError: Conflict
  });
  assert.equal(await competitor({ exec: async () => { competitorDeletes++; return { success: true }; } },
    "session", "https://sandbox.example", operationId), queued);
  assert.equal(competitorDeletes, 0, "A lock competitor deleted another invocation's lock.");

  const acquire = productionWorkerFunction("acquireMutationLock", {
    sessionRoot: "/fixture",
    mutationLock: "/fixture/mutation.lock",
    readJson: async () => undefined,
    SandboxOperationError: Conflict
  });
  const metadataFailure = new TypeError("simulated lock metadata write failure");
  let metadataLockOwned = false;
  let metadataReleases = 0;
  await assert.rejects(acquire({
    mkdir: async () => undefined,
    exec: async (command: string) => {
      if (command === "mkdir /fixture/mutation.lock") {
        assert.equal(metadataLockOwned, false);
        metadataLockOwned = true;
        return { success: true };
      }
      assert.equal(command, "rm -rf /fixture/mutation.lock");
      assert.equal(metadataLockOwned, true, "Metadata cleanup did not own the acquired lock.");
      metadataLockOwned = false;
      metadataReleases++;
      return { success: true };
    },
    writeFile: async () => { throw metadataFailure; }
  }, operationId), error => error === metadataFailure);
  assert.equal(metadataLockOwned, false, "A lock metadata write failure stranded its owned lock.");
  assert.equal(metadataReleases, 1, "A metadata write failure did not release its lock exactly once.");
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

async function verifyAbandonedPreparationOwner() {
  const operationId = "a".repeat(64);
  const createdAt = "2026-09-17T00:35:59.742Z";
  const queued = {
    schemaVersion: 1,
    operationId,
    payloadHash: "payload",
    status: "queued",
    phase: "queued",
    createdAt,
    updatedAt: createdAt,
    phaseStartedAt: createdAt,
    timestamps: { queued: createdAt },
    phaseTimings: {}
  };
  let retained: Record<string, unknown> = queued;
  let lockOwned = false;
  const preparationEntered = deferred<void>();
  const neverCompletes = deferred<void>();
  class Conflict extends Error {
    constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
  }
  const transitionOperation = productionWorkerFunction("transitionOperation", {
    writeOperationJournal: async (_sandbox: unknown, journal: Record<string, unknown>) => { retained = journal; }
  });
  const failOperation = productionWorkerFunction("failOperation", {
    writeOperationJournal: async (_sandbox: unknown, journal: Record<string, unknown>) => { retained = journal; },
    cleanupOperationProcess: async () => undefined,
    mutationLock: "/fixture/mutation.lock",
    SandboxOperationError: Conflict
  });
  const start = productionWorkerFunction("startQueuedOperation", {
    readOperationJournal: async () => retained,
    acquireMutationLock: async () => { assert.equal(lockOwned, false); lockOwned = true; },
    mutationLock: "/fixture/mutation.lock",
    transitionOperation,
    operationRequestPath: () => "/fixture/request.json",
    readJson: async () => ({ action: "apply", expectedRevision: oldRevision, files: [], publicInputJson: "{}" }),
    readActiveGeneration: async () => ({ revision: oldRevision }),
    reconcileGenerationCleanup: async () => {
      preparationEntered.resolve();
      await neverCompletes.promise;
    },
    digest: async () => newRevision,
    generationPath: () => "/fixture/candidate",
    scaffoldGenerationCommand: () => "prepare-candidate",
    writeGenerationInput: async () => undefined,
    writeGenerationSource: async () => undefined,
    operationValidationMarker: () => "/fixture/validation-marker",
    disposeRpc: () => undefined,
    writeOperationJournal: async (_sandbox: unknown, journal: Record<string, unknown>) => { retained = journal; },
    failOperation,
    SandboxOperationError: Conflict
  });
  const sandbox = {
    exec: async (command: string) => {
      if (command === "rm -rf /fixture/mutation.lock") { lockOwned = false; return { success: true, stderr: "" }; }
      return { success: true, stderr: "" };
    },
    writeFile: async () => undefined,
    startProcess: async () => { throw new Error("Preparation should remain deferred before process start."); }
  };
  const owner = start(sandbox, "session", "https://sandbox.example", operationId) as Promise<unknown>;
  let ownerSettled = false;
  void owner.then(() => { ownerSettled = true; }, () => { ownerSettled = true; });
  await fixtureEntered(preparationEntered.promise, "abandoned preparation boundary");
  await fixtureCheckpoint();
  assert.equal(ownerSettled, false, "The deferred preparation owner unexpectedly settled.");
  assert.equal(retained.status, "running");
  assert.equal(retained.phase, "preparing");
  assert.equal(lockOwned, true);

  const status = productionWorkerFunction("operationStatus", {
    readOperationJournal: async () => retained,
    publicOperationStatus: productionWorkerFunction("publicOperationStatus", {}),
    startQueuedOperation: async () => { throw new Error("A preparing observer restarted the abandoned owner."); },
    advanceRunningOperation: async () => { throw new Error("A preparing observer advanced the abandoned owner."); },
    SandboxOperationError: Conflict
  });
  const observed = await status(sandbox, "session", "https://sandbox.example", operationId) as { status?: string; phase?: string };
  assert.equal(observed.status, "running");
  assert.equal(observed.phase, "preparing");
  assert.equal(lockOwned, true, "A preparation observer released the owner's mutation lock.");

  let rejectedRetained: Record<string, unknown> = queued;
  let rejectedLockOwned = false;
  let cleaned = 0;
  const rejectedTransition = productionWorkerFunction("transitionOperation", {
    writeOperationJournal: async (_sandbox: unknown, journal: Record<string, unknown>) => { rejectedRetained = journal; }
  });
  const rejectedFail = productionWorkerFunction("failOperation", {
    writeOperationJournal: async (_sandbox: unknown, journal: Record<string, unknown>) => { rejectedRetained = journal; },
    cleanupOperationProcess: async () => { cleaned += 1; },
    mutationLock: "/fixture/mutation.lock",
    SandboxOperationError: Conflict
  });
  const ordinaryFailure = new Error("ordinary preparation rejection");
  const rejectedStart = productionWorkerFunction("startQueuedOperation", {
    readOperationJournal: async () => rejectedRetained,
    acquireMutationLock: async () => { rejectedLockOwned = true; },
    mutationLock: "/fixture/mutation.lock",
    transitionOperation: rejectedTransition,
    operationRequestPath: () => "/fixture/request.json",
    readJson: async () => ({ action: "apply", expectedRevision: oldRevision, files: [], publicInputJson: "{}" }),
    readActiveGeneration: async () => ({ revision: oldRevision }),
    reconcileGenerationCleanup: async () => { throw ordinaryFailure; },
    digest: async () => newRevision,
    generationPath: () => "/fixture/candidate",
    scaffoldGenerationCommand: () => "prepare-candidate",
    writeGenerationInput: async () => undefined,
    writeGenerationSource: async () => undefined,
    operationValidationMarker: () => "/fixture/validation-marker",
    disposeRpc: () => undefined,
    writeOperationJournal: async (_sandbox: unknown, journal: Record<string, unknown>) => { rejectedRetained = journal; },
    failOperation: rejectedFail,
    SandboxOperationError: Conflict
  });
  const rejectedSandbox = {
    exec: async (command: string) => {
      if (command === "rm -rf /fixture/mutation.lock") rejectedLockOwned = false;
      return { success: true, stderr: "" };
    }
  };
  const failed = await rejectedStart(rejectedSandbox, "session", "https://sandbox.example", operationId) as {
    status?: string;
    phase?: string;
    failure?: { payload?: { error?: string; detail?: string } };
  };
  assert.equal(failed.status, "failed", "An ordinary preparation rejection did not become terminal.");
  assert.equal(failed.phase, "complete");
  assert.equal(failed.failure?.payload?.error, "sandbox_operation_failed");
  assert.equal(failed.failure?.payload?.detail, ordinaryFailure.message);
  assert.equal(rejectedLockOwned, false, "An ordinary preparation rejection retained the mutation lock.");
  assert.equal(cleaned, 1, "An ordinary preparation rejection skipped process cleanup.");
}

async function verifyProcessStartJournalAmbiguity() {
  const operationId = "b".repeat(64);
  const createdAt = "2026-09-17T00:36:00.000Z";
  const queued = {
    schemaVersion: 1,
    operationId,
    payloadHash: "payload",
    status: "queued",
    phase: "queued",
    createdAt,
    updatedAt: createdAt,
    phaseStartedAt: createdAt,
    timestamps: { queued: createdAt },
    phaseTimings: {}
  };
  let retained: Record<string, unknown> = queued;
  let lockOwned = false;
  let journalWrites = 0;
  let processStarted = false;
  let failed = 0;
  const ambiguousWrite = new TypeError("simulated validating-journal RPC ambiguity");
  const writeOperationJournal = async (_sandbox: unknown, journal: Record<string, unknown>) => {
    journalWrites += 1;
    if (journalWrites === 2) throw ambiguousWrite;
    retained = journal;
  };
  const transitionOperation = productionWorkerFunction("transitionOperation", { writeOperationJournal });
  class Conflict extends Error {
    constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
  }
  const start = productionWorkerFunction("startQueuedOperation", {
    readOperationJournal: async () => retained,
    acquireMutationLock: async () => { lockOwned = true; },
    mutationLock: "/fixture/mutation.lock",
    transitionOperation,
    operationRequestPath: () => "/fixture/request.json",
    readJson: async () => ({ action: "apply", expectedRevision: oldRevision, files: [], publicInputJson: "{}" }),
    readActiveGeneration: async () => ({ revision: oldRevision }),
    reconcileGenerationCleanup: async () => undefined,
    digest: async () => newRevision,
    generationPath: () => "/fixture/candidate",
    scaffoldGenerationCommand: () => "prepare-candidate",
    writeGenerationInput: async () => undefined,
    writeGenerationSource: async () => undefined,
    operationValidationMarker: () => "/fixture/validation-marker",
    disposeRpc: () => undefined,
    writeOperationJournal,
    failOperation: async () => { failed += 1; throw new Error("Ambiguous post-start write incorrectly failed the operation."); },
    SandboxOperationError: Conflict
  });
  const processId = `lodesta-build-${operationId.slice(0, 24)}`;
  const sandbox = {
    exec: async () => ({ success: true, stderr: "" }),
    writeFile: async () => undefined,
    startProcess: async (_command: string, options: { processId: string }) => {
      assert.equal(options.processId, processId);
      processStarted = true;
      return { id: processId };
    }
  };
  await assert.rejects(
    start(sandbox, "session", "https://sandbox.example", operationId),
    error => error === ambiguousWrite,
    "An ambiguous validating-journal write did not propagate after process start."
  );
  assert.equal(processStarted, true);
  assert.equal(journalWrites, 2);
  assert.equal(failed, 0, "Post-start ambiguity called destructive failure cleanup.");
  assert.equal(retained.status, "running");
  assert.equal(retained.phase, "preparing", "A failed validating-journal write changed retained phase.");
  assert.equal(retained.processId, undefined, "The retained preparing journal invented an uncommitted process ID.");
  assert.equal(lockOwned, true, "Post-start ambiguity released the mutation lock.");
}

async function verifyExplicitJournalAbsenceAfterCompilation() {
  const operationId = "c".repeat(64);
  const compiling = {
    schemaVersion: 1,
    operationId,
    payloadHash: "payload",
    status: "running",
    phase: "compiling",
    createdAt: "2026-09-17T00:28:47.842Z",
    updatedAt: "2026-09-17T00:28:53.343Z",
    phaseStartedAt: "2026-09-17T00:28:53.343Z",
    timestamps: { queued: "2026-09-17T00:28:47.842Z", compiling: "2026-09-17T00:28:53.343Z" },
    phaseTimings: {},
    candidateRevision: newRevision,
    processId: `lodesta-build-${operationId.slice(0, 24)}`
  };
  let visible = true;
  const process = { id: compiling.processId, status: "completed" };
  const readOperationJournal = productionWorkerFunction("readOperationJournal", {
    operationsRoot: "/fixture/operations",
    SandboxOperationError: class extends Error {
      constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
    }
  });
  const sandbox = {
    readFile: async () => {
      if (!visible) throw Object.assign(new Error("simulated structured missing journal"), {
        errorResponse: { code: "FILE_NOT_FOUND", message: "simulated structured missing journal", context: {},
          httpStatus: 404, timestamp: "2026-09-17T00:00:00.000Z" }
      });
      return { content: JSON.stringify(compiling) };
    },
    processes: [process]
  };
  assert.deepEqual(await readOperationJournal(sandbox, operationId), compiling, "The compiling journal was not initially readable.");
  visible = false;
  let advances = 0;
  class Conflict extends Error {
    constructor(public status: number, public payload: Record<string, unknown>) { super(String(payload.error)); }
  }
  const status = productionWorkerFunction("operationStatus", {
    readOperationJournal,
    publicOperationStatus: productionWorkerFunction("publicOperationStatus", {}),
    startQueuedOperation: async () => { throw new Error("Missing journal restarted the operation."); },
    advanceRunningOperation: async () => { advances += 1; return compiling; },
    SandboxOperationError: Conflict
  });
  await assert.rejects(
    status(sandbox, "session", "https://sandbox.example", operationId),
    error => error instanceof Conflict && error.status === 404 && error.payload.error === "operation_not_found",
    "Structured post-compilation FILE_NOT_FOUND did not become operation_not_found."
  );
  assert.equal(advances, 0, "A missing journal still attempted to inspect or finalize its completed process.");
  assert.equal(process.status, "completed", "Journal absence mutated the detached process fixture.");
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
