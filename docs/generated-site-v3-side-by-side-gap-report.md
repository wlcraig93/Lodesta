# Generated Site V3 Side-By-Side Gap Report

Generated at: 2026-06-03T05:52:00.000Z

This report compares the current V3 benchmark reproductions against the actual benchmark screenshots. It is intentionally strict. Passing deterministic browser QA means the pages are render-safe; it does not mean they are visually competitive with Framer/Webflow/Squarespace templates.

## Evidence Used

- Benchmark corpus report: `docs/generated-site-v3-benchmark-coverage-report.md`
- Benchmark screenshot root: `.data/v3-benchmark-corpus/2026-06-03T03-18-34-868Z`
- Reproduction report: `docs/generated-site-v3-benchmark-reproduction-report.md`
- Holdout mapping report: `docs/generated-site-v3-benchmark-holdout-mapping-report.md`
- Reproduction screenshots: paths listed in the reproduction report

## Current Scores

These scores are side-by-side visual/product judgments against the captured references, not against previous Lodesta output.

| Reproduction | Benchmark | Current Score | Main Reason |
|---|---:|---:|---|
| `repro_swiftrooter_service` | `framer:swiftrooter` | 6.6/10 | The overlay action card and compact action strip now match the urgent-service archetype better, but the first viewport still lacks the reference's polished brand vehicle/person composition, horizontal estimate form, and lighter commercial confidence. |
| `repro_gardener_warm` | `framer:gardener` | 7.5/10 | The new block-rendered media hero, booking card, CTA handling, and warm action strip are a real match for the archetype. It still lacks the reference's high-quality residential scene, softer depth, and more refined header/hero integration. |
| `repro_camino_hospitality` | `framer:camino` | 7.0/10 | The editorial scatter, menu preview, and large media band move in the right direction, but the reference has a stronger green art direction, calmer whitespace, finer typography, and more sophisticated media pacing. |
| `repro_luxxcar_premium` | `framer:luxxcar` | 6.8/10 | The premium object stage and dark showcase grid are useful, and the page is less repetitive after the action strip. The reference still has more controlled negative space, icon/brand rhythm, and inventory-like utility. |
| `repro_fabrica_studio` | `framer:fabrica` | 7.0/10 | The block-rendered editorial hero and portfolio index now make the page feel more like a studio template instead of a generic local-service page. The reference still uses much bolder identity, stark black/white fields, extreme whitespace, and stronger editorial control than the current reusable model. |
| `repro_perform_fitness` | `framer:perform` | 6.6/10 | Plan cards improve the offer shape, but the page still misses the reference's bright performance photography, clean coaching-plan rhythm, testimonial section, and sport-specific airiness. |
| `repro_healen_wellness` | `webflow:healen` | 6.2/10 | The reproduction is coherent as a wellness page, but the captured reference is partly a template detail/component preview, so parity scoring is weak evidence. Replace this with a concrete live homepage reference before treating the score as meaningful. |
| `repro_rally_padel_venue` | `webflow:rally-padel` | 7.2/10 | The block-rendered bleed-media hero, floating action card, local action strip, and program rows are closer to the reference's venue flow. The reference is still brighter, more spacious, and more direct with sticky/utility CTAs. |

Average current score: 6.9/10.

## What Improved

- The first builder-control implementation slice added typed visual primitives (`SectionFrameV3`, `BlockV3`, block layout, media crop, action/fact/list content) and a shared visual-section renderer.
- `repro_gardener_warm`, `repro_fabrica_studio`, and `repro_rally_padel_venue` now use block-level visual sections for their most benchmark-sensitive areas instead of relying only on fixed section variants.
- The Playwright reproduction verifier now passes all eight representative pages after the visual-control pass, with desktop/tablet/mobile screenshots and no render findings.
- `appointment_card_overlay` materially improved service, garden, and wellness first viewports by making the primary action part of the hero rather than a generic button row.
- `editorial_scatter` and `hospitality_menu_preview` made the restaurant reproduction recognizably hospitality-led instead of service-card-led.
- `premium_object_stage` gave premium/media-led pages a distinct first-viewport shape instead of reusing a standard split hero.
- `program_rows` helped venue/fitness references avoid generic service cards.
- `local_action_strip`, `portfolio_index`, and `plan_cards` reduced the most obvious repeated "proof/story/FAQ" skeleton.
- Deterministic QA now validates V3 renderer use, no product UI button leakage, no internal/meta copy, image loading, contrast, font size, horizontal overflow, and visual-section CTA visibility across desktop/tablet/mobile.

