import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  crawlWebsiteForGeneration,
  generationIngestionLimits
} from "../packages/business-data/generation-crawler";
import {
  generationCrawlerProductToken,
  generationCrawlerUserAgent,
  parseRobotsPolicy,
  robotsAllows
} from "../packages/business-data/robots-policy";
import { PublicFetchUrlError } from "../lib/url-safety";
import { retainedContactConsensus } from "../packages/business-data/website-ingestion";

const origin = "https://fixture.example";

const squarespaceRules = parseRobotsPolicy("User-agent: *\nDisallow: /*?author=*\n");
assert.equal(robotsAllows(`${origin}/`, squarespaceRules.rules), true);
assert.equal(robotsAllows(`${origin}/about?author=123`, squarespaceRules.rules), false);

const exactAgent = parseRobotsPolicy(`
User-agent: *
Disallow: /

User-agent: Lodesta
Disallow: /prefix-only

User-agent: lodestawebsitecrawler
Allow: /
`);
assert.equal(robotsAllows(`${origin}/`, exactAgent.rules), true);
assert.match(generationCrawlerUserAgent, new RegExp(generationCrawlerProductToken));
assert.equal("selectedPages" in generationIngestionLimits, false);
assert.equal("browserFallbackPages" in generationIngestionLimits, false);
assert.equal("totalMs" in generationIngestionLimits, false);

const retainedContacts = retainedContactConsensus([
  { url: `${origin}/`, extractedText: "Call (512) 555-0198 or email hello@fixture.example." },
  { url: `${origin}/services`, extractedText: "Questions? 512.555.0198 · HELLO@FIXTURE.EXAMPLE" },
  { url: `${origin}/about`, extractedText: "Office: +1 512 555 0198 · hello@fixture.example" },
  { url: `${origin}/article`, extractedText: "Article author: writer@fixture.example · reference 212-555-0134" }
]);
assert.deepEqual(retainedContacts, {
  phone: "+15125550198",
  email: "hello@fixture.example"
});
assert.deepEqual(retainedContactConsensus([
  { url: `${origin}/one`, extractedText: "Call 512-555-0198" },
  { url: `${origin}/two`, extractedText: "Call 212-555-0134" }
]), { phone: undefined, email: undefined });

const headingOrigin = "https://heading-boundary.example";
const normalizedHeading = await crawlWebsiteForGeneration({
  url: `${headingOrigin}/`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (path === "/") return response(`<!doctype html><title>Heading boundary</title><h1><span>${"Portable heading ".repeat(50)}</span><svg><title>${"untrusted artwork ".repeat(50)}</title></svg></h1><p>${"Substantive source text ".repeat(20)}</p>`, 200);
    throw new Error(`unexpected_heading_fixture_url:${url}`);
  }
});
const retainedHeading = normalizedHeading.ingestion.pages.find((page) => page.url === `${headingOrigin}/`)?.headings[0];
assert(retainedHeading, "The normalized heading was not retained.");
assert.equal([...retainedHeading].length, 500, "A heading was not bounded by Unicode scalar count before schema validation.");
assert.doesNotMatch(retainedHeading, /<|>|untrusted artwork/i, "Nested markup or SVG text leaked into heading metadata.");

const sitemapPages = Array.from({ length: 260 }, (_, index) => `/pages/page-${String(index).padStart(3, "0")}`);
const firstSitemap = urlSet(sitemapPages.slice(0, 130));
const secondSitemap = urlSet([
  ...sitemapPages.slice(130),
  "/private/secret",
  "/assets/brochure.pdf",
  "/redirect-old",
  "/redirect-new"
]);
const sitemapIndex = sitemapIndexXml(["/sitemaps/pages-a.xml.gz", "/sitemaps/nested-index.xml"]);
const nestedIndex = sitemapIndexXml(["/sitemaps/pages-b.xml", "/sitemaps/index.xml"]);
const attempts = new Map<string, number>();

