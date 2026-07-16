import type { ComponentControlSchemaV3, SectionInstanceV3 } from "./models";
import {
  compatiblePresentationsForRoleV3,
  validateSectionPresentationMapV3,
  type ArtDirectionSectionRoleV3,
  type SectionPresentationMapV3
} from "./generated-site-v3-art-direction-catalog";
import {
  isRenderableSectionTemplateV3,
  sectionTemplateAllowsBackgroundV3,
  sectionTemplateDefinitionV3,
  type CountRangeV3,
  type SectionPurposeTemplateIdV3,
  type SectionTemplateIdV3,
  type SectionTemplateSlotIdV3
} from "./generated-site-v3-section-templates";
import {
  foregroundForBackgroundV3,
  getVisualSectionV3,
  type CaseStudyTreatmentV3,
  type ComparisonTreatmentV3,
  type ContactCtaModeV3,
  type ContactFormComplexityV3,
  type ContactLayoutV3,
  type ContactProofSidebarV3,
  type EligibilityBandTreatmentV3,
  type HeroCtaLayoutV3,
  type HeroHeadlineScaleV3,
  type HeroLayoutV3,
  type HeroMediaTreatmentV3,
  type HeroProofPlacementV3,
  type IntroGridCardActionV3,
  type IntroGridCardTreatmentV3,
  type IntroGridCardToneV3,
  type IntroGridHeadingLayoutV3,
  type IntroGridMediaAspectV3,
  type IntroGridMediaCropV3,
  type IntroGridNumberDisplayV3,
  type IntroGridPatternV3,
  type LocationActionClusterV3,
  type LocationHoursDisplayV3,
  type LocationLayoutV3,
  type LocationStatusBadgeV3,
  type MediaCaptionModeV3,
  type MediaCropSetV3,
  type MediaPatternV3,
  type NumberedStepsDensityV3,
  type NumberedStepsMediaModeV3,
  type NumberedStepsNumberStyleV3,
  type NumberedStepsOrientationV3,
  type NumberedStepsTreatmentV3,
  type OfferBandTreatmentV3,
  type SectionBackgroundOptionV3,
  type ServiceIndexTreatmentV3,
  type SplitMediaSideV3,
  type TeamStoryTreatmentV3,
  type VisualSectionV3
} from "./generated-site-v3-visual-controls";

export const sectionBlueprintVersionV1 = "section-blueprint-v1" as const;

export type SectionBlueprintRoleV1 =
  | "hero"
  | "story"
  | "highlights"
  | "services"
  | "process"
  | "proof"
  | "media"
  | "faq"
  | "local"
  | "contact"
  | "conversion"
  | "statement"
  | "pricing"
  | "feature";

export type SectionBlueprintCtaRoleV1 = "primary" | "secondary" | "contextual" | "none";

export type SectionBlueprintAssetRefV1 = {
  slot: "media" | "background" | "logo";
  assetId: string;
  cropIntent?: "subject" | "wide" | "portrait" | "center";
};

export type SectionBlueprintSlotCountsV1 = Partial<Record<SectionTemplateSlotIdV3, number>>;

export type SectionBlueprintCopyJobV1 = {
  point: string;
  proofToUse: string;
  customerQuestion: string;
  slotShape: string;
  avoid: string;
  genericRisk: string;
};

export type SectionBlueprintTemplateOptionsV1 = {
  cardTreatment?: IntroGridCardTreatmentV3;
  headingLayout?: IntroGridHeadingLayoutV3;
  numberDisplay?: IntroGridNumberDisplayV3;
  cardAction?: IntroGridCardActionV3;
  mediaAspect?: IntroGridMediaAspectV3;
  mediaCrop?: IntroGridMediaCropV3;
  cardTone?: IntroGridCardToneV3;
  gridPattern?: IntroGridPatternV3;
  stepTreatment?: NumberedStepsTreatmentV3;
  orientation?: NumberedStepsOrientationV3;
  numberStyle?: NumberedStepsNumberStyleV3;
  mediaMode?: NumberedStepsMediaModeV3;
  stepDensity?: NumberedStepsDensityV3;
  mediaSide?: SplitMediaSideV3;
  heroAlign?: "left" | "center";
  heroLayout?: HeroLayoutV3;
  proofPlacement?: HeroProofPlacementV3;
  ctaLayout?: HeroCtaLayoutV3;
  mediaTreatment?: HeroMediaTreatmentV3;
  headlineScale?: HeroHeadlineScaleV3;
  locationLayout?: LocationLayoutV3;
  statusBadge?: LocationStatusBadgeV3;
  hoursDisplay?: LocationHoursDisplayV3;
  actionCluster?: LocationActionClusterV3;
  contactLayout?: ContactLayoutV3;
  formComplexity?: ContactFormComplexityV3;
  proofSidebar?: ContactProofSidebarV3;
  ctaMode?: ContactCtaModeV3;
  mediaPattern?: MediaPatternV3;
  captionMode?: MediaCaptionModeV3;
  cropSet?: MediaCropSetV3;
  eligibilityTreatment?: EligibilityBandTreatmentV3;
  serviceIndexTreatment?: ServiceIndexTreatmentV3;
  caseStudyTreatment?: CaseStudyTreatmentV3;
  comparisonTreatment?: ComparisonTreatmentV3;
  teamStoryTreatment?: TeamStoryTreatmentV3;
  offerBandTreatment?: OfferBandTreatmentV3;
};

