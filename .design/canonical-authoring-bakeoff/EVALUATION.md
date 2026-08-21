# Optimized V4 matched bake-off

Status: optimized V4 passed the matched pairs and six-run reliability screen; promotion approved

## Immutable treatment inputs

- Control implementation: commit `9250c6ff`, `site-runtime-v2`, and `r8InitialBuildProfile` from `retained-control-profile.ts`.
- Treatment implementation: the release commit containing optimized V4 modal containment and task-specific initial-build skill.
- Executable prompt: `website-manager@sha256:fbf163d754f290919f943ecbc4e5c22f432defa9dbdd823e7a15c73273171fe0` in both arms.
- Optimized V4 capability CSS: `sha256:ef3a20ccf7dc6c1f725218d83fba87858de27095d25c0e897c05d92bb80c173d`.
- Model: `gpt-5.6-luna`, with the same settings in both arms.
- Overall per-run model-cost fuse: `$0.50`.
- Authority, architecture plan, source inventory, assets, destinations, owner brief, and representative capture set must match within a business.

## Blinded review protocol

For each business, assign neutral labels only after both arms finish. Prepare the same desktop, phone, opened-navigation, and managed-form captures for A and B. Record the review below before revealing which label is R8 or optimized V4.

Score each category from 1 (materially weak) to 5 (excellent), then record concrete evidence rather than averaging away a material defect:

1. Business and brand specificity.
2. First-viewport strength.
3. Information hierarchy.
4. Editorial composition.
5. Conversion pacing.
6. Mobile composition.
7. Opened-navigation quality.
8. Form quality and prominence.
9. Factual and destination integrity.

Record separately for each arm:

- hard-gate outcome;
- model cost and duration;
- model requests, source writes, targeted edits, and inspections;
- navigation-specific repair rounds;
- mechanical findings and retained advisories; and
- sandbox replay, recycle, timeout, or other infrastructure events.

## Advancement rules

Kind advances only when optimized V4 is at least comparable in final quality, uses the managed modal default unless the brief says otherwise, contains navigation without repeating the prior repair loop, keeps every required destination reachable, retains a strong custom managed form, passes the hard gate, and has valid infrastructure evidence.

If Kind advances, repeat the same paired procedure for Surge. A material treatment problem shared by Kind and Surge stops the experiment.

After both pairs advance, run two additional optimized-V4 generations per business. A navigation, form, or ownership-boundary failure repeated in at least two V4 runs for either business blocks promotion. Diagnose and report one isolated stochastic failure rather than treating it as conclusive.

## Review record

### Kind — blinded scores recorded before treatment reveal

| Category | Arm A | Arm B | Evidence |
| --- | ---: | ---: | --- |
| Business and brand specificity | 4 | 5 | Both use Kind's restrained green/cream identity. B turns the brand's “kind” idea into a more distinctive editorial system and gives the supplied logo more confident scale. |
| First-viewport strength | 3 | 5 | A's desktop home is substantially under-scaled with excessive unused space. B has a decisive headline, image relationship, proof cue, and clear dual conversion path. |
| Information hierarchy | 3 | 5 | A's page family is coherent but typography and calls to action become visually small at desktop. B preserves clear hierarchy at desktop and phone widths. |
| Editorial composition | 4 | 5 | A has several strong green editorial panels. B is more varied and better balanced across home, service, guide, contact, and legal page types. |
| Conversion pacing | 4 | 5 | Both expose phone and quote paths. B makes those paths more prominent without overwhelming the editorial structure. |
| Mobile composition | 4 | 5 | A's closed mobile pages are good. B is more polished, with stronger rhythm, artwork scale, and responsive continuity. |
| Opened-navigation quality | 1 | 5 | A opens a transparent 242×92 inline link cluster that wraps inside the header. B opens an opaque, internally scrollable 390×768 modal beneath the measured 76px header. |
| Form quality and prominence | 4 | 5 | A's custom form is usable and well styled. B's form is equally functional and more strongly integrated as the contact page's primary composition. |
| Factual and destination integrity | 5 | 5 | Both passed the hard gate and retained the supplied facts and required destinations. B required one authored portal repair during the run; the final source includes the portal and contact destinations. |
| **Total** | **32/45** | **45/45** | B is materially better overall, not merely comparable. |

The opened-navigation screenshots use the exact baked capability CSS and trusted-runtime bytes. Their local/private capture intentionally does not resolve retained protected image assets; logo rendering was assessed from the retained final-artifact contact sheets instead.

### Kind — operational evidence

