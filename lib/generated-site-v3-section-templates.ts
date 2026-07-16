import type {
  SectionBackgroundKindV3,
  SectionBackgroundOptionV3,
  SectionTemplateIdV3 as VisualSectionTemplateIdV3
} from "./generated-site-v3-visual-controls";

export type SectionTemplateIdV3 = VisualSectionTemplateIdV3;
export type SectionGeometryTemplateIdV3 = SectionTemplateIdV3;

export type SectionPurposeTemplateIdV3 =
  | "hero.split"
  | "hero.statement"
  | "hero.image_statement"
  | "story.split_media"
  | "highlights.grid"
  | "feature.band"
  | "services.rows"
  | "process.stepper"
  | "proof.stat_band"
  | "media.feature"
  | "media.gallery"
  | "proof.quote_wall"
  | "pricing.packages"
  | "process.steps"
  | "faq.list"
  | "proof.facts_strip"
  | "proof.facts_cta"
  | "proof.eligibility_band"
  | "services.index"
  | "proof.case_study_preview"
  | "comparison.table"
  | "team.story"
  | "offer.band"
  | "statement.editorial"
  | "local.location_directory"
  | "local.service_area_showcase"
  | "local.location_showcase"
  | "contact.split";

export type SectionTemplateSlotIdV3 = "intro" | "copy" | "media" | "items" | "facts" | "action" | "contact" | "locations";
export type SectionTemplateRhythmRoleV3 =
  | "hero"
  | "proof"
  | "split"
  | "grid"
  | "feature"
  | "rows"
  | "media"
  | "gallery"
  | "quotes"
  | "faq"
  | "statement"
  | "location"
  | "contact";

export type CountRangeV3 = {
  min: number;
  max: number;
};

export type SectionTemplateDefinitionV3 = {
  id: SectionTemplateIdV3;
  label: string;
  /**
   * `active` templates are model-selectable and renderable.
   * `reserved` templates are renderable development fixtures that are not yet
   * selectable.
   * `replay_only` templates are kept renderable for stored-plan replay after a
   * variant has been demoted from model selection.
   */
  status: "active" | "reserved" | "replay_only";
  description: string;
  requiredSlots: readonly SectionTemplateSlotIdV3[];
  optionalSlots: readonly SectionTemplateSlotIdV3[];
  allowedBackgrounds: readonly SectionBackgroundOptionV3[];
  defaultBackground: SectionBackgroundOptionV3;
  rhythmRole: SectionTemplateRhythmRoleV3;
  visualDensity: "compact" | "standard" | "spacious" | "expansive";
  visualWeight: "quiet" | "standard" | "feature" | "hero";
  mediaCount?: CountRangeV3;
  itemCount?: CountRangeV3;
  factCount?: CountRangeV3;
  desktopRule: string;
  tabletRule: string;
  mobileRule: string;
};

export type SectionPurposeTemplateDefinitionV3 = {
  id: SectionPurposeTemplateIdV3;
  label: string;
  sectionTemplateId: SectionTemplateIdV3;
  family: string;
  anchorId?: string;
};

const pageBackgroundV3: SectionBackgroundOptionV3 = { kind: "solid", token: "page" };
const surfaceBackgroundV3: SectionBackgroundOptionV3 = { kind: "solid", token: "surface" };
const darkBackgroundV3: SectionBackgroundOptionV3 = { kind: "solid", token: "dark" };
const brandBackgroundV3: SectionBackgroundOptionV3 = { kind: "solid", token: "brand" };
const subtleGradientBackgroundV3: SectionBackgroundOptionV3 = { kind: "gradient", token: "subtle" };
const brandGradientBackgroundV3: SectionBackgroundOptionV3 = { kind: "gradient", token: "brand" };

const nonImageBackgroundsV3 = [
  pageBackgroundV3,
  surfaceBackgroundV3,
  darkBackgroundV3,
  brandBackgroundV3,
  subtleGradientBackgroundV3,
  brandGradientBackgroundV3
] as const;

export const activeSectionTemplateOrderV3 = [
  "hero_split",
  "hero_statement",
  "facts_strip",
  "split_media",
  "intro_grid",
  "feature_band",
  "side_intro_rows",
  "numbered_steps",
  "stat_band",
  "proof_pair",
  "media_feature",
  "media_mosaic",
  "quote_wall",
  "faq_list",
  "facts_cta",
  "eligibility_band",
  "service_index",
  "case_study_preview",
  "comparison_table",
  "team_story",
  "offer_band",
  "editorial_statement",
  "location_directory",
  "service_area_showcase",
  "location_showcase",
  "contact_split"
] as const satisfies readonly SectionTemplateIdV3[];

