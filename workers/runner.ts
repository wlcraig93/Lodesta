import "../scripts/load-env";

import { setTimeout as sleep } from "node:timers/promises";
import { siteAuthoringWorkflow } from "../packages/site-platform";
import { sitePlatformRepository } from "../packages/platform-data";
import { processNextWebsiteAssessmentJob } from "../packages/website-assessment/jobs";
import { processNextWebsiteSetup } from "../lib/website-setup-jobs";
import {
  expireExternalAuthoringExecutionDeadlines,
  processNextAuthoringOutbox,
  processNextExternalPreparation
} from "../packages/external-authoring";

const localRecoveryStaleAfterMs = 15 * 60_000;

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
    const expiredExternalExecutions = await expireExternalAuthoringExecutionDeadlines();
    const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({ limit: 1, staleAfterMs: localRecoveryStaleAfterMs });
    const websiteSetup = agentRuns.processed.length || agentRuns.recovered.length || agentRuns.reaped.length ? null : await processNextWebsiteSetup();
    const externalPreparation = websiteSetup ? null : await processNextExternalPreparation();
    const authoringOutbox = externalPreparation ? null : await processNextAuthoringOutbox();
    const websiteAssessment = authoringOutbox ? null : await processNextWebsiteAssessmentJob();
    console.log(JSON.stringify({ expiredExternalExecutions, agentRuns, websiteSetup, externalPreparation, authoringOutbox, websiteAssessment }, null, 2));
    return;
  }
  if (command === "process-all") {
    const limit = boundedLimit(process.argv[3]);
    const expiredExternalExecutions = await expireExternalAuthoringExecutionDeadlines();
    const agentRuns = await siteAuthoringWorkflow.processRecoverableRuns({ limit, staleAfterMs: localRecoveryStaleAfterMs });
    const websiteSetups = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await processNextWebsiteSetup();
      if (!result) break;
      websiteSetups.push(result);
    }
    const websiteAssessments = [];
    const externalPreparations = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await processNextExternalPreparation();
      if (!result) break;
      externalPreparations.push(result);
    }
    const authoringOutbox = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await processNextAuthoringOutbox();
      if (!result) break;
      authoringOutbox.push(result);
    }
    for (let index = 0; index < limit; index += 1) {
      const result = await processNextWebsiteAssessmentJob();
      if (!result) break;
      websiteAssessments.push(result);
    }
    console.log(JSON.stringify({ expiredExternalExecutions, agentRuns, websiteSetups, externalPreparations, authoringOutbox, websiteAssessments }, null, 2));
    return;
  }
  if (command === "work") {
    const idleMs = boundedIdle(process.argv[3] ?? process.env.LODESTA_WORKER_IDLE_MS);
    const limit = boundedLimit(process.argv[4]);
    console.log(JSON.stringify({ event: "worker_started", pollMs: idleMs, batchLimit: limit }));
    while (!shuttingDown) {
      const expiredExternalExecutions = await expireExternalAuthoringExecutionDeadlines();
      if (expiredExternalExecutions.length) {
        console.log(JSON.stringify({ event: "external_execution_deadlines_expired", executionIds: expiredExternalExecutions }));
      }
      const result = await siteAuthoringWorkflow.processRecoverableRuns({ limit, staleAfterMs: localRecoveryStaleAfterMs });
      if (result.reaped.length || result.recovered.length || result.processed.length) {
        console.log(JSON.stringify({ event: "agent_runs_processed", reapedSessions: result.reaped, recovered: result.recovered, processed: result.processed.map((run) => ({ id: run.id, status: run.status })) }));
        continue;
      }
      const setup = await processNextWebsiteSetup();
      if (setup) {
        console.log(JSON.stringify({ event: "website_setup_processed", ...setup }));
        continue;
      }
      const preparation = await processNextExternalPreparation();
      if (preparation) {
        console.log(JSON.stringify({ event: "external_preparation_processed", ...preparation }));
        continue;
      }
      const outbox = await processNextAuthoringOutbox();
      if (outbox) {
        console.log(JSON.stringify({ event: "authoring_outbox_processed", ...outbox }));
        continue;
      }
      const assessment = await processNextWebsiteAssessmentJob();
      if (assessment) {
        console.log(JSON.stringify({ event: "website_assessment_processed", ...assessment }));
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
