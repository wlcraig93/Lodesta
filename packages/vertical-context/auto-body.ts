import type { VerticalContextModule } from "@/packages/site-contracts";

export const autoBodyContextModule: VerticalContextModule = {
  schemaVersion: 1,
  id: "auto_body",
  version: "auto-body-v1",
  status: "active",
  aliases: ["collision repair", "body shop", "auto collision", "dent repair", "paint and body"],
  classificationSignals: [
    "Repairs collision damage, body panels, dents, automotive paint, or structural vehicle damage.",
    "May coordinate insurance estimates or claims but must not imply insurer affiliation or guaranteed coverage."
  ],
  terminology: {
    business: ["collision repair center", "body shop", "auto body shop"],
    customer: ["vehicle owner", "driver"],
    estimate: ["repair estimate", "damage assessment"],
    repair: ["collision repair", "body repair"]
  },
  offeringCatalog: [
    { id: "collision_repair", name: "Collision Repair", aliases: ["auto collision repair", "accident repair"], status: "active" },
    { id: "dent_repair", name: "Dent Repair", aliases: ["dent removal", "paintless dent repair", "pdr"], status: "active" },
    { id: "auto_paint", name: "Auto Paint", aliases: ["paint repair", "refinishing", "color matching"], status: "active" },
    { id: "bumper_repair", name: "Bumper Repair", aliases: ["bumper replacement"], status: "active" },
    { id: "frame_repair", name: "Frame Repair", aliases: ["frame straightening", "structural repair"], status: "active" },
    { id: "glass_repair", name: "Auto Glass", aliases: ["windshield replacement", "glass replacement"], status: "active" },
    { id: "hail_damage", name: "Hail Damage Repair", aliases: ["storm damage repair"], status: "active" },
    { id: "scratch_repair", name: "Scratch Repair", aliases: ["paint scratch repair"], status: "active" },
    { id: "restoration", name: "Vehicle Restoration", aliases: ["classic car restoration"], status: "active" }
  ],
  customerJourneys: [
    "A driver needs immediate guidance after a collision and wants to understand the estimate and repair process.",
    "A vehicle owner compares repair quality, communication, turnaround expectations, and available proof.",
    "A customer seeks a specific cosmetic or structural service and needs a direct way to request an estimate."
  ],
  conversionRecommendations: [
    "Make phone and estimate-request actions available without obscuring service and trust information.",
    "Explain the repair process using only confirmed business practices.",
    "Use location and hours near high-intent contact actions when those facts are eligible."
  ],
  proofCautions: [
    "Never imply insurer partnership, preferred-shop status, certification, warranty terms, or years in business without eligible proof.",
    "Testimonials must remain faithful to a retained source excerpt.",
    "Do not guarantee estimates, timelines, repair outcomes, coverage, or claim approval."
  ],
  contentOpportunities: [
    "Present confirmed services by customer need rather than as an undifferentiated list.",
    "Use eligible original shop, team, repair, and vehicle media to establish a specific visual identity.",
    "Explain what a customer can do next after collision damage without inventing operating procedures."
  ],
  faqOpportunities: [
    "How does an estimate request work?",
    "What types of collision or cosmetic damage are handled?",
    "Where is the shop and when is it open?"
  ],
  seoAeoOpportunities: [
    "Use confirmed offering and location names in descriptive page titles and headings.",
    "Give each dedicated service page a direct answer, supported detail, and clear next action.",
    "Emit platform-owned LocalBusiness and AutoRepair structured data only from eligible facts."
  ],
  structuredDataType: "AutoBodyShop",
  skillRef: "packages/vertical-context/auto-body.ts",
  evaluationRef: "docs/product-path-simplification-plan.md"
};
