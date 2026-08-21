export const trustedFontLibraryIdentity = "lodesta-trusted-font-library@sha256:a67304477c664038ed6ce91e96cd73a13756af9c2e777198344563e7d09a209a" as const;

export const trustedFontTextPolicy = {
  coverage: "Managed Lodesta faces guarantee their pinned cmap plus U+2197, U+21AF, U+2713, and U+2733.",
  authoredCopy: "Do not use emoji in agent-authored copy or controls.",
  icons: "Author decorative icons as accessible inline SVG instead of font glyphs or emoji.",
  ownerEmoji: "Preserve unsupported owner-authoritative emoji as an unresolved publishing issue until the owner approves ordinary text or Lodesta adds portable coverage."
} as const;

export const trustedAuthoringFonts = [
  {
    family: "Lodesta Inter",
    cssFamily: "\"Lodesta Inter\", Inter, ui-sans-serif, system-ui, sans-serif",
    character: "neutral, highly legible sans for dense service information and restrained modern systems",
    portableTextCoverage: "Pinned Latin cmap plus U+2197, U+21AF, U+2713, and U+2733; no emoji guarantee",
    roles: ["body", "navigation", "display"]
  },
  {
    family: "Lodesta Figtree",
    cssFamily: "\"Lodesta Figtree\", ui-sans-serif, system-ui, sans-serif",
    character: "friendly geometric-humanist sans for approachable neighborhood businesses",
    portableTextCoverage: "Pinned Latin cmap plus U+2197, U+21AF, U+2713, and U+2733; no emoji guarantee",
    roles: ["body", "navigation", "display"]
  },
  {
    family: "Lodesta Manrope",
    cssFamily: "\"Lodesta Manrope\", ui-sans-serif, system-ui, sans-serif",
    character: "clean technical sans with open forms for capable service businesses",
    portableTextCoverage: "Pinned Latin cmap plus U+2197, U+21AF, U+2713, and U+2733; no emoji guarantee",
    roles: ["body", "navigation", "display"]
  },
  {
    family: "Lodesta Newsreader",
    cssFamily: "\"Lodesta Newsreader\", Georgia, ui-serif, serif",
    character: "warm editorial serif for credible, human headlines and selective long-form emphasis",
    portableTextCoverage: "Pinned Latin cmap plus U+2197, U+21AF, U+2713, and U+2733; no emoji guarantee",
    roles: ["display", "body"]
  },
  {
    family: "Lodesta Fraunces",
    cssFamily: "\"Lodesta Fraunces\", Georgia, ui-serif, serif",
    character: "expressive soft-serif display face for distinctive but controlled identity",
    portableTextCoverage: "Pinned Latin cmap plus U+2197, U+21AF, U+2713, and U+2733; no emoji guarantee",
    roles: ["display"]
  },
  {
    family: "Lodesta Roboto Condensed",
    cssFamily: "\"Lodesta Roboto Condensed\", \"Arial Narrow\", ui-sans-serif, sans-serif",
    character: "practical condensed display face for trade, automotive, and operational emphasis",
    portableTextCoverage: "Pinned Latin cmap plus U+2197, U+21AF, U+2713, and U+2733; no emoji guarantee",
    roles: ["display", "navigation"]
  }
] as const;