/**
 * Load-bearing decision contract for generated-site V3.
 *
 * Deterministic planning and the future SiteDirectorPlanV1 both emit this
 * shape; hydration consumes only validated blueprints. It deliberately stores
 * creative decisions, not hydrated copy/facts/media payloads.
 */
export type SectionBlueprintV1 = {
  version: typeof sectionBlueprintVersionV1;
  id: string;
  source: "deterministic" | "site_director";
  role: SectionBlueprintRoleV1;
  templateId: SectionTemplateIdV3;
  purposeId?: SectionPurposeTemplateIdV3;
  anchorId?: string;
  background?: SectionBackgroundOptionV3;
  templateOptions?: SectionBlueprintTemplateOptionsV1;
  controls?: ComponentControlSchemaV3;
  presentation?: SectionPresentationMapV3;
  ctaRole?: SectionBlueprintCtaRoleV1;
  assetRefs?: SectionBlueprintAssetRefV1[];
  copyJob?: SectionBlueprintCopyJobV1;
  /**
   * Transitional plain-text summary for compiler telemetry and legacy tests.
   * New planning/copy code should read `copyJob`.
   */
  copyJobId?: string;
  slotCounts?: SectionBlueprintSlotCountsV1;
};

export type SectionBlueprintValidationIssueV1 = {
  code:
    | "blueprint.version_invalid"
    | "blueprint.id_invalid"
    | "blueprint.role_invalid"
    | "blueprint.template_unknown"
    | "blueprint.template_not_renderable"
    | "blueprint.background_invalid"
    | "blueprint.template_option_invalid"
    | "blueprint.presentation_invalid"
    | "blueprint.asset_unknown"
    | "blueprint.slot_unknown"
    | "blueprint.slot_count_invalid"
    | "blueprint.control_invalid";
  severity: "error";
  message: string;
  path?: string;
};

export type SectionBlueprintValidationContextV1 = {
  availableAssetIds?: readonly string[];
};

export type SectionBlueprintValidationResultV1 = {
  ok: boolean;
  issues: SectionBlueprintValidationIssueV1[];
};

const blueprintRolesV1 = new Set<SectionBlueprintRoleV1>([
  "hero",
  "story",
  "highlights",
  "services",
  "process",
  "proof",
  "media",
  "faq",
  "local",
  "contact",
  "conversion",
  "statement",
  "pricing",
  "feature"
]);

export const componentControlOptionsForBlueprintV1 = {
  layout: [
    "single_column",
    "two_column",
    "overlay",
    "asymmetric_grid",
    "editorial_rows",
    "card_grid",
    "media_masthead",
    "architectural_split",
    "gallery_wall",
    "mosaic_grid",
    "story_panel",
    "contact_panel"
  ],
  alignment: ["start", "center", "end", "split"],
  width: ["contained", "wide", "full_bleed"],
  padding: ["compact", "standard", "spacious"],
  background: ["site_bg", "surface", "brand", "media", "contrast"],
  mediaCrop: ["none", "center", "subject", "wide", "portrait"],
  density: ["open", "balanced", "dense"]
} as const;

