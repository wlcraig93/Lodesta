export const trustedFontLibraryIdentity = "lodesta-trusted-font-library@v1" as const;

export const trustedAuthoringFonts = [
  {
    family: "Lodesta Inter",
    cssFamily: "\"Lodesta Inter\", Inter, ui-sans-serif, system-ui, sans-serif",
    character: "neutral, highly legible sans for dense service information and restrained modern systems",
    roles: ["body", "navigation", "display"]
  },
  {
    family: "Lodesta Figtree",
    cssFamily: "\"Lodesta Figtree\", ui-sans-serif, system-ui, sans-serif",
    character: "friendly geometric-humanist sans for approachable neighborhood businesses",
    roles: ["body", "navigation", "display"]
  },
  {
    family: "Lodesta Manrope",
    cssFamily: "\"Lodesta Manrope\", ui-sans-serif, system-ui, sans-serif",
    character: "clean technical sans with open forms for capable service businesses",
    roles: ["body", "navigation", "display"]
  },
  {
    family: "Lodesta Newsreader",
    cssFamily: "\"Lodesta Newsreader\", Georgia, ui-serif, serif",
    character: "warm editorial serif for credible, human headlines and selective long-form emphasis",
    roles: ["display", "body"]
  },
  {
    family: "Lodesta Fraunces",
    cssFamily: "\"Lodesta Fraunces\", Georgia, ui-serif, serif",
    character: "expressive soft-serif display face for distinctive but controlled identity",
    roles: ["display"]
  },
  {
    family: "Lodesta Roboto Condensed",
    cssFamily: "\"Lodesta Roboto Condensed\", \"Arial Narrow\", ui-sans-serif, sans-serif",
    character: "practical condensed display face for trade, automotive, and operational emphasis",
    roles: ["display", "navigation"]
  }
] as const;
