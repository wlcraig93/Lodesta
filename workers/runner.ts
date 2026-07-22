import "../scripts/load-env";

import { setTimeout as sleep } from "node:timers/promises";
import { siteAuthoringWorkflow } from "../packages/site-platform";
import { sitePlatformRepository } from "../packages/platform-data";
import { processNextProspectReportJob } from "../lib/prospect-report-jobs";

const localRecoveryStaleAfterMs = 15 * 60_000;

let shuttingDown = false;
process.once("SIGTERM", () => { shuttingDown = true; });
process.once("SIGINT", () => { shuttingDown = true; });

async function main() {
  const command = process.argv[2] ?? "demo";
  if (command === "demo") {
    console.log(JSON.stringify({ command, workerRole: "Lodesta agentic site run worker", verticalSelection: "module_registry" }, null, 2));
    return;
  }
  if (command === "status") {
    const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
    const [queued, stale] = await Promise.all([
      sitePlatformRepository.listQueuedAgentRuns(100),
      sitePlatformRepository.listStaleRunningAgentRuns(staleBefore, 100)
    ]);
    console.log(JSON.stringify({ queued: queued.length, staleRunning: stale.length, queuedRunIds: queued.map((run) => run.id), staleRunIds: stale.map((run) => run.id) }, null, 2));
    return;
  }
  if (command === "process-once") {
    const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({ limit: 1, staleAfterMs: localRecoveryStaleAfterMs });
    const prospectReport = agentRuns.processed.length || agentRuns.recovered.length || agentRuns.reaped.length ? null : await processNextProspectReportJob();
    console.log(JSON.stringify({ agentRuns, prospectReport }, null, 2));
    return;
  }
  if (command === "process-all") {
    const limit = boundedLimit(process.argv[3]);
    const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({ limit, staleAfterMs: localRecoveryStaleAfterMs });
    const prospectReports = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await processNextProspectReportJob();
      if (!result) break;
      prospectReports.push(result);
    }
    console.log(JSON.stringify({ agentRuns, prospectReports }, null, 2));
    return;
  }
  if (command === "work") {
    const idleMs = boundedIdle(process.argv[3] ?? process.env.LODESTA_WORKER_IDLE_MS);
    const limit = boundedLimit(process.argv[4]);
    console.log(JSON.stringify({ event: "worker_started", pollMs: idleMs, batchLimit: limit }));
    while (!shuttingDown) {
      const result = await siteAuthoringWorkflow.processRecoverableRuns({ limit, staleAfterMs: localRecoveryStaleAfterMs });
      if (result.reaped.length || result.recovered.length || result.processed.length) {
        console.log(JSON.stringify({ event: "agent_runs_processed", reapedSessions: result.reaped, recovered: result.recovered, processed: result.processed.map((run) => ({ id: run.id, status: run.status })) }));
        continue;
      }
      const prospect = await processNextProspectReportJob();
      if (prospect) {
        console.log(JSON.stringify({ event: "prospect_report_processed", ...prospect }));
        continue;
      }
      await sleep(idleMs);
    }
    console.log(JSON.stringify({ event: "worker_stopped" }));
    return;
  }
  throw new Error(`Unknown worker command: ${command}`);
}

function boundedLimit(value: string | undefined) {
  const parsed = Number(value ?? 4);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 20)) : 4;
}

function boundedIdle(value: string | undefined) {
  const parsed = Number(value ?? 2_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(parsed, 60_000)) : 2_000;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
