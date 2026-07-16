import assert from "node:assert/strict";
import { buildDesignSystemCatalogManifestV1 } from "../lib/design-system-planner-manifest-v1";
import { createSiteV3FromInput } from "../lib/intake";
import { generatedSiteVerticalQualityProfileForBusinessV1 } from "../lib/generated-site-v3-quality-profiles";
import { resolveBrandExpressionV1, validateIdentityCoherenceV1, validateThemeContrastV1 } from "../lib/brand-expression-v1";

const manifest = buildDesignSystemCatalogManifestV1();

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

const autoBodyBundle = createSiteV3FromInput({
  url: "https://mencia.example",
  prompt:
    "Build a website for Mencia Auto Body & Paint, an auto body shop in Austin offering collision repair, paint refinishing, dent repair, bumper repair, and insurance claim support. phone: (512) 551-9434. address: 819 Houston St, Austin, TX 78756."
});
autoBodyBundle.businessProfile.vertical = "auto_body";
autoBodyBundle.businessProfile.siteId = "verify_auto_body_identity";
autoBodyBundle.businessProfile.services = ["Collision repair", "Paint refinishing", "Dent repair", "Bumper repair", "Insurance claim support"];
const autoBodyProfile = generatedSiteVerticalQualityProfileForBusinessV1(autoBodyBundle.businessProfile);
const autoBodyIdentities = Array.from({ length: 16 }, (_, index) =>
  resolveBrandExpressionV1({
    business: { ...autoBodyBundle.businessProfile, siteId: `verify_auto_body_identity_${index}` },
    profile: autoBodyProfile,
    mediaKind: "text"
  })
);
const autoBodySignatures = new Set(autoBodyIdentities.map((identity) => identity.signature));
for (const identity of autoBodyIdentities) {
  assert.deepEqual(validateThemeContrastV1(identity.theme), [], `${identity.signature} must pass contrast validation.`);
  assert.deepEqual(validateIdentityCoherenceV1(identity), [], `${identity.signature} must pass identity coherence validation.`);
}
const sourceBlueIdentity = resolveBrandExpressionV1({
  business: { ...autoBodyBundle.businessProfile, siteId: "verify_auto_body_source_blue" },
  profile: autoBodyProfile,
  mediaKind: "media",
  brandAssessment: {
    id: "brand_verify_auto_body_source_blue",
    siteId: "verify_auto_body_source_blue",
    confidence: 0.9,
    cues: [],
    colorSignals: ["Source palette #0a3dbc #0376ba"],
    typographySignals: [],
    imageStyleSignals: [],
    toneSignals: [],
    preservationRules: [],
    sourceNotes: []
  },
  brandExpression: {
    version: "brand-expression-v1",
    mood: "technical",
    fontPosture: "premium",
    voiceRegister: "technical",
    paletteSeed: { strategy: "category_default" },
    rationale: "No explicit palette rank was available to the understanding model."
  }
});
assert.equal(sourceBlueIdentity.brandCueReport.applied, true, "Strong extracted source colors should seed identity even when understanding used category_default.");
assert.match(sourceBlueIdentity.theme.colors.primary, /^#[0-9a-f]{6}$/i, "Source-derived primary must remain a valid theme color.");
const neutralModelIdentity = resolveBrandExpressionV1({
  business: { ...autoBodyBundle.businessProfile, siteId: "verify_auto_body_source_blue_neutral_model" },
  profile: autoBodyProfile,
  mediaKind: "media",
  brandAssessment: {
    id: "brand_verify_auto_body_source_blue_neutral_model",
    siteId: "verify_auto_body_source_blue_neutral_model",
    confidence: 0.9,
    cues: [],
    colorSignals: ["Source palette #0a3dbc #0376ba"],
    typographySignals: [],
    imageStyleSignals: [],
    toneSignals: [],
    preservationRules: [],
    sourceNotes: []
  },
  brandExpression: {
    version: "brand-expression-v1",
    mood: "technical",
    fontPosture: "condensed",
    voiceRegister: "technical",
    paletteSeed: { strategy: "neutral" },
    rationale: "The understanding model preferred neutral styling despite strong source color evidence."
  }
});
assert.equal(neutralModelIdentity.brandCueReport.applied, true, "Model taste must not suppress strong extracted source colors.");
const ownerNeutralIdentity = resolveBrandExpressionV1({
  business: { ...autoBodyBundle.businessProfile, siteId: "verify_auto_body_source_blue_owner_neutral" },
  profile: autoBodyProfile,
  mediaKind: "media",
  brandAssessment: {
    id: "brand_verify_auto_body_source_blue_owner_neutral",
    siteId: "verify_auto_body_source_blue_owner_neutral",
    confidence: 0.9,
    cues: [],
    colorSignals: ["Source palette #0a3dbc #0376ba"],
    typographySignals: [],
    imageStyleSignals: [],
    toneSignals: [],
    preservationRules: [],
    sourceNotes: []
  },
  suppressBrandCues: true
});
assert.equal(ownerNeutralIdentity.brandCueReport.applied, false, "An explicit owner neutral-palette edit must suppress source colors.");

Object.assign(report, {
  identityEngine: {
    autoBodyProfileMode: autoBodyProfile.identity.mode,
    autoBodySignatures: autoBodySignatures.size,
    sampleSignatures: [...autoBodySignatures].slice(0, 6)
  }
});

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
assert.equal(autoBodyProfile.identity.mode, "expanded", "Auto-body identity profile must be widened for the benchmark plan.");
assert.ok(autoBodySignatures.size >= 12, "Expected at least 12 distinct auto-body identity signatures across 16 seeded shells.");

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
