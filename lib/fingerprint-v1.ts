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
  sectionOptionSequence: string[];
  heroGeometry: string;
  recipeId: string;
  fontPairingId: string;
  presentationMap: Record<string, string>;
  controls: Record<string, string>;
  backgroundSequence: string[];
  primaryColor: string;
  accentColor: string;
  mediaTreatment: string;
  designArchetypeId: string;
  mediaReuseCount: number;
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
      designArchetypeId?: string;
      fontPairingId?: string;
      mediaTreatment?: string;
      sectionPresentation?: Record<string, string>;
      controls?: Record<string, string>;
    };
  };
  const visuals = (v3.pageComposition?.pages[0]?.sections ?? [])
    .map((section) => (section.props as { visualSectionV3?: { templateId: string; options?: Record<string, unknown> } } | undefined)?.visualSectionV3)
    .filter((visual): visual is NonNullable<typeof visual> => Boolean(visual));
  const hero = visuals[0];
  return {
    version: "fingerprint-v1",
    templateSequence: visuals.map((visual) => visual.templateId),
    sectionOptionSequence: visuals.map(sectionOptionFingerprintKeyV1),
    heroGeometry: hero ? `${hero.templateId}:${backgroundKindKeyV1(hero.options?.background)}` : "none",
    recipeId: v3.artDirection?.recipeId ?? "none",
    fontPairingId: v3.artDirection?.fontPairingId ?? "none",
    presentationMap: v3.artDirection?.sectionPresentation ?? {},
    controls: v3.artDirection?.controls ?? {},
    backgroundSequence: visuals.map((visual) => backgroundSequenceKeyV1(visual.options?.background)),
    primaryColor: quantizeHex(version.theme?.colors?.primary),
    accentColor: quantizeHex(version.theme?.colors?.accent),
    mediaTreatment: v3.artDirection?.mediaTreatment ?? "none",
    designArchetypeId: v3.artDirection?.designArchetypeId ?? (version as { designArchetypeId?: string }).designArchetypeId ?? "none",
    mediaReuseCount: ((version as { mediaReuseDecisions?: unknown[] }).mediaReuseDecisions ?? []).length
  };
}

const axisWeights = {
  templateSequence: 16,
  sectionOptionSequence: 14,
  heroGeometry: 14,
  fontPairingId: 12,
  presentationMap: 12,
  controls: 10,
  backgroundSequence: 8,
  primaryColor: 6,
  accentColor: 4,
  mediaTreatment: 4,
  designArchetypeId: 10,
  mediaReuseCount: 4
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
  similarity += axisWeights.sectionOptionSequence * sequenceSimilarity(left.sectionOptionSequence, right.sectionOptionSequence);
  similarity += axisWeights.heroGeometry * (left.heroGeometry === right.heroGeometry ? 1 : 0);
  similarity += axisWeights.fontPairingId * (left.fontPairingId === right.fontPairingId ? 1 : 0);
  similarity += axisWeights.presentationMap * recordSimilarity(left.presentationMap, right.presentationMap);
  similarity += axisWeights.controls * recordSimilarity(left.controls, right.controls);
  similarity += axisWeights.backgroundSequence * sequenceSimilarity(left.backgroundSequence, right.backgroundSequence);
  similarity += axisWeights.primaryColor * (left.primaryColor === right.primaryColor ? 1 : 0);
  similarity += axisWeights.accentColor * (left.accentColor === right.accentColor ? 1 : 0);
  similarity += axisWeights.mediaTreatment * (left.mediaTreatment === right.mediaTreatment ? 1 : 0);
  similarity += axisWeights.designArchetypeId * (left.designArchetypeId === right.designArchetypeId ? 1 : 0);
  similarity += axisWeights.mediaReuseCount * (left.mediaReuseCount === right.mediaReuseCount ? 1 : 0);
  const totalWeight = Object.values(axisWeights).reduce((sum, weight) => sum + weight, 0);
  return Math.round((1 - similarity / totalWeight) * 100);
}

/** Fleet-health threshold: same-vertical pairs below this distance are flagged for catalog expansion. */
export const fingerprintDistanceThresholdV1 = 25;

function sectionOptionFingerprintKeyV1(visual: { templateId: string; options?: Record<string, unknown> }) {
  const options = visual.options ?? {};
  const optionPairs = Object.entries(options)
    .filter(([key]) => key !== "background")
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`);
  return `${visual.templateId}{${optionPairs.join(",")}}`;
}

function backgroundKindKeyV1(value: unknown) {
  return value && typeof value === "object" && "kind" in value && typeof value.kind === "string" ? value.kind : "token";
}

function backgroundSequenceKeyV1(value: unknown) {
  if (!value || typeof value !== "object") return "page";
  if ("token" in value && typeof value.token === "string") return value.token;
  if ("kind" in value && typeof value.kind === "string") return value.kind;
  return "page";
}

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
