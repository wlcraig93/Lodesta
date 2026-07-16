import type {
  AssetAnalysisImageKindV1,
  AssetAnalysisWarningV1,
  AssetReference,
  BusinessProfile,
  GeneratedSiteCompilerDecisionV3,
  SiteArtDirectionFontPairingIdV3,
  SiteArtDirectionRecipeV3,
  SiteHeaderModeV3,
  Theme,
  Vertical
} from "./models";
import type { StandardItemV3 } from "./generated-site-v3-visual-controls";
import type { DesignControlsV3 } from "./generated-site-v3-art-direction-catalog";
import { mediaFloorSlotVerdictV1 } from "./media-floor-v1";

export type VerticalProfileV1 = {
  id: "default_local_service" | Vertical;
  version: "vertical-profile-v1";
  label: string;
  verticals: readonly (Vertical | "default")[];
  identity: VerticalIdentityProfileV1;
  proof: {
    blockedImageKinds: readonly AssetAnalysisImageKindV1[];
    blockedWarnings: readonly AssetAnalysisWarningV1[];
    blockedTextPattern: RegExp;
    requiresSourceBackedSpecificOutcome: boolean;
  };
  services: {
    semanticGroups: readonly GeneratedSiteServiceSemanticGroupV1[];
    largeFlatServiceTreatment: "designed_index" | "conservative_rows";
  };
  copy: {
    pseudoServicePattern: RegExp;
    unsupportedOutcomePattern: RegExp;
    awkwardPhrasePattern: RegExp;
  };
  media: {
    curatedFallbackCategories: readonly string[];
    curatedMediaMayBeProof: false;
  };
};

export type GeneratedSiteVerticalQualityProfileV1 = VerticalProfileV1;

export type VerticalIdentityProfileV1 = {
  mode: "locked" | "expanded";
  baseTheme: Theme;
  textFallbackTheme?: Theme;
  hueAnchors: readonly VerticalHueAnchorV1[];
  saturation: readonly [number, number];
  backgroundWarmth: readonly [number, number];
  neutralTemperature: readonly [number, number];
  accentRelationships: readonly ("complement" | "split" | "analogous" | "warm_accent")[];
  fontPairings: readonly SiteArtDirectionFontPairingIdV3[];
  headerModes: readonly SiteHeaderModeV3[];
  buttonSystems: readonly SiteArtDirectionRecipeV3["buttonSystem"][];
  cardTreatments: readonly SiteArtDirectionRecipeV3["cardTreatment"][];
  spacingRhythms: readonly SiteArtDirectionRecipeV3["spacingRhythm"][];
  densities: readonly SiteArtDirectionRecipeV3["density"][];
  colorSystems: readonly SiteArtDirectionRecipeV3["colorSystem"][];
  controls: {
    [K in keyof DesignControlsV3]: readonly DesignControlsV3[K][];
  };
  backgroundRhythms: readonly string[];
};

export type VerticalHueAnchorV1 = {
  id: string;
  range: readonly [number, number];
};

export type GeneratedSiteServiceSemanticGroupV1 = {
  id: string;
  title: string;
  pattern: RegExp;
};

export type GeneratedSiteMediaSlotV1 = "hero" | "service" | "proof" | "gallery" | "background";

export type GeneratedSiteMediaSuitabilityV1 =
  | { allowed: true }
  | { allowed: false; reason: string; evidence: string };

const universalPseudoServicePattern = /\b(free\s+)?(repair\s+)?(quote|estimate)|appointment|contact\s+us|get\s+a\s+free\b/i;
const universalUnsupportedOutcomePattern =
  /\b(before\s*\/?\s*after|before and after|after|transformation|transformed|result|results|restored|finished|repaired|fixed|review|testimonial|certified|licensed|insured|award)\b/i;

