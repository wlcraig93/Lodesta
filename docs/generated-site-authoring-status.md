# Generated-site authoring status

Date: 2026-08-20

## V4 implementation status

The repository now contains the recipe-free V4 canonical-runtime candidate: presentation-free managed navigation, the narrowed managed-form SDK, structurally materialized owner-authoritative destinations, and direct business-specific authoring from the minimal workspace. The four visual recipe files and their provenance machinery have been removed from new authoring so their value can be evaluated separately rather than bundled into the V4 boundary. New-authoring code targets `site-runtime-v4`; V1-V3 remain only where immutable retained artifacts require their original rendering bytes.

The V4-capable application and bounded-inspection controller are now deployed and verified at release `757dcc93f4057acee34f450cdffd5d62a44992ee`. The active green sandbox deployment is `sandbox_deployment_dde819809d5f79faf6eeb630b4d75905`. This is infrastructure and pinned-canary evidence, not a V4 product promotion: current public inputs have not been repointed and the retained V2 baseline below remains the product rollback point.

The first fresh hosted Kind V4-plus-recipes treatment completed end to end and passed the hard release gate, but it did not establish superiority over the retained canonical baseline. Surge was intentionally not started. See "First hosted V4 treatment" below.

## First hosted V4 treatment

The first post-hardening Kind treatment used the ordinary hosted queue and worker, the active green sandbox deployment, materialized V4 recipes, and the complete retained Kind authority:

- run: `run_b40b340df360410da0a3cc6cbc7a297f`;
- candidate: `version_5372861604b305aa17da8267beedb3ab`;
- workspace: `workspace_revision_78657f24ad853d5131d41dd284627fe9`;
- artifact: `artifact_2aab60a67deffdf51a9de6d295db5f8d`;
- result: succeeded, 27 routes, 28 artifact files, 13 browser-checked routes, 748 checked links, 30 retained captures, and hard gate passed;
- usage: 18 author requests, three `inspect_site` calls plus `finish`, 1,640,298 ms recorded duration, and $3.25439530 estimated model cost; and
- model route: Sol for the author and Luna for architecture.

All four recipe files were present in the retained final source with their expected IDs, versions, and provenance headers. The managed custom form, authored mobile trigger, opened navigation, Escape/focus behavior, retained customer-portal destination, and managed submission contract passed final verification. Three source applies succeeded against one long-lived sandbox after multi-minute inspection gaps, with no replay, recycle, or transport timeout. That single run showed the lifecycle could succeed; it did not validate `keepAlive` as the cause or establish continuity reliability.

The authoring result is not a promotion result. The first source write contained malformed JSX and required repair. The first inspection found unsupported guarantee copy and shared contrast failures. The second found a missing customer-portal destination and low-contrast navigation/form actions. The third inspection passed. Final human review found a clean, restrained, correctly branded site and a sound custom form, but the retained Kind R8 homepage remained more distinctive and editorially composed.

The $3.25440 result must not be read as a direct 24.6× regression against Kind R8's $0.13247 because R8 used Luna and the treatment used Sol. It is still operationally material, and the treatment did not supply enough visual benefit to justify continuing to Surge.

The matched Luna comparison subsequently ran as `run_06d873d5f8be4a66bc81610a0e2cd441`, reusing R8's exact architecture plan and source-inventory hashes with the original $0.20 fuse. It produced candidate `version_aa85b7fd5505644326235b05c98a7489`, passed the hard gate, used 16 author requests, recorded $0.09015719 of model cost, and took 1,417,501 ms. Because two sandbox recycles changed the request path, this infrastructure-invalid run cannot establish V4 economics. Current matched cost is unknown. The observed duration was 48.6% above R8 and 152.8% above lean-loop V2.

The run is infrastructure-invalid. Its first 7:45 inspection was followed by an exact 60-second sandbox transport timeout and recycle. Its second inspection reached the eight-minute recoverable ceiling; the following apply repeated the exact 60-second timeout and recycle. In both cases the identical source applied in about 13 seconds on the replacement sandbox, proving that source, build, and database state were not the cause. The run also repeated the missing retained customer-portal destination seen in the Sol treatment before repairing it.

Human review found the matched V4 site visually strong, with cleaner logo scale, responsive composition, and a good custom managed form, but not a clear win over R8's more distinctive editorial treatment. Its final artifact retained more advisory copy, identity-device, orphan-route, and target-size findings than the independently replayed R8 reference. Surge remains paused. V4 remains a candidate rather than the canonical product generator.

