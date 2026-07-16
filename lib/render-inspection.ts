import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type {
  RenderInspectionFinding,
  RenderInspectionResult,
  RenderInspectionTarget,
  RenderSectionInspection,
  RenderSectionScreenshotArtifact,
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
  screenshot(options: {
    path: string;
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer>;
  locator?(selector: string): {
    nth(index: number): {
      screenshot(options: { path: string; type?: "png" | "jpeg"; quality?: number }): Promise<Buffer>;
    };
  };
  evaluate<T>(fn: (() => T | Promise<T>) | string): Promise<T>;
  on?(event: "console", handler: (message: { type(): string; text(): string }) => void): void;
  close(): Promise<void>;
};

type SectionScreenshotClip = {
  sectionIndex: number;
  sectionId?: string;
  templateId?: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  captureSectionScreenshots?: boolean;
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
  const sectionScreenshots: RenderSectionScreenshotArtifact[] = [];
  const sectionInspections: RenderSectionInspection[] = [];
  const findings: RenderInspectionFinding[] = [];
  let finalUrl: string | undefined;
  let aggregate: BrowserMetrics = {};
  const metricsByViewport: Partial<Record<RenderViewportName, RenderViewportMetrics>> = {};
  const captureScreenshots = input.captureScreenshots ?? true;
  const captureSectionScreenshots = captureScreenshots && (input.captureSectionScreenshots ?? false);
  const artifactDir = captureScreenshots ? await createArtifactDir(input) : undefined;

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        userAgent: `LodestaRenderBot/0.1 ${viewport.name}`
      });
      const consoleErrors: string[] = [];
      page.on?.("console", (message) => {
        if (isActionableRenderConsoleMessage(message.type(), message.text())) {
          consoleErrors.push(message.text());
        }
      });

      try {
        await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: renderTimeoutMs() });
        await waitForImages(page);
        await waitForMapEmbeds(page);
        const metrics = await page.evaluate<BrowserMetrics>(collectBrowserMetricsScript());
        metrics.consoleErrorCount = consoleErrors.length;
        metrics.consoleErrorSamples = consoleErrors.slice(0, 5);
        metrics.viewport = viewport;
        metrics.sectionInspections = withViewportOnSectionInspections(metrics.sectionInspections, viewport.name);
        finalUrl ??= metrics.finalUrl;
        aggregate = mergeMetrics(aggregate, metrics);
        metricsByViewport[viewport.name] = metrics as RenderViewportMetrics;
        sectionInspections.push(...(metrics.sectionInspections ?? []));
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
        if (captureSectionScreenshots && artifactDir) {
          const captured = await captureSectionScreenshotArtifacts(page, artifactDir, viewport, capturedAt);
          sectionScreenshots.push(...captured);
          attachSectionScreenshotRefs(metrics.sectionInspections, captured);
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
    sectionScreenshots,
    sectionInspections,
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
  const aboveFoldScreenshots: RenderScreenshotArtifact[] = [];
  const sectionScreenshots: RenderSectionScreenshotArtifact[] = [];
  const sectionInspections: RenderSectionInspection[] = [];
  const findings: RenderInspectionFinding[] = [];
  let aggregate: BrowserMetrics = {};
  const metricsByViewport: Partial<Record<RenderViewportName, RenderViewportMetrics>> = {};
  const captureScreenshots = input.captureScreenshots ?? true;
  const captureSectionScreenshots = captureScreenshots && (input.captureSectionScreenshots ?? false);
  const artifactDir = captureScreenshots ? await createArtifactDir({ ...input, url: input.sourceUrl }) : undefined;

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        userAgent: `LodestaRenderBot/0.1 ${viewport.name}`
      });
      const consoleErrors: string[] = [];
      page.on?.("console", (message) => {
        if (isActionableRenderConsoleMessage(message.type(), message.text())) {
          consoleErrors.push(message.text());
        }
      });

      try {
        await installPublicAssetRoute(page, input.sourceUrl);
        await page.setContent(input.html, { waitUntil: "domcontentloaded", timeout: renderTimeoutMs() });
        await waitForImages(page);
        await waitForMapEmbeds(page);
        const metrics = await page.evaluate<BrowserMetrics>(collectBrowserMetricsScript());
        metrics.consoleErrorCount = consoleErrors.length;
        metrics.consoleErrorSamples = consoleErrors.slice(0, 5);
        metrics.finalUrl = input.sourceUrl;
        metrics.viewport = viewport;
        metrics.sectionInspections = withViewportOnSectionInspections(metrics.sectionInspections, viewport.name);
        aggregate = mergeMetrics(aggregate, metrics);
        metricsByViewport[viewport.name] = metrics as RenderViewportMetrics;
        sectionInspections.push(...(metrics.sectionInspections ?? []));
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
          if (viewport.name === "desktop") {
            const foldPath = join(artifactDir, `${viewport.name}-fold.jpg`);
            await page.screenshot({ path: foldPath, fullPage: false, type: "jpeg", quality: 72 });
            const foldFile = await stat(foldPath);
            aboveFoldScreenshots.push({
              viewport: viewport.name,
              width: viewport.width,
              height: viewport.height,
              path: foldPath,
              bytes: foldFile.size,
              capturedAt
            });
          }
        }
        if (captureSectionScreenshots && artifactDir) {
          const captured = await captureSectionScreenshotArtifacts(page, artifactDir, viewport, capturedAt);
          sectionScreenshots.push(...captured);
          attachSectionScreenshotRefs(metrics.sectionInspections, captured);
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
    aboveFoldScreenshots,
    sectionScreenshots,
    sectionInspections,
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
  // Asset-library media is app-served; resolve it through the same storage
  // path the public route uses so QA renders can load approved imagery.
  if (pathname.startsWith("/api/asset-library/public/")) {
    return assetLibraryBytesForRequest(pathname);
  }
  // Locally stored site assets (incl. private scraped media): QA renders are a
  // trusted local context, so serve bytes directly from storage.
  const siteAssetMatch = pathname.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/);
  if (siteAssetMatch) {
    try {
      const { readLocalAsset } = await import("./asset-storage");
      const asset = await readLocalAsset(`${decodeURIComponent(siteAssetMatch[1])}/${decodeURIComponent(siteAssetMatch[2])}`);
      if (asset) return { body: asset.bytes, contentType: asset.mimeType };
      return undefined;
    } catch {
      return undefined;
    }
  }
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