export const templateOptionsForBlueprintV1 = {
  hero_split: {
    heroLayout: ["classic_split", "media_left", "editorial_overlap", "card_overlay", "full_bleed_masthead", "text_first", "no_media_editorial", "service_matrix"],
    proofPlacement: ["below_copy", "side_panel", "bottom_strip", "none"],
    ctaLayout: ["inline", "stacked", "button_plus_text_link", "callout_card"],
    mediaTreatment: ["flush", "framed", "rounded_panel", "bleed", "collage_pair"],
    headlineScale: ["compact", "standard", "display"]
  },
  intro_grid: {
    cardTreatment: ["standard", "comparison", "feature_cards", "service_cards", "media_top_cards", "editorial_cards"],
    headingLayout: ["full_width", "split_header", "side_rail", "compact_top"],
    numberDisplay: ["none", "subtle_index", "badge"],
    cardAction: ["none", "text_link", "bottom_aligned_button", "full_width_button"],
    mediaAspect: ["none", "square", "4x3", "16x10", "portrait"],
    mediaCrop: ["center", "subject", "wide", "detail_zoom"],
    cardTone: ["uniform", "alternating_surface", "featured_first", "dark_feature"],
    gridPattern: ["equal_grid", "lead_card", "mixed_masonry", "two_by_two", "compact_rows"]
  },
  numbered_steps: {
    stepTreatment: ["stepper_vertical", "checklist_cards", "numbered_ledger"],
    orientation: ["vertical", "horizontal", "timeline", "cards", "ledger"],
    numberStyle: ["none", "small_badge", "oversized", "connector"],
    mediaMode: ["none", "one_feature_image", "per_step_media"],
    stepDensity: ["compact", "balanced", "detailed"]
  },
  split_media: {
    mediaSide: ["left", "right"]
  },
  hero_statement: {
    heroAlign: ["left", "center"],
    heroLayout: ["classic_split", "media_left", "editorial_overlap", "card_overlay", "full_bleed_masthead", "text_first", "no_media_editorial", "service_matrix"],
    proofPlacement: ["below_copy", "side_panel", "bottom_strip", "none"],
    ctaLayout: ["inline", "stacked", "button_plus_text_link", "callout_card"],
    mediaTreatment: ["flush", "framed", "rounded_panel", "bleed", "collage_pair"],
    headlineScale: ["compact", "standard", "display"]
  },
  media_mosaic: {
    mediaPattern: ["lead_left", "lead_center", "strip", "wall", "alternating_rows"],
    captionMode: ["none", "overlay", "below", "category_label"],
    cropSet: ["consistent", "mixed_editorial", "detail_zoom"]
  },
  location_showcase: {
    locationLayout: ["map_left_hours_right", "hours_card_over_map", "map_top_hours_below", "compact_visit_card"],
    statusBadge: ["none", "open_now", "closed_until", "appointment_only"],
    hoursDisplay: ["today_first", "full_week", "compact_week", "expandable"],
    actionCluster: ["directions_call", "call_first", "appointment_first"]
  },
  contact_split: {
    contactLayout: ["call_first", "form_first", "visit_first", "quote_card", "appointment_card"],
    formComplexity: ["none", "short", "detailed"],
    proofSidebar: ["none", "hours", "location", "trust_facts", "response_expectation"],
    ctaMode: ["phone", "booking", "estimate", "directions"]
  },
  eligibility_band: {
    eligibilityTreatment: ["logo_strip", "icon_cards", "statement_plus_list", "split_cta"]
  },
  service_index: {
    serviceIndexTreatment: ["categorized_menu", "dropdown_preview", "featured_services_plus_all"]
  },
  case_study_preview: {
    caseStudyTreatment: ["before_after_pair", "story_card", "media_plus_results", "three_step_case"]
  },
  comparison_table: {
    comparisonTreatment: ["feature_compare", "table_rows", "pros_cons_cards"]
  },
  team_story: {
    teamStoryTreatment: ["portrait_split", "founder_card", "team_strip"]
  },
  offer_band: {
    offerBandTreatment: ["coupon_panel", "financing_strip", "urgent_banner", "quiet_offer"]
  }
} as const;

