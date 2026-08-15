import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { CrawlAssessment } from "../lib/crawler";
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
assert.deepEqual(selectBusinessCategories(["Professional Service", "Organization", "Local Business"], ["Kind Pest Control"]), ["Pest Control Service"]);
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
assert.deepEqual(selectSourceOfferingFacts(sourceFactCrawl, sourceFactIngestion, ["Raleigh NC"]).map((item) => item.name), [
  "Ant Control",
  "Rodent Control"
]);

const repositorySource = await readFile(new URL("../packages/platform-data/repository.ts", import.meta.url), "utf8");
assert.match(repositorySource, /blob_content_hash: value\.blobContentHash \?\? null/,
  "Body-less retained resources must normalize undefined hashes to SQL null before immutable verification.");
assert.match(repositorySource, /outcome: row\.outcome,[\s\S]{0,120}status: row\.status \?\? undefined/,
  "Retained resources without an HTTP response must normalize SQL null status values on read.");

console.log("Source functional-link verification passed.");
