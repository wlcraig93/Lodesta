# Automotive Image Gallery Gap Analysis

Last updated: 2026-06-15

## Scope

This plan covers the automotive launch surfaces currently represented by the canonical service catalog:

- `auto_body`: collision repair, dent repair, auto paint, auto glass, bumper repair, hail damage repair, frame and structural repair, repair estimates, insurance claim support, and custom paint.
- `auto_services`: flat repair, used tires, new tires, tire rotation, wheel balancing, wheel alignment, TPMS service, oil change, brake service, general auto repair, diagnostics, auto glass, and tire delivery.

All new images in this plan should be generated with Codex built-in `image_gen`, then visually inspected before any project-local copy or code wiring. Do not use the project's `OPENAI_API_KEY` or image-generation CLI for this gallery unless that workflow is explicitly changed later.

## Current Inventory

Active public gallery coverage after implementation:

- `auto_body`: 72 generated assets are active in `lib/image-registry.ts` and the generated-site V3 auto-body fallback gallery. The public directory contains 76 PNG files because four older public files remain unwired for stale-reference compatibility.
- `auto_services`: 66 generated public assets are active in `lib/image-registry.ts`, including 48 tire/mechanical/service images and 18 shared glass images.
- `public/generated-site-assets`: both `auto-body` and `auto-services` directories now exist.

Prompt inventory that is not equivalent to active gallery coverage:

- `asset-library/manifests/auto-body-wave-1-v1.json`: 72 auto-body prompt recipes.
- `asset-library/manifests/auto-services-wave-1-v1.json`: 96 auto-services prompt recipes across tires, brakes, oil change, diagnostics, alignment, and texture details.
- `asset-library/manifests/auto-services-environment-wave-1-v1.json`: 24 hero/environment prompt recipes.
- `asset-library/manifests/auto-glass-wave-1-v1.json`: 48 auto-glass prompt recipes.
- `asset-library/manifests/tire-auto-v2.json`: 100 tire and auto-service prompt recipes.

Those manifests are useful seed material, but they are not reviewed public assets. The robust gallery should copy only accepted, visually inspected images into `public/generated-site-assets/...` and wire only those accepted images into selection code.

## Gap Summary

| Area | Catalog coverage | Active public assets | Gap | Priority |
| --- | --- | ---: | --- | --- |
| Collision, structural, bumper, paint, dent, hail, glass | `auto_body` | 24 | Solid base, but still short of the 72-image target for repeat-safe generated sites. Needs more environment shots, vehicle variety, structural detail, trim, estimate-safe inspection, and custom-paint-safe process imagery. | P1 |
| Tires and wheels | `auto_services` | 0 | Missing guaranteed fallback images for flat repair, new tires, used tires, rotation, balancing, TPMS, and tire delivery. | P0 |
| Mechanical repair and maintenance | `auto_services` | 0 | Missing oil change, brakes, diagnostics, general repair, under-hood, battery/diagnostic-adjacent, belt, filter, and service-bay imagery. | P0 |
| Alignment and suspension | `auto_services` | 0 | Missing alignment rack, wheel angle, tie rod, suspension inspection, uneven tire wear, and steering/suspension details. | P0 |
| Standalone auto glass | `auto_body` and `auto_services` | 6 body-integrated | Body pages have usable glass images, but glass-only `auto_services` sites have no guaranteed public fallback unless the asset library returns approved assets. Needs a shared glass set that can serve both verticals. | P0 |
| Repair estimates and insurance claim support | `auto_body` | 0 direct | Do not generate fake paperwork, forms, claim screens, or customer-proof imagery. Use neutral damage-intake, panel-measurement, parts-cart, and shop-review visuals instead. | P1 |
| Custom paint | `auto_body` | 0 direct | Current refinish images cover ordinary paint repair, not custom paint. Needs careful process visuals that avoid implying a specific portfolio job. | P2 |
| Customer service, keys, counters, waiting areas | Mostly contextual | 0 intentionally | Lower value and higher risk of person-forward, staged stock imagery. Keep out of the primary generation plan unless a site pattern specifically needs it. | P3 |