export function validateSectionBlueprintV1(
  blueprint: SectionBlueprintV1,
  context: SectionBlueprintValidationContextV1 = {}
): SectionBlueprintValidationResultV1 {
  const issues: SectionBlueprintValidationIssueV1[] = [];

  if (blueprint.version !== sectionBlueprintVersionV1) {
    issues.push(issue("blueprint.version_invalid", `Expected ${sectionBlueprintVersionV1}.`, "version"));
  }
  if (!blueprint.id || typeof blueprint.id !== "string") {
    issues.push(issue("blueprint.id_invalid", "Blueprint id must be a non-empty string.", "id"));
  }
  if (!blueprintRolesV1.has(blueprint.role)) {
    issues.push(issue("blueprint.role_invalid", `Unknown blueprint role "${String(blueprint.role)}".`, "role"));
  }

  const definition = definitionForBlueprint(blueprint, issues);
  if (definition) {
    if (!isRenderableSectionTemplateV3(blueprint.templateId)) {
      issues.push(
        issue(
          "blueprint.template_not_renderable",
          `Template ${blueprint.templateId} is not renderable. Demoted templates must stay replay_only, not disappear from the renderer.`,
          "templateId"
        )
      );
    }
    if (blueprint.background) {
      if (!sectionTemplateAllowsBackgroundV3(blueprint.templateId, blueprint.background) || !foregroundForBackgroundV3(blueprint.background)) {
        issues.push(issue("blueprint.background_invalid", `Background is not valid for ${blueprint.templateId}.`, "background"));
      }
    }
    if (blueprint.slotCounts) {
      validateSlotCountsV1(blueprint, definition, issues);
    }
    if (blueprint.templateOptions) {
      validateTemplateOptionsV1(blueprint, issues);
    }
  }

  if (blueprint.presentation) {
    for (const violation of validateSectionPresentationMapV3(blueprint.presentation)) {
      issues.push(
        issue(
          "blueprint.presentation_invalid",
          violation.reason,
          `presentation.${violation.role}`
        )
      );
    }
  }

  if (blueprint.controls) validateControlsV1(blueprint.controls, issues);
  if (blueprint.assetRefs?.length) validateAssetRefsV1(blueprint.assetRefs, context, issues);

  return { ok: issues.length === 0, issues };
}

export function assertValidSectionBlueprintV1(blueprint: SectionBlueprintV1, context?: SectionBlueprintValidationContextV1): SectionBlueprintV1 {
  const validation = validateSectionBlueprintV1(blueprint, context);
  if (!validation.ok) {
    throw new Error(`Invalid SectionBlueprintV1 ${blueprint.id}: ${validation.issues.map((validationIssue) => validationIssue.message).join("; ")}`);
  }
  return blueprint;
}

export function presentationRolesForBlueprintV1(): readonly ArtDirectionSectionRoleV3[] {
  return Object.keys(compatiblePresentationsForRoleV3) as ArtDirectionSectionRoleV3[];
}

export function sectionBlueprintFromSectionInstanceV1(
  section: SectionInstanceV3,
  source: SectionBlueprintV1["source"] = "deterministic"
): SectionBlueprintV1 | undefined {
  const visualSection = getVisualSectionV3(section.props);
  if (!visualSection) return undefined;
  const blueprint: SectionBlueprintV1 = {
    version: sectionBlueprintVersionV1,
    id: section.id,
    source,
    role: sectionBlueprintRoleForSectionV1(section),
    templateId: visualSection.templateId,
    anchorId: visualSection.anchorId,
    background: visualSection.options.background,
    templateOptions: templateOptionsFromVisualSectionV1(visualSection),
    controls: section.controls,
    slotCounts: slotCountsForBlueprintV1(visualSection.slots as Record<string, unknown>)
  };
  const validation = validateSectionBlueprintV1(blueprint);
  if (validation.ok) return blueprint;
  if (source === "site_director") {
    return assertValidSectionBlueprintV1(blueprint);
  }
  return undefined;
}

export function sectionBlueprintsFromSectionInstancesV1(
  sections: readonly SectionInstanceV3[],
  source: SectionBlueprintV1["source"] = "deterministic"
): SectionBlueprintV1[] {
  return sections
    .map((section) => sectionBlueprintFromSectionInstanceV1(section, source))
    .filter((blueprint): blueprint is SectionBlueprintV1 => Boolean(blueprint));
}

function definitionForBlueprint(blueprint: SectionBlueprintV1, issues: SectionBlueprintValidationIssueV1[]) {
  try {
    return sectionTemplateDefinitionV3(blueprint.templateId);
  } catch {
    issues.push(issue("blueprint.template_unknown", `Unknown template ${String(blueprint.templateId)}.`, "templateId"));
    return undefined;
  }
}

