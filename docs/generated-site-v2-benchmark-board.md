# Generated Site V2 Benchmark Board

## Purpose

This board defines the visual and structural references for Generated Site V2. The goal is not to copy any template or brand. The goal is to make the compiler prove it can generate a premium horizontal local-business website before we add deeper vertical-specific widgets.

## Source References

Use these references as design-quality inputs:

- [Framer small-business examples](https://www.framer.com/blog/small-business-website-examples/): strong first viewport, bold imagery, negative space, brand personality, conversion paths, and scroll rhythm.
- [Framer Gallery](https://www.framer.com/examples/): modern motion, high-finish sections, and typography-led layouts.
- [Webflow local-business templates](https://webflow.com/templates/search/local-business): polished service modules, dense but organized business information, and varied section architecture.
- [Squarespace local-business templates](https://www.squarespace.com/templates/browse/topic/local-business): simple editorial pacing, media rhythm, local-business essentials, and restrained typography.
- [Duda website builder](https://www.duda.co/website-builder): reusable sections, global design controls, responsive layout, SEO/performance focus, content-driven generation, and automation.
- [Stripe](https://stripe.com/): crisp hierarchy, dense information without visual clutter, high polish, and clear CTA sequencing.
- [Ramp](https://ramp.com/): editorial-functional B2B pacing, strong proof bands, confident spacing, and restrained visual detail.
- [Apple](https://www.apple.com/): media-first product storytelling, precise responsive composition, and generous first-viewport hierarchy.
- [Linear](https://linear.app/): quiet premium UI, strong typography, restrained motion, and component finish.

## Extracted Patterns

### What The Current V2 Output Is Missing

Current V2 screenshots still fail the benchmark bar because they use too few visual grammars:

- One repeated header structure: mark/name, centered nav, right CTA.
- One repeated local-business homepage rhythm: hero, service section, media pair, coverage band, contact split, final CTA.
- Too many sections that differ only by copy and color.
- Copy that often describes intake metadata instead of selling the business.
- Deterministic QA that proves the page is not broken, but does not prove design quality.

The correction is to build a larger set of proven horizontal section compositions before relying on the compiler to assemble pages.

### Header And First Viewport

- Header must feel attached to the site grid, not pasted above it.
- Brand area must use one clear identity treatment: mark plus name, mark only, or wordmark only.
- CTA hierarchy should be clear: one primary action, one secondary path at most.
- Hero must communicate the business value, not the template intent.
- Hero proof chips should be sparse and high-signal.

Required header variants:

- `overlay_left_brand`: transparent/overlay header aligned to a full-bleed hero.
- `solid_editorial_bar`: light or solid header that shares the hero grid and does not feel detached.
- `split_brand_rail`: compact brand rail with nav/actions integrated into a two-column hero.
- `minimal_wordmark`: wordmark-first header for editorial/professional pages.
- `utility_call_bar`: phone-forward header for service businesses, used only when the header still feels designed.

Required hero variants:

- `cinematic_overlay`: full-bleed media, dark/light scrim, one strong headline, CTA, sparse proof.
- `editorial_split`: large headline and asymmetric media with visible grid structure.
- `media_masthead`: oversized media card or image strip with headline integrated into the crop.
- `statement_cardless`: typography-led hero without a card, for sparse facts and professional services.
- `brand_panel`: strong brand/color block paired with media or service proof.

### Section Rhythm

- A page needs at least four distinct layout treatments when facts support it.
- Avoid repeated left-text/right-card blocks across adjacent sections.
- Alternate density: large statement, structured list, media story, proof/contact, FAQ.
- Use full-width bands sparingly and purposefully.
- Cards are for actual item collections, not generic section wrappers.

Required horizontal section grammars:

- `service_editorial_index`: services as editorial rows, not cards.
- `service_feature_board`: one featured service plus secondary rows/cards.
- `service_media_composite`: services mixed with one strong image/proof panel.
- `proof_location_anchor`: address/phone/hours/directions as a designed local anchor.
- `proof_stateless_trust`: source-safe proof without fake reviews or unsupported claims.
- `story_full_bleed_media`: media-led story band with minimal overlay copy.
- `story_asymmetric_gallery`: one large image with staggered supporting images.
- `faq_editorial_list`: practical questions as a premium editorial section, not generic accordions.
- `contact_split_form`: phone/address/details plus generic contact form.
- `final_conversion_band`: distinct from prior dark bands; not the same slab on every site.

At least three different header/hero grammars and four different section grammars must appear across the golden prototype set. A passing set cannot be the same website recolored.

### Typography And Color

- Fonts are site-specific recipes selected from an approved universal font pool, not vertical-locked fonts.
- Each site needs consistent type and color tokens, but different sites can use different pairings.
- Body text must be at least 16px in normal reading contexts.
- Long copy blocks need comfortable line length and enough leading.
- Contrast must be programmatically checked, not guessed from screenshots.

### Media

- Media should explain the business category and service context.
- Generated or stock media must never imply real staff, storefronts, customer vehicles, or official marks.
- Do not reuse the same hero image as a later major section.
- Mobile crops must preserve the subject and should not become abstract texture.

### Copy

- Copy must be customer-facing and conversion-oriented.
- Never describe the website template or the generation process.
- Avoid literal planning language such as "source-backed", "conversation", "starting point", "path", "details and next steps", or "profile details".
- Headlines should make a promise the source facts support.
- Process copy should explain what a customer can do next, not how the site was assembled.

### Contact And Forms

- The horizontal MVP form is a generic contact form: name, phone, email, message.
- If a phone number exists, click-to-call must remain prominent.
- Address, directions, hours, and service area facts must be displayed only when sourced or otherwise render-safe.
- Google proof is live/link-only; Google rating, review count, and review text must not be statically rendered.

## Golden Prototype Set

The V2 horizontal system must pass deterministic checks for these prototypes:

- Auto-style service business.
- Restaurant-style local business.
- Home/local service business.
- Professional service business using `general_local` compiler behavior.
- Creative/local studio using `general_local` compiler behavior.

The prototypes must be synthetic fixtures, not real scraped business facts. They are production-seed outputs: code and contracts from these prototypes should become the V2 component framework, not disposable mockups.

## Deterministic Gate

Each prototype must prove:

- `rendererVersion === "layout-v2"` and `designSchemaVersion === "design-v2"`.
- At least six meaningful homepage sections when facts support it, or an explicit smaller honest-site rationale.
- At least four distinct section families and three distinct layout variants.
- A detected V2 header, hero, contact path, final CTA, and footer.
- No internal product UI button classes.
- No repeated fallback wordmark.
- No static Google rating/review count/review text.
- No placeholder, template, or planning-language copy.
- No broken images, no horizontal overflow, readable text size, and AA contrast.
- Three screenshot captures: desktop, tablet, and mobile.

## Human/Model Review Packet

The deterministic gate is necessary but not enough for 9.5 quality. Each benchmark run should produce a review packet:

- Desktop/tablet/mobile screenshots.
- Render metrics.
- Section-family and variant report.
- Copy blocker report.
- Source-policy report.
- Side-by-side notes against the current V2 output.
- Human/model score for visual quality, copy quality, conversion clarity, and local-business usefulness.

The score is a benchmark artifact, not a flaky CI gate. It becomes the decision record for whether the generated site is credibly production-ready.
