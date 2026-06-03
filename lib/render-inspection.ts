import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type {
  RenderInspectionFinding,
  RenderInspectionResult,
  RenderInspectionTarget,
  RenderScreenshotArtifact,
  RenderViewportMetrics,
  RenderViewportName
} from "./models";

type BrowserViewport = {
  name: RenderViewportName;
  width: number;
  height: number;
};

type BrowserMetrics = Partial<RenderViewportMetrics> & {
  viewport?: RenderViewportMetrics["viewport"];
  finalUrl?: string;
};

type BrowserLike = {
  newPage(options: {
    viewport: { width: number; height: number };
    userAgent?: string;
  }): Promise<PageLike>;
  close(): Promise<void>;
};

type PageLike = {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  setContent(html: string, options: { waitUntil: "domcontentloaded" | "load"; timeout: number }): Promise<unknown>;
  route?(url: string | RegExp, handler: (route: RouteLike) => Promise<void> | void): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<Buffer>;
  evaluate<T>(fn: (() => T | Promise<T>) | string): Promise<T>;
  close(): Promise<void>;
};

type RouteLike = {
  request(): { url(): string };
  fulfill(options: { status: number; body: Buffer; contentType?: string; headers?: Record<string, string> }): Promise<void>;
  continue(): Promise<void>;
};

type BrowserLaunchOptions = {
  headless: boolean;
  timeout?: number;
};

type BrowserModuleLike = {
  chromium: {
    launch(options: BrowserLaunchOptions): Promise<BrowserLike>;
  };
};

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

export type InspectHtmlRenderInput = Omit<InspectUrlRenderInput, "url"> & {
  html: string;
  sourceUrl: string;
};

export type RenderInspectionRuntimeStatus = {
  packageInstalled: boolean;
  browserLaunchable: boolean;
  provider: "playwright" | "none";
  message: string;
};

const viewports: BrowserViewport[] = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 }
];

export async function inspectUrlRender(input: InspectUrlRenderInput): Promise<RenderInspectionResult> {
  const capturedAt = new Date().toISOString();
  const playwright = await loadPlaywright();

  if (!playwright) {
    return inspectWithFetchFallback(input, capturedAt, "Playwright is not installed in this runtime. Run npm run install:browsers during deployment setup.");
  }

  try {
    return await inspectWithPlaywright(input, capturedAt, playwright);
  } catch (error) {
    return inspectWithFetchFallback(
      input,
      capturedAt,
      error instanceof Error ? `Playwright render inspection failed: ${error.message}` : "Playwright render inspection failed."
    );
  }
}

export async function inspectHtmlRender(input: InspectHtmlRenderInput): Promise<RenderInspectionResult> {
  const capturedAt = new Date().toISOString();
  const playwright = await loadPlaywright();
  if (!playwright) {
    const metrics = collectHtmlMetrics(input.html, input.sourceUrl);
    return {
      target: input.target ?? "generated_site",
      siteId: input.siteId,
      versionId: input.versionId,
      siteModelHash: input.siteModelHash,
      qaRunId: input.qaRunId,
      sourceUrl: input.sourceUrl,
      finalUrl: input.sourceUrl,
      adapter: "fetch_fallback",
      capturedAt,
      screenshots: [],
      unavailableReason: "Playwright is not installed in this runtime. Run npm run install:browsers during deployment setup.",
      findings: normalizeFindings([
        {
          id: "render.browser_unavailable",
          severity: "warning",
          title: "Browser render inspection unavailable",
          evidence: "Static generated-site HTML could not be browser-inspected."
        },
        ...findingsForMetrics(metrics)
      ]),
      metrics,
      metricsByViewport: {}
    };
  }

  try {
    return await inspectHtmlWithPlaywright(input, capturedAt, playwright);
  } catch (error) {
    const metrics = collectHtmlMetrics(input.html, input.sourceUrl);
    return {
      target: input.target ?? "generated_site",
      siteId: input.siteId,
      versionId: input.versionId,
      siteModelHash: input.siteModelHash,
      qaRunId: input.qaRunId,
      sourceUrl: input.sourceUrl,
      finalUrl: input.sourceUrl,
      adapter: "fetch_fallback",
      capturedAt,
      screenshots: [],
      unavailableReason: error instanceof Error ? `Playwright render inspection failed: ${error.message}` : "Playwright render inspection failed.",
      findings: normalizeFindings([
        {
          id: "render.browser_unavailable",
          severity: "warning",
          title: "Browser render inspection unavailable",
          evidence: error instanceof Error ? error.message : "Unknown Playwright error."
        },
        ...findingsForMetrics(metrics)
      ]),
      metrics,
      metricsByViewport: {}
    };
  }
}

