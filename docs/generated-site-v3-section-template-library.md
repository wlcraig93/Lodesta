# Generated Site V3 Section Template Library

Generated customer-site pages are composed from section templates. A section template is the geometry of one horizontal page band: columns, slots, spacing, media bounds, and responsive behavior. Semantic purposes map onto these templates rather than inventing their own geometry.

## Canonical Layers

- Page rhythm: chooses an ordered set of section purposes.
- Section purpose: names the semantic job, such as `services.rows`, `media.feature`, or `statement.editorial`.
- Section template: names the geometry, such as `side_intro_rows` or `media_feature`.
- Template options: name the small approved choices for a template, currently `background` for all templates, `align` for `hero_statement`, `mediaSide` for `split_media`, and `cardTreatment` for `intro_grid`.
- `VisualSectionV3`: typed template options plus content-only slots.
- Renderer/CSS: draws compiled sections and applies responsive behavior.

The canonical grammar is the source of truth for generic section-template composition. Legacy visual-factory and benchmark-reproduction executables have been removed from the go-forward renderer path.

`VisualSectionV3` stores template identity, explicit template options, and typed slot content. Purpose/rhythm/page sequencing are generation metadata outside the rendered section object.

## Active Geometry Templates

| Template | Purpose mappings | Default expression | Contract |
| --- | --- | --- | --- |
| `hero_split` | `hero.split` | `hero_split.copy_media` | First-viewport split copy/media with one bounded media frame. |
| `hero_statement` | `hero.statement`, `hero.image_statement` | `hero_statement.text_led` | Text-led first-viewport statement. Image-backed statement derives full-bleed treatment. |
| `split_media` | `story.split_media` | `mediaSide: left` or `mediaSide: right` | Mid-page copy plus one bounded media frame. |
| `intro_grid` | `highlights.grid`, `pricing.packages` | `intro_grid.intro_cards_3`, `cardTreatment: standard` or `cardTreatment: comparison` | Intro above exactly three cards. Comparison treatment is only for evidence-backed pricing/package content. |
| `feature_band` | `feature.band` | `feature_band.copy_with_facts` | Strong horizontal copy section with compact facts. |
| `side_intro_rows` | `services.rows`, `process.steps` | `side_intro_rows.numbered_rows`, `side_intro_rows.large_label_rows` | Intro beside editorial rows. No row media until explicitly proven. |
| `media_feature` | `media.feature` | `media_feature.wide_image_statement` | Wide below-hero image with short supporting copy. |
| `media_mosaic` | `media.gallery` | `media_mosaic.intro_mosaic_3` | Intro plus a bounded three-image mosaic for gallery-like sections. |
| `quote_wall` | `proof.quote_wall` | `quote_wall.three_quotes` | Intro above three proof or testimonial-style cards. |
| `faq_list` | `faq.list` | `faq_list.editorial_questions` | Intro beside four common-question rows. |
| `facts_strip` | `proof.facts_strip` | `facts_strip.four_facts` | Compact facts-only trust band. |
| `facts_cta` | `proof.facts_cta` | `facts_cta.request_guidance` | Facts plus one bounded CTA panel. |
| `editorial_statement` | `statement.editorial` | `editorial_statement.centered_close` | Centered typographic break with inline CTA. |
| `location_panel` | `local.location_panel` | `location_panel.location_cards` | First-party location facts, service areas, directions, and optional map intent. |
| `contact_split` | `contact.split` | `contact_split.dark_contact` | Contact copy plus contact facts. |

## Enforcement

Each template owns slot-state contracts. If a template layout says media is disallowed, media cannot be added through props. If a grid has three cards, a four-card expression must become a new named template option only after visual review proves the need.

Each template also owns a background contract:

- `defaultBackground`: the normal background authored for that template.
- `allowedBackgroundKinds`: approved paint kinds for the geometry: `solid`, `gradient`, or `image`.
- `safeSolidBackground`: a verified fallback that passes 4.5:1 text contrast for at least one foreground choice.

Text-bearing image backgrounds derive contrast, scrim, and full-bleed behavior from the renderer; remote image pixel sampling is not part of compile-time validation.

The canonical verifier enforces:

