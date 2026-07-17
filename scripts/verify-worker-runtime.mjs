import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  childExitDecision,
  nextWorkerRestart,
  shouldWarnWorkerCrash,
  workerRestartMaxDelayMs
} from "./dev-supervisor.mjs";
import {
  defaultOpenAiRequestTimeoutMs,
  maxOpenAiRequestTimeoutMs,
  openAiRequestSignal,
  openAiRequestTimeoutMs
} from "../lib/openai-timeout.ts";
import {
  GenerateSiteTimeoutError,
  defaultGenerateSiteTimeoutMs,
  generateSiteTimeoutMs,
  generationTimeoutSignal,
  maxGenerateSiteTimeoutMs
} from "../lib/generation-timeout.ts";
import { JobLockLostError, executeJob } from "../lib/jobs.ts";
import { sampleGenerationInputSnapshot } from "../lib/sample-data.ts";
import {
  buildWorkerQueueStatus,
  devWorkerHeartbeatStaleMs,
  heartbeatIsFresh,
  minimumWorkerIdleMs,
  resolveWorkerIdleMs
} from "../lib/worker-runtime.ts";

assert.deepEqual(resolveWorkerIdleMs({ positional: "750", env: "5000" }), {
  idleMs: 750,
  source: "positional",
  warnings: []
});

assert.deepEqual(resolveWorkerIdleMs({ env: "1250" }), {
  idleMs: 1250,
  source: "env",
  warnings: []
});

assert.deepEqual(resolveWorkerIdleMs(), {
  idleMs: 5000,
  source: "default",
  warnings: []
});

const invalidPositional = resolveWorkerIdleMs({ positional: "abc", env: "900" });
assert.equal(invalidPositional.idleMs, 900);
assert.equal(invalidPositional.source, "env");
assert.equal(invalidPositional.warnings.length, 1);

const invalidEnv = resolveWorkerIdleMs({ env: "-1" });
assert.equal(invalidEnv.idleMs, 5000);
assert.equal(invalidEnv.source, "default");
assert.equal(invalidEnv.warnings.length, 1);

const clamped = resolveWorkerIdleMs({ positional: "100", env: "1000" });
assert.equal(clamped.idleMs, minimumWorkerIdleMs);
assert.equal(clamped.source, "positional");
assert.equal(clamped.warnings.length, 1);

withEnv("OPENAI_REQUEST_TIMEOUT_MS", undefined, () => {
  assert.equal(openAiRequestTimeoutMs(), defaultOpenAiRequestTimeoutMs);
  assert.equal(openAiRequestTimeoutMs(90_000), 90_000);
});

withEnv("OPENAI_REQUEST_TIMEOUT_MS", String(maxOpenAiRequestTimeoutMs), () => {
  assert.equal(openAiRequestTimeoutMs(), maxOpenAiRequestTimeoutMs);
});

withEnv("OPENAI_REQUEST_TIMEOUT_MS", String(maxOpenAiRequestTimeoutMs + 1), () => {
  assert.equal(openAiRequestTimeoutMs(), defaultOpenAiRequestTimeoutMs);
});

withEnv("LODESTA_GENERATE_SITE_TIMEOUT_MS", undefined, () => {
  assert.equal(generateSiteTimeoutMs(), defaultGenerateSiteTimeoutMs);
});

withEnv("LODESTA_GENERATE_SITE_TIMEOUT_MS", String(maxGenerateSiteTimeoutMs), () => {
  assert.equal(generateSiteTimeoutMs(), maxGenerateSiteTimeoutMs);
});

withEnv("LODESTA_GENERATE_SITE_TIMEOUT_MS", String(maxGenerateSiteTimeoutMs + 1), () => {
  assert.equal(generateSiteTimeoutMs(), defaultGenerateSiteTimeoutMs);
});

const externalController = new AbortController();
externalController.abort(new Error("external abort"));
assert.equal(openAiRequestSignal(600_000, externalController.signal).aborted, true);

