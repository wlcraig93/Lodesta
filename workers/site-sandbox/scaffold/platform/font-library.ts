export const trustedFontFiles = [
  "inter-latin-variable.woff2",
  "figtree-latin-variable.woff2",
  "manrope-latin-variable.woff2",
  "newsreader-latin-variable.woff2",
  "fraunces-latin-variable.woff2",
  "roboto-condensed-latin-variable.woff2"
] as const;

export const platformFontStyles = `@font-face {
  font-family: "Lodesta Inter";
  src: url("/_lodesta/fonts/inter-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "Lodesta Figtree";
  src: url("/_lodesta/fonts/figtree-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 300 900;
  font-display: swap;
}
@font-face {
  font-family: "Lodesta Manrope";
  src: url("/_lodesta/fonts/manrope-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
}
@font-face {
  font-family: "Lodesta Newsreader";
  src: url("/_lodesta/fonts/newsreader-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
}
@font-face {
  font-family: "Lodesta Fraunces";
  src: url("/_lodesta/fonts/fraunces-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "Lodesta Roboto Condensed";
  src: url("/_lodesta/fonts/roboto-condensed-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}`;
