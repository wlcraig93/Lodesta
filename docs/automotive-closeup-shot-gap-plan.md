# Automotive Close-Up Shot Gap Plan

Last updated: 2026-06-16

## Goal

Build a safer automotive generated-image library for generic customer sites by prioritizing tight, believable process/detail crops over full shop floors, full vehicles, staff poses, or business-specific scenes.

This plan is based on the canonical services in `lib/service-catalog.ts`:

- `auto_body`: collision repair, dent repair, auto paint, auto glass, bumper repair, hail damage repair, frame/structural repair, repair estimates, insurance claim support, custom paint.
- `auto_services`: flat repair, used tires, new tires, tire rotation, wheel balancing, wheel alignment, TPMS service, oil change, brake service, auto repair, diagnostics, auto glass, tire delivery.

## C-Grade Auto-Body Retention

`C` does not always mean delete the file. For a generic site, it means do not use it by default, especially not in the first viewport. The biggest problem is usually specificity risk: full invented shop, full vehicle, full rack, or staged specialty composition.

| File | Keep? | Recommended use | Replacement needed |
| --- | --- | --- | --- |
| `body-env-dusk-bay-interior-v1.png` | Keep file, suppress from default selection | Rare atmospheric background only, heavily cropped/blurred | Yes: close masked-panel or panel-stand detail instead of whole shop. |
| `body-env-frame-rack-wide-v1.png` | Keep file, suppress from default selection | Structural service fallback only if no detail image exists | Yes: frame clamp/measuring-point close-ups. |
| `body-env-pickup-frame-bench-v1.png` | Keep file, suppress from default selection | Avoid unless specifically testing structural variety | Yes: pickup/bedside close detail without full shell/rack. |
| `body-env-shop-floor-wide-v1.png` | Keep file, suppress from default selection | Avoid for generic sites; too much invented facility | Yes: panel rack close-up or bumper stand close-up. |
| `custom-paint-masked-accent-panel-v1.png` | Keep only for custom paint secondary gallery | Custom paint only, not collision/body default | Yes: less artificial custom paint process images. |
| `frame-bench-measure-v1.png` | Keep file, suppress from hero/default | Structural secondary only | Yes: frame/unibody measuring detail with no full vehicle. |
| `lift-bay-overview-v1.png` | Keep file, suppress from hero/default | Broad auto-body context fallback only | Yes: tighter lift pad/rocker/wheel-well crop. |
| `finished-shop-context-v1.png` | Keep unwired | None by default | No need to replace directly; use tighter finished-panel images. |
| `paint-refinish-closeup-v1.png` | Keep unwired | None by default | No direct replacement needed; stronger sanding images exist. |
| `before-after-body-panel-v1.png` | Reject | Do not use | No direct replacement; `before-after-body-panel-v2.png` is the safer comparison. |
| `exterior-hail-dent-panel-v1.png` | Reject | Do not use | Use tight PDR reflection shots instead. |

## Auto-Body Replacement Shots

Generate these as replacement candidates before adding more broad environment images.