const themeRestaurantWarm: Theme = {
  paletteName: "v3-restaurant-warm",
  colors: {
    background: "#fdf8f1",
    surface: "#fffdf8",
    text: "#26190f",
    muted: "#70614f",
    primary: "#9a3412",
    primaryText: "#ffffff",
    accent: "#d99022",
    border: "#e9dcc9"
  },
  typography: { heading: "magazine_grotesk", body: "magazine_grotesk" },
  radius: "md",
  density: "spacious",
  mood: "warm"
};

const themeHomeServicesUtility: Theme = {
  paletteName: "v3-home-services-utility",
  colors: {
    background: "#f4f7f8",
    surface: "#ffffff",
    text: "#15222b",
    muted: "#5a6b75",
    primary: "#155e75",
    primaryText: "#ffffff",
    accent: "#e0a325",
    border: "#d8e2e6"
  },
  typography: { heading: "precision_grotesk", body: "precision_grotesk" },
  radius: "sm",
  density: "spacious",
  mood: "utilitarian"
};

const themeBeautyPremium: Theme = {
  paletteName: "v3-beauty-premium",
  colors: {
    background: "#fbf7f5",
    surface: "#fffdfb",
    text: "#241a1a",
    muted: "#6f5e5e",
    primary: "#7c2d4e",
    primaryText: "#ffffff",
    accent: "#c9a36a",
    border: "#ead9d3"
  },
  typography: { heading: "magazine_grotesk", body: "magazine_grotesk" },
  radius: "md",
  density: "spacious",
  mood: "premium"
};

const themeAutoServicesUtility: Theme = {
  paletteName: "v3-auto-services-utility",
  colors: {
    background: "#eef2f4",
    surface: "#ffffff",
    text: "#16181a",
    muted: "#59646f",
    primary: "#1f3a5f",
    primaryText: "#ffffff",
    accent: "#d94a1e",
    border: "#d2dde4"
  },
  typography: { heading: "precision_grotesk", body: "precision_grotesk" },
  radius: "sm",
  density: "spacious",
  mood: "utilitarian"
};

const themeAutoBodyPrecision: Theme = {
  paletteName: "v3-auto-precision",
  colors: {
    background: "#eef2f4",
    surface: "#ffffff",
    text: "#14181c",
    muted: "#5a646d",
    primary: "#17324a",
    primaryText: "#ffffff",
    accent: "#d94a1e",
    border: "#d2dde4"
  },
  typography: { heading: "precision_grotesk", body: "precision_grotesk" },
  radius: "sm",
  density: "spacious",
  mood: "editorial"
};

const themeLocalMedia: Theme = {
  paletteName: "v3-local-media",
  colors: {
    background: "#f3f6ef",
    surface: "#fffdf7",
    text: "#13231b",
    muted: "#5f6a61",
    primary: "#145c48",
    primaryText: "#ffffff",
    accent: "#c59d44",
    border: "#d9dfd3"
  },
  typography: { heading: "magazine_grotesk", body: "magazine_grotesk" },
  radius: "md",
  density: "spacious",
  mood: "editorial"
};

const themeLocalTextFirst: Theme = {
  ...themeLocalMedia,
  paletteName: "v3-local-text-first"
};

function lockedIdentity(baseTheme: Theme, input?: Partial<VerticalIdentityProfileV1>): VerticalIdentityProfileV1 {
  return {
    mode: "locked",
    baseTheme,
    hueAnchors: [{ id: "locked", range: [0, 0] }],
    saturation: [0, 0],
    backgroundWarmth: [0, 0],
    neutralTemperature: [0, 0],
    accentRelationships: ["warm_accent"],
    fontPairings: [baseTheme.typography.heading as SiteArtDirectionFontPairingIdV3],
    headerModes: ["solid_editorial"],
    buttonSystems: ["understated"],
    cardTreatments: ["hairline_surface"],
    spacingRhythms: ["standard"],
    densities: ["balanced"],
    colorSystems: ["media_neutral"],
    controls: {
      eyebrowTreatment: ["plain_caps"],
      cardChrome: ["bordered"],
      figureTreatment: ["framed_shadow"],
      headingCase: ["standard"],
      badgeStyle: ["square"],
      factHighlight: ["plain"],
      headerSurface: ["neutral"],
      ctaBandTone: ["dark"],
      numberStyle: ["outlined"]
    },
    backgroundRhythms: ["base"],
    ...input
  };
}

