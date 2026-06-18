import {
  assertValidSectionBlueprintV1,
  sectionBlueprintVersionV1,
  validateSectionBlueprintV1,
  type SectionBlueprintV1,
  type SectionBlueprintValidationIssueV1
} from "./generated-site-v3-blueprint";
import type { CatalogManifestV1, DirectorInputManifestV1 } from "./generated-site-v3-director-manifest";
import {
  compositionIntentMenuV3,
  type CompositionIntentV3,
  type CompositionPlanV3
} from "./generated-site-v3-composition-plan";
import {
  validateSectionPresentationMapV3,
  type ArtDirectionSectionRoleV3,
  type DesignControlsV3,
  type SectionPresentationMapV3
} from "./generated-site-v3-art-direction-catalog";
import type { SiteArtDirectionFontPairingIdV3, SiteArtDirectionNavPlanV3, SiteArtDirectionRecipeV3, SiteHeaderModeV3 } from "./models";

export const siteDirectorPlanVersionV1 = "site-director-plan-v1" as const;

export type SiteDirectorGlobalControlsV1 = {
  fontPosture: "editorial" | "utility" | "expressive";
  colorPosture: "brand_forward" | "neutral" | "high_contrast" | "warm";
  buttonSystem: "square" | "pill" | "text_link" | "mixed";
  cardChrome: "bordered" | "elevated" | "editorial" | "quiet";
  figureTreatment: "flush" | "framed" | "edge_to_edge";
  headingTreatment: "standard" | "display" | "compact";
  sectionRhythm: "compact" | "balanced" | "spacious" | "varied";
};

export type SiteDirectorNavPlanV1 = {
  items: Array<{
    label: string;
    kind: "anchor" | "page" | "dropdown";
    target?: string;
    children?: Array<{ label: string; target: string }>;
  }>;
  primaryCta: { label: string; target: string };
};

export type SiteDirectorServicePageProposalV1 = {
  serviceId: string;
  slug: string;
  strategy: "dedicated" | "grouped" | "homepage_only";
  antiDoorwayRationale: string;
};

export type SiteDirectorAssetAssignmentV1 = {
  assetId: string;
  use: "hero" | "service" | "proof" | "gallery" | "logo" | "background";
  sectionId?: string;
  rationale: string;
};

export type SiteDirectorPlanV1 = {
  version: typeof siteDirectorPlanVersionV1;
  strategy: {
    rationale: string;
    creativeDiversityDirective: "differentiate_sequence" | "differentiate_presentations" | "differentiate_controls" | "stay_conservative";
    geometryDiversityDirective?: "use_archetype_geometry" | "differentiate_hero_services_contact" | "stay_conservative_with_archetype_floor";
  };
  globalControls: SiteDirectorGlobalControlsV1;
  nav: SiteDirectorNavPlanV1;
  home: {
    sections: SectionBlueprintV1[];
  };
  servicePages: SiteDirectorServicePageProposalV1[];
  assets: SiteDirectorAssetAssignmentV1[];
  qaExpectations: string[];
};

export type SiteDirectorPlanValidationIssueV1 = {
  code:
    | "site_director.version_invalid"
    | "site_director.missing_required_section"
    | "site_director.duplicate_section_id"
    | "site_director.section_invalid"
    | "site_director.template_not_model_selectable"
    | "site_director.presentation_not_model_selectable"
    | "site_director.nav_duplicate_label"
    | "site_director.nav_invalid"
    | "site_director.service_unknown"
    | "site_director.service_page_invalid"
    | "site_director.asset_unknown"
    | "site_director.asset_invalid"
    | "site_director.catalog_unavailable";
  severity: "error";
  message: string;
  path?: string;
};

export type SiteDirectorPlanValidationResultV1 = {
  ok: boolean;
  issues: SiteDirectorPlanValidationIssueV1[];
  acceptedSectionBlueprints: SectionBlueprintV1[];
};

