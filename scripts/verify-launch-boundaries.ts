import assert from "node:assert/strict";
import { buildCanonicalFixture, loadCanonicalFixtureDefinitions } from "./canonical-generation-fixtures";
import { verifyEvidenceProposal } from "../lib/generation-evidence-manifest";
import { applyBusinessStateChange, applyCopyOverrides, applySiteIntentChange, changeImpact, type CanonicalBusinessStateV1 } from "../lib/control-plane";
import { buildGenerationPlan, compatibleDesignSystems } from "../lib/vertical-packs";
import { containsGatedSensitiveClaim, scanPlaceholderText, scanSensitiveClaimText } from "../lib/content-safety-scanners";
import { isDynamicHoursStatus } from "../lib/business-understanding-v2";
import { publicGenerationServices } from "../lib/vertical-packs";
import { assertSiteVersionV3, siteVersionV3Issue } from "../lib/site-version-v3";
import { inferVertical } from "../lib/vertical-classification";
import { locationMapMode } from "../lib/site-renderer-v3";
import { contrastRatioV3 } from "../lib/generated-site-v3-visual-controls";

const definitions = await loadCanonicalFixtureDefinitions();
const fixtures = await Promise.all(definitions.map(buildCanonicalFixture));

assert.equal(fixtures.length, 4, "Launch boundaries require the canonical four-fixture set.");
for (const fixture of fixtures) {
  assert.equal(siteVersionV3Issue(fixture.version), null, `${fixture.definition.id} must be strict SiteVersionV3.`);
  assert.equal(assertSiteVersionV3(fixture.version).rendererVersion, "layout-v3");
  assert.equal(fixture.plan.pages.length, fixture.version.pageComposition.pages.length);
  assert.equal(fixture.copy.slots.length, fixture.plan.pages.flatMap((page) => page.sections.flatMap((section) => section.copySlots)).length);
}

const rich = fixtures.find((fixture) => fixture.definition.id === "austin-dent-paint-rich-media");
const sparse = fixtures.find((fixture) => fixture.definition.id === "east-austin-collision-sparse");
assert(rich && sparse);
assert.deepEqual(compatibleDesignSystems(sparse.assets), ["trusted_local_service"]);
assert.deepEqual(compatibleDesignSystems(rich.assets), ["trusted_local_service", "precision_shop_editorial"]);
assert.deepEqual(
  compatibleDesignSystems(rich.assets.map((asset) => ({ ...asset, metadata: {} }))),
  ["trusted_local_service"],
  "Unanalyzed source media must fail closed to the media-independent design system."
);
assert.equal(rich.plan.designSystem, "precision_shop_editorial");
assert.equal(sparse.plan.designSystem, "trusted_local_service");

const sourceBrandPlan = buildGenerationPlan({
  snapshot: {
    ...rich.snapshot,
    brandAssessment: {
      id: "brand_source_contrast",
      siteId: rich.business.siteId,
      confidence: 1,
      cues: [],
      colorSignals: ["#0376ba"],
      typographySignals: [],
      imageStyleSignals: [],
      toneSignals: [],
      preservationRules: [],
      sourceNotes: []
    }
  },
  evidence: rich.evidence,
});
assert(
  (contrastRatioV3(sourceBrandPlan.brandTokens.colors.primary, sourceBrandPlan.brandTokens.colors.background) ?? 0) >= 4.75,
  "Source-derived primary colors must retain an AA safety margin on the real page background."
);

const testimonial = rich.evidence.items.find((item) => item.kind === "testimonial");
assert(testimonial, "Rich fixture must retain a verified testimonial.");
assert.equal(testimonial.publicText, testimonial.sourceExcerpt, "Testimonials must render reconstructed source text verbatim.");
const altered = verifyEvidenceProposal(
  {
    kind: "testimonial",
    proposedText: `${testimonial.sourceExcerpt} invented ending`,
    sourceUrl: testimonial.source.url,
    sourceBlockId: testimonial.source.blockId
  },
  []
);
assert.equal(altered.ok, false, "Evidence without a retained matching block must fail closed.");

