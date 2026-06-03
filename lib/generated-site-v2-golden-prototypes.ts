import type { BusinessProfile, SiteBundle, SiteModel, SiteVersionV2, SourceAwareFactV2 } from "./models";
import {
  clearFlowHomeServicesBusinessV2,
  clearFlowHomeServicesFactsV2,
  createClearFlowHomeServicesV2FixtureVersion,
  createNorthLoopTacosV2FixtureVersion,
  createSuperBAutoBodyV2FixtureVersion,
  northLoopTacosBusinessV2,
  northLoopTacosFactsV2,
  superBAutoBodyBusinessV2,
  superBAutoBodyFactsV2
} from "./generated-site-v2-fixture";
import { compileGeneralLocalV2Site } from "./generated-site-v2-compiler";

export type GeneratedSiteV2GoldenPrototype = {
  id: string;
  label: string;
  benchmarkReferenceIds: string[];
  business: BusinessProfile;
  sourceFacts: SourceAwareFactV2[];
  version: SiteVersionV2;
  bundle: SiteBundle;
  expectations: {
    minHomepageSections: number;
    minDistinctFamilies: number;
    minDistinctVariants: number;
    minImages: number;
    minBodyTextChars: number;
    minCtas: number;
    minTelLinks: number;
    requiredFamilies: string[];
    requiredVariants: string[];
    requiredCopy: string[];
    forbiddenCopy: string[];
  };
};

const createdAt = "2026-06-01T00:00:00.000Z";

export function createGeneratedSiteV2GoldenPrototypes(): GeneratedSiteV2GoldenPrototype[] {
  const auto = createSuperBAutoBodyV2FixtureVersion().version;
  const restaurant = createNorthLoopTacosV2FixtureVersion().version;
  const homeServices = createClearFlowHomeServicesV2FixtureVersion().version;
  const professional = compileGeneralLocalV2Site({
    siteId: riveraLawGroupBusinessV2.siteId,
    business: riveraLawGroupBusinessV2,
    sourceFacts: riveraLawGroupFactsV2,
    createdAt
  }).version;
  const creative = compileGeneralLocalV2Site({
    siteId: framehouseStudioBusinessV2.siteId,
    business: framehouseStudioBusinessV2,
    sourceFacts: framehouseStudioFactsV2,
    createdAt
  }).version;

  return [
    goldenPrototype({
      id: "auto_service",
      label: "Auto-style service business",
      benchmarkReferenceIds: ["framer-small-business", "webflow-local-business", "duda-responsive-ai"],
      business: superBAutoBodyBusinessV2,
      sourceFacts: superBAutoBodyFactsV2,
      version: auto,
      requiredFamilies: ["hero.estimate_intake", "services.matrix", "media.service_gallery", "proof.trust_band", "contact.location_hours", "cta.final_band"],
      requiredVariants: ["editorial_split", "capability_showcase", "damage_intake_board"],
      requiredCopy: ["Collision repair", "PDR for smaller dents and hail repair", "Call or message"],
      minHomepageSections: 7,
      minImages: 3,
      minBodyTextChars: 1_000,
      minTelLinks: 2
    }),
    goldenPrototype({
      id: "restaurant_local",
      label: "Restaurant-style local business",
      benchmarkReferenceIds: ["squarespace-local-business", "framer-gallery", "apple-media-storytelling"],
      business: northLoopTacosBusinessV2,
      sourceFacts: northLoopTacosFactsV2,
      version: restaurant,
      requiredFamilies: ["hero.order_path", "menu.highlights", "media.service_gallery", "process.order_steps", "contact.location_hours", "cta.final_band"],
      requiredVariants: ["overlay_media", "editorial_grid", "editorial_media_triptych"],
      requiredCopy: ["Tacos", "Catering", "Start order"],
      minHomepageSections: 6,
      minImages: 3,
      minBodyTextChars: 850,
      minTelLinks: 2
    }),
    goldenPrototype({
      id: "home_service",
      label: "Home/local service business",
      benchmarkReferenceIds: ["webflow-local-business", "duda-responsive-ai", "stripe-hierarchy"],
      business: clearFlowHomeServicesBusinessV2,
      sourceFacts: clearFlowHomeServicesFactsV2,
      version: homeServices,
      requiredFamilies: ["hero.service_request", "services.matrix", "coverage.service_area", "media.service_gallery", "process.service_steps", "contact.location_hours", "cta.final_band"],
      requiredVariants: ["overlay_media", "feature_matrix", "coverage_band"],
      requiredCopy: ["Plumbing repairs", "Charlotte", "Call for service"],
      minHomepageSections: 7,
      minImages: 3,
      minBodyTextChars: 900,
      minTelLinks: 2
    }),
    goldenPrototype({
      id: "professional_general_local",
      label: "Professional service through general local",
      benchmarkReferenceIds: ["framer-small-business", "linear-restraint", "ramp-editorial-functional"],
      business: riveraLawGroupBusinessV2,
      sourceFacts: riveraLawGroupFactsV2,
      version: professional,
      requiredFamilies: ["hero.local_action", "services.matrix", "media.service_gallery", "coverage.service_area", "faq.local_questions", "contact.location_hours", "cta.final_band"],
      requiredVariants: ["editorial_split", "editorial_service_list", "editorial_media_triptych", "source_grounded_list"],
      requiredCopy: ["Estate planning", "Business counsel", "Austin"],
      minHomepageSections: 7,
      minImages: 2,
      minBodyTextChars: 850,
      minTelLinks: 2
    }),
    goldenPrototype({
      id: "creative_general_local",
      label: "Creative/local studio through general local",
      benchmarkReferenceIds: ["framer-gallery", "squarespace-local-business", "apple-media-storytelling"],
      business: framehouseStudioBusinessV2,
      sourceFacts: framehouseStudioFactsV2,
      version: creative,
      requiredFamilies: ["hero.local_action", "services.matrix", "media.service_gallery", "coverage.service_area", "faq.local_questions", "contact.location_hours", "cta.final_band"],
      requiredVariants: ["overlay_media", "featured_service_board", "editorial_media_triptych", "source_grounded_list"],
      requiredCopy: ["Portrait photography", "Commercial shoots", "Project inquiries"],
      minHomepageSections: 7,
      minImages: 2,
      minBodyTextChars: 850,
      minTelLinks: 2
    })
  ];
}

