import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";
import { gzipSync } from "node:zlib";
import { corroboratedHomepageBusinessName } from "../lib/business-fact-normalization";
import { explicitServiceAreaListEvidence, summarizeCrawlHtml, type CrawlAssessment } from "../lib/crawler";
import {
  crawlWebsiteForGeneration,
  generationIngestionLimits,
  sourceGalleryOriginalVariant,
  staticHtmlExportVariant
} from "../packages/business-data/generation-crawler";
import { createPublicBuildInput } from "../packages/business-data/public-projection";
import { stableJson } from "../packages/business-data/hash";
import { decodeRetainedSourceResource } from "../packages/business-data/source-mirror";
import { retainedWebsiteReplayTransport } from "../packages/business-data/source-replay";
import { canonicalSiteAuthoringRuntimeSeriesId } from "../packages/site-contracts/platform-manifest";
import {
  generationCrawlerProductToken,
  generationCrawlerUserAgent,
  parseRobotsPolicy,
  robotsAllows
} from "../packages/business-data/robots-policy";
import { PublicFetchUrlError } from "../lib/url-safety";
import { isLikelyInjectedSpamSourcePage, isMalformedSourceLinkPath } from "../packages/business-data/source-page-classification";
import {
  assertSourceSuitableForGeneration,
  createLooseWebsiteBootstrap,
  hasContradictoryFirstPartyLocationHours,
  ingestWebsite,
  observedProof,
  retainedContactConsensus,
  selectSupportingSourceBlock,
  selectObservedFirstPartyCredentials,
  selectObservedFirstPartyTestimonials,
  selectSourceContactAndLocation,
  selectBusinessCategories,
  selectSourceOfferingFacts,
  selectSourceLinksForGeneration,
  sourcePreparationDiagnosticsFor
} from "../packages/business-data/website-ingestion";

const origin = "https://fixture.example";

// Synthetic source-authority regression; every request and DNS lookup is stubbed.
// Exercise final BusinessState creation, not a duplicate of its name/status logic.
const identityOrigin = "https://dev.identity-fixture.example";
const identityBody = `<p>First-party website analytics records page views, clicks, form activity,
  limited performance measurements, page paths, referrer hosts, campaign fields, and broad device categories.
  A random identifier held in page memory connects activity only within that page load;
  it does not identify returning visitors or connect activity across pages.</p>`;
const identityPage = (title: string | undefined, metadata = "", links = "") =>
  `<!doctype html>${title === undefined ? "" : `<title>${title}</title>`}${metadata}<main>${identityBody}${links}</main>`;
const identityHome = identityPage("Lodesta | AI website manager for local businesses",
  '<meta property="og:site_name" content="Lodesta">',
  '<a href="/privacy/">Privacy</a><a href="/terms/">Terms</a>');
const identityPrivacy = identityPage("Privacy Policy | Lodesta");
const identityTerms = identityPage("Terms of Service | Lodesta");
assert.equal(summarizeCrawlHtml(identityHome, identityOrigin).extractedFacts.name, "Lodesta");
for (const html of [identityPrivacy, identityTerms, identityPage("Home"), identityPage(undefined)]) {
  assert.equal(summarizeCrawlHtml(html, identityOrigin).extractedFacts.name, undefined,
    "A page without a selected observed name manufactured a hostname-derived extracted fact.");
}
const identityBootstrap = await createLooseWebsiteBootstrap({ url: identityOrigin });
assert.equal(identityBootstrap.state.identity.name, "Dev");
assert.equal(identityBootstrap.state.identity.status, "provisional");
assert.equal(identityBootstrap.state.facts.some((fact) => fact.kind === "business_name"), false);

let identityDocuments = new Map([
  ["/", identityHome], ["/privacy", identityPrivacy], ["/terms", identityTerms]
]);
const identityDns = mock.method(dns, "lookup", async (hostname: string) => {
  assert.equal(hostname, new URL(identityOrigin).hostname, "Identity fixture attempted an unexpected DNS lookup.");
  return [{ address: "93.184.216.34", family: 4 }];
});
syncBuiltinESMExports();
const identityFetch = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, identityOrigin, "Identity fixture attempted an unexpected network request.");
  if (url.pathname === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
  const html = identityDocuments.get(url.pathname);
  return html === undefined ? response("missing", 404, "text/plain") : response(html, 200);
});
try {
  const observedIdentity = await ingestWebsite({ url: identityOrigin });
  assert.equal(observedIdentity.generationIngestion.counts.fetched, 3);
  assert.equal(observedIdentity.generationIngestion.counts.browserRendered, 0);
  assert.equal(observedIdentity.state.identity.name, "Lodesta",
    "Policy-page hostname fallbacks displaced the homepage's observed business identity.");
  assert.equal(observedIdentity.state.identity.status, "verified");
  const observedNameFacts = observedIdentity.state.facts.filter((fact) => fact.kind === "business_name");
  assert.equal(observedNameFacts.length, 1);
  assert.equal(observedNameFacts[0]?.value, "Lodesta");
  assert.equal(observedNameFacts[0]?.publicEligible, true);

  for (const title of ["Home", "Privacy Policy | Lodesta", undefined]) {
    identityDocuments = new Map([["/", identityPage(title)]]);
    const provisionalIdentity = await ingestWebsite({ url: identityOrigin });
    assert.equal(provisionalIdentity.generationIngestion.counts.browserRendered, 0);
    assert.equal(provisionalIdentity.crawl.extractedFacts.name, undefined);
    assert.equal(provisionalIdentity.state.identity.name, "Dev");
    assert.equal(provisionalIdentity.state.identity.status, "provisional",
      "An unchecked raw title or hostname was promoted to verified identity.");
    assert.equal(provisionalIdentity.state.facts.some((fact) => fact.kind === "business_name"), false,
      "A provisional hostname label produced a public business-name authority fact.");
  }

  identityDocuments = new Map([["/", identityPage("Home", '<meta property="og:site_name" content="Dev">')]]);
  const metadataIdentity = await ingestWebsite({ url: identityOrigin });
  const metadataName = metadataIdentity.state.facts.find((fact) => fact.kind === "business_name");
  assert.equal(metadataName?.value, "Dev");
  assert.equal(metadataName?.publicEligible, true);
  assert.equal(metadataName?.source.sourceUrl, `${identityOrigin}/`);
  assert.equal(metadataName?.source.sourceBlockId, undefined,
    "The substring dev in device was attached as business-name proof instead of retaining metadata-only page provenance.");
} finally {
  identityFetch.mock.restore();
  identityDns.mock.restore();
  syncBuiltinESMExports();
}

const repeatedPipeTitle = summarizeCrawlHtml(
  "<!doctype html><title>Home || Western Roof Company</title><main><h1>Western Roof Company</h1></main>",
  "https://westernroofco.com/"
);
assert.equal(
  repeatedPipeTitle.extractedFacts.name,
  "Western Roof Company",
  "A repeated-pipe title separator leaked a generic Home label into canonical business identity."
);

const genericTitleOrigin = "https://cedarelectricaustin.example";
const genericTitleCrawl = await crawlWebsiteForGeneration({
  url: genericTitleOrigin + "/",
  validateUrl: async value => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async input => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/") return response(`<!doctype html><title>ELECTRICAL CONTRACTOR</title><main>
      <h1>CEDAR ELECTRIC WHERE WE KEEP YOU OUT OF THE DARK</h1>
      <a href="/testimonials.html">Customer testimonials</a></main>`, 200);
    if (path === "/testimonials.html") return response(`<!doctype html><title>CEDAR ELECTRIC</title>
      <main><h1>WHAT OUR CUSTOMERS SAY ABOUT US</h1><p>First-party customer testimonials.</p></main>`, 200);
    return response("missing", 404, "text/plain");
  }
});
assert.equal(genericTitleCrawl.crawl.pageSummaries[0]?.extractedFacts.name, "ELECTRICAL CONTRACTOR");
assert.equal(genericTitleCrawl.crawl.extractedFacts.name, "CEDAR ELECTRIC",
  "Generation's first-title merge ignored the shared selector and a stronger retained first-party business name.");

const sloganIdentityOrigin = "https://padt.identity-fixture.example";
const sloganIdentityCrawl = await crawlWebsiteForGeneration({
  url: sloganIdentityOrigin + "/",
  validateUrl: async value => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async input => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (path === "/") return response(`<title>Pristine Auto Detailing | Austin's Premier Auto Spa</title>
      <main><h1>Austin's Premier Auto Spa</h1><a href="/about">About</a><a href="/contact">Contact</a></main>`, 200);
    if (path === "/about" || path === "/contact") return response(`<title>Pristine Auto Detailing | ${path === "/about" ? "About" : "Contact"}</title>
      <main><p>First-party business information.</p></main>`, 200);
    return response("missing", 404, "text/plain");
  }
});
assert.equal(sloganIdentityCrawl.crawl.pageSummaries[0]?.extractedFacts.name, "Austin's Premier Auto Spa",
  "The fixture no longer exercises the ambiguous homepage title selection.");
