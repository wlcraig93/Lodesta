# Generated Site V3 Builder Control Model

Generated at: 2026-06-03

This document is the pivot from "reverse-engineer finished templates" to "model the reusable controls that make those templates possible." The benchmark corpus still matters, but it should validate output quality rather than be the only way we infer primitives.

## Source Audit

Primary sources reviewed:

- [Webflow: Building web layouts](https://help.webflow.com/hc/en-us/articles/33961378749715-Building-web-layouts)
- [Webflow: Style panel overview](https://help.webflow.com/hc/en-us/articles/33961362040723-Style-panel-overview)
- [Webflow: Component properties](https://help.webflow.com/hc/en-us/articles/33961219350547-Component-properties)
- [Framer: Adding a layout grid](https://www.framer.com/help/articles/layout-grids/)
- [Framer: Setting Text Styles breakpoints](https://www.framer.com/help/articles/setting-text-styles-breakpoints/)
- [Framer: Layout Templates](https://www.framer.com/help/articles/using-layout-templates/)
- [Framer: Components explained](https://www.framer.com/marketplace/tutorials/components-explained/)
- [Framer: Component library best practices](https://www.framer.com/help/articles/best-practices-for-setting-up-a-component-library/)
- [Squarespace: Editing with Fluid Engine](https://support.squarespace.com/hc/en-us/articles/6421525446541-Editing-your-site-with-Fluid-Engine)
- [Squarespace: Moving blocks to customize layouts](https://support.squarespace.com/hc/en-us/articles/206543987-Moving-blocks-to-customize-layouts)
- [Squarespace: Image blocks](https://support.squarespace.com/hc/en-us/articles/205814528-Image-blocks)

## Core Finding

Webflow, Framer, and Squarespace are not just section-template libraries. They expose nested control systems:

1. Low-level structure: sections, containers, blocks/frames/divs, text, image, button, form, nav, footer.
2. Layout controls: block/flex/grid/stack, grid columns, gap, margins, width, size, position, alignment, z-order, overlap, pinning/sticky, full-bleed.
3. Component controls: reusable components with instance properties, variants, show/hide switches, nested components, and shared page templates.
4. Responsive controls: breakpoint-specific grid settings, text style settings, component variants, and mobile layout overrides.
5. Style controls: classes or tokens for typography, colors, backgrounds, borders, effects, spacing, custom properties, and section color modes.

Current V3 is still mostly a high-level section catalog. It can choose variants like `appointment_card_overlay` or `portfolio_index`, but it cannot independently control enough of the child blocks inside those variants. That is why the pages improved but still feel like approximations.

## Builder Capability Matrix

| Capability | Builder Evidence | Lodesta V3 Equivalent | Current State | Required Change |
|---|---|---|---|---|
| Page structure | Framer layout templates reuse nav/footer/sidebar structures; Squarespace pages are stacked sections; Webflow starts from sections/containers. | `PageCompositionV3.pages[].sections` | Present but section-only. | Keep page composition, but add recipe-level section omission/order/density rules. |
| Section/frame primitive | Webflow has Section/Container/flex/Quick Stack; Squarespace Fluid Engine uses block sections. | `SectionInstanceV3` | Present, but too coarse. | Add `SectionFrameV3` controls for width, min height, grid, background, padding, and breakpoint overrides. |
| Low-level blocks | Squarespace blocks can be placed, resized, overlapped; Webflow can use basic elements inside divs/containers. | None canonical. | Missing. | Add `BlockV3` with kind, content refs, grid position, alignment, z, visibility, style token refs. |
| Grid/span controls | Framer grid type/gap/margins/width by breakpoint; Squarespace flexible grid with placement/resize. | `ComponentControlSchemaV3.layout` | Partial enum only. | Replace broad layout enum as the only control with explicit grid templates and block spans. |
| Flex/stack controls | Webflow exposes block/flex/grid display modes; Framer layout templates require vertical Stack. | CSS hidden inside variants. | Missing as data. | Add stack/flex controls: direction, gap, align, justify, wrap, order. |
| Position/overlap/z-order | Squarespace supports overlap plus forward/back/layers. | CSS inside fixed variants. | Missing. | Add controlled overlap recipes and z-layer controls; validate no incoherent overlap on mobile. |
| Component properties | Webflow component props include content, image, link, video, number, switch, CMS-backed values; Framer instances override text/link/variant. | Section props as arbitrary records. | Present but untyped and not slot-specific. | Define typed slot contracts per component: text, rich text, image, CTA, fact, list, form, map/action. |
| Visibility switches | Webflow supports switch props to show/hide elements in instances. | Sparse behavior only. | Partial. | Add explicit optional slot switches and compiler rules for omission instead of filler. |
| Variants | Framer components have variants for states, screen sizes, menus; Webflow has component variants. | `variant` string. | Present but monolithic. | Split variant into component anatomy variant, visual treatment, density, and responsive variant. |
| Style system | Webflow classes/custom properties; Framer component library naming and min/max constraints; Squarespace section colors and image layouts. | `Theme`, `SiteArtDirectionV3`, CSS variables. | Partial. | Add universal token recipes: font pairing, type scale, color recipe, radius, shadows/borders, button system, surface system. |
| Typography breakpoints | Framer text styles can define Desktop/Tablet/Mobile properties. | CSS clamps only. | Partial. | Add type tokens with breakpoint values and validation for no oversized compact text. |
| Media controls | Squarespace image layouts include inline/poster/card/overlap/collage/stack; Fluid Engine uses text/image overlap. | Media variants and `mediaCrop`. | Partial. | Add media block controls: crop, aspect ratio, focal point, overlay, mask/radius, caption mode, full-bleed. |
| Responsive overrides | Framer/Squarespace allow separate mobile layout work; Webflow styles by breakpoints. | `responsiveRules` notes. | Mostly descriptive. | Make responsive overrides executable: per breakpoint block order/span/visibility/type scale/crop. |
| Reusable page templates | Framer layout templates and Webflow components create consistent repeated nav/footer/page structures. | Header/footer renderer hardcoded. | Partial. | Add header/footer/control recipes rather than fixed nav/footer anatomy. |

## Proposed V3 Visual Architecture

### 1. Keep High-Level Components, Add Block-Level Anatomy

Current:

```ts
SectionInstanceV3 {
  family: "services.editorial_index",
  variant: "portfolio_index",
  props: Record<string, unknown>
}
```

Target:

```ts
SectionInstanceV3 {
  family: "services",
  anatomy: "portfolio_index",
  frame: SectionFrameV3,
  blocks: BlockV3[],
  slots: SlotContractV3[],
  responsive: ResponsiveOverrideV3[]
}
```

The renderer should still use shared React/CSS, but the compiler needs more control than a single variant string.

### 2. Define Low-Level Primitives

Required primitives:

- `section_frame`: width, min height, padding, background, grid, overflow, border/radius, media background.
- `group`: nested layout container with stack/flex/grid controls.
- `text`: role, copy slot id, type token, max width, alignment, line clamp, optional eyebrow/caption style.
- `media`: source id, aspect ratio, crop/focal point, radius/mask, overlay, caption mode, placement.
- `cta`: label, href/action kind, visual style, prominence, grouping.
- `fact`: phone/address/hours/service area/proof fact with source policy and display mode.
- `list`: service/program/menu/process/review rows with item density and optional media.
- `form_shell`: contact-only for generic V3; vertical-specific forms later.
- `nav_footer`: header/footer slots with brand, links, CTA, local facts, responsive state.

### 3. Define Executable Controls

Each block needs controls that the compiler can set and the renderer can validate:

```ts
type BlockLayoutV3 = {
  display: "block" | "stack" | "flex" | "grid" | "absolute";
  gridColumn?: { start: number; span: number };
  gridRow?: { start: number; span: number };
  order?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  z?: "base" | "raised" | "overlay" | "top";
  overlap?: "none" | "slight" | "card_over_media" | "caption_overlay";
  width?: "content" | "contained" | "wide" | "full_bleed";
  minHeight?: "auto" | "short" | "viewport_minus_header" | "viewport" | "cinematic";
};
```

Breakpoint overrides should change actual values, not just store notes:

```ts
type ResponsiveOverrideV3 = {
  breakpoint: "mobile" | "tablet" | "desktop" | "wide";
  blockId: string;
  layout?: Partial<BlockLayoutV3>;
  typeToken?: string;
  visibility?: "show" | "hide";
  mediaCrop?: Partial<MediaCropV3>;
};
```

### 4. Separate Recipes From Components

Components define what is possible. Recipes define what is tasteful.

Example recipe:

```ts
type CompositionRecipeV3 = {
  id: "warm_service_action_first";
  allowedHeroAnatomies: ["appointment_overlay", "image_split"];
  sectionSequence: ["hero", "local_action_strip", "services", "media", "contact", "footer"];
  forbiddenRepeats: ["generic_proof_then_generic_story"];
  density: "warm_open";
  mediaPolicy: "first_party_or_curated_safe";
};
```

The AI should choose among valid recipes, not invent arbitrary layout primitives. Code validates the chosen recipe and the block controls.

### 5. Keep Public Renderer Safety

Do not copy Webflow's unlimited styling freedom. Lodesta needs a constrained compiler because sites are generated from imperfect facts.

Non-negotiable constraints:

- No arbitrary CSS from the model.
- Every rendered claim still maps to source facts or allowed generic copy.
- Every image has rights/source/policy metadata.
- Text contrast, font size, overflow, CTA visibility, and broken media stay deterministic QA gates.
- Mobile layout overrides are required for any overlap, full-bleed media, or multi-column composition.
- Generated-site public renderer remains plain React + global CSS.

## What Changes From Current V3

Current V3 added useful variants, but it is still too close to "choose a section template."

The next V3 layer should change the compiler surface:

1. Add typed section frames and block anatomy.
2. Move current variants into templates made of blocks.
3. Add composition recipes that can omit sections and change ordering.
4. Add executable responsive overrides.
5. Update benchmark reproductions to use block-level controls for 3 representative pages before expanding all 8.
6. Score side-by-side again only after those pages render.

## Initial Implementation Slice

Completed first pass on 2026-06-03:

- Added a benchmark-only visual-control module with typed `SectionFrameV3`, `BlockV3`, `BlockLayoutV3`, `MediaCropV3`, `ResponsiveOverrideV3`, and visual content blocks.
- Added a shared visual-section renderer in the public V3 renderer for `hero_overlay_action`, `editorial_portfolio_index`, and `local_action_strip` anatomies.
- Converted the most benchmark-sensitive areas of `framer:gardener`, `framer:fabrica`, and `webflow:rally-padel` to block-level visual sections.
- Updated the render inspection harness so visual-section heroes, visual media blocks, multiple marked hero CTAs, and visual dark/surface contrast are measured directly.
- Verified `npm run typecheck` and `npm run verify:generated-site-v3-benchmark-reproductions`; the full eight-page representative reproduction suite passes with desktop/tablet/mobile screenshots.

Original slice:

1. Define `SectionFrameV3`, `BlockV3`, `BlockLayoutV3`, `MediaCropV3`, and `ResponsiveOverrideV3` in a new visual-control module.
2. Implement three block-rendered components:
   - hero with overlay action card
   - editorial/portfolio media index
   - local action strip
3. Convert three benchmark reproductions to the block model:
   - `framer:gardener`
   - `framer:fabrica`
   - `webflow:rally-padel`
4. Keep the old section renderer available inside the benchmark harness only until those three are reproduced.
5. Compare screenshots against the same benchmark references.
6. If block-level control does not produce a visible jump, stop and reassess before migrating the rest.

Result: block-level control produced a visible jump, but not a 9.5-level jump. The side-by-side average moved to 6.9/10, and the next useful pass is expanding the control system beyond the three converted areas while tightening header integration, media sourcing, and responsive recomposition.

## Open Questions

- Should `BlockV3` live in `lib/models.ts` immediately, or start as a benchmark-only type until the three-page proof passes?
- Should the compiler select recipes through a model-ranked candidate list or code-only heuristics first?
- How many responsive breakpoints are enough for launch: mobile/tablet/desktop, or also wide desktop?
- Which controls are user-editable later versus internal compiler-only?

## Recommendation

Start with a benchmark-only visual-control module. Prove the three representative pages with block-level controls before changing public generation storage. That keeps the experiment honest, avoids another large schema layer too early, and gives us direct evidence about whether the builder-control model is the missing architecture.
