# Optimized recipe-free V4 boundary

Date: 2026-08-20
Status: accepted for canonical promotion after matched pairs and reliability screen

## Decision

Keep V4 recipe-free and preserve its narrowed managed-form SDK and explicit authored navigation trigger. Restore only modal spatial containment through platform capability CSS:

- hidden state;
- a 44px trigger floor;
- fixed positioning below the runtime-measured `--lodesta-navigation-top`;
- remaining dynamic-viewport height;
- internal scroll and overscroll containment; and
- a token-derived opaque surface and text color.

The trusted navigation JavaScript is unchanged. Authored source still owns all trigger artwork, breakpoints, motion, spacing, typography, inner menu composition, and intentional drawer or sheet overrides. Platform CSS does not style or size navigation links; inspection and verification continue to report undersized targets.

The authoring skill is split by the existing `initial_build`, `edit`, and `rebase` task kinds. Each receives a smaller knowledge set and an identity derived from its exact objective and knowledge. The compact pull-source prompt remains the sole executable authoring prompt. The previous long prompt is replaced by a separate minimal read-only discussion prompt.

## Rationale

V4 retained V2's audited modal state machine but removed both visual artwork and the containment that made modal behavior coherent. Removing platform hamburger artwork was correct. Removing fixed viewport containment was not: the runtime still trapped focus, locked scroll, inerted the background, and calculated the header offset while nothing consumed that offset. The resulting model had to reconstruct deterministic containment from prose and pixel feedback.

Containment is part of the modal behavior guarantee. Link layout is not. A runtime link-size rule would require imposing `display` and alignment on authored anchors, recreating the presentation collision V4 was intended to remove.

Recipes remain rejected as the canonical starting mechanism. A recipe is source the model must edit when it disagrees, creating cost and failure opportunities. The current custom V4 form proves that opinionated output can be authored through the narrowed capability without prewritten visual source.

## Provenance

Capability CSS belongs to the sandbox/compiler toolchain, not the immutable runtime patch. This change therefore:

- leaves the V4 JavaScript and runtime patch bytes unchanged;
- regenerates the existing checked-in toolchain fingerprint as `lodesta-static-site-workspace@sha256:7f74a114d37d80f41955d0469a38cd2cbf4297b3e635f581e92e5cc0b316c857`;
- records V4 capability CSS as `sha256:ef3a20ccf7dc6c1f725218d83fba87858de27095d25c0e897c05d92bb80c173d`;
- deploys sandbox image `sha256:f80a45a2facb768601ccafd240add43053528dd201b8dc7e72bb240a2e453d2c` with the matching toolchain manifest;
- preserves the existing sandbox-manifest shape; and
- keeps retained finalized artifacts byte-exact.

Live workspace previews compile with the active scaffold and intentionally receive the new containment after deployment. This changes preview rendering without rewriting workspace source or retained finalized artifacts.

Before the skill split, the exact R8 eight-item initial-build skill, identity, compact prompt identity, V2 runtime, and authoring profile were frozen under `.design/canonical-authoring-bakeoff/` for private experiment use only. The fixture is unreachable from live profile selection.

## Evidence sequence

1. Prove modal containment and authored override behavior deterministically in the existing runtime fixture.
2. Deploy the hand-versioned toolchain through the coordinated sandbox release.
3. Run a fresh matched Kind R8/V4 pair with the same compact prompt, authority, architecture, assets, destinations, model, and $0.50 fuse.
4. Stop if V4 materially loses or repeats navigation repair churn.
5. If Kind advances, repeat on Surge.
6. Only then run two additional V4 generations per business. A repeated treatment-related failure in at least two runs blocks promotion; one isolated failure is diagnosed rather than treated as conclusive.

The coordinated release completed at application release `0371ef05f7e77cf826c61daaa1182a2e64c5c1a0`, with web and worker reporting the same SHA before sandbox promotion. The fresh Kind pair then passed both hard gates. Optimized V4 (`run_9aa92465f7f74955ac76632128211f96`) materially beat frozen R8 (`run_4ff1721a1f754748bcfa3dc93281a478`) under the predeclared rubric, 45/45 to 32/45. V4 produced the requested contained managed modal without a containment repair loop; R8 authored `behavior="inline"` and opened a transparent wrapping link cluster in the header. Kind therefore advanced to Surge.

The fresh Surge pair also passed both hard gates. Optimized V4 (`run_cd6c6dc8abea4aa7b8008be84a58b5b5`) was at least comparable to frozen R8 (`run_edecd4f2d67040c29f6e7dd646ef7205`), 44/45 to 42/45. V4 again authored a contained managed modal while R8 authored a transparent inline header grid. V4 used more repair work and its authored single-bar trigger icon is an advisory refinement opportunity, but neither issue invalidates the architecture. Surge advances to the reliability screen.

The reliability screen then completed with two additional independent V4 runs per business. All four additional artifacts passed the hard gate, used managed modal navigation, retained every required destination, and used custom layouts through the narrowed V4 form SDK. Across the complete three-Kind/three-Surge treatment, every sandbox apply succeeded on its first submission; no run replayed, recycled, timed out in transport, or crossed the $0.50 fuse.

| Business / run | Hard gate | Cost | Duration | Requests | Inspections |
| --- | --- | ---: | ---: | ---: | ---: |
| Kind 2 — `run_ddbf867f44a542e1b41a2fb9397d92c3` | passed | $0.15821632 | 1,356,796 ms | 29 | 7 plus finish |
| Kind 3 — `run_fe8092f18990423ab875a21cbb4d24c3` | passed | $0.16322549 | 913,421 ms | 22 | 4 plus finish |
| Surge 2 — `run_d6f0ebc5250142a9a218ca653170e627` | passed | $0.07336615 | 602,070 ms | 12 | 2 plus finish |
| Surge 3 — `run_fb98492673ba4085879c9794726b74c7` | passed | $0.10086519 | 936,373 ms | 22 | 4 plus finish |

The same architecture-related failure did not recur in two runs for either business. One paired Surge run repaired malformed authored source, but the two additional Surge runs did not repeat it. Two Surge runs used visually compressed trigger-bar artwork; because the triggers remained explicitly authored, labeled, correctly sized, keyboard-operable, and fully functional, this is advisory visual evidence rather than a containment or ownership-boundary failure. It is not a reason to restore platform artwork.

Optimized V4 therefore satisfies the recorded promotion rule. It becomes the sole new-authoring generator. Historical runtime identities remain only for byte-exact retained rendering and experiment evidence. The stored-data report found 336 mutable current inputs requiring V4, zero owner-created current revisions requiring approval, zero missing workspace sidecars, and retained V1–V3 references that must continue rendering unchanged. Repointing creates new immutable V4 inputs under the maintenance fence; it does not rewrite retained data.