export const activeSectionGeometryTemplateOrderV3 = activeSectionTemplateOrderV3;

export const sectionTemplateCatalogV3: readonly SectionTemplateDefinitionV3[] = [
  template("hero_split", "HeroSplit", "First-viewport hero with copy and one dedicated media frame or a bounded two-image collage.", "hero", {
    requiredSlots: ["copy", "media"],
    optionalSlots: ["facts"],
    defaultBackground: pageBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "expansive",
    visualWeight: "hero",
    mediaCount: { min: 1, max: 2 },
    factCount: { min: 0, max: 4 },
    desktopRule: "Copy and media sit in a first-viewport split with hero-scale copy.",
    tabletRule: "Copy stacks above media with bounded image scale.",
    mobileRule: "Copy, actions, and media stack vertically with deterministic padding and no horizontal overflow."
  }),
  template("hero_statement", "HeroStatement", "Text-led first-viewport hero with optional facts and actions.", "hero", {
    requiredSlots: ["copy"],
    optionalSlots: ["facts", "action"],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: [...nonImageBackgroundsV3, { kind: "image", url: "/generated-site-assets/auto-body/lift-bay-overview-v1.png", focalPoint: "center" }],
    visualDensity: "expansive",
    visualWeight: "hero",
    factCount: { min: 0, max: 4 },
    desktopRule: "Statement copy sits in a bounded first-viewport measure; image backgrounds derive full-bleed treatment.",
    tabletRule: "Statement copy keeps a readable measure across non-image and image backgrounds.",
    mobileRule: "Statement content stacks with deterministic padding and no horizontal overflow."
  }),
  template("facts_strip", "FactsStrip", "Compact fact band for contact, coverage, or trust details.", "proof", {
    requiredSlots: ["facts"],
    optionalSlots: [],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "compact",
    visualWeight: "quiet",
    factCount: { min: 3, max: 4 },
    desktopRule: "Facts span a compact horizontal band.",
    tabletRule: "Facts wrap inside the band without changing order.",
    mobileRule: "Facts stack vertically."
  }),
  template("split_media", "SplitMedia", "Mid-page copy/media section with one bounded media frame.", "split", {
    requiredSlots: ["copy", "media"],
    optionalSlots: ["facts"],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "spacious",
    visualWeight: "standard",
    mediaCount: { min: 1, max: 1 },
    desktopRule: "Copy and media occupy complementary columns inside a bounded wide frame; mediaSide chooses left or right media placement.",
    tabletRule: "Copy stacks above one full-row wide media frame.",
    mobileRule: "Single column: copy, media, then optional facts."
  }),
  template("intro_grid", "IntroGrid", "Intro copy above a bounded card grid.", "grid", {
    requiredSlots: ["intro", "items"],
    optionalSlots: ["action"],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    itemCount: { min: 3, max: 6 },
    desktopRule: "Intro spans the top row; item cards form a readable responsive grid below.",
    tabletRule: "Intro stays full width; cards use two columns.",
    mobileRule: "Intro and cards stack one by one."
  }),
  template("feature_band", "FeatureBand", "Strong horizontal feature section with copy and a small proof cluster.", "feature", {
    requiredSlots: ["copy", "facts"],
    optionalSlots: ["action"],
    defaultBackground: brandGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "feature",
    factCount: { min: 3, max: 4 },
    desktopRule: "Feature copy anchors the left side; facts form a compact supporting cluster.",
    tabletRule: "Copy and facts keep a two-column relationship when space allows.",
    mobileRule: "Copy, facts, and optional action stack in source order."
  }),
  template("side_intro_rows", "SideIntroRows", "Left intro with right editorial rows.", "rows", {
    requiredSlots: ["intro", "items"],
    optionalSlots: [],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "spacious",
    visualWeight: "standard",
    itemCount: { min: 3, max: 4 },
    desktopRule: "Intro column sits beside editorial rows.",
    tabletRule: "Intro stacks above rows.",
    mobileRule: "Intro and rows stack one by one."
  }),
  template("numbered_steps", "NumberedSteps", "Full-width vertical stepper: intro above ordered, numbered steps with optional per-step media.", "rows", {
    requiredSlots: ["intro", "items"],
    optionalSlots: [],
    defaultBackground: pageBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "spacious",
    visualWeight: "standard",
    itemCount: { min: 3, max: 4 },
    desktopRule: "Intro spans the top; steps stack vertically with oversized numerals and optional step media on alternating sides.",
    tabletRule: "Steps keep the vertical stack; step media sits below step copy.",
    mobileRule: "Intro and steps stack one by one; numerals stay legible at compact scale."
  }),
  template("stat_band", "StatBand", "Signature band: one oversized verified stat beside short supporting copy.", "feature", {
    requiredSlots: ["copy", "facts"],
    optionalSlots: ["action"],
    defaultBackground: brandGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "compact",
    visualWeight: "feature",
    factCount: { min: 1, max: 1 },
    desktopRule: "The stat value renders at display scale beside a constrained copy column.",
    tabletRule: "Stat and copy keep a two-column relationship when space allows.",
    mobileRule: "Stat stacks above copy; the numeral scales down but stays dominant."
  }),
  template("proof_pair", "ProofPair", "Before/after proof section with two labeled media frames and supporting copy.", "proof", {
    requiredSlots: ["copy", "media"],
    optionalSlots: ["facts"],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "feature",
    mediaCount: { min: 2, max: 2 },
    factCount: { min: 0, max: 3 },
    desktopRule: "Copy sits beside or above two labeled media frames that compare before and after states.",
    tabletRule: "Copy stacks above the paired media frames.",
    mobileRule: "Copy stacks above two full-width labeled proof frames."
  }),
  template("media_feature", "MediaFeature", "Large below-hero media section with one wide image and a short supporting statement.", "media", {
    requiredSlots: ["copy", "media"],
    optionalSlots: [],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    mediaCount: { min: 1, max: 1 },
    desktopRule: "A wide media frame spans most of the row with supporting copy in a narrow column.",
    tabletRule: "Copy stacks above one wide media frame.",
    mobileRule: "Copy and media stack; image crop stays wide."
  }),
  template("media_mosaic", "MediaMosaic", "Gallery-style media section with short intro copy and a bounded three-image mosaic.", "gallery", {
    requiredSlots: ["copy", "media"],
    optionalSlots: [],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    mediaCount: { min: 3, max: 3 },
    desktopRule: "Short copy sits above a bounded three-image mosaic.",
    tabletRule: "Copy stacks above the mosaic; the mosaic keeps a two-column relationship.",
    mobileRule: "Copy stacks above three bounded images in source order."
  }),
  template("quote_wall", "QuoteWall", "Intro copy above a bounded wall of short quote/proof cards.", "quotes", {
    requiredSlots: ["intro", "items"],
    optionalSlots: [],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    itemCount: { min: 2, max: 3 },
    desktopRule: "Intro spans the top row; two or three quote cards form a balanced grid below.",
    tabletRule: "Intro stays full width; quote cards use two columns.",
    mobileRule: "Intro and quote cards stack one by one."
  }),
  template("faq_list", "FaqList", "Intro copy beside or above a compact list of common questions.", "faq", {
    requiredSlots: ["intro", "items"],
    optionalSlots: [],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    itemCount: { min: 4, max: 4 },
    desktopRule: "Intro column sits beside question rows.",
    tabletRule: "Intro stacks above the question rows.",
    mobileRule: "Intro and question rows stack one by one."
  }),
  template("facts_cta", "FactsCta", "Fact band plus one bounded CTA panel.", "proof", {
    requiredSlots: ["facts", "action"],
    optionalSlots: [],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "compact",
    visualWeight: "feature",
    factCount: { min: 3, max: 4 },
    desktopRule: "Facts occupy the main column; CTA sits in a side panel.",
    tabletRule: "Facts stack above the CTA panel.",
    mobileRule: "Facts and CTA stack."
  }),
  template("eligibility_band", "EligibilityBand", "Reusable proof/eligibility strip for accepted methods, credentials, plans, service fit, or qualification details.", "proof", {
    requiredSlots: ["copy", "facts"],
    optionalSlots: ["action"],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "compact",
    visualWeight: "feature",
    factCount: { min: 2, max: 6 },
    desktopRule: "A short statement anchors the band while eligibility/proof facts render as a strip, logo-like row, or compact cards.",
    tabletRule: "Statement and facts keep a compact two-column or wrapped strip relationship.",
    mobileRule: "Statement, facts, and optional action stack with no horizontal scrolling."
  }),
  template("service_index", "ServiceIndex", "Browseable service index for larger service sets, with a featured entry area and compact full list.", "grid", {
    requiredSlots: ["intro", "items"],
    optionalSlots: ["action"],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    itemCount: { min: 4, max: 12 },
    desktopRule: "Intro spans the top; service entries render as a category menu, dropdown preview, or featured-plus-all grid.",
    tabletRule: "Service index collapses to two columns or a compact list while preserving all service labels.",
    mobileRule: "Service entries stack in a scannable index without button overflow."
  }),
  template("case_study_preview", "CaseStudyPreview", "Reusable mini case-study module for before/after, project story, or result-driven proof.", "proof", {
    requiredSlots: ["copy", "media"],
    optionalSlots: ["facts"],
    defaultBackground: pageBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "spacious",
    visualWeight: "feature",
    mediaCount: { min: 1, max: 3 },
    factCount: { min: 0, max: 4 },
    desktopRule: "Story copy and proof media share a feature layout with optional result facts.",
    tabletRule: "Story copy stacks above media and facts.",
    mobileRule: "Copy, media, and facts stack; media crops stay filled."
  }),
  template("comparison_table", "ComparisonTable", "Structured comparison for options, service fit, packages, or decision criteria.", "grid", {
    requiredSlots: ["intro", "items"],
    optionalSlots: ["action"],
    defaultBackground: subtleGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    itemCount: { min: 2, max: 6 },
    desktopRule: "Intro sits above a comparison surface with two to six differentiated rows or cards.",
    tabletRule: "Comparison entries use two columns or stacked rows with labels preserved.",
    mobileRule: "Comparison entries stack as cards so table copy never overflows."
  }),
  template("team_story", "TeamStory", "People/owner story geometry with optional portrait or shop media and a compact proof cluster.", "split", {
    requiredSlots: ["copy"],
    optionalSlots: ["media", "facts"],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "spacious",
    visualWeight: "standard",
    mediaCount: { min: 0, max: 1 },
    factCount: { min: 0, max: 4 },
    desktopRule: "Business story and optional portrait/shop media render as a warm editorial split or compact team strip.",
    tabletRule: "Story, media, and facts stack with the media bounded.",
    mobileRule: "Story leads; optional media and facts stack without awkward empty frames."
  }),
  template("offer_band", "OfferBand", "Conversion/offer band for source-backed promotions, financing, urgency, or quote-start calls to action.", "feature", {
    requiredSlots: ["copy", "action"],
    optionalSlots: ["facts"],
    defaultBackground: brandGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "compact",
    visualWeight: "feature",
    factCount: { min: 0, max: 4 },
    desktopRule: "Offer or conversion copy pairs with a strong action and optional supporting facts.",
    tabletRule: "Offer copy and action keep a two-column relationship when space allows.",
    mobileRule: "Offer copy, action, and facts stack with the primary action visible."
  }),
  template("editorial_statement", "EditorialStatement", "Quiet typographic break with centered copy and inline actions.", "statement", {
    requiredSlots: ["copy"],
    optionalSlots: ["action"],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: [...nonImageBackgroundsV3, { kind: "image", url: "/generated-site-assets/auto-services/conversion-background-v1.jpg", focalPoint: "center" }],
    visualDensity: "spacious",
    visualWeight: "feature",
    desktopRule: "Copy is centered in a constrained measure.",
    tabletRule: "Copy remains centered with tighter measure.",
    mobileRule: "Copy remains centered and actions wrap."
  }),
  template("location_directory", "LocationDirectory", "Multi-location directory with cards that link to location landing pages.", "location", {
    requiredSlots: ["copy", "locations"],
    optionalSlots: ["action"],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    desktopRule: "Location copy sits above or beside a bounded grid of physical-location cards with landing-page CTAs.",
    tabletRule: "Location copy stacks above two-column cards.",
    mobileRule: "Location copy, cards, and actions stack without a map requirement."
  }),
  template("service_area_showcase", "ServiceAreaShowcase", "Coverage-first section for service-area businesses with no physical address.", "location", {
    requiredSlots: ["copy", "facts"],
    optionalSlots: ["action"],
    defaultBackground: surfaceBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "standard",
    visualWeight: "standard",
    factCount: { min: 1, max: 6 },
    desktopRule: "Coverage copy pairs with verified service-area facts and a contact CTA.",
    tabletRule: "Coverage copy stacks above service-area facts.",
    mobileRule: "Coverage copy, service areas, and CTA stack without implying a storefront."
  }),
  template("location_showcase", "LocationShowcase", "Destination location section: display-scale hours, map or coverage panel, and direction actions for a single-location business.", "location", {
    requiredSlots: ["copy", "locations"],
    optionalSlots: ["action"],
    defaultBackground: pageBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "spacious",
    visualWeight: "feature",
    desktopRule: "Intro copy and map share the left column; the visit card with full-week hours anchors the right column at display scale.",
    tabletRule: "Copy, visit card, and map stack with the hours table at full width.",
    mobileRule: "Copy, visit details, hours, and actions stack one by one."
  }),
  template("contact_split", "ContactSplit", "Contact copy and primary contact facts in a high-contrast split.", "contact", {
    requiredSlots: ["copy", "contact"],
    optionalSlots: ["action"],
    defaultBackground: brandGradientBackgroundV3,
    allowedBackgrounds: nonImageBackgroundsV3,
    visualDensity: "spacious",
    visualWeight: "feature",
    factCount: { min: 3, max: 4 },
    desktopRule: "Contact copy sits beside address, phone, email, and hours.",
    tabletRule: "Contact copy and facts remain split when space allows.",
    mobileRule: "Contact copy stacks above contact facts."
  })
];