const defaultProfile: GeneratedSiteVerticalQualityProfileV1 = {
  id: "default_local_service",
  version: "vertical-profile-v1",
  label: "Default Local Service",
  verticals: ["default"],
  identity: lockedIdentity(themeLocalMedia, {
    textFallbackTheme: themeLocalTextFirst,
    buttonSystems: ["understated"],
    cardTreatments: ["hairline_surface"],
    spacingRhythms: ["standard"],
    colorSystems: ["media_neutral"]
  }),
  proof: {
    blockedImageKinds: ["logo", "generic_graphic", "text_heavy_graphic", "low_quality", "unknown"],
    blockedWarnings: ["text_overlay", "logo_like", "collage_or_composite", "low_resolution", "blurry", "not_business_relevant"],
    blockedTextPattern: /\b(before|after|transformation|testimonial|review|award|certified|licensed|insured|logo|flyer|banner|screenshot|graphic|collage|composite|overlay)\b/i,
    requiresSourceBackedSpecificOutcome: true
  },
  services: {
    semanticGroups: [],
    largeFlatServiceTreatment: "conservative_rows"
  },
  copy: {
    pseudoServicePattern: universalPseudoServicePattern,
    unsupportedOutcomePattern: universalUnsupportedOutcomePattern,
    awkwardPhrasePattern: /\blists a\b|\bquote price is free\b|\bsite visitors?\b|\bthis website\b/i
  },
  media: {
    curatedFallbackCategories: ["context", "process", "service"],
    curatedMediaMayBeProof: false
  }
};

const autoBodyProfile: GeneratedSiteVerticalQualityProfileV1 = {
  id: "auto_body",
  version: "vertical-profile-v1",
  label: "Auto Body",
  verticals: ["auto_body"],
  identity: {
    mode: "expanded",
    baseTheme: themeAutoBodyPrecision,
    hueAnchors: [
      { id: "steel_blue", range: [205, 224] },
      { id: "deep_cobalt", range: [224, 242] },
      { id: "shop_green", range: [150, 170] },
      { id: "graphite", range: [20, 32] }
    ],
    saturation: [0.28, 0.62],
    backgroundWarmth: [0.02, 0.28],
    neutralTemperature: [0.08, 0.34],
    accentRelationships: ["warm_accent", "complement", "split"],
    fontPairings: ["precision_grotesk", "condensed_service_sans", "magazine_grotesk", "display_sans_humanist"],
    headerModes: ["solid_editorial", "compact_sticky", "utility_call_bar"],
    buttonSystems: ["high_contrast_primary", "solid_with_quiet_secondary"],
    cardTreatments: ["soft_surface", "borderless"],
    spacingRhythms: ["standard", "spacious", "compact"],
    densities: ["balanced", "dense"],
    colorSystems: ["auto_body_premium_no_media", "high_contrast_neutral"],
    controls: {
      eyebrowTreatment: ["accent_bar_chip", "filled_kicker"],
      cardChrome: ["elevated", "accent_underline"],
      figureTreatment: ["flush", "framed_shadow"],
      headingCase: ["standard"],
      badgeStyle: ["rounded", "tilted"],
      factHighlight: ["accent_value"],
      headerSurface: ["brand_bar"],
      ctaBandTone: ["dark", "brand"],
      numberStyle: ["oversized", "filled_chip"]
    },
    backgroundRhythms: ["auto_body_dark_brand", "auto_body_brand_dark", "auto_body_dark_surface"]
  },
  proof: {
    blockedImageKinds: ["logo", "generic_graphic", "text_heavy_graphic", "low_quality", "unknown"],
    blockedWarnings: ["logo_like", "low_resolution", "blurry", "not_business_relevant"],
    blockedTextPattern:
      /\b(before|after|before\s*&\s*after|before\s+and\s+after|transformation|transformed|full vehicle|color transformation|collage|composite|overlay|banner|flyer|graphic|screenshot|logo|watermark)\b/i,
    requiresSourceBackedSpecificOutcome: true
  },
  services: {
    semanticGroups: [
      { id: "collision_body", title: "Impact and Panel Repair", pattern: /\b(collision|auto\s*body|body\s*repair|panel|impact|frame)\b/i },
      { id: "paint_refinish", title: "Auto Paint and Refinishing", pattern: /\b(paint(?:ing)?|refinish|color|clearcoat|primer)\b/i },
      { id: "scratch_scuff", title: "Scratch and Scuff Repair", pattern: /\b(scratch|scuff)\b/i },
      { id: "hail", title: "Hail Damage Repair", pattern: /\bhail\b/i },
      { id: "pdr_dent", title: "Paintless Dent Repair", pattern: /\b(pdr|paintless|dent|ding)\b/i },
      { id: "bumper_panel", title: "Bumper and Panel Repair", pattern: /\b(bumper|fender|quarter|rocker|panel)\b/i },
      { id: "glass_trim", title: "Glass and Trim Damage", pattern: /\b(glass|windshield|window|trim)\b/i },
      { id: "claims", title: "Insurance Claim Support", pattern: /\b(insurance|claim|deductible|adjuster)\b/i }
    ],
    largeFlatServiceTreatment: "designed_index"
  },
  copy: {
    pseudoServicePattern: universalPseudoServicePattern,
    unsupportedOutcomePattern: universalUnsupportedOutcomePattern,
    awkwardPhrasePattern: /\blists a Free Repair Quote\b|\bquote price is free\b|\bFree Repair Quote, and\b|\bsite visitors?\b|\bthis website\b/i
  },
  media: {
    curatedFallbackCategories: ["shop_environment", "repair_process", "service_detail", "paint_prep", "panel_fit"],
    curatedMediaMayBeProof: false
  }
};

