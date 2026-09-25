import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeLinkReference, type CrawlAssessment } from "../lib/crawler";
import { isPaymentLink, isRequiredCustomerDestination } from "../packages/site-contracts";
import {
  isCustomerPortalLink,
  normalizeServiceAreaCandidate,
  selectBusinessCategories,
  selectSupportingSourceBlock,
  selectSourceOfferingFacts,
  selectSourceLinksForGeneration,
  sourcePageForFunctionalLink
} from "../packages/business-data/website-ingestion";
import type { WebsiteGenerationIngestion } from "../packages/business-data/generation-crawler";
import { classifySourcePagePath } from "../packages/business-data/source-page-classification";

assert.equal(isCustomerPortalLink("https://surgepestcontrol.pestportals.com/landing/index", "Login"), true);
assert.equal(isCustomerPortalLink("https://kindpest.fieldportals.com/", ""), true);
assert.equal(isCustomerPortalLink("https://portal.example.com/customer/login", "Customer portal"), true);
assert.equal(isCustomerPortalLink("https://example.com/wp-login.php", "Log in"), false);
assert.equal(isCustomerPortalLink("https://facebook.com/login", "Log in"), false);
assert.equal(isCustomerPortalLink("https://example.com/blog/accounting-tips", "Accounting tips"), false);

const crawl = {
  extractedFacts: { socialLinks: [], bookingLinks: [] },
  pageSummaries: [{
    url: "https://surgepest.com/",
    sourceTextBlocks: [],
    extractedFacts: { socialLinks: [], bookingLinks: [] },
    linkReferences: [{
      href: "https://surgepestcontrol.pestportals.com/landing/index",
      text: "Login",
      kind: "external"
    }]
  }]
} as unknown as CrawlAssessment;

assert.equal(
  sourcePageForFunctionalLink(crawl, "https://surgepestcontrol.pestportals.com/landing/index"),
  "https://surgepest.com/"
);

assert.deepEqual(selectSourceLinksForGeneration("https://surgepest.com/", crawl), [
  { kind: "website", label: "Source website", url: "https://surgepest.com/" },
  {
    kind: "other",
    label: "Customer Login",
    url: "https://surgepestcontrol.pestportals.com/landing/index"
  }
]);

// Bill payment and third-party booking are kept alongside the customer portal.
assert.equal(isPaymentLink("https://www.paypal.com/paypalme/haynespest", ""), true);
assert.equal(isPaymentLink("https://buy.stripe.com/abc123", "Pay"), true);
assert.equal(isPaymentLink("https://pay.fieldservice.example/invoice", "Pay Bill"), true);
assert.equal(isPaymentLink("https://link.clover.com/urlshortener/abc", "Pay Bill"), false, "A shortener hides its destination.");
assert.equal(isPaymentLink("https://example.com/blog/payday-tips", "Payday tips"), false);
assert.equal(isRequiredCustomerDestination({ url: "https://calendly.com/altar/massage", label: "Book Online", kind: "booking" }), true);
assert.equal(isRequiredCustomerDestination({ url: "https://www.facebook.com/altar", label: "Facebook", kind: "social" }), false);
const flows = selectSourceLinksForGeneration("https://altarspa.example/", {
  extractedFacts: { socialLinks: [], bookingLinks: [] },
  pageSummaries: [{
    url: "https://altarspa.example/",
    sourceTextBlocks: [],
    extractedFacts: { socialLinks: [], bookingLinks: ["https://altarspa.example/book-now/", "https://book.squareup.com/appointments/abc/location/xyz"] },
    linkReferences: [
      { href: "https://altarspa.example/pay/", text: "Pay Bill", kind: "internal" },
      { href: "https://www.paypal.com/paypalme/altarspa", text: "Pay Bill", kind: "external" }
    ]
  }]
} as unknown as CrawlAssessment);
assert.deepEqual(flows.filter((link) => link.kind !== "website"), [
  { kind: "booking", label: "Book Online", url: "https://book.squareup.com/appointments/abc/location/xyz" },
  { kind: "other", label: "Pay Bill", url: "https://www.paypal.com/paypalme/altarspa" }
], "Same-site booking and payment pages are rebuilt, while third-party booking and payment links are kept.");

// Square serves appointments and online stores: only its booking surfaces are booking.
const kindOf = (href: string, text?: string) => normalizeLinkReference(href, "https://altarspa.example/", "altarspa.example", text)?.kind;
assert.equal(kindOf("https://book.squareup.com/appointments/abc/location/xyz"), "booking");
assert.equal(kindOf("https://squareup.com/appointments/book/abc/xyz"), "booking");
assert.equal(kindOf("https://squareup.com/store/altar-spa"), "ordering");
assert.equal(kindOf("https://book.housecallpro.com/book/Pest-Pros/abc"), "booking");
assert.equal(kindOf("https://www.doordash.com/store/altar"), "ordering");

