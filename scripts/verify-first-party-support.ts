import assert from "node:assert/strict";
import {
  FirstPartySupport,
  firstPartyImageHost,
  firstPartyPageRole,
  isAffiliateOrTrackingLink,
  isDatedOrPromotionalText,
  reconcileFirstPartyValues,
  sensitiveFirstPartyTopics,
  supportedOnCurrentCorePage
} from "../packages/business-data/first-party-support";

// Page roles: core pages versus blog, archive, legal.
assert.equal(firstPartyPageRole({ path: "/" }), "home");
assert.equal(firstPartyPageRole({ path: "/contact-us" }), "contact");
assert.equal(firstPartyPageRole({ path: "/about" }), "about");
assert.equal(firstPartyPageRole({ path: "/tree-removal" }), "service");
assert.equal(firstPartyPageRole({ path: "/blog/2019-spring-special" }), "blog");
assert.equal(firstPartyPageRole({ path: "/2021/05/our-news" }), "blog");
assert.equal(firstPartyPageRole({ path: "/category/tips" }), "archive");
assert.equal(firstPartyPageRole({ path: "/privacy-policy" }), "legal");

const support = new FirstPartySupport([
  { url: "https://acme.example/", text: "Acme Roofing\nEvery roof we install carries a 10-year workmanship warranty.\nCall (919) 555-0100", links: ["tel:9195550100", "https://www.bbb.org/us/nc/acme-roofing", "https://partner.example/financing?utm_source=acme"] },
  { url: "https://acme.example/blog/2018-promo", text: "Limited time: 20% off every roof through June 30, 2018.", links: ["https://amzn.to/abc"] },
  { url: "https://acme.example/online-casino-bonus", title: "Online casino bonus", text: "Best casino bonus codes.", links: ["https://casino.example/"] }
]);
assert.equal(support.text("Every roof we install carries a 10-year workmanship warranty.").length, 1);
assert.ok(supportedOnCurrentCorePage(support.text("carries a 10-year workmanship warranty")));
assert.equal(support.text("Every roof we install carries a 25-year workmanship warranty.").length, 0,
  "A reworded claim must not match first-party support.");
assert.equal(supportedOnCurrentCorePage(support.text("20% off every roof")), false, "A blog-only statement is not current core support.");
assert.equal(support.phone("+1 919-555-0100").length, 1);
assert.equal(support.link("https://www.bbb.org/us/nc/acme-roofing").length, 1);
assert.equal(support.link("https://casino.example/").length, 0, "Links on injected spam pages are never first-party support.");
assert.deepEqual(support.pages.find((page) => page.path === "/online-casino-bonus")?.injected, true);

// Dated and promotional text is not a current standing claim.
assert.equal(isDatedOrPromotionalText("Every roof carries a 10-year workmanship warranty."), false);
assert.equal(isDatedOrPromotionalText("Serving Raleigh since 1998 with a lifetime warranty."), false);
assert.equal(isDatedOrPromotionalText("Limited time: lifetime warranty on all installs."), true);
assert.equal(isDatedOrPromotionalText("Warranty offer valid through June 30."), true);
assert.equal(isDatedOrPromotionalText("Our 2019 warranty program covers every install."), true);

// Affiliate and tracking links are excluded.
assert.equal(isAffiliateOrTrackingLink("https://partner.example/financing?utm_source=acme"), true);
assert.equal(isAffiliateOrTrackingLink("https://amzn.to/abc"), true);
assert.equal(isAffiliateOrTrackingLink("https://www.bbb.org/us/nc/acme-roofing"), false);

// Image hosts: any media host a first-party page loads, except stock, platforms and linked other businesses.
const page = "https://acme.example/gallery";
assert.equal(firstPartyImageHost({ imageUrl: "https://d1abc.cloudfront.net/uploads/roof.jpg", pageUrl: page }), true);
assert.equal(firstPartyImageHost({ imageUrl: "https://res.cloudinary.com/acme/image/upload/roof.jpg", pageUrl: page }), true);
assert.equal(firstPartyImageHost({ imageUrl: "https://images.unsplash.com/photo-1.jpg", pageUrl: page }), false);
assert.equal(firstPartyImageHost({ imageUrl: "https://s3-media0.fl.yelpcdn.com/photo.jpg", pageUrl: page }), false);
assert.equal(firstPartyImageHost({ imageUrl: "https://shingles-maker.example/products/roof.jpg", pageUrl: page,
  linkedOtherSiteDomains: new Set(["shingles-maker.example"]) }), false, "Another business's linked domain is not first-party.");

// Reconciliation: prominence, then recency; a top tie withholds.
const evidence = (path: string, lastModified?: string) => new FirstPartySupport([{ url: `https://acme.example${path}`, text: "x", ...(lastModified ? { lastModified } : {}) }]).pages;
const reconciled = reconcileFirstPartyValues({
  candidates: [
    { value: "old@acme.example", evidence: evidence("/blog/2016-news") },
    { value: "office@acme.example", evidence: evidence("/contact") }
  ],
  same: (left, right) => left === right,
  corePageCount: 4
});
assert.equal(reconciled.winner?.value, "office@acme.example");
assert.deepEqual(reconciled.conflicts.map((entry) => entry.value), ["old@acme.example"]);
const recent = reconcileFirstPartyValues({
  candidates: [
    { value: "A", evidence: evidence("/services/a", "2024-01-01T00:00:00.000Z") },
    { value: "B", evidence: evidence("/services/b", "2026-01-01T00:00:00.000Z") }
  ],
  same: (left, right) => left === right,
  corePageCount: 4
});
assert.equal(recent.winner?.value, "B", "The more recent equally prominent value must win.");
const tie = reconcileFirstPartyValues({
  candidates: [{ value: "A", evidence: evidence("/") }, { value: "B", evidence: evidence("/contact") }],
  same: (left, right) => left === right,
  corePageCount: 4
});
assert.equal(tie.winner, undefined, "An exact top-prominence tie must withhold the field.");
assert.equal(tie.conflicts.length, 2);

// Topic tags.
assert.deepEqual(sensitiveFirstPartyTopics("Licensed and insured with a 2-year warranty."), ["guarantee", "credential"]);
assert.deepEqual(sensitiveFirstPartyTopics("We trim trees and haul debris."), []);

console.log("First-party support verification passed.");
