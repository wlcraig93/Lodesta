import type {
  BrandAssessment,
  BusinessBrandExpressionV1,
  BusinessProfile,
  RegenerableArtifactProvenanceV1,
  RenderInspectionResult,
  SiteArtDirectionFontPairingIdV3,
  SiteArtDirectionRecipeV3,
  SiteHeaderModeV3,
  Theme
} from "./models";
import {
  contrastRatioV3
} from "./generated-site-v3-visual-controls";
import {
  registerForVertical,
  type DesignControlsV3,
  type DesignProfileV3
} from "./generated-site-v3-art-direction-catalog";
import type { VerticalIdentityProfileV1, VerticalProfileV1 } from "./generated-site-v3-quality-profiles";

export type BrandCueV2 = {
  hex: string;
  source: "render_sample" | "ai_signal";
  saturation: number;
  lightness: number;
};

export type BrandCueReportV2 = {
  version: "brand-cue-report-v2";
  provenance?: RegenerableArtifactProvenanceV1;
  cues: BrandCueV2[];
  selectedPrimary?: string;
  selectedAccent?: string;
  applied: boolean;
  reason: string;
};

export type BrandExpressionResolvedV1 = {
  version: "brand-expression-resolved-v1";
  profileId: VerticalProfileV1["id"];
  profileVersion: VerticalProfileV1["version"];
  seed: number;
  signature: string;
  theme: Theme;
  fontPairingId: SiteArtDirectionFontPairingIdV3;
  headerMode: SiteHeaderModeV3;
  buttonSystem: SiteArtDirectionRecipeV3["buttonSystem"];
  cardTreatment: SiteArtDirectionRecipeV3["cardTreatment"];
  spacingRhythm: SiteArtDirectionRecipeV3["spacingRhythm"];
  colorSystem: SiteArtDirectionRecipeV3["colorSystem"];
  density: SiteArtDirectionRecipeV3["density"];
  backgroundRhythm: string;
  designProfile: DesignProfileV3;
  controls: DesignControlsV3;
  brandCueReport: BrandCueReportV2;
};

type IdentityInput = {
  business: BusinessProfile;
  profile: VerticalProfileV1;
  mediaKind: "media" | "text";
  brandAssessment?: BrandAssessment;
  renderInspection?: RenderInspectionResult;
  brandExpression?: BusinessBrandExpressionV1;
  suppressBrandCues?: boolean;
};

type Hsl = { h: number; s: number; l: number };
type Rgb = { r: number; g: number; b: number };

export function parseCssColor(value: string): Rgb | undefined {
  const raw = value.trim();
  const hexMatch = raw.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    return {
      r: Number.parseInt(hexMatch[1].slice(0, 2), 16),
      g: Number.parseInt(hexMatch[1].slice(2, 4), 16),
      b: Number.parseInt(hexMatch[1].slice(4, 6), 16)
    };
  }
  const rgbMatch = raw.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (alpha < 0.6) return undefined;
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
  }
  const srgbMatch = raw.match(/color\(srgb\s+([^\s)]+)\s+([^\s)]+)\s+([^\s)]+)(?:\s*\/\s*([^\s)]+))?\)/i);
  if (srgbMatch) {
    const channels = [srgbMatch[1], srgbMatch[2], srgbMatch[3]].map((part) => Number.parseFloat(part));
    if (channels.every((part) => Number.isFinite(part))) {
      const alpha = srgbMatch[4] ? Number.parseFloat(srgbMatch[4]) : 1;
      if (alpha < 0.6) return undefined;
      return { r: channels[0] * 255, g: channels[1] * 255, b: channels[2] * 255 };
    }
  }
  return undefined;
}

export function hexFromRgb(rgb: Rgb): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