## Target Size

Full robust implemented target for this gap pass: 138 active public generated automotive registry images.

| Library | Target active assets | Starting active assets | Additional accepted |
| --- | ---: | ---: | ---: |
| `auto_body` collision/body/paint/dent | 72 | 24 | 48 |
| `auto_services` mechanical/tire/repair | 48 | 0 | 48 |
| Shared auto-glass set for service-visible glass coverage | 18 | 0 | 18 |
| Total active registry assets after this pass | 138 | 24 | 114 |

The original coverage analysis called for 24 shared glass concepts, but 6 body-glass images were already included inside the starting `auto_body` coverage. This implementation added the 18 missing shared glass images under `auto_services` and kept the body-glass assets inside the 72-image `auto_body` target.

The first practical milestone should be smaller: add 48 reviewed `auto_services` and shared glass assets, wire them into the registry/fallbacks, then continue the auto-body library from 24 toward 72.

## Visual QA Gate

Reject any generated image with:

- People posing in front of cars, staff portraits, customer-service staging, or fake showroom moments.
- Faces, readable text, signage, labels, logos, license plates, VINs, screens, documents, receipts, forms, claim paperwork, calibration targets, or pseudo-text.
- Unsafe tool contact: rotary tools near hands, tools floating away from the contact point, hands trapped under glass, unsupported glass, unstable lifts, or cluttered unsafe floors.
- Fake wheel-center emblems, brand-like marks, badge-like details, fake certifications, watermarks, or stock-photo overlays.
- Distorted hands, impossible wheel geometry, warped panels, broken glass physics, bad tire sidewalls, strange reflections, or obvious AI artifacts.
- Customer-proof implications unless the asset is explicitly a generic non-claim process or comparison image.

Positive traits to prefer:

- Unbranded, generic shop environments with no identifiable business location.
- Practical working light, clean but used equipment, and believable shop-floor texture.
- Crops close enough to show the service, but wide enough to remain understandable in a generated-site layout.
- Vehicle variety across sedan, SUV, pickup, and van-like silhouettes without brand identity.
- Hands only when they make the work clearer and the tool contact is physically safe.

## Generation Waves

### Wave A: Auto Services Foundation

Generate 24 candidates, target at least 16 accepted. Save accepted images under `public/generated-site-assets/auto-services`.

Candidate subjects:

- Two-post lift bay with an unbranded vehicle, no people.
- Hood-open service bay, engine area visible from a respectful distance.
- Wheel-off lift bay with brake rotor and hub visible.
- Alignment rack with screens turned away or out of frame.
- Tire inventory wall or tire cart with no sidewall text.
- Quick-lube style oil service bay, no signage.
- Battery/diagnostic bay with display turned away or absent.
- Stacked wheels and tire cart near a bay.
- Interior tire patch repair detail.
- Fresh tread macro texture.
- Tread-depth check with gauge markings hidden.
- Valve stem or TPMS sensor flat lay on an unmarked mat.
- Wheel balancing spindle or adhesive weights with no branding.
- Brake rotor inspection with shop light.
- Brake pad or hardware kit on a plain mat.
- Caliper compression tool correctly seated.
- Oil filter on worn workbench.
- Drain plug removal detail with no spill mess.
- Cabin filter replacement detail.
- Battery terminal cleaning or clamp detail.
- Diagnostic connector close-up with no scan-tool screen.
- Serpentine belt or engine bay inspection detail.
- Tie rod adjustment or alignment hardware detail.
- Suspension fastener or control-arm inspection detail.

### Wave B: Shared Auto Glass

Generate 18 candidates, target at least 12 accepted. Store under `public/generated-site-assets/auto-services` with `glass-...` filenames unless a dedicated future `auto_glass` vertical is created.

