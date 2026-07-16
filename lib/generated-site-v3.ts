import type { SiteArtDirectionRecipeV3 } from "./models";

export const generatedSiteV3ArtifactTypes = [
  "art_direction_decision",
  "media_asset_decision",
  "copy_evaluation_report",
  "v3_review_packet",
  "generation_cost_report"
] as const;

export const generatedSiteV3FontPairings = [
  "editorial_serif_clean_sans",
  "display_sans_humanist",
  "condensed_service_sans",
  "warm_editorial_sans",
  "precision_grotesk",
  "friendly_rounded",
  "magazine_grotesk",
  "quiet_serif"
] as const;

export const initialSiteArtDirectionRecipesV3: SiteArtDirectionRecipeV3[] = [
  {
    id: "editorial-service-light-v1",
    version: "site-art-direction-recipe-v1",
    fontPairingId: "display_sans_humanist",
    colorSystem: "light_editorial",
    spacingRhythm: "spacious",
    headerModes: ["solid_editorial", "compact_sticky"],
    mediaTreatment: "editorial_crop",
    buttonSystem: "solid_with_quiet_secondary",
    cardTreatment: "minimal_surface",
    density: "balanced"
  },
  {
    id: "media-led-local-v1",
    version: "site-art-direction-recipe-v1",
    fontPairingId: "magazine_grotesk",
    colorSystem: "media_neutral",
    spacingRhythm: "cinematic",
    headerModes: ["transparent_overlay", "solid_editorial"],
    mediaTreatment: "full_bleed_story",
    buttonSystem: "high_contrast_primary",
    cardTreatment: "borderless",
    density: "open"
  },
  {
    id: "warm-neighborhood-v1",
    version: "site-art-direction-recipe-v1",
    fontPairingId: "friendly_rounded",
    colorSystem: "warm_neighborhood",
    spacingRhythm: "standard",
    headerModes: ["solid_editorial", "utility_call_bar"],
    mediaTreatment: "natural_crop",
    buttonSystem: "rounded_primary",
    cardTreatment: "soft_surface",
    density: "balanced"
  },
  {
    id: "precision-service-v1",
    version: "site-art-direction-recipe-v1",
    fontPairingId: "precision_grotesk",
    colorSystem: "high_contrast_neutral",
    spacingRhythm: "standard",
    headerModes: ["compact_sticky", "utility_call_bar"],
    mediaTreatment: "subject_crop",
    buttonSystem: "solid_with_quiet_secondary",
    cardTreatment: "hairline_surface",
    density: "dense"
  },
  {
    id: "quiet-boutique-v1",
    version: "site-art-direction-recipe-v1",
    fontPairingId: "quiet_serif",
    colorSystem: "quiet_boutique",
    spacingRhythm: "spacious",
    headerModes: ["minimal_wordmark", "solid_editorial"],
    mediaTreatment: "editorial_crop",
    buttonSystem: "understated",
    cardTreatment: "borderless",
    density: "open"
  },
  {
    id: "auto-body-premium-no-media-v1",
    version: "site-art-direction-recipe-v1",
    fontPairingId: "precision_grotesk",
    colorSystem: "auto_body_premium_no_media",
    spacingRhythm: "spacious",
    headerModes: ["solid_editorial", "compact_sticky"],
    mediaTreatment: "media_independent",
    buttonSystem: "high_contrast_primary",
    cardTreatment: "hairline_surface",
    density: "balanced"
  }
];
