import type { BusinessProfile, SourceAwareFactV2 } from "./models";
import { compileAutoBodyV2Site, compileHomeServicesV2Site, compileRestaurantV2Site } from "./generated-site-v2-compiler";

export const superBAutoBodyBusinessV2: BusinessProfile = {
  id: "business_super_b_fixture",
  siteId: "sitegen_super_b_v2_fixture",
  name: "Super B Paint and Body",
  vertical: "auto_body",
  categories: ["Auto body shop", "Collision repair"],
  description: "Auto body repair fixture for generated-site V2.",
  phone: "(555) 123-4567",
  address: {
    street: "1 Main St",
    city: "Dallas",
    region: "TX",
    postalCode: "75201",
    country: "US"
  },
  hours: undefined,
  services: ["Collision repair", "Paint and body work", "Dent repair", "Repair estimates"],
  serviceHighlights: ["PDR for smaller dents and hail repair", "Automotive glass for windshields and windows"],
  serviceAreas: ["Dallas"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: {
    name: fixtureProvenance(),
    phone: fixtureProvenance(),
    address: fixtureProvenance(),
    services: fixtureProvenance()
  }
};

export const superBAutoBodyFactsV2: SourceAwareFactV2[] = [
  fact("fact_super_b_name", "name", "Business name", superBAutoBodyBusinessV2.name),
  ...superBAutoBodyBusinessV2.categories.map((category, index) =>
    fact(`fact_super_b_category_${index + 1}`, "category", "Category", category)
  ),
  fact("fact_super_b_phone", "phone", "Phone", superBAutoBodyBusinessV2.phone ?? ""),
  fact("fact_super_b_address", "address", "Address", superBAutoBodyBusinessV2.address ?? {}),
  ...superBAutoBodyBusinessV2.services.map((service, index) =>
    fact(`fact_super_b_service_${index + 1}`, "service", "Service", service)
  ),
  ...(superBAutoBodyBusinessV2.serviceHighlights ?? []).map((highlight, index) =>
    fact(`fact_super_b_highlight_${index + 1}`, "proof_signal", "Source-backed repair highlight", highlight)
  )
];

export const northLoopTacosBusinessV2: BusinessProfile = {
  id: "business_north_loop_tacos_fixture",
  siteId: "sitegen_north_loop_tacos_v2_fixture",
  name: "North Loop Tacos",
  vertical: "restaurant",
  categories: ["Taco restaurant", "Restaurant"],
  description: "Restaurant fixture for generated-site V2.",
  phone: "(555) 555-0102",
  address: {
    street: "22 North Loop Ave",
    city: "Austin",
    region: "TX",
    postalCode: "78751",
    country: "US"
  },
  hours: {
    Monday: "11:00 AM - 9:00 PM",
    Tuesday: "11:00 AM - 9:00 PM"
  },
  services: ["Tacos", "Catering", "Takeout"],
  serviceAreas: ["Austin"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: ["https://northlooptacos.example/order"],
  photos: [],
  pressLinks: [],
  provenance: {
    name: fixtureProvenance(),
    phone: fixtureProvenance(),
    address: fixtureProvenance(),
    services: fixtureProvenance()
  }
};

export const northLoopTacosFactsV2: SourceAwareFactV2[] = [
  fact("fact_nlt_name", "name", "Business name", northLoopTacosBusinessV2.name),
  ...northLoopTacosBusinessV2.categories.map((category, index) =>
    fact(`fact_nlt_category_${index + 1}`, "category", "Category", category)
  ),
  fact("fact_nlt_phone", "phone", "Phone", northLoopTacosBusinessV2.phone ?? ""),
  fact("fact_nlt_address", "address", "Address", northLoopTacosBusinessV2.address ?? {}),
  fact("fact_nlt_hours", "hours", "Hours", northLoopTacosBusinessV2.hours ?? {}),
  ...northLoopTacosBusinessV2.services.map((service, index) =>
    fact(`fact_nlt_service_${index + 1}`, "service", "Service", service)
  ),
  fact("fact_nlt_ordering", "ordering_link", "Ordering link", northLoopTacosBusinessV2.orderingLinks[0] ?? "")
];

export const clearFlowHomeServicesBusinessV2: BusinessProfile = {
  id: "business_clear_flow_fixture",
  siteId: "sitegen_clear_flow_v2_fixture",
  name: "Clear Flow Home Services",
  vertical: "home_services",
  categories: ["Plumber", "Home services"],
  description: "Home-services fixture for generated-site V2.",
  phone: "(555) 555-0144",
  address: {
    city: "Charlotte",
    region: "NC",
    country: "US"
  },
  hours: undefined,
  services: ["Plumbing repairs", "Drain cleaning", "Maintenance"],
  serviceAreas: ["Charlotte", "Huntersville", "Matthews"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: {
    name: fixtureProvenance(),
    phone: fixtureProvenance(),
    services: fixtureProvenance(),
    serviceAreas: fixtureProvenance()
  }
};

export const clearFlowHomeServicesFactsV2: SourceAwareFactV2[] = [
  fact("fact_clear_flow_name", "name", "Business name", clearFlowHomeServicesBusinessV2.name),
  ...clearFlowHomeServicesBusinessV2.categories.map((category, index) =>
    fact(`fact_clear_flow_category_${index + 1}`, "category", "Category", category)
  ),
  fact("fact_clear_flow_phone", "phone", "Phone", clearFlowHomeServicesBusinessV2.phone ?? ""),
  fact("fact_clear_flow_address", "address", "Address", clearFlowHomeServicesBusinessV2.address ?? {}),
  ...clearFlowHomeServicesBusinessV2.services.map((service, index) =>
    fact(`fact_clear_flow_service_${index + 1}`, "service", "Service", service)
  ),
  ...clearFlowHomeServicesBusinessV2.serviceAreas.map((area, index) =>
    fact(`fact_clear_flow_area_${index + 1}`, "service_area", "Service area", area)
  )
];

export function createSuperBAutoBodyV2FixtureVersion() {
  return compileAutoBodyV2Site({
    siteId: superBAutoBodyBusinessV2.siteId,
    business: superBAutoBodyBusinessV2,
    sourceFacts: superBAutoBodyFactsV2,
    createdAt: "2026-06-01T00:00:00.000Z"
  });
}

export function createNorthLoopTacosV2FixtureVersion() {
  return compileRestaurantV2Site({
    siteId: northLoopTacosBusinessV2.siteId,
    business: northLoopTacosBusinessV2,
    sourceFacts: northLoopTacosFactsV2,
    createdAt: "2026-06-01T00:00:00.000Z"
  });
}

export function createClearFlowHomeServicesV2FixtureVersion() {
  return compileHomeServicesV2Site({
    siteId: clearFlowHomeServicesBusinessV2.siteId,
    business: clearFlowHomeServicesBusinessV2,
    sourceFacts: clearFlowHomeServicesFactsV2,
    createdAt: "2026-06-01T00:00:00.000Z"
  });
}

function fact(
  id: SourceAwareFactV2["id"],
  kind: SourceAwareFactV2["kind"],
  label: SourceAwareFactV2["label"],
  value: SourceAwareFactV2["value"]
): SourceAwareFactV2 {
  return {
    id,
    kind,
    label,
    value,
    sourceType: "crawl",
    sourceId: "super_b_fixture",
    sourceUrl: "https://superb.example",
    observedAt: "2026-06-01T00:00:00.000Z",
    confidence: 0.92,
    renderPolicy: "durable_render",
    sourcePolicy: "durable_render"
  };
}

function fixtureProvenance() {
  return {
    source: "website" as const,
    sourceUrl: "https://superb.example",
    confidence: 0.92,
    verified: false,
    observedAt: "2026-06-01T00:00:00.000Z"
  };
}
