import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { summarizeCrawlHtml, type CrawlAssessment } from "../lib/crawler";
import {
  crawlWebsiteForGeneration,
  generationIngestionLimits,
  sourceGalleryOriginalVariant
} from "../packages/business-data/generation-crawler";
import {
  generationCrawlerProductToken,
  generationCrawlerUserAgent,
  parseRobotsPolicy,
  robotsAllows
} from "../packages/business-data/robots-policy";
import { PublicFetchUrlError } from "../lib/url-safety";
import {
  assertSourceSuitableForGeneration,
  observedProof,
  retainedContactConsensus,
  selectObservedFirstPartyTestimonialBlocks,
  selectSourceContactAndLocation,
  selectBusinessCategories,
  selectSourceOfferingFacts,
  selectSourceLinksForGeneration,
  sourcePreparationDiagnosticsFor
} from "../packages/business-data/website-ingestion";

const origin = "https://fixture.example";

const repeatedPipeTitle = summarizeCrawlHtml(
  "<!doctype html><title>Home || Western Roof Company</title><main><h1>Western Roof Company</h1></main>",
  "https://westernroofco.com/"
);
assert.equal(
  repeatedPipeTitle.extractedFacts.name,
  "Western Roof Company",
  "A repeated-pipe title separator leaked a generic Home label into canonical business identity."
);

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
assert.equal(
  sourceGalleryOriginalVariant(
    `${origin}/wp-content/gallery/kitchen/thumbs/thumbs_after.jpg`,
    `${origin}/projects/kitchen`
  ),
  `${origin}/wp-content/gallery/kitchen/after.jpg`
);
assert.equal(
  sourceGalleryOriginalVariant(
    "https://cdn.example/gallery/thumbs/thumbs_after.jpg",
    `${origin}/projects/kitchen`
  ),
  undefined,
  "A cross-origin thumbnail was expanded into an unreferenced dependency."
);

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

const directorySummary = {
  ...summarizeCrawlHtml(pageHtml("Location directory"), "https://multi-location.example/locations/"),
  source: "primary" as const,
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("Location directory"), "https://multi-location.example/locations/").extractedFacts,
    phone: "+13365550100"
  }
};
const branchOneSummary = {
  ...summarizeCrawlHtml(pageHtml("North branch"), "https://multi-location.example/locations/north/"),
  source: "sampled_internal" as const,
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("North branch"), "https://multi-location.example/locations/north/").extractedFacts,
    phone: "+13365550101",
    address: { street: "100 North Street", city: "Abilene", region: "TX", postalCode: "79601", country: "US" }
  }
};
const branchTwoSummary = {
  ...summarizeCrawlHtml(pageHtml("South branch"), "https://multi-location.example/locations/south/"),
  source: "sampled_internal" as const,
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("South branch"), "https://multi-location.example/locations/south/").extractedFacts,
    phone: "+13365550102",
    address: { street: "200 South Street", city: "Abilene", region: "TX", postalCode: "79602", country: "US" }
  }
};
const multiLocationCrawl = {
  ...activeCrawlShell("https://multi-location.example/locations/"),
  finalUrl: "https://multi-location.example/locations/",
  pageSummaries: [directorySummary, branchOneSummary, branchTwoSummary]
};
assert.deepEqual(selectSourceContactAndLocation(multiLocationCrawl, { phone: "+13365550100" }), {
  phone: "+13365550100",
  email: undefined,
  address: undefined,
  geo: undefined,
  hours: undefined
}, "A multi-location directory silently paired its corporate phone with an arbitrary branch address.");
const specificBranchCrawl = {
  ...multiLocationCrawl,
  url: branchOneSummary.url,
  finalUrl: branchOneSummary.url,
  pageSummaries: [{ ...branchOneSummary, source: "primary" as const }, directorySummary]
};
assert.deepEqual(selectSourceContactAndLocation(specificBranchCrawl, { phone: "+13365550100" }), {
  phone: "+13365550101",
  email: undefined,
  address: branchOneSummary.extractedFacts.address,
  geo: undefined,
  hours: undefined
}, "A specific first-party branch URL lost its own contact/location scope.");

