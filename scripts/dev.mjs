import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childExitDecision } from "./dev-supervisor.mjs";

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "4330";
const children = new Map();
let shuttingDown = false;
let shutdownExitCode = 0;
let workerStartedAt = 0;
let consecutiveWorkerFailures = 0;
let totalWorkerRestarts = 0;
let workerRestartTimer;

console.log("[dev] starting Next.js and the Lodesta job worker");

startWeb();
startWorker();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown(signal));
}

function startWeb() {
  start("web", localBin("next"), ["dev", "-p", port, "-H", host]);
}

function startWorker() {
  workerStartedAt = Date.now();
  start("worker", process.execPath, ["--import", "tsx", "workers/runner.ts", "work", "750"]);
}

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? "1"
    }
  });

  children.set(name, child);
  let handledExit = false;

  child.once("error", (error) => {
    finishChild(name, child, { error });
  });

  child.once("exit", (code, signal) => {
    finishChild(name, child, { code, signal });
  });

  function finishChild(childName, exitedChild, event) {
    if (handledExit) return;
    handledExit = true;
    if (children.get(childName) === exitedChild) children.delete(childName);

    if (shuttingDown) {
      if (children.size === 0) process.exit(shutdownExitCode);
      return;
    }

    const exitCode = typeof event.code === "number" ? event.code : event.signal || event.error ? 1 : 0;
    const suffix = event.error
      ? ` failed: ${event.error.message}`
      : event.signal
        ? ` exited from ${event.signal}`
        : ` exited with code ${exitCode}`;
    console.error(`[dev] ${childName}${suffix}`);

    const decision = childExitDecision({
      name: childName,
      shuttingDown,
      workerUptimeMs: childName === "worker" ? Date.now() - workerStartedAt : 0,
      consecutiveWorkerFailures,
      totalWorkerRestarts
    });

    if (decision.action === "restart-worker") {
      consecutiveWorkerFailures = decision.consecutiveFailures;
      totalWorkerRestarts = decision.totalUnexpectedRestarts;
      if (decision.resetByUptime) {
        console.error("[dev] worker stayed up long enough to reset restart backoff");
      }
      if (decision.warnCrashLoop) {
        console.error(`[dev] worker has crashed ${totalWorkerRestarts} times in this dev session; check the worker logs above.`);
      }
      console.error(`[dev] restarting worker in ${decision.delayMs}ms`);
      workerRestartTimer = setTimeout(() => {
        workerRestartTimer = undefined;
        if (!shuttingDown) startWorker();
      }, decision.delayMs);
      return;
    }

    shutdown("SIGTERM", exitCode);
  }
}

function localBin(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  const filePath = join(process.cwd(), "node_modules", ".bin", executable);
  if (!existsSync(filePath)) {
    console.error(`[dev] missing ${filePath}; run npm install first`);
    process.exit(1);
  }
  return filePath;
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownExitCode = exitCode;

  if (workerRestartTimer) {
    clearTimeout(workerRestartTimer);
    workerRestartTimer = undefined;
  }

  for (const child of children.values()) {
    child.kill(signal);
  }

  if (children.size === 0) {
    process.exit(exitCode);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 2500).unref();
}
