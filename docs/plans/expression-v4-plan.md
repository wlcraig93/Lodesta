# Expression V4 Plan: Generative Composition Behind Deterministic Validation

Canonical handoff document for the implementing agent. Supersedes the Track 2 section of `docs/plans/generation-quality-master-plan.md` (Track 1 — rights-free generation — is implemented and verified as of 2026-07-07; see "Inherited state" below).

Implementation status as of 2026-07-07: the first full Expression V4 spike is implemented as a reserved `VisualSectionV3` member, `templateId: "expression_composition"`, rendered through `SiteRendererV3` and guarded from public `/sites/*` surfaces. See `docs/plans/expression-v4-schema.md` for the primitive schema and `docs/plans/expression-v4-log.md` for bake-off/workbench results and the Phase 7 recommendation.

## Ground rules

- Read `AGENTS.md` first. Pre-launch operating mode: clean go-forward implementations, one canonical implementation. Generated customer sites, public `/sites/*`, preview-token routes, and publish gates are boundary-sensitive.
- Generation runs cost real LLM calls and need `.env.local` (OpenAI + Supabase + Places).
- Tooling you will use:
  - `npm run benchmark:vector` — regenerates the benchmark shop set through the live pipeline; reports per-shop scorecard vectors plus fleet aggregates: per-dimension P50/P10, same-vertical fingerprint distance (`lib/fingerprint-v1.ts`, `fingerprintDistanceThresholdV1 = 25`), and copy overlap (`lib/copy-overlap-v1.ts`).
  - `scripts/section-workbench.ts` — renders sections across the 16 canonical grammar shells with screenshots.
  - `node --import tsx --import ./scripts/load-env.ts scripts/inspect-candidate.ts <candidateId>` — dump any candidate's scorecard, composition, and media decisions.
  - `docs/generated-site-v3-constraint-renderer-architecture.md` — the renderer invariants. Nothing in this plan may weaken them.

## Inherited state (Track 1, implemented)

- `lib/media-floor-v1.ts` is the canonical slot-aware media floor: `mediaFloorVerdictV1(asset, business)` returns per-slot verdicts (`hero`/`background` strict; `proof`/`gallery` accept real first-party before/after imagery with collage/text-overlay warnings via `framed` treatment). Rights are never consulted during generation; they gate only publish, claim attestation, and asset-serving auth.
- The director input manifest carries `floorVerdict` per media candidate; plan-time normalization/validation and compile-time selection consume the same `allowedUses`, so plan/compile media divergence is structurally eliminated. The V4 composer must consume the same verdicts.
- Known Track 1 follow-ups the V4 agent should confirm are resolved before freezing baselines (they affect benchmark numbers):
  1. `allowedUsesForBusinessAssetV1` in `lib/generated-site-v3-director-manifest.ts` falls back to analysis `recommendedUses` when a photo clears zero floor slots — a floor-failing asset can still render in proof/gallery. Confirm intended or tighten (fallback only when `mediaFloor` is undefined).
  2. `dimensionsForFinding` in `lib/generation-scorecard.ts` still fans one finding into multiple dimensions when several patterns match; "divergence charged once" is only partially realized.
  3. The Mencia end-to-end acceptance regeneration (`https://menciaautoshop.com/`) has not been run since Track 1 landed. Run it first: expect no `media_selection_unavailable` blocker, no clamp cascade, proof/gallery imagery rendering framed, verdict not `blocked`.

## Thesis and why this track exists

Every generated site reads as the same skeleton. That is structural: the visual universe is ~15 section geometries crossed with enumerated options; the compiler clamps ambition to floors; repair pressure converges output to the modal safe site. Adding more enum vocabulary has diminishing returns because geometry rhythm stays invariant.

The repo has tried two points on the design spectrum: unconstrained layout generation with no validator (v2 — catastrophic, per the constraint-renderer architecture doc) and deterministic catalog composition with a strong validator (v3 — safe monotony). V4 is the untried third point: **a model composes geometry from bounded primitives and design tokens; the existing deterministic validators normalize-or-reject the result.** Model proposes, compiler disposes. v3 already built the hard part — the constraint compiler, renderer invariants, screenshot verification, scorecard — and V4 reuses all of it unchanged as the safety net.

## Non-negotiables

