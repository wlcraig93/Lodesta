# Site authoring experiment retrospective

Date: 2026-08-15
Scope: retained source, authoring, visual-quality, copy, review-loop, runtime, and logo experiments run from 2026-08-01 through 2026-08-14.

## Executive conclusion

The experiments support a simpler generator, not a more orchestrated one.

Lodesta's best live generator is the `canonical` authoring profile—the exact proven `baseline-release-candidate-v1` behavior—on `site-runtime-v2`, with Luna/high as the default author model. The platform prepares immutable source truth, ranked media, canonical assets, and a presentation-safe logo; the author receives a compact skill, owns the site implementation, inspects rendered output, and must pass deterministic factual, functional, accessibility, asset, and release-integrity checks.

The strongest improvements came from making better evidence available to the author. Added visual systems, fixed composition targets, candidate tournaments, mandatory reviewers, broader feedback policies, and profile-free runtime changes generally increased cost or repair turns without producing a dependable quality gain.

## What the experiments established

### 1. Whole-site retained source access is foundational

The August 1 mirror bake-off compared complete retained mirrors with a 50-readable-page control. Across the three paired large-site comparisons, the complete condition produced 186 routes versus 117, cost 8.6% less, and took 7% longer because it built and verified substantially more real content. The sampled Kind controls twice overfit to alphabetically early ant/bee/bug pages. Surge produced 103 routes from the complete mirror versus 24 from the sampled control.

Decision: keep immutable complete capture, a compact inventory, local replay, and model-pulled source files. Do not restore source sampling or add a route-planning agent. Very large existing content estates still need a deterministic materialization mechanism; asking the model to reproduce hundreds of pages through output tokens is not a context-discovery solution.

### 2. Curated first-party assets mattered more than visual prompting

The August 5 matched Surge homepage experiment gave five controls and five treatments the same official logo variants and authentic team/technician photographs. All ten candidates used the identity kit. The additional visual-system/browser treatment then lost four of five blinded comparisons. Its median cost was 33.7% higher and median duration 50.2% higher. It improved brand fidelity and contrast, but reduced mean hierarchy, typography, composition, imagery, conversion clarity, responsive polish, and authenticity.

Later source-media tests reproduced the positive asset result. Surge's authentic technician image and Kind's authentic ant-on-wood image materially raised blinded visual scores. Visible pixels had to outrank unreliable labels: some Kind assets labeled as technicians actually showed plumbing or cleaning imagery.

Decision: retain a small provenance-bound identity/media kit and ranked source pixels. Do not add a visual director, fixed mockup, mandatory photo rule, or unfiltered mirror image list.

### 3. Better copy reasoning helped, but more upstream strategy raised factual risk

The August 12 Kind copy bake-off found that a specialist writer produced the strongest complete route system, while the shorter local-business skill was the most useful operational constraint. None of the candidates was judged publishable in any of 20 blinded passes. The evidence-led inventory was last: it added length and unsupported specificity. A multi-direction tournament found vivid headlines but also rewarded invented details.

The durable lesson is a specialist/concise hybrid: route-specific jobs, clear actions, plain language, fewer abstract process phrases, and hard evidence discipline. Distinctive copy requires richer verified business evidence; prompts cannot manufacture substantiated differentiation from a thin fact packet.

Decision: keep copy reasoning inside the authoring skill. Do not add a required headline tournament, separate copy pipeline, or automatic copy critic.

### 4. Selection and reviewer-repair were useful diagnostics, not product architecture

In the predeclared candidate-selection experiment, the better of two independent drafts beat a separately reviewed/repaired draft, but both lost to the retained incumbent. Selection cost $0.20961 in authoring versus $0.10432 for draft plus repair, and cost more than the repair arm even after its $0.07711 reviewer was included.

A one-shot reviewer handoff sometimes produced a strong retained-workspace improvement, but cheaper self-review wording and fixed visual targets did not reproduce it. The mechanism was not consistent enough to justify a mandatory stage.

Decision: do not add candidate tournaments, automatic critics, mandatory repair continuations, or convergence loops. Use independent review for experiments and operator diagnosis only.

### 5. More inspection feedback did not reliably reduce repair churn

The material-integrity feedback treatment completed on Surge but used 21 model requests, five inspections, and five builds versus 16 requests and three builds for the mixed control. It avoided one invented visual device but replaced a strong technician hero with another large logo/address treatment and was not visually dominant. The matched Kind run was infrastructure-invalid and excluded.

