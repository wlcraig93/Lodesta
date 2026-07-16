import { siteVariationSeedV2 } from "./brand-expression-v1";
import type {
  BrandExpressionFontPostureV1,
  BusinessProfile,
  SiteArtDirectionFontPairingIdV3,
  SiteArtDirectionRecipeV3,
  SiteHeaderModeV3,
  Vertical
} from "./models";
import type {
  ContactLayoutV3,
  HeroCtaLayoutV3,
  HeroHeadlineScaleV3,
  HeroLayoutV3,
  HeroMediaTreatmentV3,
  HeroProofPlacementV3,
  ServiceIndexTreatmentV3
} from "./generated-site-v3-visual-controls";
import type { DesignControlsV3, SectionPresentationMapV3 } from "./generated-site-v3-art-direction-catalog";

export type GeneratedSiteDesignSystemV1 = {
  id: string;
  label: string;
  version: "generated-site-design-system-v1";
  manuallyApproved: boolean;
  approval: {
    status: "approved";
    desktopReview: string;
    mobileReview: string;
    distinctiveness: string;
  };
  verticals: readonly (Vertical | "all")[];
  compositionDirective: string;
  hero: {
    heroLayout: HeroLayoutV3;
    proofPlacement: HeroProofPlacementV3;
    ctaLayout: HeroCtaLayoutV3;
    mediaTreatment: HeroMediaTreatmentV3;
    headlineScale: HeroHeadlineScaleV3;
  };
  services: {
    largeFlatServiceTreatment: ServiceIndexTreatmentV3;
    presentation?: SectionPresentationMapV3["services"];
  };
  contact: {
    contactLayout: ContactLayoutV3;
  };
  sectionPolicy: {
    heroTemplate: "hero_statement" | "hero_split";
    compactServicesTemplate: "intro_grid" | "side_intro_rows";
    largeServicesTemplate: "service_index";
    orderedSectionIds: readonly ("hero" | "trust" | "services" | "media" | "process" | "about" | "testimonials" | "location" | "faq" | "contact")[];
  };
  chassis: {
    fontPairingMenu: readonly SiteArtDirectionFontPairingIdV3[];
    colorSystem: SiteArtDirectionRecipeV3["colorSystem"];
    spacingRhythm: SiteArtDirectionRecipeV3["spacingRhythm"];
    headerMode: SiteHeaderModeV3;
    buttonSystem: SiteArtDirectionRecipeV3["buttonSystem"];
    cardTreatment: SiteArtDirectionRecipeV3["cardTreatment"];
    density: SiteArtDirectionRecipeV3["density"];
    controls: Partial<DesignControlsV3>;
  };
};

export type GeneratedSiteDesignSystemAssignmentV1 = {
  designSystem: GeneratedSiteDesignSystemV1;
  reason: string;
};