- approved section-purpose and template IDs
- explicit background kind, allowed-kind membership, safe fallback contrast, and image-background requirements
- purpose-to-template mappings
- slot-state contracts
- list, fact, and media item count ranges
- no adjacent template or rhythm-role repetition
- required feature, media, gallery, quote, package-purpose intro grid, FAQ, editorial statement, and contact-close templates
- no foreground overlap, horizontal overflow, cramped text, broken images, or unintended bounded-media clipping

## Coverage Boundary

The current V1 geometry library is intended to cover common polished landing-page bands, not every marketplace section. It now covers:

- first-viewport heroes: split media, text-led statement, and image-backed full-bleed statement
- content/media rhythm: split media, wide media feature, and media mosaic
- repeated content: intro card grid, comparison-treated intro grid, side intro rows, quote wall, and FAQ rows
- proof/conversion: facts strip, facts CTA, editorial statement, location panel, contact split, header, and footer

Deferred until separately proven:

- logo/client strips, because generic local-business pages often lack safe logo evidence
- team/profile grids, because they need image-rights and person-proof constraints
- sticky/sidebar scrollytelling, because it is higher-risk responsive geometry
- accordion interaction behavior, because the current FAQ primitive is static row geometry
- ecommerce/product and CMS/detail layouts, because they are outside generic landing-page V1 coverage

## Visual Polish Boundary

The current canonical polish pass keeps visual quality decisions in the renderer and recipe layer, not in customer-editable controls. These decisions are treated as part of the template contract until repeated evidence says they need a named template option:

- Full-bleed media heroes use the `hero_statement` template with an image background. Alignment is the only approved statement-specific template option; vertical positioning, contrast, scrim, and crop behavior are renderer-owned.

- Editorial typography scale, line height, and max measure are renderer-owned.
- Section padding, grid gaps, media minimum heights, and mobile collapse rules are renderer-owned.
- Section backgrounds are full-width page bands. Content is constrained by deterministic renderer gutters derived from the page max width, so section surfaces do not stop at an inner container and expose side stripes.
- Header chrome, footer chrome, CTA shape, card elevation, media shadows, and section dividers are renderer-owned.
- Backgrounds are explicit section paint objects, not surface-treatment labels. The same geometry can render an approved solid, gradient, or image background when the template allows it.
- Contrast fixes are mandatory compile/render rules. Foreground and button colors resolve from the compiled background and must not rely on inherited muted text.
- Customer-facing preference should map into brand facts, category priors, and recipe choice before rendering; it should not expose per-section spacing, freeform geometry, or raw background color knobs.

The polish pass deliberately did not add new geometry templates, new customer controls, or Boolean style switches. The goal was to make the approved section-template stack feel coherent through shared rhythm, bounded media, readable typography, and intentional surface changes.

## Second-Pass Polish Rules

The follow-up polish pass tightened the same renderer-owned system rather than expanding the template catalog:

- Page rhythm uses template-specific vertical padding so dense sections, media sections, proof bands, and closing sections do not all occupy the same visual weight.
- When a dedicated facts strip follows the hero, optional hero facts are suppressed in the canonical recipe so the page does not open with duplicate metadata bands.
- Header/hero integration is handled by chrome mode and first-section padding, not by per-page manual offsets.
- Mobile density is reduced by removing fixed card heights, shortening media frame minimums, compacting row sections, and keeping touch targets at 44px or higher.
- Cards share the same base grid contract but diverge by approved treatment: standard intro grids use restrained surface cards, comparison intro grids emphasize the middle card, quotes use a typographic quote mark, and CTA panels use dark contained surfaces.
- Facts strips render as trust rails, not card grids. The label/value hierarchy and divider model are renderer-owned.
- Media polish is limited to rendering behavior: crop, frame radius, public-caption placement, aspect ratio, shadow, and mobile minimum height. It does not include image generation guidance or vertical asset selection.
- Media `label` and `caption` values are internal metadata for selection/review and must not render as customer-facing copy. Visible captions require explicit `publicCaption` or `publicMediaCaption` copy.
- CTA hierarchy is visual: inline CTAs stay quiet, conversion panels get stronger contrast, the editorial close is centered, and the contact close owns the final dark band.
- Footer chrome follows the same full-width band plus deterministic gutter model as content sections.

## Verification

Run:

```bash
npm run verify:generated-site-v3-section-template-library
npm run verify:generated-site-v3-validation-pack
```

The first verifier renders the canonical stack across 16 generic local-business shells at desktop, tablet, and mobile sizes. The validation pack checks four representative generic pages: auto body, home service, restaurant, and professional service.
