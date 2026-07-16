# Site Quality & Design Identity Implementation Report

Date: 2026-07-08

## Scope Implemented

- Replaced the old hard-coded identity path with `siteIdentityV1` and expanded `GeneratedSiteVerticalQualityProfileV1` into the canonical `VerticalProfileV1` registry.
- Deleted the separate auto-body premium palette module and routed compiler theme/chrome decisions through the profile-backed identity engine.
- Added `identityDistanceV1` beside unchanged `fingerprint-v1` reporting.
- Added visual-QA `identity_coherence` as a blocking high-confidence defect class.
- Added versioned auto-body copy phrase policy, prompt guidance, lint rejection, and one regeneration attempt with feedback.
- Tightened auto-body media floor: text overlays, collages, logo-like, low-resolution, blurry, and irrelevant media no longer beat the no-media floor for proof/gallery.
- Added approved asset-library fallback into V3 media selection when scraped media fails the floor.
- Added benchmark progress logging and per-target generation timeout wiring.
- Added one-shot Site Director validation retry with exact validator feedback and allowed asset ids.
- Added vertical-profile ratchet verification, pinned at 563 current vertical-condition matches outside verify/profile files.
- Kept Expression V4 parked; live runs reported `LODESTA_EXPRESSION_V4_INTERNAL` off.

## Local Verification

Passed:

- `npm run typecheck`
- `npm run verify:generated-site-v3-quality-profiles`
- `npm run verify:generated-site-v3-premium-palette`
- `npm run verify:generated-site-v3-contracts`
- `npm run verify:generation-quality-v2`
- `npm run verify:render-browser`
- `npm run verify:launch-boundaries`
- `npm run verify:vertical-profile-ratchet`
- `npm run verify:auto-body-quality-benchmark`

Latest local auto-body benchmark: all five fixtures `ready`, zero render failures, zero section failures, zero copy issues, zero blockers. Legacy whole-page fingerprint remains below its old threshold (`minPairwiseDistance: 22`, threshold `25`), which is expected because identity is now reported separately.

## Live Mencia Gate

The live Mencia single-target loop was used as the spend gate before any full corpus run.

Useful fixes confirmed live:

- Benchmark runner progress logging works; no more silent live runs.
- 5-minute timeout produced a controlled QA timeout record; 15-minute timeout allowed model visual QA to finish.
- `media_selection_unavailable` for `media_mosaic` was removed by mechanical downgrade to `media_feature`.
- Empty `case_study_preview` media slots were fixed by fail-open media fallback.
- Stricter media floor removed bad pasted social graphics and restored accessibility to 100 on the strict-media run.

Resolved live during iteration:

- Site Director validation failure from hallucinated `asset_reference_*` ids was cleared by the one-shot validation retry. Report showing failure before retry: `.data/benchmarks/site-quality-identity-mencia-asset-library-fallback.ndjson`. Report after retry: `.data/benchmarks/site-quality-identity-mencia-director-retry.ndjson`.

Current blocker:

- Mencia's scraped images are all text-overlay/collage/logo-like social graphics and are now correctly rejected by the media floor.
- The live asset library contains 53 approved `auto_services` assets and zero approved `auto_body` assets. Current policy only allows `auto_glass` family auto-service assets for auto-body, so Mencia falls back to text-only.
- Model visual QA currently blocks text-only auto-body pages as `broken_media`/generic identity even when text-only is intentional and safer than bad scraped media.

Best scored live run before that director validation failure:

- Candidate `sitecand_a8dff9c2055741b1a45eeb42943f6f37`
- Accessibility: `100`
- Mobile: `77`
- Correctness: `94`
- SEO: `100`
- Still blocked on model QA treating zero photography as broken media plus generic card-system identity.

## Recommendation

Do not run the full 7-target corpus yet. The infrastructure and local gates are in place, and Site Director validation is now hardened, but the single-target live gate still lacks approved auto-body fallback imagery.

Next action should be a narrow asset-library/content-policy pass: approve/generate a small `auto_body` fallback image set (`collision_body`, `paint_refinish`, `detail_texture`) or explicitly adjust model visual QA so the intentional no-media auto-body path is not reported as broken media. After Mencia produces a scored row without media/identity blockers, run the full corpus once.
