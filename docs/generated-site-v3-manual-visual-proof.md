# Generated Site V3 Manual Visual Proof

## Purpose

This milestone answers one question before AI generation enters the loop:

Can Lodesta render a genuinely modern generic small-business homepage using reusable V3 component props only?

The proof deliberately avoids:

- Super B-specific files
- one-off page CSS
- AI-selected component props
- vertical-specific widgets such as estimate forms, menus, before/after sliders, or insurance flows

Those are later product layers. This milestone proves the horizontal visual layer.

## Current Diagnosis

The earlier V3 renderer still converged because it had too few component grammars:

- one dominant header pattern
- one dominant media hero
- service rows or bento tiles
- proof grid
- media grid
- FAQ/process list
- contact block
- CTA/footer

That surface can be cleaned up, but it cannot reliably produce Framer/Webflow/Squarespace-quality variety. The missing piece is not more copy instructions. It is a richer bounded control model.

## Component Control Model

V3 page composition remains canonical:

```ts
SiteVersionV3
  -> pageComposition.pages[]
  -> SectionInstanceV3[]
  -> family + variant + props + controls
```

The manual visual proof extends the selectable horizontal variants:

| Family | Launch-Proof Variants | Control Purpose |
|---|---|---|
| `hero.*` | `architectural_split`, `gallery_wall`, `quiet_centerpiece` | Different first-viewport grammars: asymmetric service hero, media wall hero, text-led editorial hero. |
| `services.*` | `editorial_rows`, `bento_tiles`, `showcase_grid` | Avoid repeated service sections by varying density, media, and scan pattern. |
| `story.*` | `inset_feature` | A reusable text/media feature block for narrative, approach, or practical guidance. |
| `media.*` | `mosaic_wall`, existing asymmetric gallery | A full-bleed visual pacing section that is not just another split section. |
| `proof.*` | existing local anchor plus `split_metrics` styling | Practical local facts without static Google review/rating output. |
| `contact.*` | `contact_form_split`, `contact_panel` | Form and action-only contact treatments with high-contrast variants. |
| footer | reusable V3 footer grid | Brand summary, contact, services, and hours. |

The key controls are:

- `layout`: `architectural_split`, `gallery_wall`, `mosaic_grid`, `story_panel`, `contact_panel`, plus existing controls.
- `width`: contained, wide, full-bleed.
- `background`: site background, surface, contrast, brand.
- `mediaCrop`: none, subject, wide, portrait.
- responsive rules: mobile stack, tablet compression, desktop crop preservation.

## Manual Proof Pages

The proof suite contains three synthetic generic local-business homepages:

1. `atlas_collision_visual_proof`
   - Architecture: service-shop page with architectural split hero, showcase service cards, inset story, mosaic media, contrast contact panel.
   - Honest score: 9.05/10.
   - Path to 9.5: stronger first-party media and richer brand mark controls.

2. `northline_detail_visual_proof`
   - Architecture: media-wall neighborhood-service page with warm palette, bento service rhythm, local details, inset story, contact form.
   - Honest score: 8.85/10.
   - Path to 9.5: broader non-auto media source vocabulary.

3. `copperline_studio_visual_proof`
   - Architecture: quiet editorial studio page with centered statement hero, editorial service rows, inset story, mosaic media, contrast contact panel.
   - Honest score: 8.75/10.
   - Path to 9.5: better studio-specific media and more mature wordmark/logo controls.

These are intentionally synthetic. They validate component expressiveness, not live business resolution or asset sourcing.

## Verification

Run:

```bash
npm run verify:generated-site-v3-visual-proof
```

The verifier checks:

- exactly three manual proof pages
- all render through `layout-v3`
- no Lodesta product `.button primary` leakage
- layout, width, and background control diversity
- required launch-proof variants
- approved/non-deceptive media decisions
- no static rating/review output
- no internal proof/template language in visible text
- Playwright screenshots at desktop, tablet, and mobile
- no horizontal overflow
- no broken images
- readable font sizes
- WCAG AA text contrast
- at least one honest 9/10+ page

It writes the screenshot/report packet to:

```txt
docs/generated-site-v3-visual-proof-report.md
```

## Not Solved By This Milestone

This proof does not solve:

- AI selecting the props
- source-aware business resolution
- perfect first-party photo sourcing
- Google Places policy enforcement
- vertical-specific quote/menu/before-after components
- multi-page SEO/service pages
- owner editing controls

Those should be built after the horizontal visual layer has proven it can render beautiful pages manually.
