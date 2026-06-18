import assert from "node:assert/strict";
import {
  compatiblePresentationsForRoleV3,
  modelSelectablePresentationsForRoleV3,
  presentationGuidanceByRoleV3,
  type ArtDirectionSectionRoleV3,
  type PresentationGuidanceV3
} from "../lib/generated-site-v3-art-direction-catalog";
import { createGeneratedSiteV3CanonicalVisualGrammarSites } from "../lib/generated-site-v3-canonical-visual-grammar";
import {
  buildCatalogManifestV1,
  buildDirectorInputManifestV1,
  hashDirectorManifestV1
} from "../lib/generated-site-v3-director-manifest";
import {
  buttonSystemFromSiteDirectorPlanV1,
  compositionPlanFromSiteDirectorPlanV1,
  createMinimalSiteDirectorPlanFixtureV1,
  designControlOverridesFromSiteDirectorPlanV1,
  fontPairingFromSiteDirectorPlanV1,
  headerModeFromSiteDirectorPlanV1,
  navPlanFromSiteDirectorPlanV1,
  presentationMapFromSiteDirectorPlanV1,
  siteDirectorSectionBlueprint,
  spacingRhythmFromSiteDirectorPlanV1,
  validateSiteDirectorPlanV1
} from "../lib/site-director-plan-v1";
import { compileGeneratedSiteV3Site } from "../lib/generated-site-v3-compiler";
import {
  modelSelectableSectionTemplatesV3,
  renderableSectionTemplatesV3,
  sectionTemplateCatalogV3
} from "../lib/generated-site-v3-section-templates";
import { getVisualSectionV3 } from "../lib/generated-site-v3-visual-controls";

const catalogManifest = buildCatalogManifestV1();
const secondCatalogManifest = buildCatalogManifestV1();

assert.equal(catalogManifest.version, "catalog-manifest-v1");
assert.equal(catalogManifest.templateCount, sectionTemplateCatalogV3.length, "Catalog manifest should include every typed section template.");
assert.deepEqual(
  catalogManifest.modelSelectableTemplateIds,
  modelSelectableSectionTemplatesV3().map((template) => template.id),
  "Model-selectable manifest ids should be derived from active template status."
);
assert.deepEqual(
  catalogManifest.renderableTemplateIds,
  renderableSectionTemplatesV3().map((template) => template.id),
  "Renderable manifest ids should include active/reserved/replay-only templates for stored-plan replay."
);
assert.equal(catalogManifest.catalogSchemaHash, secondCatalogManifest.catalogSchemaHash, "Catalog manifest hash should be stable.");
assert.equal(
  catalogManifest.catalogSchemaHash,
  hashDirectorManifestV1({
    version: "catalog-manifest-v1",
    templates: catalogManifest.templates,
    presentationsByRole: catalogManifest.presentationsByRole,
    modelSelectablePresentationsByRole: catalogManifest.modelSelectablePresentationsByRole,
    presentationGuidanceByRole: catalogManifest.presentationGuidanceByRole,
    componentControls: catalogManifest.componentControls,
    controlIncompatibilities: catalogManifest.controlIncompatibilities,
    templateOptionsByTemplate: catalogManifest.templateOptionsByTemplate,
    modelSelectableTemplateIds: catalogManifest.modelSelectableTemplateIds,
    renderableTemplateIds: catalogManifest.renderableTemplateIds
  }),
  "Catalog schema hash should cover the static selectable/renderable surface."
);

for (const [role, presentations] of Object.entries(compatiblePresentationsForRoleV3) as Array<[ArtDirectionSectionRoleV3, readonly string[]]>) {
  assert.deepEqual(catalogManifest.presentationsByRole[role], presentations, `Presentation role ${role} should be manifest-derived.`);
}
for (const [role, presentations] of Object.entries(modelSelectablePresentationsForRoleV3) as Array<[ArtDirectionSectionRoleV3, readonly string[]]>) {
  assert.deepEqual(
    catalogManifest.modelSelectablePresentationsByRole[role],
    presentations,
    `Model-selectable presentation role ${role} should be manifest-derived.`
  );
  const guidance = catalogManifest.presentationGuidanceByRole[role] as Record<string, PresentationGuidanceV3>;
  for (const presentation of presentations) {
    assert.ok(
      guidance[presentation],
      `Model-selectable presentation ${role}.${presentation} should have model guidance.`
    );
  }
}
assert.deepEqual(catalogManifest.presentationGuidanceByRole, presentationGuidanceByRoleV3, "Presentation guidance should be manifest-derived.");