function validateSlotCountsV1(
  blueprint: SectionBlueprintV1,
  definition: ReturnType<typeof sectionTemplateDefinitionV3>,
  issues: SectionBlueprintValidationIssueV1[]
) {
  const allowedSlots = new Set<string>([...definition.requiredSlots, ...definition.optionalSlots]);
  for (const [slot, count] of Object.entries(blueprint.slotCounts ?? {}) as Array<[SectionTemplateSlotIdV3, number]>) {
    if (!allowedSlots.has(slot)) {
      issues.push(issue("blueprint.slot_unknown", `Template ${blueprint.templateId} does not allow slot ${slot}.`, `slotCounts.${slot}`));
      continue;
    }
    if (!Number.isInteger(count) || count < 0) {
      issues.push(issue("blueprint.slot_count_invalid", `Slot count for ${slot} must be a non-negative integer.`, `slotCounts.${slot}`));
      continue;
    }
    const range = countRangeForSlotV1(slot, definition);
    if (range && (count < range.min || count > range.max)) {
      issues.push(
        issue("blueprint.slot_count_invalid", `Slot ${slot} count ${count} is outside ${blueprint.templateId}'s ${range.min}-${range.max} contract.`, `slotCounts.${slot}`)
      );
    }
  }
}

function countRangeForSlotV1(slot: SectionTemplateSlotIdV3, definition: ReturnType<typeof sectionTemplateDefinitionV3>): CountRangeV3 | undefined {
  if (slot === "items") return definition.itemCount;
  if (slot === "facts") return definition.factCount;
  if (slot === "media") return definition.mediaCount;
  return undefined;
}

function validateControlsV1(controls: ComponentControlSchemaV3, issues: SectionBlueprintValidationIssueV1[]) {
  for (const [field, allowed] of Object.entries(componentControlOptionsForBlueprintV1) as Array<[keyof ComponentControlSchemaV3, readonly string[]]>) {
    const value = controls[field];
    if (!allowed.includes(value)) {
      issues.push(issue("blueprint.control_invalid", `Control ${field}=${String(value)} is not in the V3 control enum.`, `controls.${field}`));
    }
  }
}

function validateTemplateOptionsV1(blueprint: SectionBlueprintV1, issues: SectionBlueprintValidationIssueV1[]) {
  const options = blueprint.templateOptions;
  if (!options) return;
  const allowed = templateOptionsForBlueprintV1[blueprint.templateId as keyof typeof templateOptionsForBlueprintV1] as Record<string, readonly string[]> | undefined;
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    const allowedValues = allowed?.[key];
    if (!allowedValues) {
      issues.push(
        issue(
          "blueprint.template_option_invalid",
          `Template ${blueprint.templateId} does not accept option ${key}.`,
          `templateOptions.${key}`
        )
      );
      continue;
    }
    if (!allowedValues.includes(String(value))) {
      issues.push(
        issue(
          "blueprint.template_option_invalid",
          `Template option ${key}=${String(value)} is not allowed for ${blueprint.templateId}.`,
          `templateOptions.${key}`
        )
      );
    }
  }
}

function validateAssetRefsV1(
  assetRefs: SectionBlueprintAssetRefV1[],
  context: SectionBlueprintValidationContextV1,
  issues: SectionBlueprintValidationIssueV1[]
) {
  if (!context.availableAssetIds) return;
  const available = new Set(context.availableAssetIds);
  for (const [index, assetRef] of assetRefs.entries()) {
    if (!available.has(assetRef.assetId)) {
      issues.push(issue("blueprint.asset_unknown", `Asset id ${assetRef.assetId} is not present in the director input manifest.`, `assetRefs.${index}.assetId`));
    }
  }
}