Candidate subjects:

- Windshield chip resin injector, no hands in unsafe contact.
- Small rock chip macro with no before/after claim.
- Replacement windshield staged on padded stand.
- Windshield opening with urethane bead and no glass hovering.
- Suction-cup glass handling with safe gloved hands and supported glass.
- Wiper/cowl inspection detail.
- Side window regulator detail.
- Auto glass tool tray flat lay, no labels.
- Primer applicator at pinch weld, no text or stickers.
- Rain beads on windshield texture for neutral glass context.
- Windshield tape retention detail, no paperwork or stickers.
- Glass edge and seal detail on stand.

### Wave C: Auto Body Expansion

Generate 24 candidates, target at least 14 accepted. Continue toward the 72-image auto-body target from `docs/auto-body-image-library-plan.md`.

Candidate subjects:

- Additional lift-bay and frame-rack environments.
- Rear quarter-panel and tailgate repair prep.
- Door-shell or door-skin alignment detail.
- Fender edge repair and panel clip detail.
- Bumper tab repair and lower valance scuff repair.
- Parts cart after collision disassembly.
- Masking tape edge and primer feathering details.
- Seam sealer application with no labels.
- Wet sanding or compound macro only if no rotary tool near hands.
- Finished body-line review from alternate angles.

### Wave D: Tire Delivery and Underrepresented Services

Generate 18 candidates, target at least 10 accepted after the foundation set is wired.

Candidate subjects:

- Tire delivery staging with loose unbranded tires and no branded van.
- Mobile tire setup without business identity or readable equipment labels.
- Used tire inspection with tread and sidewall text hidden.
- Tire rotation set layout without arrows or labels.
- Wheel studs cleaned detail.
- Tire pressure gauge close-up with dial turned away.
- Battery test leads only, no readable display.
- Fuse box or relay detail with all labels out of frame.
- Underbody service detail with safe lift posture.
- General repair tool layout on a worn bench.

## Wiring Plan

1. Generate candidates with Codex built-in `image_gen`, one distinct prompt per image.
2. Inspect each output visually at full size and in likely card/hero crops.
3. Copy only accepted assets into project-local public directories:
   - `public/generated-site-assets/auto-services`
   - `public/generated-site-assets/auto-body`
4. Add accepted `auto_services` assets to `lib/image-registry.ts` so static helper calls no longer fall back to `general_local`.
5. Add an `autoServicesFallbackContextMedia` equivalent in `lib/generated-site-v3-compiler.ts` for photo-less `auto_services` sites when no approved asset-library images are returned.
6. Keep the existing asset-library path as the preferred dynamic source when approved assets exist, but guarantee a public fallback for local/dev and no-library scenarios.
7. Add service-aware hero preferences for `auto_services` in `heroImageAssetForBusiness`, covering glass, tire, brake, oil, diagnostic, alignment, and general repair terms.
8. Update tests and boundary checks so `auto_services` no longer expects an empty public registry.

## Verification Plan

After each accepted wave:

1. Run image-level visual QA manually before copying files.
2. Run `git diff --check`.
3. Run `npm run typecheck` after registry or compiler changes.
4. Run `npm run verify:render-browser` after generated-site rendering changes.
5. Run `npm run verify:launch-boundaries` when changing asset-library policy, generated-site media selection, or fallback behavior.
6. Run the auto-body quality benchmark when changing body/gallery behavior. If it fails on unrelated text/layout gates, report that separately rather than mixing it into image QA.

## Immediate Next Step

Start with Wave A, because it closes the largest launch-visible gap: photo-less `auto_services` sites currently have no guaranteed generated public gallery. The first implementation pass should target 16 accepted `auto_services` assets, wire the registry and fallback media selection, then verify generated pages for tire/alignment, brake, oil, diagnostic, and glass-only service mixes.

## Implementation Status

