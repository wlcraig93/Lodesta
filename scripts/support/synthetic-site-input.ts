import { sha256, stableJson } from "../../packages/business-data";
import { siteIntentSchema, sitePublicBuildInputSchema } from "../../packages/site-contracts";

const createdAt = "2026-07-20T00:00:00.000Z";

export function buildSyntheticSiteInput(runtimeSeriesId = "site-runtime-v4") {
  const intentWithoutHash = {
    schemaVersion: 1 as const,
    id: "intent_synthetic_verification",
    siteId: "site_synthetic_verification",
    revision: 1,
    ownerIntentRevision: 1,
    updatedAt: createdAt,
    audience: "Austin drivers seeking collision repair.",
    positioning: "Clear, local, repair-focused service.",
    voice: ["direct", "calm", "capable"],
    primaryConversion: "form" as const,
    pageRequirements: [{ id: "page_home", purpose: "home" as const, slug: "", title: "Home", required: true }],
    brandConstraints: { preferredColors: [], prohibitedColors: [], preserveLogo: true, notes: [] },
    enabledCapabilities: ["forms", "analytics", "maps", "disclosure"] as const,
    agentAccessPolicy: {
      search: "allow" as const,
      aiInput: "allow" as const,
      aiTrain: "disallow" as const,
      trainingPermission: { status: "not_granted" as const }
    },
    notes: []
  };
  const intent = siteIntentSchema.parse({
    ...intentWithoutHash,
    intentHash: sha256(stableJson(intentWithoutHash))
  });
  const publicFacts = [
    fact("business:name", "business_name", "Business name", "Northstar Collision Repair"),
    fact("fact_phone", "phone", "Phone", "+15125550142"),
    fact("fact_address", "address", "Address", "1200 Main Street, Austin, TX 78701"),
    fact("fact_hours", "hours", "Hours", { Monday: "8:00 AM-5:30 PM", Tuesday: "8:00 AM-5:30 PM", Wednesday: "8:00 AM-5:30 PM", Thursday: "8:00 AM-5:30 PM", Friday: "8:00 AM-5:30 PM", Saturday: "Closed", Sunday: "Closed" }),
    fact("fact_service_collision", "offering", "Service", "Collision Repair")
  ];
  const valueWithoutHash = {
    schemaVersion: 1 as const,
    id: "input_synthetic_verification",
    siteId: "site_synthetic_verification",
    businessId: "business_synthetic_verification",
    createdAt,
    ownerOperationalRevision: 1,
    ownerIntentRevision: 1,
    business: {
      name: "Northstar Collision Repair",
      identityStatus: "verified" as const,
      description: "Local collision and cosmetic vehicle repair.",
      contacts: { phone: "+15125550142" },
      locations: [{
        id: "location_primary",
        label: "Business location",
        street: "1200 Main Street",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        country: "US",
        hours: { Monday: "8:00 AM-5:30 PM", Tuesday: "8:00 AM-5:30 PM", Wednesday: "8:00 AM-5:30 PM", Thursday: "8:00 AM-5:30 PM", Friday: "8:00 AM-5:30 PM", Saturday: "Closed", Sunday: "Closed" },
        sourceFactIds: ["fact_address", "fact_hours"]
      }],
      serviceAreas: [],
      offerings: [{
        id: "offering_collision",
        name: "Collision Repair",
        status: "confirmed" as const,
        visibility: "public" as const,
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
      schemaVersion: 1 as const,
      id: "form_estimate",
      siteId: "site_synthetic_verification",
      key: "estimate_request",
      revision: 1,
      name: "Estimate request",
      status: "candidate_only" as const,
      destination: "lead_inbox" as const,
      fields: [
        { id: "name", label: "Name", role: "contact_name" as const, type: "text" as const, required: true },
        { id: "phone", label: "Phone", role: "contact_phone" as const, type: "phone" as const, required: true },
        { id: "message", label: "What happened?", role: "message" as const, type: "textarea" as const, required: false }
      ],
      submitLabel: "Request an estimate",
      successMessage: "Thanks. The shop will follow up.",
      createdAt
    }],
    capabilityConfiguration: {
      formsEndpoint: "/api/forms/submit",
      analyticsEndpoint: "/api/analytics",
      mapsMode: "managed_directions" as const,
      trustedRuntimeSeries: runtimeSeriesId
    },
    sourceSnapshotIds: ["source_owner"],
    assetRevisionIds: []
  };
  return sitePublicBuildInputSchema.parse({
    ...valueWithoutHash,
    inputHash: sha256(stableJson(valueWithoutHash))
  });
}

function fact(id: string, kind: "business_name" | "phone" | "address" | "hours" | "offering", label: string, value: unknown) {
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