export function extractBrandCuesV2(input: {
  renderInspection?: RenderInspectionResult;
  brandAssessment?: BrandAssessment;
}): BrandCueV2[] {
  const cues: BrandCueV2[] = [];
  const push = (raw: string, source: BrandCueV2["source"]) => {
    const rgb = parseCssColor(raw);
    if (!rgb) return;
    const hsl = rgbToHsl(rgb);
    if (hsl.s < 0.18 || hsl.l > 0.92 || hsl.l < 0.06) return;
    cues.push({ hex: hexFromRgb(rgb), source, saturation: hsl.s, lightness: hsl.l });
  };
  const samples =
    input.renderInspection?.target === "source_site" ? input.renderInspection.metrics.brandColorSamples ?? [] : [];
  for (const sample of samples) push(sample, "render_sample");
  for (const signal of input.brandAssessment?.colorSignals ?? []) {
    for (const hex of signal.match(/#[0-9a-f]{6}/gi) ?? []) push(hex, "ai_signal");
  }
  return cues;
}

export function siteVariationSeedV2(siteId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < siteId.length; index += 1) {
    hash ^= siteId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

export function resolveBrandExpressionV1(input: IdentityInput): BrandExpressionResolvedV1 {
  const seed = siteVariationSeedV2(`${input.business.siteId}:identity-v1:${input.profile.id}`);
  const theme = constructThemeV1(input, seed);
  const controls = controlsForProfileV1(input.profile.identity, input.business.siteId, seed);
  const headerMode = pickProfileAxisV1(input.profile.identity.headerModes, input.business.siteId, "identity-header");
  const coherentControls = coerceCoherentControlsV1(controls, { headerMode });
  const signature = theme.paletteName.startsWith("identity-v1:")
    ? theme.paletteName
    : `identity-v1:${input.profile.id}:${theme.paletteName}`;
  const designProfile: DesignProfileV3 = {
    register: registerForVertical(input.business.vertical),
    brandPosture: coherentControls.headerSurface === "brand_bar" || coherentControls.factHighlight === "accent_value" ? "accent_forward" : "reserved",
    rationale: `${input.profile.label} profile resolved by brand-expression-v1 (${input.profile.identity.mode}).`
  };

  return {
    version: "brand-expression-resolved-v1",
    profileId: input.profile.id,
    profileVersion: input.profile.version,
    seed,
    signature,
    theme: { ...theme, paletteName: signature },
    fontPairingId: pickProfileAxisV1(input.profile.identity.fontPairings, input.business.siteId, "identity-font"),
    headerMode,
    buttonSystem: pickProfileAxisV1(input.profile.identity.buttonSystems, input.business.siteId, "identity-buttons"),
    cardTreatment: pickProfileAxisV1(input.profile.identity.cardTreatments, input.business.siteId, "identity-cards"),
    spacingRhythm: pickProfileAxisV1(input.profile.identity.spacingRhythms, input.business.siteId, "identity-spacing"),
    colorSystem: pickProfileAxisV1(input.profile.identity.colorSystems, input.business.siteId, "identity-color-system"),
    density: pickProfileAxisV1(input.profile.identity.densities, input.business.siteId, "identity-density"),
    backgroundRhythm: pickProfileAxisV1(input.profile.identity.backgroundRhythms, input.business.siteId, "identity-background-rhythm"),
    designProfile,
    controls: coherentControls,
    brandCueReport: brandCueReportForThemeV1(input, theme)
  };
}

export function validateThemeContrastV1(theme: Theme): string[] {
  const colors = theme.colors;
  const checks: Array<[string, string, string, number]> = [
    ["text_on_background", colors.text, colors.background, 4.5],
    ["text_on_surface", colors.text, colors.surface, 4.5],
    ["muted_on_background", colors.muted, colors.background, 3],
    ["muted_on_surface", colors.muted, colors.surface, 3],
    ["primary_text_on_primary", colors.primaryText, colors.primary, 4.5]
  ];
  const issues: string[] = [];
  for (const [id, foreground, background, minimum] of checks) {
    const ratio = contrastRatioV3(foreground, background);
    if (ratio === undefined || ratio < minimum) {
      issues.push(`${id} contrast ${ratio?.toFixed(2) ?? "unknown"} is below ${minimum} (${foreground} on ${background}).`);
    }
  }
  return issues;
}

export function validateIdentityCoherenceV1(identity: Pick<BrandExpressionResolvedV1, "controls" | "headerMode" | "theme">): string[] {
  const issues: string[] = [];
  if (identity.controls.headerSurface === "brand_bar" && identity.headerMode === "transparent_overlay") {
    issues.push("Brand-bar header surface is incompatible with a transparent overlay header.");
  }
  if (identity.controls.headingCase === "display_upper" && identity.controls.eyebrowTreatment === "plain_caps") {
    issues.push("Uppercase display headings need an accent chip or filled kicker eyebrow for hierarchy.");
  }
  issues.push(...validateThemeContrastV1(identity.theme));
  return issues;
}

function constructThemeV1(input: IdentityInput, seed: number): Theme {
  const identity = input.profile.identity;
  const baseTheme = input.mediaKind === "text" && identity.textFallbackTheme ? identity.textFallbackTheme : identity.baseTheme;
  const brandTheme = themeFromBrandCueV1(input, baseTheme);
  if (identity.mode === "locked") return brandTheme ?? baseTheme;

  const cueHue = brandTheme?.colors.primary ? rgbToHsl(parseCssColor(brandTheme.colors.primary) ?? { r: 0, g: 0, b: 0 }).h : undefined;
  const anchor = identity.hueAnchors[seed % identity.hueAnchors.length] ?? identity.hueAnchors[0];
  const hue = typeof cueHue === "number" ? cueHue : rangedValueV1(anchor.range, seed, "hue");
  const saturation = rangedValueV1(identity.saturation, seed, "saturation");
  const warmth = rangedValueV1(identity.backgroundWarmth, seed, "warmth");
  const neutral = rangedValueV1(identity.neutralTemperature, seed, "neutral");
  const relationship = pickProfileAxisV1(identity.accentRelationships, `${seed}`, "relationship");
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const primary = brandTheme?.colors.primary ?? hslToHex({
      h: hue + attempt * 2,
      s: clamp(saturation + attempt * 0.015, 0.24, 0.78),
      l: clamp(0.25 - attempt * 0.006, 0.16, 0.34)
    });
    const accentHue = accentHueForRelationshipV1(hue, relationship, seed);
    const accent = hslToHex({
      h: accentHue,
      s: clamp(saturation + 0.18, 0.42, 0.82),
      l: relationship === "warm_accent" ? 0.42 : 0.38
    });
    const background = hslToHex({
      h: 52 - warmth * 34 + neutral * 18,
      s: 0.08 + warmth * 0.06,
      l: 0.945
    });
    const surface = hslToHex({
      h: 42 - warmth * 24 + neutral * 12,
      s: 0.04 + warmth * 0.04,
      l: 0.985
    });
    const text = hslToHex({ h: hue, s: 0.12, l: 0.1 });
    const muted = hslToHex({ h: hue, s: 0.09, l: 0.38 });
    const border = hslToHex({ h: hue, s: 0.12, l: 0.82 });
    const theme: Theme = {
      ...baseTheme,
      paletteName: `identity-v1:${input.profile.id}:h${Math.round(hue)}-s${Math.round(saturation * 100)}-w${Math.round(warmth * 100)}-${relationship}${brandTheme ? "-brand-derived" : ""}`,
      colors: {
        background,
        surface,
        text,
        muted,
        primary,
        primaryText: "#ffffff",
        accent,
        border
      },
      typography: {
        heading: pickProfileAxisV1(identity.fontPairings, input.business.siteId, "identity-theme-heading"),
        body: pickProfileAxisV1(identity.fontPairings, input.business.siteId, "identity-theme-body")
      }
    };
    if (!validateThemeContrastV1(theme).length) return theme;
  }
  throw new Error(`Vertical profile ${input.profile.id} cannot produce a contrast-passing identity palette from its bounds.`);
}

function themeFromBrandCueV1(input: IdentityInput, baseTheme: Theme): Theme | undefined {
  const cues = extractBrandCuesV2(input);
  if (!cues.length) return undefined;
  if (input.suppressBrandCues) return undefined;
  let ranked = [...cues].sort((left, right) => {
    const score = (cue: typeof left) => {
      const contrast = contrastRatioV3(cue.hex, "#ffffff") ?? 1;
      return (contrast >= 4.5 ? 0 : (4.5 - contrast) * 2) + cue.lightness * 0.5 - cue.saturation * 0.3;
    };
    return score(left) - score(right);
  });
  const preferredHex = input.brandExpression?.paletteSeed.preferredHex?.toLowerCase();
  const preferred = preferredHex ? ranked.find((cue) => cue.hex.toLowerCase() === preferredHex) : undefined;
  if (preferred) ranked = [preferred, ...ranked.filter((cue) => cue !== preferred)];
  else if (typeof input.brandExpression?.paletteSeed.candidateRank === "number") {
    const index = Math.max(0, Math.min(ranked.length - 1, input.brandExpression.paletteSeed.candidateRank - 1));
    ranked = [ranked[index], ...ranked.filter((_, cueIndex) => cueIndex !== index)];
  }
  const primary = ranked.map((cue) => usablePrimaryV1(cue.hex)).find(Boolean);
  if (!primary) return undefined;
  const accentCue = cues.find((cue) => hueDistanceV1(cue.hex, primary) >= 40);
  const accent = (accentCue && usableAccentV1(accentCue.hex, baseTheme.colors.background)) ?? baseTheme.colors.accent;
  const theme: Theme = {
    ...baseTheme,
    paletteName: `${baseTheme.paletteName}-brand-derived`,
    colors: {
      ...baseTheme.colors,
      primary,
      primaryText: "#ffffff",
      accent
    }
  };
  return validateThemeContrastV1(theme).length ? undefined : theme;
}

function brandCueReportForThemeV1(input: IdentityInput, theme: Theme): BrandCueReportV2 {
  const cues = extractBrandCuesV2(input);
  const applied = theme.paletteName.includes("brand-derived");
  return {
    version: "brand-cue-report-v2",
    cues,
    selectedPrimary: applied ? theme.colors.primary : undefined,
    selectedAccent: applied ? theme.colors.accent : undefined,
    applied,
    reason: applied
      ? "brand-expression-v1 seeded the identity palette from a saturated brand cue and validated final contrast."
      : input.suppressBrandCues && cues.length
        ? "An explicit owner palette override suppressed extracted brand colors; seeded profile identity was used."
      : cues.length
        ? "Brand cues were present but did not pass identity contrast/coherence constraints; seeded profile identity was used."
        : "No saturated brand color cues were found; seeded profile identity was used."
  };
}

function controlsForProfileV1(identity: VerticalIdentityProfileV1, siteId: string, seed: number): DesignControlsV3 {
  const axis = <K extends keyof DesignControlsV3>(key: K): DesignControlsV3[K] =>
    pickProfileAxisV1(identity.controls[key], `${siteId}:${seed}`, `identity-control-${String(key)}`);
  return {
    eyebrowTreatment: axis("eyebrowTreatment"),
    cardChrome: axis("cardChrome"),
    figureTreatment: axis("figureTreatment"),
    headingCase: axis("headingCase"),
    badgeStyle: axis("badgeStyle"),
    factHighlight: axis("factHighlight"),
    headerSurface: axis("headerSurface"),
    ctaBandTone: axis("ctaBandTone"),
    numberStyle: axis("numberStyle")
  };
}

function coerceCoherentControlsV1(controls: DesignControlsV3, context: { headerMode: SiteHeaderModeV3 }): DesignControlsV3 {
  const next = { ...controls };
  if (next.headerSurface === "brand_bar" && context.headerMode === "transparent_overlay") next.headerSurface = "neutral";
  if (next.headingCase === "display_upper" && next.eyebrowTreatment === "plain_caps") next.eyebrowTreatment = "accent_bar_chip";
  return next;
}

function pickProfileAxisV1<T>(pool: readonly T[], siteId: string, axis: string): T {
  if (!pool.length) throw new Error(`Identity profile axis "${axis}" has no choices.`);
  return pool[siteVariationSeedV2(`${siteId}:${axis}`) % pool.length];
}

function rangedValueV1(range: readonly [number, number], seed: number, axis: string) {
  const [min, max] = range;
  if (min === max) return min;
  const unit = (siteVariationSeedV2(`${seed}:${axis}`) % 10000) / 9999;
  return min + (max - min) * unit;
}

function accentHueForRelationshipV1(hue: number, relationship: string, seed: number) {
  if (relationship === "warm_accent") return 18 + (seed % 22);
  if (relationship === "analogous") return hue + 28;
  if (relationship === "split") return hue + (seed % 2 === 0 ? 148 : 212);
  return hue + 180;
}

function usablePrimaryV1(hex: string): string | undefined {
  const rgb = parseCssColor(hex);
  if (!rgb) return undefined;
  const hsl = rgbToHsl(rgb);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = hslToHex({ h: hsl.h, s: clamp(hsl.s, 0.28, 0.85), l: clamp(Math.min(hsl.l, 0.38) - attempt * 0.04, 0.1, 0.42) });
    if ((contrastRatioV3("#ffffff", candidate) ?? 0) >= 4.5) return candidate;
  }
  return undefined;
}

function usableAccentV1(hex: string, background: string): string | undefined {
  const rgb = parseCssColor(hex);
  if (!rgb) return undefined;
  const hsl = rgbToHsl(rgb);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = hslToHex({ h: hsl.h, s: clamp(hsl.s, 0.35, 0.85), l: clamp(Math.min(hsl.l, 0.5) - attempt * 0.04, 0.16, 0.58) });
    if ((contrastRatioV3(candidate, background) ?? 0) >= 3) return candidate;
  }
  return undefined;
}

function hueDistanceV1(leftHex: string, rightHex: string) {
  const left = parseCssColor(leftHex);
  const right = parseCssColor(rightHex);
  if (!left || !right) return 0;
  const diff = Math.abs(rgbToHsl(left).h - rgbToHsl(right).h);
  return Math.min(diff, 360 - diff);
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / delta + 2) / 6;
  else h = ((rn - gn) / delta + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToHex(hsl: Hsl): string {
  const hue = (((hsl.h % 360) + 360) % 360) / 360;
  if (hsl.s === 0) {
    const value = hsl.l * 255;
    return hexFromRgb({ r: value, g: value, b: value });
  }
  const q = hsl.l < 0.5 ? hsl.l * (1 + hsl.s) : hsl.l + hsl.s - hsl.l * hsl.s;
  const p = 2 * hsl.l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return hexFromRgb({ r: channel(hue + 1 / 3) * 255, g: channel(hue) * 255, b: channel(hue - 1 / 3) * 255 });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