export function templateOptionsFromVisualSectionV1(section: VisualSectionV3): SectionBlueprintTemplateOptionsV1 | undefined {
  if (section.templateId === "intro_grid") {
    return compactTemplateOptionsV1({
      cardTreatment: section.options.cardTreatment,
      headingLayout: section.options.headingLayout,
      numberDisplay: section.options.numberDisplay,
      cardAction: section.options.cardAction,
      mediaAspect: section.options.mediaAspect,
      mediaCrop: section.options.mediaCrop,
      cardTone: section.options.cardTone,
      gridPattern: section.options.gridPattern
    });
  }
  if (section.templateId === "numbered_steps") {
    return compactTemplateOptionsV1({
      stepTreatment: section.options.stepTreatment,
      orientation: section.options.orientation,
      numberStyle: section.options.numberStyle,
      mediaMode: section.options.mediaMode,
      stepDensity: section.options.stepDensity
    });
  }
  if (section.templateId === "split_media") return { mediaSide: section.options.mediaSide };
  if (section.templateId === "hero_statement") {
    return compactTemplateOptionsV1({
      heroAlign: section.options.align,
      heroLayout: section.options.heroLayout,
      proofPlacement: section.options.proofPlacement,
      ctaLayout: section.options.ctaLayout,
      mediaTreatment: section.options.mediaTreatment,
      headlineScale: section.options.headlineScale
    });
  }
  if (section.templateId === "hero_split") {
    return compactTemplateOptionsV1({
      heroLayout: section.options.heroLayout,
      proofPlacement: section.options.proofPlacement,
      ctaLayout: section.options.ctaLayout,
      mediaTreatment: section.options.mediaTreatment,
      headlineScale: section.options.headlineScale
    });
  }
  if (section.templateId === "media_mosaic") {
    return compactTemplateOptionsV1({
      mediaPattern: section.options.mediaPattern,
      captionMode: section.options.captionMode,
      cropSet: section.options.cropSet
    });
  }
  if (section.templateId === "location_showcase") {
    return compactTemplateOptionsV1({
      locationLayout: section.options.locationLayout,
      statusBadge: section.options.statusBadge,
      hoursDisplay: section.options.hoursDisplay,
      actionCluster: section.options.actionCluster
    });
  }
  if (section.templateId === "contact_split") {
    return compactTemplateOptionsV1({
      contactLayout: section.options.contactLayout,
      formComplexity: section.options.formComplexity,
      proofSidebar: section.options.proofSidebar,
      ctaMode: section.options.ctaMode
    });
  }
  if (section.templateId === "eligibility_band") return compactTemplateOptionsV1({ eligibilityTreatment: section.options.eligibilityTreatment });
  if (section.templateId === "service_index") return compactTemplateOptionsV1({ serviceIndexTreatment: section.options.serviceIndexTreatment });
  if (section.templateId === "case_study_preview") return compactTemplateOptionsV1({ caseStudyTreatment: section.options.caseStudyTreatment });
  if (section.templateId === "comparison_table") return compactTemplateOptionsV1({ comparisonTreatment: section.options.comparisonTreatment });
  if (section.templateId === "team_story") return compactTemplateOptionsV1({ teamStoryTreatment: section.options.teamStoryTreatment });
  if (section.templateId === "offer_band") return compactTemplateOptionsV1({ offerBandTreatment: section.options.offerBandTreatment });
  return undefined;
}

function compactTemplateOptionsV1(options: SectionBlueprintTemplateOptionsV1): SectionBlueprintTemplateOptionsV1 | undefined {
  const compact = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as SectionBlueprintTemplateOptionsV1;
  return Object.keys(compact).length ? compact : undefined;
}

function sectionBlueprintRoleForSectionV1(section: SectionInstanceV3): SectionBlueprintRoleV1 {
  if (section.family.startsWith("hero.")) return "hero";
  if (section.family.startsWith("story.")) return "story";
  if (section.family.startsWith("highlights.")) return "highlights";
  if (section.family.startsWith("services.")) return "services";
  if (section.family.startsWith("process.")) return "process";
  if (section.family.startsWith("proof.")) return "proof";
  if (section.family.startsWith("media.")) return "media";
  if (section.family.startsWith("faq.")) return "faq";
  if (section.family.startsWith("local.")) return "local";
  if (section.family.startsWith("contact.")) return "contact";
  if (section.family.startsWith("statement.")) return "statement";
  if (section.family.startsWith("pricing.")) return "pricing";
  if (section.family.startsWith("feature.")) return "feature";
  if (section.id.includes("service")) return "services";
  if (section.id.includes("process")) return "process";
  if (section.id.includes("location")) return "local";
  if (section.id.includes("contact")) return "contact";
  return "proof";
}

function slotCountsForBlueprintV1(slots: Record<string, unknown>): SectionBlueprintSlotCountsV1 {
  const counts: SectionBlueprintSlotCountsV1 = {};
  for (const [slot, value] of Object.entries(slots) as Array<[SectionTemplateSlotIdV3, unknown]>) {
    const count = slotCountForBlueprintV1(value);
    if (count !== undefined) counts[slot] = count;
  }
  return counts;
}

function slotCountForBlueprintV1(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items.length;
  if (Array.isArray(record.locations)) return record.locations.length;
  if (Array.isArray(record.facts)) return record.facts.length;
  if (Array.isArray(record.media)) return record.media.length;
  return 1;
}

function issue(
  code: SectionBlueprintValidationIssueV1["code"],
  message: string,
  path?: string
): SectionBlueprintValidationIssueV1 {
  return { code, severity: "error", message, path };
}