async function assetLibraryBytesForRequest(pathname: string): Promise<{ body: Buffer; contentType: string } | undefined> {
  const segments = pathname.split("/").filter(Boolean);
  const assetId = decodeURIComponent(segments[3] ?? "");
  const variant = segments[4] ?? "";
  if (!assetId || !variant) return undefined;
  try {
    const { ASSET_LIBRARY_BUCKET_NAME, assessAssetLibraryPolicy, getAssetLibraryAsset } = await import("./asset-library");
    const { getSupabaseAdminClient } = await import("./supabase/client");
    const asset = await getAssetLibraryAsset(assetId);
    if (!asset || asset.status !== "approved" || !assessAssetLibraryPolicy(asset).siteSelectable) return undefined;
    const storagePath = (asset.approvedStoragePaths as Record<string, string | undefined>)[variant];
    if (!storagePath || storagePath.startsWith("raw/")) return undefined;
    const { data } = await getSupabaseAdminClient().storage.from(ASSET_LIBRARY_BUCKET_NAME).download(storagePath);
    if (!data) return undefined;
    return { body: Buffer.from(await data.arrayBuffer()), contentType: "image/webp" };
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

const maxSectionScreenshotsPerViewport = 12;
const maxSectionScreenshotHeight = 2200;

async function captureSectionScreenshotArtifacts(
  page: PageLike,
  artifactDir: string,
  viewport: BrowserViewport,
  capturedAt: string
): Promise<RenderSectionScreenshotArtifact[]> {
  return withSectionScreenshotChromeHidden(page, async () => {
    const clips = await page.evaluate<SectionScreenshotClip[]>(sectionScreenshotClipsScript()).catch(() => []);
    const pageSize = await page
      .evaluate<{ width: number; height: number }>(`(() => ({
        width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, window.innerWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, window.innerHeight)
      }))()`)
      .catch(() => ({ width: viewport.width, height: viewport.height }));
    const artifacts: RenderSectionScreenshotArtifact[] = [];
    for (const clip of clips.slice(0, maxSectionScreenshotsPerViewport)) {
      const x = Math.max(0, Math.min(Math.floor(clip.x), Math.max(0, pageSize.width - 1)));
      const y = Math.max(0, Math.min(Math.floor(clip.y), Math.max(0, pageSize.height - 1)));
      const width = Math.min(Math.max(1, Math.ceil(clip.width)), Math.max(0, pageSize.width - x));
      const height = Math.min(maxSectionScreenshotHeight, Math.max(1, Math.ceil(clip.height)), Math.max(0, pageSize.height - y));
      if (width < 1 || height < 1) continue;
      const path = join(
        artifactDir,
        `${viewport.name}-section-${String(clip.sectionIndex + 1).padStart(2, "0")}-${safeArtifactName(clip.templateId ?? "section")}.png`
      );
      try {
        if (page.locator) {
          await page.locator(".site-visual-section-v3").nth(clip.sectionIndex).screenshot({ path });
        } else {
          await page.screenshot({
            path,
            clip: {
              x,
              y,
              width,
              height
            }
          });
        }
      } catch {
        continue;
      }
      const file = await stat(path).catch(() => undefined);
      if (!file) continue;
      artifacts.push({
        viewport: viewport.name,
        sectionIndex: clip.sectionIndex,
        sectionId: clip.sectionId,
        templateId: clip.templateId,
        label: clip.label,
        sectionTop: Math.round(clip.y),
        sectionHeight: Math.round(clip.height),
        clipped: page.locator ? false : clip.height > height,
        width,
        height: page.locator ? Math.round(clip.height) : height,
        path,
        bytes: file.size,
        capturedAt
      });
    }
    return artifacts;
  });
}

function sectionScreenshotClipsScript() {
  return `(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 80 && rect.height > 80 && style.visibility !== "hidden" && style.display !== "none";
    };
    return Array.from(document.querySelectorAll(".site-visual-section-v3"))
      .map((section, sectionIndex) => {
        const rect = section.getBoundingClientRect();
        const templateId = section.getAttribute("data-section-template") || undefined;
        const sectionId = section.getAttribute("data-section-id") || section.id || undefined;
        const label = [
          "section " + (sectionIndex + 1),
          templateId || "section",
          sectionId ? "#" + sectionId : ""
        ].filter(Boolean).join(" ");
        return {
          sectionIndex,
          sectionId,
          templateId,
          label,
          x: Math.max(0, rect.left + window.scrollX),
          y: Math.max(0, rect.top + window.scrollY),
          width: Math.max(1, Math.min(rect.width, document.documentElement.scrollWidth)),
          height: Math.max(1, rect.height)
        };
      })
      .filter((entry) => entry.width > 80 && entry.height > 80)
      .filter((entry, index) => isVisible(document.querySelectorAll(".site-visual-section-v3")[index]));
  })()`;
}

async function withSectionScreenshotChromeHidden<T>(page: PageLike, callback: () => Promise<T>): Promise<T> {
  const installed = await page
    .evaluate(`(() => {
      const id = "lodesta-section-screenshot-chrome-hide";
      let style = document.getElementById(id);
      if (!style) {
        style = document.createElement("style");
        style.id = id;
        style.textContent = [
          "html[data-render-section-screenshot='true'] [data-site-chrome='header']",
          "html[data-render-section-screenshot='true'] .site-mobile-call-bar-v3",
          "html[data-render-section-screenshot='true'] .site-sticky-cta-v3"
        ].join(",") + "{display:none!important;visibility:hidden!important;pointer-events:none!important;}";
        document.head.appendChild(style);
      }
      document.documentElement.setAttribute("data-render-section-screenshot", "true");
      return true;
    })()`)
    .catch(() => false);
  try {
    return await callback();
  } finally {
    if (installed) {
      await page.evaluate(`document.documentElement.removeAttribute("data-render-section-screenshot")`).catch(() => undefined);
    }
  }
}

function withViewportOnSectionInspections(
  inspections: RenderSectionInspection[] | undefined,
  viewport: RenderViewportName
): RenderSectionInspection[] | undefined {
  return inspections?.map((inspection) => ({
    ...inspection,
    viewport,
    findings: inspection.findings.map((finding) => ({ ...finding, viewport }))
  }));
}

function attachSectionScreenshotRefs(
  inspections: RenderSectionInspection[] | undefined,
  screenshots: RenderSectionScreenshotArtifact[]
) {
  if (!inspections?.length || !screenshots.length) return;
  for (const inspection of inspections) {
    const screenshot = screenshots.find((item) => item.sectionIndex === inspection.sectionIndex && item.viewport === inspection.viewport);
    if (!screenshot) continue;
    inspection.screenshotPath = screenshot.path;
    inspection.screenshotBytes = screenshot.bytes;
  }
}

function safeArtifactName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "section";
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
      const ownBackground = parseRgb(getComputedStyle(element).backgroundColor);
      if (ownBackground && ownBackground.a > 0.5) return ownBackground;
      const premiumShowcaseCard = element.closest(".site-visual-list-v3[data-presentation='premium_showcase'] article");
      if (premiumShowcaseCard) {
        const cardBackground = parseRgb(getComputedStyle(premiumShowcaseCard).backgroundColor);
        if (cardBackground && cardBackground.a > 0.5) return cardBackground;
        const foreground = parseRgb(getComputedStyle(element).color);
        return foreground && relativeLuminance(foreground) > 0.5 ? { r: 16, g: 17, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
      }
      const showcaseFeatureCard = element.closest(".site-visual-list-v3[data-presentation='showcase_grid'] article:first-child");
      if (showcaseFeatureCard?.querySelector("figure")) {
        const foreground = parseRgb(getComputedStyle(element).color);
        return foreground && relativeLuminance(foreground) > 0.5 ? { r: 14, g: 16, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
      }
      const factCard = element.closest(".site-visual-facts-v3 div");
      const factList = factCard?.closest(".site-visual-facts-v3");
      if (factCard && factList) {
        let factSurface = factCard;
        while (factSurface && !factSurface.classList?.contains("site-visual-section-v3")) {
          const surfaceBackground = parseRgb(getComputedStyle(factSurface).backgroundColor);
          if (surfaceBackground && surfaceBackground.a > 0.5) return surfaceBackground;
          factSurface = factSurface.parentElement;
        }
        const presentation = factList.getAttribute("data-presentation");
        if (presentation === "proof_cards" || presentation === "trust_bar" || presentation === "utility_rail" || presentation === "inline_strip") {
          const siblingIndex = factCard.parentElement ? Array.from(factCard.parentElement.children).indexOf(factCard) + 1 : 0;
          if (presentation === "proof_cards" && siblingIndex > 0 && siblingIndex % 4 === 0) return { r: 22, g: 20, b: 18, a: 1 };
          const foreground = parseRgb(getComputedStyle(element).color);
          return foreground && relativeLuminance(foreground) > 0.5 ? { r: 22, g: 20, b: 18, a: 1 } : { r: 252, g: 249, b: 243, a: 1 };
        }
      }
      const listArticle = element.closest(".site-visual-list-v3 article");
      const listParent = listArticle?.parentElement;
      const owningVisualSection = listArticle?.closest(".site-visual-section-v3");
      const firstListArticle = Boolean(listArticle && listParent?.firstElementChild === listArticle);
      if (
        firstListArticle &&
        (listParent?.getAttribute("data-presentation") === "feature_list" ||
          owningVisualSection?.getAttribute("data-card-tone") === "featured_first" ||
          owningVisualSection?.getAttribute("data-grid-pattern") === "lead_card")
      ) {
        const foreground = parseRgb(getComputedStyle(element).color);
        return foreground && relativeLuminance(foreground) > 0.5 ? { r: 34, g: 26, b: 22, a: 1 } : { r: 252, g: 249, b: 243, a: 1 };
      }
      const proofCard = element.closest(".site-visual-facts-v3[data-presentation='proof_cards'] div");
      if (proofCard?.parentElement) {
        const siblingIndex = Array.from(proofCard.parentElement.children).indexOf(proofCard) + 1;
        if (siblingIndex > 0 && siblingIndex % 4 === 0) return { r: 22, g: 20, b: 18, a: 1 };
        return { r: 252, g: 249, b: 243, a: 1 };
      }
      const featureListLeadCard = element.closest(".site-visual-list-v3[data-presentation='feature_list'] article:first-child");
      const emphasizedIntroCard = element.closest(
        ".site-visual-section-v3[data-section-template='intro_grid'][data-card-tone='featured_first'] .site-visual-list-v3 article:first-child, " +
          ".site-visual-section-v3[data-section-template='intro_grid'][data-grid-pattern='lead_card'] .site-visual-list-v3 article:first-child"
      );
      if (featureListLeadCard || emphasizedIntroCard) {
        const foreground = parseRgb(getComputedStyle(element).color);
        return foreground && relativeLuminance(foreground) > 0.5 ? { r: 34, g: 26, b: 22, a: 1 } : { r: 252, g: 249, b: 243, a: 1 };
      }
      if (element.closest(".site-portfolio-index-v3 article")) return { r: 8, g: 8, b: 8, a: 1 };
      if (element.closest(".site-visual-list-v3[data-presentation='portfolio_index'] article")) return { r: 12, g: 12, b: 12, a: 1 };
      if (element.closest(".site-header-v3[data-header-mode='utility_call_bar']")) return { r: 13, g: 92, b: 99, a: 1 };
      if (element.closest(".site-header-v3[data-header-mode='split_brand_rail']")) return { r: 23, g: 21, b: 18, a: 1 };
      const usesGlassSurface = element.closest(".site-visual-block-v3[data-tone='glass']");
      const usesV3OverlaySurface =
        element.closest(".site-hero-v3[data-variant='media_masthead']") ||
        element.closest(".site-hero-v3[data-variant='appointment_card_overlay']") ||
        element.closest(".site-visual-section-v3-bleed-media") ||
        element.closest(".site-visual-section-v3[data-background-kind='image']") ||
        element.closest(".site-visual-section-v3[data-background-kind='gradient']") ||
        element.closest(".site-header-v3[data-header-mode='transparent_overlay']") ||
        element.closest(".site-header-v3[data-header-visual-mode='transparent_overlay']") ||
        element.closest(".site-header-v3[data-header-visual-mode='glass_overlay']");
      let current = element;
      while (current) {
        const background = parseRgb(getComputedStyle(current).backgroundColor);
        if (background && background.a > 0.5) {
          if (usesV3OverlaySurface && current.classList?.contains("public-site-v3")) break;
          return background;
        }
        current = current.parentElement;
      }
      const visualSection = element.closest(".site-visual-section-v3");
      if (visualSection) {
        const sectionForeground = parseRgb(getComputedStyle(visualSection).color);
        if (sectionForeground) {
          return relativeLuminance(sectionForeground) > 0.5
            ? { r: 18, g: 16, b: 13, a: 1 }
            : { r: 255, g: 253, b: 248, a: 1 };
        }
      }
      if (usesV3OverlaySurface) return { r: 12, g: 11, b: 10, a: 1 };
      if (usesGlassSurface) return { r: 18, g: 18, b: 16, a: 1 };
      const bodyBackground = parseRgb(getComputedStyle(document.body).backgroundColor);
      return bodyBackground && bodyBackground.a > 0.5 ? bodyBackground : { r: 255, g: 255, b: 255, a: 1 };
    };
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const textLineRects = (element) => {
      if (!element) return [];
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .map((rect) => ({
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        }));
      range.detach();
      const lines = [];
      for (const rect of rects) {
        const existing = lines.find((line) => Math.abs(line.top - rect.top) < Math.max(4, rect.height * 0.35));
        if (existing) {
          existing.left = Math.min(existing.left, rect.left);
          existing.right = Math.max(existing.right, rect.right);
          existing.top = Math.min(existing.top, rect.top);
          existing.bottom = Math.max(existing.bottom, rect.bottom);
          existing.width = existing.right - existing.left;
          existing.height = existing.bottom - existing.top;
        } else {
          lines.push({ ...rect });
        }
      }
      return lines;
    };
    const isMeaningfullyInViewport = (rect) => rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    const selectorName = (element) => {
      if (!element) return "unknown";
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("data-slot-role") || element.getAttribute("data-role");
      const kind = element.getAttribute("data-slot-kind") || element.getAttribute("data-kind");
      const copyPart = element.getAttribute("data-copy-part") || element.closest("[data-copy-part]")?.getAttribute("data-copy-part");
      const itemIndex = element.getAttribute("data-item-index") || element.closest("[data-item-index]")?.getAttribute("data-item-index");
      const mediaIndex = element.getAttribute("data-media-index") || element.closest("[data-media-index]")?.getAttribute("data-media-index");
      const klass = String(element.className || "").split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
      return [
        tag,
        role ? "[slot=" + role + "]" : "",
        kind ? "[kind=" + kind + "]" : "",
        copyPart ? "[copy=" + copyPart + "]" : "",
        itemIndex ? "[item=" + itemIndex + "]" : "",
        mediaIndex ? "[media=" + mediaIndex + "]" : "",
        klass ? "." + klass : ""
      ].join("");
    };
    const numericDataAttr = (element, attr) => {
      const owner = element?.closest("[" + attr + "]") || element;
      const raw = owner?.getAttribute(attr);
      if (raw === null || typeof raw === "undefined" || raw === "") return undefined;
      const value = Number.parseInt(raw, 10);
      return Number.isFinite(value) ? value : undefined;
    };
    const provenanceForElement = (element) => {
      if (!element) return {};
      const block = element.closest(".site-visual-block-v3");
      return {
        slotRole: block?.getAttribute("data-slot-role") || block?.getAttribute("data-role") || undefined,
        slotKind: block?.getAttribute("data-slot-kind") || block?.getAttribute("data-kind") || undefined,
        copyPart: element.getAttribute("data-copy-part") || element.closest("[data-copy-part]")?.getAttribute("data-copy-part") || undefined,
        itemIndex: numericDataAttr(element, "data-item-index"),
        mediaIndex: numericDataAttr(element, "data-media-index"),
        factIndex: numericDataAttr(element, "data-fact-index"),
        actionIndex: numericDataAttr(element, "data-action-index")
      };
    };
    const intersectionArea = (left, right) => {
      const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      return width * height;
    };
    const foregroundOverlapSamples = () => {
      const candidates = Array.from(
        document.querySelectorAll(
          [
            "[data-site-chrome='header']",
            ".site-visual-block-v3[data-kind='text'] h1",
            ".site-visual-block-v3[data-kind='text'] h2",
            ".site-visual-action-card-v3",
            ".site-visual-facts-v3",
            ".site-visual-list-v3 article",
            ".site-actions-v3",
            "[data-primary-hero-cta='true']"
          ].join(",")
        )
      )
        .filter(isVisible)
        .map((element) => ({ element, rect: element.getBoundingClientRect(), name: selectorName(element) }))
        .filter((entry) => entry.rect.width >= 24 && entry.rect.height >= 24 && isMeaningfullyInViewport(entry.rect));
      const samples = [];
      for (let index = 0; index < candidates.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
          const left = candidates[index];
          const right = candidates[otherIndex];
          if (left.element.contains(right.element) || right.element.contains(left.element)) continue;
          const area = intersectionArea(left.rect, right.rect);
          if (area <= 0) continue;
          const smallerArea = Math.max(1, Math.min(left.rect.width * left.rect.height, right.rect.width * right.rect.height));
          if (area / smallerArea < 0.12 && area < 1400) continue;
          samples.push(
            left.name +
              " overlaps " +
              right.name +
              " by " +
              Math.round(area) +
              "px^2"
          );
          if (samples.length >= 5) return samples;
        }
      }
      return samples;
    };
    const crampedTextSamples = () => {
      const minWidth = window.innerWidth < 480 ? 150 : window.innerWidth < 900 ? 180 : 220;
      const minWidthForElement = (element) => {
        if (element.closest(".site-visual-facts-v3")) return 96;
        if (element.closest(".site-visual-action-card-v3")) return window.innerWidth < 480 ? 150 : 180;
        const section = element.closest(".site-visual-section-v3");
        const templateId = section?.getAttribute("data-section-template");
        if (templateId === "feature_band" || templateId === "facts_cta") return window.innerWidth < 900 ? 118 : 140;
        if (templateId === "side_intro_rows" && window.innerWidth >= 760 && window.innerWidth < 1080) return 128;
        return minWidth;
      };
      return Array.from(
        siteRoot.querySelectorAll(
          [
            ".site-visual-block-v3[data-kind='text'] p:not(.site-eyebrow-v3)",
            ".site-visual-list-v3 article h3",
            ".site-visual-list-v3 article p",
            ".site-visual-action-card-v3 p",
            ".site-visual-facts-v3 a",
            ".site-visual-facts-v3 strong"
          ].join(",")
        )
      )
        .filter((element) => isVisible(element) && (element.innerText || "").trim().length >= 18)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter((entry) => isMeaningfullyInViewport(entry.rect) && entry.rect.width > 0 && entry.rect.width < minWidthForElement(entry.element))
        .slice(0, 5)
        .map((entry) => selectorName(entry.element) + " width=" + Math.round(entry.rect.width) + " text=" + (entry.element.innerText || "").trim().slice(0, 70));
    };
    const bodyText = document.body?.innerText?.replace(/\\s+/g, " ").trim() ?? "";
    const siteRoot = document.querySelector(".public-site") || document.body;
    const hero =
      document.querySelector(
        [
          ".site-visual-section-v3[data-section-template='hero']",
          ".site-visual-section-v3[data-section-template='hero_split']",
          ".site-visual-section-v3[data-section-template='hero_statement']",
          ".site-visual-section-v3[data-section-template='full_bleed_media']"
        ].join(",")
      ) ??
      document.querySelector(".site-hero-v3") ??
      document.querySelector(".site-hero-v2") ??
      document.querySelector(".hero");
    const h1 = hero?.querySelector("h1") ?? document.querySelector("h1");
    const heroPrimaryCtas = hero ? Array.from(hero.querySelectorAll("[data-primary-hero-cta='true']")).filter(isVisible) : [];
    const pagePrimaryCtas = Array.from(document.querySelectorAll("[data-primary-hero-cta='true']")).filter(isVisible);
    const primaryHeroCtas = heroPrimaryCtas.length ? heroPrimaryCtas : pagePrimaryCtas;
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
    const heroMediaEdgeClipSamples = () => {
      if (!primaryMedia) return [];
      const edgeTolerance = window.innerWidth < 480 ? 0 : 8;
      return Array.from(primaryMedia.querySelectorAll("figure, img"))
        .filter((element) => isVisible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter((entry) => entry.rect.width > 40 && entry.rect.height > 40)
        .filter((entry) => entry.rect.left <= edgeTolerance || entry.rect.right >= window.innerWidth - edgeTolerance)
        .slice(0, 5)
        .map((entry) => selectorName(entry.element) + " left=" + Math.round(entry.rect.left) + " right=" + Math.round(entry.rect.right) + " viewport=" + window.innerWidth);
    };
    const sectionQualityInspections = () => {
      const textSelector = [
        "p",
        "li",
        "dt",
        "dd",
        "a.site-button",
        ".site-button-v3",
        ".site-visual-list-v3 span",
        ".site-eyebrow-v3",
        ".site-section-kicker-v3",
        ".site-contact-form-v3 label"
      ].join(",");
      const ratioOverlap = (a, b) => {
        const area = intersectionArea(a, b);
        if (area <= 0) return 0;
        const smaller = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
        return area / smaller;
      };
      const maxPairOverlapRatio = (rects) => {
        let max = 0;
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            max = Math.max(max, ratioOverlap(rects[i], rects[j]));
          }
        }
        return max;
      };
      return Array.from(document.querySelectorAll(".site-visual-section-v3")).map((section, sectionIndex) => {
        const rect = section.getBoundingClientRect();
        const templateId = section.getAttribute("data-section-template") || undefined;
        const sectionId = section.getAttribute("data-section-id") || section.id || undefined;
        const label = [
          "section " + (sectionIndex + 1),
          templateId || "section",
          sectionId ? "#" + sectionId : ""
        ].filter(Boolean).join(" ");
        const blocks = Array.from(section.querySelectorAll(".site-visual-block-v3")).filter(isVisible);
        const contentArea = blocks.reduce((sum, block) => {
          const blockRect = block.getBoundingClientRect();
          return sum + Math.max(0, blockRect.width) * Math.max(0, blockRect.height);
        }, 0);
        const fillRatio = rect.width > 0 && rect.height > 0 ? Math.min(1, contentArea / (rect.width * rect.height)) : 0;
        let headingOverflowPx = 0;
        let headingOverflowElement = undefined;
        for (const heading of Array.from(section.querySelectorAll("h1, h2, h3"))) {
          const parent = heading.parentElement;
          if (!parent || !isVisible(heading)) continue;
          const headingRect = heading.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          if (headingRect.width <= 0 || parentRect.width <= 0) continue;
          const overflow = Math.max(
            headingRect.width - parentRect.width,
            heading.scrollWidth - heading.clientWidth
          );
          if (overflow > headingOverflowPx) {
            headingOverflowPx = overflow;
            headingOverflowElement = heading;
          }
        }
        const siblingRects = Array.from(section.children)
          .filter((child) => {
            const childRect = child.getBoundingClientRect();
            return childRect.width > 60 && childRect.height > 60;
          })
          .map((child) => child.getBoundingClientRect());
        const blockOverlapMaxRatio = maxPairOverlapRatio(siblingRects);
        const figureRects = Array.from(section.querySelectorAll("figure"))
          .filter(isVisible)
          .map((figure) => figure.getBoundingClientRect())
          .filter((figureRect) => figureRect.width > 24 && figureRect.height > 24);
        const figureOverlapMaxRatio = maxPairOverlapRatio(figureRects);
        const minWidth = window.innerWidth < 480 ? 150 : window.innerWidth < 900 ? 180 : 220;
        const crampedTextEntries = Array.from(
          section.querySelectorAll(
            [
              ".site-visual-block-v3[data-kind='text'] p:not(.site-eyebrow-v3)",
              ".site-visual-list-v3 article h3",
              ".site-visual-list-v3 article p",
              ".site-visual-action-card-v3 p",
              ".site-visual-facts-v3 a",
              ".site-visual-facts-v3 strong"
            ].join(",")
          )
        ).filter((element) => {
          if (!isVisible(element) || (element.innerText || "").trim().length < 18) return false;
          const elementRect = element.getBoundingClientRect();
          const templateId = section.getAttribute("data-section-template");
          const localMinWidth = element.closest(".site-visual-facts-v3")
            ? 96
            : templateId === "feature_band" || templateId === "facts_cta"
              ? window.innerWidth < 900 ? 118 : 140
              : templateId === "side_intro_rows" && window.innerWidth >= 760 && window.innerWidth < 1080
                ? 128
                : minWidth;
          return elementRect.width > 0 && elementRect.width < localMinWidth;
        });
        const crampedTextCount = crampedTextEntries.length;
        const images = Array.from(section.querySelectorAll("img"));
        const brokenImages = images.filter((image) => image.complete && (image.naturalWidth === 0 || image.naturalHeight === 0));
        const brokenImageCount = brokenImages.length;
        const textMetrics = Array.from(section.querySelectorAll(textSelector))
          .filter((element) => isVisible(element) && (element.innerText || "").trim().length > 0)
          .map((element) => {
            const style = getComputedStyle(element);
            const foreground = parseRgb(style.color);
            const background = backgroundForElement(element);
            return foreground && background ? { element, contrast: contrastRatio(foreground, background) } : undefined;
          })
          .filter((value) => value && Number.isFinite(value.contrast) && value.contrast > 0);
        const minTextContrastMetric = textMetrics.length ? [...textMetrics].sort((left, right) => left.contrast - right.contrast)[0] : undefined;
        const minTextContrastRatio = minTextContrastMetric?.contrast;
        const findings = [];
        const push = (id, severity, title, evidence, provenance) => findings.push({ id, severity, title, evidence, ...(provenance || {}) });
        const heroLike = templateId && (templateId.startsWith("hero") || templateId === "full_bleed_media");
        if (headingOverflowPx > 4) {
          push(
            "render.section_heading_overflow",
            "fail",
            "Section heading stays inside its column",
            Math.round(headingOverflowPx) + "px overflow.",
            provenanceForElement(headingOverflowElement)
          );
        } else {
          push("render.section_heading_overflow", "pass", "Section heading stays inside its column", "No heading overflow above 4px.");
        }
        if (blockOverlapMaxRatio > 0.25) {
          push("render.section_block_overlap", "fail", "Section sibling blocks do not overlap", Math.round(blockOverlapMaxRatio * 100) + "% maximum overlap.");
        } else {
          push("render.section_block_overlap", "pass", "Section sibling blocks do not overlap", "Maximum overlap is " + Math.round(blockOverlapMaxRatio * 100) + "%.");
        }
        if (figureOverlapMaxRatio > 0.2) {
          push("render.section_figure_overlap", "fail", "Section figures do not overlap", Math.round(figureOverlapMaxRatio * 100) + "% maximum figure overlap.");
        } else {
          push("render.section_figure_overlap", "pass", "Section figures do not overlap", "Maximum figure overlap is " + Math.round(figureOverlapMaxRatio * 100) + "%.");
        }
        const compactTemplateAllowsNarrowText =
          templateId === "feature_band" ||
          templateId === "facts_cta" ||
          (templateId === "side_intro_rows" && window.innerWidth >= 760 && window.innerWidth < 1080);
        if (crampedTextCount > 0) {
          push(
            "render.section_cramped_text",
            compactTemplateAllowsNarrowText ? "warning" : "fail",
            "Section text columns are not cramped",
            crampedTextCount + " cramped text samples.",
            provenanceForElement(crampedTextEntries[0])
          );
        } else {
          push("render.section_cramped_text", "pass", "Section text columns are not cramped", "No cramped text samples.");
        }
        if (brokenImageCount > 0) {
          push("render.section_broken_media", "fail", "Section images load", brokenImageCount + " broken images.", provenanceForElement(brokenImages[0]));
        } else {
          push("render.section_broken_media", "pass", "Section images load", images.length + " images checked.");
        }
        if (typeof minTextContrastRatio === "number" && minTextContrastRatio < 4.5) {
          push(
            "render.section_text_contrast",
            "fail",
            "Section text contrast meets AA minimum",
            "Lowest contrast is " + minTextContrastRatio.toFixed(2) + ":1.",
            provenanceForElement(minTextContrastMetric?.element)
          );
        } else {
          push("render.section_text_contrast", "pass", "Section text contrast meets AA minimum", typeof minTextContrastRatio === "number" ? "Lowest contrast is " + minTextContrastRatio.toFixed(2) + ":1." : "No readable text sampled.");
        }
        if (!heroLike && fillRatio < 0.12) {
          push("render.section_fill", "fail", "Section has enough occupied composition", Math.round(fillRatio * 100) + "% fill ratio.");
        } else if (fillRatio < 0.22) {
          push("render.section_fill", "warning", "Section has enough occupied composition", Math.round(fillRatio * 100) + "% fill ratio.");
        } else {
          push("render.section_fill", "pass", "Section has enough occupied composition", Math.round(fillRatio * 100) + "% fill ratio.");
        }
        return {
          viewport: "desktop",
          sectionIndex,
          sectionId,
          templateId,
          label,
          rect: {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          },
          textChars: (section.innerText || "").replace(/\\s+/g, " ").trim().length,
          fillRatio,
          imageCount: images.length,
          brokenImageCount,
          minTextContrastRatio,
          headingOverflowPx: Math.max(0, headingOverflowPx),
          blockOverlapMaxRatio,
          figureOverlapMaxRatio,
          crampedTextCount,
          findings
        };
      }).filter((inspection) => inspection.rect.width > 80 && inspection.rect.height > 80);
    };
    const siteHeader = document.querySelector("[data-site-chrome='header']");
    const siteStyle = getComputedStyle(siteRoot);
    const h1Style = h1 ? getComputedStyle(h1) : undefined;
    const h1LineRects = textLineRects(h1);
    // Fact labels/values, list numerals, eyebrows, and form labels must be
    // sampled explicitly: they carry their own colors and are exactly the
    // elements that historically went unreadable on dark sections.
    const readableElements = Array.from(
      siteRoot.querySelectorAll(
        "p, li, dt, dd, a.site-button, .site-button-v3, .site-card-v2 h3, .site-card-v2 p, .site-card-link-v2 > span:last-child, " +
          ".site-visual-facts-v3 span, .site-visual-facts-v3 strong, .site-visual-facts-v3 a, .site-visual-list-v3 span, .site-eyebrow-v3, .site-contact-form-v3 label"
      )
    ).filter((element) => isVisible(element) && (element.innerText || "").trim().length > 0);
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
    const headerReadableMetrics = siteHeader
      ? Array.from(siteHeader.querySelectorAll("a, strong, .site-button-v3"))
          .filter((element) => isVisible(element) && (element.innerText || element.getAttribute("aria-label") || "").trim().length > 0)
          .map((element) => {
            const style = getComputedStyle(element);
            const foreground = parseRgb(style.color);
            const background = backgroundForElement(element);
            return {
              contrast: foreground && background ? contrastRatio(foreground, background) : undefined,
              sample: selectorName(element) + " fg=" + style.color + " text=" + (element.innerText || "").trim().slice(0, 60)
            };
          })
      : [];
    const headerContrastRatios = headerReadableMetrics.map((metric) => metric.contrast).filter((value) => Number.isFinite(value) && value > 0);
    const minHeaderContrastMetric = headerReadableMetrics
      .filter((metric) => Number.isFinite(metric.contrast))
      .sort((left, right) => left.contrast - right.contrast)[0];
    const overlapSamples = foregroundOverlapSamples();
    const crampedSamples = crampedTextSamples();
    const mediaEdgeSamples = heroMediaEdgeClipSamples();
    const sectionMediaOverflowSamples = (() => {
      const samples = [];
      const candidates = Array.from(document.querySelectorAll(".site-visual-section-v3 figure, .site-visual-section-v3 .site-visual-media-v3, .site-visual-section-v3 .site-hero-media-v3"));
      for (const element of candidates) {
        if (!isVisible(element)) continue;
        const rect = element.getBoundingClientRect();
        const container = element.closest("article, .site-visual-block-v3, .site-visual-section-v3");
        if (!container || container === element) continue;
        const containerRect = container.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24 || containerRect.width < 24 || containerRect.height < 24) continue;
        const overflow = Math.max(
          containerRect.left - rect.left,
          rect.right - containerRect.right,
          containerRect.top - rect.top,
          rect.bottom - containerRect.bottom
        );
        if (overflow > 6) {
          samples.push(
            selectorName(element) +
              " overflows " +
              selectorName(container) +
              " by " +
              Math.round(overflow) +
              "px"
          );
        }
      }
      return samples.slice(0, 6);
    })();
    const formAffordanceIssueSamples = (() => {
      const samples = [];
      for (const field of Array.from(document.querySelectorAll(".site-contact-form-v3 input, .site-contact-form-v3 select, .site-contact-form-v3 textarea"))) {
        if (!isVisible(field)) continue;
        const style = getComputedStyle(field);
        const borderVisible =
          (Number.parseFloat(style.borderTopWidth || "0") > 0 || Number.parseFloat(style.outlineWidth || "0") > 0) &&
          !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(style.borderTopColor);
        const backgroundVisible = !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(style.backgroundColor);
        const shadowVisible = style.boxShadow && style.boxShadow !== "none";
        if (!borderVisible && !backgroundVisible && !shadowVisible) {
          samples.push(selectorName(field) + " has no visible border/background/shadow");
        }
      }
      return samples.slice(0, 6);
    })();
    const contactFactWrapIssueSamples = (() => {
      const samples = [];
      const links = Array.from(
        document.querySelectorAll(
          ".site-visual-facts-v3 a[href^='mailto:'], .site-contact-facts-v3 a[href^='mailto:'], [data-site-chrome='footer'] a[href^='mailto:']"
        )
      );
      for (const link of links) {
        if (!isVisible(link)) continue;
        const text = (link.textContent || "").trim();
        if (!/@/.test(text) || text.length < 18) continue;
        const rect = link.getBoundingClientRect();
        if (rect.width > 0 && rect.width < Math.min(170, text.length * 5.2)) {
          samples.push(selectorName(link) + " width=" + Math.round(rect.width) + " text=" + text.slice(0, 80));
        }
      }
      return samples.slice(0, 6);
    })();
    // Composition QA: figure-vs-figure overlap and per-section blank-space fill.
    const figureOverlapSamples = (() => {
      const samples = [];
      for (const section of Array.from(document.querySelectorAll(".site-visual-section-v3"))) {
        const figures = Array.from(section.querySelectorAll("figure")).map((figure) => figure.getBoundingClientRect()).filter((rect) => rect.width > 24 && rect.height > 24);
        for (let i = 0; i < figures.length; i += 1) {
          for (let j = i + 1; j < figures.length; j += 1) {
            const a = figures[i];
            const b = figures[j];
            const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            const intersection = x * y;
            const smaller = Math.min(a.width * a.height, b.width * b.height);
            if (smaller > 0 && intersection / smaller > 0.2) {
              samples.push((section.getAttribute("data-section-template") || "section") + ": figures overlap " + Math.round((intersection / smaller) * 100) + "%");
            }
          }
        }
      }
      return samples.slice(0, 6);
    })();
    const a11yStructureIssues = (() => {
      const issues = [];
      if (!document.querySelector("main, [role='main']")) issues.push("no main landmark");
      const h1Count = document.querySelectorAll("h1").length;
      if (h1Count !== 1) issues.push(h1Count + " h1 elements (want exactly 1)");
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      let lastLevel = 0;
      for (const heading of headings) {
        const level = Number(heading.tagName.slice(1));
        if (lastLevel && level > lastLevel + 1) {
          issues.push("heading level skip: h" + lastLevel + " -> h" + level);
          break;
        }
        lastLevel = level;
      }
      const images = Array.from(document.images);
      const missingAlt = images.filter((image) => !image.hasAttribute("alt")).length;
      if (missingAlt) issues.push(missingAlt + " images missing alt attributes");
      return issues.slice(0, 6);
    })();
    const upscaledImageSamples = (() => {
      const samples = [];
      for (const image of Array.from(document.images)) {
        if (!image.complete || image.naturalWidth === 0) continue;
        const rect = image.getBoundingClientRect();
        if (rect.width < 320) continue;
        const factor = rect.width / image.naturalWidth;
        if (factor > 2.2) {
          samples.push((image.getAttribute("src") || "image").split("/").pop().slice(0, 40) + " rendered at " + Math.round(factor * 10) / 10 + "x natural size");
        }
      }
      return samples.slice(0, 6);
    })();
    const oversizedImageSamples = (() => {
      // Containment failure (the full-page-logo class): an image rendered far
      // larger than its slot. The upscale check above skips images under 320px
      // wide and only flags blurry *upscaling*, so a large-natural image that
      // escapes its box renders near 1x and slips past it entirely. This is the
      // inverse check — rendered box vs. intended size — and is pure geometry,
      // no model judgement.
      const samples = [];
      const vh = window.innerHeight;
      for (const image of Array.from(document.images)) {
        if (!isVisible(image)) continue;
        const rect = image.getBoundingClientRect();
        const name = (image.getAttribute("src") || "image").split("/").pop().slice(0, 40);
        if (image.matches("img.site-brand-mark-v3")) {
          // The header brand slot is a fixed ~42px square; anything materially
          // larger means CSS containment failed and the logo is eating the page.
          if (Math.min(rect.width, rect.height) > 96) {
            samples.push("brand mark " + name + " rendered " + Math.round(rect.width) + "x" + Math.round(rect.height) + "px (slot is 42px)");
          }
          continue;
        }
        // Content images: heroes and full-bleed media stay within ~1 viewport.
        // Taller than 1.3 viewports with real width means it broke out of its box.
        if (rect.height > vh * 1.3 && rect.width > 80) {
          samples.push(name + " rendered " + Math.round(rect.width) + "x" + Math.round(rect.height) + "px exceeds viewport " + window.innerWidth + "x" + vh);
        }
      }
      return samples.slice(0, 6);
    })();
    const headerLogoSample = (() => {
      // The generic upscale check skips images under 320px wide, so the 42px
      // header brand slot needs its own resolution check (retina = 2x).
      const logo = document.querySelector("img.site-brand-mark-v3, img.site-brand-logo-v3");
      if (!logo || !logo.complete || logo.naturalWidth === 0) return undefined;
      const rect = logo.getBoundingClientRect();
      if (rect.width <= 0) return undefined;
      const needed = Math.round(Math.min(rect.width, rect.height) * 2);
      const natural = Math.min(logo.naturalWidth, logo.naturalHeight);
      const name = (logo.getAttribute("src") || "logo").split("/").pop().slice(0, 40);
      return natural < needed
        ? "low-res: " + name + " is " + logo.naturalWidth + "x" + logo.naturalHeight + " in a " + Math.round(rect.width) + "px slot (needs " + needed + "px for retina)"
        : "ok: " + name + " " + logo.naturalWidth + "x" + logo.naturalHeight;
    })();
    const sectionFillSamples = (() => {
      const samples = [];
      for (const section of Array.from(document.querySelectorAll(".site-visual-section-v3"))) {
        const rect = section.getBoundingClientRect();
        if (rect.width < 200 || rect.height < 160) continue;
        let contentArea = 0;
        for (const block of Array.from(section.querySelectorAll(".site-visual-block-v3"))) {
          const blockRect = block.getBoundingClientRect();
          contentArea += Math.max(0, blockRect.width) * Math.max(0, blockRect.height);
        }
        const fill = Math.min(1, contentArea / (rect.width * rect.height));
        if (fill < 0.22) {
          samples.push((section.getAttribute("data-section-template") || "section") + ": " + Math.round(fill * 100) + "% filled");
        }
      }
      return samples.slice(0, 6);
    })();
    const headingOverflowSamples = (() => {
      // A heading wider than its parent column paints under adjacent blocks
      // (the location/process defect class found by hand on 2026-06-11).
      const samples = [];
      for (const heading of Array.from(document.querySelectorAll("h1, h2, h3"))) {
        const parent = heading.parentElement;
        if (!parent) continue;
        const rect = heading.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        if (rect.width <= 0 || parentRect.width <= 0) continue;
        // Two escape modes: the heading box outgrowing its column (grid
        // min-content sizing) and text escaping a correctly-sized box.
        const boxOverflow = rect.width - parentRect.width;
        const textOverflow = heading.scrollWidth - heading.clientWidth;
        const overflow = Math.max(boxOverflow, textOverflow);
        if (overflow > 4) {
          samples.push(
            '"' + (heading.textContent || "").trim().slice(0, 32) + '" ' + Math.round(overflow) + "px past its column"
          );
        }
      }
      return samples.slice(0, 6);
    })();
    const blockOverlapSamples = (() => {
      // Section-level sibling blocks should never substantially intersect.
      const samples = [];
      for (const section of Array.from(document.querySelectorAll(".site-visual-section-v3, section"))) {
        const blocks = Array.from(section.children).filter((child) => {
          const rect = child.getBoundingClientRect();
          return rect.width > 60 && rect.height > 60;
        });
        for (let a = 0; a < blocks.length; a += 1) {
          for (let b = a + 1; b < blocks.length; b += 1) {
            const ra = blocks[a].getBoundingClientRect();
            const rb = blocks[b].getBoundingClientRect();
            const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
            const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
            const intersection = ix * iy;
            const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
            if (smaller > 0 && intersection / smaller > 0.25) {
              const template = section.getAttribute("data-section-template") || "section";
              samples.push(template + ": sibling blocks intersect " + Math.round((intersection / smaller) * 100) + "%");
            }
          }
        }
      }
      return samples.slice(0, 6);
    })();
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
        ? primaryHeroCtaRect.top <= window.innerHeight && primaryHeroCtaVisibleHeight >= Math.min(primaryHeroCtaRect.height, 44)
        : typeof firstCtaTop === "number" ? firstCtaTop >= 0 && firstCtaTop <= window.innerHeight : false,
      primaryHeroCtaDetected: Boolean(primaryHeroCta),
      primaryHeroCtaAboveFold: primaryHeroCtaRect ? primaryHeroCtaRect.top <= window.innerHeight && primaryHeroCtaVisibleHeight >= Math.min(primaryHeroCtaRect.height, 44) : false,
      primaryMediaImageLoaded: primaryMediaImage ? primaryMediaImage.complete && primaryMediaImage.naturalWidth > 0 && primaryMediaImage.naturalHeight > 0 : undefined,
      siteHeaderDetected: Boolean(document.querySelector("[data-site-chrome='header']")),
      siteFooterDetected: Boolean(document.querySelector("[data-site-chrome='footer']")),
      horizontalOverflowPx: Math.max(0, documentWidth - window.innerWidth),
      bodyFontSizePx: Number.parseFloat(siteStyle.fontSize || "0") || undefined,
      minReadableTextFontSizePx: readableFontSizes.length ? Math.min(...readableFontSizes) : undefined,
      minTextContrastRatio: contrastRatios.length ? Math.min(...contrastRatios) : undefined,
      minTextContrastSample: minContrastMetric?.sample,
      headerContrastRatio: headerContrastRatios.length ? Math.min(...headerContrastRatios) : undefined,
      headerContrastSample: minHeaderContrastMetric?.sample,
      headerVisualMode: siteHeader?.getAttribute("data-header-visual-mode") ?? siteHeader?.getAttribute("data-header-mode") ?? undefined,
      heroH1LineCount: h1LineRects.length || undefined,
      heroH1MaxLineWidthPx: h1LineRects.length ? Math.max(...h1LineRects.map((rect) => rect.width)) : undefined,
      visualOverlapCount: overlapSamples.length,
      visualOverlapSamples: overlapSamples,
      headingOverflowCount: headingOverflowSamples.length,
      headingOverflowSamples,
      blockOverlapCount: blockOverlapSamples.length,
      blockOverlapSamples,
      figureOverlapCount: figureOverlapSamples.length,
      figureOverlapSamples,
      upscaledImageCount: upscaledImageSamples.length,
      upscaledImageSamples,
      oversizedImageCount: oversizedImageSamples.length,
      oversizedImageSamples,
      headerLogoSample,
      a11yStructureIssues,
      sectionLowFillCount: sectionFillSamples.length,
      sectionLowFillSamples: sectionFillSamples,
      crampedTextCount: crampedSamples.length,
      crampedTextSamples: crampedSamples,
      heroMediaEdgeClipCount: mediaEdgeSamples.length,
      heroMediaEdgeClipSamples: mediaEdgeSamples,
      sectionMediaOverflowCount: sectionMediaOverflowSamples.length,
      sectionMediaOverflowSamples,
      formAffordanceIssueCount: formAffordanceIssueSamples.length,
      formAffordanceIssueSamples,
      contactFactWrapIssueCount: contactFactWrapIssueSamples.length,
      contactFactWrapIssueSamples,
      headingFontFamily: h1Style?.fontFamily,
      bodyFontFamily: siteStyle.fontFamily,
      sectionInspections: sectionQualityInspections(),
      brandColorSamples: (() => {
        const samples = [];
        const pushColor = (value) => {
          if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") samples.push(value);
        };
        const header = document.querySelector("header") || document.querySelector("[data-site-chrome='header']") || document.querySelector("nav");
        if (header) {
          pushColor(getComputedStyle(header).backgroundColor);
          const headerLink = header.querySelector("a");
          if (headerLink) pushColor(getComputedStyle(headerLink).color);
        }
        const buttons = Array.from(
          document.querySelectorAll("a.button, button, .button, .btn, [class*='button'], input[type='submit']")
        ).filter(isVisible).slice(0, 6);
        for (const button of buttons) {
          pushColor(getComputedStyle(button).backgroundColor);
        }
        const firstLink = Array.from(document.querySelectorAll("main a, body a")).filter(isVisible)[0];
        if (firstLink) pushColor(getComputedStyle(firstLink).color);
        if (h1) pushColor(getComputedStyle(h1).color);
        pushColor(getComputedStyle(document.body).backgroundColor);
        return samples.slice(0, 16);
      })(),
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
  const h1LineCount = metrics.heroH1LineCount;
  const viewportName = viewport ?? metrics.viewport?.name;
  const maxH1Lines = viewportName === "mobile" ? 6 : viewportName === "tablet" ? 5 : 4;

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
  if (typeof h1LineCount === "number") {
    findings.push({
      id: `render.hero_h1_lines${suffix}`,
      severity: h1LineCount <= maxH1Lines ? "pass" : "fail",
      title: `Hero headline line count is controlled${titleSuffix}`,
      evidence: `${h1LineCount} rendered H1 line boxes detected; maximum for this viewport is ${maxH1Lines}.`,
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
      evidence: `Lowest sampled text contrast ratio is ${metrics.minTextContrastRatio.toFixed(2)}:1.${metrics.minTextContrastSample ? ` Sample: ${metrics.minTextContrastSample}` : ""}`,
      viewport
    });
  }
  if (typeof metrics.headerContrastRatio === "number") {
    findings.push({
      id: `render.header_contrast${suffix}`,
      severity: metrics.headerContrastRatio >= 4.5 ? "pass" : "fail",
      title: `Header contrast is readable${titleSuffix}`,
      evidence: `Lowest sampled header contrast ratio is ${metrics.headerContrastRatio.toFixed(2)}:1 (${metrics.headerVisualMode ?? "unknown mode"}).`,
      viewport
    });
  }
  if (typeof metrics.visualOverlapCount === "number") {
    findings.push({
      id: `render.visual_overlap${suffix}`,
      severity: metrics.visualOverlapCount === 0 ? "pass" : "fail",
      title: `Foreground elements do not incoherently overlap${titleSuffix}`,
      evidence: metrics.visualOverlapCount
        ? `${metrics.visualOverlapCount} foreground overlap samples: ${(metrics.visualOverlapSamples ?? []).join("; ")}`
        : "No foreground overlap samples detected.",
      viewport
    });
  }
  if (typeof metrics.headingOverflowCount === "number") {
    // Warning during burn-in (bespoke quality plan, workstream E); promote to
    // fail once the detector has two clean weeks against real generations.
    findings.push({
      id: `render.heading_overflow${suffix}`,
      severity: metrics.headingOverflowCount === 0 ? "pass" : "warning",
      title: `Headings stay inside their columns${titleSuffix}`,
      evidence: metrics.headingOverflowCount
        ? `${metrics.headingOverflowCount} heading overflow samples: ${(metrics.headingOverflowSamples ?? []).join("; ")}`
        : "No headings overflow their parent columns.",
      viewport
    });
  }
  if (typeof metrics.blockOverlapCount === "number") {
    findings.push({
      id: `render.block_overlap${suffix}`,
      severity: metrics.blockOverlapCount === 0 ? "pass" : "warning",
      title: `Section blocks do not intersect${titleSuffix}`,
      evidence: metrics.blockOverlapCount
        ? `${metrics.blockOverlapCount} block overlap samples: ${(metrics.blockOverlapSamples ?? []).join("; ")}`
        : "No section-level sibling blocks intersect.",
      viewport
    });
  }
  if (typeof metrics.crampedTextCount === "number") {
    findings.push({
      id: `render.cramped_text_columns${suffix}`,
      severity: metrics.crampedTextCount === 0 ? "pass" : "fail",
      title: `Text columns are not cramped${titleSuffix}`,
      evidence: metrics.crampedTextCount
        ? `${metrics.crampedTextCount} cramped text samples: ${(metrics.crampedTextSamples ?? []).join("; ")}`
        : "No cramped text samples detected.",
      viewport
    });
  }
  if (typeof metrics.sectionMediaOverflowCount === "number") {
    findings.push({
      id: `render.section_media_overflow${suffix}`,
      severity: metrics.sectionMediaOverflowCount === 0 ? "pass" : "fail",
      title: `Section media stays inside its containers${titleSuffix}`,
      evidence: metrics.sectionMediaOverflowCount
        ? `${metrics.sectionMediaOverflowCount} media overflow samples: ${(metrics.sectionMediaOverflowSamples ?? []).join("; ")}`
        : "No section media overflow detected.",
      viewport
    });
  }
  if (typeof metrics.formAffordanceIssueCount === "number") {
    findings.push({
      id: `render.form_affordance${suffix}`,
      severity: metrics.formAffordanceIssueCount === 0 ? "pass" : "fail",
      title: `Contact form fields have visible affordances${titleSuffix}`,
      evidence: metrics.formAffordanceIssueCount
        ? `${metrics.formAffordanceIssueCount} form affordance issue(s): ${(metrics.formAffordanceIssueSamples ?? []).join("; ")}`
        : "Contact form fields expose visible input boundaries.",
      viewport
    });
  }
  if (typeof metrics.contactFactWrapIssueCount === "number") {
    findings.push({
      id: `render.contact_fact_wrap${suffix}`,
      severity: metrics.contactFactWrapIssueCount === 0 ? "pass" : "warning",
      title: `Contact facts wrap legibly${titleSuffix}`,
      evidence: metrics.contactFactWrapIssueCount
        ? `${metrics.contactFactWrapIssueCount} cramped contact fact(s): ${(metrics.contactFactWrapIssueSamples ?? []).join("; ")}`
        : "Contact facts wrap or truncate legibly.",
      viewport
    });
  }
  if (typeof metrics.consoleErrorCount === "number") {
    const duplicateKeyErrors = (metrics.consoleErrorSamples ?? []).filter((sample) => /Encountered two children with the same key/i.test(sample));
    findings.push({
      id: `render.console_errors${suffix}`,
      severity: duplicateKeyErrors.length || metrics.consoleErrorCount > 0 ? "fail" : "pass",
      title: `Rendered site has no browser console errors${titleSuffix}`,
      evidence: metrics.consoleErrorCount
        ? `${metrics.consoleErrorCount} console error(s): ${(metrics.consoleErrorSamples ?? []).join("; ")}`
        : "No browser console errors detected.",
      viewport
    });
  }
  if (Array.isArray(metrics.a11yStructureIssues)) {
    findings.push({
      id: `render.a11y_structure${suffix}`,
      severity: metrics.a11yStructureIssues.length === 0 ? "pass" : "fail",
      title: `Accessibility structure${titleSuffix}`,
      evidence: metrics.a11yStructureIssues.length
        ? `Structure issues: ${metrics.a11yStructureIssues.join("; ")}`
        : "Main landmark present, single h1, ordered headings, alt attributes complete.",
      viewport
    });
  }
  if (typeof metrics.upscaledImageCount === "number") {
    findings.push({
      id: `render.image_upscaled${suffix}`,
      severity: metrics.upscaledImageCount === 0 ? "pass" : "fail",
      title: `Images render near natural resolution${titleSuffix}`,
      evidence: metrics.upscaledImageCount
        ? `${metrics.upscaledImageCount} blurry upscaled images: ${(metrics.upscaledImageSamples ?? []).join("; ")}`
        : "No images stretched beyond 2.2x natural size.",
      viewport
    });
  }
  if (typeof metrics.headerLogoSample === "string") {
    findings.push({
      id: `render.logo_low_res${suffix}`,
      severity: metrics.headerLogoSample.startsWith("low-res") ? "fail" : "pass",
      title: `Header logo renders at natural resolution${titleSuffix}`,
      evidence: metrics.headerLogoSample,
      viewport
    });
  }
  if (typeof metrics.oversizedImageCount === "number") {
    findings.push({
      id: `render.image_oversized${suffix}`,
      severity: metrics.oversizedImageCount === 0 ? "pass" : "fail",
      title: `Images stay within their layout slots${titleSuffix}`,
      evidence: metrics.oversizedImageCount
        ? `${metrics.oversizedImageCount} oversized images: ${(metrics.oversizedImageSamples ?? []).join("; ")}`
        : "No images escaped their layout slots.",
      viewport
    });
  }
  if (typeof metrics.figureOverlapCount === "number") {
    findings.push({
      id: `render.figure_overlap${suffix}`,
      severity: metrics.figureOverlapCount === 0 ? "pass" : "fail",
      title: `Section figures do not overlap${titleSuffix}`,
      evidence: metrics.figureOverlapCount
        ? `${metrics.figureOverlapCount} overlapping figure pairs: ${(metrics.figureOverlapSamples ?? []).join("; ")}`
        : "No overlapping figures detected.",
      viewport
    });
  }
  if (typeof metrics.sectionLowFillCount === "number") {
    findings.push({
      id: `render.section_blank_space${suffix}`,
      // Advisory while thresholds calibrate: low fill is a design smell, not
      // automatically a defect (hero whitespace can be intentional).
      severity: metrics.sectionLowFillCount === 0 ? "pass" : "warning",
      title: `Sections are reasonably filled${titleSuffix}`,
      evidence: metrics.sectionLowFillCount
        ? `${metrics.sectionLowFillCount} low-fill sections: ${(metrics.sectionLowFillSamples ?? []).join("; ")}`
        : "No abnormally blank sections detected.",
      viewport
    });
  }
  if (Array.isArray(metrics.sectionInspections)) {
    const sectionFailures = metrics.sectionInspections.filter((section) =>
      section.findings.some((finding) => finding.severity === "fail")
    );
    const sectionWarnings = metrics.sectionInspections.filter((section) =>
      section.findings.some((finding) => finding.severity === "warning")
    );
    findings.push({
      id: `render.section_quality${suffix}`,
      severity: sectionFailures.length ? "fail" : sectionWarnings.length ? "warning" : "pass",
      title: `Individual sections pass deterministic layout QA${titleSuffix}`,
      evidence: sectionFailures.length
        ? `${sectionFailures.length}/${metrics.sectionInspections.length} sections failed: ${sectionFailures
            .slice(0, 6)
            .map((section) => {
              const failed = section.findings.filter((finding) => finding.severity === "fail").map((finding) => finding.id.replace(/^render\\.section_/, ""));
              return `${section.label} (${failed.join(", ")})`;
            })
            .join("; ")}`
        : sectionWarnings.length
        ? `${sectionWarnings.length}/${metrics.sectionInspections.length} sections have warnings: ${sectionWarnings
            .slice(0, 6)
            .map((section) => section.label)
            .join("; ")}`
        : `${metrics.sectionInspections.length} sections passed heading overflow, overlap, cramped text, broken media, contrast, and fill thresholds.`,
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

function isActionableRenderConsoleMessage(type: string, text: string) {
  if (/Encountered two children with the same key/i.test(text)) return true;
  if (type !== "error") return false;
  if (/Cross-Origin-Opener-Policy|CORS|ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(text)) return false;
  if (/ReferenceError: google is not defined[\s\S]*maps\.gstatic\.com\/maps-api-v3\/embed/i.test(text)) return false;
  return /Hydration failed|Minified React error|React error|ReferenceError|TypeError|Cannot read properties|is not defined|Script error/i.test(text);
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
    headerContrastRatio: minDefined(left.headerContrastRatio, right.headerContrastRatio),
    headerContrastSample:
      minDefined(left.headerContrastRatio, right.headerContrastRatio) === left.headerContrastRatio
        ? left.headerContrastSample
        : right.headerContrastSample,
    headerVisualMode: left.headerVisualMode ?? right.headerVisualMode,
    heroH1LineCount: maxDefined(left.heroH1LineCount, right.heroH1LineCount),
    heroH1MaxLineWidthPx: maxDefined(left.heroH1MaxLineWidthPx, right.heroH1MaxLineWidthPx),
    visualOverlapCount: maxDefined(left.visualOverlapCount, right.visualOverlapCount),
    headingOverflowCount: maxDefined(left.headingOverflowCount, right.headingOverflowCount),
    headingOverflowSamples: left.headingOverflowSamples?.length ? left.headingOverflowSamples : right.headingOverflowSamples,
    blockOverlapCount: maxDefined(left.blockOverlapCount, right.blockOverlapCount),
    blockOverlapSamples: left.blockOverlapSamples?.length ? left.blockOverlapSamples : right.blockOverlapSamples,
    figureOverlapCount: maxDefined(left.figureOverlapCount, right.figureOverlapCount),
    upscaledImageCount: maxDefined(left.upscaledImageCount, right.upscaledImageCount),
    a11yStructureIssues: left.a11yStructureIssues?.length ? left.a11yStructureIssues : right.a11yStructureIssues,
    upscaledImageSamples: left.upscaledImageSamples?.length ? left.upscaledImageSamples : right.upscaledImageSamples,
    headerLogoSample: left.headerLogoSample?.startsWith("low-res")
      ? left.headerLogoSample
      : right.headerLogoSample?.startsWith("low-res")
      ? right.headerLogoSample
      : left.headerLogoSample ?? right.headerLogoSample,
    figureOverlapSamples: left.figureOverlapSamples?.length ? left.figureOverlapSamples : right.figureOverlapSamples,
    sectionLowFillCount: maxDefined(left.sectionLowFillCount, right.sectionLowFillCount),
    sectionLowFillSamples: left.sectionLowFillSamples?.length ? left.sectionLowFillSamples : right.sectionLowFillSamples,
    visualOverlapSamples: left.visualOverlapSamples?.length ? left.visualOverlapSamples : right.visualOverlapSamples,
    crampedTextCount: maxDefined(left.crampedTextCount, right.crampedTextCount),
    crampedTextSamples: left.crampedTextSamples?.length ? left.crampedTextSamples : right.crampedTextSamples,
    heroMediaEdgeClipCount: maxDefined(left.heroMediaEdgeClipCount, right.heroMediaEdgeClipCount),
    heroMediaEdgeClipSamples: left.heroMediaEdgeClipSamples?.length ? left.heroMediaEdgeClipSamples : right.heroMediaEdgeClipSamples,
    sectionMediaOverflowCount: maxDefined(left.sectionMediaOverflowCount, right.sectionMediaOverflowCount),
    sectionMediaOverflowSamples: left.sectionMediaOverflowSamples?.length ? left.sectionMediaOverflowSamples : right.sectionMediaOverflowSamples,
    formAffordanceIssueCount: maxDefined(left.formAffordanceIssueCount, right.formAffordanceIssueCount),
    formAffordanceIssueSamples: left.formAffordanceIssueSamples?.length ? left.formAffordanceIssueSamples : right.formAffordanceIssueSamples,
    contactFactWrapIssueCount: maxDefined(left.contactFactWrapIssueCount, right.contactFactWrapIssueCount),
    contactFactWrapIssueSamples: left.contactFactWrapIssueSamples?.length ? left.contactFactWrapIssueSamples : right.contactFactWrapIssueSamples,
    consoleErrorCount: maxDefined(left.consoleErrorCount, right.consoleErrorCount),
    consoleErrorSamples: left.consoleErrorSamples?.length ? left.consoleErrorSamples : right.consoleErrorSamples,
    headingFontFamily: left.headingFontFamily ?? right.headingFontFamily,
    bodyFontFamily: left.bodyFontFamily ?? right.bodyFontFamily,
    brandColorSamples: left.brandColorSamples?.length ? left.brandColorSamples : right.brandColorSamples,
    sectionInspections: [...(left.sectionInspections ?? []), ...(right.sectionInspections ?? [])]
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

async function waitForMapEmbeds(page: PageLike) {
  const hasMapEmbed = await page
    .evaluate(`Boolean(document.querySelector(".site-location-showcase-map-embed-v3 iframe"))`)
    .catch(() => false);
  if (!hasMapEmbed) return;
  await page.evaluate(`new Promise((resolve) => {
    const iframes = Array.from(document.querySelectorAll(".site-location-showcase-map-embed-v3 iframe"));
    let index = 0;
    const step = () => {
      const iframe = iframes[index];
      if (!iframe) {
        window.scrollTo(0, 0);
        setTimeout(resolve, 900);
        return;
      }
      iframe.scrollIntoView({ block: "center", inline: "nearest" });
      index += 1;
      setTimeout(step, 1200);
    };
    step();
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
