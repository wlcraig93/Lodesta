# Expression V4 Experiment Results - 2026-07-08

## Scope

This run executed the next Expression V4 experiment phase after the infrastructure spike. It intentionally capped live spend to one V3 baseline run and made live V4 A/B conditional on the workbench bake-off.

Raw artifacts:

- Preflight corpus: `.data/benchmarks/expression-v4-auto-body-preflight.json`
- V3 baseline: `.data/benchmarks/expression-v4-v3-baseline.ndjson`
- Model smoke: `.data/expression-v4-bakeoff/model-smoke/report.json`
- Workbench bake-off: `.data/expression-v4-bakeoff/final/report.json`
- Eyeball board status: `.data/expression-v4-eyeball-board/README.md`

## Fixes Before Measurement

- Fixed `service_titles_duplicated` to detect duplicates within a single service-clarity section instead of flattening expected repeated service surfaces across the whole site.
- Strengthened generated-copy service title repair to dedupe semantic auto-body service equivalents before lint.
- Routed the optional copy editor output through the same canonical deck preparation path.
- Added vertical-aware benchmark preflight with `# auto_body` comment parsing and parked-domain rejection.
- Fixed the vector benchmark target-file parser to recognize `# auto_body` comments for future runs.
- Implemented async model-backed Expression V4 composer approaches behind the existing env-gated internal hook.

## Corpus

Final preflighted corpus: 7 targets, 7 passed, all inferred `auto_body`.

- `https://www.menciaautoshop.com/`
- `https://www.qualitybodyshopaustin.com/`
- `https://terrysbodyshop.com/`
- `https://www.autocraftbodywerks.com/`
- `https://www.protechbodyshop.com/`
- `https://www.hanceauto.com/`
- `https://www.spectrumautobody.com/`

## V3 Baseline

| Target | Status | Key Scores | Primary blockers |
| --- | --- | --- | --- |
| Mencia | blocked | visual 77, mobile 78, conversion 59, content 79 | media selection unavailable, conversion below gate |
| Quality Body Shop Austin | blocked, unscored | n/a | dirty extracted business name |
| Terry's Body Shop | blocked | visual 59, mobile 59, content 91 | media overflow, services missing |
| Autocraft Bodywerks | blocked | visual 59, mobile 59, conversion 84 | media overflow, services missing |
| Pro Tech Body Shop | blocked | visual 83, mobile 89, content 59 | placeholder/process copy, content below gate |
| Hance's Uptown Collision Center | blocked | visual 84, mobile 59, content 59 | mobile section fill, placeholder/process copy |
| Spectrum Auto Body | blocked | visual 59, mobile 36, accessibility 25 | contrast failure, broken image |

Fleet summary:

- Scored targets: 6 of 7.
- Same-vertical fingerprint min distance: 34, threshold 25, healthy.
- Copy overlap: 0.356, threshold 0.18, unhealthy.
- Duplicate service title blocker: not observed in the corrected baseline.

## Bake-Off

| Approach | Model-backed | Min distance | Avg nearest | Fallback rate | Anti-monotony issues | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `fixture_rotation_null` | no | 11 | 15.0 | 0 | 0 | null wins |
| `model_balanced_composition` | yes | 10 | 14.3 | 0 | 0 | failed null comparison |
| `model_service_proof_composition` | yes | 10 | 14.3 | 0 | 0 | failed null comparison |
| `model_best_of_3_distance` | yes | 10 | 14.7 | 0 | 0 | failed null comparison |

The model-backed composer is functioning: all model approaches produced schema-valid output with zero fallback and zero anti-monotony issues in the full bake-off. The model approaches did not beat the fixture-rotation null on either required distance metric.

## Gate Decision

Live V4 A/B was not run.

Reason: the workbench gate failed. A live A/B was conditional on a model-backed approach beating the fixture-rotation null while holding zero invariant violations and fallback rate under 10%. The model approaches met the invariant and fallback gates but failed the null-hypothesis comparison.

## Recommendation

Do not expand Expression V4 and do not spend the live V4 A/B run yet.

Next work should split into two tracks:

- Fix the V3 baseline blockers that are independent of V4: media overflow/selection, placeholder process copy, dirty identity extraction, contrast/broken image handling, and copy overlap.
- Iterate the model composer only on the workbench metric until a model-backed approach clearly beats `fixture_rotation_null`; then run the single live A/B.