- The renderer invariants (4–12 column clamp, no foreground absolute positioning, no foreground overlap, bounded hero media, mobile sticky header, explicit contrast tokens, etc.) are **never weakened to make a composition pass**. If a composition violates them, the composition is wrong.
- V4 emits `VisualSectionV3` through the existing `compileVisualSectionV3` path and renders through `SiteRendererV3`. The spike target is one new reserved union member, `templateId: "expression_composition"`, because every `VisualSectionV3` is template-id-bound. No parallel renderer.
- Section *purposes* (hero, services, proof, faq, location, contact and their ordering rules) stay semantic and validated. V4 changes how a purpose's geometry is composed, not what a page must communicate.
- Rejection handling is **regenerate-with-feedback, never clamp-to-floor** (clamping is the convergence mechanism that causes monotony): one retry with compact violation feedback; after two failed attempts for a section, fall back to the V3 catalog section and record `composition_fallback`. Fallback rate is a graded metric.
- V4 runs only on internal candidates and benchmark shops until the expansion gate passes and Willie approves. No public `/sites/*` exposure.
- V3 and V4 composition paths coexist behind an internal generation config during the experiment only; the losing path is deleted at decision time per pre-launch policy.

## Scope for the prototype

One vertical: `auto_body`. One page: homepage. The 16 canonical grammar shells plus the Austin auto benchmark set as test subjects. Service pages and other verticals come only after the expansion gate.

## Step 0 — freeze the baseline

1. Resolve the three inherited follow-ups above, then run `npm run benchmark:vector` on the default Austin auto set. Keep the NDJSON under `.data/benchmarks/` (untracked); commit a summary table to `docs/plans/expression-v4-log.md`.
2. Record: per-dimension P50/P10 for all eight scorecard dimensions; same-vertical fingerprint distance for every shop pair; max copy overlap; generation cost per shop; blocker counts.
3. Capture desktop/tablet/mobile screenshots per shop (render-inspection tooling) as the v3 side of the future eyeball board.
4. Check whether `fingerprint-v1` fields would represent V4-style geometry differences (band structure, split ratios, rhythm). If not, extend the fingerprint fields **before** the spike so the diversity metric can see what V4 changes. Fingerprints are regenerable intermediates; extension needs no backfill.

## Step 1 — the lowering spike (before any model calls)

Purpose: prove the riskiest assumption — that a primitive composition proposal can lower into the existing render path with meaningful visual diversity and zero renderer changes.

- Define a draft `SectionCompositionProposalV1` (Zod, `lib/expression-v4-schema.ts`): a section composes primitives — `stack` (spacing-scale steps), `split` (bounded ratio set, e.g. 40/60, 50/50, 62/38), `grid` (2–4 columns, density token), `band`, `layer` (background-only bleed, the only overlap allowed). Every knob is a token reference or bounded enum, never a raw value. If the schema can express an invalid value, tighten the schema.
- Hand-author three proposals: media-rich, no-media, proof-heavy. Document them with the schema in `docs/plans/expression-v4-schema.md`.
- **Lower each into compiled visual sections via the reserved `expression_composition` union member — `VisualSectionV3` content routed through `compileVisualSectionV3` with `renderPath: "expression_v4_spike"`. Do NOT map the primitive proposal back into existing catalog section IDs/options: the catalog is the expressiveness ceiling this track exists to escape, and a catalog-targeted spike cannot demonstrate diversity beyond it by construction.**
- Render desktop/tablet/mobile screenshots through `SiteRendererV3`; run render inspection; confirm zero renderer-constraint changes were needed.
- **Spike success bar (defined, not vibes):** all three hand-authored pages render with zero invariant violations, AND their pairwise fingerprint distance (using the possibly-extended fingerprint fields) exceeds the median same-vertical distance of the v3 baseline set. Log the numbers.
- If the spike fails: do not build the composer. Fall back to the lower-risk path — expand existing `SectionBlueprintV1` options, art-direction controls, and director constraints (parametric variation within the catalog) — and record the decision with the spike evidence.

## Step 2 — V4 infrastructure (only after a passing spike)