const generationDeadline = generationTimeoutSignal(1, "verify-worker-runtime");
await onceAbort(generationDeadline.signal);
assert.equal(generationDeadline.signal.reason instanceof GenerateSiteTimeoutError, true);
generationDeadline.clear();

await assert.rejects(
  () => executeJob(generationJob("prompt-only", { prompt: "Build a site without a URL" }), {
    workerId: "verify-worker",
    generateSite: async () => {
      throw new Error("Prompt-only generation must be rejected before invoking generateSite.");
    }
  }),
  /Fresh site generation requires a website URL/
);

let snapshotGenerationOptions;
await executeJob(generationJob("snapshot", {
  inputSnapshotId: sampleGenerationInputSnapshot.id,
  intendedSiteId: sampleGenerationInputSnapshot.siteId
}), {
  workerId: "verify-worker",
  getGenerationInputSnapshot: async (id) => id === sampleGenerationInputSnapshot.id ? sampleGenerationInputSnapshot : null,
  generateSite: async (options) => {
    snapshotGenerationOptions = options;
    return fakeGenerateSiteResult();
  }
});
assert.equal(snapshotGenerationOptions.mode, "snapshot");
assert.equal(snapshotGenerationOptions.inputSnapshot.id, sampleGenerationInputSnapshot.id);
assert.equal("input" in snapshotGenerationOptions, false);
assert.equal("modelFallbackPolicy" in snapshotGenerationOptions, false);

await assert.rejects(
  () =>
    executeJob(importBatchJob("lock-lost"), {
      workerId: "verify-worker",
      heartbeatJob: async () => ({ status: "lock_lost" }),
      generateSite: async () => {
        throw new Error("generateSite should not run after lock loss.");
      }
    }),
  JobLockLostError
);

const originalWarn = console.warn;
console.warn = () => undefined;
try {
  let generated = 0;
  const transientHeartbeat = await executeJob(importBatchJob("heartbeat-error"), {
    workerId: "verify-worker",
    heartbeatJob: async () => {
      throw new Error("transient heartbeat transport error");
    },
    generateSite: async () => {
      generated += 1;
      return fakeGenerateSiteResult();
    }
  });
  assert.equal(generated, 1);
  assert.equal(transientHeartbeat.created, 1);
} finally {
  console.warn = originalWarn;
}

assert.equal(childExitDecision({ name: "web", shuttingDown: false }).action, "shutdown");
assert.equal(childExitDecision({ name: "worker", shuttingDown: true }).action, "ignore");

const firstWorkerExit = childExitDecision({
  name: "worker",
  shuttingDown: false,
  workerUptimeMs: 10_000,
  consecutiveWorkerFailures: 0,
  totalWorkerRestarts: 0
});
assert.equal(firstWorkerExit.action, "restart-worker");
assert.equal(firstWorkerExit.delayMs, 500);
assert.equal(firstWorkerExit.consecutiveFailures, 1);
assert.equal(firstWorkerExit.warnCrashLoop, false);

const cappedBackoff = nextWorkerRestart({ uptimeMs: 0, consecutiveFailures: 10 });
assert.equal(cappedBackoff.delayMs, workerRestartMaxDelayMs);

const resetBackoff = nextWorkerRestart({ uptimeMs: 60_000, consecutiveFailures: 10 });
assert.equal(resetBackoff.delayMs, 500);
assert.equal(resetBackoff.consecutiveFailures, 1);
assert.equal(resetBackoff.resetByUptime, true);

assert.equal(shouldWarnWorkerCrash({ totalUnexpectedRestarts: 4 }), false);
assert.equal(shouldWarnWorkerCrash({ totalUnexpectedRestarts: 5 }), true);

const heartbeatNow = Date.parse("2026-07-03T12:00:00.000Z");
const freshHeartbeat = {
  workerId: "worker-fresh",
  pid: 123,
  host: "localhost",
  repositoryMode: "local",
  startedAt: "2026-07-03T11:59:00.000Z",
  lastSeenAt: "2026-07-03T11:59:55.000Z"
};
const staleHeartbeat = {
  ...freshHeartbeat,
  workerId: "worker-stale",
  lastSeenAt: "2026-07-03T11:59:40.000Z"
};
assert.equal(heartbeatIsFresh(freshHeartbeat, heartbeatNow, devWorkerHeartbeatStaleMs), true);
assert.equal(heartbeatIsFresh(staleHeartbeat, heartbeatNow, devWorkerHeartbeatStaleMs), false);

