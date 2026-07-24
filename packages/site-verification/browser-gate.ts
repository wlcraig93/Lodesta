import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import axeCore from "axe-core";
import type { ArtifactBlobStore } from "@/packages/site-artifacts/blob-store";
import type { SitePublicBuildInput } from "@/packages/site-contracts";
import type { PreparedSiteArtifact } from "./finalizer";
import type { ArtifactGateFinding } from "./contracts";

export type BrowserGateCapture = {
  key: string;
  route: string;
  viewport: "desktop" | "tablet" | "mobile";
  bytes: Buffer;
};

export type FullBrowserGateResult = {
  findings: ArtifactGateFinding[];
  captures: BrowserGateCapture[];
  routesChecked: number;
  linksChecked: number;
};

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
    return await runArtifactBrowserGateOnce(input);
  } catch (error) {
    if (!transientBrowserInfrastructureError(error) || input.signal?.aborted) throw error;
    return runArtifactBrowserGateOnce(input);
  }
}

async function runArtifactBrowserGateOnce(input: {
  prepared: PreparedSiteArtifact;
  buildInput: SitePublicBuildInput;
  blobStore: ArtifactBlobStore;
  capturePrefix: string;
  signal?: AbortSignal;
}): Promise<FullBrowserGateResult> {
  const harness = await startHarness(input);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const findings: ArtifactGateFinding[] = [];
    const captures: BrowserGateCapture[] = [];
    let linksChecked = 0;
    for (const route of input.prepared.routes) {
      for (const viewport of viewports) {
        if (input.signal?.aborted) throw new Error("workflow_deadline_exhausted");
        const page = await browser.newPage({ viewport });
        const routeFindings: ArtifactGateFinding[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") routeFindings.push(finding("render.console", `Console error: ${message.text()}`, route.path));
        });
        page.on("pageerror", (error) => routeFindings.push(finding("render.page_error", `Page error: ${error.message}`, route.path)));
        page.on("request", (request) => {
          const requestUrl = new URL(request.url());
          if (requestUrl.origin !== harness.origin) {
            routeFindings.push(finding("render.network", `Final artifact attempted an external request to ${requestUrl.origin}.`, route.path));
          }
        });
        const response = await abortable(page.goto(`${harness.origin}${route.path === "/" ? "/" : `${route.path}/`}`, { waitUntil: "networkidle", timeout: 30_000 }), input.signal);
        if (!response?.ok()) routeFindings.push(finding("route.response", `Route returned ${response?.status() ?? "no response"}.`, route.path));
        await settleImages(page);
        const metrics = await inspectPage(page);
        if (viewport.name === "desktop") {
          routeFindings.push(...await verifyManagedFormSubmissions(page, route.path));
        }
        if (viewport.name === "mobile") {
          routeFindings.push(...await inspectAutomatedAccessibility(page, route.path));
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
            .map((example) => `${example.selector} "${example.text}" (${example.foreground} on ${example.background}, ${example.ratio}:1)`)
            .join("; ");
          routeFindings.push(finding(
            "render.contrast",
            `${metrics.lowContrastCount} visible text element(s) fail 4.5:1 contrast at ${viewport.name}. Examples: ${examples}.`,
            route.path,
            "accessibility",
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
        captures.push({ key, route: route.path, viewport: viewport.name, bytes: await page.screenshot({ fullPage: true, type: "png" }) });
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
  lowContrastExamples: Array<{ selector: string; text: string; foreground: string; background: string; ratio: number }>;
  escapedEntityExamples: string[];
  links: string[];
};

const browserInspectionSource = String.raw`(() => {
    const colorTools = {
      parse(value) {
        const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
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
        let current = element;
        let background = [255, 255, 255, 1];
        let backgroundValue = "rgb(255, 255, 255)";
        while (current) {
          const candidate = getComputedStyle(current).backgroundColor;
          const parsed = colorTools.parse(candidate);
          if (parsed[3] > 0.98) { background = parsed; backgroundValue = candidate; break; }
          current = current.parentElement;
        }
        return {
          ratio: colorTools.contrast(foreground, background),
          foreground: foregroundValue,
          background: backgroundValue
        };
      },
      selectorFor(element) {
        if (element.id) return element.tagName.toLowerCase() + "#" + CSS.escape(element.id);
        const classes = [...element.classList].slice(0, 2).map((name) => "." + CSS.escape(name)).join("");
        return element.tagName.toLowerCase() + classes;
      }
    };
    const root = document.documentElement;
    const elements = [...document.querySelectorAll("body *")];
    const visibleText = elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const hasOwnText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0);
      const hasControlText = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
      return (hasOwnText || hasControlText) && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    });
    const bodyText = visibleText.filter((element) => ["P", "LI", "DD", "DT", "LABEL", "BLOCKQUOTE"].includes(element.tagName));
    const fontSizes = bodyText.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
    const textExample = (element) => ({
      selector: colorTools.selectorFor(element),
      text: (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value || element.placeholder
        : element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
      fontSizePx: Math.round(Number.parseFloat(getComputedStyle(element).fontSize) * 100) / 100
    });
    const smallBodyText = bodyText.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16);
    const tinyVisibleText = visibleText.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12);
    const lowContrast = visibleText.map((element) => ({ element, ...colorTools.contrastFor(element) })).filter((item) => item.ratio < 4.5);
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
        text: (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value || element.placeholder
          : element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
        foreground,
        background,
        ratio: Math.round(ratio * 100) / 100
      })),
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

async function inspectAutomatedAccessibility(page: Page, route: string) {
  await page.addScriptTag({ content: axeCore.source });
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
    finding("accessibility.axe.complete", `axe-core ${result.version} completed on the mobile route.`, route, "accessibility", "info")
  ];
  for (const violation of result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")) {
    findings.push(finding(
      `accessibility.axe.${violation.impact}.${violation.id}`,
      `${violation.help}: ${violation.nodes.length} node(s). Examples: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join("; ")}.`,
      route,
      "accessibility",
      "warning"
    ));
  }
  return findings;
}

async function settleImages(page: Page) {
  await page.evaluate(() => {
    for (const image of document.images) image.loading = "eager";
    window.scrollTo(0, document.documentElement.scrollHeight);
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
