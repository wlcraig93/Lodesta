import assert from "node:assert/strict";
import { buildCatalogManifestV1 } from "../lib/generated-site-v3-director-manifest";

const manifest = buildCatalogManifestV1();

const templateIds = new Set(manifest.modelSelectableTemplateIds);
const introOptions = manifest.templateOptionsByTemplate.intro_grid;
const processOptions = manifest.templateOptionsByTemplate.numbered_steps;
const locationOptions = manifest.templateOptionsByTemplate.location_showcase;
const servicesPresentations = manifest.modelSelectablePresentationsByRole.services ?? [];

const proofTemplateIds = [
  "facts_strip",
  "facts_cta",
  "stat_band",
  "proof_pair",
  "quote_wall",
  "eligibility_band",
  "case_study_preview",
  "comparison_table",
  "feature_band",
  "offer_band"
];

const report = {
  ok: true,
  catalogSchemaHash: manifest.catalogSchemaHash,
  services: {
    presentations: servicesPresentations.length,
    values: servicesPresentations
  },
  introGrid: {
    cardTreatments: introOptions.cardTreatment.length,
    headingLayouts: introOptions.headingLayout.length,
    numberDisplays: introOptions.numberDisplay.length,
    cardActions: introOptions.cardAction.length,
    mediaAspects: introOptions.mediaAspect.length,
    mediaCrops: introOptions.mediaCrop.length,
    cardTones: introOptions.cardTone.length,
    gridPatterns: introOptions.gridPattern.length
  },
  process: {
    stepTreatments: processOptions.stepTreatment.length,
    orientations: processOptions.orientation.length,
    numberStyles: processOptions.numberStyle.length,
    mediaModes: processOptions.mediaMode.length,
    densities: processOptions.stepDensity.length
  },
  proof: {
    selectableTemplates: proofTemplateIds.filter((id) => templateIds.has(id))
  },
  location: {
    showcaseLayouts: locationOptions.locationLayout.length,
    statusBadges: locationOptions.statusBadge.length,
    hoursDisplays: locationOptions.hoursDisplay.length,
    actionClusters: locationOptions.actionCluster.length,
    hasDirectory: templateIds.has("location_directory"),
    hasServiceArea: templateIds.has("service_area_showcase")
  }
};

assert.ok(servicesPresentations.length >= 4, "Expected at least 4 model-selectable service/card presentations.");
assert.ok(introOptions.cardTreatment.length >= 4, "Expected at least 4 intro_grid card treatments.");
assert.ok(introOptions.headingLayout.length >= 3, "Expected at least 3 intro_grid heading layouts.");
assert.ok(introOptions.cardAction.length >= 4, "Expected at least 4 intro_grid card action styles.");
assert.ok(introOptions.gridPattern.length >= 4, "Expected at least 4 intro_grid grid patterns.");
assert.ok(processOptions.stepTreatment.length >= 3, "Expected at least 3 process step treatments.");
assert.ok(proofTemplateIds.filter((id) => templateIds.has(id)).length >= 3, "Expected at least 3 proof/eligibility templates.");
assert.ok(locationOptions.locationLayout.length >= 2, "Expected at least 2 single-location showcase layouts.");
assert.ok(templateIds.has("location_directory"), "Expected location_directory to stay model-selectable.");
assert.ok(templateIds.has("service_area_showcase"), "Expected service_area_showcase to stay model-selectable.");

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
