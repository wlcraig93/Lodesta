import type { BrandAssessment, RenderInspectionResult, Theme, Vertical } from "./models";
import { contrastRatioV3 } from "./generated-site-v3-visual-controls";

/**
 * Deterministic brand-derived theming. Primary cue source is computed colors
 * sampled from the source site's render inspection; AI brand assessment color
 * signals enhance when present but are never required. Output is always
 * WCAG-clamped and falls back to undefined (caller keeps the vertical preset)
 * when cues are too weak.
 */

export type BrandCueV2 = {
  hex: string;
  source: "render_sample" | "ai_signal";
  saturation: number;
  lightness: number;
};

export type BrandCueReportV2 = {
  version: "brand-cue-report-v2";
  cues: BrandCueV2[];
  selectedPrimary?: string;
  selectedAccent?: string;
  applied: boolean;
  reason: string;
};

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

export function parseCssColor(value: string): Rgb | undefined {
  const raw = value.trim();
  const hexMatch = raw.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1].slice(0, 2), 16),
      g: parseInt(hexMatch[1].slice(2, 4), 16),
      b: parseInt(hexMatch[1].slice(4, 6), 16)
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

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const value = l * 255;
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: channel(hue + 1 / 3) * 255, g: channel(hue) * 255, b: channel(hue - 1 / 3) * 255 };
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
    // Neutral grays and near-white/near-black samples carry no brand signal.
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

/** Darkens/saturation-clamps a color until it can serve as a primary (>= 4.5:1 on white). */
function toUsablePrimary(hex: string): string | undefined {
  const rgb = parseCssColor(hex);
  if (!rgb) return undefined;
  const hsl = rgbToHsl(rgb);
  let candidate: Hsl = { h: hsl.h, s: Math.min(hsl.s, 0.85), l: Math.min(hsl.l, 0.42) };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidateHex = hexFromRgb(hslToRgb(candidate));
    if ((contrastRatioV3("#ffffff", candidateHex) ?? 0) >= 4.5) return candidateHex;
    candidate = { ...candidate, l: Math.max(0.08, candidate.l - 0.05) };
  }
  return undefined;
}

function toUsableAccent(hex: string, backgroundHex: string): string | undefined {
  const rgb = parseCssColor(hex);
  if (!rgb) return undefined;
  const hsl = rgbToHsl(rgb);
  let candidate: Hsl = { h: hsl.h, s: Math.min(Math.max(hsl.s, 0.35), 0.85), l: Math.min(Math.max(hsl.l, 0.3), 0.6) };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidateHex = hexFromRgb(hslToRgb(candidate));
    if ((contrastRatioV3(candidateHex, backgroundHex) ?? 0) >= 3) return candidateHex;
    candidate = { ...candidate, l: Math.max(0.12, candidate.l - 0.06) };
  }
  return undefined;
}

function hueDistance(a: string, b: string): number {
  const left = parseCssColor(a);
  const right = parseCssColor(b);
  if (!left || !right) return 0;
  const diff = Math.abs(rgbToHsl(left).h - rgbToHsl(right).h);
  return Math.min(diff, 360 - diff);
}

export function deriveBrandThemeV2(input: {
  vertical: Vertical;
  presetTheme: Theme;
  renderInspection?: RenderInspectionResult;
  brandAssessment?: BrandAssessment;
}): { theme: Theme | undefined; report: BrandCueReportV2 } {
  const cues = extractBrandCuesV2(input);
  const report: BrandCueReportV2 = {
    version: "brand-cue-report-v2",
    cues,
    applied: false,
    reason: ""
  };
  if (!cues.length) {
    report.reason = "No saturated brand color cues were found; the vertical preset theme is used.";
    return { theme: undefined, report };
  }

  // Primary should be the cue that is NATURALLY closest to text-safe, not the
  // loudest one: darkening a dominant light yellow into olive reads muddy,
  // while a darker secondary (signage blue) is the right primary and the
  // bright cue becomes the accent. Rank by how little adjustment each cue
  // needs to reach 4.5:1 on white; lightness 0.25-0.55 cues are ideal.
  const ranked = [...cues].sort((left, right) => {
    const readiness = (cue: typeof left) => {
      // The real metric: how text-safe is the RAW cue on white? A bright
      // yellow at 1.1:1 needs so much darkening it turns olive; a signage
      // blue at 8:1 is the primary as-is. Among text-safe cues, prefer the
      // DARKER one — role assignment, not loudness: a deep navy beats a
      // muddy brown as primary even at lower saturation, because the vivid
      // cue becomes the accent and the dark cue carries headers and CTAs.
      const contrast = contrastRatioV3(cue.hex, "#ffffff") ?? 1;
      const contrastPenalty = contrast >= 4.5 ? 0 : (4.5 - contrast) * 2;
      return contrastPenalty + cue.lightness * 0.5 - cue.saturation * 0.3 + (cue.source === "render_sample" ? -0.05 : 0);
    };
    return readiness(left) - readiness(right);
  });
  const primary = ranked.map((cue) => toUsablePrimary(cue.hex)).find(Boolean);
  if (!primary) {
    report.reason = "No cue could be clamped into a WCAG-safe primary; the vertical preset theme is used.";
    return { theme: undefined, report };
  }

  const background = input.presetTheme.colors.background;
  const accentCue = [...cues]
    .sort((left, right) => right.saturation - left.saturation)
    .find((cue) => hueDistance(cue.hex, primary) >= 40);
  const accent = (accentCue && toUsableAccent(accentCue.hex, background)) ?? input.presetTheme.colors.accent;

  report.selectedPrimary = primary;
  report.selectedAccent = accent;
  report.applied = true;
  report.reason = `Derived primary ${primary} from ${ranked[0].source === "render_sample" ? "source-site render samples" : "AI brand signals"}; background/surface/text stay preset-neutral for contrast safety.`;

  return {
    theme: {
      ...input.presetTheme,
      paletteName: `${input.presetTheme.paletteName}-brand-derived`,
      colors: {
        ...input.presetTheme.colors,
        primary,
        primaryText: "#ffffff",
        accent
      }
    },
    report
  };
}

/** Deterministic per-site seed for bounded composition variation. */
export function siteVariationSeedV2(siteId: string): number {
  let hash = 0;
  for (let index = 0; index < siteId.length; index += 1) {
    hash = (hash * 31 + siteId.charCodeAt(index)) >>> 0;
  }
  return hash;
}
