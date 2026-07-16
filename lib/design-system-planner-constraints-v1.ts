import type { DesignSystemCatalogManifestV1, DesignSystemPlannerInputManifestV1 } from "./design-system-planner-manifest-v1";
import { serviceSemanticGroupForProfileV1, type GeneratedSiteVerticalQualityProfileV1 } from "./generated-site-v3-quality-profiles";

export const designSystemPlannerConstraintManifestVersionV1 = "design-system-planner-constraints-v1" as const;
export const designSystemPlannerConstraintManifestClassIdsV1 = [
  "nav_targets",
  "media_asset_ids",
  "media_proof_eligibility",
  "media_allowed_uses",
  "template_options",
  "semantic_service_groups",
  "contrast_budget"
] as const;

export type DesignSystemPlannerConstraintManifestClassIdV1 = typeof designSystemPlannerConstraintManifestClassIdsV1[number];

export type DesignSystemPlannerConstraintManifestV1 = {
  version: typeof designSystemPlannerConstraintManifestVersionV1;
  navTargets: string[];
  templateOptionsByTemplate: DesignSystemCatalogManifestV1["templateOptionsByTemplate"];
  mediaUseRules: {
    libraryProofAllowed: false;
    assetIds: string[];
    proofEligibleAssetIds: string[];
    allowedUsesByAssetId: Record<string, NonNullable<DesignSystemPlannerInputManifestV1["mediaCandidates"]>[number]["allowedUses"]>;
  };
  semanticServiceGroups: Array<{ id: string; title: string }>;
  contrastBudget: {
    minimumTextContrastRatio: 4.5;
    renderInspectionIsAuthority: true;
  };
};

export function buildDesignSystemPlannerConstraintManifestV1(input: {
  catalogManifest: DesignSystemCatalogManifestV1;
  plannerInputManifest: DesignSystemPlannerInputManifestV1;
  profile?: GeneratedSiteVerticalQualityProfileV1;
}): DesignSystemPlannerConstraintManifestV1 {
  const mediaCandidates = input.plannerInputManifest.mediaCandidates ?? [];
  const semanticGroups = input.profile
    ? input.plannerInputManifest.services
        .map((service) => serviceSemanticGroupForProfileV1(input.profile as GeneratedSiteVerticalQualityProfileV1, service.label))
        .filter((group): group is NonNullable<typeof group> => Boolean(group))
        .map((group) => ({ id: group.id, title: group.title }))
    : [];
  return {
    version: designSystemPlannerConstraintManifestVersionV1,
    navTargets: ["#hero", "#services", "#faq", "#location", "#contact", ...input.plannerInputManifest.services.map((service) => `service:${service.id}`)],
    templateOptionsByTemplate: input.catalogManifest.templateOptionsByTemplate,
    mediaUseRules: {
      libraryProofAllowed: false,
      assetIds: mediaCandidates.map((candidate) => candidate.id),
      proofEligibleAssetIds: mediaCandidates.filter((candidate) => candidate.proofEligible).map((candidate) => candidate.id),
      allowedUsesByAssetId: Object.fromEntries(mediaCandidates.map((candidate) => [candidate.id, candidate.allowedUses]))
    },
    semanticServiceGroups: Array.from(new Map(semanticGroups.map((group) => [group.id, group])).values()),
    contrastBudget: {
      minimumTextContrastRatio: 4.5,
      renderInspectionIsAuthority: true
    }
  };
}