async function inspectWithPlaywright(
  input: InspectUrlRenderInput,
  capturedAt: string,
  playwright: BrowserModuleLike
): Promise<RenderInspectionResult> {
  const browser = await launchRenderBrowser(playwright);
  const screenshots: RenderScreenshotArtifact[] = [];
  const findings: RenderInspectionFinding[] = [];
  let finalUrl: string | undefined;
  let aggregate: BrowserMetrics = {};
  const metricsByViewport: Partial<Record<RenderViewportName, RenderViewportMetrics>> = {};
  const captureScreenshots = input.captureScreenshots ?? true;
  const artifactDir = captureScreenshots ? await createArtifactDir(input) : undefined;

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        userAgent: `LodestaRenderBot/0.1 ${viewport.name}`
      });

      try {
        await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: renderTimeoutMs() });
        await waitForImages(page);
        const metrics = await page.evaluate<BrowserMetrics>(collectBrowserMetricsScript());
        metrics.viewport = viewport;
        finalUrl ??= metrics.finalUrl;
        aggregate = mergeMetrics(aggregate, metrics);
        metricsByViewport[viewport.name] = metrics as RenderViewportMetrics;
        findings.push(...findingsForMetrics(metrics, viewport.name));

        if (captureScreenshots && artifactDir) {
          const path = join(artifactDir, `${viewport.name}.png`);
          await page.screenshot({ path, fullPage: true });
          const file = await stat(path);
          screenshots.push({
            viewport: viewport.name,
            width: viewport.width,
            height: viewport.height,
            path,
            bytes: file.size,
            capturedAt
          });
          findings.push({
            id: `screenshot.${viewport.name}.captured`,
            severity: "pass",
            title: `${capitalize(viewport.name)} screenshot captured`,
            evidence: `${file.size} bytes written to ${path}.`,
            viewport: viewport.name
          });
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

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
    findings: normalizeFindings(findings),
    metrics: aggregate,
    metricsByViewport
  };
}

async function inspectHtmlWithPlaywright(
  input: InspectHtmlRenderInput,
  capturedAt: string,
  playwright: BrowserModuleLike
): Promise<RenderInspectionResult> {
  const browser = await launchRenderBrowser(playwright);
  const screenshots: RenderScreenshotArtifact[] = [];
  const findings: RenderInspectionFinding[] = [];
  let aggregate: BrowserMetrics = {};
  const metricsByViewport: Partial<Record<RenderViewportName, RenderViewportMetrics>> = {};
  const captureScreenshots = input.captureScreenshots ?? true;
  const artifactDir = captureScreenshots ? await createArtifactDir({ ...input, url: input.sourceUrl }) : undefined;

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        userAgent: `LodestaRenderBot/0.1 ${viewport.name}`
      });

      try {
        await installPublicAssetRoute(page, input.sourceUrl);
        await page.setContent(input.html, { waitUntil: "load", timeout: renderTimeoutMs() });
        await waitForImages(page);
        const metrics = await page.evaluate<BrowserMetrics>(collectBrowserMetricsScript());
        metrics.finalUrl = input.sourceUrl;
        metrics.viewport = viewport;
        aggregate = mergeMetrics(aggregate, metrics);
        metricsByViewport[viewport.name] = metrics as RenderViewportMetrics;
        findings.push(...findingsForMetrics(metrics, viewport.name));

        if (captureScreenshots && artifactDir) {
          const path = join(artifactDir, `${viewport.name}.png`);
          await page.screenshot({ path, fullPage: true });
          const file = await stat(path);
          screenshots.push({
            viewport: viewport.name,
            width: viewport.width,
            height: viewport.height,
            path,
            bytes: file.size,
            capturedAt
          });
          findings.push({
            id: `screenshot.${viewport.name}.captured`,
            severity: "pass",
            title: `${capitalize(viewport.name)} screenshot captured`,
            evidence: `${file.size} bytes written to ${path}.`,
            viewport: viewport.name
          });
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return {
    target: input.target ?? "generated_site",
    siteId: input.siteId,
    versionId: input.versionId,
    siteModelHash: input.siteModelHash,
    qaRunId: input.qaRunId,
    sourceUrl: input.sourceUrl,
    finalUrl: input.sourceUrl,
    adapter: "playwright",
    capturedAt,
    screenshots,
    findings: normalizeFindings(findings),
    metrics: aggregate,
    metricsByViewport
  };
}

async function installPublicAssetRoute(page: PageLike, sourceUrl: string) {
  if (!page.route) return;
  const sourceOrigin = safeOrigin(sourceUrl);
  await page.route("**/*", async (route) => {
    const asset = await publicAssetForRequest(route.request().url(), sourceOrigin);
    if (!asset) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      body: asset.body,
      contentType: asset.contentType,
      headers: {
        "Cache-Control": "no-store"
      }
    });
  });
}

