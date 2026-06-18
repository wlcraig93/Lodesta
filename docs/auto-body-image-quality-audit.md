# Auto Body Generated Image Quality Audit

Last updated: 2026-06-16

## Standard

These images are for generic auto-body websites, not a specific shop. The strongest assets should feel like believable cropped process photography: close enough to show collision repair, paint prep, glass, dent, bumper, or finish quality, but not so wide that the image implies a real shop floor, real staff, a real customer vehicle, or a specific business location.

Grade meanings:

- `A`: keep as primary media. Believable, useful at hero or large-card size, low AI tell, low specificity risk.
- `B`: keep, but prefer secondary/card/gallery usage. Some context risk, repetition, or mild synthetic feel.
- `C`: demote or replace. Usable only as small filler or with crop constraints; not strong enough for default selection.
- `D`: reject. Do not wire into active selection.

Audit criteria:

- Avoid readable text, logos, plates, VINs, fake badges, pseudo labels, calibration targets, and claim paperwork.
- Prefer tight process/detail crops over full invented shops.
- Avoid unsafe tool contact, unsupported glass, unstable lifts, distorted hands, broken panel geometry, and bad wheel geometry.
- Penalize images that look like a complete real facility, a real customer car, or an obviously AI-generated stock scene.

## Recommendation

The current active auto-body set is useful but too permissive. I would not keep all 72 wired images in equal rotation.

Recommended active tiers:

- Primary rotation: `A` images only for hero and large media slots.
- Secondary rotation: `B` images for cards, galleries, section backgrounds, and service-page context.
- Suppressed/replacement queue: `C` and `D` images should not be used by default.

The next generation pass should produce mostly tight crops:

- 18 to 24 paint/body detail crops: masking edge, primer feather, sanding block, seam sealer, panel gap, bumper tabs, rocker scuffs.
- 12 to 16 PDR/dent/reflection crops without full vehicle context.
- 8 to 12 glass detail crops: pinch weld, urethane bead, setting blocks, supported glass edge, door channel.
- 6 to 8 structural close-ups: measuring points, brackets, frame clamp details, fastener trays.
- No more wide shop-floor hero scenes unless intentionally needed as a small background pool.

## Summary

| Grade | Count | Notes |
| --- | ---: | --- |
| A | 38 | Strongest keepers. Mostly tight process/detail crops with low specificity risk. |
| B | 25 | Usable but should be secondary because of wider context, full vehicle presence, mild AI polish, or repetition. |
| C | 11 | Replace or suppress from default selection. Mostly wide shop context or synthetic-looking specialty concepts. |
| D | 2 | Reject. Both are unwired and should stay unwired. |

## Per-Image Audit

