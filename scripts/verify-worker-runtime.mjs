import assert from "node:assert/strict";
import {
  childExitDecision,
  nextWorkerRestart,
  shouldWarnWorkerCrash,
  workerRestartMaxDelayMs
} from "./dev-supervisor.mjs";
import { minimumWorkerIdleMs, resolveWorkerIdleMs } from "../lib/worker-runtime.ts";

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

process.stdout.write(`${JSON.stringify({ ok: true, checks: "worker_runtime" }, null, 2)}\n`);
