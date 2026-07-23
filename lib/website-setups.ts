import { validatePublicFetchUrl } from "@/lib/url-safety";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { WebsiteSetup } from "@/packages/platform-operations";
import { normalizeBootstrapSourceUrl } from "@/packages/site-platform/source-url";

export type WebsiteSetupView = {
  setup: WebsiteSetup;
  phase: "queued" | "building" | "review_draft" | "needs_attention" | "canceled";
  site?: { id: string; slug: string };
  run?: { id: string; status: "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled"; candidateVersionId?: string; failureReason?: string };
  canRetry: boolean;
  canCancel: boolean;
  openPath?: string;
};

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
    setup.failureCode === "website_crawl_failed"
    || setup.failureCode === "bootstrap_failed"
    || setup.failureCode === "worker_interrupted"
  );
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
  else if (run?.status === "succeeded" && run.candidateVersionId) phase = "review_draft";
  else if (run?.status === "failed" || run?.status === "cancelled" || run?.status === "needs_input") phase = "needs_attention";
  else phase = "building";

  return {
    setup,
    phase,
    site: site ? { id: site.id, slug: site.slug } : undefined,
    run: run ? {
      id: run.id,
      status: run.status,
      candidateVersionId: run.candidateVersionId,
      failureReason: run.failureReason
    } : undefined,
    canRetry: isRetriableWebsiteSetupFailure(setup),
    canCancel: setup.status !== "canceled" && !site?.publishedVersionId,
    openPath: site ? `/workspace/${site.slug}` : undefined
  };
}
