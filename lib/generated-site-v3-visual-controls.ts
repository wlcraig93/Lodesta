import {
  defaultBackgroundForTemplateV3,
  sectionTemplateAllowsBackgroundV3,
  sectionTemplateDefinitionV3
} from "./generated-site-v3-section-templates";

export type SectionTemplateIdV3 =
  | "hero_split"
  | "hero_statement"
  | "split_media"
  | "intro_grid"
  | "side_intro_rows"
  | "numbered_steps"
  | "feature_band"
  | "proof_pair"
  | "media_feature"
  | "media_mosaic"
  | "quote_wall"
  | "faq_list"
  | "facts_strip"
  | "facts_cta"
  | "stat_band"
  | "eligibility_band"
  | "service_index"
  | "case_study_preview"
  | "comparison_table"
  | "team_story"
  | "offer_band"
  | "editorial_statement"
  | "location_directory"
  | "service_area_showcase"
  | "location_showcase"
  | "contact_split";

export type BackgroundFocalPointV3 = "center" | "top" | "bottom" | "left" | "right";

export type SolidBackgroundV3 = {
  kind: "solid";
  token: "page" | "surface" | "dark" | "brand";
};

export type GradientBackgroundV3 = {
  kind: "gradient";
  token: "subtle" | "brand";
};

export type ImageBackgroundV3 = {
  kind: "image";
  url: string;
  focalPoint?: BackgroundFocalPointV3;
};

export type NonImageBackgroundV3 = SolidBackgroundV3 | GradientBackgroundV3;
export type SectionBackgroundOptionV3 = NonImageBackgroundV3 | ImageBackgroundV3;
export type SectionBackgroundKindV3 = SectionBackgroundOptionV3["kind"];

export type SectionForegroundV3 = {
  foreground: "#171512" | "#ffffff";
  muted: string;
  primaryButtonBackground: string;
  primaryButtonForeground: "#171512" | "#ffffff";
  primaryButtonBorder: string;
  secondaryButtonBackground: string;
  secondaryButtonForeground: "#171512" | "#ffffff";
  secondaryButtonBorder: string;
};

export type VisualCtaV3 = {
  label: string;
  href: string;
  style?: "primary" | "secondary" | "text";
};

export type VisualFactV3 = {
  label: string;
  value: string;
  href?: string;
};

export type VisualMediaItemV3 = {
  url: string;
  /**
   * Internal media-slot label. This is metadata for review/selection and is not
   * rendered as public caption copy.
   */
  label: string;
  /**
   * Internal media note. This is metadata for review/selection and is not
   * rendered as public caption copy.
   */
  caption?: string;
  /**
   * Optional visitor-facing caption. Only this field is rendered publicly.
   */
  publicCaption?: string;
  cropIntent?: "center" | "subject" | "wide" | "portrait";
};

export type StandardItemV3 = {
  title: string;
  body: string;
  meta?: string;
  mediaUrl?: string;
  /** Optional landing-page link rendered as an item-specific details affordance. */
  href?: string;
};

export type QuoteItemV3 = {
  quote: string;
  attribution?: string;
  context?: string;
};

export type FaqItemV3 = {
  question: string;
  answer: string;
};

export type CopySlotV3 = {
  eyebrow?: string;
  heading: string;
  body?: string;
  actions?: VisualCtaV3[];
};

export type MediaSlotV3 = {
  items: VisualMediaItemV3[];
  focalPoint?: BackgroundFocalPointV3;
  caption?: "none" | "overlay" | "below";
};

export type FactsSlotV3 = {
  items: VisualFactV3[];
};

export type ItemsSlotV3<TItem> = {
  items: TItem[];
};

export type ActionSlotV3 = {
  title: string;
  body?: string;
  facts?: VisualFactV3[];
  cta?: VisualCtaV3;
};

export type ContactSlotV3 = {
  facts: VisualFactV3[];
};

export type MapEmbedIntentV3 =
  | { kind: "place"; placeId: string; address?: string }
  | { kind: "address"; address: string }
  | { kind: "geo"; latitude: number; longitude: number };

export type RenderableLocationV3 = {
  id: string;
  label: string;
  role: "primary" | "covered";
  isPrimary: boolean;
  addressLine?: string;
  localityLine?: string;
  phone?: string;
  email?: string;
  hoursSummary?: string;
  hours?: Array<{ label: string; value: string }>;
  serviceAreas: string[];
  directionsUrl?: string;
  mapEmbedIntent?: MapEmbedIntentV3;
  href?: string;
};

export type LocationsSlotV3 = {
  locations: RenderableLocationV3[];
};

export type BaseSectionOptionsV3 = {
  background: SectionBackgroundOptionV3;
};