const sites = createGeneratedSiteV3CanonicalVisualGrammarSites();
const autoBody = sites.find((site) => site.shellId === "auto_body");
assert.ok(autoBody, "Canonical auto-body fixture should exist for director input manifest verification.");
const inputManifest = buildDirectorInputManifestV1(autoBody.bundle);
const secondInputManifest = buildDirectorInputManifestV1(JSON.parse(JSON.stringify(autoBody.bundle)));

assert.equal(inputManifest.version, "director-input-manifest-v1");
assert.equal(inputManifest.business.siteId, autoBody.bundle.businessProfile.siteId);
assert.equal(inputManifest.evidenceRichness.serviceCount, autoBody.bundle.businessProfile.services.length);
assert.equal(inputManifest.services.length, autoBody.bundle.businessProfile.services.length);
assert.ok(inputManifest.assets.length >= autoBody.bundle.businessProfile.photos.length, "Director input manifest should expose photo/logo assets.");
assert.equal(inputManifest.businessDirectorInputHash, secondInputManifest.businessDirectorInputHash, "Director input manifest hash should be replay-stable.");

const changedBundle = JSON.parse(JSON.stringify(autoBody.bundle)) as typeof autoBody.bundle;
changedBundle.businessProfile.services = [...changedBundle.businessProfile.services, "Calibration-only new service"];
assert.notEqual(
  buildDirectorInputManifestV1(changedBundle).businessDirectorInputHash,
  inputManifest.businessDirectorInputHash,
  "Director input hash should change when per-business services change."
);

const firstAssetId = inputManifest.assets[0]?.id;
const firstPhotoAsset = inputManifest.assets.find((asset) => asset.kind === "photo" && asset.url);
const secondPhotoAsset = inputManifest.assets.find((asset) => asset.kind === "photo" && asset.url && asset.id !== firstPhotoAsset?.id);
const firstServiceId = inputManifest.services[0]?.id;
const minimalPlan = createMinimalSiteDirectorPlanFixtureV1({
  hero: siteDirectorSectionBlueprint({
    id: "hero",
    role: "hero",
    templateId: "hero_split",
    background: { kind: "solid", token: "page" },
    slotCounts: { media: 1 }
  }),
  contact: siteDirectorSectionBlueprint({
    id: "contact",
    role: "contact",
    templateId: "contact_split",
    background: { kind: "gradient", token: "brand" }
  }),
  serviceId: firstServiceId,
  assetId: firstAssetId
});
const validPlan = {
  ...minimalPlan,
  home: {
    sections: [
      minimalPlan.home.sections[0],
      siteDirectorSectionBlueprint({
        id: "services",
        role: "services",
        templateId: "intro_grid",
        background: { kind: "solid", token: "surface" },
        presentation: { services: "premium_showcase" },
        copyJobId: "Make services scannable with differentiated card treatment."
      }),
      siteDirectorSectionBlueprint({
        id: "faq",
        role: "faq",
        templateId: "faq_list",
        background: { kind: "gradient", token: "subtle" },
        presentation: { faq: "faq_accordion" },
        copyJobId: "Answer grounded conversion questions."
      }),
      siteDirectorSectionBlueprint({
        id: "location",
        role: "local",
        templateId: "location_showcase",
        background: { kind: "solid", token: "page" },
        copyJobId: "Show visit details and hours clearly."
      }),
      minimalPlan.home.sections[1]
    ]
  }
};
const validPlanResult = validateSiteDirectorPlanV1({
  plan: validPlan,
  catalogManifest,
  directorInputManifest: inputManifest
});
assert.equal(validPlanResult.ok, true, `Valid SiteDirectorPlanV1 fixture should pass: ${validPlanResult.issues.map((issue) => issue.message).join("; ")}`);

const demotedTemplateManifest = {
  ...catalogManifest,
  modelSelectableTemplateIds: catalogManifest.modelSelectableTemplateIds.filter((templateId) => templateId !== "hero_split")
};
const demotedTemplateResult = validateSiteDirectorPlanV1({
  plan: validPlan,
  catalogManifest: demotedTemplateManifest,
  directorInputManifest: inputManifest
});
assert.equal(demotedTemplateResult.ok, false, "Fresh SiteDirectorPlanV1 validation should reject templates removed from the model-selectable manifest.");
assert.ok(
  demotedTemplateResult.issues.some((issue) => issue.code === "site_director.template_not_model_selectable"),
  "Demoted template rejection should be explicit so replay-only and model-selectable surfaces stay separate."
);

const validHeroBlueprint = validPlan.home.sections.find((section) => section.id === "hero");
const validContactBlueprint = validPlan.home.sections.find((section) => section.id === "contact");
assert.ok(validHeroBlueprint, "Valid fixture should include a hero blueprint.");
assert.ok(validContactBlueprint, "Valid fixture should include a contact blueprint.");

