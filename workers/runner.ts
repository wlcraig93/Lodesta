import "../scripts/load-env";

import { setTimeout as sleep } from "node:timers/promises";
import { createSiteFromInput } from "../lib/intake";
import { repository } from "../lib/repository";
import { runAudit } from "../lib/audit";

let shuttingDown = false;
process.once("SIGTERM", () => {
  shuttingDown = true;
});
process.once("SIGINT", () => {
  shuttingDown = true;
});

async function main() {
  const command = process.argv[2] ?? "demo";

  if (command === "demo") {
    const bundle = createSiteFromInput({
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
    const job = await repository.processNextJob();
    console.log(JSON.stringify({ processed: job ? 1 : 0, job }, null, 2));
    return;
  }

  if (command === "process-all") {
    const limit = Number(process.argv[3] ?? 25);
    const jobs = await repository.processAllQueuedJobs(limit);
    console.log(JSON.stringify({ processed: jobs.length, jobs }, null, 2));
    return;
  }

  if (command === "work") {
    const idleMs = Number(process.argv[3] ?? process.env.LODESTA_WORKER_IDLE_MS ?? 5000);
    const maxLoops = process.argv[4] ? Number(process.argv[4]) : undefined;
    let loops = 0;
    while (!shuttingDown && (!maxLoops || loops < maxLoops)) {
      loops += 1;
      const job = await repository.processNextJob();
      if (job) {
        console.log(JSON.stringify({ event: "job_processed", jobId: job.id, kind: job.kind, status: job.status }));
        continue;
      }
      await sleep(Math.max(250, idleMs));
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