export type SiteDirectorRuntimeV1 = {
  version: "site-director-runtime-v1";
  source: "model";
  model: string;
  catalogSchemaHash: string;
  businessDirectorInputHash: string;
  planInputHash: string;
  catalogManifest: CatalogManifestV1;
  directorInputManifest: DirectorInputManifestV1;
  plan: SiteDirectorPlanV1;
  validation: {
    status: "passed" | "failed";
    issues: SiteDirectorPlanValidationIssueV1[];
    acceptedSectionBlueprints: SectionBlueprintV1[];
  };
  finalRenderedSequence?: string[];
};

export function validateSiteDirectorPlanV1(input: {
  plan: SiteDirectorPlanV1;
  catalogManifest: CatalogManifestV1;
  directorInputManifest: DirectorInputManifestV1;
}): SiteDirectorPlanValidationResultV1 {
  const issues: SiteDirectorPlanValidationIssueV1[] = [];
  const acceptedSectionBlueprints: SectionBlueprintV1[] = [];
  const assetIds = input.directorInputManifest.assets.map((asset) => asset.id);
  const serviceIds = new Set(input.directorInputManifest.services.map((service) => service.id));

  if (input.plan.version !== siteDirectorPlanVersionV1) {
    issues.push(issue("site_director.version_invalid", `Expected ${siteDirectorPlanVersionV1}.`, "version"));
  }
  if (!input.catalogManifest.templates.length) {
    issues.push(issue("site_director.catalog_unavailable", "Catalog manifest has no templates.", "catalogManifest.templates"));
  }

  for (const [index, blueprint] of input.plan.home.sections.entries()) {
    const normalizedId = blueprint.id?.trim().toLowerCase();
    if (normalizedId) {
      const firstIndex = input.plan.home.sections.findIndex((section) => section.id?.trim().toLowerCase() === normalizedId);
      if (firstIndex !== index) {
        issues.push(issue("site_director.duplicate_section_id", `Duplicate home section id "${blueprint.id}".`, `home.sections.${index}.id`));
        continue;
      }
    }
    const sectionValidation = validateSectionBlueprintV1(blueprint, { availableAssetIds: assetIds });
    if (!sectionValidation.ok) {
      issues.push(...sectionValidation.issues.map((sectionIssue) => sectionIssueToPlanIssue(index, sectionIssue)));
      continue;
    }
    const issueCountBeforeManifestCheck = issues.length;
    validateBlueprintManifestSelectionV1(blueprint, input.catalogManifest, index, issues);
    if (issues.length > issueCountBeforeManifestCheck) continue;
    acceptedSectionBlueprints.push(assertValidSectionBlueprintV1(blueprint, { availableAssetIds: assetIds }));
  }
  if (!acceptedSectionBlueprints.some((blueprint) => blueprint.role === "hero")) {
    issues.push(issue("site_director.missing_required_section", "Home page must include one hero section blueprint.", "home.sections"));
  }
  if (input.directorInputManifest.services.length && !acceptedSectionBlueprints.some((blueprint) => blueprint.role === "services")) {
    issues.push(issue("site_director.missing_required_section", "Home page must include a services section when services are present.", "home.sections"));
  }
  if (!acceptedSectionBlueprints.some((blueprint) => blueprint.role === "faq")) {
    issues.push(issue("site_director.missing_required_section", "Home page must include an FAQ section blueprint.", "home.sections"));
  }
  const hasLocationEvidence = input.directorInputManifest.locations.some((location) => location.hasAddress || location.serviceAreaCount > 0);
  if (hasLocationEvidence && !acceptedSectionBlueprints.some((blueprint) => blueprint.role === "local")) {
    issues.push(issue("site_director.missing_required_section", "Home page must include a local/location section when location evidence is present.", "home.sections"));
  }
  if (!acceptedSectionBlueprints.some((blueprint) => blueprint.role === "contact" || blueprint.role === "conversion")) {
    issues.push(issue("site_director.missing_required_section", "Home page must include a contact or conversion section blueprint.", "home.sections"));
  }

  validateNavV1(input.plan.nav, issues);
  validateServicePagesV1(input.plan.servicePages, serviceIds, issues);
  validateAssetAssignmentsV1(input.plan.assets, new Set(assetIds), issues);

  return { ok: issues.length === 0, issues, acceptedSectionBlueprints };
}