assert.equal(sloganIdentityCrawl.crawl.extractedFacts.name, "Pristine Auto Detailing",
  "The homepage slogan displaced the name corroborated by two first-party pages.");
const nameCorroboration = {
  current: "Austin's Premier Auto Spa", homepageTitle: "Pristine Auto Detailing | Austin's Premier Auto Spa",
  hostname: "padt.identity-fixture.example"
};
assert.equal(corroboratedHomepageBusinessName({ ...nameCorroboration, otherPageNames: ["Pristine Auto Detailing"] }), nameCorroboration.current);
assert.equal(corroboratedHomepageBusinessName({ ...nameCorroboration,
  otherPageNames: ["Pristine Auto Detailing", "Pristine Auto Detailing", nameCorroboration.current, nameCorroboration.current]
}), nameCorroboration.current, "Conflicting equally corroborated identities must not acquire a positional winner.");
assert.equal(corroboratedHomepageBusinessName({ ...nameCorroboration, current: "PADT Auto Company",
  otherPageNames: ["Pristine Auto Detailing", "Pristine Auto Detailing"]
}), "PADT Auto Company", "Weaker title corroboration must not replace an already stronger name.");

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
assert.equal(generationCrawlerUserAgent, "LodestaBot/1.0 (+https://lodesta.com/bot)");
assert.match(generationCrawlerUserAgent, new RegExp(generationCrawlerProductToken));
assert.doesNotMatch(generationCrawlerUserAgent, /crawler/i, "Firewalls commonly block user agents containing 'crawler'.");
const legacyOptOut = parseRobotsPolicy("User-agent: *\nAllow: /\n\nUser-agent: LodestaWebsiteCrawler\nDisallow: /\n");
assert.equal(robotsAllows(`${origin}/`, legacyOptOut.rules), false, "Opt-outs for the earlier product token must still be honored.");
const botOptOut = parseRobotsPolicy("User-agent: *\nAllow: /\n\nUser-agent: LodestaBot\nDisallow: /private\n");
assert.equal(robotsAllows(`${origin}/private/x`, botOptOut.rules), false);
assert.equal(robotsAllows(`${origin}/`, botOptOut.rules), true);
const botOverridesLegacy = parseRobotsPolicy("User-agent: LodestaWebsiteCrawler\nDisallow: /\n\nUser-agent: LodestaBot\nAllow: /\n");
assert.equal(robotsAllows(`${origin}/`, botOverridesLegacy.rules), true, "A LodestaBot group outranks a legacy-token group.");
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

const contactCitationBlocks = [
  { id: "empty", sourceUrl: `${origin}/`, displayText: "" },
  { id: "zero_width", sourceUrl: `${origin}/`, displayText: "\u200d" },
  { id: "punctuation", sourceUrl: `${origin}/`, displayText: "— · /" },
  { id: "phone", sourceUrl: `${origin}/contact`, displayText: "Call (512) 555-0198" },
  { id: "email", sourceUrl: `${origin}/contact`, displayText: "Email hello@fixture.example" },
  { id: "address", sourceUrl: `${origin}/contact`, displayText: "Visit 2000 Windy Terrace, Suite 22A" }
] as never[];
assert.equal(selectSupportingSourceBlock(contactCitationBlocks, "(512) 555-0198")?.id, "phone",
  "Empty, zero-width, or punctuation-only source text displaced real phone support.");
assert.equal(selectSupportingSourceBlock(contactCitationBlocks, "hello@fixture.example")?.id, "email",
  "Empty, zero-width, or punctuation-only source text displaced real email support.");
assert.equal(selectSupportingSourceBlock(contactCitationBlocks, "2000 Windy Terrace Suite 22A")?.id, "address",
  "Empty, zero-width, or punctuation-only source text displaced real address support.");
assert.equal(selectSupportingSourceBlock(contactCitationBlocks.slice(0, 3), "(512) 555-0198"), undefined,
  "Meaningless source text became a citation when no real supporting block existed.");
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

const joinedBuildingAddress = summarizeCrawlHtml(`<!doctype html><title>Contact</title><main>
  <a href="/contact"><strong>Address:</strong> 2000 Windy Terrace Building 22ACedar Park, Texas 78613USA</a>
  <a href="tel:512-948-1506">512-948-1506</a>
</main>`, "https://address-conflict.example/contact");
assert.deepEqual(joinedBuildingAddress.extractedFacts.address, {
  street: "2000 Windy Terrace Building 22A",
  city: "Cedar Park",
  region: "TX",
  postalCode: "78613",
  country: "US"
}, "A numbered Building unit joined to the city hid an otherwise complete visible address.");
for (const visibleAddress of [
  "123 Main Street, Austin, TX 78701.",
  "123 Main Street, Austin, TX 78701, USA"
]) {
  assert.deepEqual(summarizeCrawlHtml(`<!doctype html><main>${visibleAddress}</main>`, "https://address-fixture.example/").extractedFacts.address, {
    street: "123 Main Street",
    city: "Austin",
    region: "TX",
    postalCode: "78701",
    country: "US"
  }, `Ordinary address punctuation was rejected: ${visibleAddress}`);
}
for (const ambiguousAddress of [
  "123 Main Streetville, TX 78701",
  "123 Main Terrace Building 22Cedar Park, TX 78701",
  "123 Main Terrace Building 22ABC Town, TX 78701",
  "123 Main Street Suite 22Austin, TX 78701",
  "123 Main Street, Austin, TX 787011"
]) {
  assert.equal(
    summarizeCrawlHtml(`<!doctype html><main>${ambiguousAddress}</main>`, "https://address-fixture.example/").extractedFacts.address,
    undefined,
    `Ambiguous address segmentation was guessed: ${ambiguousAddress}`
  );
}
const foreignSpecialistAddress = summarizeCrawlHtml(`<!doctype html><title>Specialist service</title><main>
  <a href="/contact"><strong>Address:</strong> 743 Snelling Avenue North Saint Paul, MN 55104</a>
  <a href="tel:651-706-9895">651-706-9895</a>
</main>`, "https://address-conflict.example/specialist/vehicle");
const conflictingLocationCrawl = {
  ...activeCrawlShell("https://address-conflict.example/"),
  pageSummaries: [
    { ...joinedBuildingAddress, source: "primary" as const },
    { ...foreignSpecialistAddress, source: "sampled_internal" as const }
  ]
};
assert.deepEqual(selectSourceContactAndLocation(conflictingLocationCrawl, { phone: "+15129481506" }), {
  phone: "+15129481506",
  email: undefined,
  address: joinedBuildingAddress.extractedFacts.address,
  geo: undefined,
  hours: undefined
}, "A clean but conflicting internal-page address displaced the primary first-party location.");
const addressOrigin = "https://address-conflict.example";
const addressDocuments = new Map([
  ["/", `<!doctype html><title>Pristine Auto Detailing</title><main>
    <p>${"First-party auto-detailing information for local customers. ".repeat(8)}</p>
    <a href="/specialist/vehicle">Vehicle specialist</a>
    <div><strong>Address:</strong> 2000 Windy Terrace Building 22ACedar Park, Texas 78613USA</div>
    <a href="tel:512-948-1506">512-948-1506</a>
  </main>`],
  ["/specialist/vehicle", `<!doctype html><title>Vehicle specialist</title><main>
    <p>${"First-party specialist information for local customers. ".repeat(8)}</p>
    <div><strong>Address:</strong> 743 Snelling Avenue North Saint Paul, MN 55104</div>
    <a href="tel:651-706-9895">651-706-9895</a>
  </main>`]
]);
const addressDns = mock.method(dns, "lookup", async (hostname: string) => {
  assert.equal(hostname, new URL(addressOrigin).hostname, "Address fixture attempted an unexpected DNS lookup.");
  return [{ address: "93.184.216.34", family: 4 }];
});
syncBuiltinESMExports();
const addressFetch = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, addressOrigin, "Address fixture attempted an unexpected network request.");
  if (url.pathname === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
  const html = addressDocuments.get(url.pathname);
  return html === undefined ? response("missing", 404, "text/plain") : response(html, 200);
});
try {
  const ingestedAddressConflict = await ingestWebsite({ url: `${addressOrigin}/` });
  assert.equal(ingestedAddressConflict.state.locations[0]?.street, "2000 Windy Terrace Building 22A");
  assert.equal(ingestedAddressConflict.state.locations[0]?.city, "Cedar Park");
  const retainedAddressFact = ingestedAddressConflict.state.facts.find((fact) => fact.kind === "address");
  assert.equal(retainedAddressFact?.value, "2000 Windy Terrace Building 22A, Cedar Park, TX, 78613, US");
  assert.equal(retainedAddressFact?.publicEligible, true,
    "The parsed primary address remained rejected after conflicting internal-page evidence was scoped out.");
} finally {
  addressFetch.mock.restore();
  addressDns.mock.restore();
  syncBuiltinESMExports();
}