export type IntroGridCardTreatmentV3 = "standard" | "comparison" | "feature_cards" | "service_cards" | "media_top_cards" | "editorial_cards";
export type IntroGridHeadingLayoutV3 = "full_width" | "split_header" | "side_rail" | "compact_top";
export type IntroGridNumberDisplayV3 = "none" | "subtle_index" | "badge";
export type IntroGridCardActionV3 = "none" | "text_link" | "bottom_aligned_button" | "full_width_button";
export type IntroGridMediaAspectV3 = "none" | "square" | "4x3" | "16x10" | "portrait";
export type IntroGridMediaCropV3 = "center" | "subject" | "wide" | "detail_zoom";
export type IntroGridCardToneV3 = "uniform" | "alternating_surface" | "featured_first" | "dark_feature";
export type IntroGridPatternV3 = "equal_grid" | "lead_card" | "mixed_masonry" | "two_by_two" | "compact_rows";
export type NumberedStepsTreatmentV3 = "stepper_vertical" | "checklist_cards" | "numbered_ledger";
export type NumberedStepsOrientationV3 = "vertical" | "horizontal" | "timeline" | "cards" | "ledger";
export type NumberedStepsNumberStyleV3 = "none" | "small_badge" | "oversized" | "connector";
export type NumberedStepsMediaModeV3 = "none" | "one_feature_image" | "per_step_media";
export type NumberedStepsDensityV3 = "compact" | "balanced" | "detailed";
export type SplitMediaSideV3 = "left" | "right";
export type HeroLayoutV3 = "classic_split" | "media_left" | "editorial_overlap" | "card_overlay" | "full_bleed_masthead" | "text_first";
export type HeroProofPlacementV3 = "below_copy" | "side_panel" | "bottom_strip" | "none";
export type HeroCtaLayoutV3 = "inline" | "stacked" | "button_plus_text_link" | "callout_card";
export type HeroMediaTreatmentV3 = "flush" | "framed" | "rounded_panel" | "bleed" | "collage_pair";
export type HeroHeadlineScaleV3 = "compact" | "standard" | "display";
export type LocationLayoutV3 = "map_left_hours_right" | "hours_card_over_map" | "map_top_hours_below" | "compact_visit_card";
export type LocationStatusBadgeV3 = "none" | "open_now" | "closed_until" | "appointment_only";
export type LocationHoursDisplayV3 = "today_first" | "full_week" | "compact_week" | "expandable";
export type LocationActionClusterV3 = "directions_call" | "call_first" | "appointment_first";
export type ContactLayoutV3 = "call_first" | "form_first" | "visit_first" | "quote_card" | "appointment_card";
export type ContactFormComplexityV3 = "none" | "short" | "detailed";
export type ContactProofSidebarV3 = "none" | "hours" | "location" | "trust_facts" | "response_expectation";
export type ContactCtaModeV3 = "phone" | "booking" | "estimate" | "directions";
export type MediaPatternV3 = "lead_left" | "lead_center" | "strip" | "wall" | "alternating_rows";
export type MediaCaptionModeV3 = "none" | "overlay" | "below" | "category_label";
export type MediaCropSetV3 = "consistent" | "mixed_editorial" | "detail_zoom";
export type EligibilityBandTreatmentV3 = "logo_strip" | "icon_cards" | "statement_plus_list" | "split_cta";
export type ServiceIndexTreatmentV3 = "categorized_menu" | "dropdown_preview" | "featured_services_plus_all";
export type CaseStudyTreatmentV3 = "before_after_pair" | "story_card" | "media_plus_results" | "three_step_case";
export type ComparisonTreatmentV3 = "feature_compare" | "table_rows" | "pros_cons_cards";
export type TeamStoryTreatmentV3 = "portrait_split" | "founder_card" | "team_strip";
export type OfferBandTreatmentV3 = "coupon_panel" | "financing_strip" | "urgent_banner" | "quiet_offer";
export type VisualSectionPresentationV3 = import("./generated-site-v3-art-direction-catalog").SectionPresentationMapV3;

export type HeroSplitSectionV3 = {
  version: "visual-section-v3";
  templateId: "hero_split";
  options: { background: NonImageBackgroundV3; heroLayout?: HeroLayoutV3; proofPlacement?: HeroProofPlacementV3; ctaLayout?: HeroCtaLayoutV3; mediaTreatment?: HeroMediaTreatmentV3; headlineScale?: HeroHeadlineScaleV3 };
  slots: { copy: CopySlotV3; media: MediaSlotV3; facts?: FactsSlotV3 };
  anchorId?: string;
};

export type HeroStatementSectionV3 = {
  version: "visual-section-v3";
  templateId: "hero_statement";
  options: { align: "left" | "center"; background: SectionBackgroundOptionV3; heroLayout?: HeroLayoutV3; proofPlacement?: HeroProofPlacementV3; ctaLayout?: HeroCtaLayoutV3; mediaTreatment?: HeroMediaTreatmentV3; headlineScale?: HeroHeadlineScaleV3 };
  slots: { copy: CopySlotV3; facts?: FactsSlotV3; action?: ActionSlotV3 };
  anchorId?: string;
};

export type HeroSectionV3 = HeroSplitSectionV3 | HeroStatementSectionV3;

export type SplitMediaSectionV3 = {
  version: "visual-section-v3";
  templateId: "split_media";
  options: BaseSectionOptionsV3 & { mediaSide: SplitMediaSideV3 };
  slots: { copy: CopySlotV3; media: MediaSlotV3; facts?: FactsSlotV3 };
  anchorId?: string;
};

type BaseVisualSectionV3<TTemplateId extends Exclude<SectionTemplateIdV3, "hero_split" | "hero_statement" | "split_media" | "intro_grid">, TSlots> = {
  version: "visual-section-v3";
  templateId: TTemplateId;
  options: BaseSectionOptionsV3;
  slots: TSlots;
  anchorId?: string;
};

