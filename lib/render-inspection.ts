import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { assertPublicFetchUrl } from "@/lib/url-safety";
import { generationCrawlerUserAgent } from "@/packages/business-data/robots-policy";
import type {
  RenderInspectionFinding,
  RenderInspectionResult,
  RenderInspectionTarget,
  RenderViewportMetrics,
  RenderViewportName,
  RenderScreenshotArtifact
} from "@/packages/acquisition/presence-contracts";

export type InspectUrlRenderInput = {
  url: string;
  target?: RenderInspectionTarget;
  siteId?: string;
  versionId?: string;
  siteModelHash?: string;
  qaRunId?: string;
  captureScreenshots?: boolean;
  artifactRoot?: string;
  enforcePublicUrlSafety?: boolean;
};

const viewports = [
  { name: "desktop" as const, width: 1280, height: 900 },
  { name: "tablet" as const, width: 768, height: 1024 },
  { name: "mobile" as const, width: 390, height: 844 }
];

export async function inspectUrlRender(input: InspectUrlRenderInput): Promise<RenderInspectionResult> {
  const capturedAt = new Date().toISOString();
  try {
    const requestedUrl = input.enforcePublicUrlSafety
      ? await assertPublicFetchUrl(input.url)
      : input.url;
    const requestedHostname = new URL(requestedUrl).hostname;
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const validatedOrigins = new Map<string, Promise<void>>();
    const screenshots: RenderScreenshotArtifact[] = [];
    const metricsByViewport: Partial<Record<RenderViewportName, RenderViewportMetrics>> = {};
    const findings: RenderInspectionFinding[] = [];
    let finalUrl: string | undefined;
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({
          viewport,
          userAgent: input.enforcePublicUrlSafety ? generationCrawlerUserAgent : undefined
        });
        const consoleErrors: string[] = [];
        page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
        page.on("pageerror", (error) => consoleErrors.push(error.message));
        try {
          if (input.enforcePublicUrlSafety) {
            await installPublicRequestGuard(page, requestedHostname, validatedOrigins);
          }
          const response = await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs() });
          await page.waitForTimeout(500);
          const pageUrl = input.enforcePublicUrlSafety
            ? await assertSamePublicSite(page.url(), requestedHostname)
            : page.url();
          finalUrl ??= pageUrl;
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
            const directory = join(input.artifactRoot ?? ".data/render-inspections", safeName(input.siteId ?? new URL(requestedUrl).hostname), safeName(capturedAt));
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
  const primaryActionPattern = /\b(call|contact|book|schedule|reserve|order|quote|estimate|appointment|consult|request|inquire|get started)\b/i;
  const primaryActions = actions.filter((element) => {
    const href = element instanceof HTMLAnchorElement ? element.href : "";
    const label = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("value") ?? ""}`;
    return /^(?:tel:|mailto:)/i.test(href) || primaryActionPattern.test(label);
  });
  const firstPrimaryAction = primaryActions.map((element) => ({ element, rect: element.getBoundingClientRect() })).sort((a, b) => a.rect.top - b.rect.top)[0];
  const sticky = primaryActions.find((element) => {
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
    aboveFoldCtaDetected: Boolean(firstPrimaryAction && firstPrimaryAction.rect.top < innerHeight),
    primaryHeroCtaDetected: Boolean(firstPrimaryAction),
    primaryHeroCtaAboveFold: Boolean(firstPrimaryAction && firstPrimaryAction.rect.top < innerHeight),
    siteHeaderDetected: Boolean(document.querySelector("header")),
    siteFooterDetected: Boolean(document.querySelector("footer")),
    horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
    bodyFontSizePx: Number.parseFloat(getComputedStyle(body).fontSize),
    minReadableTextFontSizePx: fontSizes.length ? Math.min(...fontSizes) : Number.parseFloat(getComputedStyle(body).fontSize),
    headingOverflowCount: headings.filter((heading) => heading.scrollWidth - heading.clientWidth > 2).length,
    headingOverflowSamples: headings.filter((heading) => heading.scrollWidth - heading.clientWidth > 2).slice(0, 5).map((heading) => heading.textContent?.trim().slice(0, 100) ?? "heading"),
    rects: {
      primaryHeroCta: firstPrimaryAction ? rectValue(firstPrimaryAction.rect) : undefined,
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
    const response = input.enforcePublicUrlSafety
      ? await fetchPublicPage(input.url)
      : await fetch(input.url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs()) });
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

async function installPublicRequestGuard(
  page: import("playwright").Page,
  sourceHostname: string,
  validatedOrigins: Map<string, Promise<void>>
) {
  await page.route("**/*", async (route) => {
    try {
      const requestUrl = route.request().url();
      const parsed = new URL(requestUrl);
      if (route.request().isNavigationRequest() && !sameSite(parsed.hostname, sourceHostname)) {
        throw new Error("Cross-site browser navigation blocked.");
      }
      let validation = validatedOrigins.get(parsed.origin);
      if (!validation) {
        validation = assertPublicFetchUrl(requestUrl).then(() => undefined);
        validatedOrigins.set(parsed.origin, validation);
      }
      await validation;
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

async function assertSamePublicSite(value: string, sourceHostname: string) {
  const validated = await assertPublicFetchUrl(value);
  if (!sameSite(new URL(validated).hostname, sourceHostname)) {
    throw new Error("Cross-site browser navigation blocked.");
  }
  return validated;
}

async function fetchPublicPage(value: string) {
  let current = await assertPublicFetchUrl(value);
  const sourceHostname = new URL(current).hostname;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": generationCrawlerUserAgent,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
      },
      signal: AbortSignal.timeout(timeoutMs())
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      if (redirects === 5) throw new Error("Render fallback exceeded the redirect limit.");
      current = await assertSamePublicSite(new URL(location, current).href, sourceHostname);
      continue;
    }
    return response;
  }
  throw new Error("Render fallback exceeded the redirect limit.");
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

function sameSite(left: string, right: string) {
  const normalize = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");
  return normalize(left) === normalize(right);
}
