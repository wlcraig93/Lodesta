/**
 * Art Direction Matrix catalog (B1): substrate-aware presentation types and the
 * role-compatibility table. Every value listed here has existing markup + CSS
 * validated by the canonical grammar harness — speculative presentations are
 * not allowlisted until their styling lands and passes.
 *
 * Substrates are separate unions on purpose: a media presentation like
 * "collage" must be unassignable to a service list at the type level.
 */

/** Presentations rendered by .site-visual-list-v3 (styled in app/globals.css). */
export type ListPresentationIdV3 =
  | "action_tiles"
  | "program_rows"
  | "service_problem_rows"
  | "menu_preview"
  | "premium_showcase"
  | "coaching_cards"
  | "portfolio_index"
  | "card_grid"
  | "numbered_ledger";

/** Presentations rendered by .site-visual-facts-v3. */
export type FactsPresentationIdV3 = "trust_bar" | "utility_rail" | "inline_strip" | "stacked" | "hero_chips" | "marquee";

/** Presentations rendered by .site-visual-media-v3. */
export type MediaPresentationIdV3 = "single" | "mosaic" | "collage" | "editorial_strip" | "object_stage";

/** FAQ disclosure presentations (list substrate, FAQ-only semantics). */
export type FaqPresentationIdV3 = "faq_accordion";

/** Quote/testimonial presentations (list substrate, quote markup). */
export type QuotePresentationIdV3 = "action_tiles" | "program_rows";

/** Named heading-weight scales consumed by per-pairing CSS. */
export type ArtDirectionWeightScaleV3 = "display" | "standard" | "light";

/**
 * Per-section-role presentation choices. Optional everywhere: an unset role
 * keeps the compiler's deterministic default for that section.
 */
export type SectionPresentationMapV3 = {
  services?: ListPresentationIdV3;
  process?: ListPresentationIdV3;
  faq?: FaqPresentationIdV3;
  factsStrip?: FactsPresentationIdV3;
  heroFacts?: FactsPresentationIdV3;
  contactFacts?: FactsPresentationIdV3;
  gallery?: MediaPresentationIdV3;
  quotes?: QuotePresentationIdV3;
};

export type ArtDirectionSectionRoleV3 = keyof SectionPresentationMapV3;

/**
 * Role compatibility narrows further within each substrate: a role only admits
 * presentations whose geometry makes sense for its content shape.
 */
export const compatiblePresentationsForRoleV3 = {
  services: ["action_tiles", "coaching_cards", "service_problem_rows", "premium_showcase", "menu_preview", "card_grid", "numbered_ledger"],
  // side_intro_rows hardcodes its row geometry; process admits no alternates yet.
  process: ["program_rows"],
  faq: ["faq_accordion"],
  factsStrip: ["trust_bar", "utility_rail", "inline_strip", "marquee"],
  heroFacts: ["inline_strip", "trust_bar", "hero_chips"],
  contactFacts: ["stacked", "utility_rail"],
  // Each admitted after CSS completion + visual QA through the matrix:
  // mosaic (feature + stack), collage (tall left + two right),
  // editorial_strip (equal filmstrip).
  gallery: ["mosaic", "collage", "editorial_strip"],
  quotes: ["action_tiles", "program_rows"]
} as const satisfies Record<ArtDirectionSectionRoleV3, readonly string[]>;

export type SectionPresentationViolationV3 = {
  role: ArtDirectionSectionRoleV3;
  presentation: string;
  reason: string;
};

export function validateSectionPresentationMapV3(map: SectionPresentationMapV3): SectionPresentationViolationV3[] {
  const violations: SectionPresentationViolationV3[] = [];
  for (const [role, presentation] of Object.entries(map) as Array<[ArtDirectionSectionRoleV3, string | undefined]>) {
    if (!presentation) continue;
    const allowed = compatiblePresentationsForRoleV3[role] as readonly string[] | undefined;
    if (!allowed) {
      violations.push({ role, presentation, reason: `Unknown section role "${role}".` });
      continue;
    }
    if (!allowed.includes(presentation)) {
      violations.push({
        role,
        presentation,
        reason: `Presentation "${presentation}" is not compatible with role "${role}" (allowed: ${allowed.join(", ")}).`
      });
    }
  }
  return violations;
}

/**
 * Dressing controls (next-level plan, Part 2): enumerated styling decisions
 * each template family exposes. Geometry gets variants, dressing gets
 * controls, coherence comes from profiles — controls are never chosen
 * per-section by dice roll; a site-level design profile resolves them once
 * and the renderer applies them everywhere via data attributes.
 *
 * Every control VALUE here has CSS in app/globals.css and is admitted through
 * the template×content matrix before joining this union.
 */

