import { compileGeneratedSiteV3Site } from "./generated-site-v3-compiler";
import { approvedAssetLibraryAssetsForVerticals, type ApprovedAssetLibraryAsset } from "./asset-library";
import { withBusinessBundleFields } from "./business-model";
import { assertVisualSectionsForVersionV3 } from "./site-version-v3";
import { createDeterministicSiteDirectorPlanV1 } from "./deterministic-site-director-plan-v1";
import type { SiteBundle } from "./models";
import type { GeneratedSiteQualitySignalsV3 } from "./generated-site-v3-nav";

export type GeneratedSiteV3Application = {
  applied: boolean;
  reason: string;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
};

export function applyGeneratedSiteV3(input: {
  bundle: SiteBundle;
  now?: string;
  assetLibraryAssets?: ApprovedAssetLibraryAsset[];
}): GeneratedSiteV3Application {
  const hydratedBundle = withBusinessBundleFields(input.bundle);
  hydratedBundle.presenceAssessment.siteDirectorPlanV1 = createDeterministicSiteDirectorPlanV1({
    bundle: hydratedBundle,
    assetLibraryAssets: input.assetLibraryAssets ?? [],
    createdAt: input.now
  });
  const result = compileGeneratedSiteV3Site({
    bundle: hydratedBundle,
    createdAt: input.now,
    assetLibraryAssets: input.assetLibraryAssets ?? []
  });
  assertVisualSectionsForVersionV3(result.version);
  const previousDraftIndex = input.bundle.siteModel.versions.findIndex((version) => version.status === "draft");
  if (previousDraftIndex >= 0) input.bundle.siteModel.versions[previousDraftIndex] = result.version;
  else input.bundle.siteModel.versions.unshift(result.version);

  input.bundle.siteModel.theme = result.version.theme ?? input.bundle.siteModel.theme;
  input.bundle.presenceAssessment.brandCueReport = result.brandCueReport;
  input.bundle.presenceAssessment.technicalNotes.push(`Generated-site V3 compiled for ${input.bundle.businessProfile.vertical}.`);
  input.bundle.presenceAssessment.generationPlanningSource = "deterministic_design_system";
  return {
    applied: true,
    reason: `layout-v3 compiled for ${input.bundle.businessProfile.vertical}.`,
    qualitySignals: result.qualitySignals
  };
}

export async function applyGeneratedSiteV3WithAssetLibrary(input: {
  bundle: SiteBundle;
  now?: string;
}): Promise<GeneratedSiteV3Application> {
  const vertical = input.bundle.businessProfile.vertical;
  let assetLibraryAssets: ApprovedAssetLibraryAsset[] = [];
  if (vertical === "auto_services" || vertical === "auto_body") {
    try {
      assetLibraryAssets = await approvedAssetLibraryAssetsForVerticals(vertical === "auto_body" ? ["auto_body", "auto_services"] : ["auto_services"]);
    } catch (caught) {
      input.bundle.presenceAssessment.technicalNotes.push(
        `Asset library lookup unavailable for ${vertical}: ${caught instanceof Error ? caught.message : String(caught)}`
      );
    }
  }
  return applyGeneratedSiteV3({ ...input, assetLibraryAssets });
}
