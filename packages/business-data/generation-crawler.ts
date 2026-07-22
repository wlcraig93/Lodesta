import { z } from "zod";
import { summarizeCrawlHtml, type CrawlAssessment, type CrawlPageSummary, type ExtractedBusinessFacts } from "@/lib/crawler";
import { assertPublicFetchUrl } from "@/lib/url-safety";
import type { SourceTextBlock } from "@/lib/source-text-blocks";

export const generationIngestionLimits = {
  inventoryUrls: 1_000,
  selectedPages: 50,
  totalMs: 8 * 60_000,
  concurrentPerOrigin: 2,
  minimumStartSpacingMs: 500,
  requestTimeoutMs: 10_000,
  maximumHtmlBytes: 2 * 1024 * 1024,
  transientRetries: 1,
  browserFallbackPages: 8,
  modelTextCharacters: 120_000
} as const;
type GenerationIngestionLimitValues = { [Key in keyof typeof generationIngestionLimits]: number };

const skipReasonSchema = z.enum([
  "duplicate",
  "non_meaningful",
  "robots_disallowed",
  "inventory_limit",
  "selection_limit",
  "deadline",
  "unsupported_content",
  "response_too_large",
  "browser_limit"
]);
const failureReasonSchema = z.enum(["timeout", "network", "http", "response_too_large", "unsupported_content", "browser_failed"]);
const evidenceClassSchema = z.enum(["first_party", "third_party", "unknown"]);

export const websiteGenerationIngestionV2Schema = z.object({
  schemaVersion: z.literal("website-ingestion-v2"),
  sourceUrl: z.string().url(),
  coverage: z.enum(["complete", "bounded", "restricted", "incomplete"]),
  limits: z.object({
    inventoryUrls: z.number().int().positive(),
    selectedPages: z.number().int().positive(),
    totalMs: z.number().int().positive(),
    concurrentPerOrigin: z.number().int().positive(),
    minimumStartSpacingMs: z.number().int().nonnegative(),
    requestTimeoutMs: z.number().int().positive(),
    maximumHtmlBytes: z.number().int().positive(),
    transientRetries: z.number().int().nonnegative(),
    browserFallbackPages: z.number().int().nonnegative(),
    modelTextCharacters: z.number().int().positive()
  }).strict(),
  counts: z.object({
    discovered: z.number().int().nonnegative(),
    selected: z.number().int().nonnegative(),
    fetched: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    browserRendered: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    modelTextCharacters: z.number().int().nonnegative()
  }).strict(),
  pages: z.array(z.object({
    url: z.string().url(),
    selectedReason: z.string().min(1).max(120),
    fetchAttempts: z.number().int().positive(),
    browserRendered: z.boolean(),
    evidenceClass: evidenceClassSchema,
    summary: z.unknown()
  }).strict()).max(generationIngestionLimits.selectedPages),
  modelBlocks: z.array(z.object({
    id: z.string().min(1),
    sourceUrl: z.string().url(),
    displayText: z.string().min(1),
    canonicalTokens: z.array(z.object({ value: z.string(), displayStart: z.number().int().nonnegative(), displayEnd: z.number().int().positive() }).strict()),
    evidenceClass: evidenceClassSchema
  }).strict()),
  skipped: z.array(z.object({ url: z.string().url(), reason: skipReasonSchema }).strict()),
  failures: z.array(z.object({ url: z.string().url(), reason: failureReasonSchema, status: z.number().int().optional(), message: z.string().max(1000) }).strict()),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  elapsedMs: z.number().int().nonnegative()
}).strict();

export type WebsiteGenerationIngestionV2 = z.infer<typeof websiteGenerationIngestionV2Schema>;
export type EvidenceClass = z.infer<typeof evidenceClassSchema>;

type FetchLike = typeof fetch;
type BrowserFetch = (url: string, signal: AbortSignal) => Promise<string>;
type UrlValidator = (url: string) => Promise<string>;