export type EyebrowTreatmentV3 = "plain_caps" | "accent_bar_chip" | "filled_kicker";
export type CardChromeV3 = "bordered" | "elevated" | "accent_underline";
export type FigureTreatmentV3 = "flush" | "framed_shadow";
export type HeadingCaseV3 = "standard" | "display_upper";
export type BadgeStyleV3 = "square" | "rounded" | "tilted";
export type FactHighlightV3 = "plain" | "accent_value";
export type HeaderSurfaceV3 = "neutral" | "brand_bar";

/** Resolved control values — the rendering authority stored on the version. */
export type DesignControlsV3 = {
  eyebrowTreatment: EyebrowTreatmentV3;
  cardChrome: CardChromeV3;
  figureTreatment: FigureTreatmentV3;
  headingCase: HeadingCaseV3;
  badgeStyle: BadgeStyleV3;
  factHighlight: FactHighlightV3;
  headerSurface: HeaderSurfaceV3;
};

export type DesignRegisterV3 = "punchy_retail" | "steady_professional" | "warm_boutique";

/** Vertical → register mapping shared by the design-profile selector and the copy pass. */
export function registerForVertical(vertical: string): DesignRegisterV3 {
  if (vertical === "auto_services" || vertical === "auto_body") return "punchy_retail";
  if (vertical === "beauty_salon" || vertical === "restaurant") return "warm_boutique";
  return "steady_professional";
}
export type BrandPostureV3 = "accent_forward" | "reserved";

/** The learning-signal layer — stored alongside resolved controls, never read by the renderer. */
export type DesignProfileV3 = {
  register: DesignRegisterV3;
  brandPosture: BrandPostureV3;
  rationale?: string;
};

/**
 * Known-bad cross-axis combinations. Per-axis matrix validation catches
 * single-control defects; this table catches interactions. Checked at compile
 * and in the contracts suite.
 */
export const controlIncompatibilitiesV3: Array<{
  id: string;
  reason: string;
  matches: (controls: DesignControlsV3, context: { headerMode: string }) => boolean;
}> = [
  {
    id: "brand_bar_on_transparent_header",
    reason: "A transparent overlay header cannot be painted as a brand bar.",
    matches: (controls, context) => controls.headerSurface === "brand_bar" && context.headerMode === "transparent_overlay"
  },
  {
    id: "display_upper_without_kicker_contrast",
    reason: "Uppercase display headings with plain_caps eyebrows lose hierarchy; uppercase requires a chip or kicker eyebrow.",
    matches: (controls) => controls.headingCase === "display_upper" && controls.eyebrowTreatment === "plain_caps"
  }
];

export function validateDesignControlsV3(controls: DesignControlsV3, context: { headerMode: string }): string[] {
  return controlIncompatibilitiesV3.filter((rule) => rule.matches(controls, context)).map((rule) => rule.reason);
}

/**
 * Profile → resolved controls. Deterministic: same profile always yields the
 * same controls, so stored resolved values and recomputed values agree unless
 * this table intentionally changes (in which case existing versions keep
 * their stored values — the reproducibility rule).
 */
export function resolveDesignControlsV3(profile: DesignProfileV3): DesignControlsV3 {
  const accentForward = profile.brandPosture === "accent_forward";
  switch (profile.register) {
    case "punchy_retail":
      return {
        eyebrowTreatment: accentForward ? "filled_kicker" : "accent_bar_chip",
        cardChrome: "accent_underline",
        figureTreatment: "framed_shadow",
        headingCase: accentForward ? "display_upper" : "standard",
        badgeStyle: "tilted",
        factHighlight: "accent_value",
        headerSurface: accentForward ? "brand_bar" : "neutral"
      };
    case "warm_boutique":
      return {
        eyebrowTreatment: "accent_bar_chip",
        cardChrome: "elevated",
        figureTreatment: "framed_shadow",
        headingCase: "standard",
        badgeStyle: "rounded",
        factHighlight: accentForward ? "accent_value" : "plain",
        headerSurface: "neutral"
      };
    case "steady_professional":
      return {
        eyebrowTreatment: accentForward ? "accent_bar_chip" : "plain_caps",
        cardChrome: "bordered",
        figureTreatment: "flush",
        headingCase: "standard",
        badgeStyle: "square",
        factHighlight: accentForward ? "accent_value" : "plain",
        headerSurface: "neutral"
      };
  }
}