const confirmationFixture = fixtures.find((fixture) => fixture.evidence.items.some((item) => item.renderPolicy !== "durable_render"));
assert(confirmationFixture, "Fixture set must exercise owner-confirmed protected evidence.");
const protectedEvidence = confirmationFixture.evidence.items.find(
  (item) => item.renderPolicy !== "durable_render"
);
assert(protectedEvidence, "Fixture must exercise owner-confirmed protected evidence.");
const snapshotBusiness = confirmationFixture.snapshot.business;
const confirmationState: CanonicalBusinessStateV1 = {
  business: {
    id: snapshotBusiness.businessId,
    name: snapshotBusiness.name,
    vertical: snapshotBusiness.vertical,
    stateRevision: snapshotBusiness.stateRevision,
    description: snapshotBusiness.description,
    categories: snapshotBusiness.categories,
    provenance: snapshotBusiness.provenance,
    createdAt: confirmationFixture.snapshot.createdAt,
    updatedAt: confirmationFixture.snapshot.createdAt
  },
  locations: [{
    id: `location_${snapshotBusiness.businessId}_primary`,
    businessId: snapshotBusiness.businessId,
    address: snapshotBusiness.address,
    serviceAreas: snapshotBusiness.serviceAreas,
    phone: snapshotBusiness.phone,
    email: snapshotBusiness.email,
    hours: snapshotBusiness.hours,
    geo: snapshotBusiness.geo,
    googlePlaceId: snapshotBusiness.googlePlaceId,
    provenance: snapshotBusiness.provenance,
    createdAt: confirmationFixture.snapshot.createdAt,
    updatedAt: confirmationFixture.snapshot.createdAt
  }],
  offerings: structuredClone(snapshotBusiness.offerings),
  proof: confirmationFixture.evidence.items.map((item) => ({
    id: item.id,
    businessId: snapshotBusiness.businessId,
    kind: item.kind === "years_in_business" ? "longevity" : item.kind,
    status: item.renderPolicy === "durable_render" ? "confirmed" : "observed",
    publicText: item.publicText,
    sourceExcerpt: item.sourceExcerpt,
    sourceSnapshotId: confirmationFixture.snapshot.sourceSnapshotIds[0],
    sourceBlockId: item.source.blockId,
    evidenceIds: [item.id],
    createdAt: confirmationFixture.snapshot.createdAt,
    updatedAt: confirmationFixture.snapshot.createdAt
  })),
  assets: confirmationFixture.snapshot.assets.map(({ revision: _revision, ...asset }) => structuredClone(asset)),
  assetRevisions: confirmationFixture.snapshot.assets.map((asset) => structuredClone(asset.revision)),
  socialLinks: snapshotBusiness.socialLinks,
  bookingLinks: snapshotBusiness.bookingLinks,
  orderingLinks: snapshotBusiness.orderingLinks,
  pressLinks: snapshotBusiness.pressLinks
};
const confirmedState = applyBusinessStateChange(confirmationState, {
  kind: "set_proof",
  proofId: protectedEvidence.id,
  decision: "confirm",
  publicText: protectedEvidence.sourceExcerpt
}, "launch-boundary-verifier", "2026-07-15T00:00:00.000Z");
assert.equal(confirmedState.proof.find((item) => item.id === protectedEvidence.id)?.status, "confirmed");
assert.equal(confirmedState.proof.find((item) => item.id === protectedEvidence.id)?.publicText, protectedEvidence.sourceExcerpt);

const editedIntent = applySiteIntentChange(rich.snapshot.siteIntent, {
  kind: "set_copy_override",
  slotId: "home.hero.heading",
  value: "Collision repair with a clear next step"
}, "launch-boundary-verifier", "2026-07-15T00:00:00.000Z");
const editedCopy = applyCopyOverrides(rich.copy, editedIntent);
assert.equal(editedCopy.slots.find((slot) => slot.slotId === "home.hero.heading")?.value, "Collision repair with a clear next step");
assert.equal(changeImpact({ kind: "set_contact", phone: "512-555-0100" }), "deterministic");
assert.equal(changeImpact({ kind: "set_offering", catalogId: "auto_body.frame_repair", enabled: true }), "structural");

const sensitive = scanSensitiveClaimText("Every repair includes a lifetime warranty and guaranteed results.");
assert(sensitive.some((finding) => finding.severity === "block"), "Unsupported sensitive claims must remain blocked.");
assert.equal(scanSensitiveClaimText("Paint materials cure in a controlled environment.").length, 0, "Paint curing is not a medical claim.");
assert.equal(scanPlaceholderText("Compare the existing finish through a general visual comparison.").length, 0, "Ordinary visual language is not an internal placeholder.");
assert.equal(scanPlaceholderText("Review the repair path before work begins.").length, 0, "Customer-facing repair language is not an internal placeholder.");
assert.equal(isDynamicHoursStatus("The finish currently on the vehicle also matters."), false, "Ordinary use of currently is not live hours state.");
assert.equal(isDynamicHoursStatus("Visit us at 5411 Wasson Road. The shop is open Monday through Friday."), false, "Street numbers are not years or live hours state.");
assert.equal(isDynamicHoursStatus("The shop is closed on July 4, 2026."), true, "Dated closure notices remain dynamic hours state.");
assert.equal(containsGatedSensitiveClaim("Free repair estimates"), true, "Offers remain protected until deterministic confirmation.");
assert.equal(containsGatedSensitiveClaim("Insurance repair assistance"), true, "Insurance claims remain protected until deterministic confirmation.");
assert.deepEqual(
  publicGenerationServices(["Collision Repair", "Free Repair Estimates", "Insurance Repair Assistance", "Paint Refinishing"]),
  ["Collision Repair", "Paint Refinishing"],
  "Model-written service copy must omit confirmation-gated facts."
);
assert.equal(locationMapMode(false, undefined), "link_only", "Location rendering must default to a stable visit card without an embed key.");
assert.equal(locationMapMode(true, undefined), "embed", "An explicitly configured embed key may enable the map surface.");
assert.equal(
  inferVertical({
    title: "Certified Auto Collision Repair",
    services: ["Tesla & Electric Vehicle Collision Repair", "Bumper Repair"]
  }),
  "auto_body",
  "Specific collision evidence must outrank generic electric-service keywords."
);

console.log(JSON.stringify({
  ok: true,
  fixtures: fixtures.length,
  shippingDesignSystems: 2,
  exactEvidence: true,
  ownerConfirmation: true,
  deterministicCopyOverride: true,
  structuralRegeneration: true,
  unsupportedClaimsBlocked: true
}, null, 2));
