import { compileGeneratedSiteV3Site } from "./generated-site-v3-compiler";
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
    createdAt: input.now
  });
  const previousDraftIndex = input.bundle.siteModel.versions.findIndex((version) => version.status === "draft");
  if (previousDraftIndex >= 0) input.bundle.siteModel.versions[previousDraftIndex] = result.version;
  else input.bundle.siteModel.versions.unshift(result.version);

  input.bundle.presenceAssessment.technicalNotes.push(`Generated-site V3 applied for ${input.bundle.businessProfile.vertical} via ${mode}.`);
  input.bundle.presenceAssessment.generationPlanningSource = "deterministic_fallback";
  return {
    applied: true,
    reason: `layout-v3 applied for ${input.bundle.businessProfile.vertical} via ${mode}.`
  };
}