export const generatedSiteDesignSystemsV1: readonly GeneratedSiteDesignSystemV1[] = [
  {
    id: "auto_body_premium_no_media",
    label: "Auto Body Premium No Media",
    version: "generated-site-design-system-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved as the no-media floor target: typography, service facts, hours, and conversion carry the first viewport without photo dependency.",
      mobileReview: "Approved for compact no-media hero, no empty media wells, and scan-first service/action hierarchy.",
      distinctiveness: "Deep curated automotive palette, large editorial service promise, proof-in-words, and ledger-like service rhythm."
    },
    verticals: ["auto_body"],
    compositionDirective: "Use a media-independent hero, dense real service specifics, a service matrix, and direct quote/contact path without stock or placeholder imagery.",
    hero: {
      heroLayout: "no_media_editorial",
      proofPlacement: "bottom_strip",
      ctaLayout: "button_plus_text_link",
      mediaTreatment: "flush",
      headlineScale: "standard"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "feature_list" },
    contact: { contactLayout: "quote_card" },
    sectionPolicy: {
      heroTemplate: "hero_statement",
      compactServicesTemplate: "side_intro_rows",
      largeServicesTemplate: "service_index",
      orderedSectionIds: ["hero", "trust", "services", "media", "process", "about", "testimonials", "location", "faq", "contact"]
    },
    chassis: {
      fontPairingMenu: ["precision_grotesk", "condensed_service_sans", "display_sans_humanist"],
      colorSystem: "auto_body_premium_no_media",
      spacingRhythm: "spacious",
      headerMode: "solid_editorial",
      buttonSystem: "high_contrast_primary",
      cardTreatment: "hairline_surface",
      density: "balanced",
      controls: {
        cardChrome: "bordered",
        figureTreatment: "flush",
        eyebrowTreatment: "filled_kicker",
        badgeStyle: "square",
        factHighlight: "accent_value",
        numberStyle: "outlined",
        ctaBandTone: "dark"
      }
    }
  },
  {
    id: "precision_shop_editorial",
    label: "Precision Shop Editorial",
    version: "generated-site-design-system-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for measured editorial split, strong service legibility, and non-generic repair-shop rhythm.",
      mobileReview: "Approved for compact CTA stack, readable proof side-panel collapse, and no service-card cramping.",
      distinctiveness: "Editorial overlap, hairline surfaces, square accents, and precision-grotesk tone."
    },
    verticals: ["auto_body", "auto_services", "home_services"],
    compositionDirective: "Use an editorial split with measured proof, compact CTA rhythm, and grounded service rows.",
    hero: {
      heroLayout: "editorial_overlap",
      proofPlacement: "side_panel",
      ctaLayout: "button_plus_text_link",
      mediaTreatment: "framed",
      headlineScale: "compact"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "showcase_grid" },
    contact: { contactLayout: "quote_card" },
    sectionPolicy: {
      heroTemplate: "hero_split",
      compactServicesTemplate: "side_intro_rows",
      largeServicesTemplate: "service_index",
      orderedSectionIds: ["hero", "trust", "services", "media", "process", "testimonials", "about", "location", "faq", "contact"]
    },
    chassis: {
      fontPairingMenu: ["precision_grotesk", "condensed_service_sans", "display_sans_humanist"],
      colorSystem: "high_contrast_neutral",
      spacingRhythm: "standard",
      headerMode: "solid_editorial",
      buttonSystem: "high_contrast_primary",
      cardTreatment: "hairline_surface",
      density: "balanced",
      controls: {
        cardChrome: "bordered",
        figureTreatment: "framed_shadow",
        badgeStyle: "square",
        eyebrowTreatment: "accent_bar_chip"
      }
    }
  },
  {
    id: "warm_local_counter",
    label: "Warm Local Counter",
    version: "generated-site-design-system-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for neighborhood warmth, approachable text-first first viewport, and balanced card-grid services.",
      mobileReview: "Approved for simple inline CTA behavior, soft surfaces, and easy scanning on narrow screens.",
      distinctiveness: "Warm palette family, rounded panels, elevated cards, and visit-first contact rhythm."
    },
    verticals: ["auto_body", "auto_services", "restaurant", "home_services"],
    compositionDirective: "Use warmer neighborhood rhythm, text-forward proof, and approachable conversion surfaces.",
    hero: {
      heroLayout: "text_first",
      proofPlacement: "bottom_strip",
      ctaLayout: "inline",
      mediaTreatment: "rounded_panel",
      headlineScale: "standard"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "card_grid" },
    contact: { contactLayout: "visit_first" },
    sectionPolicy: {
      heroTemplate: "hero_statement",
      compactServicesTemplate: "intro_grid",
      largeServicesTemplate: "service_index",
      orderedSectionIds: ["hero", "trust", "services", "about", "process", "testimonials", "location", "faq", "contact"]
    },
    chassis: {
      fontPairingMenu: ["warm_editorial_sans", "friendly_rounded", "display_sans_humanist"],
      colorSystem: "warm_neighborhood",
      spacingRhythm: "spacious",
      headerMode: "utility_call_bar",
      buttonSystem: "solid_with_quiet_secondary",
      cardTreatment: "soft_surface",
      density: "balanced",
      controls: {
        cardChrome: "elevated",
        figureTreatment: "framed_shadow",
        badgeStyle: "rounded",
        ctaBandTone: "paper"
      }
    }
  },
  {
    id: "technical_dark_bay",
    label: "Technical Dark Bay",
    version: "generated-site-design-system-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for high-contrast media-led shop-floor direction, dense services, and phone-first conversion.",
      mobileReview: "Approved for compact headline scale, retained CTA visibility, and dark-surface contrast.",
      distinctiveness: "Dark technical chassis, flush media, condensed service sans, and tilted/outlined control details."
    },
    verticals: ["auto_body", "auto_services", "fitness"],
    compositionDirective: "Use high-contrast shop-floor composition with tight services and strong phone-first conversion.",
    hero: {
      heroLayout: "media_left",
      proofPlacement: "bottom_strip",
      ctaLayout: "button_plus_text_link",
      mediaTreatment: "bleed",
      headlineScale: "compact"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "premium_showcase" },
    contact: { contactLayout: "quote_card" },
    sectionPolicy: {
      heroTemplate: "hero_split",
      compactServicesTemplate: "intro_grid",
      largeServicesTemplate: "service_index",
      orderedSectionIds: ["hero", "services", "media", "trust", "process", "testimonials", "location", "faq", "contact"]
    },
    chassis: {
      fontPairingMenu: ["condensed_service_sans", "precision_grotesk", "magazine_grotesk"],
      colorSystem: "high_contrast_neutral",
      spacingRhythm: "compact",
      headerMode: "compact_sticky",
      buttonSystem: "high_contrast_primary",
      cardTreatment: "minimal_surface",
      density: "dense",
      controls: {
        cardChrome: "accent_underline",
        figureTreatment: "flush",
        badgeStyle: "tilted",
        numberStyle: "outlined",
        ctaBandTone: "dark"
      }
    }
  },
  {
    id: "quiet_professional_grid",
    label: "Quiet Professional Grid",
    version: "generated-site-design-system-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved as the conservative default path with restrained grid structure and clear contact hierarchy.",
      mobileReview: "Approved for predictable stacked flow, low-friction CTA placement, and plain professional typography.",
      distinctiveness: "Quiet grid, humanist display sans, plain caps, and understated controls."
    },
    verticals: ["all"],
    compositionDirective: "Use restrained grid structure, quiet proof, and low-friction contact hierarchy.",
    hero: {
      heroLayout: "classic_split",
      proofPlacement: "none",
      ctaLayout: "inline",
      mediaTreatment: "framed",
      headlineScale: "standard"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "card_grid" },
    contact: { contactLayout: "call_first" },
    sectionPolicy: {
      heroTemplate: "hero_split",
      compactServicesTemplate: "intro_grid",
      largeServicesTemplate: "service_index",
      orderedSectionIds: ["hero", "services", "trust", "process", "about", "testimonials", "location", "faq", "contact"]
    },
    chassis: {
      fontPairingMenu: ["display_sans_humanist", "quiet_serif", "editorial_serif_clean_sans"],
      colorSystem: "media_neutral",
      spacingRhythm: "standard",
      headerMode: "solid_editorial",
      buttonSystem: "understated",
      cardTreatment: "hairline_surface",
      density: "balanced",
      controls: {
        cardChrome: "bordered",
        figureTreatment: "framed_shadow",
        eyebrowTreatment: "plain_caps"
      }
    }
  },
  {
    id: "premium_media_led",
    label: "Premium Media Led",
    version: "generated-site-design-system-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for stronger media hierarchy, open section pacing, and fewer higher-signal proof moments.",
      mobileReview: "Approved for card-overlay collapse, compact headline scale, and appointment-card contact flow.",
      distinctiveness: "Magazine-grotesk tone, cinematic spacing, flush media, and borderless premium rhythm."
    },
    verticals: ["auto_body", "creative_studio", "beauty_salon", "med_spa"],
    compositionDirective: "Use media-led hierarchy with fewer, stronger proof moments and open section pacing.",
    hero: {
      heroLayout: "card_overlay",
      proofPlacement: "side_panel",
      ctaLayout: "callout_card",
      mediaTreatment: "framed",
      headlineScale: "compact"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "media_grid" },
    contact: { contactLayout: "appointment_card" },
    sectionPolicy: {
      heroTemplate: "hero_split",
      compactServicesTemplate: "intro_grid",
      largeServicesTemplate: "service_index",
      orderedSectionIds: ["hero", "media", "services", "trust", "process", "testimonials", "about", "location", "faq", "contact"]
    },
    chassis: {
      fontPairingMenu: ["magazine_grotesk", "quiet_serif", "display_sans_humanist"],
      colorSystem: "quiet_boutique",
      spacingRhythm: "cinematic",
      headerMode: "minimal_wordmark",
      buttonSystem: "solid_with_quiet_secondary",
      cardTreatment: "borderless",
      density: "open",
      controls: {
        cardChrome: "elevated",
        figureTreatment: "flush",
        badgeStyle: "square",
        ctaBandTone: "paper"
      }
    }
  },
  {
    id: "direct_service_ledger",
    label: "Direct Service Ledger",
    version: "generated-site-design-system-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for dense service-led hierarchy, ledger-like proof rhythm, and direct contact emphasis.",
      mobileReview: "Approved for compact service scanning, short CTA path, and no oversized proof dependency.",
      distinctiveness: "Ledger structure, filled kicker details, precision-grotesk type, and compact service density."
    },
    verticals: ["auto_body", "auto_services", "law_firm", "dental"],
    compositionDirective: "Use dense service hierarchy, ledger-like proof, compact copy, and direct contact emphasis.",
    hero: {
      heroLayout: "text_first",
      proofPlacement: "below_copy",
      ctaLayout: "button_plus_text_link",
      mediaTreatment: "flush",
      headlineScale: "compact"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "menu_preview" },
    contact: { contactLayout: "call_first" },
    sectionPolicy: {
      heroTemplate: "hero_statement",
      compactServicesTemplate: "side_intro_rows",
      largeServicesTemplate: "service_index",
      orderedSectionIds: ["hero", "trust", "services", "process", "testimonials", "about", "location", "faq", "contact"]
    },
    chassis: {
      fontPairingMenu: ["precision_grotesk", "condensed_service_sans", "display_sans_humanist"],
      colorSystem: "light_editorial",
      spacingRhythm: "compact",
      headerMode: "compact_sticky",
      buttonSystem: "understated",
      cardTreatment: "minimal_surface",
      density: "dense",
      controls: {
        cardChrome: "bordered",
        figureTreatment: "flush",
        eyebrowTreatment: "filled_kicker",
        numberStyle: "filled_chip"
      }
    }
  }
] as const;

