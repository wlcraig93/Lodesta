# Generated Site V3 Template Coverage Gap Audit

Generated at: 2026-06-03

This audit compares the canonical V3 section-template library against common geometry patterns in Webflow, Framer, and Squarespace-style landing pages. The goal is coverage confidence, not one-off marketplace matching.

## Reference Inputs

- Webflow section model: sections are full-width page divisions and containers constrain content width. Source: https://help.webflow.com/hc/en-us/articles/33961262298899-Section
- Webflow component model: reusable components can have unique content, props, slots, and variants while keeping shared structure. Source: https://help.webflow.com/hc/en-us/articles/33961303934611-Components-overview
- Framer landing templates: marketplace landing pages emphasize mobile-tested conversion templates with pricing, features, and reusable sections. Source: https://www.framer.com/marketplace/templates/category/landing-page/
- Framer layout model: stacks and grids are the core responsive layout tools; layout grids are tuned per breakpoint. Sources: https://www.framer.com/academy/lessons/framer-fundamentals-stacks-vs-grids and https://www.framer.com/help/articles/layout-grids/
- Squarespace Fluid Engine: pages are built from block sections, pre-built sections, gallery sections, auto layouts, and breakpoint-specific desktop/mobile layouts. Sources: https://support.squarespace.com/hc/en-us/articles/6421525446541-Editing-your-site-with-Fluid-Engine and https://www.squarespace.com/websites/fluid-engine
- Squarespace gallery/template comparison: common gallery geometry includes single column, masonry/basic grid, side-by-side, and alternating side-by-side patterns. Source: https://support.squarespace.com/hc/en-us/articles/228344967-Template-comparison-charts

## Geometry Coverage

| Reference geometry | V3 coverage | Status | Notes |
| --- | --- | --- | --- |
| Header/navigation chrome | `HeaderStandard` | Covered | V3 chrome, not a content section. |
| Footer chrome | `FooterStandard` | Covered | V3 chrome, not a content section. |
| Split hero | `hero_split` | Covered | Copy plus one bounded media frame. |
| Text-led hero | `hero_statement` | Covered | No media dependency. |
| Full-bleed image hero | `hero_statement` with `background.kind: image` | Covered | Image-backed statement hero derives full-bleed treatment, contrast, and mobile crop rules. |
| Mid-page split media | `split_media` with `mediaSide` | Covered | One bounded media frame plus copy; media can sit left or right on desktop. |
| Intro plus cards | `intro_grid.intro_cards_3` | Covered | Exactly three text cards. |
| Side intro plus editorial rows | `side_intro_rows.numbered_rows` | Covered | Also used for process rows. |
| Strong horizontal feature band | `feature_band.copy_with_facts` | Covered | Copy plus compact facts. |
| Wide image feature | `media_feature.wide_image_statement` | Covered | Below-hero large media rhythm. |
| Image gallery/mosaic | `media_mosaic.intro_mosaic_3` | Added | Three bounded images, no collage/overlap. |
| Testimonial/proof card wall | `quote_wall.three_quotes` | Added | Three proof cards; copy must be owner-verifiable, not fabricated reviews. |
| Pricing/package cards | `intro_grid` with `cardTreatment: comparison` | Added | Three comparison cards; no invented dollar prices. |
| FAQ/question rows | `faq_list.editorial_questions` | Added | Static question rows; accordion behavior deferred. |
| Compact fact strip | `facts_strip.four_facts` | Covered | Contact, location, service, or coverage facts. |
| Facts plus CTA | `facts_cta.request_guidance` | Covered | Conversion panel without media. |
| Editorial statement/typographic break | `editorial_statement.centered_close` | Covered | Quiet centered copy. |
| Contact split | `contact_split.dark_contact` | Covered | Contact close with facts. |

## True Gaps Found

Four high-frequency landing-page geometries were missing from the canonical V3 template layer:

- Gallery/mosaic: needed for hospitality, beauty, portfolio, fitness, and image-led local pages.
- Quote/testimonial wall: needed for trust/proof sections, but constrained to owner-verifiable proof cards.
- Package comparison: needed for service/package/pricing-like layouts without requiring unverified prices; now implemented as the comparison treatment on `intro_grid`.
- FAQ rows: needed for common-question coverage near conversion paths.

These are now active canonical templates with typed slot-state contracts, count ranges, responsive rules, CSS, and render verification coverage.

## Deferred

These were intentionally not added to V1:

- Logo/client strip: lower-frequency for generic local businesses and risky without safe logo evidence.
- Team/profile grid: needs person, credential, and image-rights constraints before becoming canonical.
- Sticky/sidebar narrative: useful in premium templates but higher-risk for mobile and scroll behavior.
- Accordion FAQ: interaction polish can layer on top of `faq_list` after static geometry is proven.
- Asymmetric collage/freeform overlap: explicitly deferred to avoid returning to unapproved geometry combinations.
- Ecommerce/product/store layouts: outside generic landing-page V1 scope.

## Acceptance

The expanded V1 geometry library should stay bounded:

- Every active template has one reviewed default expression.
- Geometry changes require a named template or explicit template option, not a Boolean flag.
- Content variations flow through slots, counts, and copy/media values.
- Mobile and tablet behavior is declared in the template contract and verified with screenshots.
- New templates must pass `npm run verify:generated-site-v3-section-template-library` before being treated as canonical.
