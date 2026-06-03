# Generated Site V2 Horizontal Design Spec

## Purpose

Generated Site V2 must produce premium local-business websites before it adds deep vertical widgets. The first product quality target is not an auto-body estimate flow, a restaurant menu engine, or an industry-specific configurator. The target is a beautiful, responsive, source-grounded local-business website that feels comparable to a strong Framer, Webflow, Squarespace, or Duda end product.

This spec defines the fixed horizontal component target for that work. The compiler may use vertical playbooks to choose facts, copy emphasis, and page structure, but the base visual system is horizontal.

## Benchmark Set

Canonical reference board: [generated-site-v2-benchmark-board.md](./generated-site-v2-benchmark-board.md).

Use these as product-quality references, not as templates to copy:

- Framer small-business examples and marketplace patterns: strong first viewport, modern typography, high whitespace discipline, intentional media crops.
- Webflow local-business and service-business templates: dense but polished service modules, clear CTA hierarchy, and section variety.
- Squarespace local-business templates: editorial pacing, clean media rhythm, and simple trust/contact sections.
- Duda local-business templates: practical conversion structure, phone/contact emphasis, and small-business page completeness.
- Stripe, Ramp, Apple, Linear: hierarchy, type scale, restraint, and component finish. These are polish references, not local-business content models.

The benchmark goal is not to reproduce any provider. It is to extract the component anatomy that makes the output feel designed rather than assembled.

## Aesthetic Direction

Use an editorial-functional direction:

- Typography should carry the page. Pair a strong display/heading family with a readable body family from the approved font list.
- Layouts should use large first-viewport hierarchy, deliberate asymmetry, and high-quality media crops.
- Color should be site-specific and restrained, with one dominant primary and one functional accent.
- Cards should be used only for real item collections, not as the default section wrapper.
- Dark panels should be rare. A site cannot rely on repeated dark bands to feel premium.
- Mobile is a separate composition. Desktop sections must not merely stack into dense mobile blocks.

## Canonical Page Anatomy

A strong local-business homepage needs these horizontal layers:

1. Header and first viewport.
2. Service/value overview.
3. Proof or credibility layer.
4. Media/story layer.
5. Process or expectation-setting layer.
6. Location/contact layer.
7. FAQ or practical questions.
8. Final CTA and footer.

The compiler can omit or compress layers when facts are missing, but it must not replace missing facts with generic filler.

## Component Contracts

## Required Horizontal Catalog

The horizontal catalog must be large enough that five generated businesses do not look like recolors of the same page. The first catalog milestone must include:

- 5 header variants: overlay, solid editorial, split brand rail, minimal wordmark, and utility call bar.
- 5 hero variants: cinematic overlay, editorial split, media masthead, statement/cardless, and brand panel.
- 3 service variants: editorial index, featured board, and media composite.
- 3 proof/contact variants: location anchor, source-safe trust band, and contact split form.
- 3 media/story variants: full-bleed story, asymmetric gallery, and media-led service story.
- 2 FAQ/process variants: editorial FAQ and compact customer-step list.
- 2 final CTA variants: quiet editorial close and high-contrast conversion band.

Each variant must have screenshots at 1280, 768, and 375 before the compiler can select it. The compiler should never select a variant that has not passed screenshot review and deterministic render inspection.

## Current Failure Mode To Avoid

Do not treat a safe renderer as a beautiful renderer. Current V2 output can pass layout, contrast, and provenance checks while still feeling templated because every page uses the same header, hero, service, media, coverage, contact, and CTA rhythm. The quality bar requires structural variety, not just different colors and copy.

### Header

Required fields:

- `brandName`
- `brandMark` or generated fallback mark
- `navLinks`
- `primaryCta`
- `headerMode`

Responsive rules:

- Desktop header must align to the hero grid and feel attached to the site, not like a detached utility banner.
- Mobile header must preserve visible brand presence.
- Mobile nav must never wrap into a second row.
- Header CTA may be hidden on mobile only if the hero/contact CTA remains immediately available.

Quality rules:

- Brand text must not repeat the fallback mark text awkwardly.
- Nav text must be at least 14px desktop and visually legible on mobile.
- The call CTA must not look like a random product UI button.

### Hero

Required fields:

- `eyebrow`
- `headline`
- `subheadline`
- `primaryCta`
- optional `secondaryCta`
- optional `media`

Allowed horizontal variants:

- `editorial_split`: light, strong text/media split.
- `overlay_media`: full-bleed image with text overlay.
- `centered_statement`: mostly text-led with compact proof/action row.
- `media_masthead`: large media-first composition with text over or beside the media.

Responsive rules:

- Mobile hero headline should be 2-5 lines, not cropped to an incomplete phrase.
- Primary CTA must appear in the first mobile viewport.
- Hero media must not collide with headline or CTA.
- Hero image crop must preserve the relevant subject, not decorative blur.

Quality rules:

