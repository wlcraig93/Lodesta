import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileGeneratedSiteV3Site, sourceBackedReviewSummaryFactV1 } from "../lib/generated-site-v3-compiler";
import {
  generatedSiteV3ArtifactTypes,
  generatedSiteV3FontPairings,
  initialSiteArtDirectionRecipesV3
} from "../lib/generated-site-v3";
import { applyGeneratedSiteV3 } from "../lib/generated-site-v3-pipeline";
import { compileVisualSectionV3, getVisualSectionV3, type VisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import { reconcileNavPlanV3 } from "../lib/generated-site-v3-nav";
import { buildGeneratedSiteQaMetadata } from "../lib/generated-site-qa";
import { generationObjectiveBlockersV3 } from "../lib/generation-gate";
import { applyCompositionPlanV3, validateCompositionPlanV3 } from "../lib/generated-site-v3-composition-plan";
import { generatedSiteDesignSystemsV1 } from "../lib/generated-site-design-systems-v1";
import {
  assertValidSectionBlueprintV1,
  sectionBlueprintVersionV1,
  validateSectionBlueprintV1
} from "../lib/generated-site-v3-blueprint";
import { modelSelectableSectionTemplatesV3, renderableSectionTemplatesV3 } from "../lib/generated-site-v3-section-templates";
import { withBusinessBundleFields } from "../lib/business-model";
import { localRepository } from "../lib/repository";
import { generateSite } from "../lib/site-candidate-service";
import { SiteRendererV3 } from "../lib/site-renderer-v3";
import type { AssetReference, BusinessProfile, ExtensionModel, GeneratedCopyDeckV2, RenderInspectionResult, SiteBundle, SiteModel, SiteVersionV3, Theme } from "../lib/models";
import { siteEvidenceLedgerVersionV1, type SiteEvidenceLedgerV1 } from "../lib/evidence-ledger-v1";
import { normalizeVisualQaVerdict } from "../lib/visual-qa";
import { lintGeneratedCopyDeck, prepareGeneratedCopyDeckForLint } from "../lib/generated-copy-v2";

const forbiddenPublicV3Copy = [
  "template",
  "source fact",
  "source-backed",
  "source information",
  "generic contact form",
  "visual context",
  "business media context",
  "proof",
  "the page keeps",
  "the site keeps",
  "services listed here",
  "avoid unrelated work",
  "call path",
  "kept close",
  "text-first layout",
  "confirmed business information",
  "next step",
  "customer action path",
  "context"
];
const removedLocationPanelTemplateId = ["location", "panel"].join("_");

assert.equal(normalizeVisualQaVerdict("revise", [{ severity: "warning" }]), "ship", "Warnings alone cannot require revision.");
assert.equal(normalizeVisualQaVerdict("ship", [{ severity: "fail" }]), "revise", "A material fail finding must require revision.");

assert.deepEqual(generatedSiteV3ArtifactTypes, [
  "art_direction_decision",
  "media_asset_decision",
  "copy_evaluation_report",
  "v3_review_packet",
  "generation_cost_report"
]);

assert.ok(generatedSiteV3FontPairings.length >= 8, "V3 should define a broad universal font pool.");
assert.ok(initialSiteArtDirectionRecipesV3.length >= 5, "V3 should define launch art direction recipe candidates.");
assert.ok(
  initialSiteArtDirectionRecipesV3.every((recipe) => generatedSiteV3FontPairings.includes(recipe.fontPairingId)),
  "Every V3 art direction recipe should use an approved font pairing."
);
assert.ok(
  initialSiteArtDirectionRecipesV3.every((recipe) => recipe.headerModes.length && recipe.version === "site-art-direction-recipe-v1"),
  "Every V3 recipe should define bounded header compatibility and version."
);
const renderableTemplateIds = new Set(renderableSectionTemplatesV3().map((template) => template.id));
assert.ok(
  modelSelectableSectionTemplatesV3().every((template) => renderableTemplateIds.has(template.id)),
  "Every model-selectable template must remain renderable for stored-plan replay."
);
assert.ok(
  generatedSiteDesignSystemsV1.length >= 5 && generatedSiteDesignSystemsV1.length <= 7,
  "Launch design-system catalog should keep 5-7 enabled, human-approved systems."
);
for (const designSystem of generatedSiteDesignSystemsV1) {
  assert.equal(designSystem.version, "generated-site-design-system-v1", `${designSystem.id} should use the design-system contract version.`);
  assert.equal(designSystem.manuallyApproved, true, `${designSystem.id} cannot be enabled without manual design approval.`);
  assert.equal(designSystem.approval.status, "approved", `${designSystem.id} approval status should be approved.`);
  assert.ok(designSystem.approval.desktopReview.length >= 48, `${designSystem.id} should record desktop review evidence.`);
  assert.ok(designSystem.approval.mobileReview.length >= 48, `${designSystem.id} should record mobile review evidence.`);
  assert.ok(designSystem.approval.distinctiveness.length >= 36, `${designSystem.id} should record what makes it visually distinct.`);
  assert.ok(designSystem.chassis.fontPairingMenu.length >= 3 && designSystem.chassis.fontPairingMenu.length <= 5, `${designSystem.id} should expose a tuned 3-5 pairing expression menu.`);
  assert.equal(new Set(designSystem.sectionPolicy.orderedSectionIds).size, designSystem.sectionPolicy.orderedSectionIds.length, `${designSystem.id} section order must not contain duplicates.`);
}
assertValidSectionBlueprintV1({
  version: sectionBlueprintVersionV1,
  id: "contract_services_grid",
  source: "deterministic",
  role: "services",
  templateId: "intro_grid",
  background: { kind: "solid", token: "surface" },
  presentation: { services: "card_grid" },
  ctaRole: "contextual",
  slotCounts: { items: 4 },
  controls: {
    layout: "card_grid",
    alignment: "start",
    width: "wide",
    padding: "spacious",
    background: "surface",
    mediaCrop: "center",
    density: "balanced"
  }
});
assert.equal(
  validateSectionBlueprintV1({
    version: sectionBlueprintVersionV1,
    id: "contract_bad_template",
    source: "deterministic",
    role: "services",
    templateId: "not_a_template" as never
  }).ok,
  false,
  "SectionBlueprintV1 should reject unknown templates."
);
assert.equal(
  validateSectionBlueprintV1({
    version: sectionBlueprintVersionV1,
    id: "contract_bad_presentation",
    source: "deterministic",
    role: "services",
    templateId: "intro_grid",
    presentation: { services: "stepper_vertical" as never }
  }).ok,
  false,
  "SectionBlueprintV1 should reject role-incompatible presentations."
);

const testBusiness: BusinessProfile = {
  id: "business_v3_contract",
  siteId: "site_v3_contract",
  name: "Contract Collision",
  vertical: "auto_body",
  categories: ["Auto body shop"],
  phone: "(512) 555-0100",
  address: {
    street: "100 Test Road",
    city: "Austin",
    region: "TX",
    postalCode: "78702",
    country: "US"
  },
  services: ["Collision repair", "Paint refinishing", "Dent repair", "Auto glass"],
  serviceAreas: ["Austin"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: {}
};
const testCompile = compileGeneratedSiteV3Site({ siteId: testBusiness.siteId, business: testBusiness, createdAt: "2026-06-02T00:00:00.000Z" });
const testVersion = testCompile.version;
assert.equal(testVersion.rendererVersion, "layout-v3", "V3 compiler should emit layout-v3.");
const heroSection = testVersion.pageComposition.pages[0]?.sections[0];
const firstVisualSection = getVisualSectionV3(testVersion.pageComposition.pages[0]?.sections[0]?.props ?? {});
assert.equal(heroSection?.variant, "hero_statement", `Auto-body no-media floor should lead with hero_statement; got ${heroSection?.variant}.`);
assert.equal(firstVisualSection?.templateId, "hero_statement", `Auto-body no-media floor should compile a hero_statement; got ${firstVisualSection?.templateId}.`);
assert.equal(firstVisualSection?.options.heroLayout, "no_media_editorial", "Auto-body no-media floor should use the media-independent editorial hero.");
assert.equal("media" in (firstVisualSection?.slots ?? {}), false, "Auto-body no-media floor hero should not render a media slot.");
assert.equal(testVersion.artDirection.mediaTreatment, "media_independent", "Auto-body no-media floor should record media-independent art direction.");
assert.equal(testCompile.compositionReport.selectedRecipe, "auto_body_v1", "V3 compiler should expose the selected auto-body recipe in the internal composition report.");
assert.equal(testCompile.compositionReport.evidence.hasRealPricingEvidence, false, "Baseline auto-body fixture should not infer pricing evidence.");
assert.equal(testCompile.compositionReport.evidence.hasQuoteProof, false, "Baseline auto-body fixture should not infer testimonial evidence.");
assert.ok(testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "recipe" && decision.status === "included"), "Composition report should record recipe selection.");
assert.ok(
  testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "pricing_packages" && decision.status === "skipped"),
  "Composition report should record skipped pricing without pricing evidence."
);
assert.ok(
  testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "media_gallery" && decision.status === "skipped"),
  "Auto-body no-media floor should skip media_mosaic when no real media clears the floor."
);
assert.ok(
  testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "media_feature" && decision.status === "skipped"),
  "Auto-body no-media floor should not select media_feature without floor-clearing real media."
);
assert.equal("sectionPurposeId" in (firstVisualSection ?? {}), false, "Rendered visual sections should not carry purpose metadata.");
assert.equal("evidence" in (firstVisualSection ?? {}), false, "Rendered visual sections should not carry evidence metadata.");
assert.equal(
  testVersion.pageComposition.pages[0]?.sections.every((section) => {
    const visualSection = getVisualSectionV3(section.props);
    return Boolean(visualSection && compileVisualSectionV3(visualSection).violations.every((violation) => violation.severity !== "error"));
  }),
  true,
  "V3 compiler sections should satisfy the typed visual-section contract."
);
assert.ok(testVersion.mediaDecisions.every((decision) => decision.rightsStatus === "approved" && decision.mayImplyRealBusinessWork === false), "Curated V3 media decisions should be approved and non-deceptive.");
const compiledTemplateIds = new Set<string>(visualTemplatesFor(testVersion));
assert.equal(visualTemplatesFor(testVersion).includes("location_showcase"), true, "Single physical-location businesses should render location_showcase.");
const templateOrder = (testVersion.pageComposition.pages[0]?.sections ?? [])
  .map((section) => getVisualSectionV3(section.props))
  .filter((section): section is VisualSectionV3 => Boolean(section))
  .map((section) => section.templateId);