const reviewSummary = {
  ...summarizeCrawlHtml(`<!doctype html><title>Reviews</title><main><h1>Reviews</h1>
    <p>Our customers appreciate careful service and clear communication.</p>
    <blockquote>“They arrived when promised, protected the room, and left the finished walls looking excellent.”</blockquote>
    <p>"The crew explained every step and made the whole project easy for our family."</p>
  </main>`, "https://testimonial-source.example/reviews"),
  source: "primary" as const
};
const testimonialBlocks = selectObservedFirstPartyTestimonials([reviewSummary], reviewSummary.url);
assert.equal(testimonialBlocks.length, 2, "Generic reviews-page marketing copy was mistaken for a customer quotation, or explicit quotations were lost.");
const manyReviewsSummary = {
  ...summarizeCrawlHtml(`<!doctype html><title>Reviews</title><main><h1>Reviews</h1>
    ${Array.from({ length: 30 }, (_, index) => `<blockquote>“Visit ${index + 1}: the crew arrived when promised and left the whole yard exactly as they found it.”</blockquote>`).join("\n")}
  </main>`, "https://testimonial-source.example/reviews"),
  source: "primary" as const
};
assert.equal(selectObservedFirstPartyTestimonials([manyReviewsSummary], manyReviewsSummary.url).length, 24,
  "First-party testimonials are retained up to the widened cap of 24.");
const proofFacts: Parameters<typeof observedProof>[2] = [];
const retainedProof = observedProof({
  ...activeCrawlShell(reviewSummary.url),
  pageSummaries: [reviewSummary]
}, "source_testimonial_fixture", proofFacts, "2026-09-01T00:00:00.000Z");
assert(retainedProof.every((proof) => proof.kind === "testimonial" && proof.status === "confirmed" && proof.verbatim));
assert(proofFacts.every((fact) => fact.kind === "proof" && fact.publicEligible && fact.source.evidenceClass === "first_party"));

// Intake authority regressions (synthetic, replayed without network):
// displayed phone over stale structured data, every repeated real number,
// structured business name over a service headline, attributed review cards
// and the business's own structured reviews without platform widgets,
// credentials, bare-address email links, and static-export .html pages.
const intakeOrigin = "https://intake-authority.example";
// A customer's own words may mention an emergency, safety, a guarantee, a
// license or a price; that is attributed speech, not the business's claim.
const sensitiveTestimonial = "Our well quit on a holiday weekend and they came out for an emergency call, walked us through every safety check, and honored their guarantee on the pump. Licensed, careful, and the $450 price was exactly what they quoted.";
const longTestimonial = `${"We had tried two other companies before calling, and neither could find why the pressure kept dropping overnight. ".repeat(6)}They found the cracked fitting in an hour.`;
const intakeFooter = `<div class="site-footer-contact"><p>Call <a href="tel:+19195550181">(919) 555-0181</a> · Office <a href="tel:919-555-0199">919-555-0199</a></p></div>`;
const intakeDocuments = new Map<string, string>([
  ["/", `<!doctype html><html><head><title>Dependable Well Service | Intake Authority</title>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Intake Authority Website" },
        {
          "@type": "LocalBusiness",
          name: "A &amp; T Well and Pump",
          telephone: "+19195550100",
          review: [
            { "@type": "Review", reviewBody: "They restored our water the same afternoon and explained every part they replaced.", author: { "@type": "Person", name: "Pat Q." } },
            { "@type": "Review", reviewBody: "Five stars on the platform for fast and friendly service every time we called.", author: { "@type": "Organization", name: "Google" } }
          ]
        }
      ]
    })}</script></head><body><main>
    <h1>Dependable Well Service, Repair &amp; Installation</h1>
    <p>${"We repair, replace, and maintain residential well pumps and pressure tanks across the county. ".repeat(3)}</p>
    <p>Family owned and operated and serving the county since 2006.</p>
    <p>NC Well Contractor License #4417 · Suite #200 · Order #55512</p>
    <p>We are proud to help other family-owned businesses keep their water running.</p>
    <a href="owner@intake-authority.example">Email the owner</a>
    <a href="/contact">Contact</a><a href="/services/well-repair">Well repair</a><a href="/testimonials">Testimonials</a>
    <a href="/about">About</a><a href="/blog/old-post">Old post</a><a href="/blog/older-post">Older post</a>
    ${intakeFooter}</main></body></html>`],
  ["/contact", `<!doctype html><html><head><title>Contact | Intake Authority</title></head><body><main><h1>Contact</h1>
    <p>${"Reach the well service team for repairs and new installations. ".repeat(4)}</p>${intakeFooter}</main></body></html>`],
  ["/services/well-repair", `<!doctype html><html><head><title>Well Repair | Intake Authority</title></head><body><main><h1>Well repair</h1>
    <p>${"Well pump repair includes diagnosis, pressure switch checks, and pump replacement. ".repeat(4)}</p>
    <p>Call <a href="tel:9195550181">919-555-0181</a></p></main></body></html>`],
  ["/blog/old-post", `<!doctype html><html><head><title>Winter Well Tips | Blog</title></head><body><main><h1>Winter well tips</h1>
    <p>${"Insulate the well house and keep the pressure tank above freezing. ".repeat(4)}</p>
    <p>Questions? Call <a href="tel:919-555-0142">919-555-0142</a></p></main></body></html>`],
  ["/blog/older-post", `<!doctype html><html><head><title>Spring Well Tips | Blog</title></head><body><main><h1>Spring well tips</h1>
    <p>${"Test the water after heavy rain and inspect the well cap for damage. ".repeat(4)}</p>
    <p>Questions? Call <a href="tel:919-555-0142">919-555-0142</a></p></main></body></html>`],
  ["/testimonials", `<!doctype html><html><head><title>Testimonials | Intake Authority</title></head><body><main><h1>Testimonials</h1>
    <section class="cards">
      <div class="card"><div class="quote"><p>Stewart came out on a Saturday, found the failed pressure switch, and had water running within the hour.</p></div><div class="who"><h3>Ted L.</h3></div></div>
      <div class="card"><div class="quote"><p>They replaced our old jet pump with a submersible and cleaned up everything afterwards.</p><p>We will call them again.</p></div><div class="who"><h3>Hilda H.</h3></div></div>
      <div class="card"><div class="quote"><p>${sensitiveTestimonial}</p></div><div class="who"><h3>Dana R.</h3></div></div>
      <div class="card"><div class="quote"><p>${longTestimonial}</p></div><div class="who"><h3>Morgan K.</h3></div></div>
    </section>
    <div class="rplg"><div class="rplg-review"><div class="rplg-review-text"><p>Great platform review text that was copied from the Google listing by a widget plugin.</p></div><div class="rplg-review-name"><h4>Widget Person</h4></div></div></div>
    <blockquote>“The crew explained the whole replacement and left the yard exactly as they found it.”</blockquote>
    <p>${"Customers across the county share their experience with our well team. ".repeat(3)}</p>
  </main></body></html>`],
  ["/about.html", `<!doctype html><html><head><title>About | Intake Authority</title></head><body><main><h1>About us</h1>
    <p>${"Our crew has installed and repaired wells for local families for many years. ".repeat(3)}</p>
    <p>Established in 2006, we still answer our own phones.</p></main></body></html>`]
]);
const intakeFetched: string[] = [];
const intakeTransport = {
  validateUrl: async (value: string) => {
    assert.equal(new URL(value).origin, intakeOrigin, "Intake fixture attempted an unexpected origin.");
    return new URL(value).href;
  },
  sleep: async () => undefined,
  browserFetch: async () => { throw new Error("browser rendering is not part of this fixture"); },
  fetchImpl: (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    intakeFetched.push(url.pathname);
    if (url.pathname === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    const html = intakeDocuments.get(url.pathname);
    return html === undefined ? response("missing", 404, "text/plain") : response(html, 200);
  }) as typeof fetch
};
const intake = await ingestWebsite({ url: `${intakeOrigin}/`, now: "2026-09-23T00:00:00.000Z", crawlTransport: intakeTransport });
assert.equal(intake.state.identity.name, "A & T Well and Pump",
  "A homepage service headline displaced the business's own LocalBusiness name.");
assert.equal(intake.state.contacts.phone, "+19195550181",
  "Homepage structured data displaced the phone the site displays and links.");
const intakePhones = intake.state.facts.filter((fact) => fact.kind === "phone");
assert.deepEqual(
  intakePhones.map((fact) => [fact.value, fact.publicEligible]).sort(),
  [["+19195550181", true], ["+19195550199", true]],
  "Every repeated displayed number must be its own public fact; structured-only and blog-only numbers must not be."
);
assert.equal(intake.state.facts.find((fact) => fact.kind === "email")?.value, "owner@intake-authority.example",
  "A bare-address email link was lost.");