export type IntroGridSectionV3 = {
  version: "visual-section-v3";
  templateId: "intro_grid";
  options: BaseSectionOptionsV3 & {
    cardTreatment?: IntroGridCardTreatmentV3;
    headingLayout?: IntroGridHeadingLayoutV3;
    numberDisplay?: IntroGridNumberDisplayV3;
    cardAction?: IntroGridCardActionV3;
    mediaAspect?: IntroGridMediaAspectV3;
    mediaCrop?: IntroGridMediaCropV3;
    cardTone?: IntroGridCardToneV3;
    gridPattern?: IntroGridPatternV3;
  };
  slots: { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3>; action?: ActionSlotV3 };
  anchorId?: string;
};
export type SideIntroRowsSectionV3 = BaseVisualSectionV3<"side_intro_rows", { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3> }>;
/** Full-width ordered steps; treatment selects large stepper or compact ledger geometry. */
export type NumberedStepsSectionV3 = {
  version: "visual-section-v3";
  templateId: "numbered_steps";
  options: BaseSectionOptionsV3 & {
    stepTreatment?: NumberedStepsTreatmentV3;
    orientation?: NumberedStepsOrientationV3;
    numberStyle?: NumberedStepsNumberStyleV3;
    mediaMode?: NumberedStepsMediaModeV3;
    stepDensity?: NumberedStepsDensityV3;
  };
  slots: { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3> };
  anchorId?: string;
};
/** Signature moment: one oversized verified stat beside short supporting copy. */
export type StatBandSectionV3 = BaseVisualSectionV3<"stat_band", { copy: CopySlotV3; facts: FactsSlotV3; action?: ActionSlotV3 }>;
export type FeatureBandSectionV3 = BaseVisualSectionV3<"feature_band", { copy: CopySlotV3; facts: FactsSlotV3; action?: ActionSlotV3 }>;
export type ProofPairSectionV3 = BaseVisualSectionV3<"proof_pair", { copy: CopySlotV3; media: MediaSlotV3; facts?: FactsSlotV3 }>;
export type MediaFeatureSectionV3 = BaseVisualSectionV3<"media_feature", { copy: CopySlotV3; media: MediaSlotV3 }>;
export type MediaMosaicSectionV3 = {
  version: "visual-section-v3";
  templateId: "media_mosaic";
  options: BaseSectionOptionsV3 & { mediaPattern?: MediaPatternV3; captionMode?: MediaCaptionModeV3; cropSet?: MediaCropSetV3 };
  slots: { copy: CopySlotV3; media: MediaSlotV3 };
  anchorId?: string;
};
export type QuoteWallSectionV3 = BaseVisualSectionV3<"quote_wall", { intro: CopySlotV3; items: ItemsSlotV3<QuoteItemV3> }>;
export type FaqListSectionV3 = BaseVisualSectionV3<"faq_list", { intro: CopySlotV3; items: ItemsSlotV3<FaqItemV3> }>;
export type FactsStripSectionV3 = BaseVisualSectionV3<"facts_strip", { facts: FactsSlotV3 }>;
export type FactsCtaSectionV3 = BaseVisualSectionV3<"facts_cta", { facts: FactsSlotV3; action: ActionSlotV3 }>;
export type EligibilityBandSectionV3 = {
  version: "visual-section-v3";
  templateId: "eligibility_band";
  options: BaseSectionOptionsV3 & { eligibilityTreatment?: EligibilityBandTreatmentV3 };
  slots: { copy: CopySlotV3; facts: FactsSlotV3; action?: ActionSlotV3 };
  anchorId?: string;
};
export type ServiceIndexSectionV3 = {
  version: "visual-section-v3";
  templateId: "service_index";
  options: BaseSectionOptionsV3 & { serviceIndexTreatment?: ServiceIndexTreatmentV3 };
  slots: { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3>; action?: ActionSlotV3 };
  anchorId?: string;
};
export type CaseStudyPreviewSectionV3 = {
  version: "visual-section-v3";
  templateId: "case_study_preview";
  options: BaseSectionOptionsV3 & { caseStudyTreatment?: CaseStudyTreatmentV3 };
  slots: { copy: CopySlotV3; media: MediaSlotV3; facts?: FactsSlotV3 };
  anchorId?: string;
};
export type ComparisonTableSectionV3 = {
  version: "visual-section-v3";
  templateId: "comparison_table";
  options: BaseSectionOptionsV3 & { comparisonTreatment?: ComparisonTreatmentV3 };
  slots: { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3>; action?: ActionSlotV3 };
  anchorId?: string;
};
export type TeamStorySectionV3 = {
  version: "visual-section-v3";
  templateId: "team_story";
  options: BaseSectionOptionsV3 & { teamStoryTreatment?: TeamStoryTreatmentV3 };
  slots: { copy: CopySlotV3; media?: MediaSlotV3; facts?: FactsSlotV3 };
  anchorId?: string;
};
export type OfferBandSectionV3 = {
  version: "visual-section-v3";
  templateId: "offer_band";
  options: BaseSectionOptionsV3 & { offerBandTreatment?: OfferBandTreatmentV3 };
  slots: { copy: CopySlotV3; action: ActionSlotV3; facts?: FactsSlotV3 };
  anchorId?: string;
};
export type EditorialStatementSectionV3 = BaseVisualSectionV3<"editorial_statement", { copy: CopySlotV3; action?: ActionSlotV3 }>;
export type LocationDirectorySectionV3 = BaseVisualSectionV3<"location_directory", { copy: CopySlotV3; locations: LocationsSlotV3; action?: ActionSlotV3 }>;
export type ServiceAreaShowcaseSectionV3 = BaseVisualSectionV3<"service_area_showcase", { copy: CopySlotV3; facts: FactsSlotV3; action?: ActionSlotV3 }>;
/** Destination treatment for single-location businesses: display-scale hours, map, and direction actions. */
export type LocationShowcaseSectionV3 = {
  version: "visual-section-v3";
  templateId: "location_showcase";
  options: BaseSectionOptionsV3 & { locationLayout?: LocationLayoutV3; statusBadge?: LocationStatusBadgeV3; hoursDisplay?: LocationHoursDisplayV3; actionCluster?: LocationActionClusterV3 };
  slots: { copy: CopySlotV3; locations: LocationsSlotV3; action?: ActionSlotV3 };
  anchorId?: string;
};
export type ContactSplitSectionV3 = {
  version: "visual-section-v3";
  templateId: "contact_split";
  options: BaseSectionOptionsV3 & { contactLayout?: ContactLayoutV3; formComplexity?: ContactFormComplexityV3; proofSidebar?: ContactProofSidebarV3; ctaMode?: ContactCtaModeV3 };
  slots: { copy: CopySlotV3; contact: ContactSlotV3; action?: ActionSlotV3 };
  anchorId?: string;
};

export type VisualSectionV3 = (
  | HeroSplitSectionV3
  | HeroStatementSectionV3
  | SplitMediaSectionV3
  | IntroGridSectionV3
  | SideIntroRowsSectionV3
  | NumberedStepsSectionV3
  | StatBandSectionV3
  | FeatureBandSectionV3
  | ProofPairSectionV3
  | MediaFeatureSectionV3
  | MediaMosaicSectionV3
  | QuoteWallSectionV3
  | FaqListSectionV3
  | FactsStripSectionV3
  | FactsCtaSectionV3
  | EligibilityBandSectionV3
  | ServiceIndexSectionV3
  | CaseStudyPreviewSectionV3
  | ComparisonTableSectionV3
  | TeamStorySectionV3
  | OfferBandSectionV3
  | EditorialStatementSectionV3
  | LocationDirectorySectionV3
  | ServiceAreaShowcaseSectionV3
  | LocationShowcaseSectionV3
  | ContactSplitSectionV3
) & { presentation?: VisualSectionPresentationV3 };

