import type { SiteVersion } from "./models";

/**
 * fingerprintV1 (next-level plan): deterministic visual-identity vector with
 * a weighted collision-distance function. Diversity is a FLEET-HEALTH
 * reporting gate, never a per-site selection force — business fit,
 * correctness, conversion, and mobile always outrank distance. Low fleet
 * distance reads as "expand the catalog", not "randomize selections".
 */

export type SiteFingerprintV1 = {
  version: "fingerprint-v1";
  templateSequence: string[];
  heroGeometry: string;
  recipeId: string;
  fontPairingId: string;
  presentationMap: Record<string, string>;
  controls: Record<string, string>;
  backgroundSequence: string[];
  primaryColor: string;
  accentColor: string;
  mediaTreatment: string;
};

/** Quantize a hex color to a coarse bucket so near-identical shades collide. */
function quantizeHex(hex: string | undefined): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "none";
  const channel = (offset: number) => Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) / 51);
  return `${channel(1)}-${channel(3)}-${channel(5)}`;
}

export function computeFingerprintV1(version: SiteVersion): SiteFingerprintV1 {
  const v3 = version as SiteVersion & {
    pageComposition?: { pages: Array<{ sections: Array<{ props?: Record<string, unknown> }> }> };
    artDirection?: {
      recipeId?: string;
      fontPairingId?: string;
      mediaTreatment?: string;
      sectionPresentation?: Record<string, string>;
      controls?: Record<string, string>;
    };
  };
  const visuals = (v3.pageComposition?.pages[0]?.sections ?? [])
    .map((section) => (section.props as { visualSectionV3?: { templateId: string; options?: { background?: { kind?: string; token?: string } } } } | undefined)?.visualSectionV3)
    .filter((visual): visual is NonNullable<typeof visual> => Boolean(visual));
  const hero = visuals[0];
  return {
    version: "fingerprint-v1",
    templateSequence: visuals.map((visual) => visual.templateId),
    heroGeometry: hero ? `${hero.templateId}:${hero.options?.background?.kind ?? "token"}` : "none",
    recipeId: v3.artDirection?.recipeId ?? "none",
    fontPairingId: v3.artDirection?.fontPairingId ?? "none",
    presentationMap: v3.artDirection?.sectionPresentation ?? {},
    controls: v3.artDirection?.controls ?? {},
    backgroundSequence: visuals.map((visual) => visual.options?.background?.token ?? visual.options?.background?.kind ?? "page"),
    primaryColor: quantizeHex(version.theme?.colors?.primary),
    accentColor: quantizeHex(version.theme?.colors?.accent),
    mediaTreatment: v3.artDirection?.mediaTreatment ?? "none"
  };
}

const axisWeights = {
  templateSequence: 18,
  heroGeometry: 18,
  fontPairingId: 14,
  presentationMap: 14,
  controls: 12,
  backgroundSequence: 8,
  primaryColor: 8,
  accentColor: 4,
  mediaTreatment: 4
} as const;

function sequenceSimilarity(left: string[], right: string[]): number {
  const max = Math.max(left.length, right.length);
  if (!max) return 1;
  let same = 0;
  for (let index = 0; index < max; index += 1) if (left[index] === right[index]) same += 1;
  return same / max;
}

function recordSimilarity(left: Record<string, string>, right: Record<string, string>): number {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  if (!keys.size) return 1;
  let same = 0;
  for (const key of keys) if (left[key] === right[key]) same += 1;
  return same / keys.size;
}

/** 0 = identical, 100 = maximally distinct. */
export function fingerprintDistanceV1(left: SiteFingerprintV1, right: SiteFingerprintV1): number {
  let similarity = 0;
  similarity += axisWeights.templateSequence * sequenceSimilarity(left.templateSequence, right.templateSequence);
  similarity += axisWeights.heroGeometry * (left.heroGeometry === right.heroGeometry ? 1 : 0);
  similarity += axisWeights.fontPairingId * (left.fontPairingId === right.fontPairingId ? 1 : 0);
  similarity += axisWeights.presentationMap * recordSimilarity(left.presentationMap, right.presentationMap);
  similarity += axisWeights.controls * recordSimilarity(left.controls, right.controls);
  similarity += axisWeights.backgroundSequence * sequenceSimilarity(left.backgroundSequence, right.backgroundSequence);
  similarity += axisWeights.primaryColor * (left.primaryColor === right.primaryColor ? 1 : 0);
  similarity += axisWeights.accentColor * (left.accentColor === right.accentColor ? 1 : 0);
  similarity += axisWeights.mediaTreatment * (left.mediaTreatment === right.mediaTreatment ? 1 : 0);
  const totalWeight = Object.values(axisWeights).reduce((sum, weight) => sum + weight, 0);
  return Math.round((1 - similarity / totalWeight) * 100);
}

/** Fleet-health threshold: same-vertical pairs below this distance are flagged for catalog expansion. */
export const fingerprintDistanceThresholdV1 = 25;

export function minPairwiseDistanceV1(fingerprints: SiteFingerprintV1[]): number | undefined {
  if (fingerprints.length < 2) return undefined;
  let min = 100;
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) {
      min = Math.min(min, fingerprintDistanceV1(fingerprints[i], fingerprints[j]));
    }
  }
  return min;
}