const autoServicesProfile: GeneratedSiteVerticalQualityProfileV1 = lockedVerticalProfile("auto_services", "Auto Services", themeAutoServicesUtility, {
  buttonSystems: ["high_contrast_primary"],
  colorSystems: ["high_contrast_neutral"],
  fontPairings: ["precision_grotesk"]
});
const restaurantProfile: GeneratedSiteVerticalQualityProfileV1 = lockedVerticalProfile("restaurant", "Restaurant", themeRestaurantWarm, {
  buttonSystems: ["rounded_primary"],
  cardTreatments: ["soft_surface"],
  colorSystems: ["warm_neighborhood"],
  fontPairings: ["magazine_grotesk"],
  ctaBandTone: "paper",
  badgeStyle: "rounded"
});
const homeServicesProfile: GeneratedSiteVerticalQualityProfileV1 = lockedVerticalProfile("home_services", "Home Services", themeHomeServicesUtility, {
  buttonSystems: ["solid_with_quiet_secondary"],
  colorSystems: ["media_neutral"],
  fontPairings: ["precision_grotesk"]
});
const beautySalonProfile: GeneratedSiteVerticalQualityProfileV1 = lockedVerticalProfile("beauty_salon", "Beauty Salon", themeBeautyPremium, {
  buttonSystems: ["rounded_primary"],
  cardTreatments: ["soft_surface"],
  colorSystems: ["quiet_boutique"],
  fontPairings: ["magazine_grotesk"],
  ctaBandTone: "paper",
  badgeStyle: "rounded"
});