export type VisualSectionDraftV3 = VisualSectionV3;

export type VisualSectionBreakpointV3 = "desktop" | "tablet" | "mobile";

export type VisualSectionConstraintViolationV3 = {
  id: string;
  severity: "warning" | "error";
  message: string;
  slotId?: string;
  breakpoint?: VisualSectionBreakpointV3;
};

export type VisualSectionCompileResultV3 = {
  section: VisualSectionV3;
  violations: VisualSectionConstraintViolationV3[];
};

export type VisualSectionRenderStateV3 = {
  gridColumns: number;
  rhythmRole: string;
  minHeight: "auto" | "short" | "viewport_minus_header" | "feature";
  contentAlign: "start" | "center";
  fullBleed: boolean;
};

export const visualSectionPropKeyV3 = "visualSectionV3";

const lightForeground = "#ffffff" as const;
const darkForeground = "#171512" as const;

const solidBackgroundColors: Record<SolidBackgroundV3["token"], string> = {
  page: "#eef2f4",
  surface: "#ffffff",
  dark: "#12100d",
  brand: "#17324a"
};

const gradientBackgroundColors: Record<GradientBackgroundV3["token"], [string, string]> = {
  subtle: ["#ffffff", "#e3eaee"],
  brand: ["#11181f", "#17324a"]
};

const legacyAuthoredFields = [
  "sectionPurposeId",
  "sectionVariantId",
  "sectionTemplateId",
  "densityId",
  "emphasisId",
  "layoutBalanceId",
  "responsive",
  "blocks",
  "frame"
] as const;

export function withVisualSectionV3<T extends Record<string, unknown>>(props: T, visualSection?: VisualSectionV3): T & { visualSectionV3?: VisualSectionV3 } {
  if (!visualSection) return props;
  return { ...props, [visualSectionPropKeyV3]: visualSection };
}

export function getVisualSectionV3(props: Record<string, unknown>): VisualSectionV3 | undefined {
  const candidate = props[visualSectionPropKeyV3];
  if (!candidate || typeof candidate !== "object") return undefined;
  const section = candidate as Partial<VisualSectionV3>;
  if (section.version !== "visual-section-v3") return undefined;
  if (!section.templateId || !knownTemplateIdV3(section.templateId)) return undefined;
  if (!section.options || typeof section.options !== "object") return undefined;
  if (!("background" in section.options) || !section.options.background) return undefined;
  if (!section.slots || typeof section.slots !== "object") return undefined;
  return section as VisualSectionV3;
}

export function compileVisualSectionV3(section: VisualSectionV3): VisualSectionCompileResultV3 {
  const violations: VisualSectionConstraintViolationV3[] = [];
  validateNoLegacyAuthoredFieldsV3(section, violations);
  const background = compileSectionBackgroundV3(section, violations);
  const compiled = normalizeTemplateOptionsV3({ ...section, options: { ...section.options, background } } as VisualSectionV3, violations);
  validateTemplateContractV3(compiled, violations);
  return { section: compiled, violations };
}

export function visualSectionRenderStateV3(section: VisualSectionV3): VisualSectionRenderStateV3 {
  const definition = sectionTemplateDefinitionV3(section.templateId);
  const hero = isHeroSectionV3(section);
  const fullBleed = section.templateId === "hero_statement" && section.options.background.kind === "image";
  return {
    gridColumns: 12,
    rhythmRole: definition.rhythmRole,
    minHeight: fullBleed || hero ? "viewport_minus_header" : definition.visualWeight === "feature" ? "feature" : definition.visualWeight === "quiet" ? "short" : "auto",
    contentAlign: hero || section.templateId === "editorial_statement" ? "center" : "start",
    fullBleed
  };
}

export function validateVisualSectionV3(section: VisualSectionV3): VisualSectionConstraintViolationV3[] {
  return compileVisualSectionV3(section).violations;
}

export function repairVisualSectionV3(section: VisualSectionV3): VisualSectionV3 {
  if (!isInvalidImageStatementHeroSectionV3(section)) return section;
  return {
    version: "visual-section-v3",
    templateId: "hero_statement",
    options: { align: "center", background: { kind: "gradient", token: "subtle" } },
    anchorId: section.anchorId,
    slots: {
      copy: section.slots.copy,
      action: section.slots.action
    }
  };
}

export function foregroundForBackgroundV3(background: SectionBackgroundOptionV3): SectionForegroundV3 | undefined {
  const colors = foregroundCandidateColorsV3(background);
  if (!colors.length) return undefined;
  const darkMinimum = Math.min(...colors.map((color) => contrastRatioV3(darkForeground, color) ?? 0));
  const lightMinimum = Math.min(...colors.map((color) => contrastRatioV3(lightForeground, color) ?? 0));
  const foreground = darkMinimum >= 4.5 || darkMinimum >= lightMinimum ? darkForeground : lightForeground;
  const minimum = foreground === darkForeground ? darkMinimum : lightMinimum;
  if (minimum < 4.5) return undefined;
  return sectionForegroundTokensV3(foreground, colors[0] ?? "#ffffff");
}

export function contrastSafeSolidBackgroundV3(background: SolidBackgroundV3) {
  return Boolean(foregroundForBackgroundV3(background));
}