const comprehensive = await crawlWebsiteForGeneration({
  url: `${origin}/`,
  validateUrl: async (value) => value,
  limits: {
    concurrentPerOrigin: 8,
    minimumStartSpacingMs: 0,
    requestTimeoutMs: 2_000,
    transientRetries: 1
  },
  sleep: async () => undefined,
  random: () => 0,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    attempts.set(path, (attempts.get(path) ?? 0) + 1);
    if (path === "/robots.txt") {
      return response(`User-agent: *\nDisallow: /private\nSitemap: ${origin}/sitemaps/index.xml\n`, 200, "text/plain");
    }
    if (path === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (path === "/sitemaps/index.xml") return response(sitemapIndex, 200, "application/xml");
    if (path === "/sitemaps/nested-index.xml") return response(nestedIndex, 200, "application/xml");
    if (path === "/sitemaps/pages-a.xml.gz") return response(gzipSync(firstSitemap), 200, "application/gzip");
    if (path === "/sitemaps/pages-b.xml") return response(secondSitemap, 200, "application/xml");
    if (path === "/redirect-old") return response("", 301, "text/html", { location: `${origin}/redirect-new` });
    if (path === "/pages/page-010" && attempts.get(path) === 1) return response("retry", 503, "text/plain");
    if (path === "/") return response(pageHtml("Home", ["/linked-only", "/assets/site-map.kml"]), 200);
    if (path === "/linked-only") return response(pageHtml("Linked-only page"), 200);
    if (path === "/redirect-new") return response(pageHtml("Redirect destination"), 200);
    const pageMatch = path.match(/^\/pages\/page-(\d{3})$/);
    if (pageMatch) {
      const pageNumber = Number(pageMatch[1]);
      if (pageNumber === 5) {
        return response(pageHtml("Noindex retained", [], '<meta name="robots" content="noindex,follow">'), 200);
      }
      if (pageNumber === 6) {
        return response(pageHtml("Canonical retained", [], `<link rel="canonical" href="${origin}/pages/page-006">`), 200);
      }
      if (pageNumber === 7 || pageNumber === 8) return response(pageHtml("Duplicate body"), 200);
      if (pageNumber === 9) return response("<!doctype html><title>JavaScript shell</title><div id=app></div>", 200);
      return response(pageHtml(`Substantive page ${pageNumber}`), 200);
    }
    throw new Error(`unexpected_fixture_url:${url}`);
  },
  browserFetch: async (url) => pageHtml(`Rendered ${new URL(url).pathname}`)
});

assert.equal(comprehensive.ingestion.coverage, "restricted");
assert.equal(comprehensive.ingestion.completionReason, "restricted");
assert(comprehensive.ingestion.counts.discovered > 260, "The crawler did not retain the complete sitemap and linked-page inventory.");
assert(comprehensive.ingestion.counts.fetched >= 263, "An implicit page cap prevented complete fetching.");
assert.equal(comprehensive.ingestion.counts.unfinished, 0);
assert.equal(comprehensive.ingestion.counts.failed, 0);
assert.equal(comprehensive.ingestion.counts.browserRendered, 1);
assert.equal(comprehensive.ingestion.pages.every((page) => ["fetched", "excluded", "failed", "unfinished"].includes(page.outcome)), true);
assert.equal(comprehensive.ingestion.pages.some((page) => page.reason === "selection_limit"), false);
assert.equal(comprehensive.ingestion.pages.find((page) => page.url === `${origin}/private/secret`)?.reason, "robots_disallowed");
assert.equal(comprehensive.ingestion.pages.find((page) => page.url === `${origin}/assets/brochure.pdf`)?.reason, "unsupported_content");
assert.equal(comprehensive.ingestion.pages.find((page) => page.url === `${origin}/assets/site-map.kml`)?.reason, "unsupported_content");
assert.equal(comprehensive.ingestion.pages.find((page) => page.url === `${origin}/pages/page-005`)?.indexability, "noindex");
assert.equal(comprehensive.ingestion.pages.find((page) => page.url === `${origin}/linked-only`)?.discoveryReason, "linked_page");
assert.equal(attempts.get("/pages/page-010"), 2, "Transient document failures were not retried.");
assert(comprehensive.captures.some((capture) => capture.role === "sitemap" && capture.requestedUrl.endsWith(".gz")), "The gzip sitemap capture was not retained.");
assert(comprehensive.captures.some((capture) => capture.requestedUrl === `${origin}/sitemap.xml` && capture.outcome === "failed" && capture.reason === "not_found" && capture.bytes), "An absent conventional sitemap response was not retained without degrading document coverage.");
assert(comprehensive.captures.some((capture) => capture.role === "robots"), "robots.txt was not retained.");
assert(comprehensive.captures.some((capture) => capture.role === "rendered_document"), "Rendered DOM evidence was not retained.");
assert(comprehensive.captures.some((capture) => capture.redirectChain.some((hop) => hop.status === 301)), "Redirect-chain evidence was not retained.");
assert.equal(comprehensive.documents.length, comprehensive.ingestion.counts.fetched);