const lockedDefaultVerticalProfiles: GeneratedSiteVerticalQualityProfileV1[] = [
  lockedVerticalProfile("med_spa", "Med Spa", themeLocalMedia),
  lockedVerticalProfile("law_firm", "Law Firm", themeLocalMedia),
  lockedVerticalProfile("dental", "Dental", themeLocalMedia),
  lockedVerticalProfile("fitness", "Fitness", themeLocalMedia),
  lockedVerticalProfile("real_estate", "Real Estate", themeLocalMedia),
  lockedVerticalProfile("landscaping", "Landscaping", themeLocalMedia),
  lockedVerticalProfile("veterinary", "Veterinary", themeLocalMedia),
  lockedVerticalProfile("creative_studio", "Creative Studio", themeLocalMedia),
  lockedVerticalProfile("general_local", "General Local", themeLocalMedia)
];

export const generatedSiteVerticalQualityProfilesV1 = [
  autoBodyProfile,
  autoServicesProfile,
  restaurantProfile,
  homeServicesProfile,
  beautySalonProfile,
  ...lockedDefaultVerticalProfiles,
  defaultProfile
] as const;

function lockedVerticalProfile(
  vertical: Vertical,
  label: string,
  theme: Theme,
  identityOverrides: Partial<{
    buttonSystems: readonly SiteArtDirectionRecipeV3["buttonSystem"][];
    cardTreatments: readonly SiteArtDirectionRecipeV3["cardTreatment"][];
    colorSystems: readonly SiteArtDirectionRecipeV3["colorSystem"][];
    fontPairings: readonly SiteArtDirectionFontPairingIdV3[];
    ctaBandTone: DesignControlsV3["ctaBandTone"];
    badgeStyle: DesignControlsV3["badgeStyle"];
  }> = {}
): GeneratedSiteVerticalQualityProfileV1 {
  return {
    ...defaultProfile,
    id: vertical,
    label,
    verticals: [vertical],
    identity: lockedIdentity(theme, {
      buttonSystems: identityOverrides.buttonSystems ?? ["understated"],
      cardTreatments: identityOverrides.cardTreatments ?? ["hairline_surface"],
      colorSystems: identityOverrides.colorSystems ?? ["media_neutral"],
      fontPairings: identityOverrides.fontPairings ?? [theme.typography.heading as SiteArtDirectionFontPairingIdV3],
      controls: {
        ...lockedIdentity(theme).controls,
        ctaBandTone: [identityOverrides.ctaBandTone ?? "dark"],
        badgeStyle: [identityOverrides.badgeStyle ?? "square"]
      }
    })
  };
}

export function generatedSiteVerticalQualityProfileForBusinessV1(
  business: Pick<BusinessProfile, "vertical">
): GeneratedSiteVerticalQualityProfileV1 {
  return generatedSiteVerticalQualityProfilesV1.find((profile) => profile.verticals.includes(business.vertical)) ?? defaultProfile;
}

export function qualityProfileAssignmentDecisionV1(profile: GeneratedSiteVerticalQualityProfileV1): GeneratedSiteCompilerDecisionV3 {
  return {
    id: `quality_profile.${profile.id}`,
    kind: "quality_profile_assignment",
    severity: "info",
    resolvedValue: profile.id,
    reason:
      profile.id === "default_local_service"
        ? "No tuned vertical profile matched; shared quality principles and the default local-service profile apply."
        : `${profile.label} profile applies vertical-specific service, proof, CTA, and media vocabulary.`
  };
}