| Measure | Arm A | Arm B |
| --- | --- | --- |
| Hard release gate | Passed | Passed |
| Model cost | $0.14989992 | $0.12705688 |
| Duration | 1,660,661ms (27m 41s) | 1,226,444ms (20m 26s) |
| Model requests | 24 | 20 |
| Inspections | 5 plus finish | 5 plus finish |
| Navigation outcome | Authored `behavior="inline"`; no contained modal | Authored managed modal; no containment reconstruction loop |
| Managed form | Custom layout using legacy low-level controls | Custom layout using narrowed V4 SDK |
| Infrastructure | One historical 15-second transport timeout and recycle | No replay, recycle, transport timeout, or failed sandbox build |

The cost and duration difference is descriptive, not a causal estimate, because Arm A encountered one historical sandbox recycle. The final quality comparison remains valid because both retained final artifacts passed the hard gate.

### Kind — treatment reveal and decision

- Arm A: frozen R8/V2 control, run `run_4ff1721a1f754748bcfa3dc93281a478`.
- Arm B: optimized V4, run `run_9aa92465f7f74955ac76632128211f96`.
- Decision: optimized V4 clears every Kind advancement criterion and advances to the matched Surge comparison.

### Surge — blinded scores recorded before treatment reveal

| Category | Arm A | Arm B | Evidence |
| --- | ---: | ---: | --- |
| Business and brand specificity | 5 | 5 | Both use the supplied Surge logo, blue/yellow palette, Georgetown context, and authentic technician image. |
| First-viewport strength | 5 | 5 | A leads with a bold geometric service proposition; B leads with a strong navy editorial hero and a more prominent authentic technician portrait. |
| Information hierarchy | 5 | 5 | Both remain legible and decisive across the representative desktop and phone captures. |
| Editorial composition | 5 | 5 | A is a crisp modern service system. B is equally coherent with a more editorial serif voice. Neither is materially weaker. |
| Conversion pacing | 5 | 5 | Both surface phone, service, contact, and customer-login paths with clear pacing. |
| Mobile composition | 5 | 5 | Both adapt cleanly. B gives the hero image more narrative weight; A exposes more supporting process detail within the first viewport. |
| Opened-navigation quality | 2 | 4 | A opens a transparent 202×176 inline link grid inside the header. B opens a contained opaque 390×731 modal with every required destination. B's authored closed/open icon reads as a single bar, so it is functional but not visually ideal. |
| Form quality and prominence | 5 | 5 | Both produce strong custom managed forms integrated into distinct contact-page compositions. |
| Factual and destination integrity | 5 | 5 | Both passed the hard gate with the retained phone, address, service routes, contact path, and customer login reachable. |
| **Total** | **42/45** | **44/45** | B is at least comparable overall and materially better on the tested navigation boundary. |

### Surge — operational evidence

| Measure | Arm A | Arm B |
| --- | --- | --- |
| Hard release gate | Passed | Passed |
| Model cost | $0.10532747 | $0.12132790 |
| Duration | 825,496ms (13m 45s) | 933,333ms (15m 33s) |
| Model requests | 13 | 22 |
| Inspections | 3 plus finish | 5 plus finish |
| Navigation outcome | Authored `behavior="inline"`; transparent header grid | Authored managed modal; contained without geometry repair |
| Managed form | Custom layout | Custom layout using narrowed V4 SDK |
| Retained advisories | 80 warnings | 61 warnings |
| Infrastructure | Three first-attempt successful applies; no recovery | Four first-attempt successful applies, one authored-source build failure; no recovery |

Arm B used more authoring work and had one malformed-source build that the model repaired. That is a V4 reliability/efficiency concern to watch in the screen, not an infrastructure invalidation. Neither arm replayed, recycled, or timed out.

### Surge — treatment reveal and decision

- Arm A: frozen R8/V2 control, run `run_edecd4f2d67040c29f6e7dd646ef7205`.
- Arm B: optimized V4, run `run_cd6c6dc8abea4aa7b8008be84a58b5b5`.
- Decision: optimized V4 clears the Surge advancement rule. The matched pairs are complete; start two additional V4 runs per business and apply the recorded repeated-failure rule before promotion.

## Optimized-V4 reliability screen

The matched V4 arm for each business counts as the first of three. Two additional independent runs per business completed through the ordinary hosted queue.