const adaptiveOrigin = "https://adaptive.example";
const adaptiveAttempts = new Map<string, number>();
const adaptiveWaits: number[] = [];
let adaptiveNow = Date.parse("2026-08-01T12:00:00.000Z");
const recoveryPages = Array.from({ length: 45 }, (_, index) => `/recovery-${String(index).padStart(2, "0")}`);
const adaptive = await crawlWebsiteForGeneration({
  url: `${adaptiveOrigin}/`,
  validateUrl: async (value) => value,
  now: () => adaptiveNow,
  sleep: async (milliseconds, signal) => {
    signal.throwIfAborted();
    adaptiveWaits.push(milliseconds);
    adaptiveNow += milliseconds;
  },
  random: () => 0,
  limits: { transientRetries: 1 },
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    adaptiveAttempts.set(path, (adaptiveAttempts.get(path) ?? 0) + 1);
    if (path === "/robots.txt") return response(`User-agent: ${generationCrawlerProductToken}\nAllow: /\n`, 200, "text/plain");
    if (path === "/sitemap.xml") return response(urlSetFor(adaptiveOrigin, ["/", "/rate-date", "/rate-seconds", ...recoveryPages]), 200, "application/xml");
    if (path === "/rate-seconds" && adaptiveAttempts.get(path) === 1) return response("slow down", 429, "text/plain", { "retry-after": "2" });
    if (path === "/rate-date" && adaptiveAttempts.get(path) === 1) return response("temporarily unavailable", 503, "text/plain", { "retry-after": new Date(adaptiveNow + 3_000).toUTCString() });
    if (path === "/" || path.startsWith("/recovery-") || path.startsWith("/rate-")) return response(pageHtml(path === "/" ? "Adaptive home" : path), 200);
    throw new Error(`unexpected_adaptive_url:${url}`);
  }
});
assert.equal(adaptive.ingestion.counts.failed, 0);
assert.equal(adaptiveAttempts.get("/rate-seconds"), 2);
assert.equal(adaptiveAttempts.get("/rate-date"), 2);
assert(adaptiveWaits.some((milliseconds) => milliseconds >= 2_000), "The shared origin cooldown did not delay throttled work.");
const adaptiveDiagnostics = adaptive.captures
  .flatMap((capture) => Array.isArray(capture.metadata?.attempts) ? capture.metadata.attempts : [])
  .filter((attempt): attempt is { reason: string; originConcurrency: number } => Boolean(attempt) && typeof attempt === "object" && typeof (attempt as { reason?: unknown }).reason === "string" && typeof (attempt as { originConcurrency?: unknown }).originConcurrency === "number");
assert(adaptiveDiagnostics.some((attempt) => ["rate_limited", "temporary_upstream_failure"].includes(attempt.reason) && attempt.originConcurrency === 2), "Repeated throttling did not reduce origin concurrency to two.");
assert(adaptiveDiagnostics.some((attempt) => attempt.reason === "success" && attempt.originConcurrency > 2), "Sustained success did not recover origin concurrency.");
const rateCapture = adaptive.captures.find((capture) => capture.requestedUrl === `${adaptiveOrigin}/rate-seconds` && capture.role === "document");
const dateCapture = adaptive.captures.find((capture) => capture.requestedUrl === `${adaptiveOrigin}/rate-date` && capture.role === "document");
assert.equal(rateCapture?.metadata?.retryCount, 1);
assert.equal(rateCapture?.metadata?.retryWaitMs, 2_000);
assert.equal(rateCapture?.metadata?.throttleEvents, 1);
assert.equal(dateCapture?.metadata?.retryCount, 1);
assert.equal(dateCapture?.metadata?.retryWaitMs, 3_000);
assert.equal(dateCapture?.metadata?.throttleEvents, 1);

