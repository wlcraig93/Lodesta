import type { VerticalContextModuleV1 } from "@/packages/site-contracts";

export const syntheticContextModule: VerticalContextModuleV1 = {
  schemaVersion: "vertical-context-module-v1",
  id: "synthetic_test_vertical",
  version: "synthetic-v1",
  status: "test_only",
  aliases: ["synthetic test module"],
  classificationSignals: ["Appears only in architecture tests."],
  terminology: { business: ["test business"] },
  offeringCatalog: [{ id: "synthetic_service", name: "Synthetic Service", aliases: [], status: "active" }],
  customerJourneys: ["Complete a test inquiry."],
  conversionRecommendations: ["Expose a test action."],
  proofCautions: ["Use only synthetic test evidence."],
  contentOpportunities: ["Exercise module context without generation branching."],
  faqOpportunities: ["Is this a test?"],
  seoAeoOpportunities: ["Remain noindex."],
  structuredDataType: "LocalBusiness",
  skillRef: "packages/vertical-context/synthetic.ts",
  evaluationRef: "scripts/verify-agentic-site-platform.ts"
};
