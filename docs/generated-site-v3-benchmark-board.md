# Generated Site V3 Benchmark Board

## Purpose

This board defines the visual target for V3. The goal is not to copy a provider. The goal is to extract component anatomy, control surfaces, and quality bars that make a generated local-business site feel designed rather than assembled.

## Reference Set

Use these sources as product-quality references:

- Framer local-business and service examples: expressive first viewports, strong media, polished motion, generous rhythm.
- Webflow local-business and service templates: dense but polished service modules, tuned responsive grids, mature section composition.
- Squarespace local-business templates: editorial pacing, restraint, strong image rhythm, simple local essentials.
- Duda local-business templates: practical conversion structure, contact emphasis, reusable responsive sections.
- Stripe, Ramp, Apple, Linear: hierarchy, type scale, spacing, polish, and restraint. These are not local-business content models.

Use these as negative references:

- Recolored one-page templates with identical header/hero/service/contact stacks.
- Sites that use cards as every section wrapper.
- Sites with detached utility headers above unrelated heroes.
- Sites where copy describes a process/template instead of the business.

## Current Benchmark References

These references were checked from the live template marketplaces during the V3 visual proof pass on June 2, 2026. They are not sources to copy. They are a control vocabulary for what the V3 visual layer must be able to express.

| ID | Reference | Provider | What V3 Should Learn |
|---|---|---|---|
| `framer:swiftrooter` | [SwiftRooter](https://swiftrooter.framer.website/) | Framer | Service-business page with direct CTA, practical section order, and enough visual polish that the conversion path does not feel like a form-first template. |
| `framer:gardener` | [Gardener](https://gardener.framer.media) | Framer | Warm local-service art direction, image-friendly rhythm, and approachable sections without overcomplicated vertical widgets. |
| `framer:camino` | [Camino](https://camino-template.framer.website) | Framer | Restaurant-quality pacing: strong media, generous spacing, and a first viewport that sells the business before listing details. |
| `framer:luxxcar` | [LuxxCar](https://luxxcar.framer.website/) | Framer | Premium vehicle-service composition, bold media, strong dark/light contrast, and image-led brand feel. |
| `framer:fabrica` | [Fabrica](https://fabrica.framer.media/?utm_source=framer) | Framer | Refined studio page with editorial whitespace, restrained typography, and calm content rhythm. |
| `framer:noksh` | [Noksh](https://noksh.framer.website/?via=diversekit) | Framer | Architecture/studio composition: large images, controlled negative space, and slower editorial rhythm. |
| `framer:elevate` | [Elevate](https://elevate-template.framer.website/) | Framer | Agency homepage polish, clear hierarchy, and reusable media/content blocks that do not read as generic cards. |
| `framer:perform` | [Perform](https://perform.framer.website/) | Framer | Personal-service page with strong first-viewport focus and a clear action path. |
| `webflow:rally-padel` | [Rally Padel](https://webflow.com/templates/html/rally-padel-website-template) | Webflow | Sport/local venue energy, large media blocks, and section pacing that feels designed rather than stacked. |
| `webflow:healen` | [Healen](https://webflow.com/templates/html/healen-website-template) | Webflow | Health/service softness, accessible hierarchy, and careful card/surface usage. |
| `webflow:youga` | [Youga](https://webflow.com/templates/html/youga-website-template) | Webflow | Wellness pacing, quiet typography, and mobile-friendly section compression. |
| `webflow:monocad` | [Monocad](https://webflow.com/templates/html/monocad-website-template) | Webflow | Architecture/editorial grid patterns and full-bleed media rhythm. |
| `webflow:adox-studio` | [Adox Studio](https://webflow.com/templates/html/adox-studio-website-template) | Webflow | Studio/agency layout density, asymmetric sections, and portfolio-style media pacing. |
| `webflow:pretty` | [Pretty](https://webflow.com/templates/html/pretty-website-template) | Webflow | Beauty/local-service polish, softer surfaces, and editorial service presentation. |
| `webflow:portfolio-starter` | [Portfolio Starter](https://webflow.com/templates/html/portfolio-starter-website-template) | Webflow | Minimal grid discipline, crisp section boundaries, and a constrained control surface. |
| `squarespace:template-store` | [Squarespace Templates](https://www.squarespace.com/templates) | Squarespace | Broad template-system principles: customizable starting points, strong media rhythm, and simple local essentials without excessive widget complexity. |

## Extracted Control Vocabulary

The manual visual proof must prove these controls exist as bounded props, not page-specific CSS:

| Control Area | Required V3 Control |
|---|---|
| First viewport grammar | `media_masthead`, `architectural_split`, `gallery_wall`, `quiet_centerpiece`; header mode must be compatible with the hero. |
| Text block | Eyebrow, headline, subheadline, primary/secondary CTA, max width, alignment, CTA grouping, optional fact/stat panel. |
| Media | Single hero image, image pair, gallery wall, mosaic wall, crop mode, caption treatment, focal-position-safe mobile crop. |
| Section relationship | Full-bleed, wide, contained, inset surface, contrast band, flush transition, separated transition. |
| Services | Editorial rows, bento tiles, showcase cards with optional media, split index. |
| Story/content | Inset feature panel with text/media and point list; not every section should become another card grid. |
| Contact | Split contact form, contrast contact panel, action-only fallback, footer contact column. |
| Footer | Brand summary, contact facts, service list, hours, and local context in a responsive grid. |
| Typography | Universal font pool, per-site font pairing, large but bounded hero scale, body text 16px+, readable line lengths. |
| Mobile | Intentional stack order, no horizontal nav overflow, stable media heights, CTA reachability, no text overlap. |

## Required Benchmark Notes Per Reference

For each selected reference, record:

- first viewport anatomy
- header behavior
- hero structure
- below-hero rhythm
- service section anatomy
- proof/contact pattern
- media usage
- typography scale
- button style
- mobile transformation
- internal V3 controls needed to recreate the pattern

## V3 Visual Rubric

Each generated site or prototype is scored across 10 dimensions. A score is evidence only when paired with screenshots, reviewer, date, rationale, and blocker notes.

| Dimension | 5 means | 3 means | 1 means |
|---|---|---|---|
| First viewport | Header, hero, CTA, media, and copy feel designed as one composition. | First viewport is functional but familiar. | Header is detached or hero feels assembled from parts. |
| Typography | Font pairing, scale, line length, and hierarchy carry the page. | Legible but generic. | Default-looking, cramped, or inconsistent. |
| Section rhythm | Sections vary density, layout, and pacing without feeling random. | Some variety, but repeated patterns remain visible. | Same layout repeated with different copy. |
| Local-business usefulness | Services, contact, location, and practical next steps are clear. | Essentials exist but are not prioritized. | User must hunt for what the business does or how to act. |
| Copy quality | Specific, customer-facing, source-grounded, and conversion-aware. | Mostly safe but generic. | Template/meta language, filler, or unsupported claims. |
| Media quality | Images support the business context and have strong crops. | Images are acceptable but generic. | Wrong-context, repeated, deceptive, or visibly weak images. |
| Brand/art direction | Site has a coherent visual personality from bounded tokens. | Basic consistency but little personality. | Looks like product UI or a random theme. |
| Mobile composition | Mobile is intentionally recomposed and usable. | Stacked but usable. | Overflow, cramped text, hidden CTAs, or bad crops. |
| Accessibility/performance | Contrast, labels, keyboard, reduced motion, image layout, and sizing pass. | Minor nonblocking issues. | Fails core accessibility or layout stability. |
| Overall polish | Comparable to good Framer/Webflow/Squarespace/Duda local-business work. | Better than V2 but not premium. | Clearly generated or dated. |

## Launch-Selectable Variant Rule

Only variants with approved screenshots at 1280, 768, and 375 may be selected by the V3 compiler. Aspirational variants can be documented, but they are not selectable until screenshot-approved and validated.

## Prototype Review Rule

Each static prototype must be reviewed side-by-side against at least 3 benchmark references. The reviewer cannot be the same engineer who built the prototype. If no external designer is available, use one non-builder reviewer and the rubric above.

## 9.5 Definition

A 9.5 site is not merely "not broken." It is a generated site that:

- has a cohesive art direction
- has a first viewport that feels custom-composed
- avoids repeated section rhythm
- uses media intentionally and safely
- has specific, source-safe copy
- is excellent on mobile
- gives a real customer an obvious action path
- could plausibly replace a good agency-built local-business homepage