const classificationOrigin = "https://classification.example";
const classified = await crawlWebsiteForGeneration({
  url: `${classificationOrigin}/`,
  validateUrl: async (value) => value,
  limits: { transientRetries: 0 },
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response(urlSetFor(classificationOrigin, ["/", "/auth", "/denied", "/challenge", "/limited", "/upstream"]), 200, "application/xml");
    if (path === "/") return response(pageHtml("Classification home"), 200);
    if (path === "/auth") return response("authentication required", 401);
    if (path === "/denied") return response("access denied", 403);
    if (path === "/challenge") return response("challenge", 403, "text/html", { "cf-mitigated": "challenge" });
    if (path === "/limited") return response("rate limited", 429);
    if (path === "/upstream") return response("upstream unavailable", 504);
    throw new Error(`unexpected_classification_url:${url}`);
  }
});
const classifiedReasons = new Map(classified.ingestion.pages.map((page) => [new URL(page.url).pathname, page.reason]));
assert.equal(classifiedReasons.get("/auth"), "authentication_required");
assert.equal(classifiedReasons.get("/denied"), "access_denied");
assert.equal(classifiedReasons.get("/challenge"), "bot_challenge");
assert.equal(classifiedReasons.get("/limited"), "rate_limited");
assert.equal(classifiedReasons.get("/upstream"), "temporary_upstream_failure");

const safeOrigin = "https://safe-source.example";
const unsafeDependency = await crawlWebsiteForGeneration({
  url: `${safeOrigin}/`,
  validateUrl: async (value) => {
    if (new URL(value).hostname === "unresolvable-dependency.example") {
      throw new PublicFetchUrlError("dns_unavailable", "URL host could not be resolved for safety checks.");
    }
    return value;
  },
  limits: { transientRetries: 0 },
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    if (parsed.hostname === "cdn-dependency.example") return response("", 302, "text/plain", { location: "https://unresolvable-dependency.example/asset.png" });
    if (parsed.pathname === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (parsed.pathname === "/sitemap.xml") return response(urlSetFor(safeOrigin, ["/"]), 200, "application/xml");
    if (parsed.pathname === "/") return response(`${pageHtml("Safe source")}<img src="https://cdn-dependency.example/asset.png" alt="">`, 200);
    throw new Error(`unexpected_unsafe_dependency_url:${url}`);
  }
});
assert.equal(unsafeDependency.ingestion.coverage, "complete");
assert(unsafeDependency.captures.some((capture) => capture.requestedUrl === "https://cdn-dependency.example/asset.png" && capture.outcome === "excluded" && capture.reason === "unsafe_url"), "An unsafe dependency redirect aborted or degraded the source crawl instead of becoming an explicit exclusion.");

const deadlineOrigin = "https://deadline.example";
const deadlineController = new AbortController();
const deadlineResult = await crawlWebsiteForGeneration({
  url: `${deadlineOrigin}/`,
  signal: deadlineController.signal,
  validateUrl: async (value) => value,
  random: () => 0,
  sleep: async (_milliseconds, signal) => {
    deadlineController.abort(new Error("generation crawl deadline"));
    signal.throwIfAborted();
  },
  limits: { concurrentPerOrigin: 1, transientRetries: 1 },
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response(urlSetFor(deadlineOrigin, ["/", "/limited", "/never-started"]), 200, "application/xml");
    if (path === "/") return response(pageHtml("Deadline home"), 200);
    if (path === "/limited") return response("slow down", 429);
    if (path === "/never-started") return response(pageHtml("Never started"), 200);
    throw new Error(`unexpected_deadline_url:${url}`);
  }
});
assert.equal(deadlineResult.ingestion.coverage, "incomplete");
assert.equal(deadlineResult.ingestion.completionReason, "deadline");
assert(deadlineResult.ingestion.counts.unfinished >= 1, "Deadline cancellation hid queued unfinished work.");

