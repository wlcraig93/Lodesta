import assert from "node:assert/strict";
import { SiteSandboxClient, SiteSandboxRequestError } from "../packages/site-sandbox";
import { assertWithSandboxFailureCauses, boundedFailureLabel, captureCanaryFailureDiagnostic } from "./site-sandbox-canary-diagnostics";

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
  await verifyFailureOnlyPollDiagnostic(client);
  await verifyConcurrentCanaryFailureCaptureBeforeDestroy(client);
  await verifyMalformedDiagnosticsDoesNotPreventDestroy(client);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    acceptedSubmission: "pass",
    reconnectablePolling: "pass",
    retainedFailure: "pass",
    duplicateSubmissionReplay: "pass",
    lostAcknowledgementRecovery: "pass",
    requestBoundStatusBudget: "pass",
    failureOnlyPollDiagnostic: "pass",
    concurrentCanaryFailureCaptureBeforeDestroy: "pass",
    malformedDiagnosticsStillDestroy: "pass"
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

async function verifyFailureOnlyPollDiagnostic(client: SiteSandboxClient) {
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  let now = 0;
  let statusCalls = 0;
  try {
    Date.now = () => now;
    globalThis.setTimeout = ((callback: () => void) => {
      callback();
      return {} as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/apply")) return Response.json(operation("queued"), { status: 202 });
      statusCalls += 1;
      if (statusCalls === 1) throw new TypeError("transport token=never-retained");
      now = 210_000;
      return Response.json({ error: "api_token_never_retained", detail: "token=never-retained" }, { status: 502 });
    };
    await assert.rejects(
      () => client.apply("operation_test", "revision-before", source),
      (error) => {
        assert(error instanceof SiteSandboxRequestError);
        assert.equal(error.providerCode, "operation_status_timeout");
        assert.deepEqual(error.operationPollDiagnostic, {
          operationId,
          lastJournal: {
            status: "queued",
            phase: "queued",
            createdAt: error.operationPollDiagnostic?.lastJournal.createdAt,
            updatedAt: error.operationPollDiagnostic?.lastJournal.updatedAt,
            phaseStartedAt: error.operationPollDiagnostic?.lastJournal.phaseStartedAt,
            timestamps: { queued: error.operationPollDiagnostic?.lastJournal.timestamps.queued },
            phaseTimings: {}
          },
          pollAttempts: 2,
          journalResponses: 0,
          transportErrors: 1,
          httpErrors: 1,
          lastPollError: { kind: "http", status: 502, providerCode: "unrecognized_provider_code" }
        });
        assert(!JSON.stringify(error.operationPollDiagnostic).includes("never-retained"), "Poll diagnostics retained raw transport or provider detail.");
        return true;
      },
      "Operation timeout did not retain bounded poll/journal evidence."
    );
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
  }
}

async function verifyConcurrentCanaryFailureCaptureBeforeDestroy(client: SiteSandboxClient) {
  const events: string[] = [];
  const pollDiagnostic = {
    operationId,
    lastJournal: {
      status: "running" as const,
      phase: "validating" as const,
      createdAt: "2026-09-10T15:24:00.000Z",
      updatedAt: "2026-09-10T15:24:52.782Z",
      phaseStartedAt: "2026-09-10T15:24:52.000Z",
      timestamps: { queued: "2026-09-10T15:24:00.000Z", validating: "2026-09-10T15:24:52.000Z" },
      phaseTimings: { queueMs: 10, prepareMs: 20 }
    },
    pollAttempts: 3,
    journalResponses: 1,
    transportErrors: 1,
    httpErrors: 1,
    lastPollError: { kind: "transport" as const, name: "TypeError" }
  };
  const first = new SiteSandboxRequestError("apply", "operation_test", 504, "operation_status_timeout", "token=never-retained", pollDiagnostic);
  const second = new SiteSandboxRequestError("apply", "operation_test", 504, "api_token_never_retained", "token=never-retained", pollDiagnostic);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/diagnostics")) {
      events.push("diagnostics");
      return Response.json(diagnosticFixture());
    }
    if (url.endsWith("/destroy")) {
      events.push("destroy");
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected fixture request ${url}`);
  };
  let captured: Awaited<ReturnType<typeof captureCanaryFailureDiagnostic>> | undefined;
  let assertionError: unknown;
  try {
    const concurrent = await Promise.allSettled([Promise.reject(first), Promise.reject(second)]);
    const failures = concurrent.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const causes = failures.map((result) => result.reason).filter((reason): reason is SiteSandboxRequestError => reason instanceof SiteSandboxRequestError);
    assertWithSandboxFailureCauses(false, `Concurrent identical mutations produced no successful build: ${failures.map((result) => boundedFailureLabel(result.reason)).join(" | ")}`, causes);
  } catch (error) {
    assertionError = error;
    captured = await captureCanaryFailureDiagnostic(client, "operation_test", error);
    await client.destroy("operation_test");
  }
  assert.deepEqual(events, ["diagnostics", "destroy"], "The concurrent assertion path did not retain its diagnostic before teardown.");
  assert(assertionError instanceof Error, "The concurrent fixture did not reach the assertion failure path.");
  assert.equal(Object.getOwnPropertyDescriptor(assertionError, "sandboxFailureCauses")?.enumerable, false, "Raw concurrent causes must not become an assertion-log payload.");
  assert.equal(captured?.failure.name, "AssertionError");
  const capturedCauses = captured?.causes ?? [];
  assert.equal(capturedCauses.length, 2, "Concurrent SiteSandboxRequestError causes were lost by the assertion path.");
  assert.deepEqual(capturedCauses[0]?.poll, pollDiagnostic);
  assert.equal(capturedCauses[1]?.failure.providerCode, "unrecognized_provider_code", "Arbitrary provider text was not rejected by the diagnostic allowlist.");
  assert(!JSON.stringify(captured).includes("never-retained"), "Concurrent failure diagnostics retained raw error details.");
}

async function verifyMalformedDiagnosticsDoesNotPreventDestroy(client: SiteSandboxClient) {
  const events: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/diagnostics")) {
      events.push("diagnostics");
      return Response.json({ ok: true, revision: "known", placementId: "known" });
    }
    if (url.endsWith("/destroy")) {
      events.push("destroy");
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected fixture request ${url}`);
  };
  const originalFailure = new SiteSandboxRequestError("apply", "operation_test", 504, "operation_status_timeout", "original failure");
  const captured = await captureCanaryFailureDiagnostic(client, "operation_test", originalFailure);
  await client.destroy("operation_test");
  assert.deepEqual(events, ["diagnostics", "destroy"], "Malformed diagnostics prevented cleanup after the original failure.");
  assert.equal(captured.failure.providerCode, "operation_status_timeout", "Malformed diagnostics masked the original failure classification.");
  assert("diagnosticsFailure" in captured, "Malformed diagnostics did not retain a bounded failure.");
  assert.equal(captured.diagnosticsFailure?.name, "TypeError", "Malformed successful diagnostics were not retained as a bounded best-effort failure.");
  assert.equal("sandbox" in captured, false, "Malformed successful diagnostics were treated as a usable snapshot.");
}

function diagnosticFixture() {
  return {
    ok: true,
    revision: "b".repeat(64),
    versions: ["fixture-node"],
    sandboxManifest: {
      kind: "site-sandbox-manifest",
      apiIdentity: "api_test",
      storageIdentity: "storage_test",
      durableObjectIdentity: "do_test",
      artifactContractIdentity: "artifact_test",
      toolchainIdentity: "toolchain_test",
      sourcePolicyIdentity: "source_test"
    },
    placementId: "placement-test",
    mutationLock: { operationId, startedAt: "2026-09-10T15:24:52.000Z" },
    activeOperation: operation("running", "validating"),
    processes: [{ id: "process-test", command: "npm run build token=never-retained", status: "running" }]
  };
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
