import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  RenderInspectionFinding,
  RenderInspectionResult,
  RenderInspectionTarget,
  RenderViewportMetrics,
  RenderViewportName,
  RenderScreenshotArtifact
} from "./presence-contracts";

export type InspectUrlRenderInput = {
  url: string;
  target?: RenderInspectionTarget;
  siteId?: string;
  versionId?: string;
  siteModelHash?: string;
  qaRunId?: string;
  captureScreenshots?: boolean;
  artifactRoot?: string;
};

const viewports = [
  { name: "desktop" as const, width: 1280, height: 900 },
  { name: "tablet" as const, width: 768, height: 1024 },
  { name: "mobile" as const, width: 390, height: 844 }
];

export async function inspectUrlRender(input: InspectUrlRenderInput): Promise<RenderInspectionResult> {
  const capturedAt = new Date().toISOString();
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const screenshots: RenderScreenshotArtifact[] = [];
    const metricsByViewport: Partial<Record<RenderViewportName, RenderViewportMetrics>> = {};
    const findings: RenderInspectionFinding[] = [];
    let finalUrl: string | undefined;
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        const consoleErrors: string[] = [];
        page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
        page.on("pageerror", (error) => consoleErrors.push(error.message));
        try {
          const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: timeoutMs() });
          await page.waitForTimeout(500);
          finalUrl ??= page.url();
          const measured = await page.evaluate(measurePage);
          const metrics: RenderViewportMetrics = {
            ...measured,
            viewport,
            consoleErrorCount: consoleErrors.length,
            consoleErrorSamples: consoleErrors.slice(0, 5)
          };
          metricsByViewport[viewport.name] = metrics;
          findings.push(...findingsFor(metrics, response?.status()));
          if (input.captureScreenshots !== false) {
            const directory = join(input.artifactRoot ?? ".data/render-inspections", safeName(input.siteId ?? new URL(input.url).hostname), safeName(capturedAt));
            await mkdir(directory, { recursive: true });
            const path = join(directory, `${viewport.name}.png`);
            await page.screenshot({ path, fullPage: true, type: "png" });
            screenshots.push({ viewport: viewport.name, width: viewport.width, height: viewport.height, path, bytes: (await stat(path)).size, capturedAt });
          }
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
    const desktop = metricsByViewport.desktop ?? metricsByViewport.mobile!;
    return {
      target: input.target ?? "source_site",
      siteId: input.siteId,
      versionId: input.versionId,
      siteModelHash: input.siteModelHash,
      qaRunId: input.qaRunId,
      sourceUrl: input.url,
      finalUrl,
      adapter: "playwright",
      capturedAt,
      screenshots,
      findings: dedupe(findings),
      metrics: withoutViewport(desktop),
      metricsByViewport
    };
  } catch (error) {
    return fetchFallback(input, capturedAt, error instanceof Error ? error.message : String(error));
  }
}

function measurePage() {
  const root = document.documentElement;
  const body = document.body;
  const visible = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  });
  const readable = visible.filter((element) => element.textContent?.trim() && ["P", "LI", "DD", "DT", "LABEL", "BLOCKQUOTE"].includes(element.tagName));
  const fontSizes = readable.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
  const headings = visible.filter((element) => /^H[1-6]$/.test(element.tagName));
  const actions = visible.filter((element) => element.matches("a[href],button,input[type=submit]"));
  const firstAction = actions.map((element) => ({ element, rect: element.getBoundingClientRect() })).sort((a, b) => a.rect.top - b.rect.top)[0];
  const sticky = actions.find((element) => {
    const position = getComputedStyle(element).position;
    const rect = element.getBoundingClientRect();
    return (position === "fixed" || position === "sticky") && rect.bottom >= innerHeight - 24;
  });
  const images = [...document.images];
  return {
    htmlBytes: new Blob([document.documentElement.outerHTML]).size,
    title: document.title,
    bodyTextChars: body.innerText.trim().length,
    sectionCount: document.querySelectorAll("main section,main article").length,
    ctaCount: actions.length,
    formCount: document.forms.length,
    telLinkCount: document.querySelectorAll('a[href^="tel:"]').length,
    imageCount: images.length,
    loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
    brokenImageCount: images.filter((image) => !image.complete || image.naturalWidth === 0).length,
    aboveFoldCtaDetected: Boolean(firstAction && firstAction.rect.top < innerHeight),
    siteHeaderDetected: Boolean(document.querySelector("header")),
    siteFooterDetected: Boolean(document.querySelector("footer")),
    horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
    bodyFontSizePx: Number.parseFloat(getComputedStyle(body).fontSize),
    minReadableTextFontSizePx: fontSizes.length ? Math.min(...fontSizes) : Number.parseFloat(getComputedStyle(body).fontSize),
    headingOverflowCount: headings.filter((heading) => heading.scrollWidth - heading.clientWidth > 2).length,
    headingOverflowSamples: headings.filter((heading) => heading.scrollWidth - heading.clientWidth > 2).slice(0, 5).map((heading) => heading.textContent?.trim().slice(0, 100) ?? "heading"),
    rects: {
      primaryHeroCta: firstAction ? rectValue(firstAction.rect) : undefined,
      stickyCta: sticky ? rectValue(sticky.getBoundingClientRect()) : undefined
    }
  };

  function rectValue(rect: DOMRect) {
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }
}