const reviewSummary = {
  ...summarizeCrawlHtml(`<!doctype html><title>Reviews</title><main><h1>Reviews</h1>
    <p>Our customers appreciate careful service and clear communication.</p>
    <blockquote>“They arrived when promised, protected the room, and left the finished walls looking excellent.”</blockquote>
    <p>"The crew explained every step and made the whole project easy for our family."</p>
  </main>`, "https://testimonial-source.example/reviews"),
  source: "primary" as const
};
const testimonialBlocks = selectObservedFirstPartyTestimonialBlocks([reviewSummary], reviewSummary.url);
assert.equal(testimonialBlocks.length, 2, "Generic reviews-page marketing copy was mistaken for a customer quotation, or explicit quotations were lost.");
const proofFacts: Parameters<typeof observedProof>[2] = [];
const retainedProof = observedProof({
  ...activeCrawlShell(reviewSummary.url),
  pageSummaries: [reviewSummary]
}, "source_testimonial_fixture", proofFacts, "2026-09-01T00:00:00.000Z");
assert(retainedProof.every((proof) => proof.kind === "testimonial" && proof.status === "confirmed" && proof.verbatim));
assert(proofFacts.every((fact) => fact.kind === "proof" && fact.publicEligible && fact.source.evidenceClass === "first_party"));