| Priority | Proposed filename | Service fit | Shot spec | Avoid |
| --- | --- | --- | --- | --- |
| P0 | `body-frame-clamp-closeup-v1.png` | Frame & structural repair | Close crop of frame bench clamp gripping a pinch weld or rail flange, no full vehicle | Full rack, tool wall, text labels. |
| P0 | `body-unibody-measuring-point-v1.png` | Frame repair, estimates | Measuring pointer or tram gauge near a clean unibody reference hole, no readable numbers | Full car, measurement screen, calibration targets. |
| P0 | `body-lift-pad-rocker-closeup-v1.png` | Collision repair, inspection | Lift pad correctly contacting rocker pinch weld, cropped under vehicle | Whole lift bay, full vehicle, unsafe contact. |
| P0 | `body-wheel-well-liner-removed-v1.png` | Collision, bumper, estimates | Wheel-well opening with liner removed and fasteners visible, tight crop | Wheel emblem, license plate, full front end. |
| P0 | `body-bumper-bracket-fastener-v1.png` | Bumper repair | Close bumper bracket and plastic fastener alignment, detached cover or corner crop | Full bumper scene, fake part labels. |
| P0 | `body-panel-edge-masking-closeup-v1.png` | Auto paint | Masking tape edge along a panel crease with feathered primer, macro crop | Whole booth, sprayed paint cloud. |
| P0 | `body-paint-booth-panel-stand-closeup-v1.png` | Auto paint | Detached panel on padded stand inside booth, tight crop on masked edge and stand padding | Full booth, full vehicle. |
| P1 | `body-quarter-panel-damage-markless-v1.png` | Collision, estimates | Tight dent/scuff area on quarter panel with no marker writing or claim implication | Before/after proof layout. |
| P1 | `body-door-shell-hinge-closeup-v1.png` | Collision repair | Door shell hinge bolts and alignment slot, close crop | Full door/vehicle, readable part stamps. |
| P1 | `body-headlight-mount-tab-closeup-v1.png` | Collision, bumper repair | Headlight mounting tab area or replacement bracket close-up | Vehicle badge, full headlamp brand shape. |
| P1 | `body-rocker-sanding-edge-v1.png` | Rocker/scuff repair | Lower rocker primer and sanding edge, close crop | Full side vehicle, wheel center. |
| P1 | `body-pdr-reflection-tight-ding-v1.png` | Dent/PDR | One small ding with reflection board lines, tight crop | Repeated artificial dent pattern. |
| P1 | `body-hail-dent-macro-v1.png` | Hail damage | Hood/roof dent macro under soft line reflection, no full vehicle | Patterned AI hail clusters. |
| P1 | `body-estimate-parts-cart-detail-v1.png` | Estimates, claim support | Plain clips/brackets/fasteners in trays after teardown, no paperwork | Insurance forms, documents, labels. |
| P2 | `body-custom-spray-out-card-closeup-v1.png` | Custom paint | Close paint sample card with no labels, texture/reflection visible | Portfolio-style finished job. |
| P2 | `body-clearcoat-orange-peel-sample-v1.png` | Custom paint/refinish | Gloss sample panel showing controlled reflection texture, no full booth | Overly perfect CGI reflection. |

## Auto-Services Gap Analysis

The current `auto_services` set has 66 wired assets. It is stronger than the old generic fallback, but several service lines still need more close-up coverage so generated sites do not rely on wide bay scenes.