Decision: keep complete diagnostics retained, return concrete functional failures and a small useful advisory set, and avoid tuning broader subjective feedback policies as if they were deterministic quality controls.

### 6. The compact V2 baseline generalized; small prompt additions did not

The baseline release sequence produced accepted private candidates for Kind and Surge with the same compact eight-item authoring skill. Kind R8 passed at $0.13247; Surge R6 passed at $0.16660. They preserved exact identity, authentic imagery, locality, customer access, managed forms, responsive navigation, and distinct visual systems. A two-sentence post-proof tweak succeeded on Surge but failed a fresh Kind replicate with retained contrast errors, so it was rejected.

Decision: preserve the exact proven skill identity. Do not promote prose because it sounds sensible; require matched evidence and generalization.

### 7. Native interaction primitives are promising, but V3 was not a better generator

The profile-free static V3 run removed the architecture call and was 26.8% faster, but failed its cost fuse, produced no candidate, cost 51.7% more, used 233% more successful author tools, selected a semantically wrong hero, broke fragment navigation, and repeated one thin route template.

A fair V3 rerun with the proven authoring profile succeeded, but author cost was 56.8% higher and model requests were 77.8% higher. It also exposed a visually blank mobile-menu trigger missed by the prior gate. A corrected isolated V3 candidate demonstrated that native `<details>` navigation can work, but still used materially more turns and cost than V2.

Decision: native HTML interactions are a valid long-term simplification direction. They are not evidence to replace the canonical V2 generator today. Runtime changes must be isolated from authoring-profile changes and judged on total loop behavior, not on deleting one stage.

### 8. Logo preparation was the cleanest recent win

Human review found that the official Kind logo's large opaque outer canvas forced a conspicuous white tile and repeated logo-repair behavior. The platform now preserves the immutable original and prepares a separately hashed presentation revision by trimming only verified uniform outer canvas.

With the same V2 profile and retained architecture, the fresh logo/lean-loop diagnostic succeeded with zero logo repairs. Relative to Kind R8 it reduced recorded duration 41.2%, wall time 40.0%, model cost 19.7%, author requests 16.7%, and targeted inspections 33.3%. It completed after one shared CSS repair. This is a strong directional result, although one run is not a stochastic performance guarantee.

Decision: logo pixels and safe presentation derivatives are platform responsibilities. Logo composition remains author-owned. Keep V2 canonical and validate repeatability before making a broader performance claim.

## What shows promise

- Complete immutable source mirrors with compact inventories and local pull access.
- Ranked, provenance-bound source media with actual pixel inspection.
- Canonical platform-prepared logo revisions that preserve the original asset.
- Compact authoring guidance that describes outcomes and factual boundaries.
- Luna/high as the economical default author, with stronger models reserved for controlled diagnosis.
- Native semantic HTML interactions, once isolated behind equivalent verification and measured without changing the authoring profile.
- Better verified business evidence for copy: customer language, owner story, credentials, service method, response expectations, and real differentiators.

## What should remain rejected

- A visual-director or fixed-composition stage.
- Mandatory browser/reviewer/repair loops.
- Candidate generation tournaments as the default path.
- Separate headline or copy tournaments.
- Broad subjective findings promoted into hard release blockers.
- Prompt growth in response to isolated examples.
- Source sampling, cloned mirrors, or a separate route-planning agent.
- A V3 promotion based only on removing an architecture request.

## Recommended next evidence

Run a post-logo stability screen of the canonical generator, not another profile bake-off:

1. Freeze the current canonical profile, runtime, source revisions, prepared assets, model settings, fuse, deadline, and release gate.
2. Run three independent Kind initial builds and three independent Surge initial builds.
3. Record completion rate, model cost, wall time, request/tool/inspection counts, logo repairs, deterministic gate results, source-media choices, and blind visual review.
4. Treat infrastructure-invalid attempts separately and do not repair or tune between replicates.
5. Keep the canonical implementation unchanged unless the replicated evidence exposes a specific platform-input or hard-verification defect.

If that screen is stable, the next improvement should be richer verified business evidence or deterministic large-content materialization. Neither requires a second generator, a new orchestration stage, or more mandatory prompt machinery.

## Evidence limitations

