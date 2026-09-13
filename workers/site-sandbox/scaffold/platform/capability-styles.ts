// V4 owns modal state and spatial containment without owning trigger artwork,
// menu composition, breakpoints, spacing, typography, or motion. Zero-specificity
// defaults remain deliberately overridable by authored site classes.
// Fixed top/bottom insets supply the remaining viewport height. A separate height
// or max-height tied to the measured header would conflict with authored insets.
export const platformCapabilityStyles = `:where([data-lodesta-menu-toggle]) {
  min-width: 2.75rem;
  min-height: 2.75rem;
}

:where([data-lodesta-navigation-panel][hidden]) {
  display: none !important;
}

:where([data-lodesta-navigation-behavior="modal"] > [data-lodesta-navigation-panel]:not([hidden])) {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  inset: var(--lodesta-navigation-top, 0px) 0 0;
  width: 100%;
  max-width: none;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--site-color-background, Canvas);
  color: var(--site-color-text, CanvasText);
}`;

export function platformCapabilityStylesFor(runtimeSeriesId: string) {
  if (runtimeSeriesId !== "site-runtime-v4") {
    throw new Error(`Unsupported capability style series ${runtimeSeriesId}; only site-runtime-v4 is canonical.`);
  }
  return platformCapabilityStyles;
}