export const sectionPurposeTemplateCatalogV3: readonly SectionPurposeTemplateDefinitionV3[] = [
  { id: "hero.split", label: "Hero split", sectionTemplateId: "hero_split", family: "hero.section_template" },
  { id: "hero.statement", label: "Hero statement", sectionTemplateId: "hero_statement", family: "hero.section_template" },
  { id: "hero.image_statement", label: "Hero image statement", sectionTemplateId: "hero_statement", family: "hero.section_template" },
  { id: "story.split_media", label: "Story split media", sectionTemplateId: "split_media", family: "story.section_template", anchorId: "proof" },
  { id: "highlights.grid", label: "Highlights grid", sectionTemplateId: "intro_grid", family: "highlights.section_template", anchorId: "highlights" },
  { id: "feature.band", label: "Feature band", sectionTemplateId: "feature_band", family: "feature.section_template" },
  { id: "services.rows", label: "Services rows", sectionTemplateId: "side_intro_rows", family: "services.section_template", anchorId: "services" },
  { id: "media.feature", label: "Media feature", sectionTemplateId: "media_feature", family: "media.section_template" },
  { id: "media.gallery", label: "Media gallery", sectionTemplateId: "media_mosaic", family: "media.section_template" },
  { id: "proof.quote_wall", label: "Proof quote wall", sectionTemplateId: "quote_wall", family: "proof.section_template", anchorId: "proof" },
  { id: "pricing.packages", label: "Package comparison", sectionTemplateId: "intro_grid", family: "pricing.section_template", anchorId: "services" },
  { id: "process.steps", label: "Process steps", sectionTemplateId: "side_intro_rows", family: "process.section_template", anchorId: "process" },
  { id: "process.stepper", label: "Process stepper", sectionTemplateId: "numbered_steps", family: "process.section_template", anchorId: "process" },
  { id: "proof.stat_band", label: "Signature stat band", sectionTemplateId: "stat_band", family: "proof.section_template", anchorId: "proof" },
  { id: "faq.list", label: "FAQ list", sectionTemplateId: "faq_list", family: "faq.section_template", anchorId: "faq" },
  { id: "proof.facts_strip", label: "Proof facts strip", sectionTemplateId: "facts_strip", family: "proof.section_template" },
  { id: "proof.facts_cta", label: "Proof facts CTA", sectionTemplateId: "facts_cta", family: "local.section_template" },
  { id: "proof.eligibility_band", label: "Eligibility proof band", sectionTemplateId: "eligibility_band", family: "proof.section_template", anchorId: "proof" },
  { id: "services.index", label: "Service index", sectionTemplateId: "service_index", family: "services.section_template", anchorId: "services" },
  { id: "proof.case_study_preview", label: "Case study preview", sectionTemplateId: "case_study_preview", family: "proof.section_template", anchorId: "proof" },
  { id: "comparison.table", label: "Comparison table", sectionTemplateId: "comparison_table", family: "feature.section_template" },
  { id: "team.story", label: "Team story", sectionTemplateId: "team_story", family: "about.section_template", anchorId: "about" },
  { id: "offer.band", label: "Offer band", sectionTemplateId: "offer_band", family: "conversion.section_template", anchorId: "contact" },
  { id: "statement.editorial", label: "Editorial statement", sectionTemplateId: "editorial_statement", family: "statement.section_template" },
  { id: "local.location_directory", label: "Location directory", sectionTemplateId: "location_directory", family: "local.section_template", anchorId: "location" },
  { id: "local.service_area_showcase", label: "Service area showcase", sectionTemplateId: "service_area_showcase", family: "local.section_template", anchorId: "location" },
  { id: "local.location_showcase", label: "Location showcase", sectionTemplateId: "location_showcase", family: "local.section_template", anchorId: "location" },
  { id: "contact.split", label: "Contact split", sectionTemplateId: "contact_split", family: "contact.section_template", anchorId: "contact" }
];

