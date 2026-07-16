import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

import { createSiteV3FromInput } from "../lib/intake";
import { createDeterministicSiteDirectorPlanV1 } from "../lib/deterministic-site-director-plan-v1";
import type { BusinessUnderstandingV2 } from "../lib/models";
import type { SiteEvidenceLedgerV1 } from "../lib/evidence-ledger-v1";
import { mediaFloorVerdictV1 } from "../lib/media-floor-v1";

const snapshotPath = join(process.cwd(), "fixtures", "generated-site-v3", "deterministic-site-director-plan-v1.json");
const update = process.argv.includes("--update");

const fixtures = [
  {
    id: "auto_body_source_media",
    prompt:
      "Build a website for Mencia Auto Body & Paint, an auto body shop in Austin offering collision repair, paint refinishing, paintless dent repair, bumper repair, and auto glass. phone: 512-551-9434. address: 819 Houston St, Austin, TX 78756",
    identity: { siteId: "site_planner_auto_body" },
    understanding: understanding({
      vertical: "auto_body",
      primaryConversionGoal: "call_first",
      service: "Collision repair",
      mood: "bold",
      fontPosture: "condensed",
      voiceRegister: "direct",
      preferredHex: "#d91f33",
      businessStory: {
        summary: "A family-owned Austin body shop founded in 2018.",
        distinctives: ["Founded in 2018", "Family-owned"]
      }
    })
  },
  {
    id: "dental_brand_expression",
    prompt:
      "Build a website for North Loop Dental, a dental office in Austin offering preventive dentistry, cosmetic dentistry, and emergency dental care. phone: 512-555-0190. address: 210 North Loop Blvd, Austin, TX 78751",
    identity: { siteId: "site_planner_dental" },
    understanding: understanding({
      vertical: "dental",
      primaryConversionGoal: "booking_first",
      service: "Preventive Dentistry",
      mood: "premium",
      fontPosture: "premium",
      voiceRegister: "warm",
      preferredHex: "#176b88"
    })
  },
  {
    id: "restaurant_ordering",
    prompt:
      "Build a website for Violet Pizza, a neighborhood restaurant in Portland offering wood fired pizza, salads, and online ordering. phone: 503-555-0128. address: 54 SE Market St, Portland, OR 97214",
    identity: { siteId: "site_planner_restaurant" }
  },
  {
    id: "home_services_many_services",
    prompt:
      "Build a website for Atlas Home Services, a home services company in Round Rock offering plumbing repair, drain cleaning, water heaters, leak detection, fixture installation, repiping, sewer camera inspection, and emergency plumbing. phone: 512-555-0104. address: 100 Main St, Round Rock, TX 78664",
    identity: { siteId: "site_planner_home_services" }
  }
] as const;

const actual = stableJson(fixtures.map((fixture) => {
  const bundle = createSiteV3FromInput(fixture);
  const runtime = bundle.presenceAssessment.siteDirectorPlanV1;
  assert(runtime, `${fixture.id} should produce a SiteDirectorRuntimeV1.`);
  return {
    id: fixture.id,
    business: {
      vertical: bundle.businessProfile.vertical,
      services: bundle.businessProfile.services
    },
    runtime: {
      source: runtime.source,
      model: runtime.model,
      validation: runtime.validation.status,
      designSystem: runtime.designSystem
        ? {
            id: runtime.designSystem.id,
            label: runtime.designSystem.label,
            controls: runtime.designSystem.controls
          }
        : undefined,
      globalControls: runtime.plan.globalControls,
      nav: runtime.plan.nav,
      homeSections: runtime.plan.home.sections.map((section) => ({
        id: section.id,
        role: section.role,
        templateId: section.templateId,
        ctaRole: section.ctaRole,
        slotCounts: section.slotCounts,
        templateOptions: section.templateOptions
      })),
      servicePages: runtime.plan.servicePages
    }
  };
}));

verifyTestimonialCountBound();
verifySemanticServiceTemplateSelection();
verifyContextMediaStoryPlacement();
verifyVehicleBadgeWarningNormalization();

if (update) {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
  process.stdout.write(`Updated ${snapshotPath}\n`);
} else {
  const expected = JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown;
  assert.deepEqual(actual, expected);
  process.stdout.write(`Deterministic planner snapshot matched ${actual.length} fixture(s).\n`);
}