export function assertValidSiteDirectorPlanV1(input: {
  plan: SiteDirectorPlanV1;
  catalogManifest: CatalogManifestV1;
  directorInputManifest: DirectorInputManifestV1;
}): SiteDirectorPlanV1 {
  const validation = validateSiteDirectorPlanV1(input);
  if (!validation.ok) {
    throw new Error(`Invalid SiteDirectorPlanV1: ${validation.issues.map((validationIssue) => validationIssue.message).join("; ")}`);
  }
  return input.plan;
}

export function compositionPlanFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): CompositionPlanV3 | undefined {
  const seen = new Set<CompositionIntentV3>();
  const sections: CompositionPlanV3["sections"] = [];
  const menu = new Set<CompositionIntentV3>(compositionIntentMenuV3);

  for (const blueprint of plan.home.sections) {
    if (blueprint.id === "hero") continue;
    if (!menu.has(blueprint.id as CompositionIntentV3)) continue;
    const intent = blueprint.id as CompositionIntentV3;
    if (seen.has(intent)) continue;
    seen.add(intent);
    sections.push({
      intent,
      why: copyJobSummaryV1(blueprint) || `SiteDirectorPlanV1 placed ${intent} for this business.`
    });
  }

  return sections.length >= 4 ? { version: "composition-plan-v1", source: "model", sections } : undefined;
}

function copyJobSummaryV1(blueprint: SectionBlueprintV1) {
  if (blueprint.copyJob) {
    return [
      blueprint.copyJob.point,
      blueprint.copyJob.proofToUse ? `Use: ${blueprint.copyJob.proofToUse}` : "",
      blueprint.copyJob.customerQuestion ? `Answer: ${blueprint.copyJob.customerQuestion}` : ""
    ].filter(Boolean).join(" ");
  }
  return blueprint.copyJobId;
}

export function presentationMapFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): SectionPresentationMapV3 | undefined {
  const merged: SectionPresentationMapV3 = {};
  for (const blueprint of plan.home.sections) {
    if (!blueprint.presentation) continue;
    for (const [role, presentation] of Object.entries(blueprint.presentation) as Array<[ArtDirectionSectionRoleV3, string | undefined]>) {
      if (!presentation) continue;
      (merged as Record<string, string>)[role] = presentation;
    }
  }
  return Object.keys(merged).length && validateSectionPresentationMapV3(merged).length === 0 ? merged : undefined;
}

export function designControlOverridesFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): Partial<DesignControlsV3> {
  const controls = plan.globalControls;
  return {
    cardChrome:
      controls.cardChrome === "elevated"
        ? "elevated"
        : controls.cardChrome === "editorial"
          ? "accent_underline"
          : "bordered",
    figureTreatment: controls.figureTreatment === "framed" ? "framed_shadow" : "flush",
    headingCase: controls.headingTreatment === "display" ? "display_upper" : "standard",
    eyebrowTreatment:
      controls.headingTreatment === "display"
        ? "accent_bar_chip"
        : controls.headingTreatment === "compact"
          ? "filled_kicker"
          : "plain_caps",
    badgeStyle:
      controls.cardChrome === "editorial"
        ? "tilted"
        : controls.cardChrome === "elevated"
          ? "rounded"
          : "square",
    factHighlight: controls.colorPosture === "brand_forward" || controls.colorPosture === "high_contrast" ? "accent_value" : "plain",
    headerSurface: controls.colorPosture === "brand_forward" ? "brand_bar" : "neutral",
    ctaBandTone:
      controls.colorPosture === "brand_forward"
        ? "brand"
        : controls.colorPosture === "warm"
          ? "paper"
          : "dark",
    numberStyle:
      controls.headingTreatment === "display"
        ? "filled_chip"
        : controls.headingTreatment === "compact"
          ? "outlined"
          : "oversized"
  };
}

export function buttonSystemFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): SiteArtDirectionRecipeV3["buttonSystem"] {
  switch (plan.globalControls.buttonSystem) {
    case "square":
      return "high_contrast_primary";
    case "pill":
      return "rounded_primary";
    case "text_link":
      return "understated";
    case "mixed":
    default:
      return "solid_with_quiet_secondary";
  }
}

