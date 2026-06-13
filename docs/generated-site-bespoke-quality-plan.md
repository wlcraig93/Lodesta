# Generated-Site Bespoke Quality Plan

Status: draft for review (2026-06-11). Owner: Willie + agent sessions.

## Problem

Generated sites pass QA but read as templated, especially side by side within a
vertical. Audit evidence (2026-06-11, three recent auto candidates, home +
service page, desktop + mobile):

- Mechanical defects: none remaining (12/12 page-viewport combos pass the
  automated checks: no overlaps, no heading overflow, no broken images, no
  horizontal scroll). The location/process overlap class was fixed and is now
  guarded by CSS (`overflow-wrap` + column-scaled headings).
- Structural sameness: all three sites share an identical skeleton — eyebrow
  hero, facts strip, split media, two consecutive `side_intro_rows` sections
  ("What we handle" + "How we keep it simple"), mosaic, FAQ, dark CTA band,
  location panel, dark contact split. Color and copy differ; shape does not.
- Rhythm defects the grammar permits today: the same template renders twice
  in a row (services rows + process rows back-to-back), and every page bottom
  is two dark bands sandwiching the location panel (CTA band and contact split
  are near-duplicate intents).
- Service pages are thin and uniform: hero statement → text statement → FAQ →
  contact, no media (media fix shipped for new generations), no cross-service
  links, no location presence.
- Identity: scraped logos render on previews now (Texas Tires shows its real
  mark); logo *extraction* still settles for favicons for many businesses;
  brand color sampling (`brandColorSamples`) is captured but underused.

Primary metric: same-vertical fingerprint distance (already computed by
`npm run benchmark:vector`). Every workstream below should move it or be cut.

## Principles

- Bounded model taste: the model chooses, validators and the compiler enforce.
  Same bet as design controls and copy — third application.
- No runtime composition archetypes. Archetypes exist only as prompt exemplars.
- Determinism and reproducibility hold: chosen plans are stored artifacts;
  recompiles reuse them; invalid model output falls back to today's skeleton.
- Operators must never be the ones to discover rendering defects: every defect
  class found by a human becomes an automated detector in the same change.

## Workstream A — Model-led composition within a grammar

The big lever against structural sameness.