assert.equal(intakeFetched.some((path) => path.includes("@")), false, "A bare-address email link was crawled as a page.");
const intakeAbout = intake.generationIngestion.pages.find((page) => new URL(page.url).pathname === "/about");
assert.equal(intakeAbout?.outcome, "fetched", "A static-export page linked without .html was lost to a 404.");
assert.equal(intakeAbout?.finalUrl, `${intakeOrigin}/about.html`);
const intakeProof = intake.state.proof;
const intakeTestimonials = intakeProof.filter((item) => item.kind === "testimonial").map((item) => item.publicText);
assert(intakeTestimonials.includes("Stewart came out on a Saturday, found the failed pressure switch, and had water running within the hour."),
  "An attributed first-party review card was not retained verbatim.");
assert(intakeTestimonials.includes("They replaced our old jet pump with a submersible and cleaned up everything afterwards. We will call them again."),
  "A multi-paragraph review card was not retained in full.");
assert(intakeTestimonials.includes("They restored our water the same afternoon and explained every part they replaced."),
  "The business's own structured-data review was not retained.");
assert(intakeTestimonials.includes("“The crew explained the whole replacement and left the yard exactly as they found it.”"));
assert(intakeTestimonials.includes(sensitiveTestimonial),
  "A verbatim attributed first-party testimonial was withheld for mentioning an emergency, safety, a guarantee, a license or a price.");
assert(longTestimonial.length > 600 && intakeTestimonials.includes(longTestimonial.replace(/\s+/g, " ").trim()),
  "A long verbatim first-party testimonial was dropped.");
const danaFact = intake.state.facts.find((fact) => fact.kind === "proof" && fact.value === sensitiveTestimonial);
assert.equal(danaFact?.label, "Observed testimonial from Dana R.");
assert.equal(danaFact?.publicEligible, true);
assert.equal(intakeProof.find((item) => item.publicText === sensitiveTestimonial)?.status, "confirmed");
assert.equal(intakeTestimonials.some((text) => /widget plugin|on the platform/i.test(text)), false,
  "Review-platform widget or platform-authored review content was copied as a first-party testimonial.");
const tedFact = intake.state.facts.find((fact) => fact.kind === "proof" && String(fact.value).startsWith("Stewart came out"));
assert.equal(tedFact?.label, "Observed testimonial from Ted L.");
assert.equal(tedFact?.source.sourceUrl, `${intakeOrigin}/testimonials`);
assert(tedFact?.source.sourceBlockId, "A review card lost its source block provenance.");
const intakeCredentials = intakeProof.filter((item) => item.kind !== "testimonial" && item.kind !== "warranty")
  .map((item) => [item.kind, item.publicText, item.status]);
assert.deepEqual(intakeCredentials, [
  ["credential", "NC Well Contractor License #4417", "confirmed"],
  ["longevity", "serving the county since 2006", "confirmed"],
  ["ownership", "Family owned and operated", "confirmed"]
], "Stated license, founding year, and family ownership were not captured exactly (or a suite/order number was).");
const intakeBuildInput = createPublicBuildInput({
  id: "input_intake_authority",
  state: intake.state,
  intent: intake.intent,
  forms: intake.forms,
  sourceSnapshotIds: intake.sourceSnapshots.map((snapshot) => snapshot.id),
  runtimeSeriesId: canonicalSiteAuthoringRuntimeSeriesId
});
assert.equal(intakeBuildInput.business.contacts.phone, "+19195550181");
assert.deepEqual(
  intakeBuildInput.publicFacts.filter((fact) => fact.kind === "phone").map((fact) => fact.value).sort(),
  ["+19195550181", "+19195550199"],
  "Displayed phones did not reach publicFacts, so their tel: links would be rejected."
);
assert(intakeBuildInput.business.proof.some((item) => item.kind === "testimonial" && item.publicText === sensitiveTestimonial),
  "A sensitive-worded verbatim testimonial did not reach the public build input.");
for (const text of ["NC Well Contractor License #4417", "serving the county since 2006", "Family owned and operated", "They restored our water the same afternoon and explained every part they replaced.", sensitiveTestimonial]) {
  assert(intakeBuildInput.publicFacts.some((fact) => fact.kind === "proof" && fact.value === text), `Supported fact did not reach the author: ${text}`);
}

// Operator regeneration re-derives business facts from the retained mirror
// alone: replaying the retained captures reproduces the same facts and proof.
const intakeReplay = await ingestWebsite({
  url: `${intakeOrigin}/`,
  siteId: intake.site.id,
  businessId: intake.site.businessId,
  now: "2026-09-23T00:00:00.000Z",
  crawlTransport: retainedWebsiteReplayTransport(intake.retainedSourceResources.map(({ resource, bytes }) => ({
    resource,
    ...(bytes ? { body: decodeRetainedSourceResource(resource, bytes) } : {})
  })))
});
const factSignature = (state: typeof intake.state) => state.facts
  .map((fact) => stableJson({ kind: fact.kind, label: fact.label, value: fact.value, publicEligible: fact.publicEligible, sourceUrl: fact.source.sourceUrl }))
  .sort();
assert.deepEqual(factSignature(intakeReplay.state), factSignature(intake.state),
  "Replaying the retained mirror did not reproduce the business facts.");
assert.deepEqual(intakeReplay.state.proof.map((item) => item.publicText), intake.state.proof.map((item) => item.publicText));
assert.equal(intakeReplay.state.identity.name, intake.state.identity.name);
assert.deepEqual(intakeReplay.state.contacts, intake.state.contacts);

assert.deepEqual(selectSourceContactAndLocation({
  ...activeCrawlShell(`${intakeOrigin}/`),
  extractedFacts: { ...activeCrawlShell(`${intakeOrigin}/`).extractedFacts, phone: "+19195550181" },
  pageSummaries: [{
    ...summarizeCrawlHtml(`<!doctype html><script type="application/ld+json">{"@type":"LocalBusiness","name":"Well Co","telephone":"919-555-0100"}</script><main><a href="tel:9195550181">Call (919) 555-0181</a></main>`, `${intakeOrigin}/`),
    source: "primary" as const
  }]
}, { phone: "+19195550100" }).phone, "+19195550181", "Structured or retained-text phones overrode the displayed site-wide phone.");
const structuredVsHeading = summarizeCrawlHtml(`<!doctype html><title>Home</title>
  <script type="application/ld+json">{"@type":"Organization","name":"Oak &amp; Pine Tree Care"}</script>
  <main><h1>Tree Removal You Can Trust</h1><a href="tel:512-555-0111">512-555-0111</a><a href="mailto:office@oak.example">Email</a></main>`, "https://oakandpine.example/");
assert.equal(structuredVsHeading.extractedFacts.name, "Oak & Pine Tree Care");
assert.equal(structuredVsHeading.extractedFacts.phone, "+15125550111");
assert.deepEqual(
  summarizeCrawlHtml(`<!doctype html><main><a href="hello@bare.example">Write to us</a></main>`, "https://bare.example/").linkReferences,
  [{ href: "mailto:hello@bare.example", text: "Write to us", kind: "mailto" }]
);
assert.equal(staticHtmlExportVariant("https://static.example/about"), "https://static.example/about.html");
for (const value of ["https://static.example/", "https://static.example/about/", "https://static.example/file.pdf"]) {
  assert.equal(staticHtmlExportVariant(value), undefined);
}
const credentialPage = (text: string) => ({
  ...summarizeCrawlHtml(`<!doctype html><title>About</title><main><h1>About</h1><p>${text}</p></main>`, `${intakeOrigin}/about`),
  source: "sampled_internal" as const
});
assert.deepEqual(selectObservedFirstPartyCredentials([
  credentialPage("Visit Suite #210 or reference Order #88123 and Invoice #4412. Call 919-555-0181."),
  credentialPage("We help family-owned businesses and are not family owned ourselves.")
], intakeOrigin, "2026-09-23T00:00:00.000Z"), [], "Suite, order, invoice, phone, or non-self ownership text became a credential.");
assert.deepEqual(selectObservedFirstPartyCredentials([
  credentialPage("Our company has been serving the valley since 1998."),
  credentialPage("Established in 2004, our crew works across the county.")
], intakeOrigin, "2026-09-23T00:00:00.000Z"), [], "Conflicting founding years were published instead of withheld.");
assert.deepEqual(selectObservedFirstPartyCredentials([
  credentialPage("HD ELECTRIC where we keep you out of the dark tecl #28122")
], intakeOrigin, "2026-09-23T00:00:00.000Z").map((item) => item.text), ["tecl #28122"]);

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
  selectObservedFirstPartyTestimonials([cmsDemoSummary], `${cmsOrigin}/`),
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

