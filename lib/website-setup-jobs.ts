import type { PublicFetchUrlValidation } from "@/lib/url-safety";
import { validateWebsiteSetupSource } from "@/lib/website-setups";
import { WebsiteCrawlError } from "@/packages/business-data";
import { platformOperationsRepository, type WebsiteSetupFailureCode } from "@/packages/platform-operations";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";

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
        failureCode: websiteSetupSourceFailureCode(source.code),
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
      ownerId: setup.ownerUserId,
      reportingTimezone: setup.reportingTimezone
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
    const failed = await platformOperationsRepository.failWebsiteSetup({
      setupId: setup.id,
      sourceRevision,
      failureCode: error instanceof WebsiteCrawlError ? error.code : "bootstrap_failed",
      failureReason: safeFailureMessage(message)
    });
    return failed ? { setupId: failed.id, status: failed.status, failureCode: failed.failureCode } : { setupId: setup.id, status: "stale" as const };
  }
}

export function websiteSetupSourceFailureCode(
  code: Extract<PublicFetchUrlValidation, { ok: false }>["code"]
): WebsiteSetupFailureCode {
  return code === "dns_unavailable" ? "crawl_temporarily_unavailable" : "source_invalid";
}

function safeFailureMessage(message: string) {
  return message.length <= 600 ? message : `${message.slice(0, 580)}…`;
}
