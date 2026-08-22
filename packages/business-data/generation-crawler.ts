import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  canonicalFromLinkHeader,
  summarizeCrawlHtml,
  type CrawlAssessment,
  type CrawlPageSummary,
  type ExtractedBusinessFacts
} from "@/lib/crawler";
import { assertPublicFetchUrl, PublicFetchUrlError } from "@/lib/url-safety";
import { WebsiteCrawlError, type WebsiteCrawlFailureCode } from "./crawl-errors";
import {
  generationCrawlerUserAgent,
  parseRobotsPolicy,
  robotsAllows,
  type RobotsRule
} from "./robots-policy";

export const generationIngestionLimits = {
  concurrentPerOrigin: 8,
  minimumStartSpacingMs: 0,
  requestTimeoutMs: 10_000,
  maximumResponseBytes: 32 * 1024 * 1024,
  transientRetries: 2,
  rawResponseFuseBytes: 1024 * 1024 * 1024
} as const;
type GenerationIngestionLimitValues = { [Key in keyof typeof generationIngestionLimits]: number };

const skipReasonSchema = z.enum([
  "robots_disallowed",
  "unsupported_content",
  "unsafe_url"
]);
const failureReasonSchema = z.enum([
  "timeout",
  "network",
  "authentication_required",
  "access_denied",
  "bot_challenge",
  "rate_limited",
  "temporary_upstream_failure",
  "http_error",
  "unsafe_url",
  "response_too_large",
  "unsupported_content",
  "browser_failed"
]);
const evidenceClassSchema = z.enum(["first_party", "third_party", "unknown"]);

export const websiteGenerationIngestionSchema = z.object({
  schemaVersion: z.literal(1),
  sourceUrl: z.string().url(),
  coverage: z.enum(["complete", "restricted", "incomplete"]),
  completionReason: z.enum(["queue_exhausted", "restricted", "deadline", "capture_size_fuse", "cancelled", "failures"]),
  limits: z.object({
    concurrentPerOrigin: z.number().int().positive(),
    minimumStartSpacingMs: z.number().int().nonnegative(),
    requestTimeoutMs: z.number().int().positive(),
    maximumResponseBytes: z.number().int().positive(),
    transientRetries: z.number().int().nonnegative(),
    rawResponseFuseBytes: z.number().int().positive()
  }).strict(),
  counts: z.object({
    discovered: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    fetched: z.number().int().nonnegative(),
    excluded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unfinished: z.number().int().nonnegative(),
    browserRendered: z.number().int().nonnegative(),
    rawBytes: z.number().int().nonnegative()
  }).strict(),
  pages: z.array(z.object({
    url: z.string().url(),
    finalUrl: z.string().url(),
    discoveryReason: z.string().min(1).max(120),
    sitemapUrl: z.string().url().optional(),
    sitemapLastModified: z.string().optional(),
    fetchAttempts: z.number().int().nonnegative(),
    browserRendered: z.boolean(),
    evidenceClass: evidenceClassSchema,
    outcome: z.enum(["fetched", "excluded", "failed", "unfinished"]),
    status: z.number().int().optional(),
    reason: z.string().max(160).optional(),
    contentType: z.string().max(200).optional(),
    canonical: z.string().url().optional(),
    indexability: z.enum(["indexable", "noindex", "unknown"]),
    title: z.string().max(500).optional(),
    headings: z.array(z.string().max(500)),
    wordCount: z.number().int().nonnegative(),
    internalLinks: z.array(z.string().url()),
    externalLinks: z.array(z.string().url()),
    rawCaptureKey: z.string().optional(),
    renderedCaptureKey: z.string().optional(),
    summary: z.unknown()
  }).strict()),
  skipped: z.array(z.object({ url: z.string().url(), reason: skipReasonSchema }).strict()),
  failures: z.array(z.object({ url: z.string().url(), reason: failureReasonSchema, status: z.number().int().optional(), message: z.string().max(1000) }).strict()),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  elapsedMs: z.number().int().nonnegative()
}).strict();

export type WebsiteGenerationIngestion = z.infer<typeof websiteGenerationIngestionSchema>;
type WebsiteGenerationIngestionPage = WebsiteGenerationIngestion["pages"][number];
export type EvidenceClass = z.infer<typeof evidenceClassSchema>;
export type GenerationResourceRole = "robots" | "sitemap" | "document" | "rendered_document" | "stylesheet" | "script" | "image" | "font" | "data" | "other";
export type GenerationCrawlCapture = {
  key: string;
  captureKind: "http_response" | "rendered_dom";
  role: GenerationResourceRole;
  requestedUrl: string;
  finalUrl?: string;
  outcome: "fetched" | "excluded" | "failed" | "unfinished";
  reason?: string;
  status?: number;
  contentType?: string;
  bytes?: Buffer;
  redirectChain: Array<{ url: string; status: number; location: string }>;
  headers: Record<string, string>;
  initiatorUrls: string[];
  metadata?: Record<string, unknown>;
};
export type GenerationCrawlDocument = {
  url: string;
  finalUrl: string;
  html: string;
  extractedText: string;
  summary: CrawlPageSummary;
};
export type GenerationCrawlTechnicalEvidence = {
  robots: {
    url: string;
    found: boolean;
    body?: string;
  };
  homepage?: {
    url: string;
    finalUrl: string;
    status: number;
    contentType?: string;
    linkHeader?: string;
    body: string;
  };
};

type FetchLike = typeof fetch;
type BrowserFetch = (url: string, signal: AbortSignal) => Promise<string | {
  html: string;
  captures: Array<Omit<GenerationCrawlCapture, "key">>;
}>;
type UrlValidator = (url: string) => Promise<string>;
type GenerationFetchFailureReason = z.infer<typeof failureReasonSchema>;
type GenerationFetchAttempt = {
  attempt: number;
  status?: number;
  reason: GenerationFetchFailureReason | "success";
  waitMs: number;
  originConcurrency: number;
};
type GenerationFetchDiagnostics = {
  attemptHistory: GenerationFetchAttempt[];
  retryWaitMs: number;
  throttleEvents: number;
  accessClassification?: "authentication_required" | "access_denied" | "bot_challenge";
};
type GenerationFetchFailure = {
  ok: false;
  reason: GenerationFetchFailureReason;
  status?: number;
  contentType?: string;
  message: string;
  attempts: number;
  downloadedBytes?: number;
  bytes?: Buffer;
  finalUrl?: string;
  redirectChain?: Array<{ url: string; status: number; location: string }>;
  headers?: Record<string, string>;
} & GenerationFetchDiagnostics;
type GenerationFetchSuccess = {
  ok: true;
  text: string;
  bytes: Buffer;
  attempts: number;
  finalUrl: string;
  status: number;
  contentType: string;
  linkHeader?: string;
  redirectChain: Array<{ url: string; status: number; location: string }>;
  headers: Record<string, string>;
} & GenerationFetchDiagnostics;
type GenerationFetchResult = GenerationFetchFailure | GenerationFetchSuccess;

class ResponseTooLargeError extends Error {
  constructor(readonly downloadedBytes: number) {
    super("response_too_large");
  }
}