function goldenPrototype(input: {
  id: string;
  label: string;
  benchmarkReferenceIds: string[];
  business: BusinessProfile;
  sourceFacts: SourceAwareFactV2[];
  version: SiteVersionV2;
  requiredFamilies: string[];
  requiredVariants: string[];
  requiredCopy: string[];
  minHomepageSections: number;
  minImages: number;
  minBodyTextChars: number;
  minTelLinks: number;
}): GeneratedSiteV2GoldenPrototype {
  return {
    ...input,
    bundle: fixtureBundle(input.business, input.version),
    expectations: {
      minHomepageSections: input.minHomepageSections,
      minDistinctFamilies: 5,
      minDistinctVariants: 3,
      minImages: input.minImages,
      minBodyTextChars: input.minBodyTextChars,
      minCtas: 3,
      minTelLinks: input.minTelLinks,
      requiredFamilies: input.requiredFamilies,
      requiredVariants: input.requiredVariants,
      requiredCopy: input.requiredCopy,
      forbiddenCopy: [
        "source-backed",
        "profile details",
        "repair conversation",
        "estimate conversation",
        "starting point",
        "site source",
        "template",
        "use this service",
        "ask about",
        "planning need",
        "business matter type",
        "project type",
        "these general visuals",
        "customers should describe",
        "details and next steps",
        "Google profile",
        "Open live profile",
        "Call for current hours",
        "Location details to confirm before you visit",
        "Use the location details",
        "Helpful before reaching out",
        "timing and contact details",
        "Call or send a message with timing",
        "is listed for",
        "frame the first"
      ]
    }
  };
}

