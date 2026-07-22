import assert from "node:assert/strict";
import { crawlWebsiteForGeneration, fetchGenerationPageWithBrowser, generationIngestionLimits } from "../packages/business-data/generation-crawler";
import { canonicalizeUnderstandingEvidenceQuotes, understandWebsite, validateUnderstandingEvidence } from "../packages/business-data/understanding";

const pageStarts: number[] = [];
const site = new Map<string, { status?: number; type: string; body: string; headers?: Record<string, string> }>([
  ["/robots.txt", { type: "text/plain", body: "User-agent: *\nAllow: /\nSitemap: https://fixture.example/sitemap.xml\n" }],
  ["/sitemap.xml", { type: "application/xml", body: "<urlset><url><loc>https://fixture.example/</loc></url><url><loc>https://fixture.example/contact</loc></url></urlset>" }],
  ["/", { type: "text/html", body: pageHtml("Northstar Repair", "/contact", "Collision repair in Austin. Call our team or request an estimate at our Austin shop.") }],
  ["/contact", { type: "text/html", body: pageHtml("Contact Northstar", "/", "Visit our Austin shop or call the repair team to request an estimate for collision repair.") }]
]);
const fetched = await crawlWebsiteForGeneration({
  url: "https://fixture.example/",
  validateUrl: async (value) => value,
  fetchImpl: mockFetch(site, (url) => { if (!["/robots.txt", "/sitemap.xml"].includes(url.pathname)) pageStarts.push(Date.now()); }),
  browserFetch: async () => { throw new Error("browser should not be required"); },
  limits: { minimumStartSpacingMs: 20, totalMs: 10_000, requestTimeoutMs: 1_000 }
});
assert.equal(fetched.ingestion.coverage, "complete");
assert.equal(fetched.ingestion.counts.discovered, 2);
assert.equal(fetched.ingestion.counts.selected, 2);
assert.equal(fetched.ingestion.counts.fetched, 2);
assert(pageStarts.length === 2 && pageStarts[1] - pageStarts[0] >= 15, "request starts were not politely spaced across concurrent workers");
assert(fetched.ingestion.counts.modelTextCharacters <= generationIngestionLimits.modelTextCharacters, "model text budget was exceeded");

const manyUrls = Array.from({ length: 75 }, (_, index) => `https://many.example/services/service-${index + 1}`);
const manySite = new Map<string, { type: string; body: string }>([
  ["/robots.txt", { type: "text/plain", body: "User-agent: *\nAllow: /" }],
  ["/sitemap.xml", { type: "application/xml", body: `<urlset>${manyUrls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>` }],
  ...manyUrls.map((url, index) => [new URL(url).pathname, { type: "text/html", body: pageHtml(`Service ${index + 1}`, "/", `Detailed first-party service information for repair option ${index + 1}. Request a quote in Austin from our team.`) }] as const)
]);
const bounded = await crawlWebsiteForGeneration({
  url: manyUrls[0],
  validateUrl: async (value) => value,
  fetchImpl: mockFetch(manySite),
  browserFetch: async () => { throw new Error("browser should not be required"); },
  limits: { minimumStartSpacingMs: 0, totalMs: 20_000, requestTimeoutMs: 1_000 }
});
assert.equal(bounded.ingestion.coverage, "bounded");
assert.equal(bounded.ingestion.counts.discovered, 76);
assert.equal(bounded.ingestion.counts.selected, 50);
assert.equal(bounded.ingestion.counts.fetched, 50);
assert.equal(bounded.ingestion.skipped.filter((entry) => entry.reason === "selection_limit").length, 26);

let retryRequests = 0;
const retrySite = new Map<string, { status?: number; type: string; body: string }>([
  ["/robots.txt", { type: "text/plain", body: "User-agent: *\nAllow: /" }],
  ["/sitemap.xml", { type: "application/xml", body: "<urlset><url><loc>https://retry.example/</loc></url></urlset>" }],
  ["/", { type: "text/html", body: pageHtml("Retry Repair", "/", "Collision repair in Austin with phone and estimate request options for local drivers.") }]
]);
const retryFetch: typeof fetch = async (value, init) => {
  const url = new URL(typeof value === "string" ? value : value instanceof URL ? value.href : value.url);
  if (url.pathname === "/") {
    retryRequests += 1;
    if (retryRequests === 1) return new Response("temporary", { status: 503, headers: { "content-type": "text/plain" } });
  }
  return mockFetch(retrySite)(value, init);
};
const retried = await crawlWebsiteForGeneration({
  url: "https://retry.example/",
  validateUrl: async (value) => value,
  fetchImpl: retryFetch,
  browserFetch: async () => { throw new Error("browser should not be required"); },
  limits: { minimumStartSpacingMs: 0, totalMs: 10_000, requestTimeoutMs: 1_000 }
});
assert.equal(retryRequests, 2, "one transient fetch retry was not applied");
assert.equal(retried.ingestion.pages[0]?.fetchAttempts, 2);

