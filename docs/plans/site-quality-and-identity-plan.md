# Site Quality & Design Identity Plan (Canonical)

The single canonical plan for making generated sites payable and visually distinct. Merges the reliability sprint, the identity-measurement baseline, the vertical-profile architecture, the identity engine, and copy-overlap work. Supersedes all prior versions of this document. Written 2026-07-08 after the first live V3 baseline on a 7-target preflighted `auto_body` corpus.

## Ground rules

- Read `AGENTS.md` first. Generated customer-site design is **boundary-sensitive**: identity/theme changes ship behind benchmark gates and an eyeball-board sign-off from Willie before range widening. Pre-launch operating mode otherwise applies: replace, don't shim; one canonical implementation.
- Live generation costs real LLM calls (`.env.local`: OpenAI + Supabase + Places). Reuse the existing corpus and baseline: corpus `.data/benchmarks/expression-v4-auto-body-preflight.json`, baseline `.data/benchmarks/expression-v4-v3-baseline.ndjson`.
- Tools: `npm run benchmark:vector`, `scripts/inspect-candidate.ts`, `scripts/section-workbench.ts`, `lib/copy-overlap-v1.ts`, `lib/fingerprint-v1.ts`.

## Diagnosis

From the 2026-07-08 baseline (7 real auto-body shops, all `blocked`):