- Several experiments were single-run diagnostics or retained-workspace edits; they establish mechanisms, not population-level reliability.
- Some comparisons used different artificial cost fuses and must not be read as direct production economics.
- Infrastructure failures, provider credit failures, and database transport failures were excluded from causal quality conclusions.
- Automated visual judges were advisory. Blinded order reversal, exact replay, deterministic gates, and human review were used to reduce—but cannot eliminate—subjective evaluation noise.

## V4 follow-on decision

The retrospective originally recommended six more unchanged V2 runs. Subsequent diagnosis found a more specific architecture conflict: V2's trusted navigation runtime also supplied presentation, while the prompt asked the author to create presentation around a component that a blank workspace did not contain. Forms had the related problem of exposing low-level composition primitives even though submission identity, revision, schema, and destination are platform-owned.

The follow-on V4 decision preserves the simplicity conclusion while moving the boundary:

- trusted runtime keeps only safety- and integrity-critical navigation and form behavior;
- editable, physically present recipes provide the opinionated starting implementation;
- the prompt explains ownership and precedence rather than trying to reproduce component code;
- the skill preserves existing workspace source unconditionally; and
- verification remains mechanism-neutral and objective.

This is a mechanistic correction, not evidence that V4 is stochastically better. The same-authority V2/V4 diagnostic and the three-Kind/three-Surge V4-plus-recipe reliability screen remain pending. No result should be appended here until the immutable run, candidate, deployment, and cost records exist.

## August 17 hosted V4 treatment and stop decision

Release `f35fcbd5bd172a9d3ed8ea84afb8bc91215730c3` deployed the hardened web, worker, and green sandbox path. The active pinned sandbox was `sandbox_deployment_a22339bcc8d459db43125cd29ae1837e`. A fresh Kind V4-plus-recipes run then completed through the ordinary hosted queue:

| Measure | Retained Kind R8 | Hosted V4 treatment |
| --- | ---: | ---: |
| Run | `run_c0d04e7292b84ae5981654959cafdc4a` | `run_b40b340df360410da0a3cc6cbc7a297f` |
| Candidate | `version_d3b5e0788105a9a4b3b510fc24ee02f6` | `version_5372861604b305aa17da8267beedb3ab` |
| Model route | Luna author + Luna architecture | Sol author + Luna architecture |
| Recorded duration | 953,724 ms | 1,640,298 ms |
| Estimated model cost | $0.13246954 | $3.25439530 |
| Author requests | 18 | 18 |
| `inspect_site` / `finish` | 3 / 1 | 3 / 1 |
| Routes / artifact files | 27 / 28 | 27 / 28 |
| Hard release gate | passed | passed |

The V4 run is conclusive infrastructure evidence. Each of its three source submissions succeeded on the same sandbox even after multi-minute browser-inspection gaps. There was no sandbox replay, recycle, submission timeout, or database failure. This directly closes the earlier failure in which the post-inspection `/apply` request was cancelled at the 30-second client deadline twice. The cause was the sandbox lifecycle configuration: the interactive authoring container was allowed to sleep during external browser work. `keepAlive: true`, explicit destruction, and the upgraded session handling now match the product workflow.

The authoring evidence is mixed. The final candidate preserved the prepared logo, used one explicit authored mobile trigger with no platform artwork, produced a custom responsive managed form, retained the customer portal, and passed navigation/form verification. It also needed one malformed-JSX repair and two finding-driven repair rounds before the third inspection passed. The final site is clean and coherent, but human side-by-side review does not show a clear visual win over R8; R8 remains more editorially distinctive.

The cost values are intentionally not treated as a causal V2/V4 comparison because the author models differ. Sol's price and context behavior dominate the nominal 24.6× difference. Even with that caveat, the treatment supplied no compensating quality result and exposed avoidable recipe-adaptation failures, so the adaptive screen stops at Kind and does not spend on Surge. V4 is not promoted and no current input is repointed.

The next valid experiment is one matched Kind run, not a broader cohort: use Luna for authoring, reuse the frozen retained Kind authority and architecture, keep the same V4 recipes and hard gate, and restore the predeclared $0.20 fuse. If that run cannot match or beat the lean-loop V2 evidence without a navigation/form repair loop, simplify the V4 guidance or recipe defaults before any Surge run. Do not move presentation back into the trusted runtime.
