import assert from "node:assert/strict";
import {
  businessNameCandidateScore,
  normalizeObservedBusinessHours,
  preferBusinessNameCandidate
} from "../lib/business-fact-normalization";
import { canonicalOfferingCandidates } from "../packages/business-data/offering-normalization";
import { deduplicateRetainedAssets } from "../packages/business-data/website-ingestion";
import { assetRevisionV1Schema } from "../packages/site-contracts";
import { autoBodyContextModule } from "../packages/vertical-context/auto-body";

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

const repeatedAssetRevision = assetRevisionV1Schema.parse({
  schemaVersion: "asset-revision-v1",
  id: "asset_revision_repeated_content",
  assetId: "asset_source_1",
  businessId: "business_repeated_content",
  contentHash: `sha256:${"a".repeat(64)}`,
  storageKey: `site-assets/business_repeated_content/${"a".repeat(64)}`,
  mimeType: "image/png",
  bytes: 4,
  provenance: { source: "website_reference", sourceUrl: "https://example.com/image.png" },
  rightsStatus: "reference_only",
  createdAt: "2026-07-21T00:00:00.000Z"
});
assert.equal(deduplicateRetainedAssets([
  { revision: repeatedAssetRevision, bytes: Buffer.from("same") },
  {
    revision: { ...repeatedAssetRevision, assetId: "asset_source_2", provenance: { source: "website_reference", sourceUrl: "https://cdn.example.com/image.png" } },
    bytes: Buffer.from("same")
  }
]).length, 1);

console.log(JSON.stringify({
  ok: true,
  canonicalHours: "pass",
  crossPageBusinessIdentity: "pass",
  verticalOfferingDeduplication: "pass",
  repeatedAssetContentDeduplication: "pass"
}));
