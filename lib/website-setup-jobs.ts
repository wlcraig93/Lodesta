import type { PublicFetchUrlValidation } from "@/lib/url-safety";
import {
  isSiteCreationModelId,
  SITE_CREATION_API_PROVIDER
} from "@/lib/site-creation-models";
import { validateWebsiteSetupSource } from "@/lib/website-setups";
import { WebsiteCrawlError } from "@/packages/business-data";
import {
  platformOperationsRepository,
  type PlatformOperationsRepository,
  type WebsiteSetupFailureCode
} from "@/packages/platform-operations";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";

export async function processNextWebsiteSetup(workerId = `website_setup_worker_${process.pid}`) {
  const setup = await platformOperationsRepository.claimNextWebsiteSetup(workerId);
  if (!setup) return null;
  return processClaimedWebsiteSetup(setup);
}

export async function processWebsiteSetup(setupId: string, workerId = `website_setup_request_${process.pid}`) {
  const setup = await platformOperationsRepository.claimWebsiteSetup(setupId, workerId);
  if (!setup) return null;
  return processClaimedWebsiteSetup(setup);
}

async function processClaimedWebsiteSetup(
  setup: NonNullable<Awaited<ReturnType<PlatformOperationsRepository["claimWebsiteSetup"]>>>
) {
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
      reportingTimezone: setup.reportingTimezone,
      initialBuildRoute: setup.initialBuildApiProvider === SITE_CREATION_API_PROVIDER
        && setup.initialBuildModelId
        && isSiteCreationModelId(setup.initialBuildModelId)
        ? {
            apiProvider: setup.initialBuildApiProvider,
            modelId: setup.initialBuildModelId
          }
        : undefined
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

export async function processNextWebsiteSetupAndRun(
  workerId = `website_setup_request_${process.pid}`,
  dependencies: {
    processSetup?: typeof processNextWebsiteSetup;
    executeRun?: (runId: string) => Promise<unknown>;
  } = {}
) {
  const setup = await (dependencies.processSetup ?? processNextWebsiteSetup)(workerId);
  if (setup && "runId" in setup && typeof setup.runId === "string") {
    await (dependencies.executeRun ?? ((runId) => siteAuthoringWorkflow.executeRunAndFinalize(runId)))(setup.runId);
  }
  return setup;
}

export async function processWebsiteSetupAndRun(
  setupId: string,
  workerId = `website_setup_request_${process.pid}`,
  dependencies: {
    processSetup?: typeof processWebsiteSetup;
    executeRun?: (runId: string) => Promise<unknown>;
  } = {}
) {
  const setup = await (dependencies.processSetup ?? processWebsiteSetup)(setupId, workerId);
  if (setup && "runId" in setup && typeof setup.runId === "string") {
    await (dependencies.executeRun ?? ((runId) => siteAuthoringWorkflow.executeRunAndFinalize(runId)))(setup.runId);
  }
  return setup;
}

export function websiteSetupSourceFailureCode(
  code: Extract<PublicFetchUrlValidation, { ok: false }>["code"]
): WebsiteSetupFailureCode {
  return code === "dns_unavailable" ? "crawl_temporarily_unavailable" : "source_invalid";
}

function safeFailureMessage(message: string) {
  return message.length <= 600 ? message : `${message.slice(0, 580)}…`;
}