Implemented on 2026-06-15 with Codex built-in `image_gen` only. No project `OPENAI_API_KEY`, image-generation CLI, or batch API runner was used.

Active wired registry coverage:

| Library | Active generated registry assets | Public files in directory | Notes |
| --- | ---: | ---: | --- |
| `auto_body` | 72 | 76 | 72 accepted assets are wired. Older public files remain in place for compatibility with stale references. |
| `auto_services` | 66 | 66 | 48 mechanical/tire/service images plus 18 shared glass images are wired. |

Generated-site V3 media selection now has a generated `auto_services` fallback, and both `auto_body` and `auto_services` fallback galleries read from `lib/image-registry.ts`.

### Wave A Accepted: Auto Services Foundation

Accepted 48 images under `public/generated-site-assets/auto-services`:

- `env-two-post-lift-bay-v1.png`
- `env-hood-open-service-bay-v1.png`
- `env-wheel-off-rotor-bay-v1.png`
- `env-alignment-rack-v1.png`
- `env-tire-inventory-wall-v1.png`
- `env-tire-cart-bay-v1.png`
- `env-quick-lube-bay-v1.png`
- `env-battery-diagnostic-bay-v1.png`
- `env-empty-service-bays-v1.png`
- `env-wide-toolbench-v1.png`
- `env-blurred-lift-bay-v1.png`
- `env-blurred-tire-rack-v1.png`
- `tire-interior-patch-v1.png`
- `tire-tread-macro-v1.png`
- `tire-tread-depth-check-v1.png`
- `tire-valve-stem-v1.png`
- `tire-tpms-flat-lay-v1.png`
- `tire-wheel-balancing-spindle-v1.png`
- `tire-adhesive-wheel-weights-v1.png`
- `tire-rotation-set-v1.png`
- `tire-pressure-gauge-v1.png`
- `tire-used-inspection-v1.png`
- `tire-wheel-studs-cleaned-v1.png`
- `tire-delivery-staging-v1.png`
- `brake-rotor-inspection-v1.png`
- `brake-pad-thickness-v1.png`
- `brake-caliper-compression-v1.png`
- `brake-hardware-kit-v1.png`
- `brake-fluid-reservoir-v1.png`
- `brake-wheel-off-assembly-v1.png`
- `oil-filter-bench-v1.png`
- `oil-drain-plug-v1.png`
- `oil-funnel-engine-bay-v1.png`
- `maintenance-cabin-filter-v1.png`
- `maintenance-dipstick-rag-v1.png`
- `maintenance-serpentine-belt-v1.png`
- `diagnostic-battery-terminal-cleaning-v1.png`
- `diagnostic-battery-clamp-v1.png`
- `diagnostic-multimeter-leads-v1.png`
- `diagnostic-obd-connector-v1.png`
- `diagnostic-engine-inspection-light-v1.png`
- `diagnostic-relay-parts-flat-lay-v1.png`
- `alignment-sensor-clamp-v1.png`
- `alignment-tie-rod-adjustment-v1.png`
- `alignment-suspension-fastener-v1.png`
- `alignment-uneven-tire-wear-v1.png`
- `alignment-control-arm-inspection-v1.png`
- `alignment-steering-component-v1.png`

Rejected Wave A candidates:

- Hood-open service bay: rejected for small pseudo-marking/clutter that risked label-like artifacts.
- Tire cart bay: rejected for wheel-center/marking risk; replaced with a tire-cart-only composition.
- Empty service bay with vehicle: rejected for badge-like vehicle detail; replaced with a no-vehicle empty-bay image.
- Tire rotation set with rims: rejected for wheel-center marking risk; replaced with loose tires without rims.
- Fuse-box detail: rejected because fuse ratings/readable markings appeared; replaced with unlabeled relay/electrical parts flat lay.

### Wave B Accepted: Shared Auto Glass

Accepted 18 images under `public/generated-site-assets/auto-services`:

