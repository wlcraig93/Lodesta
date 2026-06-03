import type { Vertical } from "./models";
import { copyRefreshProducerV2, localBusinessCopyProducerV2 } from "./copy-local-business-marketing";

export type SkillPackV2 = {
  id: string;
  version: string;
  kind: "copy" | "business_context" | "strategy" | "design" | "brand" | "validator";
  description: string;
  resolver: {
    verticals?: Vertical[];
    sectionFamilies?: string[];
    explicitOnly?: boolean;
  };
  artifactTypes: string[];
};

export type SkillResolverContextV2 = {
  vertical: Vertical;
  sectionFamily?: string;
  explicitSkillIds?: string[];
};

export const localBusinessCopySkillPackV2: SkillPackV2 = {
  id: localBusinessCopyProducerV2.id,
  version: localBusinessCopyProducerV2.version,
  kind: "copy",
  description: "Writes source-grounded local-business marketing copy from section contracts and vertical playbooks.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"]
  },
  artifactTypes: ["copy_artifact"]
};

export const copyRefreshSkillPackV2: SkillPackV2 = {
  id: copyRefreshProducerV2.id,
  version: copyRefreshProducerV2.version,
  kind: "copy",
  description: "Audits existing V2 copy slots and proposes source-grounded slot-level copy diffs without regenerating the site.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services"],
    explicitOnly: true
  },
  artifactTypes: ["copy_artifact", "copy_diff"]
};

export const pageOpportunitiesSkillPackV2: SkillPackV2 = {
  id: "strategy.page-opportunities",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Recommends service, location, and FAQ pages from sourced services, service areas, and content depth signals.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services"],
    explicitOnly: true
  },
  artifactTypes: ["page_opportunity_report"]
};

export const verticalClassifierSkillPackV2: SkillPackV2 = {
  id: "strategy.vertical-classifier",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Records the selected vertical, confidence, and source evidence used by V2 planning.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["vertical_classification_report"]
};

export const conversionPathSkillPackV2: SkillPackV2 = {
  id: "strategy.conversion-path",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Records the primary conversion goal and action path selected for the generated site.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["conversion_path_report"]
};

export const informationArchitectureSkillPackV2: SkillPackV2 = {
  id: "strategy.information-architecture",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Records compiled page and section structure, layout diversity, and section roles.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["information_architecture_report"]
};

export const businessContextRefreshSkillPackV2: SkillPackV2 = {
  id: "business.context-refresh",
  version: "direct-module-v1",
  kind: "business_context",
  description: "Refreshes sourced business facts and reports material changes without mutating the live site.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["business_context_report"]
};

export const businessIdentityReconcileSkillPackV2: SkillPackV2 = {
  id: "business.identity-reconcile",
  version: "direct-module-v1",
  kind: "business_context",
  description: "Reconciles business name, phone, address, and hours from source-aware facts and managed profile values.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["identity_reconcile_report"]
};

export const businessServiceCatalogSkillPackV2: SkillPackV2 = {
  id: "business.service-catalog",
  version: "direct-module-v1",
  kind: "business_context",
  description: "Builds a source-backed service catalog with render-safety status and evidence fact ids.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["service_catalog_report"]
};

export const businessChangeImpactSkillPackV2: SkillPackV2 = {
  id: "business.change-impact",
  version: "direct-module-v1",
  kind: "business_context",
  description: "Maps business fact changes to affected compiled sections, copy slots, and review/update actions.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["change_impact_report"]
};

export const brandCueExtractionSkillPackV2: SkillPackV2 = {
  id: "brand.cue-extraction",
  version: "direct-module-v1",
  kind: "brand",
  description: "Extracts rights-safe brand cues from existing brand assessment, business facts, and asset references.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["brand_cue_report"]
};

export const brandDirectionSkillPackV2: SkillPackV2 = {
  id: "brand.direction",
  version: "direct-module-v1",
  kind: "brand",
  description: "Converts brand cues into review-only design direction and token hints without generating a public mark.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["brand_direction_report"]
};

