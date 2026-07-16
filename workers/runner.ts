import "../scripts/load-env";

import { setTimeout as sleep } from "node:timers/promises";
import { createSiteV3FromInput } from "../lib/intake";
import { repository } from "../lib/repository";
import { generateSite } from "../lib/site-candidate-service";
import { setSupabaseJobGenerateSite } from "../lib/supabase/repository";
import { runAudit } from "../lib/audit";
import { getProcessWorkerId } from "../lib/worker-identity";
import {
  buildProcessWorkerHeartbeat,
  buildWorkerQueueStatus,
  defaultWorkerHeartbeatMs,
  repositoryModeFromEnv,
  resolveWorkerIdleMs,
  workerHeartbeatStaleMs
} from "../lib/worker-runtime";

let shuttingDown = false;
process.once("SIGTERM", () => {
  shuttingDown = true;
});
process.once("SIGINT", () => {
  shuttingDown = true;
});

setSupabaseJobGenerateSite((options) => generateSite({ ...options, repository }));

async function main() {
  const command = process.argv[2] ?? "demo";

  if (command === "demo") {
    const bundle = createSiteV3FromInput({
      prompt: "Build a website for Sample Local Business, a home services company focused on calls."
    });
    const findings = runAudit(bundle.businessProfile, bundle.siteModel);
    console.log(
      JSON.stringify(
        {
          command,
          siteId: bundle.businessProfile.siteId,
          slug: bundle.siteModel.slug,
          findings: findings.length,
          workerRole: "Railway job runner scaffold"
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "process-once") {
    const workerId = getProcessWorkerId();
    const heartbeat = startWorkerHeartbeat(workerId);
    const job = await repository.processNextJob();
    await heartbeat.beat();
    heartbeat.stop();
    console.log(JSON.stringify({ processed: job ? 1 : 0, job }, null, 2));
    return;
  }

  if (command === "process-all") {
    const workerId = getProcessWorkerId();
    const heartbeat = startWorkerHeartbeat(workerId);
    const limit = Number(process.argv[3] ?? 25);
    const jobs = await repository.processAllQueuedJobs(limit);
    await heartbeat.beat();
    heartbeat.stop();
    console.log(JSON.stringify({ processed: jobs.length, jobs }, null, 2));
    return;
  }

  if (command === "status") {
    const [jobs, heartbeats] = await Promise.all([repository.listJobs(), repository.listWorkerHeartbeats()]);
    console.log(
      JSON.stringify(
        buildWorkerQueueStatus({
          jobs,
          heartbeats,
          staleAfterMs: workerHeartbeatStaleMs(),
          repositoryMode: repositoryModeFromEnv()
        }),
        null,
        2
      )
    );
    return;
  }

  if (command === "requeue") {
    const jobId = process.argv[3];
    if (!jobId) throw new Error("usage: npm run worker -- requeue <jobId>");
    console.log(JSON.stringify(await repository.requeueJob(jobId), null, 2));
    return;
  }

  if (command === "work") {
    const workerId = getProcessWorkerId();
    const idleResolution = resolveWorkerIdleMs({
      positional: process.argv[3],
      env: process.env.LODESTA_WORKER_IDLE_MS
    });
    for (const warning of idleResolution.warnings) {
      console.warn(`[worker] ${warning}`);
    }
    const idleMs = idleResolution.idleMs;
    const heartbeat = startWorkerHeartbeat(workerId);
    await heartbeat.beat();
    console.log(
      `[worker] started workerId=${workerId} pid=${process.pid} repository=${repositoryModeFromEnv()} poll=${idleMs}ms heartbeat=${defaultWorkerHeartbeatMs}ms`
    );
    const maxLoops = process.argv[4] ? Number(process.argv[4]) : undefined;
    let loops = 0;
    try {
      while (!shuttingDown && (!maxLoops || loops < maxLoops)) {
        loops += 1;
        const job = await repository.processNextJob();
        await heartbeat.beat();
        if (job) {
          console.log(JSON.stringify({ event: "job_processed", jobId: job.id, kind: job.kind, status: job.status }));
          continue;
        }
        await sleep(Math.max(250, idleMs));
      }
    } finally {
      heartbeat.stop();
    }
    console.log(JSON.stringify({ event: "worker_stopped", loops }));
    return;
  }

  throw new Error(`Unknown worker command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function startWorkerHeartbeat(workerId: string) {
  let stopped = false;
  async function beat() {
    if (stopped) return;
    await repository.recordWorkerHeartbeat(buildProcessWorkerHeartbeat({ workerId }));
  }
  const interval = setInterval(() => {
    void beat().catch((error) => {
      console.warn(`[worker] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, defaultWorkerHeartbeatMs);
  interval.unref?.();
  return {
    beat,
    stop() {
      stopped = true;
      clearInterval(interval);
    }
  };
}
