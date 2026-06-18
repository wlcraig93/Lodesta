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
  | "stepper_vertical"
  | "checklist_cards"
  | "service_problem_rows"
  | "menu_preview"
  | "premium_showcase"
  | "feature_list"
  | "showcase_grid"
  | "image_tiles"
  | "media_grid"
  | "coaching_cards"
  | "portfolio_index"
  | "card_grid"
  | "numbered_ledger";

/** Presentations rendered by .site-visual-facts-v3. */
export type FactsPresentationIdV3 = "trust_bar" | "utility_rail" | "inline_strip" | "stacked" | "hero_chips" | "marquee" | "proof_cards";

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
  services: ["action_tiles", "coaching_cards", "service_problem_rows", "premium_showcase", "feature_list", "showcase_grid", "image_tiles", "media_grid", "menu_preview", "card_grid"],
  // program_rows renders inside side_intro_rows; stepper_vertical selects the
  // full-width numbered_steps template instead (compiler maps axis → template).
  process: ["program_rows", "stepper_vertical", "checklist_cards", "numbered_ledger"],
  faq: ["faq_accordion"],
  factsStrip: ["trust_bar", "utility_rail", "inline_strip", "marquee", "proof_cards"],
  heroFacts: ["inline_strip", "trust_bar", "hero_chips"],
  contactFacts: ["stacked", "utility_rail"],
  // Each admitted after CSS completion + visual QA through the matrix:
  // mosaic (feature + stack), collage (tall left + two right),
  // editorial_strip (equal filmstrip).
  gallery: ["mosaic", "collage", "editorial_strip"],
  quotes: ["action_tiles", "program_rows"]
} as const satisfies Record<ArtDirectionSectionRoleV3, readonly string[]>;

/**
 * Model-selectable presentation pool. This is intentionally narrower than
 * replay/render compatibility: demoting a weak variant removes it from future
 * model choice without invalidating stored sites that already reference it.
 */
export const modelSelectablePresentationsForRoleV3 = {
  ...compatiblePresentationsForRoleV3,
  services: ["action_tiles", "coaching_cards", "premium_showcase", "feature_list", "showcase_grid", "image_tiles", "media_grid", "menu_preview", "card_grid"]
} as const satisfies Record<ArtDirectionSectionRoleV3, readonly string[]>;

export type PresentationGuidanceV3 = {
  label: string;
  visualEffect: string;
  bestFor: string;
  avoidWhen?: string;
  requires?: readonly string[];
};

/**
 * Compact model-facing guidance for choosing presentation enums. This is not a
 * second catalog: values here describe renderer-backed enum options above, and
 * the static manifest hash covers it so prompt/replay debugging can see changes.
 */