- `lib/expression-v4-composer.ts`: structured-output model call(s) taking the director inputs (fact graph, copy deck, media candidates with `mediaFloorVerdictV1` verdicts, brand cues) and producing a page proposal. Prompt includes: section purposes and content obligations; the primitive/token vocabulary in plain language; a seed-conditioned style directive (reuse the `siteVariationSeedV2` pattern) so two same-vertical shops get different composition instructions; an anti-monotony rule (no two consecutive sections share the same primitive skeleton and background treatment); and the media floor verdicts so it never composes around unusable media.
- **Build the composer approach-pluggable from day one.** The entry point takes an `approachId` selecting a named strategy (prompt assembly + call structure + selection policy), because Step 3 evaluates several approaches head-to-head. Each approach lives in its own module under `lib/expression-v4-approaches/` with a shared contract: same inputs, same `SectionCompositionProposalV1` output, own provenance stamp.
- Composer output is an internal regenerable artifact with provenance (producer/prompt version, model id, input hashes, timestamp).
- Validation is three fail-loud layers: Zod schema → structural rules needing cross-section context (purpose order, consecutive-skeleton rule, first-viewport bounds) → the existing `compileVisualSectionV3` constraints, unchanged.

## Step 3 — approach bake-off (breadth before depth)

We do not know in advance which composer architecture produces the best sites, and the automated assessment stack makes testing several cheap relative to iterating a dead-end. Run a structured bake-off of 3–4 named approaches on the cheap workbench set. Breadth happens here and only here; everything after commits to one winner.

**The experiment dimensions.** Document the chosen coordinates of every approach in the log so the bake-off is an experiment, not a grab bag:

| Dimension | Options (examples) |
| --- | --- |
| Composition altitude | whole-page proposal in one call · two-stage (page skeleton, then per-section detail) · per-section calls with a shared style contract |
| Prompting strategy | single-shot structured output · plan-then-compose · compose-then-self-critique-and-revise |
| Exemplar conditioning | none · few-shot from `docs/generated-site-v3-premium-pattern-inventory.md` · few-shot from real agency-site descriptions |
| Style conditioning | seed directive only · explicit design-register persona (reuse `designProfile` vocabulary) · brand-cue-driven |
| Selection policy | single sample · best-of-N (generate 2–3 proposals per site, auto-score, keep the winner) |
| Model / effort tier | per `lib/models.ts` configuration |
| Schema expressiveness | coarse primitives only · full token vocabulary |

Validation feedback depth stays fixed (one retry, then fallback) across approaches so results are comparable.

**Named approaches.** Define 3–4 approaches spanning genuinely different corners of that table — e.g. `A: one-shot-page` (whole page, single call, seed style), `B: skeleton-then-sections` (two-stage, persona style), `C: critique-loop` (compose then self-revise against the anti-monotony rules), `D: best-of-3` (approach A sampled 3×, auto-scored, best kept). Do not test approaches that differ on only one minor knob — that is what depth iteration is for.

**The workbench assessment battery.** The full scorecard needs the live pipeline, so the bake-off grades on the subset that runs offline, per approach across all 16 shells:

1. Render-inspection findings (count and severity; invariant violations are disqualifying).
2. Visual QA model scoring of the screenshots (`craft`, `layout`, `mobile` subscores — same model rubric the pipeline uses).
3. Pairwise fingerprint distance across the 16 shells (the diversity measure).
4. Composition fallback rate and schema-rejection rate.
5. Cost and latency per page.

**Selection.** Rank approaches by: hard disqualifiers first (invariant violations, fallback rate ≥ 20%), then diversity (fingerprint distance P50), then visual QA P50, then cost. Carry the top approach into Step 4; keep the runner-up recorded with its config so it can be revived if depth iteration stalls. Write a bake-off memo in the log: per-approach numbers, contact sheets, decision, and what surprised you.

**Budget.** One bake-off round: ≤ 4 approaches × 16 shells (× 3 samples only for the best-of-N arm). If two approaches are statistically indistinguishable on diversity and quality, prefer the cheaper/simpler one. Do not run a second bake-off round without a logged reason.

## Step 4 — depth iteration on the winning approach