async function publicAssetForRequest(requestUrl: string, expectedOrigin: string | undefined) {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (expectedOrigin && parsed.origin !== expectedOrigin) return undefined;
  const pathname = decodeURIComponent(parsed.pathname);
  if (!pathname.startsWith("/generated-site-assets/")) return undefined;
  const normalizedPath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const publicRoot = join(process.cwd(), "public");
  const filePath = join(publicRoot, normalizedPath);
  if (!filePath.startsWith(publicRoot)) return undefined;
  try {
    const body = await readFile(filePath);
    return { body, contentType: contentTypeForAsset(filePath) };
  } catch {
    return undefined;
  }
}

function safeOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function contentTypeForAsset(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

async function inspectWithFetchFallback(
  input: InspectUrlRenderInput,
  capturedAt: string,
  unavailableReason: string
): Promise<RenderInspectionResult> {
  try {
    const response = await fetch(input.url, {
      redirect: "follow",
      headers: {
        "User-Agent": "LodestaRenderBot/0.1 fetch-fallback",
        Accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(10000)
    });
    const html = await response.text();
    const metrics = collectHtmlMetrics(html, response.url);
    return {
      target: input.target ?? "source_site",
      siteId: input.siteId,
      versionId: input.versionId,
      siteModelHash: input.siteModelHash,
      qaRunId: input.qaRunId,
      sourceUrl: input.url,
      finalUrl: response.url,
      adapter: "fetch_fallback",
      capturedAt,
      screenshots: [],
      unavailableReason,
      findings: normalizeFindings([
        {
          id: "render.browser_unavailable",
          severity: "warning",
          title: "Browser render inspection unavailable",
          evidence: unavailableReason
        },
        ...findingsForMetrics(metrics)
      ]),
      metrics,
      metricsByViewport: {}
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown fetch fallback error";
    return {
      target: input.target ?? "source_site",
      siteId: input.siteId,
      versionId: input.versionId,
      siteModelHash: input.siteModelHash,
      qaRunId: input.qaRunId,
      sourceUrl: input.url,
      adapter: "fetch_fallback",
      capturedAt,
      screenshots: [],
      unavailableReason,
      findings: [
        {
          id: "render.browser_unavailable",
          severity: "warning",
          title: "Browser render inspection unavailable",
          evidence: unavailableReason
        },
        {
          id: "render.fetch_failed",
          severity: "fail",
          title: "Render fallback could not fetch HTML",
          evidence: reason
        }
      ],
      metrics: {},
      metricsByViewport: {}
    };
  }
}

function collectBrowserMetricsScript() {
  return `(() => {
    const elementRect = (element) => {
      if (!element) return undefined;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    };
    const parseRgb = (value) => {
      const raw = String(value || "").trim();
      const rgbMatch = raw.match(/rgba?\\(([^)]+)\\)/i);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(",").map((part) => Number.parseFloat(part.trim()));
        if (parts.length < 3 || parts.some((part, index) => index < 3 && Number.isNaN(part))) return undefined;
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
      }
      const srgbMatch = raw.match(/color\\(srgb\\s+([^\\s)]+)\\s+([^\\s)]+)\\s+([^\\s)]+)(?:\\s*\\/\\s*([^\\s)]+))?\\)/i);
      if (srgbMatch) {
        const r = Number.parseFloat(srgbMatch[1]);
        const g = Number.parseFloat(srgbMatch[2]);
        const b = Number.parseFloat(srgbMatch[3]);
        const a = srgbMatch[4] ? Number.parseFloat(srgbMatch[4]) : 1;
        if ([r, g, b].some((part) => Number.isNaN(part))) return undefined;
        return { r: r * 255, g: g * 255, b: b * 255, a: Number.isNaN(a) ? 1 : a };
      }
      return undefined;
    };
    const relativeLuminance = (rgb) => {
      const channel = (value) => {
        const normalized = Math.max(0, Math.min(255, value)) / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    };
    const contrastRatio = (foreground, background) => {
      const fg = relativeLuminance(foreground);
      const bg = relativeLuminance(background);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    };
    const backgroundForElement = (element) => {
      if (element.closest(".site-portfolio-index-v3 article")) return { r: 8, g: 8, b: 8, a: 1 };
      if (element.closest(".site-visual-list-v3[data-presentation='portfolio_index'] article")) return { r: 12, g: 12, b: 12, a: 1 };
      if (element.closest(".site-visual-block-v3[data-tone='glass']")) return { r: 18, g: 18, b: 16, a: 1 };
      const usesV3OverlaySurface =
        element.closest(".site-hero-v3[data-variant='media_masthead']") ||
        element.closest(".site-hero-v3[data-variant='appointment_card_overlay']") ||
        element.closest(".site-visual-section-v3-bleed-media") ||
        element.closest(".site-visual-section-v3[data-color-mode='contrast']") ||
        element.closest(".site-header-v3[data-header-mode='transparent_overlay']");
      let current = element;
      while (current) {
        const background = parseRgb(getComputedStyle(current).backgroundColor);
        if (background && background.a > 0.5) {
          if (usesV3OverlaySurface && current.classList?.contains("public-site-v3")) break;
          return background;
        }
        current = current.parentElement;
      }
      if (usesV3OverlaySurface) return { r: 12, g: 11, b: 10, a: 1 };
      return parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    };
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const bodyText = document.body?.innerText?.replace(/\\s+/g, " ").trim() ?? "";
    const siteRoot = document.querySelector(".public-site") || document.body;
    const hero =
      document.querySelector(".site-visual-section-v3[data-anatomy='hero_overlay_action']") ??
      document.querySelector(".site-hero-v3") ??
      document.querySelector(".site-hero-v2") ??
      document.querySelector(".hero");
    const h1 = hero?.querySelector("h1") ?? document.querySelector("h1");
    const primaryHeroCtas = Array.from(document.querySelectorAll("[data-primary-hero-cta='true']")).filter(isVisible);
    const primaryHeroCta =
      primaryHeroCtas.find((element) => {
        const rect = elementRect(element);
        if (!rect) return false;
        const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return rect.top >= 0 && visibleHeight >= Math.min(rect.height, 44);
      }) ?? primaryHeroCtas[0];
    const stickyCta = document.querySelector(".mobile-action-bar");
    const primaryMedia =
      hero?.querySelector(".site-visual-block-v3-hero_media .site-visual-media-v3") ??
      hero?.querySelector(".site-hero-v3-media") ??
      hero?.querySelector(".site-hero-v2-media") ??
      hero?.querySelector(".hero-media");
    const primaryMediaImage = primaryMedia?.querySelector("img");
    const siteStyle = getComputedStyle(siteRoot);
    const h1Style = h1 ? getComputedStyle(h1) : undefined;
    const readableElements = Array.from(siteRoot.querySelectorAll("p, li, dt, dd, a.site-button, .site-button-v3, .site-card-v2 h3, .site-card-v2 p, .site-card-link-v2 > span:last-child"))
      .filter((element) => isVisible(element) && (element.innerText || "").trim().length > 0);
    const readableMetrics = readableElements.map((element) => {
      const style = getComputedStyle(element);
      const foreground = parseRgb(style.color);
      const background = backgroundForElement(element);
      return {
        fontSize: Number.parseFloat(style.fontSize || "0"),
        contrast: foreground && background ? contrastRatio(foreground, background) : undefined,
        sample:
          element.tagName.toLowerCase() +
          (element.className ? "." + String(element.className).replace(/\\s+/g, ".") : "") +
          " fg=" +
          style.color +
          " bg=" +
          getComputedStyle(element).backgroundColor +
          " text=" +
          (element.innerText || "").trim().slice(0, 80)
      };
    });
    const readableFontSizes = readableMetrics.map((metric) => metric.fontSize).filter((value) => Number.isFinite(value) && value > 0);
    const contrastRatios = readableMetrics.map((metric) => metric.contrast).filter((value) => Number.isFinite(value) && value > 0);
    const minContrastMetric = readableMetrics
      .filter((metric) => Number.isFinite(metric.contrast))
      .sort((left, right) => left.contrast - right.contrast)[0];
    const images = Array.from(document.images);
    const loadedImages = images.filter((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    const brokenImages = images.filter((image) => image.complete && (image.naturalWidth === 0 || image.naturalHeight === 0));
    const ctaSelectors = [
      "a[data-analytics-role]",
      "button[data-analytics-role]",
      "a[href^='tel:']",
      "a[href^='mailto:']",
      ".button",
      "button"
    ];
    const ctas = Array.from(document.querySelectorAll(ctaSelectors.join(","))).filter(
      (element) => (element.innerText || element.getAttribute("aria-label") || element.getAttribute("href") || "").trim()
    );
    const firstCtaTop = ctas[0]?.getBoundingClientRect().top;
    const primaryHeroCtaRect = elementRect(primaryHeroCta);
    const primaryHeroCtaVisibleHeight = primaryHeroCtaRect
      ? Math.max(0, Math.min(primaryHeroCtaRect.bottom, window.innerHeight) - Math.max(primaryHeroCtaRect.top, 0))
      : 0;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
      document.documentElement.clientWidth
    );
    return {
      finalUrl: window.location.href,
      viewport: { name: "desktop", width: window.innerWidth, height: window.innerHeight },
      htmlBytes: document.documentElement.outerHTML.length,
      bodyTextChars: bodyText.length,
      sectionCount: document.querySelectorAll("[data-section-id], section").length,
      ctaCount: ctas.length,
      formCount: document.forms.length,
      telLinkCount: document.querySelectorAll("a[href^='tel:']").length,
      imageCount: images.length,
      loadedImageCount: loadedImages.length,
      brokenImageCount: brokenImages.length,
      aboveFoldCtaDetected: primaryHeroCtaRect
        ? primaryHeroCtaRect.top >= 0 && primaryHeroCtaRect.top <= window.innerHeight
        : typeof firstCtaTop === "number" ? firstCtaTop >= 0 && firstCtaTop <= window.innerHeight : false,
      primaryHeroCtaDetected: Boolean(primaryHeroCta),
      primaryHeroCtaAboveFold: primaryHeroCtaRect ? primaryHeroCtaRect.top >= 0 && primaryHeroCtaVisibleHeight >= Math.min(primaryHeroCtaRect.height, 44) : false,
      primaryMediaImageLoaded: primaryMediaImage ? primaryMediaImage.complete && primaryMediaImage.naturalWidth > 0 && primaryMediaImage.naturalHeight > 0 : undefined,
      siteHeaderDetected: Boolean(document.querySelector("[data-site-chrome='header']")),
      siteFooterDetected: Boolean(document.querySelector("[data-site-chrome='footer']")),
      horizontalOverflowPx: Math.max(0, documentWidth - window.innerWidth),
      bodyFontSizePx: Number.parseFloat(siteStyle.fontSize || "0") || undefined,
      minReadableTextFontSizePx: readableFontSizes.length ? Math.min(...readableFontSizes) : undefined,
      minTextContrastRatio: contrastRatios.length ? Math.min(...contrastRatios) : undefined,
      minTextContrastSample: minContrastMetric?.sample,
      headingFontFamily: h1Style?.fontFamily,
      bodyFontFamily: siteStyle.fontFamily,
      rects: {
        hero: elementRect(hero),
        h1: elementRect(h1),
        primaryHeroCta: primaryHeroCtaRect,
        stickyCta: elementRect(stickyCta),
        primaryMedia: elementRect(primaryMedia)
      }
    };
  })()`;
}

function collectHtmlMetrics(html: string, finalUrl?: string): BrowserMetrics {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const bodyText = decodeHtml(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  const firstCtaIndex = searchIndex(body, [
    "data-analytics-role",
    "href=\"tel:",
    "href='tel:",
    "class=\"button",
    "class='button",
    "<button"
  ]);

  return {
    finalUrl,
    viewport: { name: "desktop", width: 0, height: 0 },
    htmlBytes: html.length,
    bodyTextChars: bodyText.length,
    sectionCount: countMatches(html, /data-section-id=|<section\b/gi),
    ctaCount: countMatches(html, /data-analytics-role=|href=["']tel:|class=["'][^"']*\bbutton\b|<button\b/gi),
    formCount: countMatches(html, /<form\b/gi),
    telLinkCount: countMatches(html, /href=["']tel:/gi),
    imageCount: countMatches(html, /<img\b/gi),
    aboveFoldCtaDetected: firstCtaIndex >= 0 && firstCtaIndex < 6000,
    primaryHeroCtaDetected: /data-primary-hero-cta=["']true["']/.test(html),
    primaryHeroCtaAboveFold: /data-primary-hero-cta=["']true["']/.test(html) && firstCtaIndex >= 0 && firstCtaIndex < 6000,
    siteHeaderDetected: /data-site-chrome=["']header["']/.test(html),
    siteFooterDetected: /data-site-chrome=["']footer["']/.test(html)
  };
}

function findingsForMetrics(metrics: BrowserMetrics, viewport?: RenderViewportName): RenderInspectionFinding[] {
  const findings: RenderInspectionFinding[] = [];
  const suffix = viewport ? `.${viewport}` : "";
  const titleSuffix = viewport ? ` (${viewport})` : "";
  const bodyTextChars = metrics.bodyTextChars ?? 0;
  const sectionCount = metrics.sectionCount ?? 0;
  const ctaCount = metrics.ctaCount ?? 0;
  const formCount = metrics.formCount ?? 0;
  const telLinkCount = metrics.telLinkCount ?? 0;
  const imageCount = metrics.imageCount ?? 0;
  const loadedImageCount = metrics.loadedImageCount;
  const brokenImageCount = metrics.brokenImageCount ?? 0;
  const viewportHeight = metrics.viewport?.height ?? 0;
  const h1Rect = metrics.rects?.h1;
  const heroRect = metrics.rects?.hero;
  const primaryCtaRect = metrics.rects?.primaryHeroCta;
  const stickyRect = metrics.rects?.stickyCta;
  const mediaRect = metrics.rects?.primaryMedia;

  findings.push({
    id: `render.body_text${suffix}`,
    severity: bodyTextChars >= 120 ? "pass" : "fail",
    title: `Rendered body has meaningful content${titleSuffix}`,
    evidence: `${bodyTextChars} visible text characters detected.`,
    viewport
  });
  findings.push({
    id: `render.sections${suffix}`,
    severity: sectionCount > 0 ? "pass" : "warning",
    title: `Rendered sections are detectable${titleSuffix}`,
    evidence: `${sectionCount} section markers detected.`,
    viewport
  });
  findings.push({
    id: `render.primary_cta${suffix}`,
    severity: ctaCount > 0 ? "pass" : "fail",
    title: `Conversion actions are rendered${titleSuffix}`,
    evidence: `${ctaCount} CTA-like elements detected.`,
    viewport
  });
  findings.push({
    id: `render.above_fold_cta${suffix}`,
    severity: metrics.primaryHeroCtaDetected && metrics.primaryHeroCtaAboveFold ? "pass" : "fail",
    title: `Primary hero CTA appears in the first viewport${titleSuffix}`,
    evidence: metrics.primaryHeroCtaDetected
      ? metrics.primaryHeroCtaAboveFold
        ? "The marked primary hero CTA is meaningfully visible in the first viewport."
        : "The marked primary hero CTA is not meaningfully visible in the first viewport."
      : "No marked primary hero CTA was detected.",
    viewport
  });
  if (h1Rect && heroRect) {
    findings.push({
      id: `render.hero_h1_fit${suffix}`,
      severity: h1Rect.height <= viewportHeight * 0.45 && h1Rect.width <= heroRect.width ? "pass" : "fail",
      title: `Hero headline fits the first viewport${titleSuffix}`,
      evidence: `H1 rect ${Math.round(h1Rect.width)}x${Math.round(h1Rect.height)} in ${Math.round(heroRect.width)}px hero width.`,
      viewport
    });
  }
  if (typeof metrics.horizontalOverflowPx === "number") {
    findings.push({
      id: `render.horizontal_overflow${suffix}`,
      severity: metrics.horizontalOverflowPx <= 2 ? "pass" : "fail",
      title: `No horizontal overflow${titleSuffix}`,
      evidence: `${Math.round(metrics.horizontalOverflowPx)}px horizontal overflow detected.`,
      viewport
    });
  }
  if (typeof metrics.bodyFontSizePx === "number") {
    findings.push({
      id: `render.body_font_size${suffix}`,
      severity: metrics.bodyFontSizePx >= 16 ? "pass" : "fail",
      title: `Base body text is readable${titleSuffix}`,
      evidence: `Computed body font size is ${metrics.bodyFontSizePx.toFixed(1)}px.`,
      viewport
    });
  }
  if (typeof metrics.minReadableTextFontSizePx === "number") {
    findings.push({
      id: `render.readable_text_size${suffix}`,
      severity: metrics.minReadableTextFontSizePx >= 14 ? "pass" : "fail",
      title: `Readable text is not undersized${titleSuffix}`,
      evidence: `Smallest sampled readable text is ${metrics.minReadableTextFontSizePx.toFixed(1)}px.`,
      viewport
    });
  }
  if (typeof metrics.minTextContrastRatio === "number") {
    findings.push({
      id: `render.text_contrast${suffix}`,
      severity: metrics.minTextContrastRatio >= 4.5 ? "pass" : "fail",
      title: `Sampled text contrast meets AA minimum${titleSuffix}`,
      evidence: `Lowest sampled text contrast ratio is ${metrics.minTextContrastRatio.toFixed(2)}:1.`,
      viewport
    });
  }
  if (typeof loadedImageCount === "number" && imageCount > 0) {
    findings.push({
      id: `render.images_loaded${suffix}`,
      severity: brokenImageCount === 0 && loadedImageCount === imageCount ? "pass" : "fail",
      title: `Images load successfully${titleSuffix}`,
      evidence: `${loadedImageCount}/${imageCount} images loaded; ${brokenImageCount} broken images detected.`,
      viewport
    });
  }
  if (typeof metrics.primaryMediaImageLoaded === "boolean") {
    findings.push({
      id: `render.primary_media_image${suffix}`,
      severity: metrics.primaryMediaImageLoaded ? "pass" : "fail",
      title: `Primary media image loads${titleSuffix}`,
      evidence: metrics.primaryMediaImageLoaded ? "Primary hero media image loaded." : "Primary hero media image did not load.",
      viewport
    });
  }
  if (stickyRect && mediaRect && stickyRect.width > 0 && stickyRect.height > 0) {
    findings.push({
      id: `render.sticky_cta_overlap${suffix}`,
      severity: rectsOverlap(stickyRect, mediaRect) ? "fail" : "pass",
      title: `Sticky CTA does not overlap primary media${titleSuffix}`,
      evidence: rectsOverlap(stickyRect, mediaRect)
        ? "Sticky CTA intersects the primary media rectangle."
        : "Sticky CTA does not intersect primary media.",
      viewport
    });
  }
  findings.push({
    id: `render.form${suffix}`,
    severity: formCount > 0 ? "pass" : "warning",
    title: `Lead form is rendered${titleSuffix}`,
    evidence: `${formCount} form elements detected.`,
    viewport
  });
  findings.push({
    id: `render.tel_link${suffix}`,
    severity: telLinkCount > 0 ? "pass" : "warning",
    title: `Click-to-call path is rendered${titleSuffix}`,
    evidence: `${telLinkCount} tel: links detected.`,
    viewport
  });

  return findings;
}

async function loadPlaywright(): Promise<BrowserModuleLike | null> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<unknown>;
    const module = await dynamicImport("playwright");
    return isBrowserModuleLike(module) ? module : null;
  } catch {
    return null;
  }
}

export async function getRenderInspectionRuntimeStatus(options: { launch?: boolean } = {}): Promise<RenderInspectionRuntimeStatus> {
  const playwright = await loadPlaywright();
  if (!playwright) {
    return {
      packageInstalled: false,
      browserLaunchable: false,
      provider: "none",
      message: "Playwright package is not installed."
    };
  }

  if (!options.launch) {
    return {
      packageInstalled: true,
      browserLaunchable: false,
      provider: "playwright",
      message: "Playwright package is installed; launch was not checked."
    };
  }

  try {
    const browser = await launchRenderBrowser(playwright);
    await browser.close();
    return {
      packageInstalled: true,
      browserLaunchable: true,
      provider: "playwright",
      message: "Chromium launched successfully for render inspection."
    };
  } catch (error) {
    return {
      packageInstalled: true,
      browserLaunchable: false,
      provider: "playwright",
      message: error instanceof Error ? error.message : "Chromium launch failed."
    };
  }
}

async function launchRenderBrowser(playwright: BrowserModuleLike) {
  return playwright.chromium.launch(browserLaunchOptions());
}

function browserLaunchOptions(): BrowserLaunchOptions {
  return {
    headless: true,
    timeout: renderTimeoutMs()
  };
}

function renderTimeoutMs() {
  return 15000;
}

async function createArtifactDir(input: InspectUrlRenderInput) {
  const parsed = new URL(input.url);
  const host = (parsed.hostname || parsed.protocol.replace(/:$/, "") || "render").replace(/[^a-z0-9.-]+/gi, "-");
  const runId = `${host}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const artifactRoot = input.artifactRoot ?? join(process.cwd(), ".data", "render-inspections");
  const artifactDir = join(artifactRoot, runId);
  await mkdir(artifactDir, { recursive: true });
  return artifactDir;
}

function mergeMetrics(left: BrowserMetrics, right: BrowserMetrics): BrowserMetrics {
  return {
    finalUrl: left.finalUrl ?? right.finalUrl,
    viewport: left.viewport ?? right.viewport,
    htmlBytes: maxDefined(left.htmlBytes, right.htmlBytes),
    bodyTextChars: maxDefined(left.bodyTextChars, right.bodyTextChars),
    sectionCount: maxDefined(left.sectionCount, right.sectionCount),
    ctaCount: maxDefined(left.ctaCount, right.ctaCount),
    formCount: maxDefined(left.formCount, right.formCount),
    telLinkCount: maxDefined(left.telLinkCount, right.telLinkCount),
    imageCount: maxDefined(left.imageCount, right.imageCount),
    loadedImageCount: maxDefined(left.loadedImageCount, right.loadedImageCount),
    brokenImageCount: maxDefined(left.brokenImageCount, right.brokenImageCount),
    aboveFoldCtaDetected: Boolean(left.aboveFoldCtaDetected || right.aboveFoldCtaDetected),
    primaryHeroCtaDetected: Boolean(left.primaryHeroCtaDetected || right.primaryHeroCtaDetected),
    primaryHeroCtaAboveFold: Boolean(left.primaryHeroCtaAboveFold || right.primaryHeroCtaAboveFold),
    primaryMediaImageLoaded: Boolean(left.primaryMediaImageLoaded || right.primaryMediaImageLoaded),
    siteHeaderDetected: Boolean(left.siteHeaderDetected || right.siteHeaderDetected),
    siteFooterDetected: Boolean(left.siteFooterDetected || right.siteFooterDetected),
    horizontalOverflowPx: maxDefined(left.horizontalOverflowPx, right.horizontalOverflowPx),
    bodyFontSizePx: minDefined(left.bodyFontSizePx, right.bodyFontSizePx),
    minReadableTextFontSizePx: minDefined(left.minReadableTextFontSizePx, right.minReadableTextFontSizePx),
    minTextContrastRatio: minDefined(left.minTextContrastRatio, right.minTextContrastRatio),
    minTextContrastSample:
      minDefined(left.minTextContrastRatio, right.minTextContrastRatio) === left.minTextContrastRatio
        ? left.minTextContrastSample
        : right.minTextContrastSample,
    headingFontFamily: left.headingFontFamily ?? right.headingFontFamily,
    bodyFontFamily: left.bodyFontFamily ?? right.bodyFontFamily
  };
}

async function waitForImages(page: PageLike) {
  await page.evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 12000;
    const images = Array.from(document.images);
    if (!images.length) {
      resolve(undefined);
      return;
    }
    const settled = new WeakSet();
    const check = () => {
      const finished = images.every((image) => image.complete || settled.has(image));
      if (finished || Date.now() >= deadline) {
        resolve(undefined);
        return;
      }
      setTimeout(check, 120);
    };
    for (const image of images) {
      if (image.complete) continue;
      const markSettled = () => {
        settled.add(image);
        check();
      };
      image.addEventListener("load", markSettled, { once: true });
      image.addEventListener("error", markSettled, { once: true });
    }
    check();
  })`).catch(() => undefined);
}

function rectFor(element?: Element | null) {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function rectsOverlap(
  left: NonNullable<RenderViewportMetrics["rects"]>["hero"],
  right: NonNullable<RenderViewportMetrics["rects"]>["hero"]
) {
  if (!left || !right) return false;
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function maxDefined(left: number | undefined, right: number | undefined) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function minDefined(left: number | undefined, right: number | undefined) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function normalizeFindings(findings: RenderInspectionFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.id}:${finding.viewport ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function searchIndex(value: string, needles: string[]) {
  const indexes = needles
    .map((needle) => value.toLowerCase().indexOf(needle.toLowerCase()))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isBrowserModuleLike(value: unknown): value is BrowserModuleLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "chromium" in value &&
      value.chromium &&
      typeof value.chromium === "object" &&
      "launch" in value.chromium &&
      typeof value.chromium.launch === "function"
  );
}