export async function crawlWebsiteForGeneration(input: {
  url: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  browserFetch?: BrowserFetch;
  now?: () => number;
  limits?: Partial<GenerationIngestionLimitValues>;
  validateUrl?: (url: string) => Promise<string>;
}): Promise<{ ingestion: WebsiteGenerationIngestionV2; crawl: CrawlAssessment }> {
  const baseValidator = input.validateUrl ?? assertPublicFetchUrl;
  const sourceUrl = await baseValidator(input.url);
  const source = new URL(sourceUrl);
  const validateSameSite: UrlValidator = async (value) => {
    const validated = await baseValidator(value);
    if (!sameSite(new URL(validated).hostname, source.hostname)) throw new Error("generation_crawl_cross_site_url");
    return validated;
  };
  const limits = { ...generationIngestionLimits, ...input.limits };
  const now = input.now ?? Date.now;
  const started = now();
  const startedAt = new Date(started).toISOString();
  const deadline = AbortSignal.timeout(limits.totalMs);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  const fetchImpl = input.fetchImpl ?? fetch;
  const browserFetch = input.browserFetch
    ?? ((url: string, browserSignal: AbortSignal) => fetchGenerationPageWithBrowser(url, browserSignal, limits.requestTimeoutMs, baseValidator, validateSameSite));
  const scheduler = new OriginScheduler(limits.minimumStartSpacingMs, now);
  const inventory = new Map<string, { url: string; reason: string; score: number }>();
  const skipped: Array<{ url: string; reason: z.infer<typeof skipReasonSchema> }> = [];
  const failures: Array<{ url: string; reason: z.infer<typeof failureReasonSchema>; status?: number; message: string }> = [];
  const pages = new Map<string, { summary: CrawlPageSummary; selectedReason: string; fetchAttempts: number; browserRendered: boolean; evidenceClass: EvidenceClass }>();
  let inventoryTruncated = false;
  let restricted = false;
  let deadlineReached = false;
  let browserRendered = 0;
  let browserFallbackAttempts = 0;

  const robots = await readRobots(source, fetchImpl, scheduler, signal, limits, validateSameSite).catch(() => ({ disallowed: [] as string[], sitemaps: [] as string[] }));
  const addInventory = (candidate: string, reason: string) => {
    const normalized = normalizeSameSite(candidate, source);
    if (!normalized) return;
    if (inventory.has(normalized)) return;
    if (!meaningfulUrl(normalized)) {
      skipped.push({ url: normalized, reason: "non_meaningful" });
      return;
    }
    if (robotsDisallow(normalized, robots.disallowed)) {
      restricted = true;
      skipped.push({ url: normalized, reason: "robots_disallowed" });
      return;
    }
    if (inventory.size >= limits.inventoryUrls) {
      inventoryTruncated = true;
      skipped.push({ url: normalized, reason: "inventory_limit" });
      return;
    }
    inventory.set(normalized, { url: normalized, reason, score: businessPriority(normalized) });
  };

  addInventory(source.href, "source_home");
  const sitemapQueue = unique([...robots.sitemaps, new URL("/sitemap.xml", source).href]);
  for (let sitemapIndex = 0; sitemapIndex < sitemapQueue.length && sitemapIndex < 12; sitemapIndex += 1) {
    const sitemapUrl = normalizeSameSite(sitemapQueue[sitemapIndex], source);
    if (!sitemapUrl) continue;
    if (signal.aborted) { deadlineReached = true; break; }
    const sitemap = await fetchHtml(sitemapUrl, fetchImpl, scheduler, signal, limits, ["application/xml", "text/xml", "text/plain"], validateSameSite);
    if (!sitemap.ok) continue;
    for (const candidate of sitemapLocations(sitemap.text)) {
      if (/\.xml(?:\.gz)?(?:$|\?)/i.test(candidate)) {
        if (sitemapQueue.length < 12 && !sitemapQueue.includes(candidate)) sitemapQueue.push(candidate);
      } else {
        addInventory(candidate, "sitemap");
      }
    }
  }

  const queue = prioritized([...inventory.values()]).slice(0, limits.selectedPages);
  const queued = new Set(queue.map((item) => item.url));
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length && !signal.aborted) {
      const item = queue[cursor++];
      const fetched = await fetchHtml(item.url, fetchImpl, scheduler, signal, limits, ["text/html", "application/xhtml+xml"], validateSameSite);
      if (!fetched.ok) {
        if (fetched.status === 401 || fetched.status === 403) restricted = true;
        failures.push({ url: item.url, reason: fetched.reason, status: fetched.status, message: fetched.message });
        continue;
      }
      let html = fetched.text;
      let summary = summarizeCrawlHtml(html, fetched.finalUrl ?? item.url);
      let usedBrowser = false;
      if (shouldBrowserRender(summary) && browserFallbackAttempts < limits.browserFallbackPages) {
        // Reserve the bounded fallback slot before awaiting so concurrent workers
        // cannot both observe the same remaining allowance.
        browserFallbackAttempts += 1;
        try {
          html = await browserFetch(item.url, signal);
          if (Buffer.byteLength(html) > limits.maximumHtmlBytes) throw new Error("browser_response_too_large");
          summary = summarizeCrawlHtml(html, item.url);
          browserRendered += 1;
          usedBrowser = true;
        } catch (error) {
          failures.push({ url: item.url, reason: "browser_failed", message: boundedMessage(error) });
        }
      } else if (shouldBrowserRender(summary) && browserFallbackAttempts >= limits.browserFallbackPages) {
        skipped.push({ url: item.url, reason: "browser_limit" });
      }
      if (item.url !== source.href) summary = { ...summary, source: "sampled_internal" };
      const evidenceClass = classifyPageEvidence(summary);
      pages.set(item.url, { summary, selectedReason: item.reason, fetchAttempts: fetched.attempts, browserRendered: usedBrowser, evidenceClass });
      for (const link of summary.linkReferences.filter((link) => link.kind === "internal")) {
        addInventory(link.href, "linked_page");
        const discovered = inventory.get(normalizeSameSite(link.href, source) ?? "");
        if (discovered && inventory.size <= limits.selectedPages && !queued.has(discovered.url)) {
          queued.add(discovered.url);
          queue.push(discovered);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: limits.concurrentPerOrigin }, () => worker()));
  if (signal.aborted) {
    deadlineReached = true;
    const failedUrls = new Set(failures.map((failure) => failure.url));
    for (const item of queue) {
      if (!pages.has(item.url) && !failedUrls.has(item.url)) skipped.push({ url: item.url, reason: "deadline" });
    }
  }

  const selectedUrls = new Set(queue.map((item) => item.url));
  for (const item of inventory.values()) if (!selectedUrls.has(item.url)) skipped.push({ url: item.url, reason: "selection_limit" });
  const modelBlocks = boundedModelBlocks([...pages.values()].flatMap((page) => page.summary.sourceTextBlocks.map((block) => ({ ...block, evidenceClass: page.evidenceClass }))), limits.modelTextCharacters);
  const summaries = [...pages.values()].map((page) => page.summary);
  const primary = summaries.find((summary) => normalizeSameSite(summary.url, source) === normalizeSameSite(source.href, source)) ?? summaries[0];
  const completed = now();
  const coverage = !primary || deadlineReached || pages.size < selectedUrls.size
    ? "incomplete"
    : restricted
      ? "restricted"
      : inventoryTruncated || inventory.size > limits.selectedPages || skipped.some((entry) => entry.reason === "selection_limit" || entry.reason === "browser_limit")
        ? "bounded"
        : "complete";
  const ingestion = websiteGenerationIngestionV2Schema.parse({
    schemaVersion: "website-ingestion-v2",
    sourceUrl,
    coverage,
    limits,
    counts: {
      discovered: inventory.size,
      selected: selectedUrls.size,
      fetched: pages.size,
      failed: failures.length,
      browserRendered,
      skipped: skipped.length,
      modelTextCharacters: modelBlocks.reduce((total, block) => total + block.displayText.length, 0)
    },
    pages: [...pages.entries()].map(([url, page]) => ({ url, selectedReason: page.selectedReason, fetchAttempts: page.fetchAttempts, browserRendered: page.browserRendered, evidenceClass: page.evidenceClass, summary: page.summary })),
    modelBlocks,
    skipped,
    failures,
    startedAt,
    completedAt: new Date(completed).toISOString(),
    elapsedMs: Math.max(0, completed - started)
  });
  return { ingestion, crawl: assessmentFromPages(sourceUrl, summaries, ingestion) };
}

