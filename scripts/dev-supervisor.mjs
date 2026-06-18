export const workerRestartBaseDelayMs = 500;
export const workerRestartMaxDelayMs = 10_000;
export const workerRestartResetAfterMs = 60_000;
export const workerCrashWarningThreshold = 5;

export function nextWorkerRestart(input = {}) {
  const uptimeMs = Math.max(0, input.uptimeMs ?? 0);
  const previousFailures =
    uptimeMs >= workerRestartResetAfterMs ? 0 : Math.max(0, input.consecutiveFailures ?? 0);
  const consecutiveFailures = previousFailures + 1;
  const delayMs = Math.min(
    workerRestartBaseDelayMs * 2 ** (consecutiveFailures - 1),
    workerRestartMaxDelayMs
  );

  return {
    consecutiveFailures,
    delayMs,
    resetByUptime: uptimeMs >= workerRestartResetAfterMs
  };
}

export function shouldWarnWorkerCrash(input = {}) {
  return (input.totalUnexpectedRestarts ?? 0) >= workerCrashWarningThreshold;
}

export function childExitDecision(input) {
  if (input.shuttingDown) return { action: "ignore" };

  if (input.name === "worker") {
    const restart = nextWorkerRestart({
      uptimeMs: input.workerUptimeMs,
      consecutiveFailures: input.consecutiveWorkerFailures
    });
    const totalUnexpectedRestarts = (input.totalWorkerRestarts ?? 0) + 1;
    return {
      action: "restart-worker",
      ...restart,
      totalUnexpectedRestarts,
      warnCrashLoop: shouldWarnWorkerCrash({ totalUnexpectedRestarts })
    };
  }

  return { action: "shutdown" };
}
