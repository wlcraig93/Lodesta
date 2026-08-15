import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
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
import { inspectNavigationReachability } from "@/packages/site-verification/navigation-reachability";

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
  viewports?: RenderViewportName[];
  screenshotFrames?: Array<"top" | "middle" | "bottom">;
  signal?: AbortSignal;
};

const viewports = [
  { name: "desktop" as const, width: 1280, height: 900 },
  { name: "tablet" as const, width: 768, height: 1024 },
  { name: "mobile" as const, width: 390, height: 844 }
];

export async function inspectUrlRender(input: InspectUrlRenderInput): Promise<RenderInspectionResult> {
  const capturedAt = new Date().toISOString();
  try {
    input.signal?.throwIfAborted();
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
      const selectedViewports = input.viewports?.length
        ? viewports.filter((viewport) => input.viewports?.includes(viewport.name))
        : viewports;
      for (const viewport of selectedViewports) {
        input.signal?.throwIfAborted();
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
          const response = await abortable(page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs() }), input.signal);
          await settleVisualPage(page, input.signal);
          const pageUrl = input.enforcePublicUrlSafety
            ? await assertSamePublicSite(page.url(), requestedHostname)
            : page.url();
          finalUrl ??= pageUrl;
          const measured = await page.evaluate(measurePage);
          const navigation = await inspectNavigationReachability(page);
          const metrics: RenderViewportMetrics = {
            ...measured,
            viewport,
            navigationDestinationCount: navigation.destinationCount,
            navigationUnreachableCount: navigation.unreachable.length,
            navigationUnreachableSamples: navigation.unreachable,
            consoleErrorCount: consoleErrors.length,
            consoleErrorSamples: consoleErrors.slice(0, 5)
          };
          metricsByViewport[viewport.name] = metrics;
          findings.push(...findingsFor(metrics, response?.status()));
          if (input.captureScreenshots !== false) {
            const directory = join(input.artifactRoot ?? ".data/render-inspections", safeName(input.siteId ?? new URL(requestedUrl).hostname), safeName(capturedAt));
            await mkdir(directory, { recursive: true });
            const documentHeight = await page.evaluate(() => Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight
            ));
            for (const frame of input.screenshotFrames ?? ["top", "middle", "bottom"] as const) {
              input.signal?.throwIfAborted();
              const maximumScroll = Math.max(0, documentHeight - viewport.height);
              const position = frame === "top"
                ? 0
                : frame === "middle"
                  ? maximumScroll / 2
                  : maximumScroll;
              await page.evaluate((top) => scrollTo(0, top), position);
              await page.waitForTimeout(75);
              const path = join(directory, `${viewport.name}-${frame}.png`);
              const bytes = await abortable(page.screenshot({ path, fullPage: false, type: "png" }), input.signal);
              screenshots.push({
                viewport: viewport.name,
                width: viewport.width,
                height: viewport.height,
                frame,
                stage: "settled",
                path,
                bytes: bytes.length,
                contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
                capturedAt
              });
            }
            await page.evaluate(() => scrollTo(0, 0));
          }
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
    applyCrossViewportMetrics(metricsByViewport);
    const desktop = metricsByViewport.desktop ?? metricsByViewport.tablet ?? metricsByViewport.mobile!;
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

