import assert from "node:assert/strict";
import { SiteSandboxClient, SiteSandboxRequestError } from "../packages/site-sandbox";
import { executeWithFreshSandboxRecovery } from "../packages/site-platform/sandbox-recovery";

const files = [{ path: "src/site.tsx", content: "export const siteDefinition = { routes: [] };" }];
const publicInput = { schemaVersion: 1, id: "input_exact_replay", routes: ["/"] };
const payloadBytes = JSON.stringify({ files, publicInput });
const attempts: Array<{ attempt: number; sandboxId: string; revision: string; deploymentId: string; payloadBytes: string }> = [];
const sequence: string[] = [];
let sandboxId = "sandbox-first";
let revision = "revision-first";
let recycleCount = 0;
let modelRequestCount = 0;

const recovered = await executeWithFreshSandboxRecovery({
  attempt: async (attempt) => {
    sequence.push(`attempt:${attempt}`);
    attempts.push({ attempt, sandboxId, revision, deploymentId: "deployment-pinned", payloadBytes });
    if (attempt === 1) throw infrastructureFailure();
    return { sandboxId, revision, payloadBytes };
  },
  recycle: async () => {
    sequence.push("recycle");
    recycleCount += 1;
    sandboxId = "sandbox-fresh";
    revision = "revision-fresh";
  },
  isRepairable: isRepairable,
  isInfrastructureFailure: isInfrastructure,
  recoveryReason: () => "build_timeout",
  terminalError: (error) => new Error("sandbox_unavailable", { cause: error })
});

assert.equal(recycleCount, 1, "Controller did not recycle exactly one uncertain sandbox.");
assert.equal(attempts.length, 2, "Controller did not stop after one exact replay.");
assert.notEqual(attempts[0]?.sandboxId, attempts[1]?.sandboxId, "Recovery reused the uncertain sandbox instance.");
assert.equal(attempts[0]?.deploymentId, attempts[1]?.deploymentId, "Recovery changed the pinned deployment.");
assert.equal(attempts[0]?.payloadBytes, attempts[1]?.payloadBytes, "Recovery changed the candidate files or public input bytes.");
assert.deepEqual(sequence, ["attempt:1", "recycle", "attempt:2"], "Work occurred between the failed build and exact replay.");
assert.equal(modelRequestCount, 0, "Recovery made an intervening model request.");
assert.equal(recovered.sandboxId, "sandbox-fresh");

let failedAttempts = 0;
await assert.rejects(
  executeWithFreshSandboxRecovery({
    attempt: async () => {
      failedAttempts += 1;
      throw infrastructureFailure();
    },
    recycle: async () => undefined,
    isRepairable,
    isInfrastructureFailure: isInfrastructure,
    recoveryReason: () => "build_timeout",
    terminalError: (error) => new Error("sandbox_unavailable", { cause: error })
  }),
  /sandbox_unavailable/,
  "Two infrastructure failures did not become retryable sandbox_unavailable."
);
assert.equal(failedAttempts, 2, "Controller made more than two infrastructure attempts.");

let repairableAttempts = 0;
let repairableRecycles = 0;
await assert.rejects(
  executeWithFreshSandboxRecovery({
    attempt: async () => {
      repairableAttempts += 1;
      throw new SiteSandboxRequestError("apply", "sandbox-first", 422, "build_failed", "TypeScript error");
    },
    recycle: async () => {
      repairableRecycles += 1;
    },
    isRepairable,
    isInfrastructureFailure: isInfrastructure,
    recoveryReason: () => "build_failed",
    terminalError: (error) => error
  }),
  (error) => error instanceof SiteSandboxRequestError && error.providerCode === "build_failed",
  "Agent-repairable compilation diagnostics were hidden by infrastructure recovery."
);
assert.equal(repairableAttempts, 1);
assert.equal(repairableRecycles, 0);

await verifyInterruptedExecutorUsesControllerRecovery();

process.stdout.write(`${JSON.stringify({
  ok: true,
  freshSandboxReplay: "pass",
  byteIdenticalPayload: "pass",
  interruptedExecutorUsesControllerRecovery: "pass",
  maxAttempts: 2,
  interveningModelRequests: modelRequestCount
})}\n`);

async function verifyInterruptedExecutorUsesControllerRecovery() {
  const originalFetch = globalThis.fetch;
  const operationId = "a".repeat(64);
  const candidateFiles = [
    { path: "src/site.tsx", content: "export const siteDefinition = { routes: [{ path: '/', element: <main>Retained edit</main> }] };" },
    { path: "src/styles.css", content: "main{display:block}" }
  ];
  const client = new SiteSandboxClient("http://127.0.0.1", "fixture-only");
  const events: string[] = [];
  const bodies: string[] = [];
  let currentSession = "interrupted_sandbox";
  let firstExecutions = 0;
  let recycled = false;
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/apply")) {
        events.push(`apply:${currentSession}`);
        bodies.push(String(init?.body));
        if (currentSession === "recovered_sandbox") {
          assert(recycled, "The candidate was replayed before disposal and checkpoint restoration.");
          return Response.json({ ok: true, revision: "revision-after", operationId, activeGenerationRevision: "revision-after" });
        }
        return Response.json({ ok: true, operationId, status: "running", phase: "preparing" }, { status: 202 });
      }
      assert(url.endsWith(`/operations/${operationId}/execute`));
      events.push("interrupted-execute");
      // Bound a broken implementation's test rather than waiting 210 seconds.
      if (++firstExecutions > 1) throw new SiteSandboxRequestError("execute", currentSession, 400, "fixture_unexpected_second_execute", "The client retried after an explicit execution failure.");
      return Response.json({ error: "sandbox_operation_failed", detail: "fixture connection interrupted" }, { status: 500 });
    };
    const actual = await executeWithFreshSandboxRecovery({
      attempt: () => client.apply(currentSession, "retained-revision", candidateFiles),
      recycle: async reason => {
        assert.equal(reason, "sandbox_operation_failed");
        events.push("destroy-and-restore-checkpoint");
        recycled = true;
        currentSession = "recovered_sandbox";
      },
      isRepairable,
      isInfrastructureFailure: isInfrastructure,
      recoveryReason: error => error instanceof SiteSandboxRequestError ? error.providerCode! : "unexpected",
      terminalError: error => error
    });
    assert.equal(actual.revision, "revision-after");
    assert.equal(firstExecutions, 1);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1], "Controller recovery changed the retained revision or pending edit bytes.");
    assert.deepEqual(events, ["apply:interrupted_sandbox", "interrupted-execute", "destroy-and-restore-checkpoint", "apply:recovered_sandbox"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function infrastructureFailure() {
  return new SiteSandboxRequestError("apply", "sandbox-first", 504, "build_timeout", "provider deadline");
}

function isRepairable(error: unknown) {
  return error instanceof SiteSandboxRequestError
    && error.status === 422
    && (error.providerCode === "source_policy_violation" || error.providerCode === "build_failed");
}

function isInfrastructure(error: unknown) {
  return error instanceof SiteSandboxRequestError
    && (error.status >= 500 || error.providerCode === "build_timeout");
}
