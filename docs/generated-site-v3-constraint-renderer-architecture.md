# Generated Site V3 Constraint Renderer Architecture

Generated customer sites are boundary-sensitive. The V3 renderer should behave more like a visual builder compiler than a pile of section-specific CSS: invalid geometry is normalized or rejected before browser rendering, and screenshots are used as verification rather than discovery.

## Architectural Takeaway

The previous visual-section experiment proved that broad layout controls without a compiler can produce catastrophic output: oversized hero type, action cards inflating hero grids, unreadable surface colors, and header contrast failures. The go-forward architecture keeps the reusable V3 visual-section content model, but routes it through a constraint compiler before render.

## Canonical Path

- `VisualSectionV3` remains the generated-site visual content model.
- `compileVisualSectionV3` is the canonical pre-render compiler for visual sections.
- `SiteRendererV3` renders compiled visual sections, not raw section objects.
- Generic canonical pages now route through a bounded section-template library before emitting `VisualSectionV3`.
- A section template is the geometry of one horizontal page band: column structure, slot contract, spacing, media bounds, and responsive behavior.
- A section purpose is the semantic use of that geometry: `hero.split`, `services.rows`, `process.steps`, `contact.split`, and so on.
- Template options are the approved choices within a geometry, such as `hero_statement` alignment, `split_media` media side, `intro_grid` card treatment, and section `background`.
- Canonical page sections carry `renderPath: "canonical_section_template"` plus section purpose/template metadata, so verification can reject arbitrary visual-section placement before browser QA.
- Legacy benchmark reproduction and visual-factory executables have been removed from the go-forward renderer path. New generic visual work should use compiled visual sections produced by the canonical section-template library.
- `canonical_editorial` is the first deep generic homepage template stack: one reusable visual system forced across many business shells to prove the renderer can carry high-quality generic site composition.

## Non-Negotiable Invariants

- Grid columns are clamped to a 4-12 column system.
- Foreground `absolute` layout is disallowed.
- Foreground overlap is disallowed unless the block is a bleed/background media layer.
- Explicit foreground row placement is treated as risky and normalized away.
- Hero section templates use inline hero-copy actions only; separate action cards are removed because they can inflate the hero grid.
- Long H1s compile to compact, wider-measure typography.
- Visual hero media frames are bounded so media cannot stretch the first viewport into an unusable page.
- Mobile header defaults to compact sticky solid behavior with a visible primary action.
- Surface sections own readable foreground colors even when the surrounding site theme is dark.
- Header contrast and button contrast use explicit foreground tokens.

## Canonical Section Templates

The canonical path uses active geometry templates and maps semantic purposes onto them:

- `hero_split`: first-viewport hero with copy and one bounded media frame. Used by `hero.split`.
- `hero_statement`: text-led first-viewport hero. Used by `hero.statement` and `hero.image_statement`; image-backed statement derives full-bleed treatment.
- `split_media`: one bounded mid-page media frame beside copy on desktop; `mediaSide` chooses left or right placement. Used by `story.split_media`.
- `intro_grid`: intro copy above a 3-card desktop grid, 2-card tablet grid, and stacked mobile cards. Used by `highlights.grid` and `pricing.packages`; comparison treatment is an explicit template option, not a separate geometry.
- `feature_band`: strong horizontal copy section with compact facts. Used by `feature.band`.
- `side_intro_rows`: intro column beside numbered editorial rows; stacked on tablet/mobile. Used by `services.rows` and `process.steps`.
- `media_feature`: wide image section below the hero with short supporting copy. Used by `media.feature`.
- `media_mosaic`: short intro plus three bounded images in a gallery-like mosaic. Used by `media.gallery`.
- `quote_wall`: intro above three owner-verifiable proof or testimonial-style cards. Used by `proof.quote_wall`.
- `faq_list`: intro beside common-question rows. Used by `faq.list`.
- `facts_strip`: compact horizontal trust/contact facts; stacked on mobile. Used by `proof.facts_strip`.
- `facts_cta`: fact band plus one bounded CTA panel. Used by `proof.facts_cta`.
- `editorial_statement`: centered editorial copy with inline CTA. Used by `statement.editorial`.
- `contact_split`: contact copy beside contact facts. Used by `contact.split`.

The canonical section-template path is where typography, spacing, header integration, media treatment, and responsive behavior are tuned as a coherent page system.

## Verification

- `npm run verify:generated-site-v3-renderer-constraints` proves unsafe input is normalized before render.
- `npm run verify:generated-site-v3-section-template-library` renders the canonical section-template stack across 16 generic local-business shells and captures desktop, tablet, and mobile screenshots. It rejects canonical pages that drift outside the approved purpose order, purpose-to-geometry mapping, template options, slot contracts, count ranges, rhythm rules, or media restrictions.
- `npm run verify:generated-site-v3-canonical-visual-grammar` remains an alias for the same verification path.
- `npm run verify:render-browser` remains the broader browser-inspection gate for generated-site rendering.

## What This Does Not Claim

This phase prevents catastrophic rendering failures and establishes one coherent generic section-template stack. It does not prove Lodesta has reached 9.5 visual taste across all generated websites. Remaining work includes better media sourcing, stronger template-level visual polish, recipe-level omission/order rules, stronger non-canonical section typography, and human aesthetic review alongside deterministic safety scoring.