- `scripts/expression-v4-workbench.ts` (model on `scripts/section-workbench.ts`): for each of the 16 canonical grammar shells — generate a composition, compile, render, screenshot 3 viewports, run render inspection and the assessment battery, emit an HTML contact sheet plus findings NDJSON. Build this in Step 3; reuse it here.
- Iteration protocol (strict — breadth is over, so single-variable rules apply):
  1. Change exactly one of {schema expressiveness, composer prompt, structural validation rules, selection policy} per iteration. Never two — you cannot attribute the effect otherwise.
  2. Regenerate the 16-shell workbench set and run the assessment battery.
  3. Triage the top 3 recurring findings; fix the system (schema/prompt/rule), not individual outputs.
  4. Append a log entry to `docs/plans/expression-v4-log.md`: iteration number, what changed, contact-sheet path, battery numbers (findings, visual QA P50, fingerprint distance P50, fallback rate), verdict, next hypothesis. Each iteration must improve at least one battery number without regressing the disqualifiers, or be reverted.
  5. Do not run the expensive `benchmark:vector` loop until the workbench stabilizes at: zero invariant violations, composition fallback rate < 10%, no recurring cross-shell finding. Expect 5–10 workbench iterations; the log makes them legible.
  6. Never weaken a renderer invariant to make a composition pass.
  7. If 3 consecutive iterations fail to move any battery number, revive the bake-off runner-up (its config is in the log) rather than continuing to grind — that is the escape hatch before the kill criteria fire.

## Step 5 — the graded A/B run

1. Enable V4 for `auto_body` in the internal generation config; run `npm run benchmark:vector` on the same Austin auto set.
2. Build the eyeball board: per shop, v3 baseline screenshots beside V4 screenshots, one HTML page.
3. Grade against the rubric and write the decision memo in the log.

## Grading rubric

Hard gates — any failure means iterate or kill, no exceptions:

| Metric | Source | Requirement |
| --- | --- | --- |
| Scorecard per-dimension P50 | benchmark:vector | ≥ v3 baseline for all 8 dimensions |
| Blocking findings | benchmark:vector | zero new blocker ids vs baseline |
| Accessibility dimension | scorecard | stays 100 |
| Renderer invariant violations | render inspection | zero |
| Mobile experience P50 | scorecard | ≥ baseline |
| Composition fallback rate | V4 compile decisions | < 10% of sections |
| Generation cost per shop | `generationCostEstimate` | ≤ 2× v3 baseline |

Primary win metric (the reason V4 exists):

- Same-vertical fingerprint distance, all shop pairs: P50 ≥ 2× the v3 baseline P50, and every pair ≥ `fingerprintDistanceThresholdV1` (25).
- Max copy overlap ≤ baseline.

Secondary signals:

- Visual QA `craft` and `layout` P50 ≥ baseline + 10.
- Zero `visual_qa.layout.repetitive_cards`-class findings (the monotony signature from the original Mencia audit).

**Human gate (final, deliberately subjective, belongs to Willie):** the eyeball board is reviewed with one question per shop pair — "could these two sites plausibly have come from the same template?" V4 passes when the answer is "no" for the majority and nothing looks broken.

## Expansion / kill criteria

- **Expand** when all hard gates hold AND the primary win metric is met on two consecutive benchmark runs AND the human gate passes. Expansion order: remaining automotive verticals → service pages → all verticals. At full expansion, delete the v3 catalog composition path (catalog geometries may survive as V4 fallback primitives) per pre-launch clean-break policy.
- **Kill** if, after 3 serious logged depth-iteration cycles on the winning approach **plus** one revival of the bake-off runner-up, V4 cannot pass the hard gates, or fingerprint-distance gain is < 25% over baseline. On kill: delete the V4 modules, keep the log (including the bake-off memo — it is the record of what the approach space yielded), and invest in the documented fallback (parametric variation within the catalog).
- Either way, decide by the second benchmark run. Do not let the experiment linger.

## Verification commands

- `npm run typecheck` after TS changes.
- `npm run verify:generated-site-v3-renderer-constraints` and `npm run verify:generated-site-v3-characterization` after lowering-path changes (characterization must stay green — V4 must not change v3 output while the config keeps V4 off).
- `npm run verify:render-browser` after rendering behavior changes.
- Workbench + battery for every iteration; `benchmark:vector` only at Step 0, Step 5, and the confirmation run.

## Assumptions

- Existing dirty worktree changes are user/agent-owned and must not be reverted or overwritten.
- Generation remains pre-launch clean-breakable except public renderer, publish gates, claim flow, asset auth, and stored `SiteVersionV3`/fact-graph contracts.
- `.data` benchmark outputs remain untracked; commit only summaries or links in tracked docs.
- The human gate and the expansion decision belong to Willie.