const mixedPlaceholderOrigin = "https://mixed-placeholder.example";
const mixedPlaceholderImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const mixedPlaceholderCrawl = await crawlWebsiteForGeneration({
  url: `${mixedPlaceholderOrigin}/`,
  validateUrl: async (value) => value,
  limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
  sleep: async () => undefined,
  fetchImpl: async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
    if (url.pathname === "/sitemap.xml") return response("missing", 404, "text/plain");
    if (url.pathname === "/") return response(`<!doctype html><title>Pristine Auto Detailing</title><main>
      <h1>Pristine Auto Detailing</h1><h2>Services</h2><h3>Auto Detailing</h3>
      <a href="/services/paint-correction">Paint Correction</a>
      <a href="/review-template">Review template</a>
      <a href="/placeholder-customer">Placeholder customer page</a>
    </main>`, 200);
    if (url.pathname === "/services/paint-correction") return response(`<!doctype html>
      <title>Paint Correction | Pristine Auto Detailing</title><main><h1>Paint Correction</h1>
      <p>Our multi-stage paint correction service removes visible swirl marks and restores gloss after an in-person paint assessment.</p>
      <section><h2>Select your vehicle size</h2><p>Lorem ipsum dolor sit amet.</p></section>
      <img src="/media/paint-correction.png" alt="Paint correction work">
      <blockquote>Contrary to popular belief, Lorem Ipsum is not simply random text.</blockquote>
    </main>`, 200);
    if (url.pathname === "/review-template") return response(`<!doctype html><title>Review</title><main>
      <h1>Review</h1><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></main>`, 200);
    if (url.pathname === "/placeholder-customer") return response(`<!doctype html><title>Placeholder Consultation</title><main>
      <h1>Placeholder Consultation</h1><blockquote>Lorem ipsum dolor sit amet.</blockquote></main>`, 200);
    if (url.pathname === "/media/paint-correction.png") return response(mixedPlaceholderImage, 200, "image/png");
    throw new Error(`unexpected_mixed_placeholder_fixture_url:${url.href}`);
  }
});
const mixedPlaceholderServicePage = mixedPlaceholderCrawl.ingestion.pages.find(page =>
  new URL(page.url).pathname === "/services/paint-correction");
assert.equal(mixedPlaceholderServicePage?.evidenceClass, "first_party",
  "An isolated placeholder component downgraded a specifically titled substantive service page.");
assert.deepEqual(
  new Set(selectSourceOfferingFacts(mixedPlaceholderCrawl.crawl, mixedPlaceholderCrawl.ingestion, []).map(offering => offering.name)),
  new Set(["Paint Correction", "Auto Detailing"]),
  "A specifically titled first-party service route or legitimate unrouted homepage service lost offering authority."
);
assert(mixedPlaceholderCrawl.captures.some(capture =>
  capture.role === "image"
  && capture.outcome === "fetched"
  && new URL(capture.requestedUrl).pathname === "/media/paint-correction.png"),
"Restored first-party service classification did not retain its dependent image resource.");
const mixedPlaceholderServiceSummary = mixedPlaceholderCrawl.crawl.pageSummaries.find(page =>
  new URL(page.url).pathname === "/services/paint-correction");
assert(mixedPlaceholderServiceSummary);
assert.deepEqual(selectObservedFirstPartyTestimonials(
  [mixedPlaceholderServiceSummary], mixedPlaceholderOrigin
), [], "Placeholder quotation text became first-party testimonial proof.");
assert.equal(mixedPlaceholderCrawl.ingestion.pages.find(page =>
  new URL(page.url).pathname === "/review-template")?.evidenceClass, "unknown",
"A generic template title plus placeholder body became first-party authority.");
const whollyPlaceholderPage = mixedPlaceholderCrawl.ingestion.pages.find(page =>
  new URL(page.url).pathname === "/placeholder-customer");
assert.equal(whollyPlaceholderPage?.evidenceClass, "first_party",
  "The documented conservative boundary no longer retains a specifically titled ambiguous page.");
const whollyPlaceholderSummary = mixedPlaceholderCrawl.crawl.pageSummaries.find(page =>
  new URL(page.url).pathname === "/placeholder-customer");
assert(whollyPlaceholderSummary);
assert.deepEqual(selectObservedFirstPartyTestimonials([whollyPlaceholderSummary], mixedPlaceholderOrigin), [],
  "A specifically titled but wholly placeholder page contributed testimonial proof.");
assert.deepEqual(
  new Set(selectSourceOfferingFacts(cmsCanonicalized.crawl, cmsCanonicalized.ingestion, []).map(offering => offering.name)),
  new Set(["Roaches", "Ants"]),
  "The customer-page correction discarded legitimate unrouted homepage service authority."
);

// Final-state boundary: a same-host, business-titled stale page is origin-eligible,
// but its conflicting facts and placeholder copy must not displace current primary
// authority. A substantive service page remains eligible despite an unfinished
// component paragraph.
const staleSpecialistOrigin = "https://current-finish.example";
const staleSpecialistDocuments = new Map([
  ["/", `<!doctype html><title>Current Finish Studio | Vehicle Care</title>
    <meta property="og:site_name" content="Current Finish Studio"><main>
    <h1>Current Finish Studio</h1>
    <p>Current Finish Studio provides careful vehicle appearance services for Austin drivers, with clear consultations and service recommendations based on the condition of each vehicle.</p>
    <p>Address: 100 Current Avenue, Austin, TX 78701</p>
    <p>Phone: 512-555-0100</p><p>Email: hello@currentfinish.example</p>
    <a href="/services/paint-correction">Paint Correction</a>
    <a href="/specialist/legacy-reviews">Vehicle specialist information</a>
  </main>`],
  ["/services/paint-correction", `<!doctype html><title>Paint Correction | Current Finish Studio</title><main>
    <h1>Paint Correction</h1>
    <p>Our paint correction service reduces visible swirl marks and restores gloss after an in-person assessment. The process and recommendation depend on the paint condition and the owner's goals.</p>
    <section><h2>Select your vehicle size</h2><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></section>
    <p>Call 512-555-0100 or email hello@currentfinish.example to discuss the vehicle.</p>
  </main>`],
  ["/specialist/legacy-reviews", `<!doctype html><title>Current Finish Studio TX</title><main>
    <h1>Current Finish Studio TX</h1><p>Minneapolis &amp; St Paul</p><h2>Heading</h2>
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique.</p>
    <h2>Professional Paint Services</h2>
    <p>A copied specialist template describes a different operator and market while remaining on this same-host legacy URL.</p>
    <p>Address: 743 Snelling Avenue, North Saint Paul, MN 55104</p>
    <p>Phone: 651-706-9895</p>
    <blockquote>Contrary to popular belief, Lorem Ipsum is not simply random text.</blockquote>
  </main>`]
]);
const staleSpecialistDns = mock.method(dns, "lookup", async (hostname: string) => {
  assert.equal(hostname, new URL(staleSpecialistOrigin).hostname,
    "Stale-specialist fixture attempted an unexpected DNS lookup.");
  return [{ address: "93.184.216.34", family: 4 }];
});
syncBuiltinESMExports();
const staleSpecialistFetch = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, staleSpecialistOrigin,
    "Stale-specialist fixture attempted an unexpected network request.");
  if (url.pathname === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
  if (url.pathname === "/sitemap.xml") return response("missing", 404, "text/plain");
  const html = staleSpecialistDocuments.get(url.pathname);
  return html === undefined ? response("missing", 404, "text/plain") : response(html, 200);
});
try {
  const staleSpecialistIngestion = await ingestWebsite({
    url: `${staleSpecialistOrigin}/`,
    now: "2026-09-16T00:00:00.000Z"
  });
  const stalePage = staleSpecialistIngestion.generationIngestion.pages.find(page =>
    new URL(page.url).pathname === "/specialist/legacy-reviews");
  assert.equal(stalePage?.evidenceClass, "first_party",
    "The conservative classifier no longer represented a business-titled same-host page as origin-eligible.");
  assert.equal(staleSpecialistIngestion.generationIngestion.pages.find(page =>
    new URL(page.url).pathname === "/services/paint-correction")?.evidenceClass, "first_party",
    "A component placeholder downgraded a real service page during final-state ingestion.");
  assert.equal(staleSpecialistIngestion.state.identity.name, "Current Finish Studio");
  assert.equal(staleSpecialistIngestion.state.contacts.phone, "+15125550100");
  assert.equal(staleSpecialistIngestion.state.contacts.email, "hello@currentfinish.example");
  assert.deepEqual(staleSpecialistIngestion.state.locations.map(location => ({
    street: location.street,
    city: location.city,
    region: location.region,
    postalCode: location.postalCode
  })), [{
    street: "100 Current Avenue",
    city: "Austin",
    region: "TX",
    postalCode: "78701"
  }], "A stale same-host specialist page displaced the current primary business location.");
  assert.deepEqual(staleSpecialistIngestion.state.offerings.map(offering => offering.name), ["Paint Correction"],
    "A stale same-host specialist mention displaced the direct current service route.");
  assert.deepEqual(staleSpecialistIngestion.state.serviceAreas, [],
    "A stale same-host specialist market became a current service area.");
  assert.deepEqual(staleSpecialistIngestion.state.proof, [],
    "Placeholder copy from a stale same-host specialist page became publishable proof.");
  assert.equal(staleSpecialistIngestion.state.facts.some(fact => fact.publicEligible
    && (fact.value === "+16517069895"
      || (typeof fact.value === "string" && /North Saint Paul|Professional Paint Services/i.test(fact.value)))), false,
    "A stale same-host phone, address, or offering became a publish-eligible fact.");
} finally {
  staleSpecialistFetch.mock.restore();
  staleSpecialistDns.mock.restore();
  syncBuiltinESMExports();
}
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