class OriginScheduler {
  private nextStart = 0;
  private startLock: Promise<void> = Promise.resolve();
  constructor(private readonly spacingMs: number, private readonly now: () => number) {}
  async schedule<T>(operation: () => Promise<T>) {
    const prior = this.startLock;
    let release: () => void = () => {};
    this.startLock = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    const wait = Math.max(0, this.nextStart - this.now());
    if (wait) await delay(wait);
    this.nextStart = this.now() + this.spacingMs;
    release();
    return operation();
  }
}

async function fetchHtml(url: string, fetchImpl: FetchLike, scheduler: OriginScheduler, signal: AbortSignal, limits: GenerationIngestionLimitValues, acceptedTypes: string[], validateUrl: UrlValidator) {
  let last: { ok: false; reason: z.infer<typeof failureReasonSchema>; status?: number; message: string } = { ok: false, reason: "network", message: "request_failed" };
  for (let attempt = 1; attempt <= limits.transientRetries + 1; attempt += 1) {
    try {
      const fetched = await fetchFollowingSafeRedirects(url, fetchImpl, scheduler, signal, limits, acceptedTypes, validateUrl);
      const { response } = fetched;
      if (!response.ok) {
        last = { ok: false, reason: "http", status: response.status, message: `HTTP ${response.status}` };
        if (!transientStatus(response.status) || attempt > limits.transientRetries) return { ...last, attempts: attempt } as const;
        continue;
      }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType && !acceptedTypes.some((type) => contentType.includes(type))) {
        return { ok: false, reason: "unsupported_content", status: response.status, message: contentType, attempts: attempt } as const;
      }
      const text = await responseTextWithin(response, limits.maximumHtmlBytes);
      return { ok: true, text, attempts: attempt, finalUrl: fetched.finalUrl } as const;
    } catch (error) {
      const message = boundedMessage(error);
      const reason = /too_large/i.test(message) ? "response_too_large" as const : /abort|timeout/i.test(message) ? "timeout" as const : "network" as const;
      last = { ok: false, reason, message };
      if (attempt > limits.transientRetries || reason === "response_too_large" || signal.aborted) return { ...last, attempts: attempt } as const;
    }
  }
  return { ...last, attempts: limits.transientRetries + 1 } as const;
}