const richerPlan = {
  ...validPlan,
  home: {
    sections: [
      validHeroBlueprint,
      siteDirectorSectionBlueprint({
        id: "services",
        role: "services",
        templateId: "intro_grid",
        background: { kind: "solid", token: "surface" },
        presentation: { services: "premium_showcase" },
        copyJobId: "Make services scannable with differentiated card treatment."
      }),
      siteDirectorSectionBlueprint({
        id: "process",
        role: "process",
        templateId: "numbered_steps",
        background: { kind: "solid", token: "page" },
        presentation: { process: "stepper_vertical" },
        copyJobId: "Explain the customer journey without repeating the service taxonomy."
      }),
      siteDirectorSectionBlueprint({
        id: "faq",
        role: "faq",
        templateId: "faq_list",
        background: { kind: "gradient", token: "subtle" },
        presentation: { faq: "faq_accordion" },
        copyJobId: "Answer grounded conversion questions."
      }),
      siteDirectorSectionBlueprint({
        id: "location",
        role: "local",
        templateId: "location_showcase",
        background: { kind: "solid", token: "page" },
        copyJobId: "Show visit details and hours clearly."
      }),
      validContactBlueprint
    ]
  }
};
const directorCompositionPlan = compositionPlanFromSiteDirectorPlanV1(richerPlan);
assert.ok(directorCompositionPlan, "Richer SiteDirectorPlanV1 should convert to a compiler composition plan.");
assert.deepEqual(
  directorCompositionPlan.sections.map((section) => section.intent),
  ["services", "process", "faq", "location", "contact"],
  "SiteDirectorPlanV1 order should become the compiler composition order."
);
assert.deepEqual(
  presentationMapFromSiteDirectorPlanV1(richerPlan),
  { services: "premium_showcase", process: "stepper_vertical", faq: "faq_accordion" },
  "SiteDirectorPlanV1 presentation choices should become the compiler presentation map."
);
const demotedPresentationManifest = {
  ...catalogManifest,
  modelSelectablePresentationsByRole: {
    ...catalogManifest.modelSelectablePresentationsByRole,
    services: catalogManifest.modelSelectablePresentationsByRole.services.filter((presentation) => presentation !== "premium_showcase")
  }
};
const demotedPresentationResult = validateSiteDirectorPlanV1({
  plan: richerPlan,
  catalogManifest: demotedPresentationManifest,
  directorInputManifest: inputManifest
});
assert.equal(demotedPresentationResult.ok, false, "Fresh SiteDirectorPlanV1 validation should reject presentations removed from the model-selectable manifest.");
assert.ok(
  demotedPresentationResult.issues.some((issue) => issue.code === "site_director.presentation_not_model_selectable"),
  "Demoted presentation rejection should be explicit so weak variants cannot stay model-selectable accidentally."
);
assert.deepEqual(
  designControlOverridesFromSiteDirectorPlanV1({
    ...richerPlan,
    globalControls: {
      ...richerPlan.globalControls,
      colorPosture: "brand_forward",
      cardChrome: "editorial",
      figureTreatment: "framed",
      headingTreatment: "display"
    }
  }),
  {
    cardChrome: "accent_underline",
    figureTreatment: "framed_shadow",
    headingCase: "display_upper",
    eyebrowTreatment: "accent_bar_chip",
    badgeStyle: "tilted",
    factHighlight: "accent_value",
    headerSurface: "brand_bar",
    ctaBandTone: "brand",
    numberStyle: "filled_chip"
  },
  "SiteDirectorPlanV1 global controls should map to bounded renderer design controls."
);