// Bob's Pest Control regression: a Squarespace placeholder site title ("bob")
// in <title>, og:site_name, WebSite JSON-LD, and logo alt must yield to the
// displayed name that extends it; unrelated headings never replace a name.
{
  const bobsHead = `<title>   bob</title><meta property="og:site_name" content="   bob"/><script type="application/ld+json">{"url":"https://www.bobspestcontrolep.com","name":"   bob","@context":"http://schema.org","@type":"WebSite"}</script>`;
  const bobsBody = `<header><img class="header-logo" src="/BOBS-2.png" alt="   bob"></header><main><h1>Pest Control in El Paso</h1><h2>Pest Control</h2><p>With Bob’s Pest Control on your side, you won’t have to worry.</p></main><footer><h4>Bob’s Pest Control</h4></footer>`;
  assert.equal(summarizeCrawlHtml(`<!doctype html><html><head>${bobsHead}</head><body>${bobsBody}</body></html>`, "https://www.bobspestcontrolep.com/").extractedFacts.name,
    "Bob’s Pest Control");
  const copyright = summarizeCrawlHtml(`<!doctype html><title>Haynes</title><main><h2>Termite Control</h2></main><footer>© 2026 Haynes Pest Control. All rights reserved.</footer>`, "https://www.haynespestcontrol.com/");
  assert.equal(copyright.extractedFacts.name, "Haynes Pest Control");
  const unrelated = summarizeCrawlHtml(`<!doctype html><title>Acme Roofing</title><main><h2>Acme Roofing Deals You Can Trust!</h2><h2>Roofing</h2></main>`, "https://acmeroofing.example/");
  assert.equal(unrelated.extractedFacts.name, "Acme Roofing");
}

// Best Pest / Haynes / Central NYC regressions: a shared "counties in
// Michigan" qualifier applies to every listed place, and city landing pages
// are locations, not offerings.
{
  const countyAreas = summarizeCrawlHtml(`<!doctype html><title>Best Pest</title><main><h3>Your local, family owned pest control company proudly serving Bay, Saginaw and Midland counties in Michigan.</h3></main>`,
    "https://www.bestpestanimalcontrol.net/").extractedFacts.serviceAreas;
  assert.deepEqual(countyAreas, ["Bay County", "Saginaw County", "Midland County"]);
  const locationOrigin = "https://location-landing.example";
  const locationDocuments = new Map([
    ["/", pageHtml("Location Landing Pest", ["/rodent-control", "/services/termite-control", "/midland-mi-pest-control", "/pest-control-brooklyn-ny", "/pest-control-in-frostproof", "/termite-control-avon-park-florida", "/rodent-control-in-attics"], "", "Proudly serving Bay, Saginaw and Midland counties in Michigan.")],
    ["/rodent-control", pageHtml("Rodent Control")],
    ["/services/termite-control", pageHtml("Termite Control")],
    ["/midland-mi-pest-control", pageHtml("Midland, MI Pest Control")],
    ["/pest-control-brooklyn-ny", pageHtml("Pest Control Brooklyn NY")],
    ["/pest-control-in-frostproof", pageHtml("Pest Control in Frostproof")],
    ["/termite-control-avon-park-florida", pageHtml("Termite Control Avon Park Florida")],
    ["/rodent-control-in-attics", pageHtml("Rodent Control in Attics")]
  ]);
  const locationCrawl = await crawlWebsiteForGeneration({
    url: `${locationOrigin}/`,
    validateUrl: async (value) => value,
    limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
    sleep: async () => undefined,
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
      if (path === "/sitemap.xml") return response("", 404, "text/plain");
      const document = locationDocuments.get(path);
      return document ? response(document, 200) : response("missing", 404, "text/plain");
    }
  });
  const locationOfferings = new Set(selectSourceOfferingFacts(locationCrawl.crawl, locationCrawl.ingestion).map((offering) => offering.name));
  for (const expected of ["Rodent Control", "Termite Control", "Rodent Control In Attics"]) {
    assert.ok(locationOfferings.has(expected), `Service page ${expected} lost offering authority: ${[...locationOfferings].join(", ")}`);
  }
  for (const location of ["Midland Mi Pest Control", "Mi Pest Control", "Pest Control Brooklyn Ny", "Pest Control In Frostproof", "Termite Control Avon Park Florida"]) {
    assert.ok(!locationOfferings.has(location), `City landing page ${location} became an offering.`);
  }
}

// Best Pest / Haynes regressions: a first-party "Testimonials" section on a
// non-review page (a Wix homepage strip with id-scoped cards, an About-page
// tab label) yields verbatim attributed testimonials; a Google widget does not.
{
  const wixHome = summarizeCrawlHtml(`<!doctype html><title>Best Pest</title><main>
    <div id="WRchTxt8"><h5>Testimonials</h5></div>
    <div id="comp-card1"><p>Best Pest &amp; Animal Control have done an outstanding job! They came out and placed traps the same day.</p><p>​</p><p>Kerry Dean, Essexville</p></div>
    <div id="comp-card2"><p>Very professional and not out to make a quick buck. I wish ALL companies were this honest.</p><p>​</p><p>Kendra Avery, Bay City</p></div>
  </main>`, "https://www.bestpestanimalcontrol.net/");
  assert.deepEqual(
    selectObservedFirstPartyTestimonials([wixHome], "https://www.bestpestanimalcontrol.net/").map((item) => item.author),
    ["Kerry Dean", "Kendra Avery"],
    "Attributed testimonial cards in a labeled homepage section were missed."
  );
  const tabbedAbout = summarizeCrawlHtml(`<!doctype html><title>About</title><main>
    <div><div>Overview</div><div>Testimonials</div></div>
    <div><p>We are a third generation family business.</p></div>
    <div><div>Testimonials</div>
      <div><div>“I have used him in the past, have recommended him to several people and am using him now.”</div></div>
      <div><div>— Aimee B.</div></div>
      <div><div>“Great service n dependable great prices too. Recommend to all.”</div></div>
      <div><div>— Nancy A.</div></div>
    </div>
    <div><div>Customer Reviews</div><div>Based on 166 reviews</div><div>Posted on Google</div><div>Brenda Schmidt</div><div>“Had Haynes out today for annual pest control service and as always very thorough.”</div></div>
  </main>`, "https://haynespestcontrol.com/about");
  const tabbed = selectObservedFirstPartyTestimonials([tabbedAbout], "https://haynespestcontrol.com/");
  assert.deepEqual(tabbed.map((item) => item.author), ["Aimee B.", "Nancy A."]);
  assert.ok(tabbed.every((item) => !/Had Haynes out today/.test(item.text)), "A Google review widget became first-party testimony.");
  const unlabeled = summarizeCrawlHtml(`<!doctype html><title>Home</title><main><div id="hero"><p>“We have served this valley with care for three decades and counting.”</p><p>Jim Smith</p></div></main>`, "https://unlabeled.example/");
  assert.deepEqual(selectObservedFirstPartyTestimonials([unlabeled], "https://unlabeled.example/"), [],
    "Quoted copy outside a review page or labeled testimonial section became a testimonial.");
}