export const brandMarkGenerationSkillPackV2: SkillPackV2 = {
  id: "brand.mark-generation",
  version: "gate-v1",
  kind: "brand",
  description: "Records that generated brand marks are blocked until product/legal approval defines similarity checks and public-use policy.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["brand_mark_generation_report"]
};

export const assetSelectionSkillPackV2: SkillPackV2 = {
  id: "asset.selection",
  version: "direct-module-v1",
  kind: "validator",
  description: "Selects rights-safe public media for site slots and records reference-only assets as non-renderable cues.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["asset_selection_report"]
};

export const seoMetadataSkillPackV2: SkillPackV2 = {
  id: "seo.metadata",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Audits compiled page SEO metadata for local context, canonical paths, and policy-safe proof usage.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["seo_metadata_report"]
};

export const localLandingPagesSkillPackV2: SkillPackV2 = {
  id: "seo.local-landing-pages",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Recommends source-backed service and location landing pages without generating thin unsupported pages.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["page_opportunity_report"]
};

export const claimsVerificationSkillPackV2: SkillPackV2 = {
  id: "claims.verification",
  version: "direct-module-v1",
  kind: "validator",
  description: "Verifies compiled copy against source-aware facts, sensitive-claim evidence, placeholders, and V2 claim-span expectations.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["claim_report"]
};

export const googlePlacesPolicySkillPackV2: SkillPackV2 = {
  id: "policy.google-places",
  version: "direct-module-v1",
  kind: "validator",
  description: "Audits Google Places usage for static rating/review leakage, place_id-only durable linking, and JSON-LD policy safety.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["policy_report"]
};

export const regulatedClaimsPolicySkillPackV2: SkillPackV2 = {
  id: "policy.regulated-claims",
  version: "direct-module-v1",
  kind: "validator",
  description: "Audits credential, insurance, pricing, warranty, emergency, and regulated claims for source-aware evidence.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["policy_report"]
};

export const performanceAuditSkillPackV2: SkillPackV2 = {
  id: "optimization.performance-audit",
  version: "direct-module-v1",
  kind: "validator",
  description: "Audits generated-site render inspection performance proxies and records field Web Vitals thresholds.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["performance_audit_report"]
};

export const socialProofSkillPackV2: SkillPackV2 = {
  id: "proof.social-proof",
  version: "direct-module-v1",
  kind: "validator",
  description: "Classifies proof signals into durable, live-only, reference-only, or blocked display policies without copying Google review content.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["social_proof_report"]
};

export const conversionInsightsSkillPackV2: SkillPackV2 = {
  id: "optimization.conversion-insights",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Reviews analytics signals and recommends conversion changes only when there is enough evidence.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["conversion_insights_report"]
};

export const localSeoRefreshSkillPackV2: SkillPackV2 = {
  id: "optimization.local-seo-refresh",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Audits local SEO context, service-page coverage, and hours-safe messaging for scheduled refreshes.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["local_seo_refresh_report"]
};

export const pageGapAnalysisSkillPackV2: SkillPackV2 = {
  id: "optimization.page-gap-analysis",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Finds durable service and service-area page gaps without creating thin unsupported pages.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["page_gap_analysis_report"]
};

export const experimentRecommendationsSkillPackV2: SkillPackV2 = {
  id: "optimization.experiment-recommendations",
  version: "direct-module-v1",
  kind: "strategy",
  description: "Recommends experiment actions from analytics baselines, active experiments, and adopted learnings.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["experiment_recommendation_report"]
};

export const siteSystemDesignSkillPackV2: SkillPackV2 = {
  id: "design.site-system",
  version: "direct-module-v1",
  kind: "design",
  description: "Audits site-specific design tokens for bounded typography, buttons, media, and color separation.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["design_section_audit_report"]
};

export const headerSystemDesignSkillPackV2: SkillPackV2 = {
  id: "design.header-system",
  version: "direct-module-v1",
  kind: "design",
  description: "Audits HeaderSystemV2 mode, mobile behavior, and hero pairing.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["design_section_audit_report"]
};

export const sectionCompositionDesignSkillPackV2: SkillPackV2 = {
  id: "design.section-composition",
  version: "direct-module-v1",
  kind: "design",
  description: "Audits section depth and layout diversity so generated pages do not feel thin or repetitive.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["design_section_audit_report"]
};

