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
  | "media_feature"
  | "media_mosaic"
  | "quote_wall"
  | "faq_list"
  | "facts_strip"
  | "facts_cta"
  | "stat_band"
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
};

export type StandardItemV3 = {
  title: string;
  body: string;
  meta?: string;
  mediaUrl?: string;
  /** Optional landing-page link rendered as a "Learn more" affordance. */
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

export type IntroGridCardTreatmentV3 = "standard" | "comparison";
export type SplitMediaSideV3 = "left" | "right";

export type HeroSplitSectionV3 = {
  version: "visual-section-v3";
  templateId: "hero_split";
  options: { background: NonImageBackgroundV3 };
  slots: { copy: CopySlotV3; media: MediaSlotV3; facts?: FactsSlotV3 };
  anchorId?: string;
};

export type HeroStatementSectionV3 = {
  version: "visual-section-v3";
  templateId: "hero_statement";
  options: { align: "left" | "center"; background: SectionBackgroundOptionV3 };
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
  options: BaseSectionOptionsV3 & { cardTreatment?: IntroGridCardTreatmentV3 };
  slots: { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3>; action?: ActionSlotV3 };
  anchorId?: string;
};
export type SideIntroRowsSectionV3 = BaseVisualSectionV3<"side_intro_rows", { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3> }>;
/** Full-width vertical stepper: intro above ordered numbered steps; per-step media via StandardItemV3.mediaUrl. */
export type NumberedStepsSectionV3 = BaseVisualSectionV3<"numbered_steps", { intro: CopySlotV3; items: ItemsSlotV3<StandardItemV3> }>;
/** Signature moment: one oversized verified stat beside short supporting copy. */
export type StatBandSectionV3 = BaseVisualSectionV3<"stat_band", { copy: CopySlotV3; facts: FactsSlotV3; action?: ActionSlotV3 }>;
export type FeatureBandSectionV3 = BaseVisualSectionV3<"feature_band", { copy: CopySlotV3; facts: FactsSlotV3; action?: ActionSlotV3 }>;
export type MediaFeatureSectionV3 = BaseVisualSectionV3<"media_feature", { copy: CopySlotV3; media: MediaSlotV3 }>;
export type MediaMosaicSectionV3 = BaseVisualSectionV3<"media_mosaic", { copy: CopySlotV3; media: MediaSlotV3 }>;
export type QuoteWallSectionV3 = BaseVisualSectionV3<"quote_wall", { intro: CopySlotV3; items: ItemsSlotV3<QuoteItemV3> }>;
export type FaqListSectionV3 = BaseVisualSectionV3<"faq_list", { intro: CopySlotV3; items: ItemsSlotV3<FaqItemV3> }>;
export type FactsStripSectionV3 = BaseVisualSectionV3<"facts_strip", { facts: FactsSlotV3 }>;
export type FactsCtaSectionV3 = BaseVisualSectionV3<"facts_cta", { facts: FactsSlotV3; action: ActionSlotV3 }>;
export type EditorialStatementSectionV3 = BaseVisualSectionV3<"editorial_statement", { copy: CopySlotV3; action?: ActionSlotV3 }>;
export type LocationDirectorySectionV3 = BaseVisualSectionV3<"location_directory", { copy: CopySlotV3; locations: LocationsSlotV3; action?: ActionSlotV3 }>;
export type ServiceAreaShowcaseSectionV3 = BaseVisualSectionV3<"service_area_showcase", { copy: CopySlotV3; facts: FactsSlotV3; action?: ActionSlotV3 }>;
/** Destination treatment for single-location businesses: display-scale hours, map, and direction actions. */
export type LocationShowcaseSectionV3 = BaseVisualSectionV3<"location_showcase", { copy: CopySlotV3; locations: LocationsSlotV3; action?: ActionSlotV3 }>;
export type ContactSplitSectionV3 = BaseVisualSectionV3<"contact_split", { copy: CopySlotV3; contact: ContactSlotV3; action?: ActionSlotV3 }>;

export type VisualSectionV3 =
  | HeroSplitSectionV3
  | HeroStatementSectionV3
  | SplitMediaSectionV3
  | IntroGridSectionV3
  | SideIntroRowsSectionV3
  | NumberedStepsSectionV3
  | StatBandSectionV3
  | FeatureBandSectionV3
  | MediaFeatureSectionV3
  | MediaMosaicSectionV3
  | QuoteWallSectionV3
  | FaqListSectionV3
  | FactsStripSectionV3
  | FactsCtaSectionV3
  | EditorialStatementSectionV3
  | LocationDirectorySectionV3
  | ServiceAreaShowcaseSectionV3
  | LocationShowcaseSectionV3
  | ContactSplitSectionV3;

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
  page: "#f6f2ea",
  surface: "#fffdf8",
  dark: "#12100d",
  brand: "#761927"
};

const gradientBackgroundColors: Record<GradientBackgroundV3["token"], [string, string]> = {
  subtle: ["#fffdf8", "#f2eadc"],
  brand: ["#14120f", "#761927"]
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
  if (section.templateId === "split_media") {
    if (isSplitMediaSideV3(section.options.mediaSide)) return section;
    violations.push({
      id: "visual.split_media_side_invalid",
      severity: "error",
      message: "SplitMedia requires mediaSide left or right; using left.",
      breakpoint: "desktop"
    });
    return {
      ...section,
      options: {
        ...section.options,
        mediaSide: "left"
      }
    };
  }

  if (section.templateId === "intro_grid") {
    if (section.options.cardTreatment === undefined || isIntroGridCardTreatmentV3(section.options.cardTreatment)) return section;
    violations.push({
      id: "visual.intro_grid_card_treatment_invalid",
      severity: "error",
      message: "IntroGrid cardTreatment must be standard or comparison; using standard.",
      breakpoint: "desktop"
    });
    return {
      ...section,
      options: {
        ...section.options,
        cardTreatment: "standard"
      }
    };
  }

  return section;
}

function isIntroGridCardTreatmentV3(value: unknown): value is IntroGridCardTreatmentV3 {
  return value === "standard" || value === "comparison";
}

function isSplitMediaSideV3(value: unknown): value is SplitMediaSideV3 {
  return value === "left" || value === "right";
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
    value === "media_feature" ||
    value === "media_mosaic" ||
    value === "quote_wall" ||
    value === "faq_list" ||
    value === "facts_strip" ||
    value === "facts_cta" ||
    value === "editorial_statement" ||
    value === "location_directory" ||
    value === "service_area_showcase" ||
    value === "location_showcase" ||
    value === "contact_split"
  );
}