export function contrastRatioV3(foreground: string, background: string): number | undefined {
  const foregroundRgb = parseHexColorV3(foreground);
  const backgroundRgb = parseHexColorV3(background);
  if (!foregroundRgb || !backgroundRgb) return undefined;
  const fg = relativeLuminanceV3(foregroundRgb);
  const bg = relativeLuminanceV3(backgroundRgb);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function validateNoLegacyAuthoredFieldsV3(section: VisualSectionV3, violations: VisualSectionConstraintViolationV3[]) {
  const rawSection = section as unknown as Record<string, unknown>;
  for (const field of legacyAuthoredFields) {
    if (field in rawSection) {
      violations.push({
        id: "visual.legacy_authored_field",
        severity: "error",
        message: `Visual sections may not author legacy renderer field ${field}.`,
        breakpoint: "desktop"
      });
    }
  }
  if (hasOverlayFieldV3(section.options.background)) {
    violations.push({
      id: "visual.background_overlay_disallowed",
      severity: "error",
      message: "Background overlays are renderer-derived and may not be authored.",
      breakpoint: "desktop"
    });
  }
}

function compileSectionBackgroundV3(section: VisualSectionV3, violations: VisualSectionConstraintViolationV3[]): SectionBackgroundOptionV3 {
  const background = section.options.background as unknown as SectionBackgroundOptionV3;
  if (!isSectionBackgroundOptionV3(background)) {
    violations.push({
      id: "visual.background_shape_invalid",
      severity: "error",
      message: `Background shape is invalid for ${section.templateId}; using the template default.`,
      breakpoint: "desktop"
    });
    return defaultBackgroundForTemplateV3(section.templateId);
  }

  if (!sectionTemplateAllowsBackgroundV3(section.templateId, background)) {
    violations.push({
      id: "visual.background_kind_disallowed",
      severity: "error",
      message: `Background ${background.kind}:${"token" in background ? background.token : "image"} is not allowed for ${section.templateId}; using the template default.`,
      breakpoint: "desktop"
    });
    return defaultBackgroundForTemplateV3(section.templateId);
  }

  if (!foregroundForBackgroundV3(background)) {
    violations.push({
      id: "visual.background_contrast_invalid",
      severity: "error",
      message: "Background cannot support contrast-safe foreground text; using the template default.",
      breakpoint: "desktop"
    });
    return defaultBackgroundForTemplateV3(section.templateId);
  }

  return background;
}

function validateTemplateContractV3(section: VisualSectionV3, violations: VisualSectionConstraintViolationV3[]) {
  const definition = sectionTemplateDefinitionV3(section.templateId);
  const slots = section.slots as Record<string, unknown>;
  for (const slot of definition.requiredSlots) {
    if (!slots[slot]) {
      violations.push({
        id: "visual.required_slot_missing",
        severity: "error",
        message: `Template ${section.templateId} requires slot ${slot}.`,
        slotId: slot,
        breakpoint: "desktop"
      });
    }
  }
  const allowedSlots = new Set<string>([...definition.requiredSlots, ...definition.optionalSlots]);
  for (const slot of Object.keys(slots)) {
    if (!allowedSlots.has(slot)) {
      violations.push({
        id: "visual.slot_disallowed",
        severity: "error",
        message: `Template ${section.templateId} does not allow slot ${slot}.`,
        slotId: slot,
        breakpoint: "desktop"
      });
    }
  }

  validateCountV3("facts", factsCountForSectionV3(section), definition.factCount, section.templateId, violations);
  validateCountV3("items", itemsCountForSectionV3(section), definition.itemCount, section.templateId, violations);
  validateCountV3("media", mediaCountForSectionV3(section), definition.mediaCount, section.templateId, violations);

  if (isHeroSectionV3(section)) {
    validateHeroContractV3(section, violations);
  }
}

function validateHeroContractV3(section: HeroSectionV3, violations: VisualSectionConstraintViolationV3[]) {
  const background = section.options.background as SectionBackgroundOptionV3;
  if (section.templateId === "hero_split" && background.kind === "image") {
    violations.push({
      id: "visual.hero_split_image_background_disallowed",
      severity: "error",
      message: "Split hero intentionally excludes image backgrounds because it already has a dedicated media slot.",
      breakpoint: "desktop"
    });
  }
  if (section.templateId === "hero_statement" && background.kind === "image" && !eligibleImageBackgroundV3(background)) {
    violations.push({
      id: "visual.hero_statement_image_background_missing_eligible_media",
      severity: "error",
      message: "Image-backed hero statement requires one eligible image background URL.",
      breakpoint: "desktop"
    });
  }
}

function normalizeTemplateOptionsV3(section: VisualSectionV3, violations: VisualSectionConstraintViolationV3[]): VisualSectionV3 {
  let normalized = section;

  if (section.templateId === "split_media") {
    const mediaSide = normalizeEnumOptionV3(section.options.mediaSide, splitMediaSideOptionsV3, "left", "split_media_side", "SplitMedia mediaSide", violations);
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        mediaSide
      }
    } as VisualSectionV3;
  }

  if (normalized.templateId === "intro_grid") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        cardTreatment: normalizeOptionalEnumOptionV3(normalized.options.cardTreatment, introGridCardTreatmentOptionsV3, "standard", "intro_grid_card_treatment", "IntroGrid cardTreatment", violations),
        headingLayout: normalizeOptionalEnumOptionV3(normalized.options.headingLayout, introGridHeadingLayoutOptionsV3, "full_width", "intro_grid_heading_layout", "IntroGrid headingLayout", violations),
        numberDisplay: normalizeOptionalEnumOptionV3(normalized.options.numberDisplay, introGridNumberDisplayOptionsV3, "none", "intro_grid_number_display", "IntroGrid numberDisplay", violations),
        cardAction: normalizeOptionalEnumOptionV3(normalized.options.cardAction, introGridCardActionOptionsV3, "text_link", "intro_grid_card_action", "IntroGrid cardAction", violations),
        mediaAspect: normalizeOptionalEnumOptionV3(normalized.options.mediaAspect, introGridMediaAspectOptionsV3, "16x10", "intro_grid_media_aspect", "IntroGrid mediaAspect", violations),
        mediaCrop: normalizeOptionalEnumOptionV3(normalized.options.mediaCrop, introGridMediaCropOptionsV3, "subject", "intro_grid_media_crop", "IntroGrid mediaCrop", violations),
        cardTone: normalizeOptionalEnumOptionV3(normalized.options.cardTone, introGridCardToneOptionsV3, "uniform", "intro_grid_card_tone", "IntroGrid cardTone", violations),
        gridPattern: normalizeOptionalEnumOptionV3(normalized.options.gridPattern, introGridPatternOptionsV3, "equal_grid", "intro_grid_pattern", "IntroGrid gridPattern", violations)
      }
    };
  }

  if (normalized.templateId === "numbered_steps") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        stepTreatment: normalizeOptionalEnumOptionV3(normalized.options.stepTreatment, numberedStepsTreatmentOptionsV3, "stepper_vertical", "numbered_steps_treatment", "NumberedSteps stepTreatment", violations),
        orientation: normalizeOptionalEnumOptionV3(normalized.options.orientation, numberedStepsOrientationOptionsV3, "vertical", "numbered_steps_orientation", "NumberedSteps orientation", violations),
        numberStyle: normalizeOptionalEnumOptionV3(normalized.options.numberStyle, numberedStepsNumberStyleOptionsV3, "small_badge", "numbered_steps_number_style", "NumberedSteps numberStyle", violations),
        mediaMode: normalizeOptionalEnumOptionV3(normalized.options.mediaMode, numberedStepsMediaModeOptionsV3, "none", "numbered_steps_media_mode", "NumberedSteps mediaMode", violations),
        stepDensity: normalizeOptionalEnumOptionV3(normalized.options.stepDensity, numberedStepsDensityOptionsV3, "balanced", "numbered_steps_density", "NumberedSteps stepDensity", violations)
      }
    };
  }

  if (normalized.templateId === "hero_split" || normalized.templateId === "hero_statement") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        heroLayout: normalizeOptionalEnumOptionV3(normalized.options.heroLayout, heroLayoutOptionsV3, "classic_split", "hero_layout", "Hero heroLayout", violations),
        proofPlacement: normalizeOptionalEnumOptionV3(normalized.options.proofPlacement, heroProofPlacementOptionsV3, "below_copy", "hero_proof_placement", "Hero proofPlacement", violations),
        ctaLayout: normalizeOptionalEnumOptionV3(normalized.options.ctaLayout, heroCtaLayoutOptionsV3, "inline", "hero_cta_layout", "Hero ctaLayout", violations),
        mediaTreatment: normalizeOptionalEnumOptionV3(normalized.options.mediaTreatment, heroMediaTreatmentOptionsV3, "framed", "hero_media_treatment", "Hero mediaTreatment", violations),
        headlineScale: normalizeOptionalEnumOptionV3(normalized.options.headlineScale, heroHeadlineScaleOptionsV3, "standard", "hero_headline_scale", "Hero headlineScale", violations)
      }
    } as VisualSectionV3;
  }

  if (normalized.templateId === "media_mosaic") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        mediaPattern: normalizeOptionalEnumOptionV3(normalized.options.mediaPattern, mediaPatternOptionsV3, "lead_left", "media_pattern", "MediaMosaic mediaPattern", violations),
        captionMode: normalizeOptionalEnumOptionV3(normalized.options.captionMode, mediaCaptionModeOptionsV3, "below", "media_caption_mode", "MediaMosaic captionMode", violations),
        cropSet: normalizeOptionalEnumOptionV3(normalized.options.cropSet, mediaCropSetOptionsV3, "consistent", "media_crop_set", "MediaMosaic cropSet", violations)
      }
    };
  }

  if (normalized.templateId === "location_showcase") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        locationLayout: normalizeOptionalEnumOptionV3(normalized.options.locationLayout, locationLayoutOptionsV3, "map_left_hours_right", "location_layout", "LocationShowcase locationLayout", violations),
        statusBadge: normalizeOptionalEnumOptionV3(normalized.options.statusBadge, locationStatusBadgeOptionsV3, "open_now", "location_status_badge", "LocationShowcase statusBadge", violations),
        hoursDisplay: normalizeOptionalEnumOptionV3(normalized.options.hoursDisplay, locationHoursDisplayOptionsV3, "full_week", "location_hours_display", "LocationShowcase hoursDisplay", violations),
        actionCluster: normalizeOptionalEnumOptionV3(normalized.options.actionCluster, locationActionClusterOptionsV3, "directions_call", "location_action_cluster", "LocationShowcase actionCluster", violations)
      }
    };
  }

  if (normalized.templateId === "contact_split") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        contactLayout: normalizeOptionalEnumOptionV3(normalized.options.contactLayout, contactLayoutOptionsV3, "call_first", "contact_layout", "ContactSplit contactLayout", violations),
        formComplexity: normalizeOptionalEnumOptionV3(normalized.options.formComplexity, contactFormComplexityOptionsV3, "short", "contact_form_complexity", "ContactSplit formComplexity", violations),
        proofSidebar: normalizeOptionalEnumOptionV3(normalized.options.proofSidebar, contactProofSidebarOptionsV3, "trust_facts", "contact_proof_sidebar", "ContactSplit proofSidebar", violations),
        ctaMode: normalizeOptionalEnumOptionV3(normalized.options.ctaMode, contactCtaModeOptionsV3, "phone", "contact_cta_mode", "ContactSplit ctaMode", violations)
      }
    };
  }

  if (normalized.templateId === "eligibility_band") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        eligibilityTreatment: normalizeOptionalEnumOptionV3(normalized.options.eligibilityTreatment, eligibilityBandTreatmentOptionsV3, "statement_plus_list", "eligibility_treatment", "EligibilityBand eligibilityTreatment", violations)
      }
    };
  }

  if (normalized.templateId === "service_index") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        serviceIndexTreatment: normalizeOptionalEnumOptionV3(normalized.options.serviceIndexTreatment, serviceIndexTreatmentOptionsV3, "categorized_menu", "service_index_treatment", "ServiceIndex serviceIndexTreatment", violations)
      }
    };
  }

  if (normalized.templateId === "case_study_preview") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        caseStudyTreatment: normalizeOptionalEnumOptionV3(normalized.options.caseStudyTreatment, caseStudyTreatmentOptionsV3, "story_card", "case_study_treatment", "CaseStudyPreview caseStudyTreatment", violations)
      }
    };
  }

  if (normalized.templateId === "comparison_table") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        comparisonTreatment: normalizeOptionalEnumOptionV3(normalized.options.comparisonTreatment, comparisonTreatmentOptionsV3, "feature_compare", "comparison_treatment", "ComparisonTable comparisonTreatment", violations)
      }
    };
  }

  if (normalized.templateId === "team_story") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        teamStoryTreatment: normalizeOptionalEnumOptionV3(normalized.options.teamStoryTreatment, teamStoryTreatmentOptionsV3, "portrait_split", "team_story_treatment", "TeamStory teamStoryTreatment", violations)
      }
    };
  }

  if (normalized.templateId === "offer_band") {
    normalized = {
      ...normalized,
      options: {
        ...normalized.options,
        offerBandTreatment: normalizeOptionalEnumOptionV3(normalized.options.offerBandTreatment, offerBandTreatmentOptionsV3, "quiet_offer", "offer_band_treatment", "OfferBand offerBandTreatment", violations)
      }
    };
  }

  return normalized;
}