export function mediaSuitabilityForProfileV1(input: {
  profile: GeneratedSiteVerticalQualityProfileV1;
  business: Pick<BusinessProfile, "photos" | "vertical">;
  item: { url: string; label: string };
  slot: GeneratedSiteMediaSlotV1;
}): GeneratedSiteMediaSuitabilityV1 {
  const asset = input.business.photos.find((photo) => mediaIdentityKeyV1(photo.url) === mediaIdentityKeyV1(input.item.url));
  const analysis = asset?.analysisV1?.version === "asset-analysis-v1" ? asset.analysisV1 : undefined;
  const labelText = `${input.item.url} ${input.item.label} ${asset?.alt ?? ""}`.trim();

  if (input.slot === "proof") {
    if (asset && input.business.vertical === "auto_body") {
      const floor = mediaFloorSlotVerdictV1(asset, input.business, "proof");
      if (floor.allowed) return { allowed: true };
      return { allowed: false, reason: floor.reason, evidence: analysis?.summary.slice(0, 180) ?? labelText.slice(0, 180) };
    }
    if (!asset && input.profile.proof.requiresSourceBackedSpecificOutcome) {
      return { allowed: false, reason: "proof_media_not_first_party", evidence: labelText.slice(0, 180) };
    }
    if (input.profile.proof.blockedTextPattern.test(labelText)) {
      return { allowed: false, reason: "proof_text_pattern", evidence: labelText.slice(0, 180) };
    }
    if (analysis?.imageKind && input.profile.proof.blockedImageKinds.includes(analysis.imageKind)) {
      return { allowed: false, reason: `proof_image_kind_${analysis.imageKind}`, evidence: analysis.summary.slice(0, 180) };
    }
    const blockedWarning = analysis?.warnings.find((warning) => input.profile.proof.blockedWarnings.includes(warning));
    if (blockedWarning) {
      return { allowed: false, reason: `proof_warning_${blockedWarning}`, evidence: analysis?.summary.slice(0, 180) ?? blockedWarning };
    }
  }

  if (analysis?.warnings.includes("not_business_relevant")) {
    return { allowed: false, reason: "media_not_business_relevant", evidence: analysis.summary.slice(0, 180) };
  }
  return { allowed: true };
}

export function serviceSemanticGroupForProfileV1(
  profile: GeneratedSiteVerticalQualityProfileV1,
  serviceTitle: string
): GeneratedSiteServiceSemanticGroupV1 | undefined {
  if (
    profile.id === "auto_body" &&
    /\bhail\b/i.test(serviceTitle) &&
    /\b(?:paintless|pdr)\b/i.test(serviceTitle)
  ) {
    return profile.services.semanticGroups.find((group) => group.id === "pdr_dent");
  }
  return profile.services.semanticGroups.find((group) => group.pattern.test(serviceTitle));
}

export function semanticDedupeServiceItemsForProfileV1(input: {
  profile: GeneratedSiteVerticalQualityProfileV1;
  items: StandardItemV3[];
}): { items: StandardItemV3[]; decisions: GeneratedSiteCompilerDecisionV3[] } {
  const decisions: GeneratedSiteCompilerDecisionV3[] = [];
  const seen = new Set<string>();
  const seenBodies = new Set<string>();
  const items: StandardItemV3[] = [];
  const groupedItemIndex = new Map<string, number>();
  const groupedSourceTitles = new Map<string, string[]>();
  for (const item of input.items) {
    if (input.profile.copy.pseudoServicePattern.test(item.title)) {
      decisions.push({
        id: `service_semantic_dedupe.pseudo.${normalizeServiceKeyV1(item.title)}`,
        kind: "service_semantic_dedupe",
        severity: "warning",
        requestedValue: item.title,
        resolvedValue: "dropped_pseudo_service",
        reason: `Dropped "${item.title}" because quote/contact CTAs cannot be rendered as services.`
      });
      continue;
    }
    const group = serviceSemanticGroupForProfileV1(input.profile, item.title);
    const semanticKey = group?.id ?? normalizeServiceKeyV1(item.title);
    const bodyKey = normalizeBodyKeyV1(item.body);
    if (group) {
      groupedSourceTitles.set(semanticKey, [...(groupedSourceTitles.get(semanticKey) ?? []), item.title]);
    }
    if (seen.has(semanticKey)) {
      decisions.push({
        id: `service_semantic_dedupe.${semanticKey}`,
        kind: "service_semantic_dedupe",
        severity: "warning",
        requestedValue: item.title,
        resolvedValue: `merged_into_${group?.title ?? semanticKey}`,
        reason: `Merged source-equivalent service "${item.title}" into the rendered "${group?.title ?? semanticKey}" group without removing the source-listed service name.`
      });
      continue;
    }
    seen.add(semanticKey);
    const next = { ...item, title: group?.title ?? item.title };
    if (seenBodies.has(bodyKey)) {
      next.body = serviceSpecificBodyVariantV1(next.title, next.body);
      decisions.push({
        id: `service_semantic_dedupe_body.${semanticKey}`,
        kind: "service_semantic_dedupe",
        severity: "warning",
        requestedValue: item.body,
        resolvedValue: "duplicate_body_contextualized",
        reason: `Duplicate body copy for "${next.title}" was made service-specific so the rendered section does not repeat the same body text.`
      });
    }
    seenBodies.add(normalizeBodyKeyV1(next.body));
    items.push(next);
    if (group) groupedItemIndex.set(semanticKey, items.length - 1);
  }
  for (const [semanticKey, sourceTitles] of groupedSourceTitles) {
    const itemIndex = groupedItemIndex.get(semanticKey);
    if (itemIndex === undefined) continue;
    const item = items[itemIndex];
    const uniqueTitles = [...new Set(sourceTitles)];
    if (uniqueTitles.length === 1) {
      item.title = uniqueTitles[0];
      item.body = groupedServiceBodyV1(semanticKey, uniqueTitles);
      continue;
    }
    item.body = groupedServiceBodyV1(semanticKey, uniqueTitles);
  }
  return { items, decisions };
}