export function cardTreatmentFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): SiteArtDirectionRecipeV3["cardTreatment"] {
  switch (plan.globalControls.cardChrome) {
    case "elevated":
      return "soft_surface";
    case "editorial":
      return "hairline_surface";
    case "quiet":
      return "borderless";
    case "bordered":
    default:
      return "minimal_surface";
  }
}

export function fontPairingFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): SiteArtDirectionFontPairingIdV3 {
  switch (plan.globalControls.fontPosture) {
    case "editorial":
      return "editorial_serif_clean_sans";
    case "utility":
      return "precision_grotesk";
    case "expressive":
    default:
      return "display_sans_humanist";
  }
}

export function headerModeFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): SiteHeaderModeV3 {
  const controls = plan.globalControls;
  if (controls.colorPosture === "brand_forward") return "utility_call_bar";
  if (controls.sectionRhythm === "compact") return "compact_sticky";
  if (controls.fontPosture === "expressive" || controls.headingTreatment === "display") return "split_brand_rail";
  if (controls.fontPosture === "editorial" || controls.cardChrome === "quiet") return "minimal_wordmark";
  return "solid_editorial";
}

export function spacingRhythmFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): SiteArtDirectionRecipeV3["spacingRhythm"] {
  switch (plan.globalControls.sectionRhythm) {
    case "compact":
      return "compact";
    case "spacious":
      return "spacious";
    case "varied":
      return "cinematic";
    case "balanced":
    default:
      return "standard";
  }
}

export function navPlanFromSiteDirectorPlanV1(plan: SiteDirectorPlanV1): SiteArtDirectionNavPlanV3 {
  return {
    source: "site_director",
    items: plan.nav.items.map((item) => ({
      label: item.label,
      kind: item.kind,
      ...(item.target ? { target: item.target } : {}),
      ...(item.children?.length ? { children: item.children.map((child) => ({ label: child.label, target: child.target })) } : {})
    })),
    primaryCta: {
      label: plan.nav.primaryCta.label,
      target: plan.nav.primaryCta.target
    }
  };
}

export function createMinimalSiteDirectorPlanFixtureV1(input: {
  hero: SectionBlueprintV1;
  contact: SectionBlueprintV1;
  serviceId?: string;
  assetId?: string;
}): SiteDirectorPlanV1 {
  return {
    version: siteDirectorPlanVersionV1,
    strategy: {
      rationale: "Fixture plan for validating the catalog-bounded site director contract.",
      creativeDiversityDirective: "stay_conservative"
    },
    globalControls: {
      fontPosture: "editorial",
      colorPosture: "neutral",
      buttonSystem: "mixed",
      cardChrome: "quiet",
      figureTreatment: "flush",
      headingTreatment: "standard",
      sectionRhythm: "balanced"
    },
    nav: {
      items: [
        { label: "Services", kind: "anchor", target: "#services" },
        { label: "Location", kind: "anchor", target: "#location" }
      ],
      primaryCta: { label: "Call now", target: "tel:5125550100" }
    },
    home: {
      sections: [input.hero, input.contact]
    },
    servicePages: input.serviceId
      ? [{ serviceId: input.serviceId, slug: "fixture-service", strategy: "homepage_only", antiDoorwayRationale: "Fixture keeps service detail on the homepage." }]
      : [],
    assets: input.assetId ? [{ assetId: input.assetId, use: "hero", sectionId: input.hero.id, rationale: "Fixture validates asset id checks." }] : [],
    qaExpectations: ["No overflow, no unsupported claims, and no invalid catalog choices."]
  };
}

export function siteDirectorSectionBlueprint(input: Omit<SectionBlueprintV1, "version" | "source">): SectionBlueprintV1 {
  return assertValidSectionBlueprintV1({ ...input, version: sectionBlueprintVersionV1, source: "site_director" });
}

