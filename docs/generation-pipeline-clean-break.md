# Canonical Generation Pipeline Clean Break

**Status:** In implementation

**Approved:** 2026-07-15

**Branch:** `codex/generation-pipeline-rebuild`

**Baseline:** `b4f0946`

This document supersedes `docs/generation-simplification-plan.md`. The product is pre-launch. The
cutover keeps no generator compatibility layer, migration shim, dual read/write path, or legacy
fallback.

## Product Contract

One URL produces one managed auto-body website through this path:

1. URL safety, crawl, render inspection, and public-presence lookup.
2. One Business Understanding model call, including bounded brand expression and evidence proposals.
3. Capped asset-vision calls.
4. Deterministic evidence verification, vertical-pack selection, design-system assignment, and one `GenerationPlan`.
5. One whole-site, slot-addressed `SiteCopy` model call.
6. One deterministic compile into strict `SiteVersionV3`.
7. One objective browser/render gate.
8. One multimodal final judge.
9. At most one regeneration. Copy revision reuses the plan; alternate-system revision creates one replacement plan. Any further failure is operator review.

Normal traces contain one plan, copy, compile, gate, and judge. The only legal second plan/copy/compile/gate/judge occurs within the single bounded regeneration.

## Canonical Contracts

- Source evidence is retained as semantic `SourceTextBlock` records with canonical tokens mapped to display offsets.
- Evidence is accepted only when proposal tokens occur contiguously in one retained block.
- Testimonials render only reconstructed source excerpts. Adjacent attribution must also verify.
- Credentials, insurance support, and longevity auto-render only deterministic positive normalizations. Ambiguous, former, expired, negated, or conditional claims require owner confirmation.
- Warranties, awards, and offers remain exact protected-preview text until owner confirmation.
- The evidence ledger records acceptance, rejection reason, and source-sparse classification.
- The auto-body `VerticalPack` supplies business semantics. It does not fork the generation pipeline.
- Exactly two design systems ship: `precision_shop_editorial` when first-party media clears the hero floor, and `trusted_local_service` otherwise.
- `GenerationPlan` contains only design-system choice, brand tokens, navigation, pages, template sections, media/evidence references, copy-slot specs, and form ID.
- `SiteCopy` contains only slot ID, value, and cited evidence IDs. Validation requires exact slot coverage and evidence allowlists.
- Every persisted intermediate carries producer version, model ID, input hashes, timestamp, and stale state.

## Judgment Contract

The objective gate owns only measurable failures: route/render failure, overflow, contrast, missing or broken media, placeholder/internal text, unsupported sensitive claims, required fact grounding, and basic SEO structure. It has no taste score.

The judge receives homepage desktop/mobile captures, desktop/mobile service-page contact sheets, and the complete rendered text manifest. Its discriminated result is:

- `ship` with action `none`
- `revise` with one available action: `copy`, `alternate_system`, or `operator_review`
- `operator_review` with action `operator_review`

An unavailable alternate system is never offered. Judge findings remain internal.

## Cutover Requirements

- The canonical entrypoint has one production generation path.
- Owner edits recompile the stored plan; edits that alter page/service structure use explicit regeneration.
- Legacy Site Director, planner manifests/constraints, compiler, copy deck, dossier, audits, phrase/service rewrite policies, brand-mark/wordmark generation, optimization findings, and V1/V2 site-version code are deleted with all callers, tests, scripts, routes, stored fields, and docs.
- The owner optimization action list is replaced by `ManagedSiteStatus`, derived only from publish state, objective QA state, and pending owner evidence confirmations.
- Places UI Kit failure falls back to a normal Maps link and records load, failure, fallback, and cost telemetry.
- Design review has one workbench and versioned captures; ad-hoc parallel review machinery is deleted.
- CI runs the architecture verifier and rejects vertical branching outside pack classification/registry/fixtures, deleted-module imports, noncanonical entrypoints, and illegal trace counts.

## Launch Gates

Four sanitized fixtures must pass the objective gate on first compile, reach ship in at most one regeneration, and pass human visual review without per-URL patches.

Twenty untuned auto-body URLs must achieve:

- 20/20 objective route and render pass on first compile
- at least 14/20 first-judge ship
- at least 18/20 final ship
- at most one whole-site copy schema retry
- zero unsupported public claims

Threshold failures are fixed in source ingestion, the shared templates, the vertical pack, or prompts. They are not fixed with URL-specific branches or a new grading system.

## Baseline Data

The read-only report is `npm run report:generation-stored-data`. At implementation start the environment contained no accepted candidates or production customers. All pre-cutover candidates and stored test versions must be deliberately deleted by the operator or regenerated canonically before the hard cutover; no backfill is built.