async function fetchFollowingSafeRedirects(url: string, fetchImpl: FetchLike, scheduler: OriginScheduler, signal: AbortSignal, limits: GenerationIngestionLimitValues, acceptedTypes: string[], validateUrl: UrlValidator) {
  let current = await validateUrl(url);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await scheduler.schedule(() => fetchImpl(current, {
      redirect: "manual",
      headers: { accept: `${acceptedTypes.join(", ")};q=0.9, */*;q=0.1`, "user-agent": "LodestaGenerationCrawler/2.0 (+https://lodesta.com)" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(limits.requestTimeoutMs)])
    }));
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: response.url || current };
    const location = response.headers.get("location");
    if (!location) throw new Error("redirect_missing_location");
    if (redirectCount === 5) throw new Error("redirect_limit_exhausted");
    current = await validateUrl(new URL(location, current).href);
  }
  throw new Error("redirect_limit_exhausted");
}

async function responseTextWithin(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString("utf8");
      bytes += value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel("response_too_large"); throw new Error("response_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

async function readRobots(source: URL, fetchImpl: FetchLike, scheduler: OriginScheduler, signal: AbortSignal, limits: GenerationIngestionLimitValues, validateUrl: UrlValidator) {
  const response = await fetchHtml(new URL("/robots.txt", source).href, fetchImpl, scheduler, signal, limits, ["text/plain"], validateUrl);
  if (!response.ok) return { disallowed: [] as string[], sitemaps: [] as string[] };
  const disallowed: string[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  for (const raw of response.text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (field?.toLowerCase() === "user-agent") applies = value === "*" || /lodesta/i.test(value);
    else if (applies && field?.toLowerCase() === "disallow" && value) disallowed.push(value);
    else if (field?.toLowerCase() === "sitemap" && value) sitemaps.push(value);
  }
  return { disallowed, sitemaps };
}

function assessmentFromPages(sourceUrl: string, pages: CrawlPageSummary[], ingestion: WebsiteGenerationIngestionV2): CrawlAssessment {
  const source = new URL(sourceUrl);
  const primary = pages.find((page) => normalizeSameSite(page.url, source) === normalizeSameSite(sourceUrl, source)) ?? pages[0];
  const orderedPages = primary ? [primary, ...pages.filter((page) => page !== primary)] : pages;
  const facts = orderedPages.reduce((combined, page) => mergeExtractedFacts(combined, page.extractedFacts), emptyFacts());
  return {
    url: sourceUrl,
    fetched: Boolean(primary),
    status: primary ? 200 : undefined,
    finalUrl: primary?.url,
    title: primary?.title,
    metaDescription: primary?.metaDescription,
    canonical: primary?.canonical,
    hasViewportMeta: orderedPages.some((page) => page.hasViewportMeta),
    hasLocalBusinessSchema: orderedPages.some((page) => page.hasLocalBusinessSchema),
    hasTelLink: orderedPages.some((page) => page.hasTelLink),
    robotsFound: true,
    sitemapFound: ingestion.pages.some((page) => page.selectedReason === "sitemap"),
    formCount: orderedPages.reduce((total, page) => total + page.formCount, 0),
    imageCount: orderedPages.reduce((total, page) => total + page.imageCount, 0),
    imagesWithoutAlt: orderedPages.reduce((total, page) => total + page.imagesWithoutAlt, 0),
    internalLinkCount: orderedPages.reduce((total, page) => total + page.internalLinkCount, 0),
    externalLinkCount: orderedPages.reduce((total, page) => total + page.externalLinkCount, 0),
    jsonLdTypes: unique(orderedPages.flatMap((page) => page.jsonLdTypes)),
    extractedFacts: facts,
    formReferences: orderedPages.flatMap((page) => page.formReferences).slice(0, 100),
    linkReferences: orderedPages.flatMap((page) => page.linkReferences).slice(0, 500),
    assetReferences: orderedPages.flatMap((page) => page.assetReferences).slice(0, 100),
    sampledInternalPages: orderedPages.slice(1).map((page) => page.url),
    pageSummaries: orderedPages,
    score: { overall: 0, max: 0, percent: 0, grade: "needs_work", checks: [] },
    findings: ingestion.coverage === "complete" ? [] : [`Generation crawl coverage: ${ingestion.coverage}.`],
    error: ingestion.coverage === "incomplete" ? "Generation crawl did not retain a usable primary page." : undefined
  };
}

function boundedModelBlocks(blocks: Array<SourceTextBlock & { evidenceClass: EvidenceClass }>, maximumCharacters: number) {
  const output: Array<{ id: string; sourceUrl: string; displayText: string; canonicalTokens: SourceTextBlock["canonicalTokens"]; evidenceClass: EvidenceClass }> = [];
  let characters = 0;
  for (const block of blocks) {
    if (characters >= maximumCharacters) break;
    const displayText = block.displayText.slice(0, maximumCharacters - characters);
    if (!displayText) break;
    output.push({
      id: block.id,
      sourceUrl: block.sourceUrl,
      displayText,
      canonicalTokens: block.canonicalTokens.filter((token) => token.displayEnd <= displayText.length),
      evidenceClass: block.evidenceClass
    });
    characters += displayText.length;
  }
  return output;
}

function classifyPageEvidence(page: CrawlPageSummary): EvidenceClass {
  if (page.purposeTags.includes("reviews")) return "third_party";
  if (page.purposeTags.includes("blog") && /guest|sponsored|press release/i.test(`${page.title ?? ""} ${page.metaDescription ?? ""}`)) return "unknown";
  return "first_party";
}

function shouldBrowserRender(summary: CrawlPageSummary) {
  const text = summary.sourceTextBlocks.reduce((total, block) => total + block.displayText.length, 0);
  return text < 200 && (summary.internalLinkCount > 0 || summary.imageCount > 0 || summary.title !== undefined);
}

export async function fetchGenerationPageWithBrowser(url: string, signal: AbortSignal, requestTimeoutMs: number, validateUrl: UrlValidator, validateNavigation: UrlValidator) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      try {
        const validator = route.request().isNavigationRequest() ? validateNavigation : validateUrl;
        await validator(route.request().url());
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const closeOnAbort = () => { void page.close(); };
    signal.addEventListener("abort", closeOnAbort, { once: true });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: requestTimeoutMs });
      await validateNavigation(page.url());
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
    }
    if (signal.aborted) throw signal.reason;
    // Await inside the try so the outer finally cannot close Chromium while
    // Playwright is still serializing the document.
    return await page.content();
  } finally { await browser.close(); }
}

