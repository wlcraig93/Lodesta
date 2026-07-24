import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import axeCore from "axe-core";
import { sha256 } from "@/packages/business-data";
import type { ArtifactBlobStore } from "@/packages/site-artifacts/blob-store";
import type { SitePublicBuildInput } from "@/packages/site-contracts";
import type { PreparedSiteArtifact } from "./finalizer";
import type { ArtifactGateFinding } from "./contracts";

export type BrowserGateCapture = {
  key: string;
  route: string;
  viewport: "desktop" | "tablet" | "mobile";
  stage?: "natural" | "settled";
  bytes: Buffer;
};

export type FullBrowserGateResult = {
  findings: ArtifactGateFinding[];
  captures: BrowserGateCapture[];
  routesChecked: number;
  linksChecked: number;
};

export type BrowserVerificationUnavailableDetails = {
  component: "axe-core";
  stage: "preload" | "readiness";
  attempt: 1 | 2;
  route: string;
  viewport: "mobile";
  browserVersion: string;
  expectedVersion: string;
  detectedVersion?: string;
  sourceHash: `sha256:${string}`;
  consoleErrors: string[];
  cause?: string;
};

export class BrowserVerificationUnavailableError extends Error {
  readonly name = "BrowserVerificationUnavailableError";

  constructor(readonly details: BrowserVerificationUnavailableDetails) {
    super(`browser_verification_unavailable:${JSON.stringify(details)}`);
  }
}

const viewports = [
  { name: "desktop" as const, width: 1440, height: 1000 },
  { name: "tablet" as const, width: 834, height: 1112 },
  { name: "mobile" as const, width: 390, height: 844 }
];

export async function runArtifactBrowserGate(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  blobStore: ArtifactBlobStore;
  capturePrefix: string;
  signal?: AbortSignal;
}): Promise<FullBrowserGateResult> {
  try {
    return await runArtifactBrowserGateOnce(input, 1);
  } catch (error) {
    if (!transientBrowserInfrastructureError(error) || input.signal?.aborted) throw error;
    return runArtifactBrowserGateOnce(input, 2);
  }
}

