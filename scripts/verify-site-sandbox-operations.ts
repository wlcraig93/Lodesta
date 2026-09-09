import assert from "node:assert/strict";
import { SiteSandboxClient, SiteSandboxRequestError } from "../packages/site-sandbox";

const originalFetch = globalThis.fetch;
const operationId = "a".repeat(64);
const result = {
  ok: true as const,
  revision: "b".repeat(64),
  previewUrl: "http://127.0.0.1/v1/sessions/operation_test/preview/",
  buildDurationMs: 1200,
  placementId: "placement-test",
  operationId,
  activeGenerationRevision: "b".repeat(64),
  phaseTimings: { queueMs: 1, prepareMs: 2, validationMs: 3, buildMs: 1200, promotionMs: 4, totalMs: 1210 }
};
const source = [{
  path: "src/site.tsx",
  content: "export const siteDefinition = { routes: [{ path: '/', element: <main>Ready</main> }] };"
}, {
  path: "src/styles.css",
  content: "main{display:block}"
}];

try {
  const requests: string[] = [];
  let statusCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/apply")) {
      return Response.json(operation("queued"), { status: 202 });
    }
    statusCalls += 1;
    if (statusCalls === 1) throw new TypeError("simulated transport reset");
    if (statusCalls === 2) return Response.json(operation("running", "compiling"));
    return Response.json({ ...operation("succeeded", "complete"), result });
  };
  const client = new SiteSandboxClient("http://127.0.0.1", "test-token");
  const applied = await client.apply("operation_test", "revision-before", source);
  assert.equal(applied.revision, result.revision);
  assert.equal(requests.filter((url) => url.endsWith("/apply")).length, 1, "Polling resubmitted the mutation after transport loss.");
  assert.equal(requests.filter((url) => url.endsWith(`/operations/${operationId}`)).length, 3, "Client did not reconnect through the operation status endpoint.");

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/apply")) return Response.json(operation("queued"), { status: 202 });
    return Response.json({
      ...operation("failed", "complete"),
      ok: false,
      failure: {
        status: 422,
        payload: { error: "build_failed", stderr: "TypeScript fixture failure" }
      }
    });
  };
  await assert.rejects(
    () => client.apply("operation_test", "revision-before", source),
    (error) => error instanceof SiteSandboxRequestError
      && error.status === 422
      && error.providerCode === "build_failed"
      && error.message.includes("TypeScript fixture failure"),
    "A completed operation failure did not retain its repairable diagnostic."
  );

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/apply")) return Response.json({ ...operation("running", "validating"), submissionReplayed: true }, { status: 202 });
    return Response.json({ ...operation("succeeded", "complete"), result });
  };
  const replayed = await client.apply("operation_test", "revision-before", source);
  assert.equal(replayed.replayed, true, "A duplicate submission was not identified as replayed after shared polling completed.");

  let submitCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/apply")) {
      submitCalls += 1;
      if (submitCalls === 1) throw new DOMException("simulated lost acknowledgement", "TimeoutError");
      return Response.json({ ...operation("succeeded", "complete"), result, submissionReplayed: true }, { status: 202 });
    }
    throw new Error(`Unexpected operation replay request ${url}`);
  };
  const recoveredSubmission = await client.apply("operation_test", "revision-before", source);
  assert.equal(submitCalls, 2, "A lost submission acknowledgement did not replay exactly once in the same sandbox.");
  assert.equal(recoveredSubmission.operationId, operationId);
  assert.equal(recoveredSubmission.replayed, true);
  assert.equal(recoveredSubmission.submissionAttempts, 2);
  assert.equal(recoveredSubmission.submissionRecoveryCause, "TimeoutError");
  assert((recoveredSubmission.submissionPayloadBytes ?? 0) > 0);

  await verifyRequestBoundStatusBudget(client);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    acceptedSubmission: "pass",
    reconnectablePolling: "pass",
    retainedFailure: "pass",
    duplicateSubmissionReplay: "pass",
    lostAcknowledgementRecovery: "pass",
    requestBoundStatusBudget: "pass"
  })}\n`);
} finally {
  globalThis.fetch = originalFetch;
}

async function verifyRequestBoundStatusBudget(client: SiteSandboxClient) {
  const originalNow = Date.now;
  const originalTimeout = AbortSignal.timeout;
  let now = 0;
  const timeouts: number[] = [];
  let polls = 0;
  try {
    Date.now = () => now;
    AbortSignal.timeout = (milliseconds) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    };
    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/apply")) return Response.json(operation("queued"), { status: 202 });
      if (++polls === 1) {
        // Preparation/finalization now stays attached to the request. Simulate
        // elapsed operation time without sleeping through a real deadline.
        now = 200_000;
        return Response.json(operation("running", "promoting"));
      }
      return Response.json({ ...operation("succeeded", "complete"), result });
    };
    assert.equal((await client.apply("operation_test", "revision-before", source)).revision, result.revision);
    assert.deepEqual(timeouts, [30_000, 150_000, 10_000],
      "Status work must use the normal request ceiling capped by the remaining 210-second operation deadline; submission acknowledgement stays 30 seconds.");
  } finally {
    Date.now = originalNow;
    AbortSignal.timeout = originalTimeout;
  }
}

function operation(
  status: "queued" | "running" | "succeeded" | "failed",
  phase: "queued" | "preparing" | "validating" | "compiling" | "promoting" | "complete" = "queued"
) {
  const now = new Date().toISOString();
  return {
    ok: status !== "failed",
    operationId,
    status,
    phase,
    createdAt: now,
    updatedAt: now,
    phaseStartedAt: now,
    timestamps: { [phase]: now },
    phaseTimings: {}
  };
}