function mergeExtractedFacts(left: ExtractedBusinessFacts, right: ExtractedBusinessFacts): ExtractedBusinessFacts {
  return {
    ...left,
    name: left.name ?? right.name,
    description: left.description ?? right.description,
    phone: left.phone ?? right.phone,
    email: left.email ?? right.email,
    address: left.address ?? right.address,
    geo: left.geo ?? right.geo,
    hours: left.hours ?? right.hours,
    reviewsSummary: left.reviewsSummary ?? right.reviewsSummary,
    categories: unique([...left.categories, ...right.categories]),
    services: unique([...left.services, ...right.services]),
    serviceHighlights: unique([...(left.serviceHighlights ?? []), ...(right.serviceHighlights ?? [])]),
    serviceAreas: unique([...left.serviceAreas, ...right.serviceAreas]),
    socialLinks: unique([...left.socialLinks, ...right.socialLinks]),
    bookingLinks: unique([...left.bookingLinks, ...right.bookingLinks]),
    orderingLinks: unique([...left.orderingLinks, ...right.orderingLinks]),
    pressLinks: unique([...left.pressLinks, ...right.pressLinks])
  };
}

function emptyFacts(): ExtractedBusinessFacts { return { categories: [], services: [], serviceAreas: [], socialLinks: [], bookingLinks: [], orderingLinks: [], pressLinks: [] }; }
function sitemapLocations(xml: string) { return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) => decodeXml(match[1].trim())); }
function decodeXml(value: string) { return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'"); }
function robotsDisallow(url: string, rules: string[]) { const path = new URL(url).pathname; return rules.some((rule) => rule === "/" || (rule && path.startsWith(rule.replace(/\*.*$/, "")))); }
function normalizeSameSite(value: string, source: URL) { try { const url = new URL(value, source); if (!sameSite(url.hostname, source.hostname) || !["http:", "https:"].includes(url.protocol)) return undefined; url.hash = ""; url.search = ""; url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/"; return url.href; } catch { return undefined; } }
function sameSite(left: string, right: string) { const clean = (value: string) => value.toLowerCase().replace(/^www\./, ""); return clean(left) === clean(right); }
function meaningfulUrl(value: string) { const path = new URL(value).pathname.toLowerCase(); return !/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|xml|json|css|js|ico|woff2?)$/.test(path) && !/(?:^|\/)(?:wp-admin|wp-json|feed|tag|author|cart|checkout|login)(?:\/|$)/.test(path); }
function businessPriority(value: string) { const path = new URL(value).pathname.toLowerCase(); if (path === "/") return 1_000; if (/contact|book|estimate|quote|appointment/.test(path)) return 900; if (/services?|repairs?|treatments?|solutions?/.test(path)) return 850; if (/about|team|location|areas?/.test(path)) return 700; if (/gallery|portfolio|projects?|faq/.test(path)) return 600; if (/reviews?|testimonials?/.test(path)) return 300; if (/blog|news|privacy|terms/.test(path)) return 100; return 500 - Math.min(200, path.split("/").length * 20); }
function prioritized<T extends { score: number; url: string }>(values: T[]) { return values.sort((left, right) => right.score - left.score || left.url.localeCompare(right.url)); }
function transientStatus(status: number) { return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500; }
function boundedMessage(error: unknown) { const message = error instanceof Error ? error.message : String(error); return message.slice(0, 1000); }
function unique<T>(values: T[]) { return [...new Set(values)]; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