async function settleVisualPage(page: import("playwright").Page, signal?: AbortSignal) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}"
  }).catch(() => undefined);
  await abortable(page.evaluate(async () => {
    for (const image of document.images) image.loading = "eager";
    const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    for (let top = 0; top <= maximum; top += Math.max(320, Math.floor(innerHeight * 0.8))) {
      scrollTo(0, top);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    await Promise.race([
      Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 5_000))
    ]);
    scrollTo(0, 0);
  }), signal);
  await abortable(page.waitForTimeout(150), signal);
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
  const primaryHeading = headings.find((heading) => heading.tagName === "H1");
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
  const readableLines = readable.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.4;
    const estimatedLines = Math.max(1, Math.round(rect.height / lineHeight));
    return {
      element,
      characters: Math.round((element.innerText.trim().length || 0) / estimatedLines)
    };
  });
  const longLines = readableLines.filter((item) => item.characters > 90);
  const essentialTargets = actions.filter((element) =>
    element.matches("button,input[type=submit],header a[href],nav a[href]")
    || primaryActions.includes(element)
  );
  const smallTargets = essentialTargets.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44;
  });
  const hitTestFailures = essentialTargets.filter((element) => !hitTestable(element));
  const clippedElements = visible.filter((element) => {
    if (element === body || element === root) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const outsideViewport = rect.left < -2 || rect.right > innerWidth + 2;
    const internallyClipped = element.scrollWidth > element.clientWidth + 2
      && ["hidden", "clip"].includes(style.overflowX);
    return outsideViewport || internallyClipped;
  });
  const contrastSamples = readable.flatMap((element) => {
    const foreground = color(getComputedStyle(element).color);
    const background = effectiveBackground(element);
    if (!foreground || !background) return [];
    return [{ element, ratio: contrast(foreground, background) }];
  }).sort((left, right) => left.ratio - right.ratio);
  const primaryHeadingRect = primaryHeading?.getBoundingClientRect();
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
    maxReadableLineLengthChars: readableLines.length ? Math.max(...readableLines.map((item) => item.characters)) : 0,
    longReadableLineCount: longLines.length,
    longReadableLineSamples: longLines.slice(0, 5).map((item) => `${selectorFor(item.element)} (${item.characters} chars/line)`),
    minTextContrastRatio: contrastSamples[0] ? Number(contrastSamples[0].ratio.toFixed(2)) : undefined,
    minTextContrastSample: contrastSamples[0] ? selectorFor(contrastSamples[0].element) : undefined,
    clippedElementCount: clippedElements.length,
    clippedElementSamples: clippedElements.slice(0, 5).map(selectorFor),
    smallTargetCount: smallTargets.length,
    smallTargetSamples: smallTargets.slice(0, 5).map(selectorFor),
    hitTestFailureCount: hitTestFailures.length,
    hitTestFailureSamples: hitTestFailures.slice(0, 5).map(selectorFor),
    headingOverflowCount: headings.filter((heading) => heading.scrollWidth - heading.clientWidth > 2).length,
    headingOverflowSamples: headings.filter((heading) => heading.scrollWidth - heading.clientWidth > 2).slice(0, 5).map((heading) => heading.textContent?.trim().slice(0, 100) ?? "heading"),
    primaryHeadingText: primaryHeading?.innerText.trim().slice(0, 180),
    primaryActionLabel: firstPrimaryAction
      ? `${firstPrimaryAction.element.textContent ?? ""} ${firstPrimaryAction.element.getAttribute("aria-label") ?? ""}`.trim().slice(0, 180)
      : undefined,
    primaryHeadingBeforeAction: primaryHeadingRect && firstPrimaryAction
      ? primaryHeadingRect.top <= firstPrimaryAction.rect.top
      : undefined,
    rects: {
      h1: primaryHeadingRect ? rectValue(primaryHeadingRect) : undefined,
      primaryHeroCta: firstPrimaryAction ? rectValue(firstPrimaryAction.rect) : undefined,
      stickyCta: sticky ? rectValue(sticky.getBoundingClientRect()) : undefined
    }
  };

  function rectValue(rect: DOMRect) {
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }

  function hitTestable(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === element || element.contains(hit)));
  }

  function selectorFor(element: Element) {
    const id = element.getAttribute("id");
    const className = typeof element.getAttribute("class") === "string"
      ? element.getAttribute("class")!.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    return `${element.tagName.toLowerCase()}${id ? `#${id}` : className ? `.${className}` : ""}`;
  }

  function effectiveBackground(element: Element) {
    let current: Element | null = element;
    while (current) {
      const parsed = color(getComputedStyle(current).backgroundColor);
      if (parsed && parsed[3] > 0.95) return parsed;
      current = current.parentElement;
    }
    return [255, 255, 255, 1] as [number, number, number, number];
  }

  function color(value: string) {
    const values = value.match(/[\d.]+/g)?.map(Number);
    if (!values || values.length < 3) return undefined;
    return [values[0], values[1], values[2], values[3] ?? 1] as [number, number, number, number];
  }

  function contrast(
    left: [number, number, number, number],
    right: [number, number, number, number]
  ) {
    const light = Math.max(luminance(left), luminance(right));
    const dark = Math.min(luminance(left), luminance(right));
    return (light + 0.05) / (dark + 0.05);
  }

  function luminance(value: [number, number, number, number]) {
    const channels = value.slice(0, 3).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
}