## Sandbox diagnosis and corrective change

A zero-model synthetic reproduction separated lifecycle behavior from authoring variance. The exact 60-second signature is Lodesta's two 30-second submission attempts, not a Cloudflare idle threshold. Under six simultaneous synthetic sessions, one six-minute case failed with the provider message `The sandbox container stopped while the operation was pending`, while independent 7:45 and nine-minute cases succeeded on unchanged placements. The sandbox deployment permits five simultaneous instances, so the six-session case also exposed a real capacity mismatch: `keepAlive: true` prevented abandoned instances from ever releasing their slot.

The correction restores `sleepAfter: "15m"` with `keepAlive: false`. Fifteen minutes remains above the complete eight-minute inspection ceiling, while abandoned sessions scale down and ordinary terminal paths still destroy their instance explicitly. Cloudflare host replacement remains inherently irregular, so the existing deterministic full-source recycle remains the trusted recovery boundary; a recovered provider replacement is infrastructure telemetry, not evidence that generated source was invalid.

The initial mobile-navigation recipe now also renders a generated `src/required-destinations.tsx` file containing exact owner-authoritative customer-portal `SafeLink` IDs. Bootstrap validation rejects a missing or incorrect required destination before model cost. This turns the repeated portal omission from a prompt-memory task into editable starting source without restoring owner edits on later runs.

## Post-correction matched Kind rerun

A deployed zero-model checkpoint first held one idle and one preview-active sandbox for nine minutes, then applied identical source on the original placements in 5.9 seconds each with one submission attempt and no replay, timeout, or recycle. The exact matched Kind arm then ran through the ordinary hosted worker as `run_1a5297751c184afebe285a1a5f340632`, using Luna, the original $0.20 fuse, R8's exact architecture plan and inventory hashes, and a fresh blank V4 workspace.

The run produced `version_2997b072edc74a235564ed5efc60ebac`, passed the hard gate, used 12 model requests, recorded $0.08661646, and took 1,159,342 ms. All four recipe files survived in retained source. The navigation rendered the structurally seeded `link_3` customer portal, and the contact page used a custom four-field `LeadField` layout through the narrowed managed-form SDK.

This is still not an infrastructure-valid comparison. The first inspection completed in 441,666 ms: 15,808 ms of build, 141,919 ms of all-route mechanical verification, and 283,832 ms of separate model-facing visual inspection. The following CSS repair then hit the same exact 60-second sandbox transport failure and recycled once; the identical source built on the replacement in 12,341 ms. The second inspection reached the 480-second recoverable ceiling. The deterministic `finish` gate still passed.

The rerun disproves the claim that the bounded lifecycle alone fixed continuity. It also identifies the dominant avoidable delay: `inspect_site` performs an all-route mechanical/browser pass and then a second all-representative visual pass across 14 routes, while `finish` remains the authoritative full gate. The go-forward loop therefore retains the all-route mechanical evidence, limits the separate model-facing visual pass to four representative routes, and leaves `finish` unchanged. This removes the obsolete all-representative authoring-profile switch rather than adding retries or orchestration.

Human comparison again does not show V4 beating R8. V4 has a clearer logo, structurally correct portal, and sound custom form, but R8 has stronger hierarchy and conversion pacing; V4's taller mobile header and contact introduction push the form materially lower. The V4 artifact retained 41 advisory findings versus the historical R8 artifact's 91 informational findings and no warnings. Surge remains paused pending a clean bounded-visual Kind rerun.

## Bounded-visual Kind result and Cloudflare root cause

The bounded-visual rerun used the same frozen Kind architecture and inventory, Luna, V4 recipes, and $0.20 fuse as `run_2ad38b8e310849e68cfe4593a23b55b3`. It produced `version_2a53d1b26ed01b41ccb7445a0763bbc5`, passed the hard gate, retained all four recipes plus the structurally seeded `link_3` customer portal, and used the narrowed SDK for a custom four-field form. It recorded $0.12196158, 1,330,676 ms, 17 model requests, and four `inspect_site` calls plus `finish`.