export async function crawlWebsiteForGeneration(input: {
  url: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  browserFetch?: BrowserFetch;
  now?: () => number;
  limits?: Partial<GenerationIngestionLimitValues>;
  validateUrl?: (url: string) => Promise<string>;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}): Promise<{
  ingestion: WebsiteGenerationIngestion;
  crawl: CrawlAssessment;
  technicalEvidence: GenerationCrawlTechnicalEvidence;
  captures: GenerationCrawlCapture[];
  documents: GenerationCrawlDocument[];
  timings: {
    discoveryMs: number;
    documentFetchMs: number;
    dependencyFetchMs: number;
    browserFallbackMs: number;
  };
}> {
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
  const fuseController = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, fuseController.signal]) : fuseController.signal;
  const fetchImpl = input.fetchImpl ?? fetch;
  const browserPool = input.browserFetch ? undefined : createGenerationBrowserPool({
    requestTimeoutMs: limits.requestTimeoutMs,
    validateUrl: baseValidator,
    validateNavigation: validateSameSite,
    maximumResponseBytes: limits.maximumResponseBytes,
    maximumConcurrency: 2
  });
  const browserFetch = input.browserFetch
    ?? browserPool!.fetch;
  try {
  const scheduler = new OriginScheduler(
    limits.minimumStartSpacingMs,
    limits.concurrentPerOrigin,
    now,
    input.sleep ?? abortableDelay,
    input.random ?? Math.random
  );
  const inventory = new Map<string, { url: string; reason: string; sitemapUrl?: string; sitemapLastModified?: string }>();
  const skipped: Array<{ url: string; reason: z.infer<typeof skipReasonSchema> }> = [];
  const failures: Array<{ url: string; reason: z.infer<typeof failureReasonSchema>; status?: number; message: string }> = [];
  const pageRecords = new Map<string, WebsiteGenerationIngestionPage>();
  const summaries = new Map<string, CrawlPageSummary>();
  const documents: GenerationCrawlDocument[] = [];
  const captures: GenerationCrawlCapture[] = [];
  let homepageTechnicalEvidence: GenerationCrawlTechnicalEvidence["homepage"];
  let restricted = false;
  let interrupted = false;
  let fuseReached = false;
  let auxiliaryFailure = false;
  let browserRendered = 0;
  let rawBytes = 0;
  let browserFallbackMs = 0;

  const retainCapture = (capture: Omit<GenerationCrawlCapture, "key">) => {
    const downloadedBytes = capture.bytes?.length
      ?? (typeof capture.metadata?.downloadedBytes === "number" ? Math.max(0, capture.metadata.downloadedBytes) : 0);
    rawBytes += downloadedBytes;
    const key = `capture_${capture.role}_${capture.requestedUrl}_${captures.length + 1}`;
    captures.push({ ...capture, key });
    if (rawBytes > limits.rawResponseFuseBytes) {
      fuseReached = true;
      fuseController.abort(new Error("generation_crawl_capture_size_fuse"));
    }
    return key;
  };

  const robots = await readRobots(source, fetchImpl, scheduler, signal, limits, validateSameSite);
  if ("capture" in robots && robots.capture) retainCapture(robots.capture);
  const addInventory = (candidate: string, reason: string, sitemap?: { url: string; lastModified?: string }) => {
    const normalized = normalizeSameSite(candidate, source);
    const robotsCandidate = normalizeSameSite(candidate, source, true);
    if (!normalized) return;
    if (inventory.has(normalized)) return;
    if (!meaningfulUrl(normalized)) {
      skipped.push({ url: normalized, reason: "unsupported_content" });
      pageRecords.set(normalized, terminalPage(normalized, reason, "excluded", "unsupported_content", sitemap));
      return;
    }
    if (robotsCandidate && !robotsAllows(robotsCandidate, robots.rules)) {
      restricted = true;
      skipped.push({ url: normalized, reason: "robots_disallowed" });
      pageRecords.set(normalized, terminalPage(normalized, reason, "excluded", "robots_disallowed", sitemap));
      return;
    }
    inventory.set(normalized, { url: normalized, reason, sitemapUrl: sitemap?.url, sitemapLastModified: sitemap?.lastModified });
  };

  addInventory(source.href, "source_home");
  if (!inventory.has(normalizeSameSite(source.href, source) ?? "")) {
    throw new WebsiteCrawlError(
      "crawl_robots_disallowed",
      "The primary page is disallowed by the selected robots policy."
    );
  }
  const advertisedSitemaps = new Set(robots.sitemaps.flatMap((url) => normalizeSameSite(url, source) ?? []));
  const sitemapQueue = unique([...robots.sitemaps, new URL("/sitemap.xml", source).href]);
  const visitedSitemaps = new Set<string>();
  for (let sitemapIndex = 0; sitemapIndex < sitemapQueue.length; sitemapIndex += 1) {
    const sitemapUrl = normalizeSameSite(sitemapQueue[sitemapIndex], source);
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);
    if (signal.aborted) { interrupted = true; break; }
    const sitemap = await fetchHtml(sitemapUrl, fetchImpl, scheduler, signal, limits, ["application/xml", "text/xml", "text/plain", "application/gzip", "application/x-gzip"], validateSameSite);
    if (!sitemap.ok) {
      const absentDefault = !advertisedSitemaps.has(sitemapUrl) && (sitemap.status === 404 || sitemap.status === 410);
      const capture = captureFromFailedFetch("sitemap", sitemapUrl, sitemap) ?? {
        captureKind: "http_response" as const,
        role: "sitemap" as const,
        requestedUrl: sitemapUrl,
        finalUrl: sitemap.finalUrl,
        outcome: "failed" as const,
        reason: sitemap.reason,
        status: sitemap.status,
        contentType: sitemap.contentType,
        redirectChain: sitemap.redirectChain ?? [],
        headers: sitemap.headers ?? {},
        initiatorUrls: []
      };
      retainCapture(absentDefault ? { ...capture, reason: "not_found" } : capture);
      if (!absentDefault) {
        auxiliaryFailure = true;
        failures.push({ url: sitemapUrl, reason: sitemap.reason, status: sitemap.status, message: sitemap.message });
      }
      continue;
    }
    const sitemapCapture = captureFromFetch("sitemap", sitemapUrl, sitemap, sitemap.bytes);
    let sitemapText: string;
    try {
      sitemapText = decodeSitemapBytes(sitemap.bytes, sitemapUrl, sitemap.contentType);
    } catch (error) {
      auxiliaryFailure = true;
      sitemapCapture.metadata = { decodeError: boundedMessage(error) };
      retainCapture(sitemapCapture);
      failures.push({ url: sitemapUrl, reason: "network", status: sitemap.status, message: `Invalid sitemap response: ${boundedMessage(error)}` });
      continue;
    }
    retainCapture(sitemapCapture);
    for (const candidate of sitemapEntries(sitemapText)) {
      if (/\.xml(?:\.gz)?(?:$|\?)/i.test(candidate.url) || /<sitemapindex\b/i.test(sitemapText)) {
        if (!visitedSitemaps.has(candidate.url) && !sitemapQueue.includes(candidate.url)) sitemapQueue.push(candidate.url);
      } else {
        addInventory(candidate.url, "sitemap", { url: sitemapUrl, lastModified: candidate.lastModified });
      }
    }
  }
  const discoveryCompleted = now();

  const queue = [...inventory.values()].sort((left, right) => left.url.localeCompare(right.url));
  const queued = new Set(queue.map((item) => item.url));
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length && !signal.aborted) {
      const item = queue[cursor++];
      const fetched = await fetchHtml(item.url, fetchImpl, scheduler, signal, limits, ["text/html", "application/xhtml+xml"], validateSameSite);
      if (!fetched.ok) {
        const failedCapture = captureFromFailedFetch("document", item.url, fetched);
        const rawCaptureKey = failedCapture ? retainCapture(failedCapture) : undefined;
        if (fetched.status === 401 || fetched.status === 403) restricted = true;
        if (fetched.reason === "unsupported_content" || fetched.reason === "unsafe_url") {
          const exclusion = fetched.reason === "unsafe_url" ? "unsafe_url" as const : "unsupported_content" as const;
          skipped.push({ url: item.url, reason: exclusion });
          pageRecords.set(item.url, terminalPage(item.url, item.reason, "excluded", exclusion, item, fetched.status, fetched.contentType, fetched.attempts, rawCaptureKey));
        } else {
          failures.push({ url: item.url, reason: fetched.reason, status: fetched.status, message: fetched.message });
          pageRecords.set(item.url, terminalPage(item.url, item.reason, "failed", fetched.reason, item, fetched.status, fetched.contentType, fetched.attempts, rawCaptureKey));
        }
        continue;
      }
      const rawCaptureKey = retainCapture(captureFromFetch("document", item.url, fetched, fetched.bytes));
      let html = fetched.text;
      let summary = summarizeCrawlHtml(html, fetched.finalUrl ?? item.url);
      summary.canonical ??= canonicalFromLinkHeader(fetched.linkHeader, fetched.finalUrl ?? item.url);
      let usedBrowser = false;
      let renderedCaptureKey: string | undefined;
      if (shouldBrowserRender(summary)) {
        const browserStarted = now();
        try {
          const browserResult = await browserFetch(item.url, signal);
          html = typeof browserResult === "string" ? browserResult : browserResult.html;
          if (typeof browserResult !== "string") {
            for (const capture of browserResult.captures) retainCapture(capture);
          }
          const renderedBytes = Buffer.from(html);
          if (renderedBytes.length > limits.maximumResponseBytes) throw new Error("browser_response_too_large");
          summary = summarizeCrawlHtml(html, item.url);
          summary.canonical ??= canonicalFromLinkHeader(fetched.linkHeader, fetched.finalUrl ?? item.url);
          browserRendered += 1;
          usedBrowser = true;
          renderedCaptureKey = retainCapture({
            captureKind: "rendered_dom",
            role: "rendered_document",
            requestedUrl: item.url,
            finalUrl: fetched.finalUrl ?? item.url,
            outcome: "fetched",
            status: fetched.status,
            contentType: "text/html; rendered=browser",
            bytes: renderedBytes,
            redirectChain: fetched.redirectChain,
            headers: fetched.headers,
            initiatorUrls: [item.url]
          });
        } catch (error) {
          auxiliaryFailure = true;
          failures.push({ url: item.url, reason: "browser_failed", message: boundedMessage(error) });
        } finally {
          browserFallbackMs += Math.max(0, now() - browserStarted);
        }
      }
      if (item.url !== source.href) summary = { ...summary, source: "sampled_internal" };
      if (normalizeSameSite(item.url, source) === normalizeSameSite(source.href, source)) {
        homepageTechnicalEvidence = {
          url: item.url,
          finalUrl: fetched.finalUrl ?? item.url,
          status: fetched.status,
          contentType: fetched.contentType,
          linkHeader: fetched.linkHeader,
          body: fetched.text
        };
      }
      const evidenceClass = classifyPageEvidence(summary);
      const allLinks = extractDocumentLinks(html, fetched.finalUrl ?? item.url, source.hostname);
      const extractedText = extractDocumentText(html);
      summaries.set(item.url, summary);
      documents.push({ url: item.url, finalUrl: fetched.finalUrl ?? item.url, html, extractedText, summary });
      pageRecords.set(item.url, {
        url: item.url,
        finalUrl: fetched.finalUrl ?? item.url,
        discoveryReason: item.reason,
        sitemapUrl: item.sitemapUrl,
        sitemapLastModified: item.sitemapLastModified,
        fetchAttempts: fetched.attempts,
        browserRendered: usedBrowser,
        evidenceClass,
        outcome: "fetched",
        status: fetched.status,
        contentType: fetched.contentType,
        canonical: summary.canonical,
        indexability: documentIndexability(html, fetched.headers),
        title: summary.title,
        headings: extractHeadings(html),
        wordCount: wordCount(extractedText),
        internalLinks: allLinks.internal,
        externalLinks: allLinks.external,
        rawCaptureKey,
        renderedCaptureKey,
        summary
      });
      for (const link of allLinks.internal) {
        addInventory(link, "linked_page");
        const discovered = inventory.get(normalizeSameSite(link, source) ?? "");
        if (discovered && !queued.has(discovered.url)) {
          queued.add(discovered.url);
          queue.push(discovered);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: limits.concurrentPerOrigin }, () => worker()));
  const documentsCompleted = now();
  if (!signal.aborted) {
    await captureDocumentDependencies({
      documents,
      existing: captures,
      fetchImpl,
      scheduler,
      signal,
      limits,
      validateUrl: baseValidator,
      retainCapture
    });
  }
  const dependenciesCompleted = now();
  if (captures.some((capture) => !["robots", "sitemap", "document", "rendered_document"].includes(capture.role)
    && (capture.outcome === "failed" || capture.outcome === "unfinished"))) {
    auxiliaryFailure = true;
  }
  if (signal.aborted) {
    interrupted = true;
    const failedUrls = new Set(failures.map((failure) => failure.url));
    for (const item of queue) {
      if (!pageRecords.has(item.url) && !failedUrls.has(item.url)) {
        pageRecords.set(item.url, terminalPage(item.url, item.reason, "unfinished", fuseReached ? "capture_size_fuse" : "cancelled", item));
      }
    }
  }

  const orderedPages = [...pageRecords.values()].sort((left, right) => left.url.localeCompare(right.url));
  const crawlSummaries = [...summaries.values()];
  const primary = crawlSummaries.find((summary) => normalizeSameSite(summary.url, source) === normalizeSameSite(source.href, source)) ?? crawlSummaries[0];
  const completed = now();
  const failedCount = orderedPages.filter((page) => page.outcome === "failed").length;
  const unfinishedCount = orderedPages.filter((page) => page.outcome === "unfinished").length;
  const coverage = !primary || interrupted || auxiliaryFailure || failedCount > 0 || unfinishedCount > 0
    ? "incomplete" as const
    : restricted ? "restricted" as const : "complete" as const;
  const completionReason = fuseReached
    ? "capture_size_fuse" as const
    : interrupted
      ? (/timeout|deadline/i.test(String(input.signal?.reason ?? "")) ? "deadline" as const : "cancelled" as const)
      : failedCount > 0 || auxiliaryFailure
        ? "failures" as const
        : restricted ? "restricted" as const : "queue_exhausted" as const;
  const ingestion = websiteGenerationIngestionSchema.parse({
    schemaVersion: 1,
    sourceUrl,
    coverage,
    completionReason,
    limits,
    counts: {
      discovered: pageRecords.size,
      eligible: orderedPages.filter((page) => page.outcome !== "excluded").length,
      fetched: orderedPages.filter((page) => page.outcome === "fetched").length,
      excluded: orderedPages.filter((page) => page.outcome === "excluded").length,
      failed: failedCount,
      unfinished: unfinishedCount,
      browserRendered,
      rawBytes
    },
    pages: orderedPages,
    skipped,
    failures,
    startedAt,
    completedAt: new Date(completed).toISOString(),
    elapsedMs: Math.max(0, completed - started)
  });
  const crawl = assessmentFromPages(sourceUrl, crawlSummaries, ingestion, robots.found);
  if (!crawl.fetched) {
    const failureCode = primaryFailureCode(sourceUrl, ingestion);
    throw new WebsiteCrawlError(failureCode, primaryFailureDiagnostic(sourceUrl, ingestion));
  }
  return {
    ingestion,
    crawl,
    technicalEvidence: {
      robots: {
        url: new URL("/robots.txt", source).href,
        found: robots.found,
        body: robots.text
      },
      homepage: homepageTechnicalEvidence
    } satisfies GenerationCrawlTechnicalEvidence,
    captures,
    documents,
    timings: {
      discoveryMs: Math.max(0, discoveryCompleted - started),
      documentFetchMs: Math.max(0, documentsCompleted - discoveryCompleted - browserFallbackMs),
      dependencyFetchMs: Math.max(0, dependenciesCompleted - documentsCompleted),
      browserFallbackMs
    }
  };
  } finally {
    await browserPool?.close();
  }
}