const fuseOrigin = "https://fuse.example";
const fuseResult = await crawlWebsiteForGeneration({
  url: `${fuseOrigin}/`,
  validateUrl: async (value) => value,
  limits: {
    concurrentPerOrigin: 1,
    minimumStartSpacingMs: 0,
    requestTimeoutMs: 2_000,
    transientRetries: 0,
    rawResponseFuseBytes: 700
  },
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /\n", 200, "text/plain");
    if (path === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (path === "/") return response(pageHtml("Large homepage", ["/unfinished"], "", "x ".repeat(500)), 200);
    if (path === "/unfinished") return response(pageHtml("Should remain unfinished"), 200);
    throw new Error(`unexpected_fuse_url:${url}`);
  }
});
assert.equal(fuseResult.ingestion.coverage, "incomplete");
assert.equal(fuseResult.ingestion.completionReason, "capture_size_fuse");
assert(fuseResult.ingestion.counts.unfinished >= 1, "The crawl hid its unfinished queue after crossing the byte fuse.");

const dependencyOrigin = "https://dependency-failure.example";
const dependencyFailure = await crawlWebsiteForGeneration({
  url: `${dependencyOrigin}/`,
  validateUrl: async (value) => value,
  limits: { transientRetries: 0 },
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (path === "/") return response('<!doctype html><html><head><title>Dependency failure</title></head><body><h1>Dependency failure</h1><p>This page has enough useful source content to avoid browser fallback while retaining its referenced design dependency.</p><img src="/missing.webp" alt="Missing"></body></html>', 200);
    if (path === "/missing.webp") return response("missing", 404, "image/webp");
    throw new Error(`unexpected_dependency_url:${url}`);
  }
});
assert.equal(dependencyFailure.ingestion.coverage, "incomplete");
assert.equal(dependencyFailure.ingestion.completionReason, "failures");
assert(dependencyFailure.captures.some((capture) => capture.requestedUrl.endsWith("/missing.webp") && capture.outcome === "failed"));

console.log(JSON.stringify({
  ok: true,
  discovered: comprehensive.ingestion.counts.discovered,
  fetched: comprehensive.ingestion.counts.fetched,
  excluded: comprehensive.ingestion.counts.excluded,
  gzipSitemaps: comprehensive.captures.filter((capture) => capture.role === "sitemap" && capture.requestedUrl.endsWith(".gz")).length,
  fuseCoverage: fuseResult.ingestion.coverage,
  dependencyFailureCoverage: dependencyFailure.ingestion.coverage
}));

function urlSet(paths: string[]) {
  return urlSetFor(origin, paths);
}

function urlSetFor(targetOrigin: string, paths: string[]) {
  return `<?xml version="1.0"?><urlset>${paths.map((path) => `<url><loc>${targetOrigin}${path}</loc><lastmod>2026-07-30</lastmod></url>`).join("")}</urlset>`;
}

function sitemapIndexXml(paths: string[]) {
  return `<?xml version="1.0"?><sitemapindex>${paths.map((path) => `<sitemap><loc>${origin}${path}</loc></sitemap>`).join("")}</sitemapindex>`;
}

function pageHtml(title: string, links: string[] = [], head = "", extra = "") {
  const body = `${title} provides substantial, useful first-party information for local customers. `.repeat(5);
  return `<!doctype html><html><head><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${body}${extra}</p>${links.map((href) => `<a href="${href}">${href}</a>`).join("")}</main></body></html>`;
}

function response(
  body: BodyInit,
  status = 200,
  contentType = "text/html; charset=utf-8",
  headers: Record<string, string> = {}
) {
  return new Response(body, { status, headers: { "content-type": contentType, ...headers } });
}