The inspection simplification worked as designed. The model-facing visual phase fell from 283,832 ms to 81–82 seconds per pass; complete inspections were 309,752 ms for the recovered first build and 237–244 seconds thereafter. The all-route mechanical pass remained 143–149 seconds, and `finish` remained the unchanged authoritative gate. The run nevertheless produced 56 advisory warnings, four repair inspections, an unreachable duplicate footer return in retained source, and no clear visual superiority over R8. R8 remains the canonical product generator and Surge remains paused.

The run reproduced the infrastructure fault before the first mechanical or visual pass. Both 30-second `/apply` attempts reached the active Cloudflare Worker with a 545,495-byte request and ended as `outcome: "canceled"` after about 29.9 seconds with only 6 ms of Worker CPU. No candidate build reached the original container. The deterministic recycle then built the identical source in 11.8 seconds and all later applies succeeded on that replacement.

Cloudflare's runtime logs exposed two concrete defects in the deployed sandbox bridge: the Worker SDK reported `0.12.7` while the base container reported `0.12.3`, and returned process RPC stubs were repeatedly left undisposed. The next sandbox release aligns both sides at `0.12.7`, explicitly disposes every returned process handle, and makes exact SDK/image version equality a preflight invariant. This is a platform correction, not an authoring or V4 promotion result.

A post-release, no-model reproduction then used the retained 517,111-byte V4 workspace and the exact 465-second idle interval. The first apply completed in 14.8 seconds without retry, but the second found the container filesystem absent. Inspection of SDK `0.12.7` showed that `getSandbox` dispatches lifecycle configuration without awaiting its Durable Object RPC. The Worker now explicitly awaits the 15-minute sleep policy before every container filesystem operation; another deterministic reproduction is required before paid authoring resumes.

## Matched A Step Above R8/V4 bake-off

The next matched comparison used A Step Above Pest Control & Termite with direct Luna authoring, the same retained source inventory (`sha256:6e1f8a0b79154e3166fda3897377a48d40e6689f9dee113a8686feedb9a06a1b`), the same frozen architecture plan (`sha256:abb0fcfb9d52fcee3f0c6c292a442d495b07de5576496064eb21ba60c82230be`), the same exact logo (`sha256:68a91133ee8b24c0bb5fc73fe1fb50363f7e81eaf17f2be2683fea5ffad10e91`), and a $0.50 private-canary ceiling for both arms.

The first R8 attempts did not fail because of the old $0.20 fuse. Two approved retained blog paths ended their final slug with `-`. The shared sandbox route validator used a nested regular expression that catastrophically backtracked on those long paths, pinning one CPU core while the operation journal remained in `compiling` until the 210-second controller deadline. The exact reconstructed R8 source reproduced the wedge locally. Replacing that expression with linear segment validation, while intentionally accepting retained trailing-hyphen URLs, reduced the same local build to 1.6 seconds. The regression is covered in `verify:site-sandbox-local`.

After that shared compiler correction, both arms completed without sandbox replay, recycle, or transport failure:

| Arm | Run | Result | Cost | Duration | Model requests | Applies / inspection cycles |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| R8-era control / V2 runtime | `run_6064fa0ebd254ec7b4dc331875c6a259` | hard gate passed; 48 routes; 38 captures | $0.16727261 | 27m 39.5s | 23 | 4 |
| V4 plus editable recipes | `run_05fc4abae9cd411e8e4b2612f9d907a0` | hard gate passed; 48 routes; 38 captures | $0.34897914 | 36m 37.3s | 51 | 8 |

V4 cost 108.6% more, took 32.4% longer, used 121.7% more model requests, and made 21 targeted edits versus R8's five. Its first `finish` attempt failed with 34 hard errors: the authored mobile menu created 47px of horizontal overflow, causing navigation-toggle failures across 13 sampled routes. V4 repaired the overflow and eventually passed, but only after another inspection and finish cycle. All four V4 recipe files and their provenance headers survived in the retained final workspace.

Human review does not show a compensating quality win. R8 produced the stronger editorial composition: a bold split hero, better conversion pacing, a correctly legible primary logo surface, and a coherent photo-led identity. V4's desktop and custom managed form are competent, but the mobile menu dominates the top of the viewport, pushes the primary headline below the fold in the retained capture, and still places the pale supplied logo on a low-contrast light surface. Across the same retained capture count, V4 also retained 123 advisory warning instances versus R8's 78, including 35 primary-logo surface-contrast warnings, 18 text-occlusion warnings, and 20 target-size warnings.