const oversizedSite = new Map<string, { type: string; body: string; headers?: Record<string, string> }>([
  ["/robots.txt", { type: "text/plain", body: "User-agent: *\nAllow: /" }],
  ["/sitemap.xml", { type: "application/xml", body: "<urlset><url><loc>https://large.example/</loc></url></urlset>" }],
  ["/", { type: "text/html", body: "x".repeat(200), headers: { "content-length": "200" } }]
]);
const oversized = await crawlWebsiteForGeneration({
  url: "https://large.example/",
  validateUrl: async (value) => value,
  fetchImpl: mockFetch(oversizedSite),
  limits: { maximumHtmlBytes: 100, minimumStartSpacingMs: 0, totalMs: 10_000, requestTimeoutMs: 1_000 }
});
assert.equal(oversized.ingestion.coverage, "incomplete");
assert(oversized.ingestion.failures.some((failure) => failure.reason === "response_too_large"), "2 MB-equivalent response cap did not fail closed");

let unsafeRedirectRequests = 0;
const redirectFetch: typeof fetch = async (value) => {
  const url = new URL(typeof value === "string" ? value : value instanceof URL ? value.href : value.url);
  if (url.hostname !== "redirect.example") unsafeRedirectRequests += 1;
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
  if (url.pathname === "/sitemap.xml") return new Response('<urlset><url><loc>https://redirect.example/</loc></url></urlset>', { headers: { "content-type": "application/xml" } });
  return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private", "content-type": "text/html" } });
};
const redirected = await crawlWebsiteForGeneration({
  url: "https://redirect.example/",
  validateUrl: async (value) => value,
  fetchImpl: redirectFetch,
  limits: { minimumStartSpacingMs: 0, totalMs: 10_000, requestTimeoutMs: 1_000 }
});
assert.equal(unsafeRedirectRequests, 0, "generation crawl followed a cross-site or private redirect");
assert.equal(redirected.ingestion.coverage, "incomplete");

const shellSite = new Map<string, { type: string; body: string }>([
  ["/robots.txt", { type: "text/plain", body: "User-agent: *\nAllow: /" }],
  ["/sitemap.xml", { type: "application/xml", body: "<urlset><url><loc>https://shell.example/</loc></url><url><loc>https://shell.example/contact</loc></url></urlset>" }],
  ["/", { type: "text/html", body: '<html><head><title>Shell</title></head><body><a href="/contact">Contact</a></body></html>' }],
  ["/contact", { type: "text/html", body: '<html><head><title>Contact shell</title></head><body><a href="/">Home</a></body></html>' }]
]);
let browserCalls = 0;
const browserBounded = await crawlWebsiteForGeneration({
  url: "https://shell.example/",
  validateUrl: async (value) => value,
  fetchImpl: mockFetch(shellSite),
  browserFetch: async (url) => { browserCalls += 1; return pageHtml("Rendered shell", "/", `Rendered first-party details for ${url}, including Austin collision repair and an estimate form.`); },
  limits: { browserFallbackPages: 1, minimumStartSpacingMs: 0, totalMs: 10_000, requestTimeoutMs: 1_000 }
});
assert.equal(browserCalls, 1, "browser fallback exceeded its page budget");
assert.equal(browserBounded.ingestion.counts.browserRendered, 1);
assert(browserBounded.ingestion.skipped.some((entry) => entry.reason === "browser_limit"));

const browserLifecycleHtml = await fetchGenerationPageWithBrowser(
  "data:text/html,<main><h1>Browser lifecycle</h1></main>",
  AbortSignal.timeout(5_000),
  5_000,
  async (value) => value,
  async (value) => value
);
assert(browserLifecycleHtml.includes("Browser lifecycle"), "browser closed before page content serialization completed");

