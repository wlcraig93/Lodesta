import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyBusinessStateChange,
  applySiteIntentChange,
  candidateRevisionIssue,
  canonicalBusinessStateHash,
  createGenerationInputSnapshot,
  observationsAreSourceSparse,
  requiredPublicEligibilityFactIds,
  resolveAssets,
  resolveBusinessSnapshot,
  siteIntentHash,
  staleCopyEvidence,
  validateControlPlaneChange
} from "../lib/control-plane";
import type { AssetRevisionV1, BusinessAssetV1, BusinessProofV1 } from "../lib/control-plane-contracts";
import { createFixtureSiteCopy } from "../lib/site-copy";
import { compileSite } from "../lib/site-compiler";
import { SiteRenderer } from "../lib/site-renderer";
import { copyCandidateArtifactToSite } from "../lib/site-artifacts";
import { storedVersionRenderEnvelope } from "../lib/site-render-envelope";
import { generationSnapshotFromIntakeBundle } from "../lib/intake-generation-snapshot";
import {
  sampleBusinessProfile,
  sampleCanonicalGenerationInput,
  sampleExtensionModel,
  sampleGenerationInputSnapshot,
  sampleGenerationPlan,
  sampleSiteBundle,
  sampleSiteModel
} from "../lib/sample-data";
import {
  acceptSiteCandidateAsVersion,
  createSiteCandidate,
  getGenerationInputSnapshot,
  getPublishedFormDefinition,
  getSiteBundle,
  persistCanonicalGenerationInput,
  publishVersion,
  saveSiteVersion,
  upsertSiteArtifact
} from "../lib/store";
import { buildGenerationPlan, canonicalOfferingSeeds, offeringNamesForGeneration } from "../lib/vertical-packs";
import { summarizeCrawlHtml } from "../lib/crawler";
import { freshIntakeRequestSchema } from "../lib/generation-entry-contracts";

const now = "2026-07-16T12:00:00.000Z";
assert.equal(freshIntakeRequestSchema.safeParse({ prompt: "Build a collision site" }).success, false);
assert.equal(freshIntakeRequestSchema.safeParse({ url: "https://example.com", prompt: "Favor phone calls" }).success, true);
const canonical = structuredClone(sampleCanonicalGenerationInput);
assert.equal(canonicalBusinessStateHash(canonical.state), canonicalBusinessStateHash(structuredClone(canonical.state)));
assert.equal(siteIntentHash(canonical.siteIntent), siteIntentHash(structuredClone(canonical.siteIntent)));
const changedStateWithoutRevision = structuredClone(canonical.state);
changedStateWithoutRevision.business.name = "Changed without revision";
assert.notEqual(canonicalBusinessStateHash(canonical.state), canonicalBusinessStateHash(changedStateWithoutRevision));
const changedIntentWithoutRevision = structuredClone(canonical.siteIntent);
changedIntentWithoutRevision.voice = "Changed without revision";
assert.notEqual(siteIntentHash(canonical.siteIntent), siteIntentHash(changedIntentWithoutRevision));

const evidenceIntakeBundle = structuredClone(sampleSiteBundle);
const retainedTestimonial = "The repair updates were clear and the finished paint matched beautifully";
evidenceIntakeBundle.presenceAssessment.evidenceManifest = {
  ...structuredClone(canonical.snapshot.evidenceManifest),
  items: [{
    id: "evidence_testimonial_retention",
    kind: "testimonial",
    sourceExcerpt: retainedTestimonial,
    publicText: retainedTestimonial,
    attribution: "Verified customer",
    renderPolicy: "durable_render",
    source: {
      url: "https://example.com/reviews",
      pageHash: "page_hash_testimonial_retention",
      blockId: "block_testimonial_retention",
      containerId: "container_testimonial_retention",
      startToken: 0,
      endToken: 12
    }
  }],
  rejected: [],
  yield: {
    proposed: 1,
    accepted: 1,
    rejected: 0,
    acceptanceRate: 1,
    rejectedByReason: {},
    sourceBlockCount: 1,
    sourceSparse: false
  }
};
const retainedEvidenceInput = generationSnapshotFromIntakeBundle({
  bundle: evidenceIntakeBundle,
  assets: [],
  crawl: {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    title: sampleBusinessProfile.name,
    extractedFacts: {
      name: sampleBusinessProfile.name,
      description: sampleBusinessProfile.description,
      phone: sampleBusinessProfile.phone,
      email: sampleBusinessProfile.email,
      address: sampleBusinessProfile.address,
      geo: sampleBusinessProfile.geo,
      hours: sampleBusinessProfile.hours,
      categories: sampleBusinessProfile.categories,
      services: sampleBusinessProfile.services,
      serviceAreas: sampleBusinessProfile.serviceAreas,
      socialLinks: sampleBusinessProfile.socialLinks,
      bookingLinks: sampleBusinessProfile.bookingLinks,
      orderingLinks: sampleBusinessProfile.orderingLinks,
      pressLinks: sampleBusinessProfile.pressLinks
    },
    pageSummaries: []
  } as unknown as import("../lib/crawler").CrawlAssessment,
  eligibilityMode: "protected_preview",
  createdAt: now
});
assert.equal(retainedEvidenceInput.state.proof.length, 1);
assert.equal(retainedEvidenceInput.state.proof[0]?.sourceSnapshotId, retainedEvidenceInput.sourceSnapshots[0]?.id);
assert.equal(retainedEvidenceInput.state.proof[0]?.sourceExcerpt, retainedTestimonial);

