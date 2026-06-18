# Auto Body Image Library Plan

Last updated: 2026-06-15

## Current Assessment

The previous public fallback library in `public/generated-site-assets/auto-body` had useful coverage, but it was too small and over-relied on dark gray close-ups with partial arms and tool contact. The main risks were:

- Unsafe-looking hand/tool geometry, especially rotary or polishing tools close to skin.
- Too many close crops that made the action ambiguous or AI-artifact-prone.
- Limited service variety: bodywork, PDR, paint, and glass were represented, but lift-bay, bumper prep, chip repair, and collision disassembly were missing.
- A few old paths had become stale in code/tests, including `finished-shop-context-v1.png` versus the newer `finished-shop-review-v1.png` reference.

## Reference Direction

External stock/reference imagery was used only for composition patterns, not copying. The strongest reusable patterns were:

- A generic vehicle on a lift with clear shop context and no business identity, inspired by common lift-bay reference imagery such as Identifix's car-lift article.
- Windshield service shown with suction cups or staged glass, but without visible faces, logos, or hands trapped between glass and frame.
- PDR inspection using reflection lighting to reveal small dents, seen in PDR gallery/reference images.
- Paint prep and paint booth scenes with masking, panels, primer, and controlled light instead of person-forward poses.

Reference links:

- https://www.identifix.com/blogs/how-much-does-a-car-lift-cost/
- https://www.dentheads.com/gallery/602070_10151546141383866_1704934651_n
- https://www.ebay.de/itm/333884616134
- https://www.carnews.com/nocategolized/254058

## Visual QA Gate

Reject an image if it has any of the following:

- People standing in front of cars or posing as staff.
- Faces, readable text, signage, labels, logos, license plates, VINs, screens, documents, insurance forms, or business identity.
- Fake wheel-center emblems, badge-like marks, fake certifications, pseudo-text, or watermark-like details.
- Unsafe tool contact: rotary tools near hands, hands under glass, unsupported glass, unstable lifts, or messy unsafe floors.
- Distorted hands, warped doors, impossible panel gaps, broken geometry, floating tools/glass, or obvious AI artifacts.
- Customer-proof framing unless the image is explicitly a generic non-claim before/after comparison.

## Implemented Seed Set

Accepted project-local assets:

- `lift-bay-overview-v1.png`: generic sedan on lift, hero-safe context image.
- `finished-shop-review-v1.png`: finished side-panel review with no wheels, labels, people, or badges.
- `collision-disassembly-v1.png`: front bumper removed with parts organized.
- `paint-booth-masked-panel-v1.png`: masked vehicle in paint booth, no person.
- `paint-prep-sanding-block-v1.png`: manual sanding block, safe gloved-hand placement.
- `pdr-reflection-panel-v1.png`: small dents with reflection light board, no hands.
- `before-after-body-panel-v2.png`: generic split panel comparison, no text labels.
- `windshield-replacement-v1.png`: windshield alignment with suction cups and safe hand placement.
- `replacement-glass-stand-v1.png`: replacement windshield staged on padded stand.
- `windshield-chip-repair-v1.png`: resin injector macro with no hands.
- `bumper-prep-stand-v1.png`: detached bumper cover with sanded primer patch.
- `panel-gap-inspection-v1.png`: finished panel-gap/body-line detail.

Rejected generated candidate:

- First `before-after` attempt: rejected because the visible wheel center read as a fake emblem/logo.

## Next Batch Plan

Use the same QA gate for a larger reviewed batch. Continue using Codex built-in image generation for this public fallback library. Do not use the project's `OPENAI_API_KEY` or the asset-library CLI unless the workflow is explicitly switched later.

For the broader automotive gap analysis covering `auto_services`, tires, mechanical repair, diagnostics, alignment, and shared glass imagery, see `docs/automotive-image-gallery-gap-analysis.md`.

## Target Library Size

Target 72 approved active auto-body images. This target is now met in `lib/image-registry.ts`: 24 seed assets plus 48 Wave C expansion assets are wired as active generated category media.

This target is large enough to prevent repeated-looking generated sites without creating an unreviewable asset pile:

- 18 hero/environment images for first-viewport or large section use.
- 36 service-detail images for cards, rows, split media, and gallery slots.
- 10 texture/process-background images for secondary sections and visual variety.
- 8 generic proof-style images, including non-claim before/after comparisons and finished-review panels.

## Coverage Targets

