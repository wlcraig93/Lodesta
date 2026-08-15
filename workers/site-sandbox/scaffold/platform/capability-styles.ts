const legacyLocationCapabilityStyles = `
[data-lodesta-map] {
  --lodesta-location-accent: #17211b;
  --lodesta-location-background: #f7f7f4;
  --lodesta-location-border: rgba(20, 28, 24, 0.18);
  --lodesta-location-muted: #5c655f;
  display: grid;
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--lodesta-location-border);
  background: var(--lodesta-location-background);
  color: inherit;
}
[data-lodesta-map-surface] {
  display: grid;
  gap: 1rem;
  min-width: 0;
  padding: clamp(1.25rem, 3vw, 2rem);
  background:
    linear-gradient(var(--lodesta-location-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--lodesta-location-border) 1px, transparent 1px),
    var(--lodesta-location-background);
  background-size: 2.5rem 2.5rem;
}
[data-lodesta-location-heading] { display: grid; gap: 0.35rem; }
[data-lodesta-location-verified] {
  width: fit-content;
  color: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0;
  text-transform: uppercase;
}
[data-lodesta-location-name] { font-size: clamp(1.35rem, 3vw, 2rem); font-weight: 700; line-height: 1.1; }
[data-lodesta-location-address] { max-width: 36ch; margin: 0; color: inherit; font-style: normal; line-height: 1.5; }
[data-lodesta-location-hours] {
  display: grid;
  grid-template-columns: minmax(7rem, auto) minmax(0, 1fr);
  gap: 0.35rem 1rem;
  max-width: 34rem;
  margin: 0;
}
[data-lodesta-location-hours] > div { display: contents; }
[data-lodesta-location-hours] dt { color: inherit; font-weight: 600; }
[data-lodesta-location-hours] dd { min-width: 0; margin: 0; }
[data-lodesta-map-fallback] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0.75rem 1rem;
  background: var(--lodesta-location-accent);
  color: var(--lodesta-location-background);
  font-weight: 700;
  line-height: 1.2;
  text-decoration: none;
}
@media (min-width: 720px) {
  [data-lodesta-map] { grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; }
  [data-lodesta-map-fallback] { min-width: 11rem; padding-inline: 1.5rem; }
}
`.trim();

export const platformCapabilityStyles = `
:where([data-lodesta-menu-toggle]) {
  min-width: 2.75rem;
  min-height: 2.75rem;
  touch-action: manipulation;
}

:where([data-lodesta-navigation-icon]) {
  display: inline-flex;
  width: 1.5rem;
  height: 1.5rem;
  flex-direction: column;
  justify-content: center;
  gap: 0.25rem;
  color: currentColor;
}

:where([data-lodesta-navigation-icon] > span) {
  display: block;
  width: 100%;
  height: 0.125rem;
  border-radius: 999px;
  background: currentColor;
  transform-origin: center;
  transition: transform var(--site-motion-standard, 180ms) ease, opacity var(--site-motion-standard, 180ms) ease;
}

:where([data-lodesta-menu-toggle][aria-expanded="true"] [data-lodesta-navigation-icon] > span:nth-child(1)) {
  transform: translateY(0.375rem) rotate(45deg);
}

:where([data-lodesta-menu-toggle][aria-expanded="true"] [data-lodesta-navigation-icon] > span:nth-child(2)) {
  opacity: 0;
}

:where([data-lodesta-menu-toggle][aria-expanded="true"] [data-lodesta-navigation-icon] > span:nth-child(3)) {
  transform: translateY(-0.375rem) rotate(-45deg);
}

:where([data-lodesta-navigation-panel][hidden]) {
  display: none !important;
}

:where([data-lodesta-navigation-behavior="modal"] > [data-lodesta-navigation-panel]:not([hidden])) {
  position: fixed;
  z-index: 2147483000;
  inset: var(--lodesta-navigation-top, 0px) 0 0;
  width: 100%;
  max-width: none;
  height: calc(100dvh - var(--lodesta-navigation-top, 0px));
  max-height: calc(100dvh - var(--lodesta-navigation-top, 0px));
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--site-color-background, Canvas);
  color: var(--site-color-text, CanvasText);
}

:where([data-lodesta-navigation-behavior="modal"] > [data-lodesta-navigation-panel] > nav) {
  display: grid;
}

:where([data-lodesta-navigation-panel] a) {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
}

@media (prefers-reduced-motion: reduce) {
  :where([data-lodesta-navigation-icon] > span) {
    transition: none;
  }
}
`.trim();

// The native series leaves presentation entirely to authored CSS. Canonical data bindings,
// safe destinations, forms, and telemetry do not require platform geometry.
const nativePresentationCapabilityStyles = "";

export function platformCapabilityStylesFor(runtimeSeriesId: string) {
  if (runtimeSeriesId === "site-runtime-v1") return legacyLocationCapabilityStyles;
  if (runtimeSeriesId === "site-runtime-v2") return platformCapabilityStyles;
  if (runtimeSeriesId === "site-runtime-v3") return nativePresentationCapabilityStyles;
  throw new Error(`Unknown capability style series ${runtimeSeriesId}.`);
}
