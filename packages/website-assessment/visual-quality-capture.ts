import { readFile } from "node:fs/promises";
import type { CrawlAssessment } from "@/lib/crawler";
import { inspectUrlRender } from "@/lib/render-inspection";
import type { RenderInspectionResult } from "@/packages/acquisition/presence-contracts";
import { createArtifactContactSheets, type BrowserGateCapture } from "@/packages/site-verification";
import type { VisualQualityScreenshot } from "./visual-quality-evaluator";
import {
  selectWebsiteHealthRoutes,
  type WebsiteHealthRouteSelection
} from "./route-selection";

export type PublicVisualQualityCapture = {
  contactSheets: Array<{
    viewport: "desktop" | "mobile";
    bytes: Buffer;
    mimeType: "image/png";
  }>;
  screenshots: VisualQualityScreenshot[];
  selectedRoutes: Array<{ route: string; url: string; purposeTags: string[] }>;
  routeSelection: WebsiteHealthRouteSelection;
  deterministicContext: Record<string, unknown>;
  hasMeaningfulImagery: boolean;
  limitations: string[];
};

export function selectVisualQualityPages(crawl: CrawlAssessment) {
  const selection = selectWebsiteHealthRoutes(crawl.pageSummaries.map((page) => ({
    route: routeFor(page.url),
    sourceUrl: page.url,
    purposeTags: page.source === "primary"
      ? [...page.purposeTags, "home"]
      : page.purposeTags,
    contentLength: page.mainText?.length ?? 0
  })));
  const byRoute = new Map(crawl.pageSummaries.map((page) => [routeFor(page.url), page]));
  return {
    selection,
    pages: selection.selected.flatMap((selected) => {
      if (!selected.route) return [];
      const page = byRoute.get(selected.route);
      return page ? [page] : [];
    })
  };
}

export async function capturePublicVisualQuality(input: {
  crawl: CrawlAssessment;
  homepageRender: RenderInspectionResult;
  assessmentId?: string;
  signal?: AbortSignal;
}): Promise<PublicVisualQualityCapture> {
  const { pages, selection } = selectVisualQualityPages(input.crawl);
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
      if (
        screenshot.viewport === "tablet"
        || !screenshot.path
        || !screenshot.frame
        || screenshot.frame === "overview"
      ) continue;
      try {
        const bytes = await readFile(screenshot.path);
        const route = routeFor(page.url);
        captures.push({
          key: screenshot.path,
          route,
          viewport: screenshot.viewport,
          stage: "settled",
          frame: screenshot.frame,
          bytes
        });
        screenshots.push({
          route,
          viewport: screenshot.viewport,
          frame: screenshot.frame,
          artifactKey: screenshot.path,
          sourceUrl: page.url
        });
      } catch {
        limitations.push(`The ${screenshot.viewport} screenshot for ${routeFor(page.url)} could not be loaded for visual review.`);
      }
    }
  }
  const contactSheets: PublicVisualQualityCapture["contactSheets"] = [];
  if (captures.length) {
    try {
      const sheets = await createArtifactContactSheets(
        captures,
        selection.selected.flatMap((item) => item.route ? [item.route] : [])
      );
      for (const sheet of sheets) {
        if (sheet.bytes.length > 20_000_000) {
          limitations.push(`The labeled ${sheet.viewport} screenshot sheet exceeded the bounded multimodal payload size.`);
          continue;
        }
        contactSheets.push({
          viewport: sheet.viewport,
          bytes: sheet.bytes,
          mimeType: "image/png"
        });
      }
    } catch (error) {
      limitations.push(`The labeled screenshot sheets could not be assembled: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const selectedRoutes = pages.map((page) => ({
    route: routeFor(page.url),
    url: page.url,
    purposeTags: page.purposeTags
  }));
  const hasMeaningfulImagery = pages.some((page) => page.imageCount > 0);
  return {
    contactSheets,
    screenshots,
    selectedRoutes,
    routeSelection: selection,
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