## What This Proves

- The current V3 renderer can create eight archetype-shaped pages from reusable props and shared CSS, and the first block-level visual-control slice works inside the public renderer.
- The current benchmark corpus covers 46 references across Framer, Webflow, and Squarespace, with 8 representative references and 10 holdouts.
- The holdout set can be mapped to existing selectable V3 variants without adding one-off CSS.
- The current component surface is better than the earlier V2-style output, but it is not yet a 9.5 product-quality system.

## Root Causes

### 1. V3 Still Has A Repeated Page Skeleton

The newest reproduction pass no longer forces every page through the same full skeleton, but it still relies on a small set of section-level components. The page planner can choose fewer sections, yet it cannot position lower-level blocks with the flexibility that Webflow, Framer, and Squarespace expose.

High-end references often change section type, section height, media density, and content role more aggressively. Our sections are reusable, but the composition planner still has too few low-level controls.

Missing controls:

- optional omission of generic proof/story/FAQ sections when they make the page feel templated
- stronger composition recipes that vary total section count and order by archetype
- section role constraints so "facts," "approach," and "media" do not repeat the same message
- above-the-fold service teaser variants that replace a full service section when appropriate
- lower-level block controls for grid position, span, overlap, image crop, card placement, and breakpoint-specific recomposition

### 2. Hero Variants Are Better But Still Under-Instrumented

The new hero variants prove the direction, but they do not yet expose enough control to reproduce the references tightly.

Missing controls:

- per-hero height presets independent of media crop
- headline scale, line-height, max-width, and optical alignment controls
- form/card width and placement controls
- scatter-media position recipes rather than one generic scatter
- dark/light overlay strength and header contrast controls
- hero integrated trust/action strips

### 3. Header Integration Still Feels Generic

The header is reusable and no longer product-UI-coupled, but it rarely feels designed as part of the page.

Missing controls:

- header inside hero container vs. fixed page band
- transparent/glass/solid header contrast validation per hero
- compact utility CTA treatment
- brand mark vs. wordmark-only rules
- mobile nav treatment beyond simple hiding

### 4. Services And Utility Sections Are Too Literal

The copy and section roles still frequently explain the website instead of selling the business. Even when the public text avoids "template" language, the structure can feel like an internal checklist.

Missing controls:

- problem-led rows for local services
- offer/menu/program sections that can be small and atmospheric
- portfolio/case-study cards for studio/professional pages
- coaching/package cards for fitness and professional service
- richer local contact/footer modules so practical info does not require a generic "useful facts" section

### 5. Media Quality Is Still A First-Class Blocker

The current reproductions use temporary curated remote stock to test composition. That is enough for a benchmark harness, not for production generation.

Required controls:

- curated asset registry with rights metadata
- first-party media preference and subject/crop verification
- AI-image policy and visual suitability scoring before render
- no random external image URLs in production
- fallback recipes that remain beautiful without strong media

### 6. Some Benchmark References Need Replacement

The corpus is useful, but not every reference is equally strong evidence.

Known weak references:

- `webflow:healen` currently captures a template/component preview rather than a clean live homepage proof.
- `webflow:pretty` appears to resolve to a mismatched product/SaaS demo despite being categorized as wellness/beauty.
- `webflow:brivex` and `squarespace:restaurant-category` are marketplace/category references, useful for vocabulary but weak for visual parity scoring.

## Next Component Work

The next implementation pass should be a builder-control pass, not another markdown-instructions pass.

1. Audit Webflow, Framer, and Squarespace support docs for their actual component/control models.
2. Create a Lodesta V3 builder-control matrix covering low-level primitives, section slots, layout controls, style controls, responsive controls, and recipe constraints.
3. Map current V3 capabilities to that matrix and label each control as present, partial, missing, or intentionally out of scope.
4. Refactor V3 around low-level primitives plus constrained archetype recipes before adding more fixed section variants.
5. Add hero control fields for headline scale, card placement, media crop, overlay strength, and header integration mode.
6. Add a media registry/suitability layer for benchmark and production-safe assets.
7. Replace weak holdout references with concrete live demo URLs where available.

## Stop Condition For This Phase

Do not claim V3 visual quality is solved until the representative reproduction average is at least 8.5/10 against actual reference screenshots, with no individual representative below 8.0. The 9.5 target remains the product goal; 8.5 is the next proof threshold that the component surface is moving in the right direction.

Current status: not solved. The benchmark architecture is now useful, but the visual layer still needs a composition-system pass and stronger section variants before it can plausibly reach the target.