const introGridCardTreatmentOptionsV3 = ["standard", "comparison", "feature_cards", "service_cards", "media_top_cards", "editorial_cards"] as const satisfies readonly IntroGridCardTreatmentV3[];
const introGridHeadingLayoutOptionsV3 = ["full_width", "split_header", "side_rail", "compact_top"] as const satisfies readonly IntroGridHeadingLayoutV3[];
const introGridNumberDisplayOptionsV3 = ["none", "subtle_index", "badge"] as const satisfies readonly IntroGridNumberDisplayV3[];
const introGridCardActionOptionsV3 = ["none", "text_link", "bottom_aligned_button", "full_width_button"] as const satisfies readonly IntroGridCardActionV3[];
const introGridMediaAspectOptionsV3 = ["none", "square", "4x3", "16x10", "portrait"] as const satisfies readonly IntroGridMediaAspectV3[];
const introGridMediaCropOptionsV3 = ["center", "subject", "wide", "detail_zoom"] as const satisfies readonly IntroGridMediaCropV3[];
const introGridCardToneOptionsV3 = ["uniform", "alternating_surface", "featured_first", "dark_feature"] as const satisfies readonly IntroGridCardToneV3[];
const introGridPatternOptionsV3 = ["equal_grid", "lead_card", "mixed_masonry", "two_by_two", "compact_rows"] as const satisfies readonly IntroGridPatternV3[];
const numberedStepsTreatmentOptionsV3 = ["stepper_vertical", "checklist_cards", "numbered_ledger"] as const satisfies readonly NumberedStepsTreatmentV3[];
const numberedStepsOrientationOptionsV3 = ["vertical", "horizontal", "timeline", "cards", "ledger"] as const satisfies readonly NumberedStepsOrientationV3[];
const numberedStepsNumberStyleOptionsV3 = ["none", "small_badge", "oversized", "connector"] as const satisfies readonly NumberedStepsNumberStyleV3[];
const numberedStepsMediaModeOptionsV3 = ["none", "one_feature_image", "per_step_media"] as const satisfies readonly NumberedStepsMediaModeV3[];
const numberedStepsDensityOptionsV3 = ["compact", "balanced", "detailed"] as const satisfies readonly NumberedStepsDensityV3[];
const splitMediaSideOptionsV3 = ["left", "right"] as const satisfies readonly SplitMediaSideV3[];
const heroLayoutOptionsV3 = ["classic_split", "media_left", "editorial_overlap", "card_overlay", "full_bleed_masthead", "text_first"] as const satisfies readonly HeroLayoutV3[];
const heroProofPlacementOptionsV3 = ["below_copy", "side_panel", "bottom_strip", "none"] as const satisfies readonly HeroProofPlacementV3[];
const heroCtaLayoutOptionsV3 = ["inline", "stacked", "button_plus_text_link", "callout_card"] as const satisfies readonly HeroCtaLayoutV3[];
const heroMediaTreatmentOptionsV3 = ["flush", "framed", "rounded_panel", "bleed", "collage_pair"] as const satisfies readonly HeroMediaTreatmentV3[];
const heroHeadlineScaleOptionsV3 = ["compact", "standard", "display"] as const satisfies readonly HeroHeadlineScaleV3[];
const locationLayoutOptionsV3 = ["map_left_hours_right", "hours_card_over_map", "map_top_hours_below", "compact_visit_card"] as const satisfies readonly LocationLayoutV3[];
const locationStatusBadgeOptionsV3 = ["none", "open_now", "closed_until", "appointment_only"] as const satisfies readonly LocationStatusBadgeV3[];
const locationHoursDisplayOptionsV3 = ["today_first", "full_week", "compact_week", "expandable"] as const satisfies readonly LocationHoursDisplayV3[];
const locationActionClusterOptionsV3 = ["directions_call", "call_first", "appointment_first"] as const satisfies readonly LocationActionClusterV3[];
const contactLayoutOptionsV3 = ["call_first", "form_first", "visit_first", "quote_card", "appointment_card"] as const satisfies readonly ContactLayoutV3[];
const contactFormComplexityOptionsV3 = ["none", "short", "detailed"] as const satisfies readonly ContactFormComplexityV3[];
const contactProofSidebarOptionsV3 = ["none", "hours", "location", "trust_facts", "response_expectation"] as const satisfies readonly ContactProofSidebarV3[];
const contactCtaModeOptionsV3 = ["phone", "booking", "estimate", "directions"] as const satisfies readonly ContactCtaModeV3[];
const mediaPatternOptionsV3 = ["lead_left", "lead_center", "strip", "wall", "alternating_rows"] as const satisfies readonly MediaPatternV3[];
const mediaCaptionModeOptionsV3 = ["none", "overlay", "below", "category_label"] as const satisfies readonly MediaCaptionModeV3[];
const mediaCropSetOptionsV3 = ["consistent", "mixed_editorial", "detail_zoom"] as const satisfies readonly MediaCropSetV3[];
const eligibilityBandTreatmentOptionsV3 = ["logo_strip", "icon_cards", "statement_plus_list", "split_cta"] as const satisfies readonly EligibilityBandTreatmentV3[];
const serviceIndexTreatmentOptionsV3 = ["categorized_menu", "dropdown_preview", "featured_services_plus_all"] as const satisfies readonly ServiceIndexTreatmentV3[];
const caseStudyTreatmentOptionsV3 = ["before_after_pair", "story_card", "media_plus_results", "three_step_case"] as const satisfies readonly CaseStudyTreatmentV3[];
const comparisonTreatmentOptionsV3 = ["feature_compare", "table_rows", "pros_cons_cards"] as const satisfies readonly ComparisonTreatmentV3[];
const teamStoryTreatmentOptionsV3 = ["portrait_split", "founder_card", "team_strip"] as const satisfies readonly TeamStoryTreatmentV3[];
const offerBandTreatmentOptionsV3 = ["coupon_panel", "financing_strip", "urgent_banner", "quiet_offer"] as const satisfies readonly OfferBandTreatmentV3[];