const renderAuthoritySections = richerPlan.home.sections.map((section) =>
  section.id === "hero"
    ? siteDirectorSectionBlueprint({
        ...section,
        assetRefs: firstPhotoAsset ? [{ slot: "media", assetId: firstPhotoAsset.id, cropIntent: "wide" }] : undefined
      })
    : section.id === "services"
    ? siteDirectorSectionBlueprint({
        id: "services",
        role: "services",
        templateId: "side_intro_rows",
        background: { kind: "solid", token: "page" },
        assetRefs: secondPhotoAsset ? [{ slot: "media", assetId: secondPhotoAsset.id, cropIntent: "subject" }] : undefined,
        copyJobId: "Use an editorial service row treatment rather than another card grid."
      })
    : section.id === "process"
      ? siteDirectorSectionBlueprint({
          id: "process",
          role: "process",
          templateId: "numbered_steps",
          background: { kind: "solid", token: "surface" },
          presentation: { process: "stepper_vertical" },
          copyJobId: "Explain the customer journey on a surface process band."
        })
    : section.id === "location"
      ? siteDirectorSectionBlueprint({
          id: "location",
          role: "local",
          templateId: "location_showcase",
          background: { kind: "solid", token: "surface" },
          copyJobId: "Use the premium visit-card location section on a surface background."
        })
    : section
);
renderAuthoritySections.splice(
  2,
  0,
  siteDirectorSectionBlueprint({
    id: "media",
    role: "proof",
    templateId: "split_media",
    background: { kind: "solid", token: "surface" },
    templateOptions: { mediaSide: "right" },
    assetRefs: secondPhotoAsset ? [{ slot: "media", assetId: secondPhotoAsset.id, cropIntent: "subject" }] : undefined,
    copyJobId: "Use one focused proof image instead of another gallery block."
  })
);
const renderAuthorityPlan = {
  ...richerPlan,
  globalControls: {
    ...richerPlan.globalControls,
    buttonSystem: "square" as const,
    sectionRhythm: "spacious" as const
  },
  home: {
    sections: renderAuthoritySections
  },
  nav: {
    items: [
      {
        label: "Services",
        kind: "dropdown" as const,
        children: [
          { label: "Collision", target: "services/collision-repair" },
          { label: "Paint", target: "services/paint-refinishing" }
        ]
      },
      { label: "Process", kind: "anchor" as const, target: "#process" },
      { label: "Location", kind: "anchor" as const, target: "#location" },
      { label: "Contact", kind: "anchor" as const, target: "#contact" }
    ],
    primaryCta: { label: "Start estimate", target: "#contact" }
  }
};
assert.equal(buttonSystemFromSiteDirectorPlanV1(renderAuthorityPlan), "high_contrast_primary", "Director button system should map to a bounded renderer enum.");
assert.equal(fontPairingFromSiteDirectorPlanV1(renderAuthorityPlan), "editorial_serif_clean_sans", "Director font posture should map to a bounded renderer font pairing.");
assert.equal(headerModeFromSiteDirectorPlanV1(renderAuthorityPlan), "minimal_wordmark", "Director global controls should map to a bounded renderer header mode.");
assert.equal(spacingRhythmFromSiteDirectorPlanV1(renderAuthorityPlan), "spacious", "Director section rhythm should map to a bounded renderer enum.");
assert.deepEqual(
  navPlanFromSiteDirectorPlanV1(renderAuthorityPlan).items[0],
  {
    label: "Services",
    kind: "dropdown",
    children: [
      { label: "Collision", target: "services/collision-repair" },
      { label: "Paint", target: "services/paint-refinishing" }
    ]
  },
  "Director nav should map to the stored art-direction nav plan without losing dropdown children."
);

