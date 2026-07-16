# Expression V4 Log

## 2026-07-07

Implementation completed for the internal Expression V4 spike.

Phase 0 cleanup:

- Tightened media-floor fallback in `lib/generated-site-v3-director-manifest.ts` so floor-failing media does not re-enter candidates through analysis `recommendedUses`.
- Updated scorecard finding attribution in `lib/generation-scorecard.ts` so a single finding maps to one primary dimension.
- Extended `fingerprint-v1` to include Expression V4 primitive skeleton, foreground, mobile order, and composition tokens.

Spike and render target:

- Added reserved `templateId: "expression_composition"` to `VisualSectionV3`.
- Added bounded primitive schema in `lib/expression-v4-schema.ts`.
- Rendered through `SiteRendererV3`; no public route exposure.
- Reused existing V3 slots so fact coverage, markdown extraction, copy lint, and scorecard inputs can see the content.
- Added public-route gates for HTML, markdown, LLMS, robots, sitemap, and platform sitemap.
- Added an internal live-generator hook, enabled only with `LODESTA_EXPRESSION_V4_INTERNAL=1`, scoped to `auto_body`, defaulting to `anti_monotony_rewrite`.

Verification:

- `npm run typecheck`: passed.
- `npm run verify:expression-v4`: passed, including the env-gated internal generator hook.
- `npm run expression-v4:bakeoff -- --artifact-root .data/expression-v4-bakeoff/latest`: passed.
- `npm run expression-v4:workbench -- --artifact-root .data/expression-v4-workbench/latest-fixed`: passed outside the sandbox because Chromium launch is blocked by macOS Mach port permissions inside the sandbox.

Bake-off result:

- Budget: 4 approaches x 16 shells; best-of arm capped at 3 samples.
- Recommended approach: `anti_monotony_rewrite`.
- `anti_monotony_rewrite`: min same-vertical fingerprint distance 11, average nearest distance 15, zero anti-monotony issues.
- `best_of_3_distance`: tied the same distance numbers but cost 3 samples and did not improve the metric, so it is not worth carrying forward.
- `vertical_directive_mix`: rejected for zero minimum distance in this fixture set.

Workbench result:

- Three hand-authored proposals rendered across desktop/tablet/mobile.
- Final report: `.data/expression-v4-workbench/latest-fixed/report.json`.
- Result: ok, zero failing proposals.
- Min pairwise spike fingerprint distance: 13.
- Fact coverage extraction: non-zero and surfaced for all three proposals.
- Scorecard dimensions: populated for all three proposals.

Live benchmark notes:

- Default Austin auto run with `LODESTA_EXPRESSION_V4_INTERNAL=1` wrote `.data/benchmarks/expression-v4-latest.ndjson`.
- That default set did not produce a V4 signal: both targets classified as `auto_services`, while the V4 hook is intentionally scoped to `auto_body`.
- Mencia one-target run with the same env wrote `.data/benchmarks/expression-v4-mencia.ndjson`.
- Mencia classified as `auto_body` and the persisted candidate `sitecand_8decdfbe871f4dcb82d1c27351ccfdf2` contains an inserted `expression.v4` section after the hero.
- Mencia remained `blocked` because of duplicate service titles and correctness/content quality gates. Visual design 84, mobile 89, conversion 100, accessibility 100; correctness/content/SEO scored 59. This is not a V4 renderer failure, but it means the live A/B gate is not passed.

Phase 7 recommendation:

Proceed only with the `anti_monotony_rewrite` path, but do not expand V4 yet. The spike/workbench is strong enough to keep iterating, and the live Mencia run proves the generator hook works, but the live hard gates are not met because upstream copy/service clarity still blocks the candidate. Do not use best-of-3 yet; it tied the deterministic approach while tripling sample cost.
