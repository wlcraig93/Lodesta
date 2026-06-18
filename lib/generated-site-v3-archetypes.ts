import { siteVariationSeedV2 } from "./brand-derivation-v2";
import type {
  BusinessProfile,
  SiteArtDirectionFontPairingIdV3,
  SiteArtDirectionRecipeV3,
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

export type GeneratedSiteDesignArchetypeV1 = {
  id: string;
  label: string;
  version: "generated-site-design-archetype-v1";
  manuallyApproved: boolean;
  approval: {
    status: "approved";
    desktopReview: string;
    mobileReview: string;
    distinctiveness: string;
  };
  verticals: readonly (Vertical | "all")[];
  geometryDiversityDirective: string;
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
  chassis: {
    fontPairingId: SiteArtDirectionFontPairingIdV3;
    colorSystem: SiteArtDirectionRecipeV3["colorSystem"];
    spacingRhythm: SiteArtDirectionRecipeV3["spacingRhythm"];
    buttonSystem: SiteArtDirectionRecipeV3["buttonSystem"];
    cardTreatment: SiteArtDirectionRecipeV3["cardTreatment"];
    density: SiteArtDirectionRecipeV3["density"];
    controls: Partial<DesignControlsV3>;
  };
};

export type GeneratedSiteArchetypeAssignmentV1 = {
  archetype: GeneratedSiteDesignArchetypeV1;
  reason: string;
};

export const generatedSiteDesignArchetypesV1: readonly GeneratedSiteDesignArchetypeV1[] = [
  {
    id: "precision_shop_editorial",
    label: "Precision Shop Editorial",
    version: "generated-site-design-archetype-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for measured editorial split, strong service legibility, and non-generic repair-shop rhythm.",
      mobileReview: "Approved for compact CTA stack, readable proof side-panel collapse, and no service-card cramping.",
      distinctiveness: "Editorial overlap, hairline surfaces, square accents, and precision-grotesk tone."
    },
    verticals: ["auto_body", "auto_services", "home_services"],
    geometryDiversityDirective: "Use an editorial split with measured proof, compact CTA rhythm, and grounded service rows.",
    hero: {
      heroLayout: "editorial_overlap",
      proofPlacement: "side_panel",
      ctaLayout: "button_plus_text_link",
      mediaTreatment: "framed",
      headlineScale: "standard"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "showcase_grid" },
    contact: { contactLayout: "call_first" },
    chassis: {
      fontPairingId: "precision_grotesk",
      colorSystem: "high_contrast_neutral",
      spacingRhythm: "standard",
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
    version: "generated-site-design-archetype-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for neighborhood warmth, approachable text-first first viewport, and balanced card-grid services.",
      mobileReview: "Approved for simple inline CTA behavior, soft surfaces, and easy scanning on narrow screens.",
      distinctiveness: "Warm palette family, rounded panels, elevated cards, and visit-first contact rhythm."
    },
    verticals: ["auto_body", "auto_services", "restaurant", "home_services"],
    geometryDiversityDirective: "Use warmer neighborhood rhythm, text-forward proof, and approachable conversion surfaces.",
    hero: {
      heroLayout: "text_first",
      proofPlacement: "bottom_strip",
      ctaLayout: "inline",
      mediaTreatment: "rounded_panel",
      headlineScale: "standard"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "card_grid" },
    contact: { contactLayout: "visit_first" },
    chassis: {
      fontPairingId: "warm_editorial_sans",
      colorSystem: "warm_neighborhood",
      spacingRhythm: "spacious",
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
    version: "generated-site-design-archetype-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for high-contrast media-led shop-floor direction, dense services, and phone-first conversion.",
      mobileReview: "Approved for compact headline scale, retained CTA visibility, and dark-surface contrast.",
      distinctiveness: "Dark technical chassis, flush media, condensed service sans, and tilted/outlined control details."
    },
    verticals: ["auto_body", "auto_services", "fitness"],
    geometryDiversityDirective: "Use high-contrast shop-floor composition with tight services and strong phone-first conversion.",
    hero: {
      heroLayout: "media_left",
      proofPlacement: "bottom_strip",
      ctaLayout: "button_plus_text_link",
      mediaTreatment: "bleed",
      headlineScale: "compact"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "premium_showcase" },
    contact: { contactLayout: "quote_card" },
    chassis: {
      fontPairingId: "condensed_service_sans",
      colorSystem: "high_contrast_neutral",
      spacingRhythm: "compact",
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
    version: "generated-site-design-archetype-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved as the conservative default path with restrained grid structure and clear contact hierarchy.",
      mobileReview: "Approved for predictable stacked flow, low-friction CTA placement, and plain professional typography.",
      distinctiveness: "Quiet grid, humanist display sans, plain caps, and understated controls."
    },
    verticals: ["all"],
    geometryDiversityDirective: "Use restrained grid structure, quiet proof, and low-friction contact hierarchy.",
    hero: {
      heroLayout: "classic_split",
      proofPlacement: "none",
      ctaLayout: "inline",
      mediaTreatment: "framed",
      headlineScale: "standard"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "card_grid" },
    contact: { contactLayout: "call_first" },
    chassis: {
      fontPairingId: "display_sans_humanist",
      colorSystem: "media_neutral",
      spacingRhythm: "standard",
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
    version: "generated-site-design-archetype-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for stronger media hierarchy, open section pacing, and fewer higher-signal proof moments.",
      mobileReview: "Approved for card-overlay collapse, compact headline scale, and appointment-card contact flow.",
      distinctiveness: "Magazine-grotesk tone, cinematic spacing, flush media, and borderless premium rhythm."
    },
    verticals: ["auto_body", "creative_studio", "beauty_salon", "med_spa"],
    geometryDiversityDirective: "Use media-led hierarchy with fewer, stronger proof moments and open section pacing.",
    hero: {
      heroLayout: "card_overlay",
      proofPlacement: "side_panel",
      ctaLayout: "callout_card",
      mediaTreatment: "framed",
      headlineScale: "compact"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "media_grid" },
    contact: { contactLayout: "appointment_card" },
    chassis: {
      fontPairingId: "magazine_grotesk",
      colorSystem: "quiet_boutique",
      spacingRhythm: "cinematic",
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
    version: "generated-site-design-archetype-v1",
    manuallyApproved: true,
    approval: {
      status: "approved",
      desktopReview: "Approved for dense service-led hierarchy, ledger-like proof rhythm, and direct contact emphasis.",
      mobileReview: "Approved for compact service scanning, short CTA path, and no oversized proof dependency.",
      distinctiveness: "Ledger structure, filled kicker details, precision-grotesk type, and compact service density."
    },
    verticals: ["auto_body", "auto_services", "law_firm", "dental"],
    geometryDiversityDirective: "Use dense service hierarchy, ledger-like proof, compact copy, and direct contact emphasis.",
    hero: {
      heroLayout: "text_first",
      proofPlacement: "below_copy",
      ctaLayout: "button_plus_text_link",
      mediaTreatment: "flush",
      headlineScale: "compact"
    },
    services: { largeFlatServiceTreatment: "dropdown_preview", presentation: "menu_preview" },
    contact: { contactLayout: "call_first" },
    chassis: {
      fontPairingId: "precision_grotesk",
      colorSystem: "light_editorial",
      spacingRhythm: "compact",
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

export function assignGeneratedSiteDesignArchetypeV1(input: {
  business: BusinessProfile;
  brandApplied: boolean;
}): GeneratedSiteArchetypeAssignmentV1 {
  const eligible = generatedSiteDesignArchetypesV1.filter(
    (archetype) => archetype.verticals.includes("all") || archetype.verticals.includes(input.business.vertical)
  );
  const pool = eligible.length ? eligible : generatedSiteDesignArchetypesV1.filter((archetype) => archetype.verticals.includes("all"));
  const seed = siteVariationSeedV2(`${input.business.siteId}:design-archetype`);
  const archetype = pool[seed % pool.length] ?? generatedSiteDesignArchetypesV1[0];
  return {
    archetype,
    reason: [
      `${archetype.label} assigned deterministically from site identity and ${input.business.vertical} vertical.`,
      input.brandApplied ? "Confident brand cues remain authoritative for color/type identity; archetype fills geometry and rhythm." : "Weak brand cues allow the archetype to carry more chassis differentiation."
    ].join(" ")
  };
}