async function runArtifactBrowserGateOnce(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  blobStore: ArtifactBlobStore;
  capturePrefix: string;
  signal?: AbortSignal;
}, attempt: 1 | 2): Promise<FullBrowserGateResult> {
  const harness = await startHarness(input);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const browserVersion = browser.version();
    const findings: ArtifactGateFinding[] = [];
    const captures: BrowserGateCapture[] = [];
    let linksChecked = 0;
    for (const route of input.prepared.routes) {
      for (const viewport of viewports) {
        if (input.signal?.aborted) throw new Error("workflow_deadline_exhausted");
        const page = await browser.newPage({ viewport });
        const consoleErrors: string[] = [];
        const routeFindings: ArtifactGateFinding[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") {
            consoleErrors.push(message.text());
            routeFindings.push(finding("render.console", `Console error: ${message.text()}`, route.path));
          }
        });
        page.on("pageerror", (error) => {
          consoleErrors.push(error.message);
          routeFindings.push(finding("render.page_error", `Page error: ${error.message}`, route.path));
        });
        page.on("request", (request) => {
          const requestUrl = new URL(request.url());
          if (requestUrl.origin !== harness.origin) {
            routeFindings.push(finding("render.network", `Final artifact attempted an external request to ${requestUrl.origin}.`, route.path));
          }
        });
        if (viewport.name === "mobile") {
          await preloadAutomatedAccessibility(page, {
            attempt,
            route: route.path,
            browserVersion,
            consoleErrors
          });
        }
        const response = await abortable(page.goto(`${harness.origin}${route.path === "/" ? "/" : `${route.path}/`}`, { waitUntil: "networkidle", timeout: 30_000 }), input.signal);
        if (!response?.ok()) routeFindings.push(finding("route.response", `Route returned ${response?.status() ?? "no response"}.`, route.path));
        const naturalMetrics = await inspectPage(page);
        if (route.path === "/" && viewport.name !== "tablet") {
          const naturalKey = `${input.capturePrefix.replace(/\/$/, "")}/${routeKey(route.path)}-${viewport.name}-natural.png`;
          captures.push({
            key: naturalKey,
            route: route.path,
            viewport: viewport.name,
            stage: "natural",
            bytes: await page.screenshot({ fullPage: false, type: "png" })
          });
        }
        if (naturalMetrics.lazyAboveFoldImageCount > 0) {
          routeFindings.push(finding(
            "render.lazy_above_fold_image",
            `${naturalMetrics.lazyAboveFoldImageCount} above-fold image(s) use loading="lazy" at ${viewport.name}. Examples: ${naturalMetrics.lazyAboveFoldImageExamples.join("; ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        await settleImages(page);
        const metrics = await inspectPage(page);
        if (viewport.name === "desktop") {
          routeFindings.push(...await verifyManagedFormSubmissions(page, route.path));
        }
        if (viewport.name === "mobile") {
          routeFindings.push(...await inspectAutomatedAccessibility(page, {
            attempt,
            route: route.path,
            browserVersion,
            consoleErrors
          }));
        }
        linksChecked += metrics.links.length;
        if (metrics.horizontalOverflowPx > 2) {
          routeFindings.push(finding("render.horizontal_overflow", `Horizontal overflow is ${metrics.horizontalOverflowPx}px at ${viewport.name}.`, route.path, "render", "warning"));
        }
        if (metrics.headingOverflowCount > 0) {
          routeFindings.push(finding("render.heading_overflow", `${metrics.headingOverflowCount} heading(s) overflow at ${viewport.name}.`, route.path, "render", "warning"));
        }
        if (metrics.brokenImages > 0) {
          routeFindings.push(finding("render.broken_image", `${metrics.brokenImages} image(s) failed at ${viewport.name}.`, route.path));
        }
        if (metrics.h1Count !== 1) {
          routeFindings.push(finding("accessibility.h1", `Route should have exactly one H1; found ${metrics.h1Count}.`, route.path, "accessibility", "warning"));
        }
        if (metrics.minBodyFontPx < 16) {
          const examples = metrics.smallBodyTextExamples.map((example) => `${example.selector} "${example.text}" (${example.fontSizePx}px)`).join("; ");
          routeFindings.push(finding("render.body_font", `Body copy computes below 16px at ${viewport.name}. Fix these selectors: ${examples}.`, route.path, "render", "warning"));
        }
        if (metrics.tinyVisibleTextCount > 0) {
          const examples = metrics.tinyTextExamples.map((example) => `${example.selector} "${example.text}" (${example.fontSizePx}px)`).join("; ");
          routeFindings.push(finding("render.tiny_text", `${metrics.tinyVisibleTextCount} visible text element(s) compute below 12px at ${viewport.name}. Fix these selectors: ${examples}.`, route.path, "render", "warning"));
        }
        if (metrics.lowContrastExamples.length > 0) {
          const examples = metrics.lowContrastExamples
            .map((example) => `${example.selector} "${example.text}" (${example.foreground} on ${example.background}, ${example.ratio}:1; requires ${example.requiredRatio}:1)`)
            .join("; ");
          routeFindings.push(finding(
            "render.contrast",
            `${metrics.lowContrastCount} body-text or interactive-label element(s) fail deterministic contrast at ${viewport.name}. Examples: ${examples}.`,
            route.path,
            "accessibility",
            "error"
          ));
        }
        if (metrics.clippedManagedContentExamples.length > 0) {
          routeFindings.push(finding(
            "render.managed_content_clipped",
            `${metrics.clippedManagedContentCount} managed capability block(s) hide content through unintended overflow at ${viewport.name}. Examples: ${metrics.clippedManagedContentExamples.join("; ")}.`,
            route.path,
            "capability"
          ));
        }
        if (metrics.emptyControlExamples.length > 0) {
          routeFindings.push(finding(
            "render.empty_control",
            `${metrics.emptyControlCount} visible interactive control(s) have no visible text, icon, image, or CSS affordance at ${viewport.name}. Examples: ${metrics.emptyControlExamples.join("; ")}.`,
            route.path,
            "render"
          ));
        }
        if (metrics.imageAltQualityExamples.length > 0) {
          routeFindings.push(finding(
            "render.image_alt_quality",
            `${metrics.imageAltQualityCount} rendered image alt attribute(s) are missing, filename-like, generic, or keyword-stuffed at ${viewport.name}. Examples: ${metrics.imageAltQualityExamples.join("; ")}.`,
            route.path,
            "accessibility",
            "warning"
          ));
        }
        if (viewport.name === "mobile" && metrics.missingMobileNavigation) {
          routeFindings.push(finding(
            "render.mobile_navigation",
            "Desktop navigation links are hidden on mobile without a visible navigation toggle or equivalent route access.",
            route.path,
            "render",
            "warning"
          ));
        }
        if (metrics.escapedEntityExamples.length > 0) {
          routeFindings.push(finding(
            "render.escaped_entity",
            `Visible text contains escaped HTML entity source instead of punctuation: ${metrics.escapedEntityExamples.join(", ")}.`,
            route.path,
            "render",
            "warning"
          ));
        }
        for (const href of metrics.links) {
          if (!validRenderedLink(href, route.path, new Set(input.prepared.routes.map((item) => item.path)))) {
            routeFindings.push(finding("link.rendered", `Rendered link does not resolve to a declared route or safe public URL: ${href}`, route.path, "link"));
          }
        }
        const key = `${input.capturePrefix.replace(/\/$/, "")}/${routeKey(route.path)}-${viewport.name}.png`;
        captures.push({ key, route: route.path, viewport: viewport.name, stage: "settled", bytes: await page.screenshot({ fullPage: true, type: "png" }) });
        findings.push(...routeFindings);
        await page.close();
      }
    }
    return {
      findings: dedupe(findings),
      captures,
      routesChecked: input.prepared.routes.length,
      linksChecked
    };
  } finally {
    await browser?.close();
    await stopServer(harness.server);
  }
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal) {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(new Error("workflow_deadline_exhausted"));
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("workflow_deadline_exhausted")), { once: true }))
  ]);
}

async function startHarness(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  blobStore: ArtifactBlobStore;
}) {
  const routeFiles = new Map(input.prepared.routes.map((route) => [route.path, route.html]));
  const assetKeys = new Map(input.buildInput.business.assets.map((asset) => [asset.revisionId, asset.storageKey]));
  const css = input.prepared.files.find((file) => file.path === "site.css")?.bytes;
  const runtimeSource = await readFile(resolve(process.cwd(), "packages/trusted-runtime/site-runtime-v1.js"));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/site.css" && css) return send(response, 200, css, "text/css; charset=utf-8");
      if (url.pathname.startsWith("/_lodesta/runtime/")) return send(response, 200, runtimeSource, "application/javascript; charset=utf-8");
      if (url.pathname === "/api/analytics") return send(response, 204, Buffer.alloc(0), "application/json");
      if (url.pathname === "/api/forms/submit") {
        if (request.method !== "POST") return send(response, 405, Buffer.from(JSON.stringify({ accepted: false })), "application/json");
        await readRequestBody(request);
        return send(response, 200, Buffer.from(JSON.stringify({ accepted: true })), "application/json");
      }
      const assetId = decodeURIComponent(url.pathname.match(/^\/_lodesta\/assets\/([^/]+)$/)?.[1] ?? "");
      if (assetId) {
        const key = assetKeys.get(assetId);
        const blob = key ? await input.blobStore.get(key) : undefined;
        return blob ? send(response, 200, blob.bytes, blob.contentType) : send(response, 404, Buffer.alloc(0), "text/plain");
      }
      const normalized = normalizePath(url.pathname);
      const html = routeFiles.get(normalized);
      return html ? send(response, 200, Buffer.from(html), "text/html; charset=utf-8") : send(response, 404, Buffer.from("Not found"), "text/plain");
    } catch (error) {
      return send(response, 500, Buffer.from(error instanceof Error ? error.message : "Harness error"), "text/plain");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser gate harness did not bind a TCP port.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

type BrowserPageMetrics = {
  horizontalOverflowPx: number;
  headingOverflowCount: number;
  brokenImages: number;
  h1Count: number;
  minBodyFontPx: number;
  smallBodyTextExamples: Array<{ selector: string; text: string; fontSizePx: number }>;
  tinyVisibleTextCount: number;
  tinyTextExamples: Array<{ selector: string; text: string; fontSizePx: number }>;
  lowContrastCount: number;
  lowContrastExamples: Array<{ selector: string; text: string; foreground: string; background: string; ratio: number; requiredRatio: number }>;
  clippedManagedContentCount: number;
  clippedManagedContentExamples: string[];
  emptyControlCount: number;
  emptyControlExamples: string[];
  imageAltQualityCount: number;
  imageAltQualityExamples: string[];
  lazyAboveFoldImageCount: number;
  lazyAboveFoldImageExamples: string[];
  missingMobileNavigation: boolean;
  escapedEntityExamples: string[];
  links: string[];
};

const browserInspectionSource = String.raw`(() => {
    const colorTools = {
      parse(value) {
        if (!/^rgba?\(/i.test(value.trim())) return { valid: false, channels: [0, 0, 0, 0] };
        const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
        if (parts.length < 3) return { valid: false, channels: [0, 0, 0, 0] };
        return { valid: true, channels: [parts[0], parts[1], parts[2], parts[3] ?? 1] };
      },
      luminance(color) {
        const channels = color.slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      },
      contrast(left, right) {
        const a = colorTools.luminance(left);
        const b = colorTools.luminance(right);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      },
      contrastFor(element) {
        const foregroundValue = getComputedStyle(element).color;
        const foreground = colorTools.parse(foregroundValue);
        if (!foreground.valid || foreground.channels[3] < 0.999) return { reliable: false };
        let current = element;
        let background;
        let backgroundValue = "rgb(255, 255, 255)";
        while (current) {
          const style = getComputedStyle(current);
          if (
            style.backgroundImage !== "none"
            || Number(style.opacity) < 0.999
            || style.filter !== "none"
            || style.mixBlendMode !== "normal"
          ) return { reliable: false };
          const candidate = style.backgroundColor;
          const parsed = colorTools.parse(candidate);
          if (!parsed.valid) return { reliable: false };
          if (parsed.channels[3] >= 0.999) {
            background = parsed.channels;
            backgroundValue = candidate;
            break;
          }
          if (parsed.channels[3] > 0.001) return { reliable: false };
          current = current.parentElement;
        }
        background ??= [255, 255, 255, 1];
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || (/bold/i.test(style.fontWeight) ? 700 : 400);
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        return {
          reliable: true,
          ratio: colorTools.contrast(foreground.channels, background),
          requiredRatio: large ? 3 : 4.5,
          foreground: foregroundValue,
          background: backgroundValue
        };
      },
      selectorFor(element) {
        if (element.id) return element.tagName.toLowerCase() + "#" + CSS.escape(element.id);
        const classes = [...element.classList].slice(0, 2).map((name) => "." + CSS.escape(name)).join("");
        return element.tagName.toLowerCase() + classes;
      },
      visible(element) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      },
      textFor(element) {
        if (element instanceof HTMLInputElement) {
          return ["button", "submit", "reset"].includes(element.type) ? element.value.trim() : "";
        }
        if (element instanceof HTMLTextAreaElement) return element.value.trim();
        if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent?.trim() ?? "";
        return (element.innerText ?? "").trim().replace(/\s+/g, " ");
      }
    };
    const root = document.documentElement;
    const elements = [...document.querySelectorAll("body *")];
    const visibleText = elements.filter((element) => {
      if (!colorTools.visible(element)) return false;
      const hasOwnText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0);
      const hasControlText = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) && Boolean(colorTools.textFor(element));
      return hasOwnText || hasControlText;
    });
    const bodyText = visibleText.filter((element) =>
      ["P", "LI", "DD", "DT", "LABEL", "BLOCKQUOTE", "ADDRESS", "A", "BUTTON"].includes(element.tagName)
      || element.matches("[role=button],input[type=button],input[type=submit],input[type=reset]")
      || Boolean(element.closest("p,li,dd,dt,label,blockquote,address,a[href],button,[role=button]")));
    const fontSizes = bodyText.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
    const textExample = (element) => ({
      selector: colorTools.selectorFor(element),
      text: colorTools.textFor(element).slice(0, 80),
      fontSizePx: Math.round(Number.parseFloat(getComputedStyle(element).fontSize) * 100) / 100
    });
    const smallBodyText = bodyText.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16);
    const tinyVisibleText = visibleText.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12);
    const lowContrast = bodyText
      .map((element) => ({ element, ...colorTools.contrastFor(element) }))
      .filter((item) => item.reliable && item.ratio < item.requiredRatio);
    const managed = [...document.querySelectorAll("[data-lodesta-map],[data-lodesta-form-id],[data-lodesta-gallery],[data-lodesta-disclosure]")];
    const clippedManagedContent = managed.filter((element) => {
      if (!colorTools.visible(element)) return false;
      const style = getComputedStyle(element);
      const clippedX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
      const clippedY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
      if (!clippedX && !clippedY) return false;
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll("*")].some((descendant) => {
        if (!colorTools.visible(descendant)) return false;
        const rect = descendant.getBoundingClientRect();
        const hasContent = Boolean(colorTools.textFor(descendant))
          || descendant.matches("a,button,input,select,textarea,img,svg");
        return hasContent && (
          (clippedY && (rect.bottom > bounds.bottom + 2 || rect.top < bounds.top - 2))
          || (clippedX && (rect.right > bounds.right + 2 || rect.left < bounds.left - 2))
        );
      });
    });
    const controls = [...document.querySelectorAll("a[href],button,[role=button],input[type=button],input[type=submit],input[type=reset]")];
    const emptyControls = controls.filter((element) => {
      if (!colorTools.visible(element)) return false;
      const style = getComputedStyle(element);
      const pseudo = [getComputedStyle(element, "::before"), getComputedStyle(element, "::after")]
        .some((value) => value.content && !["none", "normal", "\"\"", "''"].includes(value.content));
      const visibleGraphic = [...element.querySelectorAll("img,svg")].some((graphic) => colorTools.visible(graphic));
      const backgroundGraphic = style.backgroundImage !== "none";
      return !colorTools.textFor(element) && !pseudo && !visibleGraphic && !backgroundGraphic;
    });
    const boundImages = [...document.querySelectorAll('img[src*="/_lodesta/assets/"]')];
    const imageAltQuality = boundImages.filter((image) => {
      if (!image.hasAttribute("alt")) return true;
      const alt = (image.getAttribute("alt") ?? "").trim();
      if (!alt) return false;
      const words = alt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
      const repeated = words.some((word) => word.length >= 4 && words.filter((candidate) => candidate === word).length >= 3);
      return alt.length < 4
        || alt.length > 220
        || /\.(?:jpe?g|png|webp|gif|svg)\b|https?:\/\/|[_-]{2,}|\b(?:img|dsc|screenshot)[\s_-]*\d+\b|^image$|\bsource photograph\b/i.test(alt)
        || /\bnear me\b/i.test(alt)
        || repeated;
    });
    const lazyAboveFoldImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return image.getAttribute("loading")?.toLowerCase() === "lazy"
        && colorTools.visible(image)
        && rect.top < window.innerHeight
        && rect.bottom > 0;
    });
    const navLinks = [...document.querySelectorAll("nav a[href]")];
    const visibleNavLinks = navLinks.filter((link) => colorTools.visible(link));
    const visibleNavToggle = [...document.querySelectorAll('button[aria-controls],[role=button][aria-controls],[data-lodesta-menu-toggle]')]
      .some((control) => colorTools.visible(control));
    const escapedEntityExamples = [...new Set((document.body.innerText.match(/&(?:#\d+|#x[a-f0-9]+|[a-z][a-z0-9]+);/gi) ?? []).map((value) => value.slice(0, 40)))].slice(0, 3);
    return {
      horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
      headingOverflowCount: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((heading) => heading.scrollWidth - heading.clientWidth > 2).length,
      brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
      h1Count: document.querySelectorAll("h1").length,
      minBodyFontPx: fontSizes.length ? Math.min(...fontSizes) : 16,
      smallBodyTextExamples: smallBodyText.slice(0, 3).map(textExample),
      tinyVisibleTextCount: tinyVisibleText.length,
      tinyTextExamples: tinyVisibleText.slice(0, 3).map(textExample),
      lowContrastCount: lowContrast.length,
      lowContrastExamples: lowContrast.slice(0, 3).map(({ element, ratio, foreground, background }) => ({
        selector: colorTools.selectorFor(element),
        text: colorTools.textFor(element).slice(0, 80),
        foreground,
        background,
        ratio: Math.round(ratio * 100) / 100,
        requiredRatio: lowContrast.find((item) => item.element === element)?.requiredRatio ?? 4.5
      })),
      clippedManagedContentCount: clippedManagedContent.length,
      clippedManagedContentExamples: clippedManagedContent.slice(0, 3).map((element) =>
        colorTools.selectorFor(element) + " (client " + element.clientWidth + "×" + element.clientHeight + ", scroll " + element.scrollWidth + "×" + element.scrollHeight + ")"),
      emptyControlCount: emptyControls.length,
      emptyControlExamples: emptyControls.slice(0, 3).map((element) => colorTools.selectorFor(element)),
      imageAltQualityCount: imageAltQuality.length,
      imageAltQualityExamples: imageAltQuality.slice(0, 3).map((image) =>
        colorTools.selectorFor(image) + " alt=" + JSON.stringify((image.getAttribute("alt") ?? "").slice(0, 100))),
      lazyAboveFoldImageCount: lazyAboveFoldImages.length,
      lazyAboveFoldImageExamples: lazyAboveFoldImages.slice(0, 3).map((image) => colorTools.selectorFor(image)),
      missingMobileNavigation: navLinks.length >= 2 && visibleNavLinks.length === 0 && !visibleNavToggle,
      escapedEntityExamples,
      links: [...document.querySelectorAll("a[href]")].map((link) => link.getAttribute("href") ?? "")
    };
})()`;

async function inspectPage(page: Page): Promise<BrowserPageMetrics> {
  return await page.evaluate(browserInspectionSource) as BrowserPageMetrics;
}

async function verifyManagedFormSubmissions(page: Page, route: string) {
  const forms = page.locator("form[data-lodesta-form-id]");
  const findings: ArtifactGateFinding[] = [];
  for (let index = 0; index < await forms.count(); index += 1) {
    const form = forms.nth(index);
    const formId = await form.getAttribute("data-lodesta-form-id") ?? `form_${index + 1}`;
    try {
      for (const field of await form.locator("input:not([type=hidden]):not([type=submit]), textarea").all()) {
        const type = (await field.getAttribute("type") ?? "text").toLowerCase();
        await field.fill(type === "email" ? "browser-gate@example.com" : type === "tel" ? "5125550100" : "Browser gate verification");
      }
      for (const select of await form.locator("select").all()) {
        const options = await select.locator("option").all();
        const value = options.length > 1 ? await options[1].getAttribute("value") : options.length ? await options[0].getAttribute("value") : undefined;
        if (value !== undefined && value !== null) await select.selectOption(value);
      }
      await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
      const status = form.locator("[data-lodesta-form-status]");
      await status.waitFor({ state: "visible", timeout: 5_000 });
      await page.waitForFunction((id) => {
        const target = document.querySelector(`form[data-lodesta-form-id="${CSS.escape(String(id))}"] [data-lodesta-form-status]`);
        return Boolean(target?.textContent && target.textContent !== "Sending...");
      }, formId, { timeout: 5_000 });
      const message = (await status.textContent())?.trim() ?? "";
      if (!message || /could not send/i.test(message)) {
        findings.push(finding("capability.form_submit", `Managed form ${formId} did not complete the trusted-runtime submission path.`, route, "capability"));
      }
    } catch (error) {
      findings.push(finding("capability.form_submit", `Managed form ${formId} failed browser submission verification: ${error instanceof Error ? error.message : String(error)}`, route, "capability"));
    }
  }
  return findings;
}

type AccessibilityRuntimeContext = {
  attempt: 1 | 2;
  route: string;
  browserVersion: string;
  consoleErrors: string[];
};

const axeSourceHash = sha256(axeCore.source);

async function preloadAutomatedAccessibility(page: Page, context: AccessibilityRuntimeContext) {
  try {
    await page.addInitScript({ content: axeCore.source });
  } catch (error) {
    throw browserVerificationUnavailable("preload", context, undefined, error);
  }
}

async function inspectAutomatedAccessibility(page: Page, context: AccessibilityRuntimeContext) {
  const readiness = await page.evaluate(() => {
    const runtime = (globalThis as typeof globalThis & {
      axe?: { version?: unknown; run?: unknown };
    }).axe;
    return {
      detectedVersion: typeof runtime?.version === "string" ? runtime.version : undefined,
      runnable: typeof runtime?.run === "function"
    };
  });
  if (!readiness.runnable || readiness.detectedVersion !== axeCore.version) {
    throw browserVerificationUnavailable("readiness", context, readiness.detectedVersion);
  }
  const result = await page.evaluate(async () => {
    const runtime = (globalThis as typeof globalThis & {
      axe: { version: string; run: (context?: unknown, options?: unknown) => Promise<{
        violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }>;
      }> };
    }).axe;
    return {
      version: runtime.version,
      violations: (await runtime.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }
      })).violations
    };
  });
  const findings: ArtifactGateFinding[] = [
    finding("accessibility.axe.complete", `axe-core ${result.version} completed on the mobile route.`, context.route, "accessibility", "info")
  ];
  for (const violation of result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")) {
    findings.push(finding(
      `accessibility.axe.${violation.impact}.${violation.id}`,
      `${violation.help}: ${violation.nodes.length} node(s). Examples: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join("; ")}.`,
      context.route,
      "accessibility",
      "warning"
    ));
  }
  return findings;
}

function browserVerificationUnavailable(
  stage: BrowserVerificationUnavailableDetails["stage"],
  context: AccessibilityRuntimeContext,
  detectedVersion?: string,
  cause?: unknown
) {
  return new BrowserVerificationUnavailableError({
    component: "axe-core",
    stage,
    attempt: context.attempt,
    route: context.route,
    viewport: "mobile",
    browserVersion: context.browserVersion,
    expectedVersion: axeCore.version,
    detectedVersion,
    sourceHash: axeSourceHash,
    consoleErrors: context.consoleErrors.slice(-5).map((message) => message.slice(0, 500)),
    cause: cause instanceof Error ? cause.message.slice(0, 500) : cause === undefined ? undefined : String(cause).slice(0, 500)
  });
}

async function settleImages(page: Page) {
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = "eager";
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  });
  await page.waitForFunction(() => [...document.images].every((image) => image.complete), undefined, { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 0));
}

function validRenderedLink(href: string, route: string, routes: Set<string>) {
  if (href.startsWith("#") || /^tel:|^mailto:/i.test(href)) return true;
  if (/^https?:\/\//i.test(href)) {
    try { return ["http:", "https:"].includes(new URL(href).protocol); } catch { return false; }
  }
  try {
    const base = `https://site.invalid${route === "/" ? "/" : `${route}/`}`;
    return routes.has(normalizePath(new URL(href, base).pathname));
  } catch { return false; }
}