export function sectionTemplateForPurposeV3(purposeId: SectionPurposeTemplateIdV3): SectionTemplateIdV3 {
  return sectionPurposeDefinitionV3(purposeId).sectionTemplateId;
}

export function sectionPurposeDefinitionV3(purposeId: SectionPurposeTemplateIdV3): SectionPurposeTemplateDefinitionV3 {
  const definition = sectionPurposeTemplateCatalogV3.find((purpose) => purpose.id === purposeId);
  if (!definition) throw new Error(`Unknown generated-site V3 section purpose: ${purposeId}`);
  return definition;
}

export function sectionTemplateDefinitionV3(templateId: SectionTemplateIdV3): SectionTemplateDefinitionV3 {
  const definition = sectionTemplateCatalogV3.find((templateDefinition) => templateDefinition.id === templateId);
  if (!definition) throw new Error(`Unknown generated-site V3 section template: ${templateId}`);
  return definition;
}

export function modelSelectableSectionTemplatesV3(): readonly SectionTemplateDefinitionV3[] {
  return sectionTemplateCatalogV3.filter((templateDefinition) => templateDefinition.status === "active");
}

export function renderableSectionTemplatesV3(): readonly SectionTemplateDefinitionV3[] {
  return sectionTemplateCatalogV3.filter(
    (templateDefinition) => templateDefinition.status === "active" || templateDefinition.status === "reserved" || templateDefinition.status === "replay_only"
  );
}