This single matched business does not establish broad cross-business template similarity, but it is sufficient to reject the V4-plus-recipes treatment for promotion. It does not reject V4's headless runtime or narrowed managed-form boundary. R8/V2 remains the canonical product generator while a recipe-free V4 arm is evaluated. Surge and the wider screen remain paused.

## Recipe-free V4 isolation

The next matched arm isolates the architectural change from the unproven visual defaults. It retains V4's audited navigation state machine without platform artwork or geometry, the required explicit trigger, the narrowed managed-form SDK, exact materialized customer destinations, the compact authoring skill, mechanical inspection feedback, and the unchanged hard release gate. It removes the four mobile-navigation and managed-form recipe files, recipe provenance classification, recipe-specific prompt context, and recipe preservation tests.

The model now authors the visual system, shared shell, navigation, and form layout directly for the business. Lodesta's mobile-navigation preference remains outcome guidance: a contained full-screen menu is the usual starting point, not a fixed component. A different managed or verified native semantic pattern remains valid when the business, design direction, or owner request warrants it.

The complete local release preflight passed before deployment, including production build, TypeScript, authoring and narrowed-SDK contracts, immutable generations, sandbox replay/recovery, trusted-runtime behavior, and desktop/tablet/mobile/opened-navigation browser verification. The hosted A Step Above arm remains pending. Promotion remains blocked, and recipes may be reconsidered only as a later isolated treatment after recipe-free V4 is at least comparable to the R8 control.

## Deployed rollback baseline

The prior deployed generator is pinned to the following tuple:

- authoring profile: `canonical` (the single executable profile, preserving the proven baseline behavior);
- architecture and author model: direct OpenAI `gpt-5.6-luna` at high reasoning by default;
- trusted runtime: `site-runtime-v2`;
- source strategy: retained mirror plus validated architecture and pull-based source index; and
- identity strategy: one platform-prepared canonical logo asset.

Owner onboarding and retained-mirror canaries use this same profile and runtime.
The canary may override only the model for a controlled operator comparison. Historical
experiment profile IDs remain readable in retained run provenance, but the live workflow
rejects them and the product UI no longer exposes a generator selector.

The canonical initial-build workflow is:

1. prepare and retain the complete replayable website mirror and canonical source-path inventory before any model or authoring deadline starts, reusing an existing retained mirror when available;
2. run one Luna High architecture request over every canonical source path;
3. mechanically validate an explicit live-route list and one disposition per source path;
4. give a Luna High workspace author a compact eight-item quality skill, a readable route-to-source index, complete pull-based retained-source access, four source and two canonical-asset visual references packaged as compact contact sheets, canonical business context, and authoring tools;
5. let that author inspect the rendered site through the local browser, with representative coverage spanning every page type in the approved architecture;
6. statically compile and mechanically verify the complete route set, then independently browser-check structural representatives on desktop, tablet, mobile, and opened-navigation states; and
7. retain the candidate-bound coverage and migration ledger for owner review.

The architecture model owns substantive route, consolidation, redirect, and retirement
judgments. The workspace author owns final copy, visual direction, source-media selection,
responsive composition, and code. Deterministic code checks bookkeeping and hard release
integrity only. There is no service catalog,
numeric page target, vertical authoring module, critic, tournament, automatic repair
continuation, or subjective publication gate.

This baseline was promoted after private retained-mirror canaries for Kind Pest and
Surge Pest completed through the ordinary queue and browser gate with the exact same
authoring skill identity. The matched prior baseline failed the Kind canary at the
historical $0.20 cap. Luna private canaries now use a $0.50 cap so an otherwise
healthy authoring run can complete long enough for a head-to-head comparison. This
operator-only canary ceiling does not change ordinary initial-build, edit, or rebase
guardrails. Candidate artifacts remain private until an owner publishes them.

The approved product decision, scope exception, and Kind Pest evidence are in
`docs/decisions/2026-08-03-luna-architecture-authoring-workflow.md`.

## Editing baseline

Owner edits and deterministic rebases do not rerun site architecture. They operate on
the current retained workspace and preserve unrelated presentation and content. All
authoring paths continue to share the same immutable artifact, trusted runtime,
candidate integrity, and owner-controlled publication boundaries.

## Historical records

Prior Sol, visual-reference, planner, and bakeoff experiments remain calibration
evidence only. They are not live authoring instructions.