- `glass-chip-resin-injector-v1.png`
- `glass-rock-chip-macro-v1.png`
- `glass-staged-windshield-v1.png`
- `glass-urethane-bead-v1.png`
- `glass-suction-cup-handling-v1.png`
- `glass-wiper-cowl-detail-v1.png`
- `glass-side-window-regulator-v1.png`
- `glass-tool-tray-v1.png`
- `glass-primer-pinch-weld-v1.png`
- `glass-rain-beads-v1.png`
- `glass-tape-retention-v1.png`
- `glass-edge-seal-v1.png`
- `glass-removal-wire-v1.png`
- `glass-setting-blocks-v1.png`
- `glass-quarter-window-seal-prep-v1.png`
- `glass-door-channel-v1.png`
- `glass-chip-fill-inspection-v1.png`
- `glass-replacement-edge-stand-v1.png`

Rejected Wave B candidates:

- None.

### Wave C Accepted: Auto Body Expansion

Accepted 48 additional images under `public/generated-site-assets/auto-body`:

- `body-env-frame-rack-wide-v1.png`
- `body-env-paint-prep-bay-v1.png`
- `body-env-inspection-bay-v1.png`
- `body-env-pickup-frame-bench-v1.png`
- `body-env-parts-cart-bay-v1.png`
- `body-env-panel-stand-row-v1.png`
- `body-env-shop-floor-wide-v1.png`
- `body-env-masked-booth-wide-v1.png`
- `body-env-dusk-bay-interior-v1.png`
- `body-env-wheel-free-suv-quarter-v1.png`
- `collision-rear-quarter-disassembly-v1.png`
- `collision-tailgate-panel-prep-v1.png`
- `collision-door-shell-alignment-v1.png`
- `collision-radiator-support-measure-v1.png`
- `collision-parts-cart-fasteners-v1.png`
- `collision-front-bracket-alignment-v1.png`
- `paint-masking-tape-edge-v1.png`
- `paint-primer-feathering-v1.png`
- `paint-seam-sealer-bead-v1.png`
- `paint-wet-sanding-block-v1.png`
- `paint-panel-rack-booth-v1.png`
- `paint-mixing-cup-unlabeled-v1.png`
- `pdr-door-ding-reflection-v1.png`
- `pdr-hood-dent-reflection-v1.png`
- `scratch-clearcoat-scuff-v1.png`
- `dent-door-edge-reflection-v1.png`
- `pdr-rod-behind-panel-v1.png`
- `hail-roof-rail-reflection-v1.png`
- `pdr-glue-pull-tabs-v1.png`
- `dent-crease-reflection-v1.png`
- `body-glass-rear-window-stand-v1.png`
- `body-glass-quarter-window-install-v1.png`
- `body-glass-pinch-weld-cleaned-v1.png`
- `body-glass-door-window-track-v1.png`
- `body-glass-cowl-masked-v1.png`
- `body-glass-side-glass-cleanup-v1.png`
- `bumper-tab-repair-closeup-v1.png`
- `bumper-lower-valance-scuff-v1.png`
- `rocker-panel-primer-edge-v1.png`
- `trim-clip-flat-lay-v1.png`
- `fender-liner-fastener-detail-v1.png`
- `finished-panel-reflection-review-v1.png`
- `finished-door-gap-review-v1.png`
- `before-after-quarter-panel-v1.png`
- `finished-bumper-fitment-v1.png`
- `custom-paint-spray-cards-v1.png`
- `custom-paint-masked-accent-panel-v1.png`
- `custom-paint-clearcoat-sample-v1.png`

Rejected Wave C candidates:

- Generic SUV on lift: rejected because visible wheel centers read as fake emblems.
- Front apron/headlight bracket detail: rejected because a small mark read like an emblem.
- Hail roof reflection detail: rejected because a reflection looked numeral-like.
- Initial clearcoat sample output: not copied; replaced with regenerated accepted clearcoat sample for a cleaner reviewed source.