const cmsOrigin = "https://akeyexterminators.example";
const cmsPrimarySummary = {
  ...summarizeCrawlHtml(`<!doctype html><title>Home</title><main>
    <img class="site-logo" src="/brand.png" alt="A-Key Exterminators">
    <h1>A-Key Exterminators</h1>
    <h2>Our Services</h2><h3>Roaches</h3><h3>Ants</h3>
    <a href="https://www.facebook.com/joomdev">Facebook</a>
    <a href="/index.php?option=com_users&amp;view=login&amp;Itemid=415">Login</a>
  </main>`, `${cmsOrigin}/`),
  source: "primary" as const
};
assert.equal(cmsPrimarySummary.extractedFacts.name, "A-Key Exterminators", "A visible logo/H1 spelling lost to a concatenated structured-data or hostname fallback.");
assert.deepEqual(
  cmsPrimarySummary.extractedFacts.services,
  ["Roaches", "Ants"],
  "Offerings beneath an explicit services heading were not retained as source authority."
);
const cmsDemoSummary = {
  ...summarizeCrawlHtml(`<!doctype html><title>Review</title><main><h1>Review</h1>
    <blockquote>Contrary to popular belief, Lorem Ipsum is not simply random text. Richard McClintock found its classical source.</blockquote>
  </main>`, `${cmsOrigin}/index.php?option=com_content&view=article&id=58&Itemid=394`),
  source: "sampled_internal" as const,
  purposeTags: ["reviews" as const, "service_detail" as const]
};
assert.deepEqual(
  selectObservedFirstPartyTestimonialBlocks([cmsDemoSummary], `${cmsOrigin}/`),
  [],
  "CMS demo Lorem Ipsum was retained as publishable first-party testimonial proof."
);
let cmsArticleFetches = 0;
const cmsCanonicalized = await crawlWebsiteForGeneration({
  url: `${cmsOrigin}/`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    if (parsed.pathname === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (parsed.pathname === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (parsed.pathname === "/") return response(`<!doctype html><title>Home</title><main>
      <img class="site-logo" src="/brand.png" alt="A-Key Exterminators">
      <h1>A-Key Exterminators</h1>
      <h2>Our Services</h2><h3>Roaches</h3><h3>Ants</h3>
      <a href="https://www.facebook.com/joomdev">Facebook</a>
      <a href="/index.php?option=com_users&amp;view=login&amp;Itemid=415">Login</a>
      <a href="/index.php?option=com_content&amp;view=article&amp;id=58&amp;Itemid=394">Review A</a>
      <a href="/index.php?option=com_content&view=article&id=58&Itemid=708">Review B</a>
    </main>`, 200);
    if (parsed.pathname === "/index.php") {
      cmsArticleFetches += 1;
      assert.equal(parsed.searchParams.has("Itemid"), false, "A presentation-only Joomla Itemid survived crawl canonicalization.");
      return response(`<!doctype html><title>Review</title><main><h1>Review</h1><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></main>`, 200);
    }
    if (parsed.pathname === "/brand.png") return response("brand", 200, "image/png");
    throw new Error(`unexpected_cms_fixture_url:${url}`);
  }
});
assert.equal(cmsArticleFetches, 1, "HTML-escaped and presentation-only variants caused duplicate CMS document fetches.");
assert.equal(
  cmsCanonicalized.ingestion.pages.find((page) => new URL(page.url).pathname === "/index.php")?.evidenceClass,
  "unknown",
  "A CMS demo page remained eligible first-party business authority."
);
assert.deepEqual(
  new Set(selectSourceOfferingFacts(cmsCanonicalized.crawl, cmsCanonicalized.ingestion, []).map((offering) => offering.name)),
  new Set(["Roaches", "Ants"]),
  "CMS presentation routes displaced explicit first-party service headings in normalized offering authority."
);
const mixedOfferingOrigin = "https://mixed-offerings.example";
const mixedOfferingHome = {
  ...summarizeCrawlHtml(`<!doctype html><title>Home</title><main><h1>Mixed Offerings</h1>
    <h3>Our Services</h3><div><b>* Commercial &amp; Residential</b><br>
    * Wallpaper Installation<br>* Wallpaper Removal<br>* All Commercial Vinyl's<br>
    * Hand Woven Fabric's<br>* Screen Printed Photo Mural's<br>* Interior Painting<br>
    * Exterior Painting<br>* Painting over Wallcovering<br>* Wall Talker Installation</div>
    <a href="/simple-drywall-repairs">Simple Drywall Repairs</a>
  </main>`, `${mixedOfferingOrigin}/`),
  source: "primary" as const,
  purposeTags: ["home" as const]
};
const mixedOfferingDetail = {
  ...summarizeCrawlHtml(pageHtml("Simple Drywall Repairs"), `${mixedOfferingOrigin}/simple-drywall-repairs`),
  source: "sampled_internal" as const,
  purposeTags: ["service_detail" as const]
};
const mixedOfferingCrawl = {
  ...cmsCanonicalized.crawl,
  url: `${mixedOfferingOrigin}/`,
  finalUrl: `${mixedOfferingOrigin}/`,
  pageSummaries: [mixedOfferingHome, mixedOfferingDetail]
};
const mixedOfferingIngestion = {
  ...cmsCanonicalized.ingestion,
  pages: [mixedOfferingHome, mixedOfferingDetail].map((summary) => ({
    ...cmsCanonicalized.ingestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    summary,
    evidenceClass: "first_party" as const
  }))
};
assert.deepEqual(
  new Set(selectSourceOfferingFacts(mixedOfferingCrawl, mixedOfferingIngestion, []).map((offering) => offering.name)),
  new Set([
    "Simple Drywall Repairs",
    "Wallpaper Installation",
    "Wallpaper Removal",
    "All Commercial Vinyl's",
    "Hand Woven Fabric's",
    "Screen Printed Photo Mural's",
    "Interior Painting",
    "Exterior Painting",
    "Painting Over Wallcovering",
    "Wall Talker Installation"
  ]),
  "A partial set of route-shaped offerings suppressed an explicit first-party service section."
);
const multiStateScope = {
  ...summarizeCrawlHtml(`<!doctype html><title>About</title><main><h1>About</h1>
    <p>We install residential and commercial wall covering in South Carolina, North Carolina, Georgia, and Tennessee.</p>
  </main>`, `${mixedOfferingOrigin}/about`),
  source: "sampled_internal" as const,
  purposeTags: ["about" as const]
};
assert.deepEqual(
  multiStateScope.extractedFacts.serviceAreas,
  ["South Carolina", "North Carolina", "Georgia", "Tennessee"],
  "An explicit multi-state operating scope was lost during visible fact extraction."
);
const multiStateCrawl = { ...mixedOfferingCrawl, pageSummaries: [mixedOfferingHome, multiStateScope] };
const multiStateIngestion = {
  ...mixedOfferingIngestion,
  pages: [mixedOfferingHome, multiStateScope].map((summary) => ({
    ...mixedOfferingIngestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    summary,
    evidenceClass: "first_party" as const
  }))
};
assert.deepEqual(
  sourcePreparationDiagnosticsFor(multiStateCrawl, multiStateIngestion).facts
    .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
    .map((fact) => fact.value),
  ["South Carolina", "North Carolina", "Georgia", "Tennessee"],
  "A clearly stated multi-state operating scope failed first-party service-area verification."
);
const qualifiedRegionalScope = {
  ...summarizeCrawlHtml(`<!doctype html><title>Western Roof Company</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"RoofingContractor","name":"Western Roof Company","areaServed":"Texas"}</script>
    <main><h1>Western Roof Company</h1><p>Western Roofing serving Central Texas since 2021.</p></main>`, "https://westernroofco.com/"),
  source: "primary" as const,
  purposeTags: ["home" as const]
};
assert.deepEqual(
  new Set(qualifiedRegionalScope.extractedFacts.serviceAreas),
  new Set(["Texas", "Central Texas"]),
  "A qualified visible region with a trailing founding year was lost during extraction."
);
const qualifiedRegionalCrawl = {
  ...mixedOfferingCrawl,
  url: qualifiedRegionalScope.url,
  finalUrl: qualifiedRegionalScope.url,
  pageSummaries: [qualifiedRegionalScope]
};
const qualifiedRegionalIngestion = {
  ...mixedOfferingIngestion,
  pages: [{
    ...mixedOfferingIngestion.pages[0]!,
    url: qualifiedRegionalScope.url,
    finalUrl: qualifiedRegionalScope.url,
    summary: qualifiedRegionalScope,
    evidenceClass: "first_party" as const
  }]
};
assert.deepEqual(
  sourcePreparationDiagnosticsFor(qualifiedRegionalCrawl, qualifiedRegionalIngestion).facts
    .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
    .map((fact) => fact.value),
  ["Central Texas"],
  "A narrower visible first-party region failed to suppress a conflicting bare-state schema claim."
);
assert.deepEqual(
  selectSourceLinksForGeneration(`${cmsOrigin}/`, cmsCanonicalized.crawl),
  [{ kind: "website", label: "Source website", url: `${cmsOrigin}/` }],
  "A template vendor social profile or generic CMS login escaped as a required business destination."
);

const suitabilityOrigin = "https://suitability.example";
const activeWithHistoricalClosure = await crawlWebsiteForGeneration({
  url: `${suitabilityOrigin}/`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response(urlSetFor(suitabilityOrigin, ["/", "/local-history"]), 200, "application/xml");
    if (path === "/") return response(pageHtml("Active business", ["/local-history"], "", "Call today for current service."), 200);
    if (path === "/local-history") return response(pageHtml("Local history", [], "", "The former community college closed its doors during the First World War."), 200);
    throw new Error(`unexpected_suitability_fixture_url:${url}`);
  }
});
assert.doesNotThrow(
  () => assertSourceSuitableForGeneration(activeWithHistoricalClosure.crawl, activeWithHistoricalClosure.ingestion),
  "Historical prose on an internal page was mistaken for the current business closing."
);
const closedPrimary = {
  ...activeWithHistoricalClosure.crawl,
  pageSummaries: activeWithHistoricalClosure.crawl.pageSummaries.map((page) => page.source === "primary"
    ? {
        ...page,
        title: "Business permanently closed",
        metaDescription: "This business is permanently closed."
      }
    : page)
};
assert.throws(
  () => assertSourceSuitableForGeneration(closedPrimary, activeWithHistoricalClosure.ingestion),
  /business or location is closed/i,
  "An explicit closure notice on the supplied first-party page was not rejected."
);
const multiLocationIngestion = {
  ...activeWithHistoricalClosure.ingestion,
  sourceUrl: multiLocationCrawl.url,
  pages: [directorySummary, branchOneSummary, branchTwoSummary].map((summary, index) => ({
    ...activeWithHistoricalClosure.ingestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    discoveryReason: index === 0 ? "supplied_url" : "linked_page",
    evidenceClass: "first_party" as const,
    summary
  }))
};
assert.throws(
  () => assertSourceSuitableForGeneration(multiLocationCrawl, multiLocationIngestion),
  /multi-location directory/i,
  "A broad location directory silently became a single arbitrary branch project."
);