function validateNavV1(nav: SiteDirectorNavPlanV1, issues: SiteDirectorPlanValidationIssueV1[]) {
  const labels = new Set<string>();
  for (const [index, item] of nav.items.entries()) {
    const normalized = item.label.trim().toLowerCase();
    if (!normalized) {
      issues.push(issue("site_director.nav_invalid", "Navigation item label is required.", `nav.items.${index}.label`));
      continue;
    }
    if (labels.has(normalized)) {
      issues.push(issue("site_director.nav_duplicate_label", `Duplicate navigation label "${item.label}".`, `nav.items.${index}.label`));
    }
    labels.add(normalized);
    if (item.kind === "dropdown" && !item.children?.length) {
      issues.push(issue("site_director.nav_invalid", `Dropdown nav item "${item.label}" must include children.`, `nav.items.${index}.children`));
    }
    if (item.kind !== "dropdown" && !item.target) {
      issues.push(issue("site_director.nav_invalid", `Nav item "${item.label}" must include a target.`, `nav.items.${index}.target`));
    }
  }
}

function validateServicePagesV1(
  servicePages: SiteDirectorServicePageProposalV1[],
  serviceIds: Set<string>,
  issues: SiteDirectorPlanValidationIssueV1[]
) {
  for (const [index, page] of servicePages.entries()) {
    if (!serviceIds.has(page.serviceId)) {
      issues.push(issue("site_director.service_unknown", `Unknown service id "${page.serviceId}".`, `servicePages.${index}.serviceId`));
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) {
      issues.push(issue("site_director.service_page_invalid", `Service page slug "${page.slug}" is not URL-safe.`, `servicePages.${index}.slug`));
    }
    if (page.strategy === "dedicated" && page.antiDoorwayRationale.trim().length < 20) {
      issues.push(issue("site_director.service_page_invalid", "Dedicated service pages require anti-doorway rationale.", `servicePages.${index}.antiDoorwayRationale`));
    }
  }
}

function validateAssetAssignmentsV1(
  assets: SiteDirectorAssetAssignmentV1[],
  assetIds: Set<string>,
  issues: SiteDirectorPlanValidationIssueV1[]
) {
  for (const [index, asset] of assets.entries()) {
    if (!assetIds.has(asset.assetId)) {
      issues.push(issue("site_director.asset_unknown", `Unknown asset id "${asset.assetId}".`, `assets.${index}.assetId`));
    }
    if (asset.rationale.trim().length < 10) {
      issues.push(issue("site_director.asset_invalid", "Asset assignment rationale is required.", `assets.${index}.rationale`));
    }
  }
}

function validateBlueprintManifestSelectionV1(
  blueprint: SectionBlueprintV1,
  catalogManifest: CatalogManifestV1,
  index: number,
  issues: SiteDirectorPlanValidationIssueV1[]
) {
  if (!catalogManifest.modelSelectableTemplateIds.includes(blueprint.templateId)) {
    issues.push(
      issue(
        "site_director.template_not_model_selectable",
        `Template ${blueprint.templateId} is renderable for replay but is not model-selectable in the current catalog manifest.`,
        `home.sections.${index}.templateId`
      )
    );
  }
  if (!blueprint.presentation) return;
  for (const [role, presentation] of Object.entries(blueprint.presentation) as Array<[ArtDirectionSectionRoleV3, string | undefined]>) {
    if (!presentation) continue;
    const selectable = catalogManifest.modelSelectablePresentationsByRole[role] as readonly string[] | undefined;
    if (!selectable?.includes(presentation)) {
      issues.push(
        issue(
          "site_director.presentation_not_model_selectable",
          `Presentation ${role}.${presentation} is compatible but is not model-selectable in the current catalog manifest.`,
          `home.sections.${index}.presentation.${role}`
        )
      );
    }
  }
}

function sectionIssueToPlanIssue(index: number, sectionIssue: SectionBlueprintValidationIssueV1): SiteDirectorPlanValidationIssueV1 {
  return issue("site_director.section_invalid", sectionIssue.message, `home.sections.${index}${sectionIssue.path ? `.${sectionIssue.path}` : ""}`);
}

function issue(
  code: SiteDirectorPlanValidationIssueV1["code"],
  message: string,
  path?: string
): SiteDirectorPlanValidationIssueV1 {
  return { code, severity: "error", message, path };
}
