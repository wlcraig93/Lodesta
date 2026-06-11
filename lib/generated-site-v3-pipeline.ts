import { compileGeneratedSiteV3Site } from "./generated-site-v3-compiler";
import { approvedAssetLibraryAssetsForVerticals, type ApprovedAssetLibraryAsset } from "./asset-library";
import { withBusinessBundleFields } from "./business-model";
import {
  generatedSiteV3AllowlistHosts,
  getGeneratedSiteV3Mode,
  isGeneratedSiteV3Allowed
} from "./generated-site-v3";
import type { SiteBundle } from "./models";

export type GeneratedSiteV3Application = {
  applied: boolean;
  reason: string;
};

export function maybeApplyGeneratedSiteV3(input: {
  bundle: SiteBundle;
  sourceHost?: string;
  explicitOperatorRequest?: boolean;
  fixture?: boolean;
  now?: string;
}): GeneratedSiteV3Application {
  return applyGeneratedSiteV3({ ...input, assetLibraryAssets: [] });
}

export async function maybeApplyGeneratedSiteV3WithAssetLibrary(input: {
  bundle: SiteBundle;
  sourceHost?: string;
  explicitOperatorRequest?: boolean;
  fixture?: boolean;
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

function applyGeneratedSiteV3(input: {
  bundle: SiteBundle;
  sourceHost?: string;
  explicitOperatorRequest?: boolean;
  fixture?: boolean;
  now?: string;
  assetLibraryAssets: ApprovedAssetLibraryAsset[];
}): GeneratedSiteV3Application {
  const mode = getGeneratedSiteV3Mode();
  const allowed = isGeneratedSiteV3Allowed({
    mode,
    sourceHost: input.sourceHost,
    explicitOperatorRequest: input.explicitOperatorRequest,
    fixture: input.fixture,
    allowlistHosts: generatedSiteV3AllowlistHosts()
  });
  if (!allowed) return { applied: false, reason: `layout-v3 disabled for mode ${mode}.` };

  const hydratedBundle = withBusinessBundleFields(input.bundle);
  const result = compileGeneratedSiteV3Site({
    bundle: hydratedBundle,
    createdAt: input.now,
    assetLibraryAssets: input.assetLibraryAssets
  });
  const previousDraftIndex = input.bundle.siteModel.versions.findIndex((version) => version.status === "draft");
  if (previousDraftIndex >= 0) input.bundle.siteModel.versions[previousDraftIndex] = result.version;
  else input.bundle.siteModel.versions.unshift(result.version);

  input.bundle.presenceAssessment.brandCueReport = result.brandCueReport;
  input.bundle.presenceAssessment.technicalNotes.push(`Generated-site V3 applied for ${input.bundle.businessProfile.vertical} via ${mode}.`);
  input.bundle.presenceAssessment.generationPlanningSource = "deterministic_fallback";
  return {
    applied: true,
    reason: `layout-v3 applied for ${input.bundle.businessProfile.vertical} via ${mode}.`
  };
}