async function captureDocumentDependencies(input: {
  documents: GenerationCrawlDocument[];
  existing: GenerationCrawlCapture[];
  fetchImpl: FetchLike;
  scheduler: OriginScheduler;
  signal: AbortSignal;
  limits: GenerationIngestionLimitValues;
  validateUrl: UrlValidator;
  retainCapture: (capture: Omit<GenerationCrawlCapture, "key">) => string;
}) {
  const pending = new Map<string, DependencyCaptureCandidate>();
  const captured = new Set(input.existing.map((resource) => resource.requestedUrl));
  const enqueue = (candidate: { url: string; role: GenerationResourceRole; initiatorUrl: string }) => {
    if (captured.has(candidate.url) || /^data:/i.test(candidate.url) || isKnownNonWebsiteMedia(candidate.url)) return;
    const retained = pending.get(candidate.url);
    if (retained) {
      retained.initiatorUrls.add(candidate.initiatorUrl);
      if (resourceRoleRank(candidate.role) > resourceRoleRank(retained.role)) retained.role = candidate.role;
      return;
    }
    pending.set(candidate.url, { url: candidate.url, role: candidate.role, initiatorUrls: new Set([candidate.initiatorUrl]) });
  };
  for (const document of input.documents) {
    for (const resource of extractResourceReferences(document.html, document.finalUrl)) enqueue({ ...resource, initiatorUrl: document.url });
  }

  const retain = input.retainCapture;
  const queue = coalesceResponsiveImageDependencies([...pending.values()]);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length && !input.signal.aborted) {
      const resource = queue[cursor++];
      if (captured.has(resource.url)) continue;
      captured.add(resource.url);
      let validated: string;
      try {
        validated = await input.validateUrl(resource.url);
      } catch {
        retain({
          captureKind: "http_response",
          role: resource.role,
          requestedUrl: resource.url,
          outcome: "excluded",
          reason: "unsafe_url",
          redirectChain: [],
          headers: {},
          initiatorUrls: [...resource.initiatorUrls].sort()
        });
        continue;
      }
      const fetched = await fetchHtml(validated, input.fetchImpl, input.scheduler, input.signal, input.limits, undefined, input.validateUrl);
      if (!fetched.ok) {
        const retained = captureFromFailedFetch(resource.role, validated, fetched);
        retain(retained ? {
          ...retained,
          outcome: fetched.reason === "unsupported_content" || fetched.reason === "unsafe_url" ? "excluded" : "failed",
          reason: fetched.reason,
          initiatorUrls: [...resource.initiatorUrls].sort()
        } : {
          captureKind: "http_response",
          role: resource.role,
          requestedUrl: validated,
          outcome: fetched.reason === "unsupported_content" || fetched.reason === "unsafe_url" ? "excluded" : "failed",
          reason: fetched.reason,
          status: fetched.status,
          contentType: fetched.contentType,
          finalUrl: fetched.finalUrl,
          redirectChain: fetched.redirectChain ?? [],
          headers: fetched.headers ?? {},
          initiatorUrls: [...resource.initiatorUrls].sort()
        });
        continue;
      }
      const role = roleFromContentType(resource.role, fetched.contentType);
      const retained = captureFromFetch(role, validated, fetched, fetched.bytes);
      retained.initiatorUrls = [...resource.initiatorUrls].sort();
      retain(retained);
      if (role === "stylesheet") {
        for (const nested of extractCssResourceReferences(fetched.text, fetched.finalUrl)) {
          if (captured.has(nested.url) || isKnownNonWebsiteMedia(nested.url)) continue;
          const known = pending.get(nested.url);
          if (known) known.initiatorUrls.add(validated);
          else {
            const next = { url: nested.url, role: nested.role, initiatorUrls: new Set([validated]) };
            pending.set(nested.url, next);
            queue.push(next);
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(16, input.limits.concurrentPerOrigin * 2)) }, () => worker()));
  if (input.signal.aborted) {
    for (const resource of queue.slice(cursor)) {
      if (captured.has(resource.url)) continue;
      retain({
        captureKind: "http_response",
        role: resource.role,
        requestedUrl: resource.url,
        outcome: "unfinished",
        reason: "cancelled",
        redirectChain: [],
        headers: {},
        initiatorUrls: [...resource.initiatorUrls].sort()
      });
    }
  }
}

