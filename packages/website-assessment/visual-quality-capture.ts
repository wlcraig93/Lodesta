import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { CrawlAssessment, CrawlPageSummary } from "@/lib/crawler";
import { inspectUrlRender } from "@/lib/render-inspection";
import type { RenderInspectionResult } from "@/packages/acquisition/presence-contracts";
import { createArtifactContactSheet, type BrowserGateCapture } from "@/packages/site-verification";
import type { VisualQualityScreenshot } from "./visual-quality-evaluator";

export type PublicVisualQualityCapture = {
  contactSheet?: Buffer;
  contactSheetMimeType: "image/png";
  screenshots: VisualQualityScreenshot[];
  selectedRoutes: Array<{ route: string; url: string; purposeTags: string[] }>;
  deterministicContext: Record<string, unknown>;
  hasMeaningfulImagery: boolean;
  limitations: string[];
};

export function selectVisualQualityPages(crawl: CrawlAssessment) {
  const pages = crawl.pageSummaries;
  const home = pages.find((page) => page.source === "primary") ?? pages[0];
  const serviceCandidates = pages
    .filter((page) => page.purposeTags.includes("service_detail") || page.purposeTags.includes("services"))
    .sort((left, right) => pageRank(right) - pageRank(left));
  const contact = pages.find((page) => page.purposeTags.includes("contact") || page.purposeTags.includes("location"));
  const about = pages.find((page) => page.purposeTags.includes("about"));
  const selected = [
    home,
    serviceCandidates[0],
    contact ?? about ?? serviceCandidates[1]
  ].filter((page): page is CrawlPageSummary => Boolean(page));
  const seen = new Set<string>();
  return selected.filter((page) => {
    const identity = canonicalRoute(page.url);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 3);
}

export async function capturePublicVisualQuality(input: {
  crawl: CrawlAssessment;
  homepageRender: RenderInspectionResult;
  assessmentId?: string;
  signal?: AbortSignal;
}): Promise<PublicVisualQualityCapture> {
  const pages = selectVisualQualityPages(input.crawl);
  const home = pages[0];
  const limitations: string[] = [];
  const renderByUrl = new Map<string, RenderInspectionResult>();
  if (home) renderByUrl.set(home.url, input.homepageRender);
  for (const page of pages.slice(1)) {
    if (input.signal?.aborted) throw input.signal.reason;
    await delay(500);
    const rendered = await inspectUrlRender({
      url: page.url,
      target: "source_site",
      captureScreenshots: true,
      siteId: input.assessmentId,
      enforcePublicUrlSafety: true,
      viewports: ["desktop", "mobile"]
    });
    renderByUrl.set(page.url, rendered);
    if (rendered.unavailableReason) {
      limitations.push(`Visual capture for ${routeFor(page.url)} was unavailable: ${rendered.unavailableReason}`);
    }
  }
  const captures: BrowserGateCapture[] = [];
  const screenshots: VisualQualityScreenshot[] = [];
  for (const page of pages) {
    const rendered = renderByUrl.get(page.url);
    if (!rendered) continue;
    for (const screenshot of rendered.screenshots) {
      if (screenshot.viewport === "tablet" || !screenshot.path) continue;
      try {
        const bytes = await readFile(screenshot.path);
        const route = routeFor(page.url);
        captures.push({
          key: screenshot.path,
          route,
          viewport: screenshot.viewport,
          bytes
        });
        screenshots.push({
          route,
          viewport: screenshot.viewport,
          artifactKey: screenshot.path,
          sourceUrl: page.url
        });
      } catch {
        limitations.push(`The ${screenshot.viewport} screenshot for ${routeFor(page.url)} could not be loaded for visual review.`);
      }
    }
  }
  let contactSheet: Buffer | undefined;
  if (captures.length) {
    try {
      const raw = await createArtifactContactSheet(captures);
      contactSheet = await sharp(raw)
        .resize({ width: 1_600, height: 4_096, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      if (contactSheet.length > 20_000_000) {
        contactSheet = undefined;
        limitations.push("The labeled screenshot set exceeded the bounded multimodal payload size.");
      }
    } catch (error) {
      limitations.push(`The labeled screenshot set could not be assembled: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const selectedRoutes = pages.map((page) => ({
    route: routeFor(page.url),
    url: page.url,
    purposeTags: page.purposeTags
  }));
  const hasMeaningfulImagery = pages.some((page) => page.imageCount > 0);
  return {
    contactSheet,
    contactSheetMimeType: "image/png",
    screenshots,
    selectedRoutes,
    hasMeaningfulImagery,
    limitations: unique(limitations),
    deterministicContext: {
      selectedRoutes,
      homepage: {
        findings: input.homepageRender.findings,
        metricsByViewport: input.homepageRender.metricsByViewport
      },
      secondaryRoutes: pages.slice(1).map((page) => {
        const rendered = renderByUrl.get(page.url);
        return {
          route: routeFor(page.url),
          findings: rendered?.findings ?? [],
          metricsByViewport: rendered?.metricsByViewport ?? {}
        };
      })
    }
  };
}

function pageRank(page: CrawlPageSummary) {
  return (page.purposeTags.includes("service_detail") ? 1_000 : 0)
    + Math.min(page.mainText?.length ?? 0, 5_000);
}

function canonicalRoute(value: string) {
  const url = new URL(value);
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${routeFor(value)}`;
}

function routeFor(value: string) {
  const pathname = new URL(value).pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