- Hero cannot use the business name as a fake headline.
- Hero must express the customer value in plain language.
- Hero proof chips are optional; repeated service chips below CTA are usually clutter.

### Service Overview

Required fields:

- `heading`
- `intro`
- `services[]`
- each service: `title`, `body`, optional `href`

Allowed horizontal variants:

- `editorial_service_list`: high-whitespace list with one featured service.
- `service_matrix`: 2-4 service cards with restrained copy.
- `capability_showcase`: services plus one strong media/proof panel.
- `compact_service_index`: short list used when facts are thin.

Responsive rules:

- Mobile service cards must become a readable list unless each card has enough room.
- Service bodies should be hidden or shortened on mobile when density is high.
- No mobile two-column service grid unless every title fits comfortably.

Quality rules:

- No more than 6 homepage services.
- Service titles must come from source facts.
- Service copy must be source-safe and not invent outcomes, warranties, pricing, or credentials.

### Proof And Trust

Required fields:

- `heading`
- `items[]`
- each item: `label`, `value`, optional `href`, optional `ctaLabel`

Allowed horizontal variants:

- `source_stack`: fact cards for address, phone, hours, service areas, approved proof.
- `location_anchor`: map/address/contact-focused trust layer.
- `proof_strip`: compact proof row, only when evidence is strong.

Responsive rules:

- Mobile trust sections must prioritize address, phone, hours/directions, and one strongest proof item.
- Long proof labels should wrap naturally and stay readable.

Quality rules:

- Google rating/review count/text must not be statically rendered.
- Thin proof should be honest. Do not fake testimonials, years in business, certifications, or awards.

### Media Story

Required fields:

- `heading`
- `intro`
- `items[]`
- each item: `url`, `alt`, `title`, optional `body`, optional `label`

Allowed horizontal variants:

- `editorial_triptych`: one large image plus two supporting images.
- `full_bleed_story`: wide media band with minimal text.
- `media_grid`: balanced gallery when multiple strong assets exist.

Responsive rules:

- Mobile images should be full-width bands with enough height and clear crop.
- Text overlays on mobile should be minimal; avoid dense paragraphs over images.

Quality rules:

- Do not repeat the exact same hero image as a second major section unless the crop/story is meaningfully different.
- AI-generated or stock imagery must not imply real shop staff, storefront, branded vehicles, or customer vehicles.

### Process

Required fields:

- `heading`
- optional `intro`
- `steps[]`

Allowed horizontal variants:

- `horizontal_timeline`
- `numbered_steps`
- `checklist_panel`

Responsive rules:

- Mobile steps become a clean vertical list.
- Step titles must be short.
- Step body text should stay under 120 characters on mobile.

Quality rules:

- Headings must be customer-facing, not planning labels.
- Avoid phrases like "starting point", "path", "fit", "repair conversation", and "estimate conversation".

### Contact And Generic Form

Required fields:

- `heading`
- optional `phone`
- optional `address`
- optional `hours`
- optional `directionsCta`
- optional `form`

Form fields for the horizontal MVP:

- name
- phone
- email
- message

Responsive rules:

- Mobile form inputs must be at least 16px.
- The form cannot be the first major conversion path if a phone number exists.
- Contact details must appear before or beside the form, not hidden below it.

Quality rules:

- The generic form is a contact form, not a quote form.
- Do not use vertical-specific fields until the vertical component push.

### FAQ

Required fields:

- `heading`
- optional `intro`
- `questions[]`

Responsive rules:

- Mobile FAQ must use readable spacing and clear question hierarchy.
- FAQ should appear after service/contact context, not before the user understands the business.

Quality rules:

- Questions must be useful, not generic SEO filler.
- Answers must be source-safe and avoid claims that cannot be verified.

### Final CTA And Footer

Required fields:

- final CTA: `heading`, optional `body`, `primaryCta`
- footer: `businessName`, core links, optional phone

Responsive rules:

- Footer links must be readable on mobile.
- Final CTA should be visually distinct from the previous section.

Quality rules:

- Do not introduce new claims in the final CTA.
- Footer must not expose tiny, low-contrast text.

## Site-Level Quality Rules

- At least 4 distinct layout treatments on a full homepage with enough facts.
- No repeated card-grid sequence across adjacent sections.
- At most 2 dark bands on a standard homepage unless the design recipe is intentionally dark.
- No visible internal/template language.
- All visible factual claims must map to source facts or safe generic local-business copy.
- Body text must be 16px base, with sampled readable text at least 14px.
- Text contrast must pass AA in render inspection.
- Mobile must be reviewed from screenshots, not inferred from desktop.

## Golden Prototype Requirement

Before the compiler is considered 9.5-ready, build and review golden outputs for:

- auto-style service business
- restaurant-style local business
- professional service business
- home/local service business
- general local fallback

Each golden output must be generated from the same component contracts and must pass deterministic render checks plus model/human visual QA. The Super B-style benchmark remains useful, but it cannot be the only quality target.
