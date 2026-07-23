import { validateWebsiteSetupSource } from "@/lib/website-setups";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { siteAuthoringWorkflow } from "@/packages/site-platform";

export async function processNextWebsiteSetup(workerId = `website_setup_worker_${process.pid}`) {
  const setup = await platformOperationsRepository.claimNextWebsiteSetup(workerId);
  if (!setup) return null;
  const sourceRevision = setup.sourceRevision;

  try {
    const source = await validateWebsiteSetupSource(setup.sourceUrl);
    if (!source.ok) {
      const failed = await platformOperationsRepository.failWebsiteSetup({
        setupId: setup.id,
        sourceRevision,
        failureCode: "website_crawl_failed",
        failureReason: source.error
      });
      return failed ? { setupId: failed.id, status: failed.status, failureCode: failed.failureCode } : { setupId: setup.id, status: "stale" as const };
    }

    const current = await platformOperationsRepository.getWebsiteSetup(setup.id);
    if (!current || current.status !== "processing" || current.sourceRevision !== sourceRevision) {
      return { setupId: setup.id, status: "stale" as const };
    }

    const bootstrapped = await siteAuthoringWorkflow.bootstrapFromUrl({
      url: source.url,
      ownerId: setup.ownerUserId
    });
    const linked = await platformOperationsRepository.linkWebsiteSetup({
      setupId: setup.id,
      sourceRevision,
      siteId: bootstrapped.site.id,
      sessionId: bootstrapped.session.id,
      runId: bootstrapped.run.id
    });
    return linked ? { setupId: linked.id, status: linked.status, siteId: linked.siteId, runId: linked.runId } : { setupId: setup.id, status: "stale" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCode = /crawl|fetch|redirect|dns|resolve|website|source url/i.test(message) ? "website_crawl_failed" as const : "bootstrap_failed" as const;
    const failed = await platformOperationsRepository.failWebsiteSetup({
      setupId: setup.id,
      sourceRevision,
      failureCode,
      failureReason: safeFailureMessage(message)
    });
    return failed ? { setupId: failed.id, status: failed.status, failureCode: failed.failureCode } : { setupId: setup.id, status: "stale" as const };
  }
}

function safeFailureMessage(message: string) {
  return message.length <= 600 ? message : `${message.slice(0, 580)}…`;
}
