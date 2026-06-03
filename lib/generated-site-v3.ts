import type { GeneratedSiteV3Mode, SiteArtDirectionRecipeV3 } from "./models";

export const defaultGeneratedSiteV3Mode: GeneratedSiteV3Mode = "fixture_only";

export const generatedSiteV3AllNewGenerationsConfirmation = "confirm_layout_v3_all_new_generations";

export function getGeneratedSiteV3Mode(env: NodeJS.ProcessEnv = process.env): GeneratedSiteV3Mode {
  const value = env.GENERATED_SITE_V3_MODE;
  if (value === "off" || value === "fixture_only" || value === "operator_allowlist" || value === "all_new_generations") return value;
  return defaultGeneratedSiteV3Mode;
}

export function generatedSiteV3AllowlistHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.GENERATED_SITE_V3_ALLOWLIST_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function isGeneratedSiteV3Allowed(input: {
  mode?: GeneratedSiteV3Mode;
  sourceHost?: string;
  fixture?: boolean;
  explicitOperatorRequest?: boolean;
  allowlistHosts?: string[];
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input.env ?? process.env;
  const mode = input.mode ?? getGeneratedSiteV3Mode(env);
  if (mode === "off") return false;
  if (input.fixture) return true;
  if (mode === "fixture_only") return false;
  if (mode === "operator_allowlist") {
    if (!input.explicitOperatorRequest || !input.sourceHost) return false;
    return input.allowlistHosts?.includes(input.sourceHost.toLowerCase()) ?? false;
  }
  return env.GENERATED_SITE_V3_CONFIRM_ALL_NEW_GENERATIONS === generatedSiteV3AllNewGenerationsConfirmation;
}

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
  }
];
