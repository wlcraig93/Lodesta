import { sha256, stableJson } from "../../packages/business-data";
import { siteIntentV2Schema, sitePublicBuildInputV1Schema } from "../../packages/site-contracts";
import { autoBodyContextModule } from "../../packages/vertical-context";

const createdAt = "2026-07-20T00:00:00.000Z";

export function buildSyntheticSiteInput() {
  const intentWithoutHash = {
    schemaVersion: "site-intent-v2" as const,
    id: "intent_synthetic_verification",
    siteId: "site_synthetic_verification",
    revision: 1,
    updatedAt: createdAt,
    audience: "Austin drivers seeking collision repair.",
    positioning: "Clear, local, repair-focused service.",
    voice: ["direct", "calm", "capable"],
    primaryConversion: "form" as const,
    pageRequirements: [{ id: "page_home", purpose: "home" as const, slug: "", title: "Home", required: true }],
    brandConstraints: { preferredColors: [], prohibitedColors: [], preserveLogo: true, notes: [] },
    enabledCapabilities: ["forms", "analytics", "maps", "disclosure"] as const,
    notes: []
  };
  const intent = siteIntentV2Schema.parse({
    ...intentWithoutHash,
    intentHash: sha256(stableJson(intentWithoutHash))
  });
  const publicFacts = [
    fact("business:name", "business_name", "Business name", "Northstar Collision Repair"),
    fact("fact_phone", "phone", "Phone", "(512) 555-0142"),
    fact("fact_address", "address", "Address", "1200 Main Street, Austin, TX 78701"),
    fact("fact_hours", "hours", "Hours", "Monday-Friday 8:00 AM-5:30 PM"),
    fact("fact_service_collision", "offering", "Service", "Collision Repair")
  ];
  const valueWithoutHash = {
    schemaVersion: "site-public-build-input-v1" as const,
    id: "input_synthetic_verification",
    siteId: "site_synthetic_verification",
    businessId: "business_synthetic_verification",
    createdAt,
    businessStateRevision: 1,
    siteIntentRevision: 1,
    verticalModule: autoBodyContextModule,
    business: {
      name: "Northstar Collision Repair",
      description: "Local collision and cosmetic vehicle repair.",
      contacts: { phone: "(512) 555-0142" },
      locations: [{
        id: "location_primary",
        label: "Main shop",
        street: "1200 Main Street",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        country: "US",
        hours: { "Monday-Friday": "8:00 AM-5:30 PM" },
        sourceFactIds: ["fact_address", "fact_hours"]
      }],
      serviceAreas: [],
      offerings: [{
        id: "offering_collision",
        catalogId: "collision_repair",
        name: "Collision Repair",
        status: "confirmed" as const,
        visibility: "public" as const,
        pageMode: "dedicated" as const,
        featured: true,
        sourceFactIds: ["fact_service_collision"],
        confirmedAt: createdAt
      }],
      proof: [],
      assets: [],
      links: []
    },
    publicFacts,
    intent,
    forms: [{
      schemaVersion: "form-definition-v2" as const,
      id: "form_estimate",
      siteId: "site_synthetic_verification",
      revision: 1,
      name: "Estimate request",
      status: "candidate_only" as const,
      fields: [
        { id: "name", label: "Name", type: "text" as const, required: true },
        { id: "phone", label: "Phone", type: "phone" as const, required: true },
        { id: "message", label: "What happened?", type: "textarea" as const, required: false }
      ],
      submitLabel: "Request an estimate",
      successMessage: "Thanks. The shop will follow up.",
      createdAt
    }],
    capabilityConfiguration: {
      formsEndpoint: "/api/forms/submit",
      analyticsEndpoint: "/api/analytics",
      mapsMode: "managed_directions" as const,
      trustedRuntimeSeries: "site-runtime-v1"
    },
    sourceSnapshotIds: ["source_owner"],
    assetRevisionIds: []
  };
  return sitePublicBuildInputV1Schema.parse({
    ...valueWithoutHash,
    inputHash: sha256(stableJson(valueWithoutHash))
  });
}

function fact(id: string, kind: "business_name" | "phone" | "address" | "hours" | "offering", label: string, value: string) {
  return {
    id,
    kind,
    label,
    value,
    source: {
      factId: id,
      sourceSnapshotId: "source_owner",
      observedAt: createdAt,
      confidence: 1,
      ownerConfirmed: true
    },
    publicEligible: true
  };
}