| Business / run | Hard gate | Cost | Duration | Requests | Inspections | Managed modal / custom form | Infrastructure |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Kind 1 — `run_9aa92465f7f74955ac76632128211f96` | Passed | $0.12705688 | 20m 26s | 20 | 5 + finish | Yes / yes | Clean |
| Kind 2 — `run_ddbf867f44a542e1b41a2fb9397d92c3` | Passed | $0.15821632 | 22m 37s | 29 | 7 + finish | Yes / yes | Clean |
| Kind 3 — `run_fe8092f18990423ab875a21cbb4d24c3` | Passed | $0.16322549 | 15m 13s | 22 | 4 + finish | Yes / yes | Clean |
| Surge 1 — `run_cd6c6dc8abea4aa7b8008be84a58b5b5` | Passed | $0.12132790 | 15m 33s | 22 | 5 + finish | Yes / yes | One authored-source build repair; no recovery |
| Surge 2 — `run_d6f0ebc5250142a9a218ca653170e627` | Passed | $0.07336615 | 10m 02s | 12 | 2 + finish | Yes / yes | Clean |
| Surge 3 — `run_fb98492673ba4085879c9794726b74c7` | Passed | $0.10086519 | 15m 36s | 22 | 4 + finish | Yes / yes | Clean |

All six V4 artifacts retained the exact required destinations, used `behavior="modal"`, supplied explicit authored trigger content, used the narrowed `LeadField` form surface, and passed the deterministic release gate. Every sandbox apply in the six-run treatment screen succeeded on its first submission. No run replayed, recycled, timed out in transport, or crossed the $0.50 fuse.

Opened-navigation capture confirmed the intended mechanism in all reviewed runs. Additional Kind panels were fixed and opaque at 390×761 and 390×770 beneath their measured headers. Additional Surge panels were fixed and opaque at 390×721 and 390×737. Authored link composition remained distinct across the runs, while the capability CSS supplied containment without platform hamburger artwork or inner-link layout.

One Surge treatment and one additional Surge run visually collapsed three unspaced bars into a single thick mark. The trigger remained labeled, at least 44px, keyboard-operable, and functionally correct; another Surge run authored a conventional separated three-bar icon. This is a repeated subjective artwork refinement opportunity, not a repeated containment, form, or ownership-boundary failure. It should be considered in a later isolated authoring-guidance experiment rather than converted into platform artwork or a hard visual gate.

Kind 2 used substantially more repair work than the other runs but finished with only two retained warnings. Surge 1 repaired one malformed-source build, while Surge 2 and Surge 3 did not repeat it. Neither is a repeated architecture-related failure.

### Post-review glyph correction

The frozen nine-category scores above are not changed. A later byte- and screenshot-level audit found a portable-font defect that the old release gate and blinded visual review both missed:

| Run | Portable glyph defect |
| --- | --- |
| `run_9aa92465f7f74955ac76632128211f96` | `✳` U+2733 in the hero proof mark |
| `run_ddbf867f44a542e1b41a2fb9397d92c3` | `✳` U+2733 in the hero note |
| `run_fe8092f18990423ab875a21cbb4d24c3` | None; it used no unsupported symbol |
| `run_cd6c6dc8abea4aa7b8008be84a58b5b5` | `↗` U+2197 in the hero call-to-action |
| `run_d6f0ebc5250142a9a218ca653170e627` | `↯` U+21AF in the hero badge, captured as `NO GLYPH` |
| `run_fb98492673ba4085879c9794726b74c7` | `✓` U+2713 in the hero trust line |

The managed web fonts were Latin subsets and the platform relied on visitor-specific system fallback for these characters. That made published rendering non-portable even though the authoring source and old hard gate were valid. The correction is a forward-only platform guarantee: pinned same-family symbol coverage plus a deterministic `render.missing_glyph` inspection and release finding. Future comparisons treat portable glyph rendering as a technical precondition, not a tenth subjective score. Historical archives retain their original font bytes so this defect remains reproducible.

## Promotion decision

Optimized V4 satisfies the predeclared promotion rule:

- deterministic containment, inline isolation, and authored-override fixtures pass;
- final quality beat R8 for Kind and was at least comparable for Surge;
- all six V4 runs passed the hard gate;
- no navigation-containment, managed-form, destination-authority, or infrastructure failure repeated;
- managed navigation no longer required the model to reconstruct viewport containment; and
- the exact prompt, task skill, toolchain, image, capability-CSS hash, and unchanged V4 runtime patch are attributable.

Decision: promote recipe-free optimized V4 as the sole new-authoring generator. Preserve R8/V1–V3 only for retained artifact rendering and private experiment provenance. Do not reintroduce recipes, platform trigger artwork, a live runtime selector, or an aesthetic release critic.

The promotion still stands after the glyph correction. R8's managed-navigation failure was structural and repeated across both businesses; portable glyph coverage is a deterministic platform defect fixed once for every future artifact rather than evidence for returning to mixed navigation presentation ownership.
