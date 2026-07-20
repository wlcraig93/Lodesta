import "../scripts/load-env";

import { setTimeout as sleep } from "node:timers/promises";
import { agenticSiteWorkflow } from "../packages/site-platform";
import { sitePlatformRepository } from "../packages/platform-data";
import { platformOperationsRepository } from "../packages/platform-operations";
import { runProspectPresenceReport } from "../lib/prospect-reports";

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
    const agentRuns = await agenticSiteWorkflow.processRecoverableRuns({ limit: 1 });
    const prospectReport = agentRuns.processed.length || agentRuns.recovered.length || agentRuns.reaped.length ? null : await processProspectReportJob();
    console.log(JSON.stringify({ agentRuns, prospectReport }, null, 2));
    return;
  }
  if (command === "process-all") {
    const limit = boundedLimit(process.argv[3]);
    const agentRuns = await agenticSiteWorkflow.processRecoverableRuns({ limit });
    const prospectReports = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await processProspectReportJob();
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
      const result = await agenticSiteWorkflow.processRecoverableRuns({ limit });
      if (result.reaped.length || result.recovered.length || result.processed.length) {
        console.log(JSON.stringify({ event: "agent_runs_processed", reapedSessions: result.reaped, recovered: result.recovered, processed: result.processed.map((run) => ({ id: run.id, status: run.status })) }));
        continue;
      }
      const prospect = await processProspectReportJob();
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

async function processProspectReportJob() {
  const workerId = `site-worker-${process.pid}`;
  const job = await platformOperationsRepository.claimNextProspectReportJob(workerId);
  if (!job) return null;
  try {
    const report = await platformOperationsRepository.getProspectReport(job.reportId);
    if (!report) throw new Error("Prospect report record not found.");
    await platformOperationsRepository.updateProspectReport({ reportId: report.id, status: "running", jobId: job.id });
    const result = await runProspectPresenceReport(report);
    await platformOperationsRepository.updateProspectReport({ reportId: report.id, status: "completed", result, completedAt: new Date().toISOString() });
    await platformOperationsRepository.completeProspectReportJob(job.id);
    return { jobId: job.id, reportId: report.id, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await platformOperationsRepository.updateProspectReport({ reportId: job.reportId, status: job.attempts < job.maxAttempts ? "queued" : "failed", errorCode: message.slice(0, 160) });
    await platformOperationsRepository.failProspectReportJob(job.id, message);
    return { jobId: job.id, reportId: job.reportId, status: job.attempts < job.maxAttempts ? "queued" : "failed", error: message };
  }
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
