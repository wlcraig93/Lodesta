import coverageManifest from "./font-coverage-manifest.json";

type CodepointRange = readonly [number, number];

type TrustedFontDefinition = {
  family: string;
  filename: string;
  style: "normal";
  weight: string;
};

const managedFonts = [
  { family: "Lodesta Inter", filename: "inter-latin-variable.woff2", style: "normal", weight: "100 900" },
  { family: "Lodesta Figtree", filename: "figtree-latin-variable.woff2", style: "normal", weight: "300 900" },
  { family: "Lodesta Manrope", filename: "manrope-latin-variable.woff2", style: "normal", weight: "200 800" },
  { family: "Lodesta Newsreader", filename: "newsreader-latin-variable.woff2", style: "normal", weight: "200 800" },
  { family: "Lodesta Fraunces", filename: "fraunces-latin-variable.woff2", style: "normal", weight: "100 900" },
  { family: "Lodesta Roboto Condensed", filename: "roboto-condensed-latin-variable.woff2", style: "normal", weight: "100 900" }
] as const satisfies readonly TrustedFontDefinition[];

const portableSymbolSources: readonly { filename: string; ranges: readonly CodepointRange[] }[] = [
  { filename: "figtree-latin-variable.woff2", ranges: [[0x2197, 0x2197]] },
  {
    filename: "lodesta-symbols-v2.008.woff2",
    ranges: [[0x21af, 0x21af], [0x2713, 0x2713], [0x2733, 0x2733]]
  }
];

export const trustedFontFiles = [
  ...managedFonts.map((font) => font.filename),
  "lodesta-symbols-v2.008.woff2"
] as const;

export const trustedFontCoverageManifest = coverageManifest;

const coverageByFilename = new Map(
  coverageManifest.fonts.map((font) => [font.filename, font.coverageRanges as unknown as CodepointRange[]])
);

const portableSymbolCodepoints = new Set(
  portableSymbolSources.flatMap((source) => source.ranges.flatMap(([start, end]) => {
    const values: number[] = [];
    for (let codepoint = start; codepoint <= end; codepoint += 1) values.push(codepoint);
    return values;
  }))
);

function withoutCodepoints(ranges: readonly CodepointRange[], excluded: ReadonlySet<number>) {
  const result: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    let currentStart = start;
    for (let codepoint = start; codepoint <= end; codepoint += 1) {
      if (!excluded.has(codepoint)) continue;
      if (currentStart < codepoint) result.push([currentStart, codepoint - 1]);
      currentStart = codepoint + 1;
    }
    if (currentStart <= end) result.push([currentStart, end]);
  }
  return result;
}

function canonicalRanges(ranges: readonly CodepointRange[]) {
  const sorted = ranges.map(([start, end]) => [start, end] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function cssUnicodeRange(ranges: readonly CodepointRange[]) {
  return ranges.map(([start, end]) => {
    const first = start.toString(16).toUpperCase().padStart(4, "0");
    const last = end.toString(16).toUpperCase().padStart(4, "0");
    return start === end ? `U+${first}` : `U+${first}-${last}`;
  }).join(", ");
}

function face(definition: TrustedFontDefinition, filename: string, ranges: readonly CodepointRange[]) {
  return `@font-face {
  font-family: "${definition.family}";
  src: url("/_lodesta/fonts/${filename}") format("woff2");
  font-style: ${definition.style};
  font-weight: ${definition.weight};
  font-display: swap;
  unicode-range: ${cssUnicodeRange(ranges)};
}`;
}

export const managedFontCoveragePolicy = Object.fromEntries(managedFonts.map((font) => {
  const primaryRanges = coverageByFilename.get(font.filename);
  if (!primaryRanges) throw new Error(`trusted_font_coverage_missing:${font.filename}`);
  return [font.family, canonicalRanges([
    ...primaryRanges,
    ...portableSymbolSources.flatMap((source) => source.ranges)
  ])];
})) as Record<(typeof managedFonts)[number]["family"], Array<[number, number]>>;

export const platformFontStyles = managedFonts.flatMap((font) => {
  const primaryRanges = coverageByFilename.get(font.filename);
  if (!primaryRanges) throw new Error(`trusted_font_coverage_missing:${font.filename}`);
  return [
    face(font, font.filename, withoutCodepoints(primaryRanges, portableSymbolCodepoints)),
    ...portableSymbolSources.map((source) => face(font, source.filename, source.ranges))
  ];
}).join("\n");

export const trustedFontLibraryIdentity = "lodesta-trusted-font-library@sha256:a67304477c664038ed6ce91e96cd73a13756af9c2e777198344563e7d09a209a" as const;