const authorityOrigin = "https://authority-filter.example";
const authorityFiltered = await crawlWebsiteForGeneration({
  url: `${authorityOrigin}/`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response(`User-agent: *\nAllow: /\nSitemap: ${authorityOrigin}/sitemap.xml`, 200, "text/plain");
    if (path === "/sitemap.xml") return response(urlSetFor(authorityOrigin, [
      "/",
      "/schedule-service/",
      "/local-pest-control/port-charlotte-pest-control/",
      "/blog/ecology/",
      "/blog/history/"
    ]), 200, "application/xml");
    if (path === "/") return response(pageHtml("Authority home", [
      "/schedule-service/",
      "/local-pest-control/port-charlotte-pest-control/",
      "/blog/ecology/",
      "/blog/history/",
      "https://calendly.com/fixture/consultation",
      "https://www.amazon.com/Flowers-Algernon-Daniel-Keyes-ebook/dp/B003WJQ74E/",
      "https://www.sportingnews.com/us/nfl/news/nfl-schedule-2022"
    ], "", "Serving Bradenton, Sarasota FL, and Venice."), 200);
    if (path === "/schedule-service/") return response(pageHtml("Schedule service"), 200);
    if (path === "/local-pest-control/port-charlotte-pest-control/") {
      return response(pageHtml("Port Charlotte pest control", [], "", "Service areas include Port Charlotte FL."), 200);
    }
    if (path === "/blog/ecology/") return response(pageHtml("Native ecology", [], "", "Our work means serving Florida's native species."), 200);
    if (path === "/blog/history/") return response(pageHtml("History", [], "", "The organization was once focused on serving Great Britain and his Heavenly Father under Two Masters."), 200);
    throw new Error(`unexpected_authority_fixture_url:${url}`);
  }
});
const authorityInternalPages = [
  summarizeCrawlHtml(
    pageHtml("Port Charlotte pest control", [], "", "Service areas include Port Charlotte FL."),
    `${authorityOrigin}/local-pest-control/port-charlotte-pest-control/`
  ),
  summarizeCrawlHtml(
    pageHtml("Native ecology", [], "", "Our work means serving Florida's native species."),
    `${authorityOrigin}/blog/ecology/`
  ),
  summarizeCrawlHtml(
    pageHtml("History", [], "", "The organization was once focused on serving Great Britain and his Heavenly Father under Two Masters."),
    `${authorityOrigin}/blog/history/`
  )
].map((page) => ({ ...page, source: "sampled_internal" as const }));
const authorityPages = [...authorityFiltered.crawl.pageSummaries, ...authorityInternalPages];
const authorityCrawl = {
  ...authorityFiltered.crawl,
  pageSummaries: authorityPages,
  extractedFacts: {
    ...authorityFiltered.crawl.extractedFacts,
    serviceAreas: [...new Set(authorityPages.flatMap((page) => page.extractedFacts.serviceAreas))],
    bookingLinks: [...new Set(authorityPages.flatMap((page) => page.extractedFacts.bookingLinks))]
  }
};
const authorityIngestion = {
  ...authorityFiltered.ingestion,
  pages: authorityPages.map((summary, index) => ({
    ...(authorityFiltered.ingestion.pages[0]!),
    url: summary.url,
    summary,
    evidenceClass: "first_party" as const,
    discoveryReason: index === 0 ? "supplied_url" as const : "linked_page" as const
  }))
};
const acceptedAreas = sourcePreparationDiagnosticsFor(authorityCrawl, authorityIngestion).facts
  .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
  .map((fact) => String(fact.value));
