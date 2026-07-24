import assert from "node:assert/strict";
import {
  businessNameCandidateScore,
  normalizeObservedBusinessHours,
  preferBusinessNameCandidate
} from "../lib/business-fact-normalization";
import { canonicalOfferingCandidates } from "../packages/business-data/offering-normalization";
import {
  deduplicateRetainedAssets,
  selectPerceptuallyDistinctRetainedAssets
} from "../packages/business-data/website-ingestion";
import { assetRevisionSchema } from "../packages/site-contracts";
import { autoBodyContextModule } from "../packages/vertical-context/auto-body";
import { plumbingContextModule } from "../packages/vertical-context/plumbing";
import { matchVerticalContext } from "../packages/vertical-context";
import { assessmentVerticalForDomainContext } from "../packages/website-assessment/vertical";

assert.deepEqual(normalizeObservedBusinessHours([
  "Mo-Fr 11:00-21:00",
  "Sa-Su 12:00-22:00"
]), {
  "Monday-Friday": "11:00-21:00",
  "Saturday-Sunday": "12:00-22:00"
});

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

assert.deepEqual(canonicalOfferingCandidates([
  "Collision Repair",
  "Auto Collision Repair",
  "Request Appointment",
  "Frame Straightening",
  "Frame Repair",
  "Ceramic Coating"
], autoBodyContextModule), [
  { sourceName: "Collision Repair", catalogId: "collision_repair", name: "Collision Repair" },
  { sourceName: "Frame Straightening", catalogId: "frame_repair", name: "Frame Repair" },
  { sourceName: "Ceramic Coating", name: "Ceramic Coating" }
]);
assert.deepEqual(canonicalOfferingCandidates(["Landscape Design", "Lawn Maintenance"]), [
  { sourceName: "Landscape Design", name: "Landscape Design" },
  { sourceName: "Lawn Maintenance", name: "Lawn Maintenance" }
]);
assert.equal(matchVerticalContext("Austin residential plumbing company and emergency plumber")?.id, "plumbing");
assert.equal(assessmentVerticalForDomainContext("plumbing"), "home_services");
const evidence = (blocks: number, score: number, directPageUrls: string[] = []) => ({
  blocks: Array.from({ length: blocks }, (_, index) => ({
    id: `block_${score}_${index}`,
    sourceUrl: `https://plumber.example/source-${score}-${index}`,
    evidenceClass: "first_party" as const
  })),
  directPageUrls,
  score
});
assert.deepEqual(canonicalOfferingCandidates([
  "Plumbing Company Near Me",
  "Water Heater Repair Austin TX",
  "Helpful Plumbing Tips",
  "Drain Cleaning",
  "Sewer Cleaning",
  "Custom Hydrostatic Testing"
], plumbingContextModule, {
  evidenceFor: (name) => name === "Custom Hydrostatic Testing"
    ? evidence(1, 100)
    : name === "Drain Cleaning"
      ? evidence(2, 70)
      : name === "Sewer Cleaning"
        ? evidence(2, 90)
        : evidence(1, 60, name.includes("Water Heater") ? ["https://plumber.example/water-heater"] : [])
}), [
  {
    sourceName: "Sewer Cleaning",
    catalogId: "sewer_service",
    name: "Sewer Line Service",
    evidence: evidence(2, 90)
  },
  {
    sourceName: "Drain Cleaning",
    catalogId: "drain_cleaning",
    name: "Drain Cleaning",
    evidence: evidence(2, 70)
  },
  {
    sourceName: "Water Heater Repair Austin TX",
    catalogId: "water_heater",
    name: "Water Heater Service",
    evidence: evidence(1, 60, ["https://plumber.example/water-heater"])
  }
], "Generic SEO phrases survived normalization, weak custom services were retained, or evidence ranking was positional.");

const repeatedAssetRevision = assetRevisionSchema.parse({
  schemaVersion: 1,
  id: "asset_revision_repeated_content",
  assetId: "asset_source_1",
  businessId: "business_repeated_content",
  contentHash: `sha256:${"a".repeat(64)}`,
  storageKey: `site-assets/business_repeated_content/${"a".repeat(64)}`,
  mimeType: "image/png",
  bytes: 4,
  origin: "source_website",
  provenance: {
    origin: "source_website",
    sourceUrl: "https://example.com/image.png",
    sourcePageUrl: "https://example.com/",
    sourceSnapshotId: "source_example"
  },
  createdAt: "2026-07-21T00:00:00.000Z"
});
assert.equal(deduplicateRetainedAssets([
  { revision: repeatedAssetRevision, bytes: Buffer.from("same") },
  {
    revision: {
      ...repeatedAssetRevision,
      assetId: "asset_source_2",
      provenance: {
        origin: "source_website",
        sourceUrl: "https://cdn.example.com/image.png",
        sourcePageUrl: "https://example.com/",
        sourceSnapshotId: "source_example"
      }
    },
    bytes: Buffer.from("same")
  }
]).length, 1);
const visuallySimilarRevision = assetRevisionSchema.parse({
  ...repeatedAssetRevision,
  id: "asset_revision_visually_similar",
  assetId: "asset_source_visually_similar",
  contentHash: `sha256:${"b".repeat(64)}`,
  storageKey: `site-assets/business_repeated_content/${"b".repeat(64)}`,
  provenance: {
    ...repeatedAssetRevision.provenance,
    sourceUrl: "https://example.com/recompressed-image.webp"
  }
});
const visuallyDistinctRevision = assetRevisionSchema.parse({
  ...repeatedAssetRevision,
  id: "asset_revision_visually_distinct",
  assetId: "asset_source_visually_distinct",
  contentHash: `sha256:${"c".repeat(64)}`,
  storageKey: `site-assets/business_repeated_content/${"c".repeat(64)}`,
  provenance: {
    ...repeatedAssetRevision.provenance,
    sourceUrl: "https://example.com/distinct-image.webp"
  }
});
assert.deepEqual(
  selectPerceptuallyDistinctRetainedAssets([
    { revision: repeatedAssetRevision, bytes: Buffer.from("primary"), perceptualHash: "0".repeat(64), sourceKind: "photo", rank: 100 },
    { revision: visuallySimilarRevision, bytes: Buffer.from("recompressed"), perceptualHash: `${"0".repeat(63)}1`, sourceKind: "photo", rank: 90 },
    { revision: visuallyDistinctRevision, bytes: Buffer.from("distinct"), perceptualHash: "1".repeat(64), sourceKind: "photo", rank: 80 }
  ]).map((asset) => asset.revision.id),
  [repeatedAssetRevision.id, visuallyDistinctRevision.id],
  "Perceptual media deduplication kept a near-identical recompression or removed a distinct image."
);

console.log(JSON.stringify({
  ok: true,
  canonicalHours: "pass",
  crossPageBusinessIdentity: "pass",
  verticalOfferingDeduplication: "pass",
  repeatedAssetContentDeduplication: "pass",
  perceptualAssetDeduplication: "pass"
}));