1. Extend the design brief call (no new model call) with a `compositionPlan`:
   an ordered list of section intents drawn from the section-template registry,
   each with a one-line evidence rationale ("media_mosaic after services: 9
   usable photos"), plus one `signature` pick (see Workstream B).
2. Grammar validator (deterministic, in the compiler):
   - hero first; contact reachable; location section (or merged variant)
     required for local SEO; CTA band at most once; section budget 7–11.
   - no identical template adjacent; media templates require available media;
     at most one dark band in the final three sections.
   - validation failure → fall back to the current default composition and log
     the rejection reason. Generation never blocks on model output.
3. Store the accepted plan as a site artifact; repairs and recompiles reuse it.
4. Prompt exemplars: media-led, conversion-led, story-led worked examples the
   model may follow or deviate from with justification.

## Workstream B — Section component library expansion

Fill the gaps the audit shows, weighted toward where the eye lingers.

- `process_stepper_vertical`: numbered vertical steps, oversized step numerals,
  optional per-step media slot (gives scraped photos a second home).
- `process_timeline`: compact horizontal variant.
- Make process a real presentation axis: `program_rows | stepper_vertical |
  timeline` (today it is hardcoded to `program_rows`).
- `stat_band`: one oversized number + claim (signature-moment candidate).
- `pull_quote_band`: full-width review/testimonial quote (signature candidate).
- `location_showcase` (SHIPPED 2026-06-11): destination treatment for
  single-location businesses with a real weekly schedule — display-scale hours
  table, map embed (or coverage panel until the Maps key is configured),
  address + directions/call actions. Maps embed remains config:
  `LODESTA_LOCATION_MAP_MODE=embed` + `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY`.
  Still open: merged location+contact variant.
- Marquee facts-strip (SHIPPED eligibility widening 2026-06-11): the animated
  ticker now seeds across all punchy-retail sites instead of requiring
  accent-forward brand cues.
- Service-page composition v2: split_media detail (shipped), plus
  cross-service links strip, optional process snippet, location strip.

A signature moment is one deliberately oversized/asymmetric section per site,
chosen by the composition plan from: stat_band, pull_quote_band, full-bleed
photo band, oversized editorial statement. Exactly one per site.

## Workstream C — Deeper per-component control enums

Cheap, compounding variation inside components ("tasteful enums"):

- `numberStyle` for steps/ledgers: oversized | outlined | filled_chip.
- `dividerStyle`: none | hairline | accent_tick.
- `ctaBandTone`: dark | brand | paper (also fixes the double-dark-band smell).
- `photoTreatment`: none | framed | duotone (brand-tinted).
- `heroFactsPlacement`: inline | rail | hidden.
- Each new enum ships with incompatibility rules and contract-suite coverage.
- Resolution moves from the fixed register table to model-chosen-within-menus
  via the design brief; the register table remains the fallback default.

## Workstream D — Identity anchors

What makes a site feel like it belongs to the business.

- Logo extraction v2: hunt header `<img>`, `og:image`, `apple-touch-icon` at
  real resolution; quality floor (min dimensions, aspect sanity); never
  favicons (renderer already rejects `.ico`). Keep good logos, skip bad ones.
- Brand color derivation: promote sampled `brandColorSamples` from render
  inspection into palette candidates with contrast gates, so sites inherit
  real brand color more often than preset themes.
- Generated brand marks: opt-in operator action on the existing
  `brand-mark-generation-v2` rails (image model + approval gates already
  built); never auto-published.
- Wordmark variants: shipped (4, driven by font pairing); extend toward 6–8
  and let the design brief pick.
- Rights model (shipped): scraped media/logos render on previews; publishing
  requires owner attestation; declining swaps to the backup gallery
  (`backupGalleryForRightsFallbackV3` + `applyMediaRightsFallbackV3`). Remaining
  work: wire the attestation step into the claim/publish flow so a declined
  attestation persists the fallback-swapped version instead of 404ing scraped
  assets on the public site.

## Workstream E — Render-quality hardening (operators never find CSS bugs)

Promote the audit's checks into render inspection so every defect class a
human has ever reported is detected automatically:

- heading-overflow (heading rect vs parent column rect) — the bug class Willie
  caught by hand on 2026-06-11.
- block-overlap pairs (≥25% intersection of section-level blocks).
- same-template adjacency and double-dark-band rhythm (grammar-level, checked
  at compile, not render).
- button/viewport overflow; sub-11px text.
- Severity: warnings during burn-in, blocking after two clean weeks.
- Add the 12-combo audit (3 candidates × 2 pages × 2 viewports) to the
  validation pack so it runs on every renderer/catalog change.

## Measurement and rollout

- North star: same-vertical fingerprint distance (benchmark vector). Secondary:
  scorecard non-regression, craft grade, visual QA pass rate.
- Add a mixed-vertical benchmark set; the all-Austin-tire-shop corpus is the
  hardest distinctiveness test but cannot distinguish "system is templated"
  from "corpus is monochrome".
- Phases:
  1. E (detectors first — safety net) + process axis + `process_stepper_vertical`.
  2. C enums + location experience v2 + service-page v2.
  3. A composition planner (the big lever), measured against fingerprint distance.
  4. D identity anchors (logo extraction can run parallel to any phase).

## Open questions

- Maps embed: provision `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` and flip
  `LODESTA_LOCATION_MAP_MODE=embed`? (Renderer support is already live.)
- Image-model budget for generated brand marks (operator-triggered only?).
- CTA band tone default once `ctaBandTone` exists: keep dark, or brand?
