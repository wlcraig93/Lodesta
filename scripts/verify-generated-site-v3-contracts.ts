import assert from "node:assert/strict";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import {
  defaultGeneratedSiteV3Mode,
  generatedSiteV3ArtifactTypes,
  generatedSiteV3FontPairings,
  getGeneratedSiteV3Mode,
  initialSiteArtDirectionRecipesV3,
  isGeneratedSiteV3Allowed
} from "../lib/generated-site-v3";
import { maybeApplyGeneratedSiteV3 } from "../lib/generated-site-v3-pipeline";
import { compileVisualSectionV3, getVisualSectionV3, type VisualSectionV3 } from "../lib/generated-site-v3-visual-controls";
import { withBusinessBundleFields } from "../lib/business-model";
import { localRepository } from "../lib/repository";
import { generateSite } from "../lib/site-candidate-service";
import type { BusinessProfile, ExtensionModel, SiteBundle, SiteModel, SiteVersionV3, Theme } from "../lib/models";

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

assert.equal(defaultGeneratedSiteV3Mode, "all_new_generations");
assert.equal(getGeneratedSiteV3Mode({ GENERATED_SITE_V3_MODE: "bad" } as unknown as NodeJS.ProcessEnv), "all_new_generations");
assert.equal(getGeneratedSiteV3Mode({} as NodeJS.ProcessEnv), "all_new_generations");
assert.equal(getGeneratedSiteV3Mode({ GENERATED_SITE_V3_MODE: "off" } as unknown as NodeJS.ProcessEnv), "off");
assert.equal(getGeneratedSiteV3Mode({ GENERATED_SITE_V3_MODE: "operator_allowlist" } as unknown as NodeJS.ProcessEnv), "operator_allowlist");

assert.equal(isGeneratedSiteV3Allowed({ mode: "off", fixture: true }), false);
assert.equal(isGeneratedSiteV3Allowed({ mode: "fixture_only", fixture: true }), true);
assert.equal(isGeneratedSiteV3Allowed({ mode: "fixture_only" }), false);
assert.equal(
  isGeneratedSiteV3Allowed({
    mode: "operator_allowlist",
    explicitOperatorRequest: true,
    sourceHost: "superb.example",
    allowlistHosts: ["superb.example"]
  }),
  true
);
assert.equal(
  isGeneratedSiteV3Allowed({
    mode: "operator_allowlist",
    explicitOperatorRequest: true,
    sourceHost: "missing.example",
    allowlistHosts: ["superb.example"]
  }),
  false
);
assert.equal(
  isGeneratedSiteV3Allowed({
    mode: "operator_allowlist",
    sourceHost: "superb.example",
    allowlistHosts: ["superb.example"]
  }),
  false
);
assert.equal(isGeneratedSiteV3Allowed({ mode: "all_new_generations", env: {} as NodeJS.ProcessEnv }), true);

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
assert.equal(visualTemplatesFor(testVersion).includes("location_panel"), true, "Physical-location businesses should render location_panel.");
assert.ok(
  visualTemplatesFor(testVersion).indexOf("location_panel") < visualTemplatesFor(testVersion).indexOf("contact_split"),
  "location_panel should compile immediately before the contact close."
);
const locationPanel = visualSectionsFor(testVersion).find((section) => section.templateId === "location_panel");
assert.ok(locationPanel, "Compiled V3 page should include a location_panel.");
assert.equal(locationPanel.slots.locations.locations[0]?.directionsUrl?.startsWith("https://www.google.com/maps/dir/?"), true, "Physical locations should get a Google Maps directions URL.");
assert.equal(locationPanel.slots.locations.locations[0]?.mapEmbedIntent?.kind, "address", "Physical address locations should persist a keyless map embed intent.");
const contactPanel = visualSectionsFor(testVersion).find((section) => section.templateId === "contact_split");
assert.ok(contactPanel?.templateId === "contact_split", "Compiled V3 page should include a contact_split.");
assert.equal(contactPanel.slots.contact.facts.some((fact) => fact.label === "Address" || fact.label === "Hours"), false, "contact_split should slim address/hours facts when location_panel is present.");
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
assert.equal(visualTemplatesFor(sparseContact.version).includes("location_panel"), false, "No-location businesses should omit location_panel.");
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
const serviceAreaLocation = visualSectionsFor(serviceAreaOnly.version).find((section) => section.templateId === "location_panel");
assert.ok(serviceAreaLocation?.templateId === "location_panel", "Service-area-only businesses should render a coverage-oriented location_panel.");
assert.equal(serviceAreaLocation.slots.locations.locations[0]?.directionsUrl, undefined, "Service-area-only locations should not get directions URLs.");
assert.equal(serviceAreaLocation.slots.locations.locations[0]?.mapEmbedIntent, undefined, "Service-area-only locations should not get map embed intents.");

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
const placeOnlyLocation = visualSectionsFor(placeIdOnly.version).find((section) => section.templateId === "location_panel");
assert.equal(placeOnlyLocation?.templateId, "location_panel", "Place-ID-only canonical locations may render as location records.");
assert.equal(placeOnlyLocation.slots.locations.locations[0]?.directionsUrl, undefined, "Place ID alone should not imply a physical directions target.");
assert.equal(placeOnlyLocation.slots.locations.locations[0]?.addressLine, undefined, "Place ID alone should not imply first-party address display.");

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

