import "../scripts/load-env";

import { setTimeout as sleep } from "node:timers/promises";
import { siteAuthoringWorkflow } from "../packages/site-platform/workflow";
import { sitePlatformRepository } from "../packages/platform-data";
import { processNextWebsiteAssessmentJob } from "../packages/website-assessment/jobs";

const localRecoveryStaleAfterMs = 5 * 60_000;
const workerId = `site-authoring-worker-${process.pid}-${Date.now().toString(36)}`;

let shuttingDown = false;
process.once("SIGTERM", () => { shuttingDown = true; });
process.once("SIGINT", () => { shuttingDown = true; });

async function main() {
  const command = process.argv[2] ?? "demo";
  if (command === "demo") {
    console.log(JSON.stringify({ command, workerRole: "Lodesta site-authoring run worker", verticalSelection: "module_registry" }, null, 2));
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
    const recovery = await siteAuthoringWorkflow.recoverSiteAuthoring({ limit: 1, staleAfterMs: localRecoveryStaleAfterMs });
    const agentRuns = await siteAuthoringWorkflow.processQueuedSiteAuthoring({ limit: 1, workerId });
    const websiteAssessment = agentRuns.processed.length || recovery.recovered.length || recovery.reaped.length
      ? null
      : await processNextWebsiteAssessmentJob();
    console.log(JSON.stringify({ recovery, agentRuns, websiteAssessment }, null, 2));
    return;
  }
  if (command === "process-all") {
    const limit = boundedLimit(process.argv[3]);
    const recovery = await siteAuthoringWorkflow.recoverSiteAuthoring({ limit, staleAfterMs: localRecoveryStaleAfterMs });
    const agentRuns = await siteAuthoringWorkflow.processQueuedSiteAuthoring({ limit, workerId });
    const websiteAssessments = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await processNextWebsiteAssessmentJob();
      if (!result) break;
      websiteAssessments.push(result);
    }
    console.log(JSON.stringify({ recovery, agentRuns, websiteAssessments }, null, 2));
    return;
  }
  if (command === "work") {
    const idleMs = boundedIdle(process.argv[3] ?? process.env.LODESTA_WORKER_IDLE_MS);
    const limit = boundedLimit(process.argv[4]);
    console.log(JSON.stringify({
      event: "worker_started",
      pollMs: idleMs,
      batchLimit: limit,
      releaseSha: process.env.LODESTA_RELEASE_GIT_SHA ?? null
    }));
    let backoffMs = idleMs;
    while (!shuttingDown) {
      try {
        const result = await siteAuthoringWorkflow.processQueuedSiteAuthoring({ limit, workerId });
        if (result.processed.length) {
          console.log(JSON.stringify({ event: "agent_runs_processed", processed: result.processed.map((run) => ({ id: run.id, status: run.status })) }));
          backoffMs = idleMs;
          continue;
        }
        const assessment = await processNextWebsiteAssessmentJob();
        if (assessment) {
          console.log(JSON.stringify({ event: "website_assessment_processed", ...assessment }));
          backoffMs = idleMs;
          continue;
        }
      } catch (error) {
        if (!isTransientExternalFailure(error)) throw error;
        console.error(JSON.stringify({
          event: "worker_cycle_transient_failure",
          message: compactErrorMessage(error)
        }));
      }
      await sleep(backoffMs);
      backoffMs = Math.min(2_000, backoffMs * 2);
    }
    console.log(JSON.stringify({ event: "worker_stopped" }));
    return;
  }
  throw new Error(`Unknown worker command: ${command}`);
}

function isTransientExternalFailure(error: unknown) {
  return /\b(?:fetch failed|connection timed out|network socket|ECONNRESET|ETIMEDOUT|502|503|504|522)\b/i.test(compactErrorMessage(error));
}

function compactErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

function boundedLimit(value: string | undefined) {
  const parsed = Number(value ?? 4);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 20)) : 4;
}

function boundedIdle(value: string | undefined) {
  const parsed = Number(value ?? 250);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(parsed, 2_000)) : 250;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