assert.deepEqual(
  new Set(acceptedAreas),
  new Set(["Bradenton", "Sarasota FL", "Venice", "Port Charlotte FL"]),
  "Narrative prose was admitted as immutable geographic authority."
);
assert.deepEqual(
  selectBusinessCategories(["Site Navigation Element", "LocalBusiness"], ["well pump repair"]),
  [],
  "Schema.org presentation types were admitted as business categories."
);

const locationIndexSummary = {
  ...summarizeCrawlHtml(
    pageHtml("Service locations", ["/locations/clayton"], "", "Serving Clayton and Well Drilling."),
    `${authorityOrigin}/locations`
  ),
  source: "sampled_internal" as const
};
const locationIndexCrawl = {
  ...authorityCrawl,
  pageSummaries: [locationIndexSummary],
  extractedFacts: {
    ...authorityCrawl.extractedFacts,
    serviceAreas: locationIndexSummary.extractedFacts.serviceAreas
  }
};
const locationIndexIngestion = {
  ...authorityIngestion,
  pages: [{
    ...authorityIngestion.pages[0]!,
    url: locationIndexSummary.url,
    finalUrl: locationIndexSummary.url,
    summary: locationIndexSummary,
    internalLinks: [`${authorityOrigin}/locations/clayton`],
    evidenceClass: "first_party" as const
  }]
};
const acceptedLocationIndexAreas = sourcePreparationDiagnosticsFor(locationIndexCrawl, locationIndexIngestion).facts
  .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
  .map((fact) => String(fact.value));
assert.deepEqual(
  acceptedLocationIndexAreas,
  ["Clayton"],
  "A service phrase on a locations index was admitted as a place without a matching child-location link."
);

const repeatedLegacyAreaPages = ["raccoon", "squirrel"].map((animal) => {
  const url = `${authorityOrigin}/${animal}-control-trapping-removal.html`;
  const summary = summarizeCrawlHtml(
    pageHtml(`${animal} removal`, [], "", "Serving Orange County, Central Florida, and Dear Island. Florida Removal Services."),
    url
  );
  return {
    ...summary,
    source: "sampled_internal" as const,
    purposeTags: ["services" as const],
    extractedFacts: {
      ...summary.extractedFacts,
      serviceAreas: ["Orange County", "Central Florida", "Dear Island", "Florida", "Removal Services"]
    }
  };
});
const repeatedLegacyAreaCrawl = {
  ...authorityCrawl,
  pageSummaries: repeatedLegacyAreaPages,
  extractedFacts: {
    ...authorityCrawl.extractedFacts,
    serviceAreas: ["Orange County", "Central Florida", "Dear Island", "Florida", "Removal Services"]
  }
};
const repeatedLegacyAreaIngestion = {
  ...authorityIngestion,
  pages: repeatedLegacyAreaPages.map((summary) => ({
    ...authorityIngestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    summary,
    evidenceClass: "first_party" as const
  }))
};
const acceptedRepeatedLegacyAreas = sourcePreparationDiagnosticsFor(
  repeatedLegacyAreaCrawl,
  repeatedLegacyAreaIngestion
).facts
  .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
  .map((fact) => String(fact.value));
assert.deepEqual(
  new Set(acceptedRepeatedLegacyAreas),
  new Set(["Orange County", "Central Florida"]),
  "Repeated broad first-party legacy geography was lost, or an uncorroborated city-like typo, bare state, or service phrase became geographic authority."
);