// Fresh intake retains each provider independently and resolves preview facts
// from selected observations instead of treating a merged model profile as truth.
const observationPage = summarizeCrawlHtml(`<!doctype html><html><head><title>Website First Collision</title></head><body>
  <h1>Website First Collision</h1><p>Collision Repair for Austin drivers.</p><a href="tel:+15125550111">Call</a>
</body></html>`, "https://website-first.example/");
observationPage.extractedFacts = {
  name: "Website First Collision",
  phone: "+15125550111",
  categories: ["Auto body shop"],
  services: ["Collision Repair"],
  serviceAreas: ["Austin"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  pressLinks: []
};
const observationCrawl = {
  url: "https://website-first.example/",
  finalUrl: "https://website-first.example/",
  title: observationPage.title,
  metaDescription: observationPage.metaDescription,
  extractedFacts: observationPage.extractedFacts,
  pageSummaries: [observationPage]
} as unknown as import("../lib/crawler").CrawlAssessment;
const observationBundle = structuredClone(sampleSiteBundle);
observationBundle.businessProfile.siteId = "site_observation_contract";
observationBundle.presenceAssessment.siteId = "site_observation_contract";
observationBundle.presenceAssessment.sourceUrl = observationCrawl.url;
observationBundle.presenceAssessment.businessUnderstanding = {
  version: "business-understanding-v2",
  source: "openai",
  vertical: "auto_body",
  verticalConfidence: 0.95,
  detectedSubverticals: [],
  cleanedServices: [
    { name: "Collision Repair", sourceText: "Collision Repair", confidence: 0.91 },
    { name: "Invented Ceramic Coating", sourceText: "No such source text", confidence: 0.99 }
  ],
  primaryConversionGoal: "form_first",
  urgentServiceSignals: [],
  evidenceProposals: [],
  factConfidence: [],
  notes: []
};
const placesObservedAt = "2026-07-16T11:59:00.000Z";
const observationPublicPresence = {
  provider: "google_places" as const,
  observedAt: placesObservedAt,
  facts: {
    name: "Places Alternate Collision",
    phone: "+15125550222",
    address: { city: "Austin", region: "TX" },
    categories: ["Collision repair shop"]
  },
  provenance: Object.fromEntries(["name", "phone", "address", "categories"].map((field) => [field, {
    source: "places_api" as const,
    confidence: 0.62,
    verified: false,
    observedAt: placesObservedAt
  }])),
  signals: [{
    id: "presence_observation_contract",
    siteId: "site_observation_contract",
    provider: "google_places" as const,
    source: "places_api" as const,
    placeId: "place_observation_contract",
    confidence: 0.62,
    observedAt: placesObservedAt,
    fields: {
      name: "Places Alternate Collision",
      phone: "+15125550222",
      address: { city: "Austin", region: "TX" },
      categories: ["Collision repair shop"]
    },
    provenance: {},
    notes: []
  }],
  notes: []
};
const observationInput = generationSnapshotFromIntakeBundle({
  bundle: observationBundle,
  assets: [],
  crawl: observationCrawl,
  publicPresence: observationPublicPresence,
  eligibilityMode: "protected_preview",
  createdAt: now
});
assert.deepEqual(observationInput.sourceSnapshots.map((source) => source.sourceType), ["website", "google_places"]);
assert.equal(observationInput.snapshot.business.name, "Website First Collision");
assert.equal(observationInput.snapshot.business.phone, "+15125550111");
assert.deepEqual(observationInput.snapshot.business.address, { city: "Austin", region: "TX" });
assert.deepEqual(observationInput.snapshot.business.categories, ["Auto body shop", "Collision repair shop"]);
assert.equal(observationInput.snapshot.business.offerings.some((offering) => offering.catalogId === "svc_auto_body_collision-repair"), true);
assert.equal(observationInput.snapshot.business.offerings.some((offering) => offering.customName === "Invented Ceramic Coating"), false);
assert.deepEqual(observationInput.snapshot.businessUnderstanding, observationBundle.presenceAssessment.businessUnderstanding);
assert.equal(observationInput.observations.find((item) => item.field === "phone" && item.value === "+15125550222")?.status, "conflict");
assert.equal(observationInput.observations.find((item) => item.field === "phone" && item.value === "+15125550111")?.confidence, 0.75);
assert.equal(observationInput.observations.some((item) => item.confidence === 1), false);
for (const field of ["name", "phone", "address", "categories", "services", "serviceAreas"]) {
  assert.equal(
    observationInput.observations.some((item) => item.field === field && item.status === "selected_for_preview"),
    true,
    `Resolved preview field ${field} must have a selected source observation.`
  );
}

const retainedAsset = {
  id: "asset_retained_contract",
  siteId: "site_observation_contract",
  kind: "photo" as const,
  url: "/api/assets/site_observation_contract/retained.webp",
  alt: "Retained contract photo",
  source: "website_reference" as const,
  rightsStatus: "reference_only" as const,
  usageScope: "preclaim_preview" as const,
  ownerApproved: false,
  metadata: {
    contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    storagePath: "site_observation_contract/retained.webp",
    mimeType: "image/webp",
    bytes: 4096,
    width: 1200,
    height: 800
  },
  createdAt: now
};
const retainedAssetInput = generationSnapshotFromIntakeBundle({
  bundle: observationBundle,
  assets: [retainedAsset],
  crawl: observationCrawl,
  eligibilityMode: "protected_preview",
  createdAt: now
});
assert.equal(retainedAssetInput.snapshot.assets[0]?.revision.contentHash, retainedAsset.metadata.contentHash);
assert.equal(retainedAssetInput.snapshot.assets[0]?.revision.bytes, 4096);
assert.equal(retainedAssetInput.snapshot.assets[0]?.revision.mimeType, "image/webp");
assert.throws(() => generationSnapshotFromIntakeBundle({
  bundle: observationBundle,
  assets: [{ ...retainedAsset, id: "asset_unretained_contract", metadata: {} }],
  crawl: observationCrawl,
  eligibilityMode: "protected_preview",
  createdAt: now
}), /missing required contentHash revision metadata/);

// Local persistence enforces the same immutable identities and monotonic
// authority revisions as the durable repository.
assert.doesNotThrow(() => persistCanonicalGenerationInput(structuredClone(canonical)));
const sourceCollision = structuredClone(canonical);
sourceCollision.sourceSnapshots[0].contentHash = "different-content-hash";
assert.throws(() => persistCanonicalGenerationInput(sourceCollision), /Immutable source snapshot collision/);
const snapshotCollision = structuredClone(canonical);
snapshotCollision.snapshot.inputHash = "different-input-hash";
assert.throws(() => persistCanonicalGenerationInput(snapshotCollision), /Immutable generation snapshot collision/);
const businessRevisionCollision = structuredClone(canonical);
businessRevisionCollision.state.business.name = "Changed without revision";
assert.throws(() => persistCanonicalGenerationInput(businessRevisionCollision), /without a new revision/);
const intentRevisionCollision = structuredClone(canonical);
intentRevisionCollision.siteIntent.voice = "Changed without revision";
assert.throws(() => persistCanonicalGenerationInput(intentRevisionCollision), /without a new revision/);
const formCollision = structuredClone(canonical);
formCollision.snapshot.formDefinition.submitLabel = "Changed immutable form";
assert.throws(() => persistCanonicalGenerationInput(formCollision), /Immutable form-definition collision/);

// Crawl observations can enrich protected previews, but observed offerings and
// trust-sensitive proof are not public truth.
const observedState = structuredClone(canonical.state);
observedState.offerings[0].status = "observed";
observedState.offerings[0].visibility = "preview";
observedState.proof.push(
  proof("proof_observed_warranty", "warranty", "Observed warranty text", "observed"),
  {
    ...proof("proof_source_testimonial", "testimonial", "Exact source testimonial", "observed"),
    sourceExcerpt: "Exact source testimonial",
    sourceSnapshotId: canonical.sourceSnapshots[0].id,
    sourceBlockId: "block_testimonial"
  },
  { ...proof("proof_expired_award", "award", "Expired award", "confirmed"), expiresAt: "2026-01-01T00:00:00.000Z" }
);
const protectedBusiness = resolveBusinessSnapshot({ state: observedState, siteId: sampleBusinessProfile.siteId, eligibilityMode: "protected_preview", resolvedAt: now });
const publicBusiness = resolveBusinessSnapshot({ state: observedState, siteId: sampleBusinessProfile.siteId, eligibilityMode: "public", resolvedAt: now });
assert.equal(protectedBusiness.offerings.some((item) => item.id === observedState.offerings[0].id), true);
assert.equal(publicBusiness.offerings.some((item) => item.id === observedState.offerings[0].id), false);
assert.equal(publicBusiness.proof.some((item) => item.id === "proof_observed_warranty"), false);
assert.equal(publicBusiness.proof.some((item) => item.id === "proof_source_testimonial"), true);
assert.equal(publicBusiness.proof.some((item) => item.id === "proof_expired_award"), false);
assert.equal(observationsAreSourceSparse([]), true);

assert.deepEqual(requiredPublicEligibilityFactIds(canonical.state), [
  "name",
  "phone",
  "email",
  "address",
  "hours",
  "service_areas",
  "services"
]);

// Owner changes are immutable transformations, bump the authority revision,
// and carry verified owner provenance without mutating the prior state.
const contactChanged = applyBusinessStateChange(canonical.state, { kind: "set_contact", phone: "+15125550199" }, "owner", now);
assert.equal(canonical.state.locations[0].phone, sampleBusinessProfile.phone);
assert.equal(contactChanged.locations[0].phone, "+15125550199");
assert.equal(contactChanged.locations[0].provenance.phone?.source, "owner");
assert.equal(contactChanged.locations[0].provenance.phone?.verified, true);
assert.equal(contactChanged.business.stateRevision, canonical.state.business.stateRevision + 1);

// Catalog-backed and custom offerings share one authority. Catalog IDs remain
// stable, while owner-specific services do not require a global taxonomy entry.
const catalogChanged = applyBusinessStateChange(canonical.state, {
  kind: "set_offering",
  catalogId: "svc_auto_body_hail-damage",
  enabled: true,
  featured: true,
  pageMode: "dedicated"
}, "owner", now);
assert.equal(catalogChanged.offerings.some((item) => item.catalogId === "svc_auto_body_hail-damage" && item.status === "confirmed"), true);
const customChanged = applyBusinessStateChange(catalogChanged, {
  kind: "set_offering",
  customName: "Fleet cosmetic reconditioning",
  enabled: true,
  pageMode: "shared"
}, "owner", now);
assert.equal(customChanged.offerings.some((item) => item.customName === "Fleet cosmetic reconditioning"), true);
assert.deepEqual(
  canonicalOfferingSeeds("auto_body", ["Dent Repair", "Paintless Dent Repair", "Fleet cosmetic reconditioning"]),
  [
    { name: "Dent Repair", catalogId: "svc_auto_body_dent-repair", customName: undefined },
    { name: "Fleet cosmetic reconditioning", catalogId: undefined, customName: "Fleet cosmetic reconditioning" }
  ]
);

// Site intent controls ordering, page eligibility, conversion, and brand
// constraints without becoming business truth or forking the pipeline.
let intent = structuredClone(canonical.siteIntent);
const featuredId = canonical.state.offerings.at(-1)!.id;
intent = applySiteIntentChange(intent, { kind: "set_featured_offerings", offeringIds: [featuredId] }, "owner", now);
intent = applySiteIntentChange(intent, { kind: "set_offering_page_mode", offeringId: canonical.state.offerings[0].id, pageMode: "none" }, "owner", now);
intent = applySiteIntentChange(intent, { kind: "set_primary_conversion", value: "call" }, "owner", now);
intent = applySiteIntentChange(intent, { kind: "set_brand_constraints", value: { preferredPrimaryColor: "#28594a" } }, "owner", now);
const intentSnapshot = createGenerationInputSnapshot({
  business: canonical.snapshot.business,
  siteIntent: intent,
  assets: canonical.snapshot.assets,
  evidenceManifest: canonical.snapshot.evidenceManifest,
  formDefinition: canonical.snapshot.formDefinition,
  sourceSnapshotIds: canonical.snapshot.sourceSnapshotIds,
  verticalPack: canonical.snapshot.verticalPack,
  eligibilityMode: "public",
  createdAt: now
});
const intentPlan = buildGenerationPlan({ snapshot: intentSnapshot, evidence: intentSnapshot.evidenceManifest, createdAt: now });
assert.equal(offeringNamesForGeneration(intentSnapshot)[0], "Paint Repair");
assert.equal(offeringNamesForGeneration(intentSnapshot).includes("Collision Repair"), false);
assert.match(intentPlan.navigation.primaryCta.target, /^tel:/);
assert.equal(intentPlan.brandTokens.colors.primary, "#28594a");
assert.equal(intentPlan.formId, intentSnapshot.formDefinition.id);

// Immutable snapshots retain the exact asset revision even after the mutable
// authority marks the asset inactive for future generations.
const revision: AssetRevisionV1 = {
  schemaVersion: "asset-revision-v1",
  id: "assetrev_contract_1",
  assetId: "asset_contract_1",
  businessId: canonical.state.business.id,
  contentHash: "0123456789abcdef0123456789abcdef",
  storagePath: "contract/asset.webp",
  publicUrl: "https://assets.example/contract.webp",
  mimeType: "image/webp",
  bytes: 100,
  rightsStatus: "customer_granted",
  createdAt: now
};
const asset: BusinessAssetV1 = {
  id: revision.assetId,
  businessId: canonical.state.business.id,
  kind: "photo",
  alt: "Contract fixture",
  source: "uploaded",
  usageScope: "published_site",
  ownerApproved: true,
  active: true,
  currentRevisionId: revision.id,
  createdAt: now,
  updatedAt: now
};
const assetState = structuredClone(canonical.state);
assetState.assets.push(asset);
assetState.assetRevisions.push(revision);
const assetSnapshot = createGenerationInputSnapshot({
  business: resolveBusinessSnapshot({ state: assetState, siteId: sampleBusinessProfile.siteId, eligibilityMode: "public", resolvedAt: now }),
  siteIntent: canonical.siteIntent,
  assets: resolveAssets(assetState),
  evidenceManifest: canonical.snapshot.evidenceManifest,
  formDefinition: canonical.snapshot.formDefinition,
  sourceSnapshotIds: canonical.snapshot.sourceSnapshotIds,
  verticalPack: canonical.snapshot.verticalPack,
  eligibilityMode: "public",
  createdAt: now
});
const inactiveAssetState = applyBusinessStateChange(assetState, { kind: "set_asset", assetId: asset.id, active: false }, "owner", now);
assert.equal(resolveAssets(inactiveAssetState).length, 0);
assert.equal(assetSnapshot.assets[0].revision.id, revision.id);
assert.equal(assetSnapshot.assets[0].revision.contentHash, revision.contentHash);

// Copy evidence that no longer survives the resolved proof policy cannot be
// reused by the deterministic recompile path.
assert.deepEqual(staleCopyEvidence({
  copy: { slots: [{ slotId: "home.hero.body", evidenceIds: ["retained", "removed"] }] },
  evidence: { items: [{ id: "retained", renderPolicy: "durable_render" }, { id: "removed", renderPolicy: "owner_confirmation" }] },
  eligibleEvidenceIds: ["retained"]
}), [{ slotId: "home.hero.body", evidenceId: "removed" }]);
assert.deepEqual(candidateRevisionIssue({
  candidate: { businessStateRevision: 1, siteIntentRevision: 2 },
  currentBusinessStateRevision: 2,
  currentSiteIntentRevision: 2
}), ["business_state_revision"]);

const unsafeLink = await validateControlPlaneChange({ kind: "set_external_link", linkType: "booking", url: "javascript:alert(1)", enabled: true });
assert.equal(unsafeLink.ok, false);

// The renderer uses the retained form definition exactly and disables every
// candidate/preview control. No fixed vertical-specific field can leak in.
const exactForm = {
  id: "form_contract_exact",
  siteId: sampleBusinessProfile.siteId,
  name: "Exact contract form",
  fields: [
    { id: "full_name", label: "Full name", type: "text" as const, required: true },
    { id: "request_type", label: "Request type", type: "select" as const, required: true, options: ["Estimate", "Question"] },
    { id: "notes", label: "Project notes", type: "textarea" as const, required: false }
  ],
  submitLabel: "Send exact request"
};
const markup = renderToStaticMarkup(React.createElement(SiteRenderer, {
  business: sampleBusinessProfile,
  site: sampleSiteModel,
  extensions: { ...sampleExtensionModel, forms: [exactForm] },
  version: sampleSiteModel.versions[0],
  tracking: false,
  formsEnabled: false
}));
assert.match(markup, /name="formId" value="form_contract_exact"/);
assert.match(markup, /name="request_type"/);
assert.match(markup, />Estimate<\/option>/);
assert.match(markup, /Send exact request/);
assert.match(markup, /data-preview-disabled="lead-form"/);
assert.equal(markup.includes("vehicle_issue"), false);
assert.equal(markup.includes("form_contact"), false);

// Persisting a newer candidate-only form does not authorize the public
// submission API and does not alter the retained published version's inputs.
const candidateIntent = { ...structuredClone(canonical.siteIntent), revision: canonical.siteIntent.revision + 10, updatedAt: now };
const candidateForm = { ...structuredClone(canonical.snapshot.formDefinition), id: "form_candidate_only_contract", createdAt: now };
const candidateSnapshot = createGenerationInputSnapshot({
  business: canonical.snapshot.business,
  siteIntent: candidateIntent,
  assets: canonical.snapshot.assets,
  evidenceManifest: canonical.snapshot.evidenceManifest,
  formDefinition: candidateForm,
  sourceSnapshotIds: canonical.snapshot.sourceSnapshotIds,
  verticalPack: canonical.snapshot.verticalPack,
  eligibilityMode: "protected_preview",
  createdAt: now
});
persistCanonicalGenerationInput({ ...structuredClone(canonical), siteIntent: candidateIntent, snapshot: candidateSnapshot });
assert.equal(getPublishedFormDefinition(sampleBusinessProfile.siteId, candidateForm.id), null);
assert.equal(getPublishedFormDefinition(sampleBusinessProfile.siteId, canonical.snapshot.formDefinition.id)?.id, canonical.snapshot.formDefinition.id);
const retainedOldSnapshot = getGenerationInputSnapshot(sampleGenerationInputSnapshot.id);
assert.ok(retainedOldSnapshot);
const retainedEnvelope = storedVersionRenderEnvelope({
  shell: sampleSiteBundle,
  snapshot: retainedOldSnapshot,
  version: sampleSiteModel.versions[0]
});
assert.equal(retainedEnvelope.extensionModel.forms[0].id, canonical.snapshot.formDefinition.id);
assert.equal(retainedEnvelope.businessProfile.phone, canonical.snapshot.business.phone);
const snapshotWithPlace = structuredClone(retainedOldSnapshot);
snapshotWithPlace.business.googlePlaceId = "place_snapshot_authority";
const shellWithConflictingPlace = structuredClone(sampleSiteBundle);
shellWithConflictingPlace.locations = [{
  id: "location_shell_conflict",
  businessId: snapshotWithPlace.businessId,
  label: "Mutable shell",
  serviceAreas: [],
  googlePlaceId: "place_mutable_shell",
  provenance: {},
  createdAt: now,
  updatedAt: now
}];
const immutableLocationEnvelope = storedVersionRenderEnvelope({
  shell: shellWithConflictingPlace,
  snapshot: snapshotWithPlace,
  version: sampleSiteModel.versions[0]
});
assert.equal(immutableLocationEnvelope.locations?.[0]?.googlePlaceId, "place_snapshot_authority");
assert.equal(immutableLocationEnvelope.locationBindings?.[0]?.role, "primary");

const candidatePlan = buildGenerationPlan({ snapshot: candidateSnapshot, evidence: candidateSnapshot.evidenceManifest, createdAt: now });
const candidateCopy = createFixtureSiteCopy(candidatePlan, candidateSnapshot);
const candidateVersion = compileSite({ snapshot: candidateSnapshot, plan: candidatePlan, copy: candidateCopy, createdAt: now });
saveSiteVersion({ siteId: sampleBusinessProfile.siteId, version: candidateVersion });
const protectedPublish = publishVersion({ siteId: sampleBusinessProfile.siteId, versionId: candidateVersion.id });
assert.equal(protectedPublish?.ok, false);

// Acceptance blocks a candidate whose immutable revision predates current
// authority; no operator override exists.
const candidate = createSiteCandidate({
  id: "sitecand_control_plane_contract",
  snapshot: candidateSnapshot,
  version: candidateVersion,
  plan: candidatePlan,
  copy: candidateCopy,
  status: "ready",
  intendedSiteId: sampleBusinessProfile.siteId,
  candidatePurpose: "test_generation"
});
const newerIntent = { ...structuredClone(candidateIntent), revision: candidateIntent.revision + 1, updatedAt: "2026-07-16T12:01:00.000Z" };
const newerSnapshot = createGenerationInputSnapshot({
  business: canonical.snapshot.business,
  siteIntent: newerIntent,
  assets: canonical.snapshot.assets,
  evidenceManifest: canonical.snapshot.evidenceManifest,
  formDefinition: candidateForm,
  sourceSnapshotIds: canonical.snapshot.sourceSnapshotIds,
  verticalPack: canonical.snapshot.verticalPack,
  eligibilityMode: "protected_preview",
  createdAt: newerIntent.updatedAt
});
persistCanonicalGenerationInput({ ...structuredClone(canonical), siteIntent: newerIntent, snapshot: newerSnapshot });
const staleAcceptance = acceptSiteCandidateAsVersion({ candidateId: candidate.id, siteId: sampleBusinessProfile.siteId });
assert.equal(staleAcceptance?.ok, false);
assert.match(staleAcceptance?.reason ?? "", /site_intent_revision/);

// Accepted artifact copies are independently site-owned, so deleting a source
// candidate cannot delete published provenance.
const copiedArtifact = copyCandidateArtifactToSite({
  artifact: {
    id: "artifact_candidate_contract",
    siteCandidateId: candidate.id,
    scope: "candidate_selected",
    artifactType: "generation_plan",
    artifactVersion: sampleGenerationPlan.schemaVersion,
    provenance: sampleGenerationPlan.provenance,
    contentHash: "abcdef0123456789",
    payload: { plan: sampleGenerationPlan },
    createdAt: now
  },
  managedSiteId: sampleBusinessProfile.siteId,
  acceptedAt: now
});
assert.equal(copiedArtifact.siteCandidateId, undefined);
assert.equal(copiedArtifact.siteId, sampleBusinessProfile.siteId);
assert.equal(copiedArtifact.scope, "site_selected");
upsertSiteArtifact(copiedArtifact);

// State is persisted before objective QA, and failed QA explicitly retains it.
const serviceSource = await readFile(new URL("../lib/control-plane-service.ts", import.meta.url), "utf8");
assert.ok(serviceSource.indexOf("await repository.persistCanonicalGenerationInput") < serviceSource.indexOf("const gate = await runObjectiveGenerationGate"));
assert.match(serviceSource, /Canonical state was retained, but the replacement version failed objective QA/);
assert.match(serviceSource, /coalesceKey: `control_plane:\$\{request\.siteId\}`/);

assert.ok(getSiteBundle(sampleBusinessProfile.siteId));
console.log(JSON.stringify({
  ok: true,
  contracts: 16,
  observationsAreNotTruth: true,
  immutableInputs: true,
  exactForms: true,
  staleAcceptanceBlocked: true,
  protectedPublishBlocked: true
}, null, 2));

function proof(id: string, kind: BusinessProofV1["kind"], publicText: string, status: BusinessProofV1["status"]): BusinessProofV1 {
  return {
    id,
    businessId: canonical.state.business.id,
    kind,
    status,
    publicText,
    evidenceIds: [],
    createdAt: now,
    updatedAt: now
  };
}