// Altura regression: broken-markup link artifacts are never crawl inventory,
// and injected off-topic posts are recognized only when the homepage never
// mentions their topic.
assert.equal(isMalformedSourceLinkPath("/privacy-policy/%22tel:9256597405%22%3E925-659-7405%3C/a%3E%22"), true);
assert.equal(isMalformedSourceLinkPath("/contact/mailto:office@example.com"), true);
assert.equal(isMalformedSourceLinkPath("/residential/ants-spiders"), false);
assert.equal(isMalformedSourceLinkPath("/hotel-pest-control"), false);
assert.equal(isLikelyInjectedSpamSourcePage({ path: "/blog/tower-rush-1win-jeu-dadresse", title: "Tower Rush 1win" }, "Altura Pest Control serves Livermore."), true);
assert.equal(isLikelyInjectedSpamSourcePage({ path: "/casino-pest-control", title: "Casino pest control" }, "We protect every casino on the Las Vegas strip."), false);
assert.equal(isLikelyInjectedSpamSourcePage({ path: "/residential/bed-bugs", title: "Bed Bugs" }, "Pest control."), false);
{
  const malformedOrigin = "https://malformed-link.example";
  const malformedCrawl = await crawlWebsiteForGeneration({
    url: `${malformedOrigin}/`,
    validateUrl: async (value) => value,
    limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
    sleep: async () => undefined,
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
      if (path === "/sitemap.xml") return response("", 404, "text/plain");
      if (path === "/") return response(pageHtml("Home", ["/privacy-policy"]), 200);
      if (path === "/privacy-policy") return response(`<!doctype html><title>Privacy</title><main><p>${"Privacy terms for customers. ".repeat(20)}</p><a href="&quot;tel:9256597405&quot;&gt;925-659-7405&lt;/a&gt;">925-659-7405</a></main>`, 200);
      throw new Error(`unexpected_malformed_fixture_url:${url}`);
    }
  });
  assert.ok(malformedCrawl.ingestion.pages.every((entry) => !/%22|tel:/i.test(entry.url)),
    "An unquoted tel: href was crawled as a page path.");
}

// Foothills Pest regression: the same hours rendered in two display formats on
// two first-party pages for one street address are not a contradiction.
{
  const hoursOrigin = "https://hours-format.example";
  const addressLine = "<p>1200 Canyon Road, Boise, ID 83702</p>";
  const hoursPage = (path: string, hoursHtml: string) =>
    summarizeCrawlHtml(`<!doctype html><title>Hours fixture</title><main>${addressLine}${hoursHtml}</main>`, `${hoursOrigin}${path}`);
  const compact = hoursPage("/", "<p>Mon-Fri 8am-5pm</p>");
  const longForm = hoursPage("/contact", "<p>Monday: 8:00 AM - 5:00 PM</p><p>Tuesday: 8:00 AM - 5:00 PM</p><p>Friday: 8:00 AM - 5:00 PM</p><p>Saturday: Closed</p>");
  const different = hoursPage("/about", "<p>Mon-Fri 9am-6pm</p>");
  assert.ok(compact.extractedFacts.hours && longForm.extractedFacts.hours && different.extractedFacts.hours,
    "The hours fixture did not extract visible hours.");
  const hoursCrawl = (pages: typeof compact[]) => ({ ...activeCrawlShell(`${hoursOrigin}/`), pageSummaries: pages });
  assert.equal(hasContradictoryFirstPartyLocationHours(hoursCrawl([compact, longForm])), false,
    "Equivalent hours in different display formats were rejected as contradictory.");
  assert.equal(hasContradictoryFirstPartyLocationHours(hoursCrawl([compact, different])), true,
    "Genuinely different hours for the same address were not flagged.");
  assert.equal(hasContradictoryFirstPartyLocationHours(hoursCrawl([longForm, hoursPage("/visit", "<p>Saturday: 9am-1pm</p>")])), true,
    "Closed versus open on the same day was not flagged.");
}

// A text block over the size cap is split into verbatim sentence-aligned
// pieces, never dropped whole.
{
  const sentences = Array.from({ length: 90 }, (_value, index) => `Our crew completed restoration project number ${index + 1} with careful cleanup and a final walkthrough.`);
  const longHtml = `<!doctype html><title>Story</title><main><p>${sentences.join(" ")}</p></main>`;
  const longBlocks = summarizeCrawlHtml(longHtml, "https://long-block.example/story").sourceTextBlocks;
  assert.ok(longBlocks.length >= 2, "An oversized text block was not split.");
  assert.ok(longBlocks.every((block) => block.displayText.length <= 4_000), "A split piece exceeds the block cap.");
  assert.equal(longBlocks.map((block) => block.displayText).join(" "), sentences.join(" "),
    "Splitting an oversized block lost or changed source text.");
  assert.equal(new Set(longBlocks.map((block) => block.id)).size, longBlocks.length, "Split pieces share a block id.");
}

// Split schedules (Mon-Fri 8-5, Sat 9-1) stated in different formats on two
// first-party pages agree day by day; only a same-day conflict withholds hours.
{
  const splitOrigin = "https://split-hours.example";
  const address = "<p>1200 Canyon Road, Boise, ID 83702</p>";
  const crawlSplit = (contactHours: string) => crawlWebsiteForGeneration({
    url: `${splitOrigin}/`,
    validateUrl: async (value) => value,
    limits: { minimumStartSpacingMs: 0, transientRetries: 0 },
    sleep: async () => undefined,
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return response("User-agent: *\nAllow: /", 200, "text/plain");
      if (path === "/sitemap.xml") return response("", 404, "text/plain");
      if (path === "/") return response(pageHtml("Home", ["/contact"], "", `</p>${address}<p>Mon-Fri 8am-5pm</p><p>Saturday: 9am-1pm</p><p>`), 200);
      if (path === "/contact") return response(pageHtml("Contact", [], "", `</p>${address}${contactHours}<p>`), 200);
      throw new Error(`unexpected_split_hours_fixture_url:${url}`);
    }
  });
  const agreeing = await crawlSplit("<p>Monday - Friday: 8:00 AM - 5:00 PM</p><p>Sat: 9:00 AM - 1:00 PM</p><p>Sunday: Closed</p>");
  const agreedHours = agreeing.crawl.extractedFacts.hours;
  assert.ok(agreedHours && Object.keys(agreedHours).some((label) => /saturday/i.test(label)),
    `Split hours stated in two formats were withheld: ${JSON.stringify(agreedHours)}`);
  assert.ok(Object.keys(agreedHours!).some((label) => /friday/i.test(label)), "Weekday hours were lost from the split schedule.");
  const conflicting = await crawlSplit("<p>Monday - Friday: 8:00 AM - 5:00 PM</p><p>Saturday: 10:00 AM - 2:00 PM</p>");
  assert.equal(conflicting.crawl.extractedFacts.hours, undefined, "A same-day hours conflict was not withheld.");
}

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

const storyAreaSummary = {
  ...summarizeCrawlHtml(`<!doctype html><title>Our Story</title><main>
    <h1>About Cedar Electric</h1>
    <p>We serve the Austin &amp; surrounding areas to include Round Rock, Cedar Park, and Georgetown.</p>
  </main>`, `${authorityOrigin}/our-story.html`),
  source: "sampled_internal" as const
};
assert.deepEqual(storyAreaSummary.extractedFacts.serviceAreas, ["Austin", "Round Rock", "Cedar Park", "Georgetown"],
  "An explicit list after surrounding areas lost its named markets or retained a composite phrase.");
const storyAreaCrawl = { ...authorityCrawl, pageSummaries: [storyAreaSummary] };
const storyAreaIngestion = {
  ...authorityIngestion,
  pages: [{ ...authorityIngestion.pages[0]!, url: storyAreaSummary.url, finalUrl: storyAreaSummary.url,
    summary: storyAreaSummary, evidenceClass: "first_party" as const }]
};
const acceptedStoryAreas = (crawl: typeof storyAreaCrawl, ingestion = storyAreaIngestion) =>
  sourcePreparationDiagnosticsFor(crawl, ingestion).facts
    .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
    .map((fact) => String(fact.value));
assert.deepEqual(acceptedStoryAreas(storyAreaCrawl), ["Austin", "Round Rock", "Cedar Park", "Georgetown"],
  "An explicit first-party company-story coverage statement was discarded because of a legacy filename.");
assert.deepEqual(acceptedStoryAreas({ ...storyAreaCrawl,
  pageSummaries: [{ ...storyAreaSummary, purposeTags: ["about", "blog"] }]
}), [], "A story-like blog page became geographic authority.");
assert.deepEqual(sourcePreparationDiagnosticsFor(storyAreaCrawl, {
  ...storyAreaIngestion,
  pages: storyAreaIngestion.pages.map((page) => ({ ...page, evidenceClass: "third_party" as const }))
}).facts.filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted"), [],
"Third-party text became service-area authority.");

const legacyServiceList = {
  ...summarizeCrawlHtml(`<!doctype html><title>Services</title><main>
    <h1>Cedar Electric Services</h1>
    <h3>Dimmers    Doorbells    Ballasts<br>Grounding   Service Loops<br>Ceiling Fans   Lighting<br>Commercial Tenant (Finish-Out)</h3>
    <h1>About the company</h1><h3>Unrelated heading</h3>
  </main>`, `${authorityOrigin}/services.html`),
  source: "sampled_internal" as const
};
const listOfferings = selectSourceOfferingFacts({ ...authorityCrawl, pageSummaries: [legacyServiceList] }, {
  ...authorityIngestion, pages: [{ ...authorityIngestion.pages[0]!, url: legacyServiceList.url,
    finalUrl: legacyServiceList.url, summary: legacyServiceList, evidenceClass: "first_party" }]
}, []);
assert.deepEqual(new Set(listOfferings.map(o => o.name)), new Set([
  "Dimmers", "Doorbells", "Ballasts", "Grounding", "Service Loops", "Ceiling Fans", "Lighting", "Commercial Tenant Finish Out"
]), "An explicit legacy heading list collapsed into an unusable phrase, lost a multiword service, or crossed into the next section.");
assert(listOfferings.every(o => o.evidence.sourceUrl === legacyServiceList.url && o.evidence.sourceBlockId),
  "Parsed offerings lost their exact first-party block provenance.");
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