const legacyCityAreaSummary = {
  ...summarizeCrawlHtml(
    `<!doctype html><title>Orlando Animal - Wildlife Trapper and Pest Control Services</title><main>
      <h1>Orlando Animal - Wildlife Trapper and Pest Control Services</h1>
      <h2>Our animal and wildlife services in Orlando, Florida include:</h2>
      <p>Call for help with wildlife or pest concerns at a property in Orlando.</p>
    </main>`,
    `${authorityOrigin}/oc-orlando-florida.html`
  ),
  source: "sampled_internal" as const
};
const legacyCityAreaCrawl = {
  ...authorityCrawl,
  pageSummaries: [legacyCityAreaSummary],
  extractedFacts: {
    ...authorityCrawl.extractedFacts,
    serviceAreas: legacyCityAreaSummary.extractedFacts.serviceAreas
  }
};
const legacyCityAreaIngestion = {
  ...authorityIngestion,
  pages: [{
    ...authorityIngestion.pages[0]!,
    url: legacyCityAreaSummary.url,
    finalUrl: legacyCityAreaSummary.url,
    summary: legacyCityAreaSummary,
    evidenceClass: "first_party" as const
  }]
};
const acceptedLegacyCityAreas = sourcePreparationDiagnosticsFor(
  legacyCityAreaCrawl,
  legacyCityAreaIngestion
).facts
  .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
  .map((fact) => String(fact.value));
assert.deepEqual(
  acceptedLegacyCityAreas,
  ["Orlando"],
  "A dedicated first-party city-and-state service route did not become canonical service-area authority."
);

const blogOfferingSummary = {
  ...summarizeCrawlHtml(pageHtml("5 advantages of animal removal services"), `${authorityOrigin}/5-advantages-animal-removal-services`),
  source: "sampled_internal" as const,
  purposeTags: ["blog" as const, "service_detail" as const],
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("5 advantages of animal removal services"), `${authorityOrigin}/5-advantages-animal-removal-services`).extractedFacts,
    services: ["24 7 Emergency Well Pump Us Now", "Well And Repair"]
  }
};
const serviceOfferingSummary = {
  ...summarizeCrawlHtml(pageHtml("Well pump repair"), `${authorityOrigin}/services/well-pump-repair`),
  source: "sampled_internal" as const,
  purposeTags: ["service_detail" as const],
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("Well pump repair"), `${authorityOrigin}/services/well-pump-repair`).extractedFacts,
    services: ["Well Pump Repair"]
  }
};
const locationOfferingSummary = {
  ...summarizeCrawlHtml(pageHtml("Well service in Cary"), `${authorityOrigin}/locations/cary`),
  source: "sampled_internal" as const,
  purposeTags: ["location" as const, "service_detail" as const],
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("Well service in Cary"), `${authorityOrigin}/locations/cary`).extractedFacts,
    services: ["Cary"]
  }
};
const requestOfferingSummary = {
  ...summarizeCrawlHtml(pageHtml("Request service"), `${authorityOrigin}/`),
  source: "primary" as const,
  purposeTags: ["home" as const],
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("Request service"), `${authorityOrigin}/`).extractedFacts,
    services: ["Request"]
  }
};
const unclassifiedServiceOfferingSummary = {
  ...summarizeCrawlHtml(pageHtml("Bat removal"), `${authorityOrigin}/bat-removal`),
  source: "sampled_internal" as const,
  purposeTags: ["other" as const],
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("Bat removal"), `${authorityOrigin}/bat-removal`).extractedFacts,
    services: []
  }
};
const offeringCrawl = {
  ...authorityCrawl,
  pageSummaries: [
    requestOfferingSummary,
    blogOfferingSummary,
    locationOfferingSummary,
    unclassifiedServiceOfferingSummary,
    serviceOfferingSummary
  ]
};
const offeringIngestion = {
  ...authorityIngestion,
  pages: [
    requestOfferingSummary,
    blogOfferingSummary,
    locationOfferingSummary,
    unclassifiedServiceOfferingSummary,
    serviceOfferingSummary
  ].map((summary) => ({
    ...authorityIngestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    summary,
    evidenceClass: "first_party" as const
  }))
};
assert.deepEqual(
  selectSourceOfferingFacts(offeringCrawl, offeringIngestion, []).map((offering) => offering.name),
  ["Bat Removal", "Well Pump Repair"],
  "CTA, blog, or location navigation fragments were admitted as canonical offering facts, or a clear service route was lost."
);
const legacyOfferingPages = [
  {
    ...summarizeCrawlHtml(pageHtml("Bed bug control"), `${authorityOrigin}/insect-control-bed-bugs.html`),
    source: "sampled_internal" as const,
    purposeTags: ["service_detail" as const]
  },
  {
    ...summarizeCrawlHtml(pageHtml("Contact"), `${authorityOrigin}/contact.html`),
    source: "sampled_internal" as const,
    purposeTags: ["services" as const]
  },
  {
    ...summarizeCrawlHtml(pageHtml("Home"), `${authorityOrigin}/index.html`),
    source: "sampled_internal" as const,
    purposeTags: ["service_detail" as const]
  }
];
const legacyOfferingCrawl = { ...authorityCrawl, pageSummaries: legacyOfferingPages };
const legacyOfferingIngestion = {
  ...authorityIngestion,
  pages: legacyOfferingPages.map((summary) => ({
    ...authorityIngestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    summary,
    evidenceClass: "first_party" as const
  }))
};
assert.deepEqual(
  selectSourceOfferingFacts(legacyOfferingCrawl, legacyOfferingIngestion, []).map((offering) => offering.name),
  ["Bed Bug Control"],
  "Legacy file extensions or utility-route names leaked into canonical offering authority."
);
const treeAuthorityOrigin = "https://tree-authority.example";
const treeAuthorityHome = {
  ...summarizeCrawlHtml(
    pageHtml(
      "Tree service home",
      [],
      "",
      "We are a Tree Service Company in Austin, TX, Serving Central Texas with Tree Removal, Trimming, Planting, and Emergency Tree Care."
    ),
    `${treeAuthorityOrigin}/`
  ),
  source: "primary" as const,
  purposeTags: ["home" as const],
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("Tree service home"), `${treeAuthorityOrigin}/`).extractedFacts,
    services: ["Tree Removal", "Tree Trimming and Pruning", "Tree Planting Service", "Emergency Tree Service"],
    serviceAreas: ["Austin", "Central Texas", "Emergency Tree Care", "Planting", "Trimming"]
  }
};
const treeAuthorityCrawl = {
  ...authorityCrawl,
  url: `${treeAuthorityOrigin}/`,
  finalUrl: `${treeAuthorityOrigin}/`,
  pageSummaries: [treeAuthorityHome],
  extractedFacts: {
    ...authorityCrawl.extractedFacts,
    services: treeAuthorityHome.extractedFacts.services,
    serviceAreas: treeAuthorityHome.extractedFacts.serviceAreas
  }
};
const treeAuthorityIngestion = {
  ...authorityIngestion,
  sourceUrl: `${treeAuthorityOrigin}/`,
  pages: [{
    ...authorityIngestion.pages[0]!,
    url: treeAuthorityHome.url,
    finalUrl: treeAuthorityHome.url,
    summary: treeAuthorityHome,
    evidenceClass: "first_party" as const
  }]
};
const acceptedTreeAreas = sourcePreparationDiagnosticsFor(treeAuthorityCrawl, treeAuthorityIngestion).facts
  .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
  .map((fact) => String(fact.value));