function normalizeOptionalEnumOptionV3<const T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
  fieldId: string,
  label: string,
  violations: VisualSectionConstraintViolationV3[]
): T | undefined {
  if (value === undefined) return undefined;
  return normalizeEnumOptionV3(value, allowed, fallback, fieldId, label, violations);
}

function normalizeEnumOptionV3<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  fieldId: string,
  label: string,
  violations: VisualSectionConstraintViolationV3[]
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  violations.push({
    id: `visual.${fieldId}_invalid`,
    severity: "error",
    message: `${label} must be one of ${allowed.join(", ")}; using ${fallback}.`,
    breakpoint: "desktop"
  });
  return fallback;
}

function validateCountV3(
  slotId: string,
  count: number | undefined,
  range: { min: number; max: number } | undefined,
  templateId: SectionTemplateIdV3,
  violations: VisualSectionConstraintViolationV3[]
) {
  if (count === undefined || !range) return;
  if (count < range.min || count > range.max) {
    violations.push({
      id: "visual.slot_count_invalid",
      severity: "error",
      message: `Template ${templateId} expects ${slotId} count between ${range.min} and ${range.max}; received ${count}.`,
      slotId,
      breakpoint: "desktop"
    });
  }
}

function isInvalidImageStatementHeroSectionV3(section: VisualSectionV3): section is HeroStatementSectionV3 {
  return (
    section.templateId === "hero_statement" &&
    section.options.background.kind === "image" &&
    !eligibleImageBackgroundV3(section.options.background)
  );
}