type DependencyCaptureCandidate = {
  url: string;
  role: GenerationResourceRole;
  initiatorUrls: Set<string>;
};

/**
 * WordPress and similar CMSs emit many byte-heavy width variants of the same
 * source photo. The retained HTML keeps the complete src/srcset evidence; the
 * mirror only needs the best representative bytes for authoring and adoption.
 */
export function coalesceResponsiveImageDependencies(candidates: DependencyCaptureCandidate[]) {
  const retained = new Map<string, DependencyCaptureCandidate>();
  for (const candidate of candidates) {
    const key = candidate.role === "image" ? responsiveImageFamily(candidate.url) : candidate.url;
    const prior = retained.get(key);
    if (!prior) {
      retained.set(key, { ...candidate, initiatorUrls: new Set(candidate.initiatorUrls) });
      continue;
    }
    for (const initiator of candidate.initiatorUrls) prior.initiatorUrls.add(initiator);
    if (preferredResponsiveImage(candidate.url, prior.url)) prior.url = candidate.url;
  }
  return [...retained.values()];
}

export function isKnownNonWebsiteMedia(value: string) {
  try {
    return /\.(?:avi|m4a|m4v|mkv|mov|mp3|mp4|mpeg|mpg|oga|ogg|ogv|wav|webm)(?:$|[?#])/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function responsiveImageFamily(value: string) {
  try {
    const url = new URL(value);
    if (!/\.(?:avif|jpe?g|png|webp)$/i.test(url.pathname)) return value;
    const path = url.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.(?:avif|jpe?g|png|webp)$)/i, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:ver|v|version|cache|cb|_t)$/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = path;
    url.searchParams.sort();
    return url.href;
  } catch {
    return value;
  }
}

function preferredResponsiveImage(candidate: string, retained: string) {
  const candidateSize = responsiveImageSize(candidate);
  const retainedSize = responsiveImageSize(retained);
  if (!candidateSize && retainedSize) return true;
  if (candidateSize && !retainedSize) return false;
  if (!candidateSize || !retainedSize) return candidate.length < retained.length;
  return candidateSize.width * candidateSize.height > retainedSize.width * retainedSize.height;
}

function responsiveImageSize(value: string) {
  try {
    const match = new URL(value).pathname.match(/-(\d{2,5})x(\d{2,5})(?=\.(?:avif|jpe?g|png|webp)$)/i);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
  } catch {
    return undefined;
  }
}

function extractResourceReferences(html: string, baseUrl: string) {
  const resources: Array<{ url: string; role: GenerationResourceRole }> = [];
  const add = (raw: string | undefined, role: GenerationResourceRole) => {
    if (!raw || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(raw.trim())) return;
    try {
      const url = new URL(decodeHtmlAttribute(raw.trim()), baseUrl);
      url.hash = "";
      if (["http:", "https:"].includes(url.protocol)) resources.push({ url: url.href, role });
    } catch {
      // Malformed source references are evidence in the retained HTML itself.
    }
  };
  for (const tag of html.match(/<(?:link|script|img|source|video|meta|image)\b[^>]*>/gi) ?? []) {
    const name = tag.match(/^<([a-z]+)/i)?.[1]?.toLowerCase();
    const rel = htmlAttribute(tag, "rel")?.toLowerCase() ?? "";
    const as = htmlAttribute(tag, "as")?.toLowerCase() ?? "";
    const role: GenerationResourceRole = name === "script" || as === "script" || rel.includes("modulepreload")
      ? "script"
      : rel.includes("stylesheet") || as === "style"
        ? "stylesheet"
        : as === "font"
          ? "font"
          : rel.includes("manifest")
            ? "data"
            : "image";
    add(htmlAttribute(tag, name === "script" || name === "img" || name === "source" ? "src" : name === "video" ? "poster" : "href"), role);
    add(htmlAttribute(tag, "data-src"), role);
    for (const srcset of [htmlAttribute(tag, "srcset"), htmlAttribute(tag, "data-srcset")]) {
      for (const candidate of srcset?.split(",") ?? []) add(candidate.trim().split(/\s+/, 1)[0], role);
    }
    if (name === "meta" && /^(?:og:image|twitter:image)$/i.test(htmlAttribute(tag, "property") ?? htmlAttribute(tag, "name") ?? "")) {
      add(htmlAttribute(tag, "content"), "image");
    }
  }
  for (const match of html.matchAll(/(?:style\s*=\s*["'][^"']*|<style\b[^>]*>[\s\S]*?<\/style>)/gi)) {
    for (const resource of extractCssResourceReferences(match[0], baseUrl)) resources.push(resource);
  }
  return uniqueByUrlRole(resources);
}

function extractCssResourceReferences(css: string, baseUrl: string) {
  const resources: Array<{ url: string; role: GenerationResourceRole }> = [];
  for (const match of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const raw = match[1] ?? match[2];
    if (!raw || /^(?:data:|blob:|#)/i.test(raw.trim())) continue;
    try {
      const url = new URL(raw.trim(), baseUrl);
      url.hash = "";
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const role = match[1] ? "stylesheet" : roleFromUrl(url.pathname);
      resources.push({ url: url.href, role });
    } catch {
      // The source stylesheet remains exact even when one dependency is malformed.
    }
  }
  return uniqueByUrlRole(resources);
}

function uniqueByUrlRole(resources: Array<{ url: string; role: GenerationResourceRole }>) {
  const retained = new Map<string, { url: string; role: GenerationResourceRole }>();
  for (const resource of resources) {
    const prior = retained.get(resource.url);
    if (!prior || resourceRoleRank(resource.role) > resourceRoleRank(prior.role)) retained.set(resource.url, resource);
  }
  return [...retained.values()];
}

function roleFromUrl(pathname: string): GenerationResourceRole {
  if (/\.css$/i.test(pathname)) return "stylesheet";
  if (/\.(?:m?js|cjs)$/i.test(pathname)) return "script";
  if (/\.(?:woff2?|eot|ttf|otf)$/i.test(pathname)) return "font";
  if (/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(pathname)) return "image";
  if (/\.(?:json|webmanifest)$/i.test(pathname)) return "data";
  return "other";
}

function roleFromContentType(fallback: GenerationResourceRole, contentType: string): GenerationResourceRole {
  if (/text\/css/i.test(contentType)) return "stylesheet";
  if (/(?:javascript|ecmascript)/i.test(contentType)) return "script";
  if (/^image\//i.test(contentType)) return "image";
  if (/(?:font|woff|opentype|truetype)/i.test(contentType)) return "font";
  if (/(?:json|manifest)/i.test(contentType)) return "data";
  return fallback;
}

function resourceRoleRank(role: GenerationResourceRole) {
  return ({ stylesheet: 8, script: 7, font: 6, image: 5, data: 4, rendered_document: 3, document: 2, sitemap: 2, robots: 2, other: 1 } as const)[role];
}

function htmlAttribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i"))?.slice(1).find((value) => value !== undefined);
}

function decodeHtmlAttribute(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&#38;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

type OriginScheduleState = {
  active: number;
  waiters: Array<() => void>;
  nextStart: number;
  cooldownUntil: number;
  currentConcurrency: number;
  consecutiveSuccesses: number;
};

class OriginScheduler {
  private readonly origins = new Map<string, OriginScheduleState>();
  constructor(
    private readonly spacingMs: number,
    private readonly maximumConcurrency: number,
    private readonly now: () => number,
    private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>,
    private readonly random: () => number
  ) {}

  async schedule<T>(url: string, signal: AbortSignal, operation: () => Promise<T>) {
    const state = this.stateFor(url);
    await this.acquire(state, signal);
    try {
      const startAt = Math.max(state.nextStart, state.cooldownUntil, this.now());
      state.nextStart = startAt + this.spacingMs;
      await this.wait(Math.max(0, startAt - this.now()), signal);
      return await operation();
    } finally {
      state.active -= 1;
      this.wakeWaiters(state);
    }
  }

  recordSuccess(url: string) {
    const state = this.stateFor(url);
    state.consecutiveSuccesses += 1;
    if (state.consecutiveSuccesses < 20 || state.currentConcurrency >= this.maximumConcurrency) return;
    state.currentConcurrency += 1;
    state.consecutiveSuccesses = 0;
    this.wakeWaiters(state);
  }

  recordThrottle(url: string, retryAfter: string | null, attempt: number) {
    const state = this.stateFor(url);
    const retryAfterMs = parsedRetryAfterMs(retryAfter, this.now());
    const waitMs = retryAfterMs ?? retryBackoffMs(attempt, this.random);
    state.cooldownUntil = Math.max(state.cooldownUntil, this.now() + waitMs);
    state.currentConcurrency = Math.max(2, Math.floor(state.currentConcurrency / 2));
    state.consecutiveSuccesses = 0;
    return waitMs;
  }

  retryDelay(attempt: number) {
    return retryBackoffMs(attempt, this.random);
  }

  concurrencyFor(url: string) {
    return this.stateFor(url).currentConcurrency;
  }

  wait(milliseconds: number, signal: AbortSignal) {
    if (milliseconds <= 0) {
      signal.throwIfAborted();
      return Promise.resolve();
    }
    return this.sleep(milliseconds, signal);
  }

  private stateFor(url: string) {
    const origin = new URL(url).origin;
    const state = this.origins.get(origin) ?? {
      active: 0,
      waiters: [],
      nextStart: 0,
      cooldownUntil: 0,
      currentConcurrency: this.maximumConcurrency,
      consecutiveSuccesses: 0
    };
    this.origins.set(origin, state);
    return state;
  }

  private async acquire(state: OriginScheduleState, signal: AbortSignal) {
    while (state.active >= state.currentConcurrency) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const wake = () => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          const index = state.waiters.indexOf(wake);
          if (index >= 0) state.waiters.splice(index, 1);
          reject(signal.reason ?? new Error("generation_crawl_cancelled"));
        };
        state.waiters.push(wake);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
    state.active += 1;
  }

  private wakeWaiters(state: OriginScheduleState) {
    const waiters = state.waiters.splice(0);
    for (const wake of waiters) wake();
  }
}

async function fetchHtml(url: string, fetchImpl: FetchLike, scheduler: OriginScheduler, signal: AbortSignal, limits: GenerationIngestionLimitValues, acceptedTypes: string[] | undefined, validateUrl: UrlValidator): Promise<GenerationFetchResult> {
  const attemptHistory: GenerationFetchAttempt[] = [];
  let retryWaitMs = 0;
  let throttleEvents = 0;
  let last: GenerationFetchFailure = {
    ok: false,
    reason: "network",
    message: "request_failed",
    attempts: 0,
    attemptHistory,
    retryWaitMs,
    throttleEvents
  };
  for (let attempt = 1; attempt <= limits.transientRetries + 1; attempt += 1) {
    try {
      const fetched = await fetchFollowingSafeRedirects(url, fetchImpl, scheduler, signal, limits, acceptedTypes, validateUrl);
      const { response } = fetched;
      if (!response.ok) {
        const bytes = await responseBytesWithin(response, limits.maximumResponseBytes);
        const reason = classifyHttpFailure(response);
        const accessClassification = accessClassificationFor(reason);
        last = {
          ok: false,
          reason,
          status: response.status,
          contentType: response.headers.get("content-type") ?? undefined,
          message: `HTTP ${response.status}`,
          attempts: attempt,
          bytes,
          finalUrl: fetched.finalUrl,
          redirectChain: fetched.redirectChain,
          headers: safeResponseHeaders(response.headers),
          attemptHistory,
          retryWaitMs,
          throttleEvents,
          accessClassification
        };
        if (!transientStatus(response.status) || attempt > limits.transientRetries) {
          attemptHistory.push({ attempt, status: response.status, reason, waitMs: 0, originConcurrency: scheduler.concurrencyFor(fetched.finalUrl) });
          return { ...last, attempts: attempt, attemptHistory: [...attemptHistory], retryWaitMs, throttleEvents };
        }
        const waitMs = response.status === 429 || response.status === 503
          ? scheduler.recordThrottle(fetched.finalUrl, response.headers.get("retry-after"), attempt)
          : scheduler.retryDelay(attempt);
        if (response.status === 429 || response.status === 503) throttleEvents += 1;
        retryWaitMs += waitMs;
        attemptHistory.push({ attempt, status: response.status, reason, waitMs, originConcurrency: scheduler.concurrencyFor(fetched.finalUrl) });
        if (response.status !== 429 && response.status !== 503) {
          try {
            await scheduler.wait(waitMs, signal);
          } catch {
            return { ...last, attempts: attempt, attemptHistory: [...attemptHistory], retryWaitMs, throttleEvents };
          }
        }
        continue;
      }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const bytes = await responseBytesWithin(response, limits.maximumResponseBytes);
      if (acceptedTypes?.length && contentType && !acceptedTypes.some((type) => contentType.includes(type))) {
        attemptHistory.push({ attempt, status: response.status, reason: "unsupported_content", waitMs: 0, originConcurrency: scheduler.concurrencyFor(fetched.finalUrl) });
        return {
          ok: false,
          reason: "unsupported_content",
          status: response.status,
          contentType,
          message: contentType,
          attempts: attempt,
          bytes,
          finalUrl: fetched.finalUrl,
          redirectChain: fetched.redirectChain,
          headers: safeResponseHeaders(response.headers),
          attemptHistory: [...attemptHistory],
          retryWaitMs,
          throttleEvents
        };
      }
      scheduler.recordSuccess(fetched.finalUrl);
      attemptHistory.push({ attempt, status: response.status, reason: "success", waitMs: 0, originConcurrency: scheduler.concurrencyFor(fetched.finalUrl) });
      return {
        ok: true,
        text: bytes.toString("utf8"),
        bytes,
        attempts: attempt,
        finalUrl: fetched.finalUrl,
        status: response.status,
        contentType,
        linkHeader: response.headers.get("link") ?? undefined,
        redirectChain: fetched.redirectChain,
        headers: safeResponseHeaders(response.headers),
        attemptHistory: [...attemptHistory],
        retryWaitMs,
        throttleEvents
      };
    } catch (error) {
      if (error instanceof PublicFetchUrlError) {
        attemptHistory.push({ attempt, reason: "unsafe_url", waitMs: 0, originConcurrency: scheduler.concurrencyFor(url) });
        return {
          ok: false,
          reason: "unsafe_url",
          message: error.message,
          attempts: attempt,
          attemptHistory: [...attemptHistory],
          retryWaitMs,
          throttleEvents
        };
      }
      const message = boundedMessage(error);
      const reason = /too_large/i.test(message) ? "response_too_large" as const : /abort|timeout/i.test(message) ? "timeout" as const : "network" as const;
      last = {
        ok: false,
        reason,
        message,
        attempts: attempt,
        downloadedBytes: error instanceof ResponseTooLargeError ? error.downloadedBytes : undefined,
        attemptHistory,
        retryWaitMs,
        throttleEvents
      };
      if (attempt > limits.transientRetries || reason === "response_too_large" || signal.aborted) {
        attemptHistory.push({ attempt, reason, waitMs: 0, originConcurrency: scheduler.concurrencyFor(url) });
        return { ...last, attempts: attempt, attemptHistory: [...attemptHistory], retryWaitMs, throttleEvents };
      }
      const waitMs = scheduler.retryDelay(attempt);
      retryWaitMs += waitMs;
      attemptHistory.push({ attempt, reason, waitMs, originConcurrency: scheduler.concurrencyFor(url) });
      try {
        await scheduler.wait(waitMs, signal);
      } catch {
        return { ...last, attempts: attempt, attemptHistory: [...attemptHistory], retryWaitMs, throttleEvents };
      }
    }
  }
  return { ...last, attempts: limits.transientRetries + 1, attemptHistory: [...attemptHistory], retryWaitMs, throttleEvents };
}

async function fetchFollowingSafeRedirects(url: string, fetchImpl: FetchLike, scheduler: OriginScheduler, signal: AbortSignal, limits: GenerationIngestionLimitValues, acceptedTypes: string[] | undefined, validateUrl: UrlValidator) {
  let current = await validateUrl(url);
  const redirectChain: Array<{ url: string; status: number; location: string }> = [];
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await scheduler.schedule(current, signal, () => fetchImpl(current, {
      redirect: "manual",
      headers: {
        accept: acceptedTypes?.length ? `${acceptedTypes.join(", ")};q=0.9, */*;q=0.1` : "text/plain, */*;q=0.1",
        "user-agent": generationCrawlerUserAgent
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(limits.requestTimeoutMs)])
    }));
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: response.url || current, redirectChain };
    const location = response.headers.get("location");
    if (!location) throw new Error("redirect_missing_location");
    if (redirectCount === 5) throw new Error("redirect_limit_exhausted");
    const destination = await validateUrl(new URL(location, current).href);
    redirectChain.push({ url: current, status: response.status, location: destination });
    current = destination;
  }
  throw new Error("redirect_limit_exhausted");
}

async function responseBytesWithin(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new ResponseTooLargeError(0);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes);
      bytes += value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel("response_too_large"); throw new ResponseTooLargeError(bytes); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

async function readRobots(source: URL, fetchImpl: FetchLike, scheduler: OriginScheduler, signal: AbortSignal, limits: GenerationIngestionLimitValues, validateUrl: UrlValidator) {
  const response = await fetchHtml(new URL("/robots.txt", source).href, fetchImpl, scheduler, signal, limits, undefined, validateUrl);
  if (response.ok) return {
    found: true,
    text: response.text,
    ...parseRobotsPolicy(response.text),
    capture: captureFromFetch("robots", new URL("/robots.txt", source).href, response, response.bytes)
  };
  if (
    response.status !== undefined
    && response.status >= 400
    && response.status < 500
    && response.status !== 408
    && response.status !== 429
  ) {
    return {
      found: false,
      text: undefined,
      rules: [] as RobotsRule[],
      sitemaps: [] as string[],
      capture: (() => {
        const capture = captureFromFailedFetch("robots", new URL("/robots.txt", source).href, response);
        return capture ? { ...capture, reason: "not_found" } : capture;
      })()
    };
  }
  throw new WebsiteCrawlError(
    "crawl_temporarily_unavailable",
    `robots.txt was temporarily unavailable: ${response.message}`
  );
}

function assessmentFromPages(sourceUrl: string, pages: CrawlPageSummary[], ingestion: WebsiteGenerationIngestion, robotsFound: boolean): CrawlAssessment {
  const source = new URL(sourceUrl);
  const primary = pages.find((page) => normalizeSameSite(page.url, source) === normalizeSameSite(sourceUrl, source)) ?? pages[0];
  const orderedPages = primary ? [primary, ...pages.filter((page) => page !== primary)] : pages;
  const mergedFacts = orderedPages.reduce((combined, page) => mergeExtractedFacts(combined, page.extractedFacts), emptyFacts());
  const facts = {
    ...mergedFacts,
    phone: consensusPhone(orderedPages),
    hours: consensusHours(orderedPages)
  };
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
    robotsFound,
    sitemapFound: ingestion.pages.some((page) => page.discoveryReason === "sitemap"),
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
    findings: ingestion.coverage === "complete" ? [] : [`Generation crawl coverage: ${ingestion.coverage}.`],
    error: ingestion.coverage === "incomplete" ? "Website crawl coverage was incomplete." : undefined
  };
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

export async function fetchGenerationPageWithBrowser(url: string, signal: AbortSignal, requestTimeoutMs: number, validateUrl: UrlValidator, validateNavigation: UrlValidator, maximumResponseBytes = generationIngestionLimits.maximumResponseBytes) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    return await fetchGenerationPageInBrowser(browser, url, signal, requestTimeoutMs, validateUrl, validateNavigation, maximumResponseBytes);
  } finally { await browser.close(); }
}

function createGenerationBrowserPool(input: {
  requestTimeoutMs: number;
  validateUrl: UrlValidator;
  validateNavigation: UrlValidator;
  maximumResponseBytes: number;
  maximumConcurrency: number;
}) {
  let browserPromise: Promise<import("playwright").Browser> | undefined;
  let active = 0;
  const waiters: Array<() => void> = [];
  const browser = async () => {
    if (!browserPromise) {
      browserPromise = import("playwright")
        .then(({ chromium }) => chromium.launch({ headless: true }));
    }
    return browserPromise;
  };
  const acquire = async (signal: AbortSignal) => {
    while (active >= input.maximumConcurrency) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const wake = () => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          const index = waiters.indexOf(wake);
          if (index >= 0) waiters.splice(index, 1);
          reject(signal.reason ?? new Error("generation_browser_cancelled"));
        };
        waiters.push(wake);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
    active += 1;
  };
  const release = () => {
    active -= 1;
    const queued = waiters.splice(0);
    for (const wake of queued) wake();
  };
  const pooledFetch: BrowserFetch = async (url, signal) => {
    await acquire(signal);
    try {
      return await fetchGenerationPageInBrowser(
        await browser(),
        url,
        signal,
        input.requestTimeoutMs,
        input.validateUrl,
        input.validateNavigation,
        input.maximumResponseBytes
      );
    } finally {
      release();
    }
  };
  return {
    fetch: pooledFetch,
    close: async () => {
      if (!browserPromise) return;
      const retained = browserPromise;
      browserPromise = undefined;
      await retained.then((instance) => instance.close()).catch(() => undefined);
    }
  };
}