assert.deepEqual(
  new Set(acceptedTreeAreas),
  new Set(["Austin", "Central Texas"]),
  "A trailing service list inside geographic prose became canonical service-area authority."
);
const rejectedTreeAreaDiagnostics = sourcePreparationDiagnosticsFor(treeAuthorityCrawl, treeAuthorityIngestion).facts
  .filter((fact) => fact.kind === "service_area" && ["Emergency Tree Care", "Planting", "Trimming"].includes(String(fact.value)));
assert(
  rejectedTreeAreaDiagnostics.length === 3
    && rejectedTreeAreaDiagnostics.every((fact) => fact.disposition === "invalid_value_filtering"),
  "A deterministic trailing-offering exclusion was reported as unexplained source loss."
);

const treeOfferingPaths = [
  "/services",
  "/about-us/tree-service-gallery",
  "/tree-service-and-covid-19",
  "/services/other-tree-service-things",
  "/tree-service-specials",
  "/services/tree-trimming-and-tree-pruning",
  "/services/tree-removal"
];
const treeOfferingPages = treeOfferingPaths.map((path) => ({
  ...summarizeCrawlHtml(pageHtml(path.split("/").filter(Boolean).at(-1) ?? "Home"), `${treeAuthorityOrigin}${path}`),
  source: "sampled_internal" as const,
  purposeTags: ["service_detail" as const]
}));
const treeOfferingCrawl = { ...treeAuthorityCrawl, pageSummaries: treeOfferingPages };
const treeOfferingIngestion = {
  ...treeAuthorityIngestion,
  pages: treeOfferingPages.map((summary) => ({
    ...treeAuthorityIngestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    summary,
    evidenceClass: "first_party" as const
  }))
};
assert.deepEqual(
  selectSourceOfferingFacts(treeOfferingCrawl, treeOfferingIngestion, []).map((offering) => offering.name),
  ["Tree Trimming and Tree Pruning", "Tree Removal"],
  "Content hubs, galleries, promotions, or editorial labels became offerings, or a real pruning service was discarded."
);
const bookingDestinations = selectSourceLinksForGeneration(`${authorityOrigin}/`, authorityCrawl)
  .filter((link) => link.kind === "booking")
  .map((link) => link.url);