function understanding(input: {
  vertical: BusinessUnderstandingV2["vertical"];
  primaryConversionGoal: BusinessUnderstandingV2["primaryConversionGoal"];
  service: string;
  mood: NonNullable<BusinessUnderstandingV2["brandExpression"]>["mood"];
  fontPosture: NonNullable<BusinessUnderstandingV2["brandExpression"]>["fontPosture"];
  voiceRegister: NonNullable<BusinessUnderstandingV2["brandExpression"]>["voiceRegister"];
  preferredHex: string;
  businessStory?: BusinessUnderstandingV2["businessStory"];
}): BusinessUnderstandingV2 {
  return {
    version: "business-understanding-v2",
    source: "deterministic_fallback",
    vertical: input.vertical,
    verticalConfidence: 1,
    detectedSubverticals: [],
    cleanedServices: [{ name: input.service, sourceText: input.service, confidence: 1 }],
    primaryConversionGoal: input.primaryConversionGoal,
    urgentServiceSignals: [],
    businessStory: input.businessStory,
    factConfidence: [],
    notes: [],
    brandExpression: {
      version: "brand-expression-v1",
      mood: input.mood,
      fontPosture: input.fontPosture,
      voiceRegister: input.voiceRegister,
      paletteSeed: {
        strategy: "category_default",
        preferredHex: input.preferredHex,
        candidateRank: 0
      },
      rationale: "Planner snapshot fixture."
    }
  };
}

function verifyTestimonialCountBound() {
  const bundle = createSiteV3FromInput(fixtures[0]);
  const createdAt = "2026-07-15T00:00:00.000Z";
  const testimonials: SiteEvidenceLedgerV1["items"] = Array.from({ length: 4 }, (_, index) => ({
    id: `evidence_testimonial_${index + 1}`,
    domain: "business_proof",
    kind: "testimonial",
    label: `Customer ${index + 1}`,
    value: { text: `Exact customer comment ${index + 1}.`, quote: `Exact customer comment ${index + 1}.`, attribution: `Customer ${index + 1}` },
    source: {
      type: "website_visible_text",
      url: `https://example.test/reviews/${index + 1}`,
      pageTitle: "Customer Reviews",
      extractionMethod: "fixture",
      snippet: `Exact customer comment ${index + 1}.`
    },
    confidence: 1,
    renderPolicy: "durable_render",
    verification: "source_backed",
    observedAt: createdAt,
    sourceHash: `source_hash_${index + 1}`
  }));
  bundle.presenceAssessment.evidenceLedgerV1 = {
    version: "site-evidence-ledger-v1",
    producerId: "compose-site-evidence-ledger-v1",
    producerVersion: "site-evidence-ledger-v1",
    modelId: "deterministic",
    siteId: bundle.businessProfile.siteId,
    createdAt,
    stale: false,
    inputHashes: {},
    items: testimonials,
    summary: {
      businessProofItems: testimonials.length,
      brandItems: 0,
      durableRenderItems: testimonials.length,
      liveOnlyItems: 0,
      ownerReviewItems: 0
    }
  };
  const runtime = createDeterministicSiteDirectorPlanV1({ bundle, createdAt });
  const testimonialSection = runtime.plan.home.sections.find((section) => section.id === "testimonials");
  assert.equal(testimonialSection?.slotCounts?.items, 3, "quote_wall planning must cap source-backed testimonials at its three-card contract.");
  assert.equal(
    testimonialSection?.copyJob?.proofToUse,
    testimonials.slice(0, 3).map((item) => item.id).join(", "),
    "The testimonial copy job must reference only the evidence selected for rendering."
  );
}

function verifySemanticServiceTemplateSelection() {
  const bundle = createSiteV3FromInput(fixtures[0]);
  bundle.businessProfile.services = [
    "Auto Body Repair",
    "Collision Repair and Accident Restoration",
    "Scratch, Ding and Dent Repair",
    "Paintless Dent and Hail Damage Repair",
    "Frame Straightening",
    "Body Panel Replacement"
  ];
  const runtime = createDeterministicSiteDirectorPlanV1({ bundle, createdAt: "2026-07-15T00:00:00.000Z" });
  const servicesSection = runtime.plan.home.sections.find((section) => section.id === "services");
  assert.equal(servicesSection?.templateId, "side_intro_rows", "Six raw services that resolve to three customer-facing groups should use the compact service template.");
  assert.equal(servicesSection?.slotCounts?.items, 3, "Service blueprint counts must describe the post-grouping catalog that will render.");
}