const previousMode = process.env.GENERATED_SITE_V3_MODE;
const previousAllowlist = process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS;
try {
  process.env.GENERATED_SITE_V3_MODE = "fixture_only";
  assert.equal(maybeApplyGeneratedSiteV3({ bundle: createTestBundle(), sourceHost: "contract.example" }).applied, false, "Fixture-only mode should still fail closed for non-fixture generations.");

  process.env.GENERATED_SITE_V3_MODE = "operator_allowlist";
  process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS = "contract.example";
  const allowlistBundle = createTestBundle();
  const allowlisted = maybeApplyGeneratedSiteV3({
    bundle: allowlistBundle,
    sourceHost: "contract.example",
    explicitOperatorRequest: true,
    now: "2026-06-02T00:00:00.000Z"
  });
  assert.equal(allowlisted.applied, true, "Explicit allowlisted operator request should apply V3.");
  assert.equal(allowlistBundle.siteModel.versions[0]?.rendererVersion, "layout-v3", "V3 application should replace the selected draft with layout-v3.");
} finally {
  if (previousMode === undefined) delete process.env.GENERATED_SITE_V3_MODE;
  else process.env.GENERATED_SITE_V3_MODE = previousMode;
  if (previousAllowlist === undefined) delete process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS;
  else process.env.GENERATED_SITE_V3_ALLOWLIST_HOSTS = previousAllowlist;
}

const defaultBundle = createTestBundle();
const applied = maybeApplyGeneratedSiteV3({
  bundle: defaultBundle,
  sourceHost: "contract.example",
  now: "2026-06-02T00:00:00.000Z"
});
assert.equal(applied.applied, true, "V3 application should be the default generated-site path.");
assert.equal(defaultBundle.siteModel.versions[0]?.rendererVersion, "layout-v3", "Default V3 application should replace the selected draft with layout-v3.");

const previousModeForFullGeneration = process.env.GENERATED_SITE_V3_MODE;
try {
  delete process.env.GENERATED_SITE_V3_MODE;
  const generated = await generateSite({
    repository: localRepository,
    input: {
      prompt:
        "Create a website for Contract Collision, an auto body shop in Austin. Services: collision repair, paint refinishing, bumper repair, paintless dent repair, hail repair, auto glass. Phone: (512) 555-0100. Address: 100 Test Road, Austin, TX 78702."
    },
    source: "admin_console",
    metadata: { generatedSiteV3: true }
  });
  const generatedVersion = generated.bundle.siteModel.versions[0];
  assert.equal(generatedVersion?.rendererVersion, "layout-v3", "Canonical generateSite path should emit layout-v3 when V3 is explicitly enabled.");
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
} finally {
  if (previousModeForFullGeneration === undefined) delete process.env.GENERATED_SITE_V3_MODE;
  else process.env.GENERATED_SITE_V3_MODE = previousModeForFullGeneration;
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      modeDefault: defaultGeneratedSiteV3Mode,
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
