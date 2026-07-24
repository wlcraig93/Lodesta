import type { VerticalContextModule } from "@/packages/site-contracts";

/**
 * A compact normalization and authoring aid, not an exhaustive plumbing
 * ontology. Source-backed specialty services remain valid even when they are
 * absent from this catalog.
 */
export const plumbingContextModule: VerticalContextModule = {
  schemaVersion: 1,
  id: "plumbing",
  version: "plumbing-context@2026-07-24",
  status: "active",
  aliases: [
    "plumber",
    "plumbing contractor",
    "plumbing company",
    "residential plumbing",
    "commercial plumbing"
  ],
  classificationSignals: [
    "Installs, repairs, or maintains water, drain, sewer, fixture, or plumbing systems.",
    "May offer emergency response, but availability, response times, licenses, and guarantees require direct source evidence."
  ],
  terminology: {
    business: ["plumber", "plumbing company", "plumbing contractor"],
    customer: ["homeowner", "property owner", "business owner"],
    appointment: ["service call", "plumbing appointment"],
    estimate: ["plumbing estimate", "service estimate"],
    emergency: ["emergency plumbing", "urgent plumbing help"]
  },
  offeringCatalog: [
    { id: "emergency_plumbing", name: "Emergency Plumbing", aliases: ["24 hour plumber", "24/7 plumbing", "emergency plumber", "urgent plumbing repair"], status: "active" },
    { id: "drain_cleaning", name: "Drain Cleaning", aliases: ["clogged drain", "drain clearing", "unclog drain"], status: "active" },
    { id: "sewer_service", name: "Sewer Line Service", aliases: ["sewer cleaning", "sewer repair", "sewer line repair", "sewer replacement"], status: "active" },
    { id: "water_heater", name: "Water Heater Service", aliases: ["water heater repair", "water heater installation", "hot water heater", "tankless water heater"], status: "active" },
    { id: "leak_repair", name: "Leak Detection & Repair", aliases: ["leak detection", "water leak repair", "pipe leak", "slab leak"], status: "active" },
    { id: "pipe_service", name: "Pipe Repair & Repiping", aliases: ["pipe repair", "repiping", "repipe", "burst pipe"], status: "active" },
    { id: "toilet_service", name: "Toilet Repair & Installation", aliases: ["toilet repair", "toilet installation", "clogged toilet"], status: "active" },
    { id: "fixture_service", name: "Faucet & Fixture Service", aliases: ["faucet repair", "fixture installation", "sink repair", "shower repair"], status: "active" },
    { id: "garbage_disposal", name: "Garbage Disposal Service", aliases: ["garbage disposal repair", "garbage disposal installation"], status: "active" },
    { id: "gas_line", name: "Gas Line Service", aliases: ["gas line repair", "gas line installation", "gas leak"], status: "active" }
  ],
  customerJourneys: [
    "A customer with an urgent leak, clog, loss of hot water, or other active problem needs a fast, visible contact path and verified availability.",
    "A customer comparing plumbers wants to confirm service fit, location coverage, hours, and credible proof before calling.",
    "A customer planning an installation or replacement wants clear scope, options, and an easy estimate request without unsupported pricing or timeline promises."
  ],
  conversionRecommendations: [
    "Keep a visible call or request-service action near the primary value proposition and service detail.",
    "Place verified hours and service coverage near high-intent contact actions.",
    "Explain the next step using only confirmed business practices; do not invent dispatch, diagnostic, pricing, or response-time policies."
  ],
  proofCautions: [
    "Never claim licensing, insurance, bonding, certifications, warranties, response times, upfront pricing, or years in business without eligible proof.",
    "Treat 24-hour or emergency availability as a factual operating claim that requires direct evidence.",
    "Do not imply that generated workers, vehicles, equipment, or completed jobs belong to the business."
  ],
  contentOpportunities: [
    "Organize confirmed services around distinct customer problems instead of search-keyword variants.",
    "Explain service scope, common customer situations, and the verified next step on dedicated pages.",
    "Surface verified service areas, hours, and emergency availability where they materially answer customer intent."
  ],
  faqOpportunities: [
    "Is emergency plumbing help available?",
    "What plumbing services are offered?",
    "Which locations are served and when is the business open?"
  ],
  seoAeoOpportunities: [
    "Use the confirmed business name, locality, and distinct service intent in descriptive page titles.",
    "Prefer a small set of substantive service pages over near-duplicate city or keyword pages.",
    "Emit platform-owned LocalBusiness and Plumber structured data only from eligible facts."
  ],
  structuredDataType: "Plumber",
  skillRef: "packages/vertical-context/plumbing.ts",
  evaluationRef: "docs/local-business-cro-research-playbook.md"
};