const repeatedPhone = "+1 (919) 981-9798";
const supportingPhoneBlock = selectSupportingSourceBlock([
  { id: "review_phone", sourceUrl: "https://kindpest.com/reviews/", containerId: "p:1", displayText: repeatedPhone },
  { id: "homepage_phone", sourceUrl: "https://kindpest.com/", containerId: "a:1", displayText: repeatedPhone }
] as never[], repeatedPhone, new Map([
  ["https://kindpest.com/reviews/", "third_party" as const],
  ["https://kindpest.com/", "first_party" as const]
]));
assert.equal(supportingPhoneBlock?.id, "homepage_phone", "Repeated contact facts must prefer first-party page evidence over review-page evidence.");

assert.deepEqual(selectBusinessCategories(["Web Page", "Profile Page", "Pest Control Service"]), ["Pest Control Service"]);
assert.deepEqual(selectBusinessCategories(["Professional Service", "Organization", "Local Business"]), [], "A category is never inferred from the business name or services.");
assert.deepEqual(selectBusinessCategories(["Web Page", "Roofing Contractor"]), ["Roofing Contractor"]);
assert.equal(classifySourcePagePath("/header/header-4/"), "technical_or_utility");
assert.equal(classifySourcePagePath("/trimprimblocks/home-1-slide-1"), "technical_or_utility");
assert.equal(classifySourcePagePath("/service_category/rodents"), "mechanical_archive");
assert.equal(classifySourcePagePath("/rodent-control"), "customer_content");
assert.equal(normalizeServiceAreaCandidate("Apex"), "Apex");
assert.equal(normalizeServiceAreaCandidate("in Holly Springs"), "Holly Springs");
assert.equal(normalizeServiceAreaCandidate("all of Orange County"), "Orange County");
assert.equal(normalizeServiceAreaCandidate("100 five-star reviewers"), undefined);
assert.equal(normalizeServiceAreaCandidate("bed bugs"), undefined);
assert.equal(normalizeServiceAreaCandidate("our team provides fast"), undefined);
assert.equal(normalizeServiceAreaCandidate("Round Rock"), "Round Rock");
assert.equal(normalizeServiceAreaCandidate("Roof Repair"), undefined, "A generic service action is not a place in any trade.");
assert.equal(normalizeServiceAreaCandidate("Gutter Cleaning"), undefined);

const retainedKindNoise = [
  "100 five-star Google reviews",
  "bed bugs",
  "cockroaches",
  "more",
  "apartments",
  "environment",
  "not the mosquitoes",
  "offices",
  "pets",
  "every day across Raleigh"
];
assert.deepEqual(retainedKindNoise.map(normalizeServiceAreaCandidate), retainedKindNoise.map(() => undefined));

const factPages = [
  { url: "https://surgepest.com/rodent-control", purposeTags: ["service_detail"], services: ["Rodent Control", "Rodent Control Raleigh"] },
  { url: "https://surgepest.com/ant-control", purposeTags: ["service_detail"], services: ["Ant Control", "Ant Control Raleigh NC", "Ant Treatment Cost Raleigh NC 2026"] },
  { url: "https://surgepest.com/austin-pest-control", purposeTags: ["location"], services: ["Austin Pest Control"] },
  { url: "https://surgepest.com/header/header-4", purposeTags: ["other"], services: ["Header 4"] },
  { url: "https://surgepest.com/trimprimblocks/tab-content", purposeTags: ["other"], services: ["Landscaping", "Option Panel"] }
] as const;
const sourceFactCrawl = {
  pageSummaries: factPages.map((page) => ({
    url: page.url,
    purposeTags: page.purposeTags,
    extractedFacts: { services: page.services },
    sourceTextBlocks: []
  }))
} as unknown as CrawlAssessment;
const sourceFactIngestion = {
  pages: factPages.map((page) => ({
    url: page.url,
    finalUrl: page.url,
    evidenceClass: "first_party",
    summary: { url: page.url }
  }))
} as unknown as WebsiteGenerationIngestion;
assert.deepEqual(new Set(selectSourceOfferingFacts(sourceFactCrawl, sourceFactIngestion, ["Raleigh NC"]).map((item) => item.name)), new Set([
  "Ant Control",
  "Rodent Control"
]));

const repositorySource = await readFile(new URL("../packages/platform-data/repository.ts", import.meta.url), "utf8");
assert.match(repositorySource, /blob_content_hash: value\.blobContentHash \?\? null/,
  "Body-less retained resources must normalize undefined hashes to SQL null before immutable verification.");
assert.match(repositorySource, /outcome: row\.outcome,[\s\S]{0,120}status: row\.status \?\? undefined/,
  "Retained resources without an HTTP response must normalize SQL null status values on read.");

console.log("Source functional-link verification passed.");
