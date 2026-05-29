import "../scripts/load-env";

import { createSiteFromInput } from "../lib/intake";
import { repository } from "../lib/repository";
import { runAudit } from "../lib/audit";

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

  throw new Error(`Unknown worker command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
