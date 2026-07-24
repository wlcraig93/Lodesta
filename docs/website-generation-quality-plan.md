# Website generation quality plan

## Outcome

Improve first-generation local-business websites without owner intake by strengthening source ingestion, the authoring evidence packet, optional authoring-time inspection, deterministic release integrity, and calibrated measurement. Plumbing is the first pilot because it exercises emergency availability, service-area businesses, and noisy service-keyword ingestion; the platform changes are vertical-independent.

The plumbing context module is intentionally compact. It supplies terminology, a common-service normalization catalog, customer journeys, conversion guidance, and claim cautions. It is not a canonical list of every possible plumbing service, and source-backed specialty services remain eligible outside the catalog. Generic search-phrase and content-noise filtering stays in shared normalization.

## Phase 0 — stable measurement

- Recalibrate retained-artifact assessment before setting expectations for regenerated sites.
- Service-detail credit requires substantive, distinct service routes, not merely two declared paths.
- Image-alt credit requires descriptive retained browser evidence; non-empty filename, search phrase, or generic alt text is insufficient.
- Readability passes only with current browser evidence and no sub-16px body/control advisory. Sub-16px copy is a warning; visible text below 12px is also reported separately. There is no sample-shaped 14px scoring floor.
- Clipped managed content and visually empty controls reduce functional integrity. Orphan routes remain IA/SEO advisories unless another objective failure exists.
- LCP stays unknown without an independent field or lab measurement.

The baseline `B` is the median of nine completed runs: three sources regenerated three times with the assessment, scanner, model routing, run limits, and benchmark inputs held constant. At least one source must contain explicit visible service-area language so the accepting extraction path is exercised; alt-only or filename-only locality clues remain a negative case. Do not compare a historical score produced by a prior rubric identity with `B`.

## Phase 1 — deterministic platform quality

- Expose `inspect_site` to the manager as an optional authoring tool and retain invocation events.
- Block objectively clipped managed capability content and visible interactive controls with no visible label, icon, image, pseudo-content, or background affordance.
- Block body/control contrast only when the browser can establish opaque foreground text over an opaque solid background. Gradient, image, transparency, filter, opacity, and blend-mode cases remain outside that deterministic blocker.
- Keep a natural-loading homepage capture at desktop and mobile. Then settle scrolling and image decoding for complete full-page evidence.
- Warn on above-fold lazy images, weak image alt text, and desktop navigation hidden on mobile without a visible alternative.
- Support explicit `Asset` loading and fetch-priority hints through the public sanitizer allowlist.
- Add source-bound compact/weekly `BusinessHours` and a US-asserting local `BusinessAddress`.
- Rank retained source media and remove exact and perceptually near-identical images before authoring.

Phase 1 does not change generated-media guidance. Rebuild and deploy the sandbox image after the SDK changes, update the configured digest only from that deployed image, then run the benchmark against the new digest.

At the Phase 1 checkpoint, report completion rate, median duration, median model cost, overall and per-dimension scores, gated and non-gated weighted contributions, blocker/advisory counts, and `inspect_site` invocation rate. Pause before Phase 2 if more than one of nine runs fails to complete or median duration or model cost reaches 1.25× baseline.

## Phase 2 — ingestion and authoring behavior

- Build service routes from evidence-ranked normalized offerings, not positional source titles.
- Remove shared search/content noise such as “near me,” guides, tips, FAQs, and generic company labels.
- Require either a recognized source-backed catalog service or at least two first-party evidence blocks for an uncatalogued service.
- Pass compact structured `siteContext`, `serviceBriefs`, preserved source wording and block IDs, supplemental context, and explicit evidence gaps to the author.
- Extract service areas only from visible first-party service-area language; URL paths, filenames, and image alt text are discovery clues, never sufficient public evidence.
- Surface emergency plumbing only when emergency language and continuous availability are both directly supported.
- Require descriptive business-name metadata, navigable mobile IA, substantive distinct service copy, source-bound hours/address components, and appropriate hero loading hints in authoring guidance.
- Prefer credible source photography. When it cannot fill a supporting visual role, generated imagery may be used under `docs/media-authoring-policy.md`; it must remain generic and cannot imply business ownership, personnel, vehicles, jobs, facilities, credentials, licensing, or insurance.

Rebuild and deploy the sandbox image again if Phase 2 changes any sandbox source after the Phase 1 image was built.

## Benchmark acceptance

Use `npm run summarize:generation-quality-benchmark -- path/to/benchmark-runs.json`.

The input is `{ benchmarkId, expectedRunsPerPhase, runs }`. Each run records `id`, `sourceKey`, `phase` (`baseline`, `phase1`, or `phase2`), `status`, `durationMs`, `estimatedCostUsd`, `inspectionInvoked`, and, for a completed run, `assessment: { score, dimensions }`. `dimensions` maps the canonical assessment dimension IDs to their normalized 0–100 scores.

The report separates:

- gated dimensions: functional integrity and automated accessibility;
- Phase 2 value dimensions: discoverability, local content, and conversion;
- all remaining dimensions; and
- inspected vs uninspected runs, marked directional when either cell has fewer than three runs.

Accept Phase 2 only when:

1. median overall score is at least `B + 15`;
2. the weighted contribution from discoverability, local content, and conversion improves by at least six points;
3. no assessed dimension regresses by more than two weighted contribution points, calculated as `dimension score × dimension weight ÷ 100`; and
4. the valid blocker thresholds, assessor, scanner, model routing, and run limits have not been weakened to obtain the result.

If the result misses the target, analyze completion, cost, inspection use, findings, and per-dimension deltas. Do not adjust the assessor after seeing the result.

Trust is intentionally constrained by available evidence. The next material score increase after this work requires owner intake or a separate truthful proof-acquisition workflow.