export const presentationGuidanceByRoleV3 = {
  services: {
    action_tiles: {
      label: "Action tiles",
      visualEffect: "Equal-height text cards with direct action links.",
      bestFor: "Short service lists that need clear tap targets and restrained visuals.",
      avoidWhen: "The section needs strong media or a lead service."
    },
    coaching_cards: {
      label: "Coaching cards",
      visualEffect: "Warm explanatory cards with softer service framing.",
      bestFor: "Advisory or relationship-heavy businesses where education matters."
    },
    premium_showcase: {
      label: "Premium showcase",
      visualEffect: "Mixed-weight service cards with stronger hierarchy.",
      bestFor: "Four strong offers where one or two should feel more prominent."
    },
    feature_list: {
      label: "Feature list",
      visualEffect: "One large feature card with compact editorial supporting rows.",
      bestFor: "A primary service or offer supported by secondary options.",
      avoidWhen: "All services are equally important."
    },
    showcase_grid: {
      label: "Showcase grid",
      visualEffect: "One large media-led card plus supporting media cards in a filled grid.",
      bestFor: "Media-rich services or offers where the site needs more visual depth without becoming a gallery.",
      requires: ["usable service or proof media"]
    },
    image_tiles: {
      label: "Image tiles",
      visualEffect: "Full-image tiles with dark overlay copy and no separate card body.",
      bestFor: "Highly visual businesses with first-party photos and a need for a bolder, less generic section.",
      avoidWhen: "Images are weak, sparse, or text clarity is more important than atmosphere.",
      requires: ["usable first-party or source-safe media"]
    },
    media_grid: {
      label: "Media grid",
      visualEffect: "Consistent media-top cards with bottom-aligned actions.",
      bestFor: "Service lists where every item can be paired with a relevant image.",
      requires: ["service media"]
    },
    menu_preview: {
      label: "Menu preview",
      visualEffect: "Dense row preview with item, context, and supporting copy.",
      bestFor: "Menu-like catalogs, packages, or lists where scan density matters."
    },
    card_grid: {
      label: "Card grid",
      visualEffect: "Simple responsive cards below a full-width section intro.",
      bestFor: "Default service or offer lists when media is limited.",
      avoidWhen: "The page already has several plain card grids."
    }
  },
  process: {
    program_rows: {
      label: "Program rows",
      visualEffect: "Horizontal rule-separated process rows.",
      bestFor: "Simple three-to-four step flows with concise explanations."
    },
    stepper_vertical: {
      label: "Vertical stepper",
      visualEffect: "Numbered steps with a stronger procedural rhythm.",
      bestFor: "Operational workflows where order and accountability matter."
    },
    checklist_cards: {
      label: "Checklist cards",
      visualEffect: "Compact check-mark cards in a responsive grid.",
      bestFor: "Expectation-setting process sections where the items do not need to feel strictly sequential.",
      avoidWhen: "The order of steps is legally, operationally, or emotionally important."
    },
    numbered_ledger: {
      label: "Numbered ledger",
      visualEffect: "Editorial numbered rows with stronger visual separation.",
      bestFor: "Process sections that should feel premium, precise, and less card-like."
    }
  },
  faq: {
    faq_accordion: {
      label: "FAQ accordion",
      visualEffect: "Disclosure rows for questions and answers.",
      bestFor: "Practical buyer questions that should not dominate the page."
    }
  },
  factsStrip: {
    trust_bar: {
      label: "Trust bar",
      visualEffect: "Even fact row for quick credibility scanning.",
      bestFor: "Core proof points, contact facts, or operational facts."
    },
    utility_rail: {
      label: "Utility rail",
      visualEffect: "Compact utility-style facts.",
      bestFor: "Hours, location, phone, service-area, or other practical facts."
    },
    inline_strip: {
      label: "Inline strip",
      visualEffect: "Lightweight inline facts.",
      bestFor: "Secondary facts that should support copy without becoming a band."
    },
    marquee: {
      label: "Marquee",
      visualEffect: "Accent-forward repeating proof strip.",
      bestFor: "Short, high-confidence signals that can tolerate visual emphasis."
    },
    proof_cards: {
      label: "Proof cards",
      visualEffect: "Individual proof cards with more separation.",
      bestFor: "Several distinct proof points that need clearer hierarchy than a strip."
    }
  },
  heroFacts: {
    inline_strip: {
      label: "Inline strip",
      visualEffect: "Small supporting facts below hero copy.",
      bestFor: "Quietly reinforcing the hero without visual noise."
    },
    trust_bar: {
      label: "Trust bar",
      visualEffect: "Structured hero proof row.",
      bestFor: "Hero sections with strong factual proof."
    },
    hero_chips: {
      label: "Hero chips",
      visualEffect: "Compact pill-like hero facts.",
      bestFor: "Retail or service pages that benefit from quick scannable claims."
    }
  },
  contactFacts: {
    stacked: {
      label: "Stacked facts",
      visualEffect: "Vertical contact facts.",
      bestFor: "Contact sections where readability and low density matter."
    },
    utility_rail: {
      label: "Utility rail",
      visualEffect: "Compact practical contact facts.",
      bestFor: "Dense contact or location facts that should scan quickly."
    }
  },
  gallery: {
    mosaic: {
      label: "Mosaic",
      visualEffect: "Mixed media mosaic.",
      bestFor: "A small set of varied images with one stronger lead image."
    },
    collage: {
      label: "Collage",
      visualEffect: "Layered editorial image arrangement.",
      bestFor: "Brand-forward or portfolio-like pages with strong photography."
    },
    editorial_strip: {
      label: "Editorial strip",
      visualEffect: "Even-width image strip.",
      bestFor: "Proof or gallery images that should feel orderly and comparable."
    }
  },
  quotes: {
    action_tiles: {
      label: "Quote tiles",
      visualEffect: "Card-like testimonial blocks.",
      bestFor: "Short review or testimonial snippets."
    },
    program_rows: {
      label: "Quote rows",
      visualEffect: "Rule-separated testimonial rows.",
      bestFor: "Longer quotes that need more editorial breathing room."
    }
  }
} as const satisfies Record<ArtDirectionSectionRoleV3, Record<string, PresentationGuidanceV3>>;

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
/** Closing CTA band surface; "paper" exists so page bottoms can avoid stacking two dark bands. */
export type CtaBandToneV3 = "dark" | "brand" | "paper";
/** Numeral rendering for numbered lists/steps (program rows, vertical stepper, ledgers). */
export type NumberStyleV3 = "oversized" | "outlined" | "filled_chip";

/** Resolved control values — the rendering authority stored on the version. */
export type DesignControlsV3 = {
  eyebrowTreatment: EyebrowTreatmentV3;
  cardChrome: CardChromeV3;
  figureTreatment: FigureTreatmentV3;
  headingCase: HeadingCaseV3;
  badgeStyle: BadgeStyleV3;
  factHighlight: FactHighlightV3;
  headerSurface: HeaderSurfaceV3;
  ctaBandTone: CtaBandToneV3;
  numberStyle: NumberStyleV3;
};

export type DesignRegisterV3 = "punchy_retail" | "steady_professional" | "warm_boutique";

/** Vertical → register mapping shared by the design-profile selector and the copy pass. */
export function registerForVertical(vertical: string): DesignRegisterV3 {
  if (vertical === "auto_services") return "punchy_retail";
  if (vertical === "auto_body") return "steady_professional";
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
        headerSurface: accentForward ? "brand_bar" : "neutral",
        ctaBandTone: accentForward ? "brand" : "dark",
        numberStyle: accentForward ? "filled_chip" : "oversized"
      };
    case "warm_boutique":
      return {
        eyebrowTreatment: "accent_bar_chip",
        cardChrome: "elevated",
        figureTreatment: "framed_shadow",
        headingCase: "standard",
        badgeStyle: "rounded",
        factHighlight: accentForward ? "accent_value" : "plain",
        headerSurface: "neutral",
        ctaBandTone: "paper",
        numberStyle: "oversized"
      };
    case "steady_professional":
      return {
        eyebrowTreatment: accentForward ? "accent_bar_chip" : "plain_caps",
        cardChrome: "bordered",
        figureTreatment: "flush",
        headingCase: "standard",
        badgeStyle: "square",
        factHighlight: accentForward ? "accent_value" : "plain",
        headerSurface: "neutral",
        ctaBandTone: "dark",
        numberStyle: "outlined"
      };
  }
}
