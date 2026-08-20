# Optimized recipe-free V4 boundary

Date: 2026-08-20
Status: implemented locally; coordinated deployment and matched bake-off pending

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

No current public input is repointed by this decision.
