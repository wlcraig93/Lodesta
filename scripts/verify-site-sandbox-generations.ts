import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