function findingsFor(metrics: RenderViewportMetrics, status: number | undefined) {
  const findings: RenderInspectionFinding[] = [];
  if (status && status >= 400) findings.push(finding("render.response", "fail", `Page returned HTTP ${status}.`, metrics.viewport.name));
  if ((metrics.horizontalOverflowPx ?? 0) > 8) findings.push(finding("render.horizontal_overflow", "fail", `${metrics.horizontalOverflowPx}px horizontal overflow.`, metrics.viewport.name));
  if ((metrics.brokenImageCount ?? 0) > 0) findings.push(finding("render.broken_images", "fail", `${metrics.brokenImageCount} image(s) did not load.`, metrics.viewport.name));
  if ((metrics.minReadableTextFontSizePx ?? 16) < 14) findings.push(finding("render.small_text", "warning", `Readable text reached ${metrics.minReadableTextFontSizePx}px.`, metrics.viewport.name));
  if ((metrics.longReadableLineCount ?? 0) > 0) findings.push(finding("render.long_lines", "warning", `${metrics.longReadableLineCount} text block(s) exceeded 90 estimated characters per line.`, metrics.viewport.name));
  if ((metrics.minTextContrastRatio ?? 4.5) < 4.5) findings.push(finding("render.contrast", "warning", `Minimum measured text contrast was ${metrics.minTextContrastRatio}:1.`, metrics.viewport.name));
  if ((metrics.smallTargetCount ?? 0) > 0) findings.push(finding("render.target_size", "warning", `${metrics.smallTargetCount} essential control(s) measured below 44×44px.`, metrics.viewport.name));
  if ((metrics.clippedElementCount ?? 0) > 0 || (metrics.hitTestFailureCount ?? 0) > 0) findings.push(finding("render.clipping_overlap", "fail", `${metrics.clippedElementCount ?? 0} clipped element(s) and ${metrics.hitTestFailureCount ?? 0} obscured essential control(s) were measured.`, metrics.viewport.name));
  if ((metrics.navigationUnreachableCount ?? 0) > 0) findings.push(finding("functional.navigation_reachability", "fail", `${metrics.navigationUnreachableCount} of ${metrics.navigationDestinationCount ?? 0} primary navigation destination(s) were not hit-testable after disclosure activation.`, metrics.viewport.name));
  if ((metrics.headingOverflowCount ?? 0) > 0) findings.push(finding("render.heading_overflow", "warning", `${metrics.headingOverflowCount} heading(s) overflowed.`, metrics.viewport.name));
  if ((metrics.consoleErrorCount ?? 0) > 0) findings.push(finding("render.console", "warning", `${metrics.consoleErrorCount} browser console error(s).`, metrics.viewport.name));
  return findings;
}

function applyCrossViewportMetrics(
  metricsByViewport: Partial<Record<RenderViewportName, RenderViewportMetrics>>
) {
  const desktop = metricsByViewport.desktop;
  const mobile = metricsByViewport.mobile;
  if (!desktop || !mobile) return;
  const headingPresent = Boolean(desktop.rects?.h1) === Boolean(mobile.rects?.h1);
  const actionPresent = Boolean(desktop.rects?.primaryHeroCta) === Boolean(mobile.rects?.primaryHeroCta);
  const orderConsistent = desktop.primaryHeadingBeforeAction === mobile.primaryHeadingBeforeAction;
  for (const metrics of [desktop, mobile]) {
    metrics.crossViewportPrimaryHeadingPresent = headingPresent;
    metrics.crossViewportPrimaryActionPresent = actionPresent;
    metrics.crossViewportHierarchyOrderConsistent = orderConsistent;
  }
}

async function fetchFallback(input: InspectUrlRenderInput, capturedAt: string, reason: string): Promise<RenderInspectionResult> {
  let html = "";
  let finalUrl = input.url;
  try {
    const response = input.enforcePublicUrlSafety
      ? await fetchPublicPage(input.url, input.signal)
      : await fetch(input.url, { redirect: "follow", signal: timedSignal(input.signal) });
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

async function fetchPublicPage(value: string, signal?: AbortSignal) {
  let current = await assertPublicFetchUrl(value);
  const sourceHostname = new URL(current).hostname;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": generationCrawlerUserAgent,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
      },
      signal: timedSignal(signal)
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

function timedSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs());
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("render_inspection_aborted"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "render";
}

function sameSite(left: string, right: string) {
  const normalize = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");
  return normalize(left) === normalize(right);
}