function verifyContextMediaStoryPlacement() {
  const bundle = createSiteV3FromInput(fixtures[0]);
  bundle.businessProfile.photos = [
    {
      id: "hero_vehicle",
      url: "https://example.test/hero-vehicle.jpg",
      alt: "Vehicle in the body shop",
      source: "website_reference",
      rightsStatus: "reference_only",
      width: 1200,
      height: 760,
      analysisV1: {
        version: "asset-analysis-v1",
        source: "openai",
        model: "fixture",
        analyzedAt: "2026-07-15T00:00:00.000Z",
        imageKind: "vehicle",
        focalPoint: "center",
        subjectPlacement: "full_frame",
        warnings: ["rights_review_required"],
        contentTags: ["vehicle", "body_shop", "finished_vehicle"],
        summary: "A finished vehicle inside an auto body shop.",
        limitations: []
      }
    },
    {
      id: "inspection_context",
      url: "https://example.test/inspection-context.jpg",
      alt: "Shop team inspecting a vehicle",
      source: "website_reference",
      rightsStatus: "reference_only",
      width: 1000,
      height: 640,
      analysisV1: {
        version: "asset-analysis-v1",
        source: "openai",
        model: "fixture",
        analyzedAt: "2026-07-15T00:00:00.000Z",
        imageKind: "vehicle",
        focalPoint: "center",
        subjectPlacement: "full_frame",
        warnings: ["rights_review_required"],
        contentTags: ["vehicle", "workshop", "inspection", "people"],
        summary: "Two people inspecting a vehicle in a workshop.",
        limitations: []
      }
    }
  ];
  const runtime = createDeterministicSiteDirectorPlanV1({ bundle, createdAt: "2026-07-15T00:00:00.000Z" });
  const aboutSection = runtime.plan.home.sections.find((section) => section.id === "about");
  assert.equal(aboutSection?.templateId, "split_media", "A distinct context-eligible source image should turn the business story into a split-media section.");
  assert.equal(aboutSection?.assetRefs?.[0]?.assetId, "inspection_context", "The story section must use a distinct non-hero context asset.");
  assert.equal(
    runtime.plannerInputManifest.mediaCandidates?.find((asset) => asset.id === "inspection_context")?.proofEligible,
    false,
    "Context story media must not be promoted to repair proof."
  );
}

function verifyVehicleBadgeWarningNormalization() {
  const baseAsset = {
    id: "vehicle_with_badge",
    url: "https://example.test/vehicle.jpg",
    alt: "Vehicle in a workshop",
    source: "website_reference" as const,
    rightsStatus: "reference_only" as const,
    width: 1200,
    height: 760,
    analysisV1: {
      version: "asset-analysis-v1" as const,
      source: "openai" as const,
      model: "fixture",
      analyzedAt: "2026-07-15T00:00:00.000Z",
      imageKind: "vehicle" as const,
      focalPoint: "center" as const,
      subjectPlacement: "full_frame" as const,
      warnings: ["logo_like" as const, "text_overlay" as const],
      contentTags: ["vehicle", "manufacturer_badge", "license_plate"],
      summary: "A clean vehicle in a workshop with a manufacturer badge and license plate visible.",
      limitations: []
    }
  };
  const cleanVerdict = mediaFloorVerdictV1(baseAsset, { vertical: "auto_body" });
  assert.equal(cleanVerdict.hero.allowed, true, "A visible vehicle badge or license plate must not make clean source photography logo-like.");
  const overlayVerdict = mediaFloorVerdictV1(
    {
      ...baseAsset,
      id: "vehicle_with_dominant_overlay",
      analysisV1: {
        ...baseAsset.analysisV1,
        contentTags: ["vehicle", "large_graphic_overlay", "wordmark"],
        summary: "A heavy logo and text overlay obscures the vehicle."
      }
    },
    { vertical: "auto_body" }
  );
  assert.equal(overlayVerdict.hero.allowed, false, "A dominant logo/text overlay must remain below the auto-body media floor.");
}

function stableJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