const block = fetched.ingestion.modelBlocks.find((candidate) => candidate.canonicalTokens.length > 0);
assert(block, "generation crawl did not retain reconstructible source tokens");
const token = block.canonicalTokens[0];
const evidence = {
  sourceBlockId: block.id,
  sourceUrl: block.sourceUrl,
  startToken: 0,
  endToken: 1,
  quote: block.displayText.slice(token.displayStart, token.displayEnd),
  evidenceClass: block.evidenceClass
};
const understanding = {
  schemaVersion: "website-understanding-v3" as const,
  businessName: { value: "Northstar Repair", evidence: [evidence] },
  observedCategory: { value: "Collision repair", confidence: 0.9, evidence: [evidence] },
  cleanedServices: [{ value: "Collision repair", evidence: [evidence] }],
  primaryConversion: { goal: "form_first" as const, evidence: [evidence] },
  locationOrServiceArea: { value: "Austin", evidence: [evidence] },
  businessStory: null,
  brandExpression: { voiceRegister: "direct" as const, evidence: [evidence], paletteSeed: { preferredHex: null } }
};
assert.deepEqual(validateUnderstandingEvidence(understanding, fetched.ingestion), []);
assert(validateUnderstandingEvidence({ ...understanding, businessName: { ...understanding.businessName, evidence: [{ ...evidence, quote: "not reconstructible" }] } }, fetched.ingestion).some((failure) => failure.includes("quote is not reconstructible")), "invalid model evidence was not rejected");
const canonicalized = canonicalizeUnderstandingEvidenceQuotes(
  { ...understanding, businessName: { ...understanding.businessName, evidence: [{ ...evidence, quote: `${evidence.quote}.` }] } },
  fetched.ingestion
);
assert.equal(canonicalized.businessName.evidence[0].quote, evidence.quote, "valid token-span quote was not canonicalized from source text");
const recoveredSpan = canonicalizeUnderstandingEvidenceQuotes(
  { ...understanding, businessName: { ...understanding.businessName, evidence: [{ ...evidence, endToken: 999 }] } },
  fetched.ingestion
);
assert.equal(recoveredSpan.businessName.evidence[0].startToken, evidence.startToken, "unique exact quote did not recover its source token start");
assert.equal(recoveredSpan.businessName.evidence[0].endToken, evidence.endToken, "unique exact quote did not recover its source token end");
assert.deepEqual(validateUnderstandingEvidence(recoveredSpan, fetched.ingestion), []);

const understandingRequests: Array<Record<string, unknown>> = [];
const priorApiKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "test-only-key";
try {
  const understood = await understandWebsite({
    sourceUrl: "https://fixture.example/",
    ingestion: fetched.ingestion,
    modelOverride: "test-understanding-model",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      understandingRequests.push(body);
      const modelOutput = understandingRequests.length === 1
        ? { ...understanding, businessName: { ...understanding.businessName, evidence: [{ ...evidence, endToken: 999, quote: "invalid first attempt" }] } }
        : { ...understanding, businessName: { ...understanding.businessName, evidence: [{ ...evidence, quote: `${evidence.quote}.` }] } };
      return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(modelOutput) }] }] });
    }
  });
  assert.equal(understood.provenance.attempts, 2, "understanding did not retry exactly once after evidence validation failed");
  assert.equal(understood.provenance.promptVersion, "website-understanding-v3.1");
  assert.equal(understood.businessName.evidence[0].quote, evidence.quote, "successful understanding did not retain the canonical source quote");
  const secondRequest = JSON.stringify(understandingRequests[1]);
  assert(secondRequest.includes("invalid token span"), "understanding retry did not receive structured validation failures");
} finally {
  if (priorApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = priorApiKey;
}

console.log(JSON.stringify({ ok: true, completeCoverage: "pass", boundedCoverage: "pass", politeness: "pass", retry: "pass", responseLimit: "pass", safeRedirects: "pass", browserBudget: "pass", browserLifecycle: "pass", reconstructibleEvidence: "pass", understandingRetry: "pass" }));

function pageHtml(title: string, href: string, copy: string) {
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="${copy}"></head><body><main><h1>${title}</h1><p>${copy} ${copy} ${copy}</p><a href="${href}">Continue</a><form><input type="tel" name="phone"><button>Request estimate</button></form></main></body></html>`;
}

function mockFetch(entries: Map<string, { status?: number; type: string; body: string; headers?: Record<string, string> }>, onRequest?: (url: URL) => void): typeof fetch {
  return async (value) => {
    const url = new URL(typeof value === "string" ? value : value instanceof URL ? value.href : value.url);
    onRequest?.(url);
    const entry = entries.get(url.pathname);
    if (!entry) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(entry.body, { status: entry.status ?? 200, headers: { "content-type": entry.type, ...entry.headers } });
  };
}