function normalizePath(value: string) {
  const path = `/${value.replace(/^\/+|\/+$/g, "")}`;
  return path === "/" ? path : path.replace(/\/$/, "");
}

function routeKey(route: string) {
  return route === "/" ? "home" : route.slice(1).replace(/[^a-z0-9]+/gi, "-");
}

function finding(
  id: string,
  message: string,
  route: string,
  area: ArtifactGateFinding["area"] = "render",
  severity: ArtifactGateFinding["severity"] = "error"
): ArtifactGateFinding {
  return { id, severity, area, message, route };
}

function transientBrowserInfrastructureError(error: unknown) {
  if (error instanceof BrowserVerificationUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (message === "workflow_deadline_exhausted") return false;
  return /browser.*(?:closed|disconnected|launch)|target.*closed|timeout|timed out|econnreset|econnrefused|socket hang up|harness did not bind/i.test(message);
}

function dedupe(findings: ArtifactGateFinding[]) {
  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.id}:${item.route}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function send(response: import("node:http").ServerResponse, status: number, body: Buffer, contentType: string) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function stopServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function readRequestBody(request: import("node:http").IncomingMessage) {
  return new Promise<void>((resolveBody, reject) => {
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 64 * 1024) request.destroy(new Error("Harness form payload exceeded 64 KiB."));
    });
    request.on("end", resolveBody);
    request.on("error", reject);
  });
}