function findingsFor(metrics: RenderViewportMetrics, status: number | undefined) {
  const findings: RenderInspectionFinding[] = [];
  if (status && status >= 400) findings.push(finding("render.response", "fail", `Page returned HTTP ${status}.`, metrics.viewport.name));
  if ((metrics.horizontalOverflowPx ?? 0) > 8) findings.push(finding("render.horizontal_overflow", "fail", `${metrics.horizontalOverflowPx}px horizontal overflow.`, metrics.viewport.name));
  if ((metrics.brokenImageCount ?? 0) > 0) findings.push(finding("render.broken_images", "fail", `${metrics.brokenImageCount} image(s) did not load.`, metrics.viewport.name));
  if ((metrics.minReadableTextFontSizePx ?? 16) < 14) findings.push(finding("render.small_text", "warning", `Readable text reached ${metrics.minReadableTextFontSizePx}px.`, metrics.viewport.name));
  if ((metrics.headingOverflowCount ?? 0) > 0) findings.push(finding("render.heading_overflow", "warning", `${metrics.headingOverflowCount} heading(s) overflowed.`, metrics.viewport.name));
  if ((metrics.consoleErrorCount ?? 0) > 0) findings.push(finding("render.console", "warning", `${metrics.consoleErrorCount} browser console error(s).`, metrics.viewport.name));
  return findings;
}

async function fetchFallback(input: InspectUrlRenderInput, capturedAt: string, reason: string): Promise<RenderInspectionResult> {
  let html = "";
  let finalUrl = input.url;
  try {
    const response = await fetch(input.url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs()) });
    html = await response.text();
    finalUrl = response.url;
  } catch {
    // The unavailable reason below remains the authoritative fallback result.
  }
  const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    target: input.target ?? "source_site",
    siteId: input.siteId,
    versionId: input.versionId,
    siteModelHash: input.siteModelHash,
    qaRunId: input.qaRunId,
    sourceUrl: input.url,
    finalUrl,
    adapter: "fetch_fallback",
    capturedAt,
    screenshots: [],
    findings: [finding("render.browser_unavailable", "warning", `Browser inspection unavailable: ${reason}`)],
    metrics: { htmlBytes: Buffer.byteLength(html), bodyTextChars: bodyText.length, formCount: (html.match(/<form\b/gi) ?? []).length, telLinkCount: (html.match(/href=["']tel:/gi) ?? []).length },
    metricsByViewport: {},
    unavailableReason: reason
  };
}

function withoutViewport(metrics: RenderViewportMetrics): RenderInspectionResult["metrics"] {
  const { viewport: _viewport, ...rest } = metrics;
  return rest;
}

function finding(id: string, severity: "warning" | "fail", evidence: string, viewport?: RenderViewportName): RenderInspectionFinding {
  return { id, severity, title: id.replaceAll(".", " "), evidence, viewport };
}

function dedupe(values: RenderInspectionFinding[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.id}:${value.viewport ?? ""}:${value.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function timeoutMs() {
  const configured = Number(process.env.LODESTA_RENDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000 ? configured : 30_000;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "render";
}