export const serviceMatrixSectionSkillPackV2: SkillPackV2 = {
  id: "section.service-matrix",
  version: "direct-module-v1",
  kind: "design",
  description: "Audits services.matrix depth, service evidence, and section provenance.",
  resolver: {
    verticals: ["auto_body", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["design_section_audit_report"]
};

export const proofReviewSectionSkillPackV2: SkillPackV2 = {
  id: "section.proof-review",
  version: "direct-module-v1",
  kind: "validator",
  description: "Audits proof section presence and policy-safe proof evidence without requiring filler proof sections.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["design_section_audit_report"]
};

export const contactLocationHoursSectionSkillPackV2: SkillPackV2 = {
  id: "section.contact-location-hours",
  version: "direct-module-v1",
  kind: "validator",
  description: "Audits contact, location, and hours handling, including call-to-confirm fallback when hours are missing.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["design_section_audit_report"]
};

export const visualQualityAuditSkillPackV2: SkillPackV2 = {
  id: "design.visual-quality-audit",
  version: "direct-module-v1",
  kind: "design",
  description: "Stores visual QA findings as an auditable V2 benchmark artifact for later review and regression checks.",
  resolver: {
    verticals: ["auto_body", "restaurant", "home_services", "general_local"],
    explicitOnly: true
  },
  artifactTypes: ["visual_benchmark"]
};

export const defaultSkillRegistryV2: SkillPackV2[] = [
  localBusinessCopySkillPackV2,
  copyRefreshSkillPackV2,
  pageOpportunitiesSkillPackV2,
  verticalClassifierSkillPackV2,
  conversionPathSkillPackV2,
  informationArchitectureSkillPackV2,
  businessContextRefreshSkillPackV2,
  businessIdentityReconcileSkillPackV2,
  businessServiceCatalogSkillPackV2,
  businessChangeImpactSkillPackV2,
  brandCueExtractionSkillPackV2,
  brandDirectionSkillPackV2,
  brandMarkGenerationSkillPackV2,
  assetSelectionSkillPackV2,
  seoMetadataSkillPackV2,
  localLandingPagesSkillPackV2,
  claimsVerificationSkillPackV2,
  googlePlacesPolicySkillPackV2,
  regulatedClaimsPolicySkillPackV2,
  performanceAuditSkillPackV2,
  socialProofSkillPackV2,
  conversionInsightsSkillPackV2,
  localSeoRefreshSkillPackV2,
  pageGapAnalysisSkillPackV2,
  experimentRecommendationsSkillPackV2,
  siteSystemDesignSkillPackV2,
  headerSystemDesignSkillPackV2,
  sectionCompositionDesignSkillPackV2,
  serviceMatrixSectionSkillPackV2,
  proofReviewSectionSkillPackV2,
  contactLocationHoursSectionSkillPackV2,
  visualQualityAuditSkillPackV2
];

export function resolveSkillPacksV2(input: {
  registry?: SkillPackV2[];
  context: SkillResolverContextV2;
}): SkillPackV2[] {
  const registry = input.registry ?? defaultSkillRegistryV2;
  const explicit = new Set(input.context.explicitSkillIds ?? []);
  const explicitMatches = registry.filter((skill) => explicit.has(skill.id));
  const verticalMatches = registry.filter(
    (skill) => !skill.resolver.explicitOnly && skill.resolver.verticals?.includes(input.context.vertical)
  );
  const sectionMatches = registry.filter(
    (skill) => !skill.resolver.explicitOnly && input.context.sectionFamily && skill.resolver.sectionFamilies?.includes(input.context.sectionFamily)
  );
  const genericMatches = registry.filter(
    (skill) => !skill.resolver.explicitOnly && !skill.resolver.verticals?.length && !skill.resolver.sectionFamilies?.length
  );

  return uniqueSkillPacks([
    ...explicitMatches,
    ...verticalMatches,
    ...sectionMatches,
    ...genericMatches
  ]);
}

function uniqueSkillPacks(skills: SkillPackV2[]) {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = `${skill.id}@${skill.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