export function isModelSelectableSectionTemplateV3(templateId: SectionTemplateIdV3): boolean {
  return sectionTemplateDefinitionV3(templateId).status === "active";
}

export function isRenderableSectionTemplateV3(templateId: SectionTemplateIdV3): boolean {
  const status = sectionTemplateDefinitionV3(templateId).status;
  return status === "active" || status === "reserved" || status === "replay_only";
}

export function defaultBackgroundForTemplateV3(templateId: SectionTemplateIdV3): SectionBackgroundOptionV3 {
  return sectionTemplateDefinitionV3(templateId).defaultBackground;
}

export function sectionTemplateAllowsBackgroundV3(templateId: SectionTemplateIdV3, background: SectionBackgroundOptionV3) {
  return sectionTemplateDefinitionV3(templateId).allowedBackgrounds.some((allowed) => backgroundIdentityV3(allowed) === backgroundIdentityV3(background));
}

function template(
  id: SectionTemplateIdV3,
  label: string,
  description: string,
  rhythmRole: SectionTemplateRhythmRoleV3,
  options: Omit<SectionTemplateDefinitionV3, "id" | "label" | "status" | "description" | "rhythmRole"> & { status?: SectionTemplateDefinitionV3["status"] }
): SectionTemplateDefinitionV3 {
  const { status = "active", ...rest } = options;
  return {
    id,
    label,
    status,
    description,
    rhythmRole,
    ...rest
  };
}

function backgroundIdentityV3(background: SectionBackgroundOptionV3) {
  if (background.kind === "image") return "image";
  return `${background.kind}:${background.token}` satisfies `${SectionBackgroundKindV3}:${string}`;
}
