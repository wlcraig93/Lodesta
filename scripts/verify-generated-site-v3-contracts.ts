import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import {
  generatedSiteV3ArtifactTypes,
  generatedSiteV3FontPairings,
  initialSiteArtDirectionRecipesV3
} from "../lib/generated-site-v3";
import { applyGeneratedSiteV3 } from "../lib/generated-site-v3-pipeline";
import { compileVisualSectionV3, getVisualSectionV3, type VisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import { applyCompositionPlanV3, validateCompositionPlanV3 } from "../lib/generated-site-v3-composition-plan";
import { withBusinessBundleFields } from "../lib/business-model";
import { buildFactCoverageReport } from "../lib/fact-coverage";
import { localRepository } from "../lib/repository";
import { generateSite } from "../lib/site-candidate-service";
import { SiteRendererV3 } from "../lib/site-renderer-v3";
import type { BusinessProfile, ExtensionModel, GeneratedCopyDeckV2, SiteBundle, SiteModel, SiteVersionV3, Theme } from "../lib/models";

const forbiddenPublicV3Copy = [
  "template",
  "source fact",
  "source-backed",
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
// Hero family rotation: with safe media the seed selects hero_split or the
// full-bleed image hero_statement; both are valid leads.
const heroSection = testVersion.pageComposition.pages[0]?.sections[0];
assert.ok(
  heroSection?.variant === "hero_split" ||
    (heroSection?.variant === "hero_statement" && (heroSection.props?.visualSectionV3 as { options?: { background?: { kind?: string } } })?.options?.background?.kind === "image"),
  `Auto-body V3 compiler should lead with a media hero (split or full-bleed image); got ${heroSection?.variant}.`
);
assert.equal(testCompile.compositionReport.selectedRecipe, "auto_body_v1", "V3 compiler should expose the selected auto-body recipe in the internal composition report.");
assert.equal(testCompile.compositionReport.evidence.hasRealPricingEvidence, false, "Baseline auto-body fixture should not infer pricing evidence.");
assert.equal(testCompile.compositionReport.evidence.hasQuoteProof, false, "Baseline auto-body fixture should not infer testimonial evidence.");
assert.ok(testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "recipe" && decision.status === "included"), "Composition report should record recipe selection.");
assert.ok(
  testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "pricing_packages" && decision.status === "skipped"),
  "Composition report should record skipped pricing without pricing evidence."
);
assert.ok(
  testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "media_feature" && decision.status === "included"),
  "Curated three-image auto-body media should select media_feature."
);
assert.ok(
  testCompile.compositionReport.decisions.some((decision) => decision.sectionRole === "media_gallery" && decision.status === "skipped"),
  "Curated three-image auto-body media should not select media_mosaic."
);
const firstVisualSection = getVisualSectionV3(testVersion.pageComposition.pages[0]?.sections[0]?.props ?? {});
assert.ok(
  firstVisualSection?.templateId === "hero_split" ||
    (firstVisualSection?.templateId === "hero_statement" && (firstVisualSection.options?.background as { kind?: string } | undefined)?.kind === "image"),
  `Auto-body V3 compiler should emit a media-led hero (split or full-bleed image) when curated safe media is available; got ${firstVisualSection?.templateId}.`
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
assert.ok(
  visualTemplatesFor(testVersion).indexOf("location_showcase") < visualTemplatesFor(testVersion).indexOf("contact_split"),
  "location_showcase should compile immediately before the contact close."
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
assert.ok(
  visualSectionsFor(exactlyThreeServices.version).some((section) => section.templateId === "intro_grid" && (section.options.cardTreatment ?? "standard") === "standard"),
  "Exactly three service cards should render intro_grid with standard card treatment."
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

const testimonialEvidence = compileGeneratedSiteV3Site({
  siteId: "site_v3_testimonials",
  business: {
    ...testBusiness,
    id: "business_v3_testimonials",
    siteId: "site_v3_testimonials",
    pressLinks: [
      "testimonial: They explained the dent repair clearly - Customer review",
      "testimonial: The paint match looked clean - Customer review",
      "testimonial: Communication stayed simple - Customer review"
    ]
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
assert.equal(testimonialEvidence.compositionReport.evidence.hasQuoteProof, true, "Three testimonial strings should classify as quote proof.");
assert.equal(visualTemplatesFor(testimonialEvidence.version).includes("quote_wall"), true, "Testimonial evidence should render quote_wall.");

const fourMediaEvidence = compileGeneratedSiteV3Site({
  siteId: "site_v3_four_media",
  business: {
    ...testBusiness,
    id: "business_v3_four_media",
    siteId: "site_v3_four_media",
    photos: [0, 1, 2, 3].map((index) => ({
      id: `photo_${index}`,
      url: `/generated-site-assets/auto-body/bodywork-hero-v1.jpg?fixture=${index}`,
      alt: `Safe shop photo ${index + 1}`,
      source: "uploaded" as const,
      rightsStatus: "preclaim_safe" as const
    }))
  },
  createdAt: "2026-06-02T00:00:00.000Z"
});
assert.equal(fourMediaEvidence.compositionReport.evidence.safeMediaCount, 4, "Four safe media items should be counted before compilation.");
assert.equal(visualTemplatesFor(fourMediaEvidence.version).includes("media_mosaic"), true, "Four safe media items should select media_mosaic.");
assert.equal(visualTemplatesFor(fourMediaEvidence.version).includes("media_feature"), false, "Four safe media items should skip media_feature.");

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
        { url: "/generated-site-assets/auto-body/bodywork-hero-v1.jpg", label: "Safe shop photo 1" },
        { url: "/generated-site-assets/auto-body/bodywork-detail-v1.jpg", label: "Safe shop photo 2" }
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
assert.ok(showcaseFallbackHtml.includes("site-location-showcase-areas-v3"), "location_showcase should render the coverage/directions fallback when map embeds are unavailable.");
assert.equal(showcaseFallbackHtml.includes("Service area</span>"), false, "location_showcase should not render the old no-address Service area heading branch.");

const coverageReport = buildFactCoverageReport({ bundle: multiLocationBundle, version: multiLocation.version });
assert.ok(coverageReport.facts.some((fact) => fact.category === "address" && fact.note.includes("location_showcase")), "Fact coverage should resolve address to the new location templates.");
assert.ok(coverageReport.facts.some((fact) => fact.category === "service_areas" && fact.note.includes("service_area_showcase")), "Fact coverage should resolve service areas to the new service-area template.");
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
    source: "admin_console"
  });
  const generatedVersion = generated.bundle.siteModel.versions[0];
  assert.equal(generatedVersion?.rendererVersion, "layout-v3", "Canonical generateSite path should emit layout-v3.");
  assert.equal(
    generatedVersion?.generationQa?.blockers.filter((blocker) => blocker.id !== "render_browser_unavailable").length,
    0,
    JSON.stringify(generatedVersion?.generationQa?.blockers ?? [], null, 2)
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
    source: "model" as const,
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
