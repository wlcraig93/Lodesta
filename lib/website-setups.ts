import { cache } from "react";
import { validatePublicFetchUrl } from "@/lib/url-safety";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository, type WebsiteSetup, type WebsiteSetupFailureCode } from "@/packages/platform-operations";
import { normalizeBootstrapSourceUrl } from "@/packages/site-platform/source-url";

export type WebsiteSetupView = {
  setup: Omit<WebsiteSetup, "failureReason">;
  phase: "queued" | "building" | "needs_attention" | "canceled";
  site?: { id: string; slug: string };
  run?: { id: string; status: "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled"; candidateVersionId?: string };
  canRetry: boolean;
  canCancel: boolean;
  message?: string;
  openPath?: string;
};

export const getWebsiteSetupRecord = cache((setupId: string) => platformOperationsRepository.getWebsiteSetup(setupId));

export async function validateWebsiteSetupSource(value: string) {
  const validated = await validatePublicFetchUrl(value, { resolveDns: true });
  if (!validated.ok) return validated;
  const url = new URL(validated.url);
  url.hash = "";
  return {
    ok: true as const,
    url: url.href,
    hostname: validated.hostname,
    normalizedSource: normalizeBootstrapSourceUrl(url.href)
  };
}

export function isRetriableWebsiteSetupFailure(setup: WebsiteSetup) {
  return setup.status === "failed" && (
    setup.failureCode === "crawl_temporarily_unavailable"
    || setup.failureCode === "bootstrap_failed"
    || setup.failureCode === "worker_interrupted"
  );
}

export function websiteSetupOwnerMessage(code?: WebsiteSetupFailureCode) {
  if (code === "source_invalid") return "This address is no longer a valid public website. Use a different URL.";
  if (code === "source_unsuitable") return "This source indicates the business or website is no longer suitable for website creation. Use a different source or update the business information.";
  if (code === "crawl_temporarily_unavailable") return "We couldn’t read this website right now. Try again.";
  if (code === "crawl_robots_disallowed") return "This website doesn’t allow automated reading. Try a different website.";
  if (code === "crawl_unsupported_content" || code === "crawl_primary_unavailable") {
    return "This address didn’t return a readable website. Try a different URL.";
  }
  return "We couldn’t finish creating this website. Try again.";
}

export async function getWebsiteSetupView(setup: WebsiteSetup): Promise<WebsiteSetupView> {
  const [site, run] = await Promise.all([
    setup.siteId ? sitePlatformRepository.getSite(setup.siteId) : undefined,
    setup.runId ? sitePlatformRepository.getAgentRun(setup.runId) : undefined
  ]);

  let phase: WebsiteSetupView["phase"];
  if (setup.status === "canceled") phase = "canceled";
  else if (setup.status === "failed") phase = "needs_attention";
  else if (setup.status === "queued" || setup.status === "processing") phase = setup.status === "queued" ? "queued" : "building";
  else phase = "building";

  const { failureReason: _failureReason, ...ownerSetup } = setup;
  return {
    setup: ownerSetup,
    phase,
    site: site ? { id: site.id, slug: site.slug } : undefined,
    run: run ? {
      id: run.id,
      status: run.status,
      candidateVersionId: run.candidateVersionId
    } : undefined,
    canRetry: isRetriableWebsiteSetupFailure(setup),
    canCancel: setup.status !== "canceled" && !site?.publishedVersionId,
    message: setup.status === "failed" ? websiteSetupOwnerMessage(setup.failureCode) : undefined,
    openPath: site ? `/workspace/${site.slug}/editor` : undefined
  };
}