async function fetchGenerationPageInBrowser(
  browser: import("playwright").Browser,
  url: string,
  signal: AbortSignal,
  requestTimeoutMs: number,
  validateUrl: UrlValidator,
  validateNavigation: UrlValidator,
  maximumResponseBytes: number
) {
  const context = await browser.newContext({ userAgent: generationCrawlerUserAgent, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await page.routeWebSocket("**/*", (webSocket) => webSocket.close());
    const responseCaptures: Array<Promise<Omit<GenerationCrawlCapture, "key"> | undefined>> = [];
    await page.route("**/*", async (route) => {
      try {
        if (!["GET", "HEAD"].includes(route.request().method())) return route.abort("blockedbyclient");
        const validator = route.request().isNavigationRequest() ? validateNavigation : validateUrl;
        await validator(route.request().url());
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    page.on("response", (response) => {
      if (response.request().isNavigationRequest() || response.request().method() !== "GET") return;
      responseCaptures.push(captureBrowserResponse(response, url, maximumResponseBytes));
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
    await page.waitForLoadState("networkidle", { timeout: Math.min(requestTimeoutMs, 5_000) }).catch(() => undefined);
    await page.evaluate(async () => {
      const height = Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight);
      for (let offset = 0; offset < height; offset += Math.max(600, window.innerHeight)) {
        window.scrollTo(0, offset);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      window.scrollTo(0, 0);
    }).catch(() => undefined);
    await page.waitForTimeout(100);
    const html = await page.content();
    const captures = (await Promise.all(responseCaptures)).filter((capture): capture is Omit<GenerationCrawlCapture, "key"> => Boolean(capture));
    return { html, captures };
  } finally { await context.close(); }
}

async function captureBrowserResponse(response: import("playwright").Response, initiatorUrl: string, maximumBytes: number) {
  const requestedUrl = response.url();
  const status = response.status();
  try {
    const headers = await response.allHeaders();
    const declared = Number(headers["content-length"]);
    const contentType = headers["content-type"] ?? "application/octet-stream";
    const role = roleFromContentType(roleFromUrl(new URL(requestedUrl).pathname), contentType);
    if (Number.isFinite(declared) && declared > maximumBytes) return {
      captureKind: "http_response" as const,
      role,
      requestedUrl,
      finalUrl: requestedUrl,
      outcome: "excluded" as const,
      reason: "response_too_large",
      status,
      contentType,
      redirectChain: [],
      headers: safeHeaderRecord(headers),
      initiatorUrls: [initiatorUrl],
      metadata: { downloadedBytes: declared }
    };
    const bytes = await response.body();
    if (bytes.length > maximumBytes) return {
      captureKind: "http_response" as const,
      role,
      requestedUrl,
      finalUrl: requestedUrl,
      outcome: "excluded" as const,
      reason: "response_too_large",
      status,
      contentType,
      redirectChain: [],
      headers: safeHeaderRecord(headers),
      initiatorUrls: [initiatorUrl],
      metadata: { downloadedBytes: bytes.length }
    };
    return {
      captureKind: "http_response" as const,
      role,
      requestedUrl,
      finalUrl: requestedUrl,
      outcome: status >= 200 && status < 400 ? "fetched" as const : "failed" as const,
      ...(status >= 400 ? { reason: `http_${status}` } : {}),
      status,
      contentType,
      bytes,
      redirectChain: [],
      headers: safeHeaderRecord(headers),
      initiatorUrls: [initiatorUrl]
    };
  } catch {
    return {
      captureKind: "http_response" as const,
      role: roleFromUrl(new URL(requestedUrl).pathname),
      requestedUrl,
      finalUrl: requestedUrl,
      outcome: "failed" as const,
      reason: "browser_failed",
      status,
      redirectChain: [],
      headers: {},
      initiatorUrls: [initiatorUrl]
    };
  }
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

function consensusPhone(pages: CrawlPageSummary[]) {
  const candidates = new Map<string, {
    score: number;
    pageUrls: Set<string>;
    evidenceKinds: Set<"tel" | "visible" | "structured">;
  }>();
  const support = (
    phone: string,
    pageUrl: string,
    kind: "tel" | "visible" | "structured",
    weight: number
  ) => {
    const candidate = candidates.get(phone) ?? {
      score: 0,
      pageUrls: new Set<string>(),
      evidenceKinds: new Set<"tel" | "visible" | "structured">()
    };
    candidate.score += weight;
    candidate.pageUrls.add(pageUrl);
    candidate.evidenceKinds.add(kind);
    candidates.set(phone, candidate);
  };
  for (const page of pages) {
    const pagePhones = new Set(page.linkReferences
      .filter((reference) => reference.kind === "tel")
      .map((reference) => normalizedTelPhone(reference.href))
      .filter((phone): phone is string => Boolean(phone)));
    for (const phone of pagePhones) support(phone, page.url, "tel", 4);
    const visiblePhones = new Set(page.sourceTextBlocks
      .flatMap((block) => visiblePhoneCandidates(block.displayText)));
    for (const phone of visiblePhones) support(phone, page.url, "visible", 3);
    if (page.extractedFacts.phone) support(page.extractedFacts.phone, page.url, "structured", 1);
  }
  const ranked = [...candidates.entries()].sort(([leftPhone, left], [rightPhone, right]) =>
    right.score - left.score
    || right.pageUrls.size - left.pageUrls.size
    || right.evidenceKinds.size - left.evidenceKinds.size
    || leftPhone.localeCompare(rightPhone));
  const winner = ranked[0];
  if (!winner) return undefined;
  const [, evidence] = winner;
  if (evidence.pageUrls.size < 2 && evidence.evidenceKinds.size < 2) return undefined;
  if (ranked[1] && evidence.score <= ranked[1][1].score) return undefined;
  return winner[0];
}

function consensusHours(pages: CrawlPageSummary[]) {
  const candidates = new Map<string, Record<string, string>>();
  const visibleCandidates = new Set<string>();
  for (const page of pages) {
    for (const block of page.sourceTextBlocks) {
      const visible = visibleWeeklyHours(block.displayText);
      if (visible) visibleCandidates.add(visible);
    }
    const hours = page.extractedFacts.hours;
    if (!hours || !Object.keys(hours).length) continue;
    const normalized = Object.fromEntries(Object.entries(hours).sort(([left], [right]) => left.localeCompare(right)));
    candidates.set(JSON.stringify(normalized), normalized);
    for (const value of Object.values(normalized)) {
      const stored = normalizedHourRange(value);
      if (stored) visibleCandidates.add(stored);
    }
  }
  if (candidates.size !== 1 || visibleCandidates.size > 1) return undefined;
  return [...candidates.values()][0];
}

function normalizedTelPhone(value: string) {
  const raw = value.replace(/^tel:/i, "").split(/[?;]/, 1)[0] ?? "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

function visiblePhoneCandidates(value: string) {
  return [...value.matchAll(/(?:\+?1[\s.(\-]*)?(?:\d{3}|\(\d{3}\))[\s.)\-]*\d{3}[\s.\-]*\d{4}\b/g)]
    .map((match) => normalizedTelPhone(match[0]))
    .filter((phone): phone is string => Boolean(phone));
}

function visibleWeeklyHours(value: string) {
  const match = value.match(/\bMon(?:day)?\s*[-–—]\s*Sun(?:day)?\s*:?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (!match) return undefined;
  const start = normalizedClockTime(match[1]);
  const end = normalizedClockTime(match[2]);
  return start && end ? `${start}-${end}` : undefined;
}

function normalizedHourRange(value: string) {
  const match = value.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (!match) return undefined;
  const start = normalizedClockTime(match[1]);
  const end = normalizedClockTime(match[2]);
  return start && end ? `${start}-${end}` : undefined;
}

function normalizedClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3]?.toLocaleLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function emptyFacts(): ExtractedBusinessFacts { return { categories: [], services: [], serviceAreas: [], socialLinks: [], bookingLinks: [], orderingLinks: [], pressLinks: [] }; }
function sitemapEntries(xml: string): Array<{ url: string; lastModified?: string }> {
  const entries: Array<{ url: string; lastModified?: string }> = [];
  const blocks = [...xml.matchAll(/<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi)];
  for (const block of blocks) {
    const location = block[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1];
    if (!location) continue;
    const lastModified = block[1].match(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim();
    entries.push({ url: decodeXml(location.trim()), ...(lastModified ? { lastModified } : {}) });
  }
  if (entries.length) return entries;
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) => ({ url: decodeXml(match[1].trim()) }));
}
function decodeSitemapBytes(bytes: Buffer, url: string, contentType: string | undefined) {
  const compressed = /\.gz(?:$|\?)/i.test(url) || /(?:application\/(?:x-)?gzip|gzip)/i.test(contentType ?? "") || (bytes[0] === 0x1f && bytes[1] === 0x8b);
  return (compressed ? gunzipSync(bytes) : bytes).toString("utf8");
}
function decodeXml(value: string) { return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'"); }
function normalizeSameSite(value: string, source: URL, preserveSearch = true) { try { const url = new URL(value, source); if (!sameSite(url.hostname, source.hostname) || !["http:", "https:"].includes(url.protocol)) return undefined; url.hash = ""; if (!preserveSearch) url.search = ""; url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/"; return url.href; } catch { return undefined; } }
function sameSite(left: string, right: string) { const clean = (value: string) => value.toLowerCase().replace(/^www\./, ""); return clean(left) === clean(right); }
function meaningfulUrl(value: string) { const path = new URL(value).pathname.toLowerCase(); return !/\.(?:avif|bmp|csv|docx?|eot|gif|gz|ico|jpe?g|json|kml|kmz|m4a|mov|mp3|mp4|mpeg|odt|ogg|pdf|png|pptx?|rar|rss|svg|tar|tiff?|txt|webm|webp|woff2?|xlsx?|xml|zip)$/.test(path); }
function transientStatus(status: number) { return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500; }
function classifyHttpFailure(response: Response): GenerationFetchFailureReason {
  if (response.status === 401) return "authentication_required";
  if (response.status === 403) {
    return response.headers.get("cf-mitigated")?.toLowerCase() === "challenge"
      ? "bot_challenge"
      : "access_denied";
  }
  if (response.status === 429) return "rate_limited";
  if (response.status >= 500) return "temporary_upstream_failure";
  return "http_error";
}
function accessClassificationFor(reason: GenerationFetchFailureReason): GenerationFetchDiagnostics["accessClassification"] {
  return reason === "authentication_required" || reason === "access_denied" || reason === "bot_challenge" ? reason : undefined;
}
function parsedRetryAfterMs(value: string | null, now: number) {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
function retryBackoffMs(attempt: number, random: () => number = Math.random) {
  const base = 1_000 * (2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.max(0, Math.min(1, random())) * 251);
}
function boundedMessage(error: unknown) { const message = error instanceof Error ? error.message : String(error); return message.slice(0, 1000); }
function unique<T>(values: T[]) { return [...new Set(values)]; }
function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (milliseconds <= 0) {
    signal.throwIfAborted();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, Math.min(milliseconds, 2_147_483_647));
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("generation_crawl_cancelled"));
    };
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function terminalPage(
  url: string,
  discoveryReason: string,
  outcome: "excluded" | "failed" | "unfinished",
  reason: string,
  sitemap?: { sitemapUrl?: string; sitemapLastModified?: string } | { url: string; lastModified?: string },
  status?: number,
  contentType?: string,
  fetchAttempts = 0,
  rawCaptureKey?: string
): WebsiteGenerationIngestionPage {
  const sitemapUrl = "sitemapUrl" in (sitemap ?? {})
    ? (sitemap as { sitemapUrl?: string }).sitemapUrl
    : (sitemap as { url?: string } | undefined)?.url;
  const sitemapLastModified = "sitemapLastModified" in (sitemap ?? {})
    ? (sitemap as { sitemapLastModified?: string }).sitemapLastModified
    : (sitemap as { lastModified?: string } | undefined)?.lastModified;
  return {
    url,
    finalUrl: url,
    discoveryReason,
    sitemapUrl,
    sitemapLastModified,
    fetchAttempts,
    browserRendered: false,
    evidenceClass: "unknown",
    outcome,
    status,
    reason,
    contentType,
    indexability: "unknown",
    headings: [],
    wordCount: 0,
    internalLinks: [],
    externalLinks: [],
    rawCaptureKey,
    summary: {}
  };
}

function captureFromFetch(
  role: GenerationResourceRole,
  requestedUrl: string,
  fetched: {
    finalUrl: string;
    status: number;
    contentType?: string;
    redirectChain: Array<{ url: string; status: number; location: string }>;
    headers: Record<string, string>;
    attemptHistory?: GenerationFetchAttempt[];
    retryWaitMs?: number;
    throttleEvents?: number;
    accessClassification?: GenerationFetchDiagnostics["accessClassification"];
  },
  bytes: Buffer
): Omit<GenerationCrawlCapture, "key"> {
  return {
    captureKind: "http_response",
    role,
    requestedUrl,
    finalUrl: fetched.finalUrl,
    outcome: fetched.status >= 200 && fetched.status < 400 ? "fetched" : "failed",
    ...(fetched.status >= 400 ? { reason: `http_${fetched.status}` } : {}),
    status: fetched.status,
    contentType: fetched.contentType || "application/octet-stream",
    bytes,
    redirectChain: fetched.redirectChain,
    headers: fetched.headers,
    initiatorUrls: [],
    metadata: fetchDiagnosticMetadata(fetched)
  };
}

function captureFromFailedFetch(
  role: GenerationResourceRole,
  requestedUrl: string,
  fetched: GenerationFetchFailure
): Omit<GenerationCrawlCapture, "key"> | undefined {
  if (!fetched.bytes || !fetched.finalUrl || fetched.status === undefined || !fetched.redirectChain || !fetched.headers) {
    return fetched.downloadedBytes ? {
      captureKind: "http_response",
      role,
      requestedUrl,
      finalUrl: fetched.finalUrl,
      outcome: fetched.reason === "unsupported_content" || fetched.reason === "unsafe_url" ? "excluded" : "failed",
      reason: fetched.reason,
      status: fetched.status,
      contentType: fetched.contentType,
      redirectChain: fetched.redirectChain ?? [],
      headers: fetched.headers ?? {},
      initiatorUrls: [],
      metadata: {
        downloadedBytes: fetched.downloadedBytes,
        ...(fetchDiagnosticMetadata(fetched) ?? {})
      }
    } : undefined;
  }
  const captured = captureFromFetch(role, requestedUrl, {
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType: fetched.contentType,
    redirectChain: fetched.redirectChain,
    headers: fetched.headers
  }, fetched.bytes);
  return {
    ...captured,
    outcome: fetched.reason === "unsupported_content" || fetched.reason === "unsafe_url" ? "excluded" : "failed",
    reason: fetched.reason,
    bytes: fetched.reason === "unsupported_content" || fetched.reason === "unsafe_url" ? undefined : captured.bytes,
    metadata: {
      ...(fetched.reason === "unsupported_content" || fetched.reason === "unsafe_url" ? { downloadedBytes: fetched.bytes.length } : {}),
      ...(fetchDiagnosticMetadata(fetched) ?? {})
    }
  };
}

function fetchDiagnosticMetadata(fetched: Partial<GenerationFetchDiagnostics>) {
  const attemptHistory = fetched.attemptHistory ?? [];
  const retryCount = Math.max(0, attemptHistory.length - 1);
  if (!attemptHistory.length && !fetched.retryWaitMs && !fetched.throttleEvents && !fetched.accessClassification) return undefined;
  return {
    attempts: attemptHistory,
    retryCount,
    retryWaitMs: fetched.retryWaitMs ?? 0,
    throttleEvents: fetched.throttleEvents ?? 0,
    ...(fetched.accessClassification ? { accessClassification: fetched.accessClassification } : {})
  };
}

function safeResponseHeaders(headers: Headers) {
  return safeHeaderRecord(Object.fromEntries(headers.entries()));
}

function safeHeaderRecord(headers: Record<string, string>) {
  const allowed = [
    "access-control-allow-credentials",
    "access-control-allow-origin",
    "cache-control",
    "content-language",
    "content-security-policy",
    "content-type",
    "cf-mitigated",
    "date",
    "etag",
    "last-modified",
    "link",
    "location",
    "retry-after",
    "x-robots-tag"
  ];
  return Object.fromEntries(allowed.flatMap((name) => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return value ? [[name, value.slice(0, 4_000)] as const] : [];
  }));
}

function documentIndexability(html: string, headers: Record<string, string>) {
  const robotsMeta = [...html.matchAll(/<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/gi)]
    .map((match) => match[1]).join(",");
  const directive = `${robotsMeta},${headers["x-robots-tag"] ?? ""}`;
  return /(?:^|[,\s])noindex(?:[,\s]|$)/i.test(directive) ? "noindex" as const : "indexable" as const;
}

function extractHeadings(html: string) {
  return [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map((match) => boundedUnicodeText(decodeHtmlText(match[1]
      .replace(/<!--[^]*?-->/g, " ")
      .replace(/<(?:script|style|svg|noscript)\b[^]*?<\/(?:script|style|svg|noscript)>/gi, " ")
      .replace(/<[^>]+>/g, " ")), 500))
    .filter(Boolean)
    .slice(0, 100);
}

function boundedUnicodeText(value: string, maximumCodepoints: number) {
  return [...value].slice(0, maximumCodepoints).join("").trim();
}

function extractDocumentText(html: string) {
  return decodeHtmlText(html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(?:script|style|svg|noscript)\b[^]*?<\/(?:script|style|svg|noscript)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|div|section|article|main|header|footer|nav)>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function decodeHtmlText(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDocumentLinks(html: string, baseUrl: string, sourceHostname: string) {
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/gi)) {
    const raw = match[1] ?? match[2];
    if (!raw || /^(?:mailto:|tel:|javascript:|data:|#)/i.test(raw)) continue;
    try {
      const resolved = new URL(raw, baseUrl);
      resolved.hash = "";
      if (!["http:", "https:"].includes(resolved.protocol)) continue;
      (sameSite(resolved.hostname, sourceHostname) ? internal : external).add(resolved.href);
    } catch {
      // Malformed links are handled by static verification if retained in authored output.
    }
  }
  return { internal: [...internal].sort(), external: [...external].sort() };
}

function wordCount(value: string) {
  return value ? value.split(/\s+/).filter(Boolean).length : 0;
}

function primaryFailureCode(sourceUrl: string, ingestion: WebsiteGenerationIngestion): WebsiteCrawlFailureCode {
  const source = new URL(sourceUrl);
  const failure = ingestion.failures.find((entry) =>
    normalizeSameSite(entry.url, source) === normalizeSameSite(sourceUrl, source)
  ) ?? ingestion.failures[0];
  if (!failure) return "crawl_temporarily_unavailable";
  if (failure.reason === "unsafe_url") return "source_invalid";
  if (failure.reason === "response_too_large" || failure.reason === "unsupported_content") return "crawl_unsupported_content";
  if (
    failure.reason === "timeout"
    || failure.reason === "network"
    || (failure.status !== undefined && transientStatus(failure.status))
  ) return "crawl_temporarily_unavailable";
  return "crawl_primary_unavailable";
}

function primaryFailureDiagnostic(sourceUrl: string, ingestion: WebsiteGenerationIngestion) {
  const source = new URL(sourceUrl);
  const failure = ingestion.failures.find((entry) =>
    normalizeSameSite(entry.url, source) === normalizeSameSite(sourceUrl, source)
  ) ?? ingestion.failures[0];
  if (failure) return `Primary page failed (${failure.reason}${failure.status ? ` ${failure.status}` : ""}): ${failure.message}`;
  return "The crawl completed without retaining a primary page.";
}
