import assert from "node:assert/strict";
import { selectObservedFirstPartyWarrantyBlocks } from "../packages/business-data/website-ingestion";
import {
  businessNameCandidateScore,
  normalizeObservedBusinessHours,
  preferBusinessNameCandidate
} from "../lib/business-fact-normalization";
import { businessOfferingSchema, siteIntentSchema } from "../packages/site-contracts";

assert.deepEqual(normalizeObservedBusinessHours([
  "Mo-Fr 11:00-21:00",
  "Sa-Su 12:00-22:00"
]), {
  "Monday-Friday": "11:00-21:00",
  "Saturday-Sunday": "12:00-22:00"
});

assert.equal(normalizeObservedBusinessHours([
  "Monday: st treatments take 1–2 hours. Follow-ups are quicker."
]), undefined, "Narrative duration copy was accepted as business hours.");

assert.deepEqual(normalizeObservedBusinessHours([
  "Mon-Thurs: 8am-5:30pm",
  "Fri: 8am-3pm",
  "Sat - Sun Closed"
]), {
  "Monday-Thursday": "8am-5:30pm",
  Friday: "8am-3pm",
  "Saturday-Sunday": "Closed"
});

assert.deepEqual(normalizeObservedBusinessHours([
  "Monday: 8:00 AM - 5:00 PM",
  "Tuesday: 8:00 AM - 5:00 PM"
]), {
  Monday: "8:00 AM - 5:00 PM",
  Tuesday: "8:00 AM - 5:00 PM"
});

const hostname = "capitalcollisionraleighnc.com";
const generic = "Auto Body Experts You Can Trust And Count On";
const identity = "Capital Collision";
assert(businessNameCandidateScore(identity, hostname) > businessNameCandidateScore(generic, hostname));
assert.equal(preferBusinessNameCandidate(generic, identity, hostname), identity);
assert.equal(preferBusinessNameCandidate(identity, generic, hostname), identity);

assert.deepEqual(businessOfferingSchema.parse({
  id: "offering_owner_1",
  name: "Drain Cleaning",
  description: "Owner-confirmed drain clearing service.",
  status: "confirmed",
  visibility: "public",
  sourceFactIds: ["fact_owner_1"],
  confirmedAt: "2026-07-21T00:00:00.000Z"
}), {
  id: "offering_owner_1",
  name: "Drain Cleaning",
  description: "Owner-confirmed drain clearing service.",
  status: "confirmed",
  visibility: "public",
  sourceFactIds: ["fact_owner_1"],
  confirmedAt: "2026-07-21T00:00:00.000Z"
});
assert.throws(() => businessOfferingSchema.parse({
  id: "offering_invalid",
  name: "Drain Cleaning Austin",
  catalogId: "drain_cleaning",
  pageMode: "dedicated",
  featured: true,
  status: "confirmed",
  visibility: "public",
  sourceFactIds: []
}), /unrecognized/i, "Catalog and page-planning fields crossed the owner-offering boundary.");
assert.equal(siteIntentSchema.parse({
  schemaVersion: 1,
  id: "intent_empty_requirements",
  siteId: "site_empty_requirements",
  revision: 1,
  ownerIntentRevision: 1,
  updatedAt: "2026-07-21T00:00:00.000Z",
  audience: "Local customers",
  positioning: "Useful local service information",
  voice: ["clear"],
  primaryConversion: "call",
  pageRequirements: [],
  brandConstraints: { preferredColors: [], prohibitedColors: [], preserveLogo: true, notes: [] },
  enabledCapabilities: [],
  agentAccessPolicy: { search: "allow", aiInput: "allow", aiTrain: "disallow", trainingPermission: { status: "not_granted" } },
  notes: [],
  intentHash: `sha256:${"0".repeat(64)}`
}).pageRequirements.length, 0);

const proofSourceUrl = "https://fixture.example/";
const proofBlock = (id: string, sourceUrl: string, displayText: string) => ({
  id,
  sourceUrl,
  sourcePageHash: "fixture-page-hash",
  containerId: "p:nth-of-type(1)",
  order: 0,
  displayText
});
const observedWarranties = selectObservedFirstPartyWarrantyBlocks([
  {
    url: `${proofSourceUrl}faq`,
    sourceTextBlocks: [
      proofBlock("kind", `${proofSourceUrl}faq`, "We guarantee to re-service your home or business free of charge, if pest problems return between our scheduled visits."),
      proofBlock("surge", `${proofSourceUrl}faq`, "If pests return within the coverage period of your service, we'll come back and re-treat your home at no additional cost."),
      proofBlock("generic", `${proofSourceUrl}faq`, "We guarantee friendly, thoughtful communication from the first conversation through every scheduled service visit.")
    ]
  },
  {
    url: "https://third-party.example/reviews",
    sourceTextBlocks: [proofBlock("external", "https://third-party.example/reviews", "We guarantee to re-service your home free of charge if pests return between scheduled visits.")]
  }
], proofSourceUrl);
assert.deepEqual(observedWarranties.map((block) => block.id), ["kind", "surge"], "Only exact first-party return-service promises should become observed warranty candidates.");

console.log(JSON.stringify({
  ok: true,
  canonicalHours: "pass",
  crossPageBusinessIdentity: "pass",
  ownerControlledOfferings: "pass",
  observedFirstPartyWarranties: "pass"
}));