| Service | Current usable coverage | Gap | Exact shots to generate |
| --- | --- | --- | --- |
| Flat Repair | Interior patch, tread inspection | Needs more repair-action variety without unsafe hands inside wheel/tire geometry | `flat-puncture-reamer-closeup-v1.png`, `flat-plug-tool-angle-v1.png`, `flat-inner-liner-buffed-v1.png`, `flat-patch-roller-finished-v1.png` |
| Used Tires | Used tire inspection, tread macro | Needs buying/inspection detail without sidewall text | `used-tire-sidewall-hidden-inspection-v1.png`, `used-tire-tread-shoulder-wear-v1.png`, `used-tire-light-through-tread-v1.png` |
| New Tires | Tire inventory wall, tread macro | Too much inventory/context; needs product/detail images with no brand text | `new-tire-label-free-stack-closeup-v1.png`, `new-tire-bead-detail-v1.png`, `new-tire-tread-block-closeup-v1.png` |
| Tire Rotation | Loose tire set | Current image is understandable but staged; needs actual wheel-off service detail | `rotation-lug-nuts-tray-v1.png`, `rotation-wheel-off-hub-closeup-v1.png`, `rotation-torque-wrench-lug-v1.png`, `rotation-tire-on-cart-closeup-v1.png` |
| Wheel Balancing | Balancing spindle, adhesive weights | Needs more close process detail, less full wheel/machine | `balancing-cone-spindle-closeup-v1.png`, `balancing-rim-barrel-cleaning-v1.png`, `balancing-weight-placement-closeup-v1.png` |
| Wheel Alignment | Clamp, tie rod, control arm, tire wear | Good coverage, but avoid rack hero dependence | `alignment-toe-adjuster-closeup-v1.png`, `alignment-camber-bolt-closeup-v1.png`, `alignment-tread-feathering-macro-v1.png` |
| TPMS Service | TPMS flat lay, valve stem | Needs service-in-context shots, not just parts | `tpms-sensor-inside-wheel-v1.png`, `tpms-valve-core-tool-v1.png`, `tpms-stem-nut-closeup-v1.png` |
| Oil Change | Filter bench, drain plug, funnel | Needs more believable oil-change action close-ups | `oil-drain-stream-pan-closeup-v1.png`, `oil-filter-removal-underbody-v1.png`, `oil-crush-washer-drain-plug-v1.png`, `oil-fill-funnel-unlabeled-jug-v1.png` |
| Brake Service | Rotor, pads, caliper compression, hardware | Good coverage; add inspection/bleed details | `brake-caliper-guide-pin-v1.png`, `brake-rotor-edge-thickness-v1.png`, `brake-bleeder-screw-closeup-v1.png`, `brake-hub-cleaning-before-rotor-v1.png` |
| Auto Repair | Cabin filter, belt, dipstick, engine light | Needs broader general repair without screens or brand labels | `repair-air-filter-closeup-v1.png`, `repair-spark-plug-coil-flatlay-v1.png`, `repair-hose-clamp-inspection-v1.png`, `repair-underhood-fastener-tray-v1.png` |
| Diagnostics | Battery, OBD, multimeter, relays | Good concept coverage; avoid scan screens | `diagnostic-test-light-connector-v1.png`, `diagnostic-fuse-puller-unlabeled-v1.png`, `diagnostic-battery-load-clamp-v1.png`, `diagnostic-ground-strap-inspection-v1.png` |
| Auto Glass | Strong shared glass set | Mostly adequate; add a few close, non-full-vehicle variants | `glass-setting-block-close-macro-v1.png`, `glass-urethane-nozzle-bead-v1.png`, `glass-door-run-channel-macro-v1.png` |
| Tire Delivery | Tire staging | Needs delivery/staging imagery without branded vehicle or paperwork | `delivery-tires-on-dolly-doorway-v1.png`, `delivery-tire-stack-straps-closeup-v1.png`, `delivery-install-kit-flatlay-v1.png` |

## Recommended Next Generation Queue

Generate the next wave as 48 accepted images, not 48 attempts:

- 16 `auto_body` replacements from the table above.
- 32 `auto_services` additions, prioritizing oil change, tire rotation, tire delivery, TPMS, flat repair, and general repair.

Suggested order:

1. Generate 16 candidates for oil change, tire rotation, flat repair, and tire delivery. Accept at least 10.
2. Generate 16 candidates for frame/lift/body replacements. Accept at least 10.
3. Generate 16 candidates for TPMS, balancing, diagnostics, brakes, and repair. Accept at least 10.
4. Fill misses with replacement prompts from the same service category until the accepted target is met.

## Prompt Rules

Every prompt should state:

- Tight close-up or macro process crop.
- Anonymous repair bay only as soft background.
- No readable text, logos, sidewall brands, screens, labels, plates, VINs, documents, forms, or claim paperwork.
- No faces, staff posing, customer scenes, or full shop-floor views.
- No unsafe tool contact, unsupported glass, unstable lift, floating tools, distorted hands, broken reflections, or bad wheel geometry.

Preferred phrasing:

- "Close cropped realistic service detail, unbranded, no readable markings, shallow depth of field, anonymous shop background."
- "The image should not imply a specific business, staff member, vehicle owner, or customer job."