const riveraLawGroupBusinessV2: BusinessProfile = {
  id: "business_rivera_law_fixture",
  siteId: "sitegen_rivera_law_v2_fixture",
  name: "Rivera Law Group",
  vertical: "law_firm",
  categories: ["Law firm", "Estate planning attorney"],
  description: "Professional-service fixture for generated-site V2.",
  phone: "(555) 555-0133",
  address: {
    street: "420 West Ave",
    city: "Austin",
    region: "TX",
    postalCode: "78701",
    country: "US"
  },
  hours: {
    Monday: "9:00 AM - 5:00 PM",
    Tuesday: "9:00 AM - 5:00 PM",
    Wednesday: "9:00 AM - 5:00 PM"
  },
  services: ["Estate planning", "Probate guidance", "Business counsel", "Contract review"],
  serviceAreas: ["Austin", "Travis County"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: fixtureProvenanceMap("https://riveralaw.example")
};

const riveraLawGroupFactsV2 = factsForBusiness("rivera_law", riveraLawGroupBusinessV2, "https://riveralaw.example");

const framehouseStudioBusinessV2: BusinessProfile = {
  id: "business_framehouse_fixture",
  siteId: "sitegen_framehouse_v2_fixture",
  name: "Framehouse Studio",
  vertical: "creative_studio",
  categories: ["Photography studio", "Creative studio"],
  description: "Creative-service fixture for generated-site V2.",
  phone: "(555) 555-0177",
  address: {
    street: "88 East 6th St",
    city: "Austin",
    region: "TX",
    postalCode: "78701",
    country: "US"
  },
  hours: undefined,
  services: ["Portrait photography", "Commercial shoots", "Brand photography", "Project inquiries"],
  serviceAreas: ["Austin", "Central Texas"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: fixtureProvenanceMap("https://framehouse.example")
};

const framehouseStudioFactsV2 = factsForBusiness("framehouse", framehouseStudioBusinessV2, "https://framehouse.example");

function factsForBusiness(prefix: string, business: BusinessProfile, sourceUrl: string): SourceAwareFactV2[] {
  return [
    fact(`${prefix}_name`, "name", "Business name", business.name, sourceUrl),
    ...business.categories.map((category, index) => fact(`${prefix}_category_${index + 1}`, "category", "Category", category, sourceUrl)),
    fact(`${prefix}_phone`, "phone", "Phone", business.phone ?? "", sourceUrl),
    fact(`${prefix}_address`, "address", "Address", business.address ?? {}, sourceUrl),
    ...(business.hours ? [fact(`${prefix}_hours`, "hours", "Hours", business.hours, sourceUrl)] : []),
    ...business.services.map((service, index) => fact(`${prefix}_service_${index + 1}`, "service", "Service", service, sourceUrl)),
    ...business.serviceAreas.map((area, index) => fact(`${prefix}_area_${index + 1}`, "service_area", "Service area", area, sourceUrl))
  ];
}

function fact(
  id: string,
  kind: SourceAwareFactV2["kind"],
  label: string,
  value: SourceAwareFactV2["value"],
  sourceUrl: string
): SourceAwareFactV2 {
  return {
    id: `fact_${id}`,
    kind,
    label,
    value,
    sourceType: "crawl",
    sourceId: `${id}_fixture`,
    sourceUrl,
    observedAt: createdAt,
    confidence: 0.92,
    renderPolicy: "durable_render",
    sourcePolicy: "durable_render"
  };
}

function fixtureProvenanceMap(sourceUrl: string): BusinessProfile["provenance"] {
  return {
    name: fixtureProvenance(sourceUrl),
    phone: fixtureProvenance(sourceUrl),
    address: fixtureProvenance(sourceUrl),
    services: fixtureProvenance(sourceUrl),
    serviceAreas: fixtureProvenance(sourceUrl)
  };
}

function fixtureProvenance(sourceUrl: string) {
  return {
    source: "website" as const,
    sourceUrl,
    confidence: 0.92,
    verified: false,
    observedAt: createdAt
  };
}

function fixtureBundle(business: BusinessProfile, version: SiteVersionV2): SiteBundle {
  return {
    businessProfile: business,
    siteModel: fixtureSite(business, version),
    extensionModel: { forms: [], workflows: [], customBlocks: [] },
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: business.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function fixtureSite(business: BusinessProfile, version: SiteVersionV2): SiteModel {
  const design = version.siteDesignSystem;
  return {
    id: business.siteId,
    slug: `${business.siteId}-golden`,
    theme: {
      paletteName: design.recipeId,
      colors: {
        background: design.color.background,
        surface: design.color.surface,
        text: design.color.text,
        muted: design.color.muted,
        primary: design.color.primary,
        primaryText: design.color.primaryText,
        accent: design.color.accent,
        border: design.color.border
      },
      typography: {
        heading: design.typography.headingFamily,
        body: design.typography.bodyFamily
      },
      radius: design.cards.radius === "sharp" ? "none" : design.cards.radius === "rounded" ? "md" : "sm",
      density: design.rhythm.sectionSpacing === "compact" ? "compact" : design.rhythm.sectionSpacing === "spacious" ? "spacious" : "standard",
      mood: "editorial"
    },
    versions: [version],
    pinList: []
  };
}
