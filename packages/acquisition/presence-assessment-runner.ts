import type { CrawlAssessment } from "@/lib/crawler";
import { crawlUrl } from "@/lib/crawler";
import { assertLaunchMarket } from "@/lib/launch-market";
import type { PublicPresenceEnrichment } from "./public-presence";
import { gatherPublicPresenceSignals } from "./public-presence";
import type { RenderInspectionResult } from "./presence-contracts";
import { inspectUrlRender } from "@/lib/render-inspection";
import { assertPublicFetchUrl } from "@/lib/url-safety";

export type PresenceAssessmentPublicPresenceMode = "google_places" | "skip";

export type RunUrlPresenceAssessmentInput = {
  url: string;
  render?: boolean;
  captureScreenshots?: boolean;
  publicPresence?: PresenceAssessmentPublicPresenceMode;
};

export type UrlPresenceAssessmentRun = {
  url: string;
  crawl: CrawlAssessment;
  renderInspection?: RenderInspectionResult;
  publicPresence?: PublicPresenceEnrichment;
};

export async function runUrlPresenceAssessment(input: RunUrlPresenceAssessmentInput): Promise<UrlPresenceAssessmentRun> {
  const safeUrl = await assertPublicFetchUrl(input.url);
  assertLaunchMarket({ url: safeUrl });

  const [crawl, renderInspection] = await Promise.all([
    crawlUrl(safeUrl),
    input.render === false
      ? Promise.resolve(undefined)
      : inspectUrlRender({
          url: safeUrl,
          captureScreenshots: input.captureScreenshots
        })
  ]);
  const publicPresence =
    input.publicPresence === "skip" ? undefined : await gatherPublicPresenceSignals({ url: safeUrl, crawl });

  assertLaunchMarket({ url: safeUrl, crawl, publicPresence });

  return {
    url: safeUrl,
    crawl,
    renderInspection,
    publicPresence
  };
}