assert.deepEqual(
  testCompile.compositionReport.sectionBlueprints?.map((blueprint) => blueprint.templateId),
  templateOrder,
  "V3 compiler should expose validated section blueprints matching the rendered homepage sequence."
);
assert.equal(testCompile.compositionReport.sectionBlueprintValidation?.status, "passed", "V3 section blueprint validation should pass before hydration authority is split.");
assert.ok(testVersion.designArchetypeId, "Compiled V3 versions should record the assigned design system in the stable V3 metadata field.");
assert.equal(testVersion.artDirection.designArchetypeId, testVersion.designArchetypeId, "Art direction should expose the same design-system id as version metadata.");
assert.ok(testVersion.geometryDiversityDirective, "Compiled V3 versions should record a geometry diversity directive.");
assert.ok(testVersion.sectionOptionSequence?.length, "Compiled V3 versions should expose section option fingerprints for offline diversity audits.");
assert.ok(
  testVersion.compilerDecisions?.some((decision) => decision.kind === "archetype_assignment" && decision.id.includes(testVersion.designArchetypeId ?? "")),
  "Compiler decisions should include the design-system assignment."
);
assert.ok(
  testVersion.compilerDecisions?.some((decision) => decision.kind === "quality_profile_assignment" && decision.resolvedValue === "auto_body"),
  "Compiler decisions should include the tuned auto-body quality profile assignment."
);
const defaultProfileCompile = compileGeneratedSiteV3Site({
  siteId: "site_v3_default_profile_contract",
  business: {
    ...testBusiness,
    id: "business_v3_default_profile_contract",
    siteId: "site_v3_default_profile_contract",
    name: "Default Profile Local Service",
    vertical: "home_services",
    categories: ["Home services"],
    services: ["Small repairs", "Drywall patching", "Fixture replacement"],
    serviceHighlights: ["Small repairs", "Drywall patching", "Fixture replacement"]
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
assert.ok(
  defaultProfileCompile.version.compilerDecisions?.some((decision) => decision.kind === "quality_profile_assignment" && decision.resolvedValue === "home_services"),
  "Locked verticals should record their profile assignment without falling back to a shared default path."
);
const contactIndex = templateOrder.indexOf("contact_split");
const locationIndex = templateOrder.indexOf("location_showcase");
const repairContextIndexes = (["split_media", "proof_pair", "media_feature", "media_mosaic"] as const)
  .map((templateId) => templateOrder.indexOf(templateId))
  .filter((index) => index >= 0);
const autoBodySectionOrder = testVersion.pageComposition.pages[0]?.sections.map((section) => section.id) ?? [];
const repairContactAnchorIndex = repairContextIndexes.length ? Math.max(...repairContextIndexes) : templateOrder.indexOf("intro_grid");
assert.ok(
  contactIndex > repairContactAnchorIndex && contactIndex > locationIndex && !autoBodySectionOrder.includes("cta_band"),
  "Auto-body contact_split should close after repair proof and location details, without a low-depth standalone CTA band."
);
const locationShowcase = visualSectionsFor(testVersion).find((section) => section.templateId === "location_showcase");
assert.ok(locationShowcase, "Compiled V3 page should include a location_showcase.");
assert.ok(locationShowcase.slots.locations.locations.every((location) => location.addressLine), "location_showcase should only render address-bearing locations.");

assert.equal(locationShowcase.slots.locations.locations[0]?.directionsUrl?.startsWith("https://www.google.com/maps/dir/?"), true, "Physical locations should get a Google Maps directions URL.");
assert.equal(locationShowcase.slots.locations.locations[0]?.mapEmbedIntent?.kind, "address", "Physical address locations should persist a keyless map embed intent.");
assert.equal(JSON.stringify(testVersion).includes(removedLocationPanelTemplateId), false, "Compiled V3 output must not contain the removed location panel template.");
const contactPanel = visualSectionsFor(testVersion).find((section) => section.templateId === "contact_split");
assert.ok(contactPanel?.templateId === "contact_split", "Compiled V3 page should include a contact_split.");
assert.equal(contactPanel.slots.contact.facts.some((fact) => fact.label === "Address" || fact.label === "Hours"), false, "contact_split should slim address/hours facts when a location section is present.");
assert.equal(contactPanel.options.contactLayout, "visit_first", "location-backed contact_split should use the merged visit-first contact variant.");
assert.equal(contactPanel.options.proofSidebar, "location", "location-backed contact_split should present the location-aware proof sidebar.");
assert.equal(contactPanel.options.ctaMode, "directions", "location-backed contact_split should make directions the secondary contact action.");
assert.equal(JSON.stringify(testVersion).includes("googleMapsUri"), false, "SiteVersion must not persist Google Maps URI fields.");
assert.equal(JSON.stringify(testVersion).includes("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY"), false, "SiteVersion must not persist public map key names.");
assert.equal(JSON.stringify(testVersion).includes("ratingValue"), false, "SiteVersion must not persist Google rating data.");
assert.equal(JSON.stringify(testVersion).includes("reviewCount"), false, "SiteVersion must not persist Google review counts.");
assert.equal(compiledTemplateIds.has("pricing_grid"), false, "Compiled V3 sections must not use pricing_grid.");
assert.equal(compiledTemplateIds.has("top_intro_grid"), false, "Compiled V3 sections must not use top_intro_grid.");
assert.equal(visualTemplatesFor(testVersion).includes("quote_wall"), false, "Quote wall should be omitted without testimonial evidence.");
const compiledCopyCorpus = testVersion.pageComposition.pages.flatMap((page) => page.sections.flatMap((section) => collectPublicSectionStrings(section.props))).join("\n").toLowerCase();
for (const copy of forbiddenPublicV3Copy) {
  assert.equal(compiledCopyCorpus.includes(copy), false, `V3 compiler should not emit internal/template public copy: ${copy}`);
}

const exactlyThreeServices = compileGeneratedSiteV3Site({
  siteId: "site_v3_three_services",
  business: {
    ...testBusiness,
    id: "business_v3_three_services",
    siteId: "site_v3_three_services",
    services: ["Collision repair", "Paint refinishing", "Dent repair"]
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
const exactlyThreeServiceSection = visualSectionsFor(exactlyThreeServices.version).find((section) => section.anchorId === "services");
assert.equal(
  exactlyThreeServiceSection?.templateId,
  "intro_grid",
  "Exactly three auto-body services should still render a bounded intro_grid service section."
);
assert.equal(
  exactlyThreeServiceSection?.options.cardTreatment,
  "editorial_cards",
  "Exactly three no-media auto-body services should render editorial cards instead of media-top cards."
);
assert.equal(
  exactlyThreeServices.version.artDirection.sectionPresentation?.services,
  "feature_list",
  "Exactly three no-media auto-body services should use the feature-list service presentation."
);

const fourAutoBodyServices = compileGeneratedSiteV3Site({
  siteId: "site_v3_four_services",
  business: {
    ...testBusiness,
    id: "business_v3_four_services",
    siteId: "site_v3_four_services",
    services: ["Collision repair", "Paint refinishing", "Dent repair", "Hail damage repair"]
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
const fourAutoBodyServiceSection = visualSectionsFor(fourAutoBodyServices.version).find((section) => section.anchorId === "services");
assert.ok(
  fourAutoBodyServiceSection?.templateId === "intro_grid" &&
    ["service_cards", "media_top_cards", "editorial_cards"].includes(String(fourAutoBodyServiceSection.options.cardTreatment)),
  "Four or more auto-body services should use a bounded premium intro_grid service-card treatment."
);
assert.ok(
  ["premium_showcase", "feature_list", "showcase_grid", "image_tiles", "media_grid", "card_grid", "action_tiles", "menu_preview"].includes(
    String(fourAutoBodyServices.version.artDirection.sectionPresentation?.services)
  ),
  "Four or more auto-body services should use a bounded model-selectable service presentation."
);

const pseudoQuoteService = compileGeneratedSiteV3Site({
  siteId: "site_v3_pseudo_quote",
  business: {
    ...testBusiness,
    id: "business_v3_pseudo_quote",
    siteId: "site_v3_pseudo_quote",
    services: ["Collision repair", "Paint refinishing", "Free Repair Quote", "Dent repair"]
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
assert.equal(
  pseudoQuoteService.version.pageComposition.pages.some((page) => /quote|estimate/i.test(`${page.slug} ${page.title}`)),
  false,
  "Pseudo-service quote items should not become service landing pages."
);

const saturdayHours = compileGeneratedSiteV3Site({
  siteId: "site_v3_saturday_hours",
  business: {
    ...testBusiness,
    id: "business_v3_saturday_hours",
    siteId: "site_v3_saturday_hours",
    hours: {
      monday: "8 AM - 5 PM",
      tuesday: "8 AM - 5 PM",
      wednesday: "8 AM - 5 PM",
      thursday: "8 AM - 5 PM",
      friday: "8 AM - 5 PM",
      saturday: "9 AM - 1 PM"
    }
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
const saturdayLocationShowcase = visualSectionsFor(saturdayHours.version).find((section) => section.templateId === "location_showcase");
assert.ok(
  saturdayLocationShowcase?.templateId === "location_showcase" &&
    saturdayLocationShowcase.slots.locations.locations.some((location) => location.hours?.some((entry) => /saturday/i.test(entry.label))),
  "Saturday hours should render when source hours include Saturday."
);

const pricingEvidence = compileGeneratedSiteV3Site({
  siteId: "site_v3_pricing",
  business: {
    ...testBusiness,
    id: "business_v3_pricing",
    siteId: "site_v3_pricing",
    services: ["Starter package: from $299 for small dents", "Paint plan: starts at $899 for panel refinish", "Collision package: estimate required after review"]
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
assert.equal(pricingEvidence.compositionReport.evidence.hasRealPricingEvidence, true, "Pricing-language services should classify as real pricing evidence.");
assert.ok(
  visualSectionsFor(pricingEvidence.version).some((section) => section.templateId === "intro_grid" && section.options.cardTreatment === "comparison"),
  "Pricing evidence should render intro_grid with comparison card treatment."
);

const fourMediaEvidence = compileGeneratedSiteV3Site({
  siteId: "site_v3_four_media",
  business: {
    ...testBusiness,
    id: "business_v3_four_media",
    siteId: "site_v3_four_media",
    photos: [0, 1, 2, 3].map((index) => analyzedUploadedAutoBodyPhoto(`photo_${index}`, `Safe real shop photo ${index + 1}`))
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
assert.equal(fourMediaEvidence.compositionReport.evidence.safeMediaCount, 4, "Four analyzed real media items should be counted before compilation.");
assert.equal(visualTemplatesFor(fourMediaEvidence.version).includes("media_mosaic"), true, "Four analyzed real media items should select media_mosaic.");
assert.equal(visualTemplatesFor(fourMediaEvidence.version).includes("media_feature"), false, "Four analyzed real media items should skip media_feature.");

const sparseMosaicViolations = compileVisualSectionV3({
  version: "visual-section-v3",
  templateId: "media_mosaic",
  options: { background: { kind: "solid", token: "surface" } },
  slots: {
    copy: {
      eyebrow: "Gallery",
      heading: "Sparse gallery should fail validation."
    },
    media: {
      caption: "none",
      focalPoint: "center",
      items: [
        { url: "/generated-site-assets/auto-body/lift-bay-overview-v1.png", label: "Safe shop photo 1" },
        { url: "/generated-site-assets/auto-body/finished-shop-review-v1.png", label: "Safe shop photo 2" }
      ]
    }
  }
} satisfies VisualSectionV3).violations;
assert.ok(
  sparseMosaicViolations.some((violation) => violation.id === "visual.slot_count_invalid" && violation.slotId === "media" && violation.severity === "error"),
  "Two-image media_mosaic should fail the typed visual-section media count contract."
);

const sparseContact = compileGeneratedSiteV3Site({
  siteId: "site_v3_sparse_contact",
  business: {
    ...testBusiness,
    id: "business_v3_sparse_contact",
    siteId: "site_v3_sparse_contact",
    phone: undefined,
    email: undefined,
    address: undefined,
    hours: undefined,
    serviceAreas: [],
    photos: []
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
assert.equal(
  visualTemplatesFor(sparseContact.version).some((template) => template === "location_directory" || template === "location_showcase" || template === "service_area_showcase"),
  false,
  "No-location businesses should omit location sections."
);
assert.equal(
  visualSectionsFor(sparseContact.version).every((section) => compileVisualSectionV3(section).violations.every((violation) => violation.severity !== "error")),
  true,
  "Sparse contact data should still compile required facts/contact sections without V3 contract errors."
);

const serviceAreaOnly = compileGeneratedSiteV3Site({
  siteId: "site_v3_service_area_only",
  business: {
    ...testBusiness,
    id: "business_v3_service_area_only",
    siteId: "site_v3_service_area_only",
    address: undefined,
    serviceAreas: ["Austin", "Round Rock"]
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
const serviceAreaLocation = visualSectionsFor(serviceAreaOnly.version).find((section) => section.templateId === "service_area_showcase");
assert.ok(serviceAreaLocation?.templateId === "service_area_showcase", "Service-area-only businesses should render service_area_showcase.");
assert.equal(visualTemplatesFor(serviceAreaOnly.version).includes("location_directory"), false, "Service-area-only businesses should not render fake location directories.");
assert.equal(serviceAreaOnly.version.pageComposition.pages.some((page) => page.purpose === "location_landing"), false, "Service-area-only businesses should not generate location landing pages.");

const testTheme: Theme = {
  paletteName: "test",
  colors: {
    background: "#ffffff",
    surface: "#ffffff",
    text: "#111111",
    muted: "#555555",
    primary: "#145c48",
    primaryText: "#ffffff",
    accent: "#c59d44",
    border: "#dddddd"
  },
  typography: { heading: "system", body: "system" },
  radius: "sm",
  density: "standard",
  mood: "editorial"
};
const testSite: SiteModel = {
  id: testBusiness.siteId,
  slug: "contract-collision",
  theme: testTheme,
  versions: [],
  pinList: []
};
const testExtensions: ExtensionModel = { forms: [], workflows: [], customBlocks: [] };

const testimonialBundle = createTestBundle();
testimonialBundle.businessProfile = {
  ...testBusiness,
  id: "business_v3_testimonials",
  siteId: "site_v3_testimonials"
};
testimonialBundle.presenceAssessment.siteId = "site_v3_testimonials";
testimonialBundle.presenceAssessment.evidenceLedgerV1 = testimonialEvidenceLedger();
const testimonialEvidence = compileGeneratedSiteV3Site({ bundle: testimonialBundle, createdAt: "2026-06-02T00:00:00.000Z" });
assert.equal(testimonialEvidence.compositionReport.evidence.hasQuoteProof, true, "Two source-backed testimonial evidence items should classify as quote proof.");
assert.equal(visualTemplatesFor(testimonialEvidence.version).includes("quote_wall"), true, "Testimonial evidence should render quote_wall.");
assert.equal(
  JSON.stringify(testimonialEvidence.version).includes('"sourceHref":"https://contract.example/reviews"'),
  true,
  "Rendered testimonial evidence should retain a visitor-verifiable source link."
);

const reviewSummaryBundle = createTestBundle();
reviewSummaryBundle.businessProfile = {
  ...reviewSummaryBundle.businessProfile,
  reviewsSummary: { rating: 4.8, count: 127, sources: ["website_schema"] },
  provenance: {
    ...reviewSummaryBundle.businessProfile.provenance,
    reviewsSummary: {
      source: "website",
      sourceUrl: "https://contract.example/",
      confidence: 0.65,
      verified: false,
      observedAt: "2026-06-02T00:00:00.000Z"
    }
  }
};
assert.deepEqual(
  sourceBackedReviewSummaryFactV1(reviewSummaryBundle.businessProfile),
  { label: "Customer rating", value: "4.8/5 · 127 reviews", href: "https://contract.example/" },
  "A website-schema aggregate rating should compile to an honestly labeled, source-linked proof fact."
);

{
  const navPlanVersion = structuredClone(testVersion);
  navPlanVersion.artDirection = {
    ...navPlanVersion.artDirection,
    buttonSystem: "high_contrast_primary",
    navPlan: {
      source: "site_director",
      items: [
        {
          label: "Services",
          kind: "dropdown",
          children: [
            { label: "Collision", target: "services/collision-repair" },
            { label: "Paint", target: "services/paint-refinishing" }
          ]
        },
        { label: "Process", kind: "anchor", target: "#process" },
        { label: "Visit", kind: "anchor", target: "#location" }
      ],
      primaryCta: { label: "Start estimate", target: "#contact" }
    }
  };
  const navPlanHtml = renderToStaticMarkup(
    React.createElement(SiteRendererV3, {
      business: testBusiness,
      site: testSite,
      version: navPlanVersion,
      tracking: false,
      formsEnabled: false,
      basePath: ""
    })
  );
  assert.ok(navPlanHtml.includes("<summary>Services</summary>"), "Director nav plan should render dropdown nav in the public header.");
  assert.ok(navPlanHtml.includes("href=\"/services/collision-repair\""), "Director dropdown children should render as site-local links.");
  assert.ok(navPlanHtml.includes("Start estimate"), "Director primary CTA label should render in the header.");
  assert.ok(navPlanHtml.includes('data-button-system="high_contrast_primary"'), "Director button system should reach the rendered root attribute.");
}

{
  const largeServiceBlueprints = [
    { version: sectionBlueprintVersionV1, id: "hero", source: "site_director", role: "hero", templateId: "hero_split", templateOptions: { headlineScale: "display", ctaLayout: "stacked", mediaTreatment: "bleed", heroLayout: "classic_split" } },
    { version: sectionBlueprintVersionV1, id: "services", source: "site_director", role: "services", templateId: "intro_grid", anchorId: "services", templateOptions: { cardTreatment: "service_cards" } },
    { version: sectionBlueprintVersionV1, id: "service_index", source: "site_director", role: "services", templateId: "service_index", anchorId: "services", templateOptions: { serviceIndexTreatment: "featured_services_plus_all" } },
    { version: sectionBlueprintVersionV1, id: "faq", source: "site_director", role: "faq", templateId: "faq_list" },
    { version: sectionBlueprintVersionV1, id: "location", source: "site_director", role: "local", templateId: "location_showcase" },
    { version: sectionBlueprintVersionV1, id: "contact", source: "site_director", role: "contact", templateId: "contact_split" }
  ] as const;
  const largeServiceBundle = withBusinessBundleFields({
    businessProfile: {
      ...testBusiness,
      id: "business_v3_large_service_index",
      siteId: "site_v3_large_service_index",
      services: ["Collision repair", "Paint refinishing", "Paintless dent repair", "Bumper repair", "Auto glass", "Hail repair"]
    },
    siteModel: { ...testSite, id: "site_v3_large_service_index", slug: "large-service-index", versions: [] },
    extensionModel: testExtensions,
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: "site_v3_large_service_index",
      sourceUrl: "https://large-service-index.example",
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: [],
      siteDirectorPlanV1: {
        version: "site-director-runtime-v1",
        source: "deterministic",
        model: "deterministic-site-director-plan-v1",
        catalogSchemaHash: "fixture",
        businessPlannerInputHash: "fixture",
        planInputHash: "fixture",
        catalogManifest: {} as never,
        plannerInputManifest: {} as never,
        plan: {
          version: "site-director-plan-v1",
          strategy: {
            rationale: "Fixture design-system plan requests risky large-service and hero treatments so the compiler can prove it clamps geometry safely."
          },
          globalControls: {
            fontPosture: "utility",
            colorPosture: "high_contrast",
            buttonSystem: "square",
            cardChrome: "bordered",
            figureTreatment: "framed",
            headingTreatment: "display",
            sectionRhythm: "varied"
          },
          nav: { items: [], primaryCta: { label: "Call", target: "#contact" } },
          home: { sections: largeServiceBlueprints as never },
          servicePages: [],
          assets: [],
          qaExpectations: []
        },
        validation: {
          status: "passed",
          issues: [],
          acceptedSectionBlueprints: largeServiceBlueprints as never
        }
      } as unknown as NonNullable<SiteBundle["presenceAssessment"]["siteDirectorPlanV1"]>
    }
  });
  const largeServiceCompile = compileGeneratedSiteV3Site({ bundle: largeServiceBundle, createdAt: "2026-06-02T00:00:00.000Z" });
  const serviceIndex = visualSectionsForPage(largeServiceCompile.version, "").find((section) => section.templateId === "service_index");
  assert.equal(serviceIndex?.options.serviceIndexTreatment, "dropdown_preview", "Large flat service_index sections should clamp away from featured_services_plus_all.");
  assert.equal(
    visualSectionsForPage(largeServiceCompile.version, "").some((section) => section.templateId === "intro_grid" && section.anchorId === "services"),
    false,
    "Large service pages should not render an intro_grid service-card list and a full service_index with the same titles."
  );
  const hero = visualSectionsForPage(largeServiceCompile.version, "").find((section) => section.templateId === "hero_split" || section.templateId === "hero_statement");
  assert.equal(hero?.options.headlineScale, "standard", "Unsafe long display hero headings should clamp to standard scale.");
  assert.equal(hero?.options.ctaLayout, "button_plus_text_link", "Unsafe stacked hero CTAs should clamp to an above-fold-friendly layout.");
  assert.ok(
    largeServiceCompile.version.compilerDecisions?.some((decision) => decision.kind === "template_option_clamp" && decision.optionName === "serviceIndexTreatment"),
    "Service-index option clamps should be recorded in compiler decisions."
  );
  assert.ok(
    largeServiceCompile.version.compilerDecisions?.some((decision) => decision.kind === "composition_section_drop" && decision.sectionId === "services"),
    "Duplicate service-list section drops should be recorded in compiler decisions."
  );
}

{
  const reconciled = reconcileNavPlanV3({
    navPlan: {
      source: "site_director",
      items: [
        {
          label: "Services",
          kind: "dropdown",
          children: [
            { label: "Collision Repair", target: "/collision-repair" },
            { label: "Free Repair Quote", target: "/services/free-repair-quote" }
          ]
        },
        { label: "Case Studies", kind: "page", target: "/case-studies" }
      ],
      primaryCta: { label: "Free Repair Quote", target: "/services/free-repair-quote" }
    },
    pages: [{ slug: "" }, { slug: "collision-repair" }],
    homeAnchors: ["services", "proof", "contact"]
  });
  assert.ok(reconciled.droppedTargets.some((target) => target.label === "Free Repair Quote"), "Pseudo-service quote nav child should be dropped.");
  assert.ok(
    reconciled.rewrittenTargets.some((target) => target.label === "Case Studies" && target.to === "#proof"),
    "Case-study page intents should rewrite to proof only when that anchor exists."
  );
  assert.equal(reconciled.navPlan?.items.some((item) => item.kind === "dropdown"), false, "Single-child Services dropdown should collapse to a direct link.");
  assert.equal(reconciled.navPlan?.items[0]?.target, "/collision-repair", "Collapsed single-child dropdown should keep the surviving service target.");
  assert.equal(reconciled.navPlan?.primaryCta.target, "#contact", "Unresolved primary CTA should fall back to #contact.");

  const noAnchor = reconcileNavPlanV3({
    navPlan: {
      source: "site_director",
      items: [{ label: "Gallery", kind: "page", target: "/gallery" }],
      primaryCta: { label: "Contact", target: "#contact" }
    },
    pages: [{ slug: "" }],
    homeAnchors: ["contact"]
  });
  assert.ok(noAnchor.droppedTargets.some((target) => target.label === "Gallery"), "Missing home-section intent without a matching anchor should drop.");
  assert.equal(noAnchor.navPlan?.items.length, 0, "Missing home-section intent must not rewrite to a dead anchor.");

  const qaFromNavSignal = buildGeneratedSiteQaMetadata({
    bundle: qaBundleForVersion(testBusiness, testSite, testVersion),
    version: testVersion,
    inspection: cleanGeneratedInspection(testVersion, "qa_nav_signal"),
    qaRunId: "qa_nav_signal",
    qualitySignals: { navReconciliation: reconciled }
  });
  assert.ok(
    qaFromNavSignal.warnings.some((warning) => warning.id === "v3_nav_reconciliation_heavy"),
    "Reconciliation delta should create QA findings before DOM cleanup masks it."
  );
}

{
  const brokenAssetVersion = structuredClone(testVersion);
  (brokenAssetVersion as unknown as { missingAssetProbe: string }).missingAssetProbe = "/generated-site-assets/auto-body/asset-does-not-exist.png";
  const qaWithMissingAsset = buildGeneratedSiteQaMetadata({
    bundle: qaBundleForVersion(testBusiness, testSite, brokenAssetVersion),
    version: brokenAssetVersion,
    inspection: cleanGeneratedInspection(brokenAssetVersion, "qa_missing_asset"),
    qaRunId: "qa_missing_asset"
  });
  assert.ok(
    qaWithMissingAsset.blockers.some((blocker) => blocker.id === "v3_platform_asset_missing"),
    "Missing platform asset URLs should create a hard blocker."
  );
}

const placeIdOnlyBundle = withBusinessBundleFields({
  businessProfile: {
    ...testBusiness,
    id: "business_v3_place_only",
    siteId: "site_v3_place_only",
    address: undefined,
    serviceAreas: []
  },
  locations: [
    {
      id: "loc_place_only",
      businessId: "business_v3_place_only",
      label: "Place-only listing",
      serviceAreas: [],
      googlePlaceId: "ChIJplaceonly",
      provenance: {},
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z"
    }
  ],
  siteModel: { ...testSite, id: "site_v3_place_only", slug: "place-only", versions: [] },
  extensionModel: testExtensions,
  optimizationFindings: [],
  experiments: [],
  presenceAssessment: {
    siteId: "site_v3_place_only",
    sourceUrl: "https://place-only.example",
    technicalNotes: [],
    visualNotes: [],
    brandNotes: [],
    publicPresenceNotes: []
  }
});
const placeIdOnly = compileGeneratedSiteV3Site({ bundle: placeIdOnlyBundle, createdAt: "2026-06-02T00:00:00.000Z" });
assert.equal(
  visualTemplatesFor(placeIdOnly.version).some((template) => template === "location_showcase" || template === "location_directory" || template === "service_area_showcase"),
  false,
  "Place-ID-only canonical locations should not count as physical locations or service-area facts."
);
assert.equal(placeIdOnly.version.pageComposition.pages.some((page) => page.purpose === "location_landing"), false, "Place ID alone should not create a location landing page.");

const generatedCopyDeckFixture: GeneratedCopyDeckV2 = {
  version: "generated-copy-deck-v2",
  source: "openai",
  hero: { eyebrow: "Auto body", heading: "Frame and finish work with clear next steps.", body: "Bring the visible damage, timing, and contact details so the right shop path is clear." },
  servicesIntro: { heading: "Repairs that start with the damage in front of you.", body: "The service list stays focused on source-backed repair requests." },
  serviceItems: [
    { title: "Frame alignment", body: "Frame alignment checks visible structure and ride concerns before repair planning." },
    { title: "Scratch repainting", body: "Scratch repainting handles scraped panels and finish work after review." },
    { title: "Bumper welding", body: "Bumper welding routes damaged covers and support pieces toward the right repair." },
    { title: "Fleet body repair", body: "Fleet body repair keeps repeat vehicles moving through a direct intake path." }
  ],
  processIntro: { heading: "A clear intake path.", body: "Start with the vehicle, damage, timing, and preferred callback." },
  processSteps: [
    { title: "Share damage details", body: "Tell the shop what happened and which area is affected." },
    { title: "Confirm the repair fit", body: "The team routes the request to the right review path." },
    { title: "Plan the visit", body: "Call ahead with timing and vehicle details." },
    { title: "Bring the basics", body: "Photos and insurance questions help the first review." }
  ],
  faqs: [
    { question: "What should I bring?", answer: "Bring the vehicle details, photos, and timing constraints." },
    { question: "Can I ask about paint?", answer: "Yes, include which panels are scraped or refinished." },
    { question: "Can I call ahead?", answer: "Yes, calling first confirms timing and fit." },
    { question: "How is the right service chosen?", answer: "The shop starts with the visible damage and repair goal." }
  ],
  locationIntro: { heading: "Pick the location that fits the visit.", body: "Each documented address has its own details page before you call or get directions." },
  contactIntro: { heading: "Call or send a short message.", body: "Include the vehicle, damage, timing, and best callback." },
  splitMedia: { heading: "Repair details before assumptions.", body: "A short intake keeps the repair path grounded in the actual damage." },
  gallery: { heading: "Shop context.", body: "Use approved media only when it is safe to show publicly." },
  seo: { title: "Contract Collision", description: "Auto body repair details and contact path." },
  groundingNotes: ["Fixture copy for V3 contracts."],
  voiceProfile: { pov: "brand_direct" },
  servicePages: [
    {
      serviceName: "Frame alignment",
      hero: { heading: "Frame alignment starts with a focused review.", body: "Frame alignment requests need the vehicle details, visible damage, and the handling concern." },
      detail: { heading: "Frame alignment details before repair planning.", body: "Frame alignment work starts with the structure and symptoms so the repair path stays clear." },
      faqs: [
        { question: "When should I ask about frame alignment?", answer: "Ask after a collision or when the vehicle does not track correctly." },
        { question: "What helps the first call?", answer: "Share the impact area, photos, and whether the car can be driven." },
        { question: "Will I get the next step?", answer: "Yes, the shop confirms whether a visit or more details are needed." },
        { question: "Can location matter?", answer: "Yes, choose the location that best fits your visit." }
      ],
      seo: { title: "Frame Alignment | Contract Collision", description: "Frame alignment details, questions, and contact path." }
    },
    {
      serviceName: "Scratch repainting",
      hero: { heading: "Scratch repainting with the panel details up front.", body: "Scratch repainting requests work best when the panel, color area, and timing are clear." },
      detail: { heading: "Scratch repainting details before scheduling.", body: "Scratch repainting starts with the visible finish damage and whether one or several panels are affected." },
      faqs: [
        { question: "What should I describe?", answer: "Describe the panel, scrape size, and whether bare material is visible." },
        { question: "Do photos help?", answer: "Yes, photos help the shop understand the visible finish damage." },
        { question: "Can I call first?", answer: "Yes, call to confirm the right next step." },
        { question: "Does location matter?", answer: "Pick the location page that fits the visit." }
      ],
      seo: { title: "Scratch Repainting | Contract Collision", description: "Scratch repainting details, questions, and contact path." }
    }
  ]
};

const conflictSafeCopyDeck = prepareGeneratedCopyDeckForLint(
  {
    ...structuredClone(generatedCopyDeckFixture),
    about: {
      heading: "Protech Body Shop since 1998.",
      body: "Marwan opened Protech Body Shop in 1998. The shop's show-car paint experience still shapes its attention to finish quality."
    }
  },
  { ...testBusiness, name: "Pro Tech Body Shop" },
  { conflictedYears: ["1998", "2001"] }
);
assert.equal(JSON.stringify(conflictSafeCopyDeck).includes("1998"), false, "Conflicted chronology must be removed from every generated copy slot.");
assert.equal(JSON.stringify(conflictSafeCopyDeck).includes("Protech Body Shop"), false, "Generated copy should not retain a spacing variant of the canonical business name.");
assert.equal(JSON.stringify(conflictSafeCopyDeck).includes("Pro Tech Body Shop"), true, "Generated copy should use the canonical business name consistently.");
const unapprovedOfferCopyDeck = prepareGeneratedCopyDeckForLint(
  {
    ...structuredClone(generatedCopyDeckFixture),
    hero: {
      ...generatedCopyDeckFixture.hero,
      heading: "Request a free estimate for the visible damage."
    }
  },
  { ...testBusiness, offers: undefined }
);
assert.equal(JSON.stringify(unapprovedOfferCopyDeck).toLowerCase().includes("free estimate"), false, "Owner-review-only offers must not leak into generated public copy.");
const approvedOfferCopyDeck = prepareGeneratedCopyDeckForLint(
  {
    ...structuredClone(generatedCopyDeckFixture),
    hero: {
      ...generatedCopyDeckFixture.hero,
      heading: "Request a free estimate for the visible damage."
    }
  },
  { ...testBusiness, offers: ["Free estimate"] }
);
assert.equal(JSON.stringify(approvedOfferCopyDeck).toLowerCase().includes("free estimate"), true, "Owner-approved offers should remain available to generated public copy.");
const approvedCredentialCopyDeck = prepareGeneratedCopyDeckForLint(
  {
    ...structuredClone(generatedCopyDeckFixture),
    hero: {
      ...generatedCopyDeckFixture.hero,
      eyebrow: "I-CAR Gold Class Certified"
    }
  },
  testBusiness,
  { approvedClaimTexts: ["I-CAR Gold Class Certified"] }
);
assert.equal(JSON.stringify(approvedCredentialCopyDeck).includes("I-CAR Gold Class Certified"), true, "Exact durable credentials must survive deterministic copy repair.");
assert.equal(
  lintGeneratedCopyDeck(approvedCredentialCopyDeck, {
    businessName: testBusiness.name,
    business: testBusiness,
    approvedClaimTexts: ["I-CAR Gold Class Certified"]
  }).some((violation) => violation.includes("credential")),
  false,
  "The copy linter must accept an exact durable credential."
);
const mixedCredentialCopyDeck = {
  ...structuredClone(approvedCredentialCopyDeck),
  contactIntro: {
    ...approvedCredentialCopyDeck.contactIntro,
    body: "Certified experience with claim support."
  }
};
assert.equal(
  lintGeneratedCopyDeck(mixedCredentialCopyDeck, {
    businessName: testBusiness.name,
    business: testBusiness,
    approvedClaimTexts: ["I-CAR Gold Class Certified"]
  }).some((violation) => violation.includes("credential")),
  true,
  "An approved exact credential must not authorize unrelated certified wording."
);
const approvedAwardCopyDeck = prepareGeneratedCopyDeckForLint(
  {
    ...structuredClone(generatedCopyDeckFixture),
    hero: {
      ...generatedCopyDeckFixture.hero,
      eyebrow: "Award-winning collision repair"
    }
  },
  testBusiness,
  { approvedClaimTexts: ["Award-winning collision repair"] }
);
assert.equal(JSON.stringify(approvedAwardCopyDeck).includes("Award-winning collision repair"), true, "Exact durable awards must survive deterministic copy repair.");

const fullServiceCatalogBundle = createTestBundle();
fullServiceCatalogBundle.businessProfile.services = [
  "Frame alignment",
  "Scratch repainting",
  "Bumper welding",
  "Fleet body repair",
  "Collision repair",
  "Paintless dent repair",
  "Hail damage repair",
  "Auto glass replacement"
];
fullServiceCatalogBundle.presenceAssessment.generatedCopyDeck = {
  ...generatedCopyDeckFixture,
  serviceItems: generatedCopyDeckFixture.serviceItems.slice(0, 4)
};
applyGeneratedSiteV3({ bundle: fullServiceCatalogBundle, now: "2026-06-02T00:00:00.000Z" });
const fullServiceCatalogVersion = fullServiceCatalogBundle.siteModel.versions[0] as SiteVersionV3;
const fullServiceCatalogCorpus = visualSectionsForPage(fullServiceCatalogVersion, "")
  .filter((section) => section.anchorId === "services")
  .flatMap((section) => collectStrings(section.slots))
  .join("\n")
  .toLowerCase();
for (const service of fullServiceCatalogBundle.businessProfile.services) {
  assert.equal(
    fullServiceCatalogCorpus.includes(service.toLowerCase()),
    true,
    `Model copy may enrich but cannot remove the verified service: ${service}. Rendered service copy: ${fullServiceCatalogCorpus}`
  );
}

const multiLocationBundle = withBusinessBundleFields({
  businessProfile: {
    ...testBusiness,
    id: "business_v3_multi_location",
    siteId: "site_v3_multi_location",
    address: undefined,
    services: ["Frame alignment", "Scratch repainting", "Bumper welding", "Fleet body repair"],
    serviceAreas: ["Austin Metro"]
  },
  locations: [
    {
      id: "loc_north",
      businessId: "business_v3_multi_location",
      label: "North Austin",
      address: { street: "101 North Loop", city: "Austin", region: "TX", postalCode: "78751", country: "US" },
      phone: "(512) 555-0101",
      hours: { Monday: "8 AM-5 PM", Tuesday: "8 AM-5 PM" },
      serviceAreas: ["North Austin"],
      provenance: {},
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z"
    },
    {
      id: "loc_south",
      businessId: "business_v3_multi_location",
      label: "South Austin",
      address: { street: "202 South First", city: "Austin", region: "TX", postalCode: "78704", country: "US" },
      phone: "(512) 555-0102",
      serviceAreas: ["South Austin"],
      provenance: {},
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z"
    },
    {
      id: "loc_service_only",
      businessId: "business_v3_multi_location",
      label: "Mobile coverage",
      serviceAreas: ["Cedar Park"],
      provenance: {},
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z"
    }
  ],
  locationBindings: [
    { locationId: "loc_north", role: "primary", orderIndex: 0 },
    { locationId: "loc_south", role: "covered", orderIndex: 1 },
    { locationId: "loc_service_only", role: "covered", orderIndex: 2 }
  ],
  siteModel: { ...testSite, id: "site_v3_multi_location", slug: "multi-location", versions: [] },
  extensionModel: testExtensions,
  optimizationFindings: [],
  experiments: [],
  presenceAssessment: {
    siteId: "site_v3_multi_location",
    sourceUrl: "https://multi-location.example",
    technicalNotes: [],
    visualNotes: [],
    brandNotes: [],
    publicPresenceNotes: [],
    generatedCopyDeck: generatedCopyDeckFixture
  }
});
const multiLocation = compileGeneratedSiteV3Site({ bundle: multiLocationBundle, createdAt: "2026-06-02T00:00:00.000Z" });
const multiHomeTemplates = visualTemplatesForPage(multiLocation.version, "");
assert.equal(multiHomeTemplates.includes("location_directory"), true, "Multi-location homepage should render location_directory.");
assert.equal(multiHomeTemplates.includes("location_showcase"), false, "Multi-location homepage should not render location_showcase.");
const directorySection = visualSectionsForPage(multiLocation.version, "").find((section) => section.templateId === "location_directory");
assert.ok(directorySection?.templateId === "location_directory", "Multi-location homepage should include a typed location_directory section.");
assert.equal(directorySection.slots.locations.locations.length, 2, "Service-area-only records should not become directory cards.");
assert.ok(directorySection.slots.locations.locations.every((location) => location.addressLine && location.href?.startsWith("/locations/")), "Directory cards should be address-bearing and link to location pages.");
assert.ok(directorySection.slots.locations.locations.some((location) => location.hoursSummary), "Directory cards should use per-location hours summaries when present.");
const generatedLocationPages = multiLocation.version.pageComposition.pages.filter((page) => page.purpose === "location_landing");
assert.equal(generatedLocationPages.length, 2, "Multi-location businesses should get one landing page per physical location.");
assert.ok(generatedLocationPages.every((page) => page.slug.startsWith("locations/") && page.seo.canonicalPath === `/${page.slug}`), "Location pages should use typed locations/* slugs and canonical paths.");
const generatedServicePages = multiLocation.version.pageComposition.pages.filter((page) => page.purpose === "service_landing");
assert.ok(generatedServicePages.length >= 1, "Source-backed service copy should generate service landing pages.");
assert.ok(generatedServicePages.every((page) => page.slug.startsWith("services/") && page.seo.canonicalPath === `/${page.slug}`), "Service pages should use typed services/* slugs and canonical paths.");
assert.ok(
  generatedServicePages.every((page) => page.sections.every((section) => !section.id.endsWith("_process"))),
  "Service landing pages should not repeat the homepage's generic process module."
);
const scopedObjectiveBlockers = generationObjectiveBlockersV3(multiLocationBundle, multiLocation.version);
assert.equal(
  scopedObjectiveBlockers.some((blocker) => blocker.id === "gate_duplicate_service_titles"),
  false,
  "Service titles repeated in related-service navigation should not count as duplicates within the authored service list."
);
assert.equal(
  scopedObjectiveBlockers.some((blocker) => blocker.id.startsWith("gate_doorway_overlap_")),
  false,
  "Shared local, related-service, and contact modules should not make distinct service pages fail the doorway gate."
);
if (generatedServicePages.length >= 2) {
  const duplicateServiceVersion = structuredClone(multiLocation.version);
  const duplicateServicePages = duplicateServiceVersion.pageComposition.pages.filter((page) => page.purpose === "service_landing");
  duplicateServicePages[1].sections = structuredClone(duplicateServicePages[0].sections);
  assert.equal(
    generationObjectiveBlockersV3(multiLocationBundle, duplicateServiceVersion).some((blocker) => blocker.id.startsWith("gate_doorway_overlap_")),
    true,
    "Truly duplicated service-specific hero, detail, and FAQ copy must fail the doorway gate."
  );
}
const generatedSlugs = multiLocation.version.pageComposition.pages.map((page) => page.slug);
assert.equal(new Set(generatedSlugs).size, generatedSlugs.length, "Generated page slugs should be unique site-wide.");
assert.equal(generatedSlugs.filter((slug) => !slug.includes("/")).length, 1, "Homepage should be the only unprefixed generated page.");
const directoryHtml = renderToStaticMarkup(
  React.createElement(SiteRendererV3, {
    business: multiLocationBundle.businessProfile,
    site: multiLocationBundle.siteModel,
    version: multiLocation.version,
    locations: multiLocationBundle.locations,
    locationBindings: multiLocationBundle.locationBindings,
    tracking: false,
    formsEnabled: false,
    basePath: ""
  })
);
assert.ok(directoryHtml.includes("site-visual-location-card-mark-v3"), "Directory cards should have a defined no-photo/no-map brand-safe visual state.");
assert.ok(directoryHtml.includes('href="/locations/'), "Directory cards should link to generated location pages.");
assert.ok(directoryHtml.includes("site-footer-column-v3") && directoryHtml.includes("/locations/"), "Footer should link generated location pages.");

const mixedLocationLandingCount = generatedLocationPages.length;
assert.equal(mixedLocationLandingCount, 2, "Mixed physical plus service-area records should not create fake service-area location pages.");

const originalLocationMapMode = process.env.LODESTA_LOCATION_MAP_MODE;
const originalGoogleMapsBrowserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const originalGoogleMapsEmbedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;
try {
  process.env.LODESTA_LOCATION_MAP_MODE = "link_only";
  delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;
  const showcaseFallbackHtml = renderToStaticMarkup(
    React.createElement(SiteRendererV3, {
      business: testBusiness,
      site: testSite,
      version: testVersion,
      tracking: false,
      formsEnabled: false,
      basePath: ""
    })
  );
  assert.ok(showcaseFallbackHtml.includes("site-location-showcase-map-fallback-v3"), "location_showcase should render a brand-safe map fallback when map embeds are unavailable.");
  assert.equal(showcaseFallbackHtml.includes("site-location-showcase-service-v3"), false, "location_showcase should suppress redundant one-city service-area chips already covered by the address.");
  assert.equal(showcaseFallbackHtml.includes("site-location-showcase-areas-v3"), false, "address-backed location_showcase should not render a detached coverage card.");

  delete process.env.LODESTA_LOCATION_MAP_MODE;
  const showcaseAutoFallbackHtml = renderToStaticMarkup(
    React.createElement(SiteRendererV3, {
      business: testBusiness,
      site: testSite,
      version: testVersion,
      tracking: false,
      formsEnabled: false,
      basePath: ""
    })
  );
  assert.ok(showcaseAutoFallbackHtml.includes("maps.google.com/maps"), "location_showcase should default to a keyless classic Google Maps embed when no dedicated Embed API key is configured.");
  assert.equal(showcaseAutoFallbackHtml.includes("google.com/maps/embed/v1/place"), false, "location_showcase auto mode should not use the official Embed API without a dedicated Embed API key.");

  process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = "browser-restricted-public-key";
  const showcaseAutoWithKeyHtml = renderToStaticMarkup(
    React.createElement(SiteRendererV3, {
      business: testBusiness,
      site: testSite,
      version: testVersion,
      tracking: false,
      formsEnabled: false,
      basePath: ""
    })
  );
  assert.ok(showcaseAutoWithKeyHtml.includes("maps.google.com/maps"), "location_showcase auto mode should keep using keyless classic embeds when only a browser-restricted key is configured.");
  assert.equal(showcaseAutoWithKeyHtml.includes("google.com/maps/embed/v1/place"), false, "location_showcase auto mode should not use a browser-restricted Maps JS key for the Embed API.");

  process.env.LODESTA_LOCATION_MAP_MODE = "classic_embed";
  delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  const showcaseClassicEmbedHtml = renderToStaticMarkup(
    React.createElement(SiteRendererV3, {
      business: testBusiness,
      site: testSite,
      version: testVersion,
      tracking: false,
      formsEnabled: false,
      basePath: ""
    })
  );
  assert.ok(showcaseClassicEmbedHtml.includes("maps.google.com/maps"), "location_showcase should support explicit keyless classic map embeds.");

  process.env.LODESTA_LOCATION_MAP_MODE = "embed";
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY = "embed-api-public-key";
  const showcaseOfficialEmbedHtml = renderToStaticMarkup(
    React.createElement(SiteRendererV3, {
      business: testBusiness,
      site: testSite,
      version: testVersion,
      tracking: false,
      formsEnabled: false,
      basePath: ""
    })
  );
  assert.ok(showcaseOfficialEmbedHtml.includes("google.com/maps/embed"), "location_showcase should support official map embeds with an explicit public Embed API key.");
} finally {
  if (originalLocationMapMode === undefined) delete process.env.LODESTA_LOCATION_MAP_MODE;
  else process.env.LODESTA_LOCATION_MAP_MODE = originalLocationMapMode;
  if (originalGoogleMapsBrowserKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  else process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY = originalGoogleMapsBrowserKey;
  if (originalGoogleMapsEmbedKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;
  else process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY = originalGoogleMapsEmbedKey;
}

assert.equal(JSON.stringify(multiLocation.version).includes(removedLocationPanelTemplateId), false, "Multi-location compiled output must not contain the removed location panel template.");

function createTestBundle(): SiteBundle {
  return {
    businessProfile: testBusiness,
    siteModel: { ...testSite, versions: [] },
    extensionModel: testExtensions,
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: testBusiness.siteId,
      sourceUrl: "https://contract.example",
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function testimonialEvidenceLedger(): SiteEvidenceLedgerV1 {
  const createdAt = "2026-06-02T00:00:00.000Z";
  const quotes = [
    { quote: "They explained the dent repair clearly and kept me updated through the work.", attribution: "Customer A" },
    { quote: "The paint match looked clean, and the staff made pickup simple and professional.", attribution: "Customer B" }
  ];
  return {
    version: siteEvidenceLedgerVersionV1,
    producerId: "compose-site-evidence-ledger-v1",
    producerVersion: siteEvidenceLedgerVersionV1,
    modelId: "deterministic",
    siteId: "site_v3_testimonials",
    createdAt,
    stale: false,
    inputHashes: { crawl: "testimonial-contract-fixture" },
    items: quotes.map((entry, index) => ({
      id: `evidence_testimonial_contract_${index + 1}`,
      domain: "business_proof",
      kind: "testimonial",
      label: "First-party customer testimonial",
      value: { text: entry.quote, quote: entry.quote, attribution: entry.attribution },
      source: {
        type: "website_visible_text",
        url: "https://contract.example/reviews",
        pageTitle: "Customer reviews",
        extractionMethod: "contract_fixture",
        snippet: entry.quote
      },
      confidence: 0.9,
      renderPolicy: "durable_render",
      verification: "source_backed",
      observedAt: createdAt,
      sourceHash: `testimonial-contract-${index + 1}`
    })),
    summary: {
      businessProofItems: quotes.length,
      brandItems: 0,
      durableRenderItems: quotes.length,
      liveOnlyItems: 0,
      ownerReviewItems: 0
    }
  };
}

const defaultBundle = createTestBundle();
const applied = applyGeneratedSiteV3({
  bundle: defaultBundle,
  now: "2026-06-02T00:00:00.000Z"
});
assert.equal(applied.applied, true, "V3 application is the only generated-site path and must always apply.");
assert.equal(defaultBundle.siteModel.versions[0]?.rendererVersion, "layout-v3", "V3 application should replace the selected draft with layout-v3.");

{
  const generated = await generateSite({
    repository: localRepository,
    input: {
      prompt:
        "Create a website for Contract Collision, an auto body shop in Austin. Services: collision repair, paint refinishing, bumper repair, paintless dent repair, hail repair, auto glass. Phone: (512) 555-0100. Address: 100 Test Road, Austin, TX 78702."
    },
    source: "admin_console",
    modelFallbackPolicy: "allow"
  });
  const generatedVersion = generated.bundle.siteModel.versions[0];
  assert.equal(generatedVersion?.rendererVersion, "layout-v3", "Canonical generateSite path should emit layout-v3.");
  assert.equal(
    generatedVersion?.generationQa?.blockers.filter(
      (blocker) => blocker.id !== "render_browser_unavailable" && blocker.id !== "visual_judge_unavailable"
    ).length,
    0,
    JSON.stringify(generatedVersion?.generationQa?.blockers ?? [], null, 2)
  );
  assert.equal(
    generatedVersion?.generationQa?.blockers.some((blocker) => blocker.id === "visual_judge_unavailable") &&
      generatedVersion.generationQa.visualQa?.verdict === "not_evaluated",
    true,
    "Offline generation must stop for operator review when the required visual judgment cannot run; it must not manufacture a fallback grade."
  );
  const generatedCopyCorpus =
    generatedVersion?.rendererVersion === "layout-v3"
      ? generatedVersion.pageComposition.pages.flatMap((page) => page.sections.flatMap((section) => collectPublicSectionStrings(section.props))).join("\n").toLowerCase()
      : "";
  for (const copy of forbiddenPublicV3Copy) {
    assert.equal(generatedCopyCorpus.includes(copy), false, `Full V3 generateSite path should not emit internal/template public copy: ${copy}`);
  }
}

// Composition plan grammar (bespoke quality plan, workstream A).
{
  const built = [
    { id: "facts", variant: "facts_strip", backgroundKey: "gradient:subtle" },
    { id: "story", variant: "split_media", backgroundKey: "gradient:subtle" },
    { id: "services", variant: "side_intro_rows", backgroundKey: "solid:surface" },
    { id: "process", variant: "numbered_steps", backgroundKey: "solid:page" },
    { id: "gallery", variant: "media_mosaic", backgroundKey: "solid:surface" },
    { id: "faq", variant: "faq_list", backgroundKey: "gradient:subtle" },
    { id: "cta_band", variant: "editorial_statement", backgroundKey: "gradient:brand" },
    { id: "location", variant: "location_showcase", backgroundKey: "solid:page" }
  ];
  const goodPlan = {
    version: "composition-plan-v1" as const,
    source: "deterministic_design_system" as const,
    sections: ["gallery", "story", "services", "process", "faq", "cta_band", "location"].map((intent) => ({
      intent: intent as never,
      why: "test"
    }))
  };
  assert.deepEqual(
    validateCompositionPlanV3(goodPlan, built, { hasLocationSection: true }),
    [],
    "A grammar-conforming plan should validate."
  );
  const missingRequired = { ...goodPlan, sections: goodPlan.sections.filter((entry) => entry.intent !== ("faq" as never)) };
  assert.ok(
    validateCompositionPlanV3(missingRequired, built, { hasLocationSection: true }).length > 0,
    "Dropping faq must be rejected."
  );
  const adjacentDuplicate = {
    ...goodPlan,
    sections: [
      { intent: "services" as never, why: "test" },
      { intent: "process" as never, why: "test" },
      { intent: "faq" as never, why: "test" },
      { intent: "cta_band" as never, why: "test" },
      { intent: "location" as never, why: "test" }
    ]
  };
  const builtWithDuplicateTemplates = built.map((section) =>
    section.id === "process" ? { ...section, variant: "side_intro_rows" } : section
  );
  assert.ok(
    validateCompositionPlanV3(adjacentDuplicate, builtWithDuplicateTemplates, { hasLocationSection: true }).length > 0,
    "Adjacent sections sharing a template must be rejected."
  );
  const darkStack = {
    ...goodPlan,
    sections: [
      { intent: "services" as never, why: "test" },
      { intent: "process" as never, why: "test" },
      { intent: "faq" as never, why: "test" },
      { intent: "location" as never, why: "test" },
      { intent: "cta_band" as never, why: "test" }
    ]
  };
  assert.ok(
    validateCompositionPlanV3(darkStack, built, { hasLocationSection: true }).length > 0,
    "A brand/dark cta_band directly above contact must be rejected."
  );
  const sections = [{ id: "hero" }, ...built.map(({ id }) => ({ id })), { id: "contact" }];
  const applied = applyCompositionPlanV3(sections, goodPlan);
  assert.equal(applied.sections[0]?.id, "hero", "Hero must stay first after plan application.");
  assert.equal(applied.sections[applied.sections.length - 1]?.id, "contact", "Contact must stay last after plan application.");
  assert.deepEqual(applied.dropped, ["facts"], "Unplanned middle sections drop with a record.");
  assert.equal(applied.sections[1]?.id, "gallery", "Planned order should lead the middle sections.");
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      artifactTypes: generatedSiteV3ArtifactTypes,
      fontPairings: generatedSiteV3FontPairings.length,
      recipes: initialSiteArtDirectionRecipesV3.map((recipe) => recipe.id)
    },
    null,
    2
  )}\n`
);

function qaBundleForVersion(business: BusinessProfile, site: SiteModel, version: SiteVersionV3): SiteBundle {
  return withBusinessBundleFields({
    businessProfile: business,
    siteModel: { ...site, versions: [version] },
    extensionModel: testExtensions,
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: business.siteId,
      sourceUrl: "https://contract.example",
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  });
}

function analyzedUploadedAutoBodyPhoto(id: string, alt: string): AssetReference {
  return {
    id,
    url: `/fixture-assets/${id}.jpg`,
    alt,
    source: "uploaded",
    rightsStatus: "preclaim_safe",
    width: 1600,
    height: 1000,
    analysisV1: {
      version: "asset-analysis-v1",
      source: "openai",
      model: "fixture",
      analyzedAt: "2026-06-22T00:00:00.000Z",
      imageKind: "storefront",
      focalPoint: "center",
      subjectPlacement: "centered",
      warnings: [],
      contentTags: ["auto-body", "storefront", "shop"],
      summary: `${alt} is a clear first-party auto-body shop photo suitable for hero or gallery use.`,
      limitations: []
    }
  };
}

function cleanGeneratedInspection(version: SiteVersionV3, qaRunId: string): RenderInspectionResult {
  return {
    target: "generated_site",
    siteId: version.id,
    versionId: version.id,
    qaRunId,
    sourceUrl: "https://contract.example/preview",
    finalUrl: "https://contract.example/preview",
    adapter: "playwright",
    capturedAt: "2026-06-02T00:00:00.000Z",
    screenshots: [],
    findings: [],
    metrics: {
      siteHeaderDetected: true,
      siteFooterDetected: true,
      bodyTextChars: 4000,
      sectionCount: version.pageComposition.pages[0]?.sections.length ?? 0,
      ctaCount: 2,
      telLinkCount: 1,
      imageCount: 1,
      loadedImageCount: 1,
      brokenImageCount: 0,
      aboveFoldCtaDetected: true,
      primaryHeroCtaDetected: true,
      primaryHeroCtaAboveFold: true,
      primaryMediaImageLoaded: true
    },
    metricsByViewport: {
      desktop: {
        viewport: { name: "desktop", width: 1280, height: 900 },
        siteHeaderDetected: true,
        siteFooterDetected: true,
        aboveFoldCtaDetected: true,
        telLinkCount: 1,
        imageCount: 1,
        loadedImageCount: 1,
        brokenImageCount: 0,
        sectionInspections: []
      }
    }
  };
}

function visualSectionsFor(version: SiteVersionV3) {
  return version.pageComposition.pages.flatMap((page) =>
    page.sections.map((section) => getVisualSectionV3(section.props)).filter((section): section is VisualSectionV3 => Boolean(section))
  );
}

function visualTemplatesFor(version: SiteVersionV3) {
  return visualSectionsFor(version).map((section) => section.templateId);
}

function visualSectionsForPage(version: SiteVersionV3, slug: string) {
  const page = version.pageComposition.pages.find((candidate) => candidate.slug === slug);
  return (page?.sections ?? [])
    .map((section) => getVisualSectionV3(section.props))
    .filter((section): section is VisualSectionV3 => Boolean(section));
}

function visualTemplatesForPage(version: SiteVersionV3, slug: string) {
  return visualSectionsForPage(version, slug).map((section) => section.templateId);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function collectPublicSectionStrings(props: Record<string, unknown>): string[] {
  const visualSection = getVisualSectionV3(props);
  if (!visualSection) return collectStrings(props);
  return collectPublicSlotStrings(visualSection.slots);
}

function collectPublicSlotStrings(value: unknown, key?: string): string[] {
  if (typeof value === "string") {
    if (key === "href" || key === "url" || key === "label" || key === "caption") return [];
    return [value];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectPublicSlotStrings(item));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([childKey, child]) => collectPublicSlotStrings(child, childKey));
  }
  return [];
}
