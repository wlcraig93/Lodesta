# Minimal trusted site kernel decision record

> Superseded on 2026-08-14 for go-forward execution. The Kernel-A checkpoint and final paired-promotion protocol were retired after the owner selected one canonical baseline authoring stack plus an isolated native-runtime comparison. This record and its evidence remain historical; it no longer gates canonical runtime selection.

Date: 2026-08-13

## Frozen control

The control was frozen before the author-visible SDK, prompt inventory, or canonical task skill changed.

| Identity | Frozen value |
| --- | --- |
| Git commit | `385976445dc19ccc903de50b07b938441d80fbcc` |
| Active sandbox deployment | `sandbox_deployment_d5d921b1664b8a9348212f779403a02c` |
| Active sandbox image digest | `sha256:e10d26a92951f2e320d898122942307a15ae849dd1a2d8b65c0c42da286299a1` |
| Sandbox toolchain | `lodesta-static-site-workspace@sha256:e295566df74af4e5f8cd795e9c81deff0843f0b4de64608f899484b5ed9d0fa0` |
| Website manager prompt | `website-manager@sha256:efd7284ec64868146361c4179f51e0f017ae5d38b415db05a20a52c92d4a1ea7` |
| Selected task skill | `website-authoring@sha256:f2963766e7dd0dd420f10f5b4e4b4a6b630c622746fad0c6e8036bcd48122376` |
| Selected profile | `baseline-release-candidate-v1` |
| V1 runtime patch | `runtime_patch_6d89f0ff1c26418ba54df90451a5d52b` |
| V1 runtime content | `sha256:cc93378b493069e5e3ed99688ec3c074c89951921183e59a77a70f1f8579c1d2` |
| Fixed fixture | `kind-pest-control-v1` |
| Profile-resolved template | `sha256:7dc1cbb2f21ac45c66630afdc45985dc0fb78ee75dfc4ee9bba3bea8837634f0` |

The fixture template hash is the deterministic hash of the frozen prompt identity, selected compact-pull system-prompt hash, task-skill identity, profile ID, and complete V1 SDK inventory. A checkpoint comparison is valid only when control and treatment report this same hash.

## Implemented candidate identities

| Identity | Candidate value |
| --- | --- |
| V2 runtime content | `sha256:30a28bccf8bec61bb1b1cc3a7d92171693039308df62d494386a009f341dead0` |
| V2 sandbox toolchain | `lodesta-static-site-workspace@sha256:dcb0bd2c8652be472d82b93c555a9596a4a086169eeb982f1b12c2b5e6f71357` |
| Final-kernel manager prompt | `website-manager@sha256:2e9d276949d0bcc83ac04855f98db9ef49fcef1176c792c6b47fced3b5908fae` |
| Current final-candidate task skill | `website-authoring@sha256:9c3f180908012fb375b751c3926ecb7c90efcdfaa0c2f660123a05b55876bbf5` |

These identify the candidate implementation only. They are not a promotion record.

## Findings ledger

| Finding | Status | Disposition |
| --- | --- | --- |
| Modal geometry uses `!important`, preventing normal authored overrides. | proven | Removed from geometry; `[hidden]` remains the sole `display: none !important` rule. |
| An opened modal can retain scroll lock and `inert` after its authored breakpoint hides the navigation. | proven | Close from the existing resize handler when the trigger or panel is no longer rendered. |
| Workflow verification selects a global V1 runtime rather than the immutable build-input series. | proven | Runtime selection derives from `capabilityConfiguration.trustedRuntimeSeries`. |
| Browser verification reads a source file instead of the retained audited patch. | proven | Candidate verification receives and verifies the retained patch bytes. |
| Fast preview may inject V1 independently of the session build input. | proven | Preview resolves the session build input and its audited runtime series or fails loudly. |
| `ManagedMap` is required for trustworthy location presentation. | rejected | Canonical address, hours, and a headless directions action are sufficient; presentation is authored markup and CSS. |
| Generated workspaces require managed gallery JavaScript. | unproven | Interactive galleries are deferred; static semantic markup and CSS remain available. |
| Ordinary disclosure requires SDK JavaScript. | rejected | Native `<details>` provides the required behavior. |
| Outside-pointer close is required for navigation. | unproven | Not added without an observed defect. |
| V1 artifact enum values can be removed without retained-data review. | obsolete | V1 reader values remain until the stored-data report proves removal safe; V2 does not emit them. |

The retained-data report ran successfully against 327 sites and 363 retained workspace revisions. It found 224 retained artifacts with legacy bindings: 1,309 `disclosure` bindings and 165 `map` bindings. It also found all 327 retained intents carrying the historical `gallery` and `disclosure` capability values. The V1 `map`, `gallery`, and `disclosure` reader values and historical intent enum values therefore remain, while V2 emits none of them. It found zero retained workspace revisions using reserved kernel-binding attributes directly, so the new source assertion requires no workspace rewrite or backfill.

## Promotion state

Implementation and deterministic verification do not substitute for the predeclared blinded Kernel-A and final-candidate comparisons. Runtime or authoring promotion remains blocked until their recorded acceptance criteria and owner review are complete. V1 bytes and finalized V1 artifacts remain immutable regardless of the outcome.

`npm run check:kernel-a-checkpoint -- <result.json>` enforces the frozen template hash, paired evidence/model identities, two-replicate hard-gate floor, launch readiness, and no-clear-regression rule. `npm run check:final-kernel-candidate -- <result.json>` enforces the three-business desktop/mobile promotion rule and requires recorded independent adjudication plus owner approval. The temporary Kernel-A checker and the remaining profile/experiment dispatch are removed only after those gates select the canonical outcome.