function isHeroSectionV3(section: VisualSectionV3): section is HeroSectionV3 {
  return section.templateId === "hero_split" || section.templateId === "hero_statement";
}

function eligibleImageBackgroundV3(background: SectionBackgroundOptionV3): background is ImageBackgroundV3 {
  return background.kind === "image" && typeof background.url === "string" && background.url.trim().length > 0;
}

function factsCountForSectionV3(section: VisualSectionV3) {
  if ("facts" in section.slots && section.slots.facts) return section.slots.facts.items.length;
  if ("contact" in section.slots && section.slots.contact) return section.slots.contact.facts.length;
  return undefined;
}

function itemsCountForSectionV3(section: VisualSectionV3) {
  if ("items" in section.slots && section.slots.items) return section.slots.items.items.length;
  return undefined;
}

function mediaCountForSectionV3(section: VisualSectionV3) {
  if ("media" in section.slots && section.slots.media) return section.slots.media.items.length;
  return undefined;
}

function foregroundCandidateColorsV3(background: SectionBackgroundOptionV3): string[] {
  if (background.kind === "solid") return [solidBackgroundColors[background.token]];
  if (background.kind === "gradient") return gradientBackgroundColors[background.token];
  return ["#12100d"];
}

function sectionForegroundTokensV3(foreground: "#171512" | "#ffffff", backgroundSample: string): SectionForegroundV3 {
  const inverse = foreground === darkForeground ? lightForeground : darkForeground;
  const muted = foreground === darkForeground ? "rgba(23, 21, 18, 0.72)" : "rgba(255, 255, 255, 0.82)";
  const preferredPrimary = foreground === darkForeground ? darkForeground : lightForeground;
  const primaryContrast = contrastRatioV3(preferredPrimary, backgroundSample) ?? 0;
  const primaryButtonBackground = primaryContrast >= 3 ? preferredPrimary : inverse;
  const primaryButtonForeground = primaryButtonBackground === darkForeground ? lightForeground : darkForeground;
  return {
    foreground,
    muted,
    primaryButtonBackground,
    primaryButtonForeground,
    primaryButtonBorder: primaryButtonBackground,
    secondaryButtonBackground: "transparent",
    secondaryButtonForeground: foreground,
    secondaryButtonBorder: foreground === darkForeground ? "rgba(23, 21, 18, 0.3)" : "rgba(255, 255, 255, 0.54)"
  };
}

function parseHexColorV3(value: string) {
  const trimmed = value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) return undefined;
  return {
    r: parseInt(trimmed.slice(1, 3), 16) / 255,
    g: parseInt(trimmed.slice(3, 5), 16) / 255,
    b: parseInt(trimmed.slice(5, 7), 16) / 255
  };
}

function relativeLuminanceV3(rgb: { r: number; g: number; b: number }) {
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  const r = channel(rgb.r);
  const g = channel(rgb.g);
  const b = channel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isSectionBackgroundOptionV3(value: unknown): value is SectionBackgroundOptionV3 {
  if (!value || typeof value !== "object") return false;
  const background = value as Partial<SectionBackgroundOptionV3>;
  if (background.kind === "solid") return background.token === "page" || background.token === "surface" || background.token === "dark" || background.token === "brand";
  if (background.kind === "gradient") return background.token === "subtle" || background.token === "brand";
  if (background.kind === "image") return typeof background.url === "string";
  return false;
}

function hasOverlayFieldV3(value: unknown) {
  return Boolean(value && typeof value === "object" && "overlay" in value);
}

function knownTemplateIdV3(value: string): value is SectionTemplateIdV3 {
  return (
    value === "hero_split" ||
    value === "hero_statement" ||
    value === "split_media" ||
    value === "intro_grid" ||
    value === "side_intro_rows" ||
    value === "numbered_steps" ||
    value === "stat_band" ||
    value === "feature_band" ||
    value === "proof_pair" ||
    value === "media_feature" ||
    value === "media_mosaic" ||
    value === "quote_wall" ||
    value === "faq_list" ||
    value === "facts_strip" ||
    value === "facts_cta" ||
    value === "eligibility_band" ||
    value === "service_index" ||
    value === "case_study_preview" ||
    value === "comparison_table" ||
    value === "team_story" ||
    value === "offer_band" ||
    value === "editorial_statement" ||
    value === "location_directory" ||
    value === "service_area_showcase" ||
    value === "location_showcase" ||
    value === "contact_split"
  );
}