1. **Reliability defects block every site** — six bounded classes (media overflow, placeholder copy, dirty name extraction, contrast/broken image, mobile fill, conversion gate), each with a named repro target.
2. **The identity layer is hard-coded** — `themeForV3Business` returns one palette per vertical; auto-body picks from 3 near-identical dark palettes; chrome comes from ~3 recipes per vertical. Same vertical → same colors, buttons, header. This is what humans perceive as "every site looks the same."
3. **The diversity metric is blind to identity** — baseline fingerprint min distance 34 ("healthy") while all sites share one theme, because constant axes contribute zero distance.
4. **Copy overlap 0.356 vs 0.18 threshold** — same-vertical sites share over a third of their phrasing.
5. Geometry (Expression V4's target) is the healthiest axis; V4 stays parked.

Not a rewrite, not prompts: the pipeline spine, QA stack, and benchmark loop are proven. What's missing is degrees of freedom in the identity layer, a reliability sprint, and an architectural rule that stops vertical behavior from being scattered as code forks.

---

# The architecture rule: one canonical pipeline, verticals as data

Current state: vertical-specificity exists in three competing mechanisms — **198 `vertical === "..."` conditionals across 18 files (103 in the compiler alone)**, ~12 scattered `Record<Vertical, ...>` tables (font pools, button pools, CTA lexicon, intake palettes, …), and one nascent declarative profile (`GeneratedSiteVerticalQualityProfileV1`, 2 entries, quality concerns only).

Target state:

- **One pipeline, vertical-agnostic engines.** Every business runs the same stages: intake/crawl → fact graph → understanding → media analysis/floor → director plan → identity → copy → compile → QA/scorecard → publish.
- **One profile registry.** Grow `GeneratedSiteVerticalQualityProfileV1` into `VerticalProfileV1` (rename/extend in place — do not add a fourth mechanism): a typed, sparse-with-inheritance registry, one entry per vertical, one module. Each stage engine consults the profile for parameters:
  - identity: hue anchor **ranges**, register/mood tendencies, chrome tendencies — never concrete palettes;
  - media: per-slot floor strictness, proof vocabulary, curated fallback categories (already present);
  - services: semantic groups, presentation treatments;
  - copy: CTA conventions (call-first vs booking-first), voice anchors, banned patterns, playbooks;
  - QA: vertical copy expectations and gate emphases.
- **The one-read rule:** `business.vertical` is read exactly once per generation run — to resolve the profile. It never appears in an `if` outside the profile module.
- **Vertical informs, never determines.** Profiles carry taste *bounds*; the site's own identity (brand cues when present, seed otherwise) picks within them.
- **The ratchet:** add a verify script that counts `vertical === "` occurrences outside the profile module and fails if the count ever increases. The 198 existing conditionals migrate into profile parameters as each subsystem is touched — no big-bang rewrite, monotonic progress enforced by CI, count recorded in the script output. End state: adding a vertical = writing one profile entry and running the gate.

**No dual identity path.** The identity engine (Track B) ships for **all verticals at once** — one code path. Rollout risk is staged in *data*: unvalidated verticals get deliberately narrow hue/chrome ranges centered on their current hard-coded look (output barely changes); each vertical's ranges widen only after it passes the benchmark + eyeball gate. The `themeForV3Business` constants and the 3-palette auto-body list are **deleted in the same change**, replaced by narrow profile ranges. Staging becomes a reviewable data diff, never a second implementation.

---

# Track A — Reliability sprint (P0: makes sites payable)

Fix the seven baseline blocker classes against their known repro targets before identity work. For each: root cause first (no fix without a cause), focused code fix, regression fixture, one targeted live rerun or deterministic repro.

| # | Blocker class | Repro target | Notes |
| --- | --- | --- | --- |
| A1 | Media overflow (visual 59) | Terry's Body Shop, Autocraft Bodywerks | Likely crop/frame handling on framed proof media or gallery counts exceeding template bounds |
| A2 | Missing services | Terry's, Autocraft | Service extraction/mapping dropped sections |
| A3 | Placeholder/process copy visible | Pro Tech, Hance's | Extend lint corpus; fail-loud at deck acceptance, not render QA |
| A4 | Dirty business-name extraction | Quality Body Shop Austin | Normalize + confidence-gate names; unscored candidates must become scored failures with clear reasons |
| A5 | Contrast failure + broken image (a11y 25) | Spectrum Auto Body | Fetch-validate media URLs at selection; validate final theme with `contrastRatioV3` at compile |
| A6 | Mobile section fill | Hance's | Sparse-content section stretching; template min-height/fill rules |
| A7 | Conversion 59 | Mencia | Re-inspect after A1–A6; may already resolve |

**Acceptance:** one full 7-target corpus run at close — ≥ 5 of 7 not `blocked`; zero occurrences of A1–A6; duplicate service titles remain fixed; no "blocked, unscored" candidates; every class covered by a fixture.

---

# Track B0 — Identity measurement baseline (before changing generation)

- Add `identityDistanceV1` as a **separate submetric** alongside `fingerprint-v1`. Do **not** change `fingerprintDistanceV1` weights — historical benchmark numbers stay comparable.
- Identity vector: palette signature, quantized primary/accent, font pairing, header mode, button system, card chrome, badge/eyebrow treatment, background rhythm.
- Report min/P50 same-vertical identity distance in `benchmark:vector` fleet health.
- Run it on the existing 7-shop baseline to document the failure signature.
- **Threshold calibration caveat:** the current baseline has ~zero identity variance (one shared theme), so the observed distribution calibrates the *failure* signature only — there is no spread to learn a passing bar from. Set the **pass** threshold from perceptual reasoning (minimum quantized hue/palette-signature separation that reads as "different brand"), then validate it against Track B workbench outputs before locking it.

**Acceptance:** existing benchmark output unchanged; identity report clearly shows the current sameness; pass threshold documented with its perceptual rationale and workbench validation.

---

# Track B — Identity engine (P1: fixes "every site looks the same")

## Engine

- New `lib/site-identity-v1.ts`: `siteIdentityV1(business, profile, brandCues, seed)` → palette + typography + chrome parameters, with provenance (seed, parameter signature, profile version) recorded. `paletteName` becomes the parameter signature (e.g. `identity-v1:h214-s3-warm2-comp`).
- **Construction, not selection:** continuous parameters (primary hue within the profile's anchor range, saturation band, background warmth, neutral temperature, accent relationship, surface elevation) → palette constructor → deterministic validation: `contrastRatioV3` ≥ 4.5:1 on all text pairs, dark-surface readability rules, coherence matrix. Constructor iterates seed-salted parameters until a passing palette exists; fail-loud if a profile's bounds cannot produce one (that is a bounds bug).
- **Determinism is absolute:** same inputs + seed → same identity. No repository-history-dependent generation; identity-collision checks are benchmark/reporting gates only, never generation inputs.
- **Precedence:** strong brand cues (existing `deriveBrandThemeV2` extraction) seed the parameters — the cue hue becomes the primary anchor and the engine constructs/validates around it. Weak/no cues → seeded parameters. One engine, two parameter sources.
- **Replacement, not addition:** `themeForV3Business` constants and `autoBodyPremiumNoMediaThemeV1` are deleted; all verticals route through the engine with profile ranges (auto-body wide, others narrow per the architecture rule above).

## Chrome axes

- Header mode, button system, card chrome, badge/eyebrow treatment, figure treatment, CTA band tone, number style, background rhythm move from recipe-enumerated picks to seeded `axisPick` selections over the full `lib/generated-site-v3-visual-controls.ts` vocabulary, bounded by a small **coherence matrix** (explicit forbidden combinations — the taste layer; start strict, widen deliberately).
- Recipes keep composition authority (section rhythm, geometry directives); they lose identity authority.

## Validation & QA

- Deterministic: contrast gates + coherence matrix (above).
- **Visual-QA identity coherence:** extend the model visual-QA rubric to grade whether palette/type/chrome read as one deliberate brand — the taste safety net for a generative palette engine; failures surface as findings.
- Accessibility is a hard gate: any identity output that drops a11y below 100 on the corpus is rejected regardless of aesthetics.

**Acceptance (in order):**
1. Engine property tests: every seed in a representative range yields a contrast-passing palette or a fail-loud bounds error, per vertical profile; signature uniqueness across the 16 grammar shells.
2. Workbench: 16 shells — no duplicate palette signatures, zero contrast/coherence violations, contact sheet produced.
3. Corpus: 7-shop run — zero identity collisions under the calibrated threshold; a11y 100 on scored candidates; scorecard dimensions do not regress vs post-Track-A; narrow-range verticals' characterization output changes only within tolerance (their ranges are centered on the old constants).
4. **Eyeball board (Willie's, final, subjective):** 7 auto-body sites side-by-side — "do these look like same-shop-in-a-box sites?" Range widening for further verticals only after his sign-off. The auto-body hue anchor ranges themselves ride this board for taste approval.
5. Characterization snapshot regenerated deliberately after the gate passes — an intentional, reviewed change.

---

# Track C — Copy overlap (P2)

- Measure first: extract the actual shared phrases from the baseline with `copyPhraseSetV1`/`maxCopyOverlapV1` — the phrase list comes from data.
- Seed-selected voice parameters in copy generation: sentence-length bias, formality, lead angle (speed / craftsmanship / insurance-navigation / family-legacy — only angles the fact graph supports for that shop).
- **Versioned** banned/constrained phrase policy (auto-body v1) checked into the repo from the measured list — reproducible, never derived implicitly from whatever sites exist in the database.
- Generation-time lint: reject decks over the overlap threshold against the versioned policy, one regenerate with feedback, then fail-loud.

**Acceptance:** corpus max copy overlap ≤ 0.18; content quality and fact coverage do not regress; phrase policy versioned.

---

# Track D — Expression V4 (parked)

No V4 work in this plan. Resume criteria unchanged: a model-backed approach must beat `fixture_rotation_null` on the workbench battery with zero invariant violations and acceptable fallback rate before any live A/B. Revisit after Tracks A–C land.

---

# Sequencing & budget

1. **Track A** first (payability gates everything). Single-target live runs during dev; one full corpus run at close.
2. **Track B0** alongside Track A (pure measurement, no generation changes).
3. **Track B** after A closes: engine + profile registry + constants deletion in one change set; workbench iterations are LLM-free (deterministic engine); one corpus run at the gate.
4. **Track C** overlaps B; its corpus check rides B's gate run.
5. Re-freeze the benchmark baseline after A+B+C; weekly `benchmark:vector` cadence resumes against it.
6. The vertical-conditional **ratchet script** lands with Track B and runs in every verification pass thereafter.

Live budget: dev single-target runs as needed + **two** full 7-target corpus runs (A close; B/C gate). No vertical range-widening beyond auto-body until the eyeball board passes.

# Test plan

- `npm run typecheck`; `npm run verify:render-browser` after renderer/theme changes.
- `verify:generated-site-v3-renderer-constraints`, `verify:generation-quality-v2`, `verify:auto-body-quality-benchmark`, `verify:launch-boundaries` (identity must not touch publish gates), premium-palette verify updated/replaced for the engine.
- Focused tests: dirty-name normalization; placeholder-copy rejection; broken-media-URL rejection before render; service-section preservation; palette contrast across representative seed ranges; identity signature uniqueness across 16 shells; copy-overlap rejection + regenerate behavior; ratchet script (count never increases).
- Benchmark sequence: B0 on existing baseline → Track A close run → Track B workbench → B/C gate corpus run → final report (blocker status, scorecard table, identity-distance table, copy-overlap table, eyeball-board path).

# Decision points reserved for Willie

- Track B eyeball board — the "same shop-in-a-box?" question — before any range widening beyond auto-body.
- Auto-body hue anchor ranges (taste; defaults proposed on the board).
- Whether to later fund model-backed brand briefs (LLM proposes identity parameters from business evidence) after seeing seeded-engine results — explicitly out of scope for this plan.