assert.deepEqual(
  new Set(bookingDestinations),
  new Set([`${authorityOrigin}/schedule-service/`, "https://calendly.com/fixture/consultation"]),
  "Book and schedule words inside unrelated external article URLs were treated as booking destinations."
);

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
const retainedTitle = summarizeCrawlHtml(
  `<!doctype html><title>${"Long source title 😀 ".repeat(60)}</title><main>Useful content.</main>`,
  `${headingOrigin}/long-title`
).title;
assert(retainedTitle, "The normalized document title was not retained.");
assert(
  [...retainedTitle].length <= 500 && [...retainedTitle].length >= 490,
  "A document title was not bounded by Unicode scalar count before schema validation."
);

const legalTextOrigin = "https://legal-text.example";
const legalTextCrawl = await crawlWebsiteForGeneration({
  url: `${legalTextOrigin}/privacy`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (path === "/privacy") return response(`<!doctype html>
      <title>Privacy Policy</title>
      <style id="builder-css">.legacy-icon{mask-image:url("data:image/svg+xml,escaped-builder-artwork");color:red}</style >
      <main><h1>Privacy Policy</h1><p>We collect contact information only when a customer submits it to request service.</p><p>Customers may contact us to ask questions or request a correction.</p></main>`, 200);
    throw new Error(`unexpected_legal_text_fixture_url:${url}`);
  }
});
const retainedLegalText = legalTextCrawl.documents.find((document) => new URL(document.url).pathname === "/privacy")?.extractedText ?? "";
assert.match(retainedLegalText, /collect contact information only when a customer submits it/i);
assert.doesNotMatch(retainedLegalText, /mask-image|escaped-builder-artwork|legacy-icon/i, "Stylesheet text polluted retained legal source content.");

const galleryOrigin = "https://gallery-original.example";
const galleryOriginal = await crawlWebsiteForGeneration({
  url: `${galleryOrigin}/projects/kitchen`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (path === "/projects/kitchen") return response(`${pageHtml("Kitchen project")}<img src="/wp-content/gallery/kitchen/thumbs/thumbs_after.jpg" alt="Finished kitchen">`, 200);
    if (path === "/wp-content/gallery/kitchen/thumbs/thumbs_after.jpg") return response("thumbnail", 200, "image/jpeg");
    if (path === "/wp-content/gallery/kitchen/after.jpg") return response("full-resolution-image", 200, "image/jpeg");
    throw new Error(`unexpected_gallery_fixture_url:${url}`);
  }
});
assert(
  galleryOriginal.captures.some((capture) => capture.requestedUrl === `${galleryOrigin}/wp-content/gallery/kitchen/after.jpg` && capture.outcome === "fetched"),
  "A directly evidenced NextGEN gallery thumbnail did not discover its first-party original."
);
const missingGalleryOriginal = await crawlWebsiteForGeneration({
  url: `${galleryOrigin}/projects/missing-original`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (path === "/projects/missing-original") return response(`${pageHtml("Missing original project")}<img src="/wp-content/gallery/kitchen/thumbs/thumbs_missing.jpg" alt="Project thumbnail">`, 200);
    if (path === "/wp-content/gallery/kitchen/thumbs/thumbs_missing.jpg") return response("thumbnail", 200, "image/jpeg");
    if (path === "/wp-content/gallery/kitchen/missing.jpg") return response("missing", 404, "text/plain");
    throw new Error(`unexpected_missing_gallery_fixture_url:${url}`);
  }
});
assert.equal(missingGalleryOriginal.ingestion.coverage, "complete", "An unavailable optional gallery original degraded an otherwise complete crawl.");
assert(missingGalleryOriginal.captures.some((capture) => capture.reason === "derived_original_unavailable" && capture.outcome === "excluded"));

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

function activeCrawlShell(url: string): CrawlAssessment {
  return {
    url,
    fetched: true,
    status: 200,
    finalUrl: url,
    title: "Location directory",
    hasViewportMeta: true,
    hasLocalBusinessSchema: false,
    hasTelLink: true,
    robotsFound: true,
    sitemapFound: true,
    formCount: 0,
    imageCount: 0,
    imagesWithoutAlt: 0,
    internalLinkCount: 2,
    externalLinkCount: 0,
    jsonLdTypes: [],
    extractedFacts: {
      categories: [],
      services: [],
      serviceAreas: [],
      socialLinks: [],
      bookingLinks: [],
      orderingLinks: [],
      pressLinks: []
    },
    formReferences: [],
    linkReferences: [],
    assetReferences: [],
    sampledInternalPages: [],
    pageSummaries: [],
    findings: []
  };
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