function groupedServiceBodyV1(semanticKey: string, sourceTitles: string[]) {
  const sourceList = joinServiceTitleListV1(sourceTitles);
  if (semanticKey === "collision_body") {
    return `${sourceList} cover damage after a collision, from exterior panels to frame-related concerns. A shop inspection determines what can be repaired and what needs replacement.`;
  }
  if (semanticKey === "paint_refinish") {
    return `${sourceList} handle damaged finish on affected panels. The shop reviews the damage, panel condition, and surrounding color before estimating the work.`;
  }
  if (semanticKey === "scratch_scuff") {
    return `${sourceList} cover scratches, scuffs, dings, and localized finish damage. The shop checks depth, location, and nearby trim before recommending finish or panel work.`;
  }
  if (semanticKey === "pdr_dent" || semanticKey === "hail") {
    return `${sourceList} handle dents across the affected panels. The shop checks each dent's location, depth, and paint condition before recommending a repair approach.`;
  }
  if (semanticKey === "glass_trim") {
    return `${sourceList} cover damaged vehicle glass or trim. The exact part, affected area, and vehicle fit determine the replacement scope.`;
  }
  if (semanticKey === "bumper_panel") {
    return `${sourceList} cover impact damage in the bumper and nearby panels. The shop checks mounting points and surrounding panel condition before outlining the repair.`;
  }
  return `${sourceList} cover the listed repair needs. The shop reviews the affected area and vehicle condition before outlining the work.`;
}

function joinServiceTitleListV1(titles: string[]) {
  if (titles.length <= 1) return titles[0] ?? "";
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]}`;
}

export function unsupportedProofCopyIssueV1(
  profile: GeneratedSiteVerticalQualityProfileV1,
  text: string
): string | undefined {
  if (profile.copy.pseudoServicePattern.test(text)) return "pseudo_service_copy_leaked";
  if (profile.copy.awkwardPhrasePattern.test(text)) return "awkward_profile_copy";
  if (profile.copy.unsupportedOutcomePattern.test(text)) return "unsupported_outcome_copy_requires_evidence";
  return undefined;
}

export function mediaIdentityKeyV1(url: string) {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "");
}

function normalizeServiceKeyV1(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeBodyKeyV1(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function serviceSpecificBodyVariantV1(title: string, body: string) {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  const normalizedBody = body.replace(/\s+/g, " ").trim();
  if (!normalizedBody) return `${normalizedTitle} is handled as its own service scope with a direct estimate path.`;
  return `${normalizedTitle}: ${normalizedBody.charAt(0).toLowerCase()}${normalizedBody.slice(1)}`;
}
