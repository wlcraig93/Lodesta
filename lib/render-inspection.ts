import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  RenderInspectionFinding,
  RenderInspectionResult,
  RenderScreenshotArtifact,
  RenderViewportName
} from "./models";

type BrowserViewport = {
  name: RenderViewportName;
  width: number;
  height: number;
};

type BrowserMetrics = NonNullable<RenderInspectionResult["metrics"]> & {
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
  screenshot(options: { path: string; fullPage: boolean }): Promise<Buffer>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
};

type BrowserLaunchOptions = {
  headless: boolean;
  executablePath?: string;
  args?: string[];
  timeout?: number;
};

type BrowserModuleLike = {
  chromium: {
    launch(options: BrowserLaunchOptions): Promise<BrowserLike>;
  };
};

export type InspectUrlRenderInput = {
  url: string;
  captureScreenshots?: boolean;
  artifactRoot?: string;
};

export type RenderInspectionRuntimeStatus = {
  packageInstalled: boolean;
  browserLaunchable: boolean;
  provider: "playwright" | "none";
  executablePath?: string;
  message: string;
};

const viewports: BrowserViewport[] = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 }
];

export async function inspectUrlRender(input: InspectUrlRenderInput): Promise<RenderInspectionResult> {
  const capturedAt = new Date().toISOString();
  const playwright = await loadPlaywright();

  if (!playwright) {
    return inspectWithFetchFallback(input.url, capturedAt, "Playwright is not installed in this runtime. Run npm run install:browsers during deployment setup.");
  }

  try {
    return await inspectWithPlaywright(input, capturedAt, playwright);
  } catch (error) {
    return inspectWithFetchFallback(
      input.url,
      capturedAt,
      error instanceof Error ? `Playwright render inspection failed: ${error.message}` : "Playwright render inspection failed."
    );
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
        const metrics = await page.evaluate(collectBrowserMetrics);
        finalUrl ??= metrics.finalUrl;
        aggregate = mergeMetrics(aggregate, metrics);
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
    sourceUrl: input.url,
    finalUrl,
    adapter: "playwright",
    capturedAt,
    screenshots,
    findings: normalizeFindings(findings),
    metrics: aggregate
  };
}

async function inspectWithFetchFallback(
  url: string,
  capturedAt: string,
  unavailableReason: string
): Promise<RenderInspectionResult> {
  try {
    const response = await fetch(url, {
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
      sourceUrl: url,
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
      metrics
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown fetch fallback error";
    return {
      sourceUrl: url,
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
      metrics: {}
    };
  }
}

function collectBrowserMetrics(): BrowserMetrics {
  const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
  const ctaSelectors = [
    "a[data-analytics-role]",
    "button[data-analytics-role]",
    "a[href^='tel:']",
    "a[href^='mailto:']",
    ".button",
    "button"
  ];
  const ctas = Array.from(document.querySelectorAll<HTMLElement>(ctaSelectors.join(","))).filter(
    (element) => (element.innerText || element.getAttribute("aria-label") || element.getAttribute("href") || "").trim()
  );
  const firstCtaTop = ctas[0]?.getBoundingClientRect().top;
  return {
    finalUrl: window.location.href,
    htmlBytes: document.documentElement.outerHTML.length,
    bodyTextChars: bodyText.length,
    sectionCount: document.querySelectorAll("[data-section-id], section").length,
    ctaCount: ctas.length,
    formCount: document.forms.length,
    telLinkCount: document.querySelectorAll("a[href^='tel:']").length,
    aboveFoldCtaDetected: typeof firstCtaTop === "number" ? firstCtaTop >= 0 && firstCtaTop <= window.innerHeight : false
  };
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
    htmlBytes: html.length,
    bodyTextChars: bodyText.length,
    sectionCount: countMatches(html, /data-section-id=|<section\b/gi),
    ctaCount: countMatches(html, /data-analytics-role=|href=["']tel:|class=["'][^"']*\bbutton\b|<button\b/gi),
    formCount: countMatches(html, /<form\b/gi),
    telLinkCount: countMatches(html, /href=["']tel:/gi),
    aboveFoldCtaDetected: firstCtaIndex >= 0 && firstCtaIndex < 6000
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
    severity: metrics.aboveFoldCtaDetected ? "pass" : "warning",
    title: `CTA appears near the first viewport${titleSuffix}`,
    evidence: metrics.aboveFoldCtaDetected
      ? "A CTA-like element was detected near the first viewport."
      : "No CTA-like element was detected near the first viewport.",
    viewport
  });
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
      executablePath: process.env.LODESTA_BROWSER_EXECUTABLE_PATH,
      message: "Playwright package is not installed."
    };
  }

  if (!options.launch) {
    return {
      packageInstalled: true,
      browserLaunchable: false,
      provider: "playwright",
      executablePath: process.env.LODESTA_BROWSER_EXECUTABLE_PATH,
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
      executablePath: process.env.LODESTA_BROWSER_EXECUTABLE_PATH,
      message: "Chromium launched successfully for render inspection."
    };
  } catch (error) {
    return {
      packageInstalled: true,
      browserLaunchable: false,
      provider: "playwright",
      executablePath: process.env.LODESTA_BROWSER_EXECUTABLE_PATH,
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
    executablePath: blankToUndefined(process.env.LODESTA_BROWSER_EXECUTABLE_PATH),
    args: parseBrowserArgs(process.env.LODESTA_RENDER_BROWSER_ARGS),
    timeout: renderTimeoutMs()
  };
}

function parseBrowserArgs(value: string | undefined) {
  const args = value
    ?.split(",")
    .map((arg) => arg.trim())
    .filter(Boolean);
  return args?.length ? args : undefined;
}

function renderTimeoutMs() {
  return 15000;
}

function blankToUndefined(value: string | undefined) {
  return value?.trim() || undefined;
}

async function createArtifactDir(input: InspectUrlRenderInput) {
  const parsed = new URL(input.url);
  const host = (parsed.hostname || parsed.protocol.replace(/:$/, "") || "render").replace(/[^a-z0-9.-]+/gi, "-");
  const runId = `${host}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const artifactRoot = input.artifactRoot ?? process.env.LODESTA_RENDER_ARTIFACT_ROOT ?? join(process.cwd(), ".data", "render-inspections");
  const artifactDir = join(artifactRoot, runId);
  await mkdir(artifactDir, { recursive: true });
  return artifactDir;
}

function mergeMetrics(left: BrowserMetrics, right: BrowserMetrics): BrowserMetrics {
  return {
    finalUrl: left.finalUrl ?? right.finalUrl,
    htmlBytes: maxDefined(left.htmlBytes, right.htmlBytes),
    bodyTextChars: maxDefined(left.bodyTextChars, right.bodyTextChars),
    sectionCount: maxDefined(left.sectionCount, right.sectionCount),
    ctaCount: maxDefined(left.ctaCount, right.ctaCount),
    formCount: maxDefined(left.formCount, right.formCount),
    telLinkCount: maxDefined(left.telLinkCount, right.telLinkCount),
    aboveFoldCtaDetected: Boolean(left.aboveFoldCtaDetected || right.aboveFoldCtaDetected)
  };
}

function maxDefined(left: number | undefined, right: number | undefined) {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
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