{
  const directorBundle = JSON.parse(JSON.stringify(autoBody.bundle)) as typeof autoBody.bundle;
  const directorInputManifest = buildDirectorInputManifestV1(directorBundle);
  const validation = validateSiteDirectorPlanV1({
    plan: renderAuthorityPlan,
    catalogManifest,
    directorInputManifest
  });
  assert.equal(validation.ok, true, `Render-authority plan should validate: ${validation.issues.map((issue) => issue.message).join("; ")}`);
  directorBundle.presenceAssessment.siteDirectorPlanV1 = {
    version: "site-director-runtime-v1",
    source: "model",
    model: "test-director",
    catalogSchemaHash: catalogManifest.catalogSchemaHash,
    businessDirectorInputHash: directorInputManifest.businessDirectorInputHash,
    planInputHash: "test-plan-input",
    catalogManifest,
    directorInputManifest,
    plan: renderAuthorityPlan,
    validation: {
      status: "passed",
      issues: [],
      acceptedSectionBlueprints: validation.acceptedSectionBlueprints
    }
  };
  const compiledResult = compileGeneratedSiteV3Site({ bundle: directorBundle, createdAt: "2026-06-02T00:00:00.000Z" });
  const compiled = compiledResult.version;
  assert.equal(compiled.artDirection.fontPairingId, "editorial_serif_clean_sans", "Compiled art direction should honor the director-owned font posture.");
  assert.equal(compiled.artDirection.headerMode, "minimal_wordmark", "Compiled art direction should honor the director-owned header mode mapping.");
  assert.equal(compiled.artDirection.buttonSystem, "high_contrast_primary", "Compiled art direction should honor the director-owned button system.");
  assert.equal(compiled.artDirection.spacingRhythm, "spacious", "Compiled art direction should honor the director-owned section rhythm.");
  assert.equal(compiled.artDirection.navPlan?.source, "site_director", "Compiled art direction should persist the director nav plan.");
  assert.equal(compiled.artDirection.navPlan?.items[0]?.kind, "dropdown", "Compiled art direction should keep director-selected dropdown nav.");
  assert.deepEqual(
    compiled.pageComposition.pages[0]?.sections.map((section) => section.id),
    renderAuthorityPlan.home.sections.map((section) => section.id),
    "Accepted SiteDirectorPlanV1 blueprint order should be the rendered home section order; deterministic recipes/seeds must not reorder it."
  );
  assert.ok(
    compiledResult.compositionReport.decisions.some((decision) => decision.id === "site_director.blueprints_applied"),
    "Composition report should record that SiteDirectorPlanV1 blueprints supplied planning authority."
  );
  assert.equal(
    compiled.pageComposition.pages.some((page) => page.purpose === "service_landing"),
    false,
    "Director service-page proposals should suppress deterministic service pages when the proposal strategy is homepage_only."
  );
  const servicesSection = compiled.pageComposition.pages[0]?.sections.find((section) => section.id === "services");
  assert.equal(
    getVisualSectionV3(servicesSection?.props ?? {})?.templateId,
    "side_intro_rows",
    "Compiled sections should honor the director-selected services template when the template is renderable for the built section."
  );
  assert.deepEqual(
    getVisualSectionV3(servicesSection?.props ?? {})?.options.background,
    { kind: "solid", token: "page" },
    "Compiled services section should honor the director-selected background."
  );
  const processSection = compiled.pageComposition.pages[0]?.sections.find((section) => section.id === "process");
  assert.deepEqual(
    getVisualSectionV3(processSection?.props ?? {})?.options.background,
    { kind: "solid", token: "surface" },
    "Compiled process section should honor the director-selected background."
  );
  const mediaSection = compiled.pageComposition.pages[0]?.sections.find((section) => section.id === "media");
  const mediaVisual = getVisualSectionV3(mediaSection?.props ?? {});
  assert.equal(
    mediaVisual?.templateId,
    "split_media",
    "Compiled media/proof section should honor a director-selected split_media template when safe media evidence supports it."
  );
  if (mediaVisual?.templateId !== "split_media") throw new Error("Expected director-selected split_media in render-authority test.");
  assert.equal(mediaVisual.options.mediaSide, "right", "Compiled split_media should honor the director-selected mediaSide option.");
  const heroVisual = getVisualSectionV3(compiled.pageComposition.pages[0]?.sections.find((section) => section.id === "hero")?.props ?? {});
  if (firstPhotoAsset?.url) {
    assert.equal(
      (heroVisual?.slots as { media?: { items?: Array<{ url: string }> } } | undefined)?.media?.items?.[0]?.url,
      firstPhotoAsset.url,
      "Compiled hero should honor the director-selected hero asset before seeded gallery order."
    );
  }
  if (secondPhotoAsset?.url) {
    assert.equal(
      (mediaVisual.slots as { media?: { items?: Array<{ url: string }> } } | undefined)?.media?.items?.[0]?.url,
      secondPhotoAsset.url,
      "Compiled media section should honor the director-selected media asset before deterministic gallery order."
    );
  }
  const locationSection = compiled.pageComposition.pages[0]?.sections.find((section) => section.id === "location");
  const locationVisual = getVisualSectionV3(locationSection?.props ?? {});
  assert.equal(locationVisual?.templateId, "location_showcase", "Compiled location section should preserve the fact-compatible director location template.");
  assert.deepEqual(
    locationVisual?.options.background,
    { kind: "solid", token: "surface" },
    "Compiled location section should honor the director-selected background when the template supports it."
  );
}

const invalidPlan = {
  ...validPlan,
  home: {
    sections: [
      {
        ...validPlan.home.sections[0],
        templateId: "not_a_template"
      }
    ]
  },
  servicePages: [{ serviceId: "missing_service", slug: "Bad Slug", strategy: "dedicated", antiDoorwayRationale: "" }]
} as unknown as typeof validPlan;
const invalidPlanResult = validateSiteDirectorPlanV1({
  plan: invalidPlan,
  catalogManifest,
  directorInputManifest: inputManifest
});
assert.equal(invalidPlanResult.ok, false, "Invalid SiteDirectorPlanV1 should fail validation.");

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      catalogSchemaHash: catalogManifest.catalogSchemaHash,
      businessDirectorInputHash: inputManifest.businessDirectorInputHash,
      templates: catalogManifest.templateCount,
      selectableTemplates: catalogManifest.modelSelectableTemplateIds.length
    },
    null,
    2
  )}\n`
);
