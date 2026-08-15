# Native Runtime and Authoring Decoupling

Date: 2026-08-14
Status: implemented; corrected fair Kind rerun complete; V2 remains canonical

## Decision

Lodesta retains one proven authoring stack: the baseline release-candidate prompt, task skill, architecture preparation, retained-source index, evidence packaging, and release verification workflow. Trusted runtime selection controls only the runtime, SDK/compiler surface, and runtime-specific verification contract. It does not select a prompt, skill, information-architecture strategy, evidence profile, or raw source inventory.

The profile-free Static Authoring V3 treatment is rejected. Its direct 376-page inventory, five-bullet skill, special system prompt, and architecture-call bypass are removed. The failed Kind output remains diagnostic evidence and is not promoted or repaired automatically.

V3 retains the independently useful changes:

- Native semantic HTML/CSS interaction without authored client JavaScript or hydration.
- The narrowed SDK for canonical business data and assets, safe destinations, directions, and managed forms.
- Trusted runtime behavior limited to managed form submission and telemetry.
- Safe `dialog`, Popover, and responsive-image authoring support.
- Mechanism-neutral browser verification for native and retained managed navigation.
- Exact retained V1 and V2 runtime bytes and immutable artifacts.

The canonical baseline skill changes only its navigation guidance: navigation must use native semantic HTML/CSS, remain operable without authored JavaScript, expose required destinations at every breakpoint, support keyboard and Escape behavior, and leave focus and the page usable after closing. It does not prescribe Popover, `details`, header geometry, or a component implementation.

## Retired execution paths

The Kernel-A checkpoint runner, final paired-promotion checker, and their package commands are removed. Their decision records and evidence remain historical. No new authoring profile or runtime series is created for this decoupling.

## Evaluation

Run one Kind Pest full-site candidate through the V3 runtime using `baseline-release-candidate-v1`, the normal architecture call, the prepared retained-source index, and the baseline evidence profile. Compare it with retained Kind R8. The comparison is diagnostic and owner-reviewed; it does not silently activate V3.

The isolated run completed on 2026-08-14:

| Measure | Retained Kind R8 | Isolated native V3 |
| --- | ---: | ---: |
| Run | `run_c0d04e7292b84ae5981654959cafdc4a` | `run_ae281547e82241b3a59e42ff59184897` |
| Candidate | `version_d3b5e0788105a9a4b3b510fc24ee02f6` | `version_92baf42b625f80981f0c6df9b6b84f8b` |
| Status | succeeded | succeeded |
| Recorded duration | 953,724 ms | 714,776 ms |
| Model cost | $0.13247 | $0.15759 |
| Successful author tools | 9 | 21 |
| Model requests | 19 | 32 |
| Routes | 28 | 28 |

The treatment was about 25.1% faster, but cost about 19.0% more, used 2.3 times as many successful author tools, and used 68.4% more model requests. It restored launch readiness and coherent source-grounded design, but did not establish an operational improvement over the retained baseline.

The first V3 inspection also exposed a verifier defect. Mechanism-neutral navigation reachability proved that all seven mobile destinations were reachable through a native `details` menu, while the legacy `render.mobile_navigation` metric simultaneously reported that no toggle existed because the links were not wrapped in a nested `nav` landmark. The author responded by adding an always-visible mobile quick-link grid. That grid was a verifier workaround, not an authored-JavaScript or native-HTML limitation.

The gate now recognizes a visible `details > summary` whose disclosure contains primary links. The separate missing-menu assertion remains a hard failure when desktop navigation is hidden without a real mobile control. A diagnostic replay of the finalized source with only the quick-link workaround removed passed the corrected four-route browser gate with no errors: all seven destinations were reachable on desktop, tablet, and mobile, including the opened-menu captures. The diagnostic source is not a replacement candidate and does not rewrite the immutable retained result.

## Disposition

Keep V2 canonical. Retain V3 runtime, SDK, native HTML, and verifier changes as an independently usable implementation, but do not activate V3 from these single-business diagnostics.

## Corrected fair rerun

A second isolated Kind run removed the architecture-cache confound by atomically attaching the exact validated R8 architecture plan before enqueue. The architecture and inventory hashes matched the control and the treatment made no architecture model request.

| Measure | Retained Kind R8 | Fair native V3 |
| --- | ---: | ---: |
| Run | `run_c0d04e7292b84ae5981654959cafdc4a` | `run_8ced56617508451ea177639c8478e664` |
| Candidate | `version_d3b5e0788105a9a4b3b510fc24ee02f6` | `version_cff5036902a12f7597691d0114318507` |
| Recorded status | succeeded | succeeded |
| Recorded duration | 953,724 ms | 896,277 ms |
| Total model cost | $0.13247 | $0.17895 |
| Architecture requests | 1 | 0 |
| Author requests | 18 | 32 |
| Successful author tools | 9 | 21 |

The fair V3 run was 6.0% faster but cost 35.1% more in total. With architecture excluded from both arms, its author phase cost 56.8% more and used 77.8% more requests. Native navigation itself no longer generated a repair loop: the author used `details` from the first build and the corrected reachability gate reported no missing-navigation failure. The extra turns came from repeated contrast/logo-clipping repairs and from canonical-link and About-route geometry failures first exposed by all-route finish verification.

Visual replay found that the final mobile navigation trigger was functional but visually blank: its authored bars referenced an undefined CSS custom property. The old gate counted its 44px box and accessible label as a visible toggle. The mechanism-neutral gate now requires visible text or painted icon artwork and reports a blank control as the blocking `render.mobile_navigation_trigger` finding. The immutable candidate is therefore not launch-ready under the corrected policy and is not promoted.