const queuedJob = workerStatusJob("queued", {
  id: "job-queued",
  kind: "generate_site",
  createdAt: "2026-07-03T11:59:45.000Z",
  runAfter: "2026-07-03T11:59:45.000Z"
});
const runningJob = workerStatusJob("running", {
  id: "job-running",
  kind: "generate_site",
  lockedBy: "worker-fresh",
  lockedAt: "2026-07-03T11:59:50.000Z",
  startedAt: "2026-07-03T11:59:50.000Z"
});
const idleStatus = buildWorkerQueueStatus({
  jobs: [queuedJob],
  heartbeats: [freshHeartbeat, staleHeartbeat],
  now: heartbeatNow,
  staleAfterMs: devWorkerHeartbeatStaleMs,
  repositoryMode: "local"
});
assert.equal(idleStatus.activeWorkerCount, 1);
assert.equal(idleStatus.staleWorkers.length, 1);
assert.equal(idleStatus.queueDepthByKindStatus.generate_site?.queued, 1);

const busyStatus = buildWorkerQueueStatus({
  jobs: [queuedJob, runningJob],
  heartbeats: [{ ...freshHeartbeat, currentJobId: "job-running", currentJobKind: "generate_site" }],
  now: heartbeatNow,
  staleAfterMs: devWorkerHeartbeatStaleMs,
  repositoryMode: "local"
});
assert.equal(busyStatus.runningJobs[0].id, "job-running");
assert.equal(busyStatus.activeWorkers[0].currentJobId, "job-running");

const devSource = readFileSync(new URL("./dev.mjs", import.meta.url), "utf8");
const runnerSource = readFileSync(new URL("../workers/runner.ts", import.meta.url), "utf8");
assert.match(devSource, /starting Next\.js at http/);
assert.match(devSource, /repository=/);
assert.match(devSource, /workerCommand="npm run dev:worker"/);
assert.match(runnerSource, /workerId=/);
assert.match(runnerSource, /heartbeat=/);

process.stdout.write(`${JSON.stringify({ ok: true, checks: "worker_runtime" }, null, 2)}\n`);

function withEnv(name, value, callback) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

function onceAbort(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
}

function importBatchJob(id) {
  const now = new Date().toISOString();
  return {
    id: `verify-${id}`,
    kind: "import_batch",
    status: "running",
    payload: { urls: ["https://example.com"] },
    attempts: 1,
    maxAttempts: 3,
    runAfter: now,
    lockedBy: "verify-worker",
    lockedAt: now,
    startedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function generationJob(id, payload) {
  const now = new Date().toISOString();
  return {
    id: `verify-generate-${id}`,
    kind: "generate_site",
    status: "running",
    payload,
    attempts: 1,
    maxAttempts: 3,
    runAfter: now,
    lockedBy: "verify-worker",
    lockedAt: now,
    startedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function fakeGenerateSiteResult() {
  return {
    runId: "run_verify",
    siteCandidateId: "sitecand_verify",
    bundle: {
      businessProfile: {
        siteId: "site_verify",
        name: "Verify Local",
        vertical: "auto_body"
      },
      siteModel: {
        slug: "verify-local",
        versions: [
          {
            id: "version_verify",
            status: "draft",
            rendererVersion: "layout-v3",
            designSchemaVersion: "design-v3",
            pageComposition: { pages: [] },
            generationQa: { schemaVersion: "canonical-generation-qa-v1", readiness: "ready" }
          }
        ]
      }
    }
  };
}

function workerStatusJob(status, overrides = {}) {
  const now = "2026-07-03T11:59:45.000Z";
  return {
    id: "job",
    kind: "generate_site",
    status,
    payload: {},
    attempts: status === "queued" ? 0 : 1,
    maxAttempts: 3,
    runAfter: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