export function assignGeneratedSiteDesignSystemV1(input: {
  business: BusinessProfile;
  brandApplied: boolean;
  hasHeroMedia: boolean;
}): GeneratedSiteDesignSystemAssignmentV1 {
  if (!input.hasHeroMedia && input.business.vertical === "auto_body") {
    const designSystem = generatedSiteDesignSystemsV1.find((candidate) => candidate.id === "auto_body_premium_no_media") ?? generatedSiteDesignSystemsV1[0];
    return {
      designSystem,
      reason: [
        `${designSystem.label} assigned because auto-body generation is using the no-media-first floor.`,
        "The composition must beat generic or weak media through type, service specifics, curated palette, and proof-in-words."
      ].join(" ")
    };
  }
  if (input.business.vertical === "auto_body") {
    const designSystem = generatedSiteDesignSystemsV1.find((candidate) => candidate.id === "precision_shop_editorial") ?? generatedSiteDesignSystemsV1[0];
    return {
      designSystem,
      reason: `${designSystem.label} assigned because proof-eligible auto-body media is available; the system owns its media-led geometry and section sequence.`
    };
  }
  const eligible = generatedSiteDesignSystemsV1.filter(
    (designSystem) =>
      (designSystem.verticals.includes("all") || designSystem.verticals.includes(input.business.vertical)) &&
      (input.hasHeroMedia || designSystem.sectionPolicy.heroTemplate === "hero_statement")
  );
  const pool = eligible.length
    ? eligible
    : generatedSiteDesignSystemsV1.filter(
        (designSystem) => designSystem.verticals.includes("all") && (input.hasHeroMedia || designSystem.sectionPolicy.heroTemplate === "hero_statement")
      );
  const seed = siteVariationSeedV2(`${input.business.siteId}:design-system`);
  const designSystem = pool[seed % pool.length] ?? generatedSiteDesignSystemsV1[0];
  return {
    designSystem,
    reason: [
      `${designSystem.label} assigned deterministically from site identity and ${input.business.vertical} vertical.`,
      input.hasHeroMedia ? "Proof-eligible hero media allowed a media-capable system." : "No hero-safe media constrained assignment to a text-first system.",
      input.brandApplied ? "Confident brand cues remain authoritative for color/type identity; the design system fixes geometry and rhythm." : "Weak brand cues allow the design system to carry more identity expression."
    ].join(" ")
  };
}

export function generatedSiteDesignSystemByIdV1(id: string | undefined) {
  if (!id) return undefined;
  return generatedSiteDesignSystemsV1.find((designSystem) => designSystem.id === id);
}

export function fontPairingForGeneratedSiteDesignSystemV1(
  designSystem: GeneratedSiteDesignSystemV1,
  posture: BrandExpressionFontPostureV1 | undefined
): SiteArtDirectionFontPairingIdV3 {
  const preferences: Record<BrandExpressionFontPostureV1, readonly SiteArtDirectionFontPairingIdV3[]> = {
    utility: ["precision_grotesk", "display_sans_humanist", "condensed_service_sans"],
    editorial: ["editorial_serif_clean_sans", "quiet_serif", "warm_editorial_sans"],
    condensed: ["condensed_service_sans", "precision_grotesk", "magazine_grotesk"],
    rounded: ["friendly_rounded", "warm_editorial_sans", "display_sans_humanist"],
    premium: ["magazine_grotesk", "quiet_serif", "editorial_serif_clean_sans"]
  };
  const preferred = posture ? preferences[posture].find((candidate) => designSystem.chassis.fontPairingMenu.includes(candidate)) : undefined;
  return preferred ?? designSystem.chassis.fontPairingMenu[0];
}