| # | File | Wired | Grade | Disposition | Notes |
| ---: | --- | --- | --- | --- | --- |
| 1 | `before-after-body-panel-v1.png` | No | D | Reject | The damage side has over-patterned dents and the comparison reads like an AI before/after proof image. Keep unwired. |
| 2 | `before-after-body-panel-v2.png` | Yes | B | Keep secondary | Clear and useful, but before/after comparisons can imply customer proof. Use sparingly and not as a hero. |
| 3 | `before-after-quarter-panel-v1.png` | Yes | B | Keep secondary | Useful generic comparison, but the split-panel composition feels produced. Keep out of primary hero rotation. |
| 4 | `body-env-dusk-bay-interior-v1.png` | Yes | C | Replace or suppress | Believable but too much invented shop context. It implies a specific facility and is too atmospheric for generic sites. |
| 5 | `body-env-frame-rack-wide-v1.png` | Yes | C | Replace or suppress | Full vehicle, full rack, and full shop wall create high specificity risk. Use only if no tighter structural image exists. |
| 6 | `body-env-inspection-bay-v1.png` | Yes | B | Keep secondary | Good inspection-light context, but it shows a full vehicle and shop bay. Better for gallery than hero. |
| 7 | `body-env-masked-booth-wide-v1.png` | Yes | B | Keep secondary | Useful paint booth context. Slightly staged/wide, but acceptable as secondary paint/refinish media. |
| 8 | `body-env-paint-prep-bay-v1.png` | Yes | B | Keep secondary | Good service readability. Full vehicle and booth context make it less generic than tight crop assets. |
| 9 | `body-env-panel-stand-row-v1.png` | Yes | B | Keep secondary | Believable panel rack scene. Wider than ideal but not strongly business-specific. |
| 10 | `body-env-parts-cart-bay-v1.png` | Yes | B | Keep secondary | Parts-cart subject is useful. Background vehicle and parts add mild specificity risk. |
| 11 | `body-env-pickup-frame-bench-v1.png` | Yes | C | Replace or suppress | Large invented pickup shell/rack scene is too specific and has synthetic body-shell geometry. |
| 12 | `body-env-shop-floor-wide-v1.png` | Yes | C | Replace or suppress | Too much shop floor. This is exactly the type to avoid for generic sites unless heavily cropped. |
| 13 | `body-env-wheel-free-suv-quarter-v1.png` | Yes | B | Keep secondary | Stronger than the wide shop images because it focuses on the quarter-panel work, but still fairly contextual. |
| 14 | `body-glass-cowl-masked-v1.png` | Yes | A | Keep primary | Tight, believable process detail with low identity risk. Good glass/body crossover image. |
| 15 | `body-glass-door-window-track-v1.png` | Yes | A | Keep primary | Good close technical crop, no branding, no unsafe hand or glass issue. |
| 16 | `body-glass-pinch-weld-cleaned-v1.png` | Yes | A | Keep primary | Strong generic detail. Low AI tell and useful for glass replacement pages. |
| 17 | `body-glass-quarter-window-install-v1.png` | Yes | A | Keep primary | Safe supported glass, gloved hands, clear service action. Hands look acceptable. |
| 18 | `body-glass-rear-window-stand-v1.png` | Yes | A | Keep primary | Good supported-glass process image. No business identity. |
| 19 | `body-glass-side-glass-cleanup-v1.png` | Yes | A | Keep primary | Clear, tight, generic. Broken-glass context is acceptable as repair process, not customer proof. |
| 20 | `body-tools-flat-lay-v1.png` | Yes | B | Keep secondary | Useful generic tool texture. Some pieces feel staged, so use as supporting texture only. |
| 21 | `bumper-fender-alignment-v1.png` | Yes | B | Keep secondary | Clean panel-fit detail, but headlight/front corner makes the vehicle more identifiable. |
| 22 | `bumper-lower-valance-scuff-v1.png` | Yes | A | Keep primary | Good tight bumper/plastic repair crop. Low specificity risk. |
| 23 | `bumper-prep-stand-v1.png` | Yes | B | Keep secondary | Useful detached bumper prep scene. Slightly broad and a little synthetic, but acceptable. |
| 24 | `bumper-tab-repair-closeup-v1.png` | Yes | A | Keep primary | Strong close-up and clear repair subject. Low business/location risk. |
| 25 | `collision-disassembly-v1.png` | Yes | B | Keep secondary | Clear collision disassembly. Full front vehicle and wheel make it less ideal for generic rotation. |
| 26 | `collision-door-shell-alignment-v1.png` | Yes | A | Keep primary | Strong cropped body alignment image. Generic and believable. |
| 27 | `collision-front-bracket-alignment-v1.png` | Yes | A | Keep primary | Good structural detail. Close enough to avoid shop-specific context and vehicle identity. |
| 28 | `collision-parts-cart-fasteners-v1.png` | Yes | A | Keep primary | Strong generic parts/process detail. Low AI tell. |
| 29 | `collision-radiator-support-measure-v1.png` | Yes | B | Keep secondary | Good collision structural subject, but enough surrounding vehicle context to avoid primary default use. |
| 30 | `collision-rear-quarter-disassembly-v1.png` | Yes | B | Keep secondary | Service is clear; larger vehicle context makes it secondary. |
| 31 | `collision-tailgate-panel-prep-v1.png` | Yes | A | Keep primary | Strong detached-panel prep crop with low identity risk. |
| 32 | `custom-paint-clearcoat-sample-v1.png` | Yes | A | Keep primary | Clean, believable clearcoat sample. Good custom-paint-safe image because it does not imply portfolio work. |
| 33 | `custom-paint-masked-accent-panel-v1.png` | Yes | C | Replace or suppress | The taped accent-panel layout feels artificial and less connected to normal collision/body needs. |
| 34 | `custom-paint-spray-cards-v1.png` | Yes | B | Keep secondary | Useful color/process image, but more specialty/custom than standard auto-body. Avoid generic collision hero use. |
| 35 | `dent-crease-reflection-v1.png` | Yes | A | Keep primary | Strong PDR/dent detail. Generic, readable, and close. |
| 36 | `dent-door-edge-reflection-v1.png` | Yes | A | Keep primary | Good close crop and low context risk. Reflection is a little idealized but acceptable. |
| 37 | `exterior-hail-dent-panel-v1.png` | No | D | Reject | The repeated dent pattern is visibly synthetic. Keep unwired and do not use. |
| 38 | `fender-liner-fastener-detail-v1.png` | Yes | A | Keep primary | Tight, useful repair detail. Low identity risk. |
| 39 | `finished-bumper-fitment-v1.png` | Yes | B | Keep secondary | Useful fitment result, but full front corner and wheel make it more vehicle-specific. |
| 40 | `finished-door-gap-review-v1.png` | Yes | A | Keep primary | Strong finished-review crop. Generic, tight, and credible. |
| 41 | `finished-panel-reflection-review-v1.png` | Yes | A | Keep primary | One of the best finished-quality images. Low context risk and useful at large size. |
| 42 | `finished-shop-context-v1.png` | No | C | Keep unwired | Believable but too full-shop/full-vehicle for generic media. Leave unwired. |
| 43 | `finished-shop-review-v1.png` | Yes | A | Keep primary | Strong side-panel finished review. Tight enough despite reflection context. |
| 44 | `frame-bench-measure-v1.png` | Yes | C | Replace or suppress | Technically readable, but full vehicle/rack/tool wall creates high specificity risk. |
| 45 | `hail-hood-reflection-v1.png` | Yes | B | Keep secondary | Good hail/PDR subject. Use at card size; reflection/dent pattern is a little stylized. |
| 46 | `hail-roof-rail-reflection-v1.png` | Yes | A | Keep primary | Strong crop with low shop identity. Good hail/PDR image. |
| 47 | `headlight-pocket-repair-v1.png` | Yes | A | Keep primary | Useful collision close-up and generic enough. |
| 48 | `lift-bay-overview-v1.png` | Yes | C | Replace or suppress | Good car-on-lift concept, but too much full vehicle and shop. Better replaced by a tighter lift/corner crop. |
| 49 | `paint-booth-masked-panel-v1.png` | Yes | B | Keep secondary | Useful refinish scene, but wider booth context makes it secondary. |
| 50 | `paint-masking-tape-edge-v1.png` | Yes | A | Keep primary | Strong process crop. Exactly the safer direction for generic media. |
| 51 | `paint-mixing-cup-unlabeled-v1.png` | Yes | A | Keep primary | Good unbranded process detail. Avoids vehicle/customer implications. |
| 52 | `paint-panel-rack-booth-v1.png` | Yes | B | Keep secondary | Useful panel-rack context, but wider and more staged than ideal. |
| 53 | `paint-prep-sanding-block-v1.png` | Yes | A | Keep primary | Strong, safe manual sanding image. Hand/tool geometry is believable. |
| 54 | `paint-primer-feathering-v1.png` | Yes | A | Keep primary | Strong close-up. Low identity risk and clear repair process. |
| 55 | `paint-refinish-closeup-v1.png` | No | C | Keep unwired | Not terrible, but hand/tool crop is less controlled and it duplicates stronger sanding images. |
| 56 | `paint-seam-sealer-bead-v1.png` | Yes | A | Keep primary | Good close technical process image with low AI tell. |
| 57 | `paint-wet-sanding-block-v1.png` | Yes | A | Keep primary | Good safe sanding detail. Close and generic. |
| 58 | `panel-gap-inspection-v1.png` | Yes | B | Keep secondary | Useful fitment/detail image, but full side/front context adds mild vehicle specificity. |
| 59 | `pdr-door-ding-reflection-v1.png` | Yes | A | Keep primary | Strong PDR reflection image. Good crop and low context risk. |
| 60 | `pdr-glue-pull-tabs-v1.png` | Yes | A | Keep primary | Tight and useful. Colored tabs look slightly polished but not disqualifying. |
| 61 | `pdr-glue-tabs-v1.png` | Yes | B | Keep secondary | Useful but a bit staged/repetitive, and the full side panel adds context. Secondary only. |
| 62 | `pdr-hood-dent-reflection-v1.png` | Yes | A | Keep primary | Strong close PDR image. Good low-specificity asset. |
| 63 | `pdr-reflection-panel-v1.png` | Yes | B | Keep secondary | Useful and clear, but wider vehicle context and repeated dents make it less natural than the tighter PDR crops. |
| 64 | `pdr-rod-behind-panel-v1.png` | Yes | A | Keep primary | Strong technical crop with low identity risk. |
| 65 | `pickup-bedside-prep-v1.png` | Yes | B | Keep secondary | Useful panel prep image. Detached/paint-prep subject works, but pickup-bedside shape is more specific. |
| 66 | `primer-sanded-texture-v1.png` | Yes | A | Keep primary | Strong texture/process crop. Very safe generic background/detail image. |
| 67 | `replacement-glass-stand-v1.png` | Yes | B | Keep secondary | Good glass subject, but vehicle/shop background creates some context risk. |
| 68 | `rocker-panel-primer-edge-v1.png` | Yes | A | Keep primary | Good tight rocker repair crop. Low identity risk. |
| 69 | `rocker-scuff-repair-v1.png` | Yes | A | Keep primary | Strong repair-process crop, clear and generic. |
| 70 | `scratch-clearcoat-scuff-v1.png` | Yes | A | Keep primary | Strong scratch/scuff detail with low context risk. |
| 71 | `side-window-regulator-v1.png` | Yes | A | Keep primary | Good technical glass/window repair crop. |
| 72 | `suv-quarter-primer-v1.png` | Yes | B | Keep secondary | Good quarter-panel prep image, but somewhat repetitive with other masked/primer assets. |
| 73 | `trim-clip-flat-lay-v1.png` | Yes | A | Keep primary | Good generic repair-detail flat lay. Low identity risk. |
| 74 | `windshield-chip-repair-v1.png` | Yes | A | Keep primary | Strong glass chip repair close-up. Low identity risk. |
| 75 | `windshield-replacement-v1.png` | Yes | B | Keep secondary | Safe enough and understandable, but full windshield/arms/vehicle make it more contextual than the tight glass detail assets. |
| 76 | `windshield-urethane-bead-v1.png` | Yes | A | Keep primary | Strong glass prep crop and one of the safer windshield assets. |

## Immediate Action Plan

1. Add media-tier metadata or selection policy so `A` images are eligible for hero/large media, `B` images are gallery/card only, and `C`/`D` images are suppressed.
2. Remove or de-prioritize these wired `C` images first: `body-env-dusk-bay-interior-v1.png`, `body-env-frame-rack-wide-v1.png`, `body-env-pickup-frame-bench-v1.png`, `body-env-shop-floor-wide-v1.png`, `custom-paint-masked-accent-panel-v1.png`, `frame-bench-measure-v1.png`, `lift-bay-overview-v1.png`.
3. Keep the unwired rejects unwired: `before-after-body-panel-v1.png`, `exterior-hail-dent-panel-v1.png`, `finished-shop-context-v1.png`, `paint-refinish-closeup-v1.png`.
4. Generate replacements for the suppressed environment images as tighter crops:
   - lift arm and wheel-well area, no full shop floor
   - frame clamp or measuring point close-up, no full vehicle
   - masked quarter-panel edge, no full booth
   - bumper/fender seam and bracket detail
   - paint booth panel rack close-up instead of whole booth
5. After rewiring, render test sites with hero/card crops and verify no `C` images appear in first-viewport media.