| Family | Approved target | Current approved | Additional needed | Notes |
| --- | ---: | ---: | ---: | --- |
| Lift bay, frame rack, shop environment | 12 | 12 | 0 | Includes sedan, SUV, pickup, frame rack, paint prep, inspection, parts cart, panel stands, and shop-floor context. |
| Collision disassembly and structural repair | 10 | 10 | 0 | Includes bumper removed, frame bench, headlight/front bracket, parts carts, support measuring, and panel alignment. |
| Paint prep, refinish, and booth | 12 | 12 | 0 | Includes masking, primer, manual sanding, booth context, seam sealer, paint mixing, and no spray clouds. |
| PDR, dents, hail, scratches | 12 | 12 | 0 | Uses reflection lighting, hail/hood/roof details, glue tabs, and no ambiguous hand/tool contact. |
| Auto glass replacement and repair | 12 | 12 | 0 | Includes windshield install, staged glass, urethane/pinch weld, chip repair, side glass, and body-glass complements. |
| Bumper, plastic, rocker, trim repair | 8 | 8 | 0 | Includes detached bumper cover, tabs, lower valance, rocker scuffs, fender liner, and trim clips. |
| Finished review and generic before/after | 6 | 6 | 0 | No text labels, wheel emblems, or customer-proof implications. |

## Wave Cadence

Generate in waves of 16-24 candidates, expecting 10-16 accepted images after visual QA. Each wave should intentionally cover gaps instead of producing many variants of one idea.

Recommended sequence:

1. Wave 2: structural/frame, pickup/SUV variety, deeper glass, hail/PDR, rocker/trim, and tool/texture assets. Completed with 12 accepted images and 1 rejected pickup candidate.
2. Wave 3: more hero-safe environment shots and alternate vehicle body styles. Completed as Wave C environment/lift/frame additions.
3. Wave 4: service-card detail depth, including close-ups that avoid people and unsafe tool geometry. Completed as Wave C service-detail additions.
4. Wave 5: final balancing pass based on rendered generated-site repetition. Pending rendered-site verification and future repetition review.

## Wave 2 Accepted Set

- `frame-bench-measure-v1.png`: frame bench and structural repair bay.
- `pickup-bedside-prep-v1.png`: wheel-free pickup bedside primer prep.
- `suv-quarter-primer-v1.png`: SUV quarter-panel masking and primer.
- `bumper-fender-alignment-v1.png`: bumper/fender/hood seam alignment detail.
- `headlight-pocket-repair-v1.png`: headlight pocket and bracket repair detail.
- `rocker-scuff-repair-v1.png`: lower rocker scuff and primer prep.
- `hail-hood-reflection-v1.png`: hail-dented hood with reflection lighting.
- `pdr-glue-tabs-v1.png`: PDR glue-pull tabs on a side panel.
- `windshield-urethane-bead-v1.png`: windshield opening with urethane bead.
- `side-window-regulator-v1.png`: side glass and regulator detail.
- `body-tools-flat-lay-v1.png`: unbranded body tools on a worn bench.
- `primer-sanded-texture-v1.png`: sanded primer texture on a body panel.

Wave 2 rejected candidate:

- First pickup-bedside attempt: rejected because a visible wheel center read like a fake emblem.

## Wave C Accepted Set

Wave C added 48 accepted assets and completed the 72-image active auto-body registry target. Accepted paths are recorded in `docs/automotive-image-gallery-gap-analysis.md`.

Wave C rejected candidates:

- Generic SUV on lift: rejected because visible wheel centers read as fake emblems.
- Front apron/headlight bracket detail: rejected because a small mark read like an emblem.
- Hail roof reflection detail: rejected because a reflection looked numeral-like.
- Initial clearcoat sample output: not copied; replaced with regenerated accepted clearcoat sample.

## Operational Rules

1. Generate one distinct prompt per image with Codex built-in `image_gen`; do not use the repo's OpenAI API key for this public fallback set.
2. Copy only accepted images into `public/generated-site-assets/auto-body`; leave generated originals in the Codex generated-images directory.
3. Use stable, descriptive, versioned filenames ending in `-v1.png`, or increment the version for replacements.
4. Keep old public files in place unless intentionally replacing code references; stored site versions may still refer to old paths.
5. Add accepted assets to `lib/image-registry.ts` only after visual QA passes; generated-site fallback media reads the wired registry assets.
6. Keep generated media decisions and policy notes explicit: generic category imagery, not real business staff, location, vehicles, or customer work.
7. Review desktop/full image and card-crop suitability before wiring into generated-site selection.