// A first-party service-area directory need not have a separate URL per town.
// Preserve explicit heading/list evidence without promoting nearby prose,
// service lists, unrelated containers or off-site copies into geography.
const directoryTowns = [
  "Austin", "Bartlett", "Bee Cave", "Briarcliff", "Cedar Park", "Florence",
  "Georgetown", "Granger", "Hutto", "Jonestown", "Lago Vista", "Lakeway",
  "Leander", "Liberty Hill", "Lost Creek", "Manchaca", "Manor", "Pflugerville",
  "Rollingwood", "Round Rock", "Taylor", "West Lake Hills"
];
const explicitAreaHtml = `<!doctype html><main>
  <h1>Service area</h1>
  <p>Ask us about properties outside the listed areas.</p>
  <h2>Austin &amp; Surrounding Areas</h2><p>${directoryTowns.join(", ")}</p>
  <h2>Burnet &amp; Surrounding Areas</h2><ul><li>Bertram</li><li>Marble Falls</li></ul>
  <h2>Areas We Serve</h2><p>St. Louis, MO; Paris, TX</p>
  <h2>Services</h2><p>Planting, Trimming, Well Drilling</p>
  <section><h2>Service Areas</h2></section><aside><p>Seattle, Portland</p></aside>
  <h2>Areas we do not serve</h2><p>Dallas, Houston</p>
  <h2>Service Areas</h2><p>Call us to discuss your property.</p><p>Boston, Albany</p>
</main><footer><h2>Service Areas</h2><p>Phoenix, Tucson</p></footer>`;
const explicitAreaSummary = {
  ...summarizeCrawlHtml(explicitAreaHtml, `${authorityOrigin}/service-area`),
  source: "sampled_internal" as const
};
const explicitAreaCrawl = {
  ...authorityCrawl, pageSummaries: [explicitAreaSummary],
  extractedFacts: { ...authorityCrawl.extractedFacts, serviceAreas: explicitAreaSummary.extractedFacts.serviceAreas }
};
const explicitAreaIngestion = {
  ...authorityIngestion,
  pages: [{ ...authorityIngestion.pages[0]!, url: explicitAreaSummary.url,
    finalUrl: explicitAreaSummary.url, summary: explicitAreaSummary,
    internalLinks: [], evidenceClass: "first_party" as const }]
};
const expectedDirectoryTowns = [...directoryTowns, "Burnet", "Bertram", "Marble Falls", "St. Louis MO", "Paris TX"];
for (const entry of explicitServiceAreaListEvidence(explicitAreaSummary.url, explicitAreaSummary.sourceTextBlocks)) {
  assert(explicitAreaSummary.sourceTextBlocks.includes(entry.block), "Locality evidence lost its exact retained source block.");
  assert(entry.block.displayText.replace(/,/g, "").includes(entry.label), "Locality label is not visible in its bound source block.");
}
const acceptedDirectoryTowns = sourcePreparationDiagnosticsFor(explicitAreaCrawl, explicitAreaIngestion).facts
  .filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted")
  .map((fact) => String(fact.value));
assert.deepEqual(new Set(acceptedDirectoryTowns), new Set(expectedDirectoryTowns),
  "Explicit first-party service-area lists were lost, truncated to 12/20, or escaped their heading/container context.");
const offSiteAreaSummary = { ...explicitAreaSummary, url: "https://directory.example/service-area" };
assert.equal(sourcePreparationDiagnosticsFor(
  { ...explicitAreaCrawl, pageSummaries: [offSiteAreaSummary] },
  { ...explicitAreaIngestion, pages: [{ ...explicitAreaIngestion.pages[0]!,
    url: offSiteAreaSummary.url, finalUrl: offSiteAreaSummary.url, summary: offSiteAreaSummary }] }
).facts.filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted").length, 0,
"An off-site copy of a locality list became first-party authority.");
const editorialAreaSummary = {
  ...summarizeCrawlHtml(explicitAreaHtml, `${authorityOrigin}/articles/local-history`),
  source: "sampled_internal" as const
};
assert.equal(sourcePreparationDiagnosticsFor(
  { ...explicitAreaCrawl, pageSummaries: [editorialAreaSummary] },
  { ...explicitAreaIngestion, pages: [{ ...explicitAreaIngestion.pages[0]!,
    url: editorialAreaSummary.url, finalUrl: editorialAreaSummary.url, summary: editorialAreaSummary }] }
).facts.filter((fact) => fact.kind === "service_area" && fact.disposition === "accepted").length, 0,
"A locality list on an editorial page became operational service-area authority.");

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
const mixedRoleOfferingPages = [
  {
    path: "/services/ceramic-coating",
    title: "Ceramic coating in the Austin area",
    purposeTags: ["service_detail", "location"] as const
  },
  {
    path: "/services/paint-protection-film",
    title: "Visit us for paint protection film",
    purposeTags: ["service_detail", "location"] as const
  },
  {
    path: "/portfolio/1972-porsche-911-targa-restoration",
    title: "1972 Porsche 911 Targa restoration service project",
    purposeTags: ["service_detail", "gallery"] as const
  },
  {
    path: "/portfolio/custom-ppf-package-for-a-lamborghini-miura",
    title: "Custom PPF package service project",
    purposeTags: ["service_detail", "gallery"] as const
  },
  {
    path: "/window-tint-installation",
    title: "Window tint installation",
    purposeTags: ["service_detail"] as const
  }
].map(({ path, title, purposeTags }) => ({
  ...summarizeCrawlHtml(pageHtml(title), `${authorityOrigin}${path}`),
  source: "sampled_internal" as const,
  purposeTags: [...purposeTags]
}));
const mixedRoleOfferingCrawl = { ...authorityCrawl, pageSummaries: mixedRoleOfferingPages };
const mixedRoleOfferingIngestion = {
  ...authorityIngestion,
  pages: mixedRoleOfferingPages.map((summary) => ({
    ...authorityIngestion.pages[0]!,
    url: summary.url,
    finalUrl: summary.url,
    summary,
    evidenceClass: "first_party" as const
  }))
};
assert.deepEqual(
  selectSourceOfferingFacts(mixedRoleOfferingCrawl, mixedRoleOfferingIngestion, []).map((offering) => offering.name),
  ["Ceramic Coating", "Paint Protection Film", "Window Tint Installation"],
  "Incidental purpose tags displaced explicit service routes or promoted project evidence into canonical offerings."
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
      "Professional Tree Removal, Tree Trimming, and Emergency Tree Service in central Texas. We are a Tree Service Company in Austin, TX, Serving Central Texas with Tree Removal, Trimming, Planting, and Emergency Tree Care."
    ),
    `${treeAuthorityOrigin}/`
  ),
  source: "primary" as const,
  purposeTags: ["home" as const],
  extractedFacts: {
    ...summarizeCrawlHtml(pageHtml("Tree service home"), `${treeAuthorityOrigin}/`).extractedFacts,
    address: { city: "Austin", region: "TX", country: "US" },
    services: ["Austin Tree Services", "Tree Removal", "Tree Trimming and Pruning", "Tree Planting Service", "Emergency Tree Service"],
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
    address: treeAuthorityHome.extractedFacts.address,
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
    if (path === "/projects/kitchen") return response(`${pageHtml("Kitchen project")}<img src="/wp-content/gallery/kitchen/thumbs/thumbs_after.jpg" alt="Finished kitchen"><div data-bgimg="https://media.example/original" style="background-image:url(https://media.example/small)"></div><div data-bgimg="javascript:alert(1)"></div>`, 200);
    if (url === "https://media.example/original" || url === "https://media.example/small") return response("retained-image", 200, "image/jpeg");
    if (path === "/wp-content/gallery/kitchen/thumbs/thumbs_after.jpg") return response("thumbnail", 200, "image/jpeg");
    if (path === "/wp-content/gallery/kitchen/after.jpg") return response("full-resolution-image", 200, "image/jpeg");
    throw new Error(`unexpected_gallery_fixture_url:${url}`);
  }
});
assert(
  galleryOriginal.captures.some((capture) => capture.requestedUrl === `${galleryOrigin}/wp-content/gallery/kitchen/after.jpg` && capture.outcome === "fetched"),
  "A directly evidenced NextGEN gallery thumbnail did not discover its first-party original."
);
assert(galleryOriginal.captures.some(capture => capture.requestedUrl === "https://media.example/original" && capture.outcome === "fetched"),
  "An explicit gallery-container original was missed while its inline thumbnail was retained.");
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
