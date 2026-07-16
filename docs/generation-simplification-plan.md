# Generation Simplification Plan: Commit to Design Systems, Collapse the Judgment Stack

**Status:** Superseded by `docs/generation-pipeline-clean-break.md`
**Date:** 2026-07-09
**Decision this plan implements:** Approach (a) — hand-crafted design systems are the product. The
model's job is facts → copy → brand mapping → conversational edits, not layout design. Approach (b)
(model-as-designer, expression-v4) is discontinued as a production direction.

---

## 1. Why

Six weeks in, `lib/` is ~64k lines and no generation has yet cleared the "a customer would pay for
this" bar. Analysis of the pipeline found:

- **6–7 LLM calls per generation**, with the most important creative call (Site Director) running on
  the weakest model (`gpt-5-mini`) under a 40–60KB injected catalog manifest.
- **~80% of visual output is already predetermined** by hand-authored catalogs (27 section
  templates, 200+ visual-control enums, 7 archetypes). The LLM's "design freedom" is picking from
  enums — we pay the complexity cost of model-as-designer while shipping template output.
- **Five overlapping judgment systems** (render inspection, model visual QA, quality rubric v2,
  8-dimension scorecard, repair-target classification) ingest largely the same findings. The repair
  loop can act on only 4 narrow target types; everything else is telemetry.
- **Entirely report-only machinery** that never feeds back into generation: craft loop,
  fingerprint-v1, copy-overlap-v1, design-section-audits-v2.
- **Version strata never removed:** v1/v2/v3 coexist; expression-v4 grows beside v3 instead of
  replacing anything; canonical fixtures never vary a single design knob (all 16 businesses use the
  same font, color system, density, and card treatment).

The pattern: when generations disappoint, we add a new way to detect disappointment instead of a
new way to prevent it. And the freeform additions (LLM director latitude, expression-v4) have been
compensation for the real gap: **template section quality is not yet good enough**, so each cycle
added model freedom on top rather than raising the floor underneath. Every one of those plans was a
reasonable step at the time; this plan redirects the same effort at the root cause. It reverses
both loops: quality work goes into the design systems themselves, and judgment code gets collapsed
to the minimum that can act.

## 2. Vision: where the LLM exercises judgment, and why v4 doesn't ship

The product promise is "we optimize, you do nothing." The unit of quality is the **design system**
— template sections, tokens, and composition rules — a centrally-owned asset we improve once and
deploy fleet-wide. Sites *should* collapse to the quality of template sections; that collapse is
the mechanism that makes fleet-wide optimization possible. The plan's bet is that the fix for
"template quality is the ceiling" is to raise the ceiling, not to route around it with freeform.

**The LLM owns every judgment call that is business-specific or linguistic:**

- understanding the business (vertical, services, story, conversion goal)
- writing all copy, briefs included
- **brand expression within validated ranges:** choosing the palette *seed* (ranked from
  deterministically extracted logo/media colors), the font *posture* (which maps onto the design
  system's pre-tuned pairing menu), and the voice register. The governing principle: **the LLM
  makes taste calls; deterministic code does derivation and enforces invariants.** A token
  generator expands the seed into the full palette with WCAG contrast guaranteed by construction
  (never model-emitted, never check-and-reject); font pairings are only in a menu once tuned
  against every template that system offers. These choices are emitted by the **Business
  Understanding call** as a `brandExpression` output (it runs before design-system assignment,
  so the order works) — no new "design director" call.
- judging the finished output ("would an owner pay?") and feeding findings back into regeneration
- translating owner edit requests onto system knobs (the edit layer)

**The LLM does not own layout/geometry judgment**, because (1) inside a bounded enum catalog it
cannot meaningfully exercise it — we pay model-as-designer complexity for template output; (2)
per-site design variance breaks central optimization — a bespoke section that wins on one site is
a win trapped on one site, unmaintainable and unmeasurable; (3) variance is the enemy of a managed
promise — the worst output, not the best, sets the trust level.

**Why expression-v4 doesn't fit as a shipping path:** v4 composes novel per-site sections beyond
the catalog. Even its successes are stranded — they can't be benchmarked, tuned, or pushed to other
sites. The correct home for that work is **template discovery**: run v4-style composition as an
offline bake-off against the design systems, and when it finds a section pattern that beats the
catalog, an engineer promotes it *into* the catalog as a new template section. Same creative
engine, but its wins compound instead of scattering. The v4 code is deleted from the pipeline in
Phase 1; its learnings (and the bake-off harness concept) inform Phase 6.

## 3. Target end state

### Pipeline (per generation)

| # | Stage | Type | Notes |
|---|-------|------|-------|
| 1 | URL safety + crawl + render inspection + public presence | Deterministic | Unchanged |
| 2 | Business Understanding | **LLM call 1** | `business-understanding-v2`, extended with `brandExpression` (mood/voice register, font posture, palette-seed choice among extracted candidates) |
| 3 | Asset analysis | **LLM calls (vision, capped)** | Unchanged, keep image budget |
| 4 | Design-system assignment + brand tokens | Deterministic | vertical + `brandExpression` + seed → one of 5–7 systems; `brand-expression-v1` maps font posture → tuned pairing, seed → full token palette (contrast by construction). Replaces the LLM Site Director. |
| 5 | Section selection | Deterministic | Fact-availability rules per design system (has photos → gallery; has reviews → proof; N services → index shape). Replaces the LLM plan. |
| 6 | Copy deck | **LLM call 2** | `generated-copy-v2` on the strongest model; absorbs the per-section brief work the director used to do |
| 7 | Compile | Deterministic | Slimmed compiler; catalogs cut to what the design systems actually use |
| 8 | Deterministic gate | Deterministic | Render inspection + placeholder scan + grounding/service checks. Hard blockers only. |
| 9 | Visual QA judge | **LLM call 3** | One judge, one verdict: "would an owner pay?" + findings |
| 10 | Regenerate-with-feedback | Conditional | If judge fails: ONE regeneration of copy (and/or section selection) with findings in the prompt. Then operator review. No mutation loop. |

**LLM calls: 6–7 → 3 (+capped vision).** No repair loop, no scorecard, no craft loop, no
expression-v4, no LLM director.

### Judgment stack

Exactly two systems:

1. **Deterministic gate** — objective, blocking: overflow, contrast, broken/unloaded media,
   placeholder/internal-state text, missing required facts (phone/hours/services grounding), SEO
   structure basics. This is today's render inspection + the genuinely unique deterministic checks
   from `generated-site-qa.ts` and `generation-quality-v2.ts`, merged into one module.
2. **One LLM judge** (`visual-qa.ts`, kept) — single craft verdict + 3–10 findings. Findings are
   *input to regeneration*, not a scoring ceremony. No dimension gates, no weighted rubric, no
   scorecard.

### Owner customization story

Customization lives in the **edit layer** (`AiEditChat` + owner editor), not the generation layer.
Owner requests map onto design-system knobs (brand tokens, presets, copy slots, media) that cannot
produce a broken layout. This is how we honor "AI lets me change things" without giving up
"we optimize, you do nothing."

### Process rules (adopt now, enforce in review)

- **No new advisory scoring or report-only systems.** New *gates* are allowed only for objective,
  boundary-sensitive invariants (public/customer surfaces) that have a direct generation-time or
  edit-time action attached. Deterministic invariants are the safety net for customer surfaces —
  the ban is on measurement without a consumer, not on safety checks.
- Every quality problem is fixed by changing what **generates** (design systems, prompts, model
  choice, section rules) first; a new gate is the exception, justified per the rule above.
- No new `-vN` module without deleting the `-v(N-1)` it replaces in the same change (this is
  already AGENTS.md pre-launch policy; apply it to generation code specifically).
- No new config knob without a canonical fixture that varies it.

## 4. Phases

Ordered by risk: dead weight first, then judgment collapse, then generation changes, then design
investment. Each phase leaves the pipeline green (`npm run typecheck`, `npm run smoke:dev`,
`npm run verify:render-browser`).

### Phase 1a — Delete generation-path experimental machinery (ops/internal behavior change)

Scope: deletions on the generation path itself. This phase does not change served customer
output, but it is **not** behavior-neutral internally: craft-loop and expression-v4 are wired
into scheduled/monthly jobs (`jobs.ts`), launch-boundary checks, agent telemetry, public-renderer
type guards, CSS for v4 sections, `package.json` scripts, and admin/debug affordances. The phase
includes updating each of those touchpoints — jobs, telemetry event shapes, renderer guards +
CSS, scripts, admin routes, tests, and docs — in the same change, per the pre-launch
replace-don't-layer policy.

**Delete outright:**

- `lib/craft-loop.ts` (+ call sites in `site-candidate-service.ts`, `jobs.ts`; env vars
  `LODESTA_CRAFT_LOOP`, `LODESTA_CRAFT_LOOP_TIERS`, `LODESTA_CRAFT_LOOP_MODEL` from `.env.example`)
- `lib/expression-v4-pipeline.ts`, `lib/expression-v4-composer.ts`, `lib/expression-v4-schema.ts`,
  `lib/expression-v4-fixtures.ts` (+ `LODESTA_EXPRESSION_V4_INTERNAL`)
  - **Renderer entanglement:** `site-renderer-v3.tsx` and `generated-site-v3-visual-controls.ts`
    import expression-v4 section types. Remove the v4 section kind from both. This touches the
    public renderer (boundary-sensitive): confirm no stored candidate/published version contains a
    v4 section before deleting the render path — run a repository scan first; if any exist they are
    internal auto_body experiments an operator can regenerate or delete deliberately.
- `lib/fingerprint-v1.ts`, `lib/copy-overlap-v1.ts` (fleet-health reporting never wired to
  generation)
- `lib/design-section-audits-v2.ts` + `app/api/sites/design-section-audits/route.ts` (standalone
  admin audit UI)
- `lib/generated-site-v2.ts` (dead legacy; move the two type helpers used by
  `readiness-aggregator-v2.ts` and `copy-local-business-marketing.ts` inline or into those files)
- Scripts that exist only to exercise the above: `expression-v4-workbench.ts`,
  `expression-v4-bakeoff.ts`, `verify-expression-v4.ts`, and the fingerprint/overlap portions of
  `run-benchmark-vector.ts` / `candidate-generator-quality.ts` / `verify-auto-body-quality-benchmark.ts`

### Phase 1b — Admin/product report cleanup (separate track; does not block Phase 2+)

Scope: adjacent product/admin decisions — owner- and operator-surface changes that need product
sign-off but must not block the core generation simplification. Run as its own track.

**Delete (report-only, no consumer beyond their own admin route):**

- `lib/optimization-reports-v2.ts` + `app/api/sites/optimization-reports/route.ts` — post-generation
  analysis reports nothing acts on.
- Audit the other one-off report routes under `app/api/sites/*` (`brand-direction`,
  `asset-selection`, `design-section-audits`, `claims-policy`) — delete any without a consuming
  admin surface. **Exception:** `claims-policy` / `regulated-claims-policy-v2` is a genuine
  regulated-claims safety check (boundary-sensitive) — keep it regardless of UI wiring.
- `lib/seo-metadata-v2.ts` + `app/api/sites/seo-metadata/route.ts` — SEO audit report with no
  consumer; its unique structural checks fold into the Phase 2 gate (which already covers SEO
  structure basics).
- **Pause wordmark candidate generation** (`brand-wordmark-v2.ts` call in
  `site-candidate-service.ts`): `brand-mark-generation-v2.ts` hard-codes
  `blocked_pending_product_legal` with no approval workflow, so every candidate pays to generate
  a wordmark that is unusable by design. Stop generating until the legal/approval workflow
  exists; keep the module for when it does.
- **Experiments: stop seeding, keep the infrastructure — permanently (decided).** The A/B system
  is a complete wired loop — variant assignment (`app/api/experiments/assign`), renderer runtime
  (`ExperimentRuntime` in the public renderer), analytics capture, analysis → learning
  (`experiment-learning.ts`), and learnings applied to the next generation's variants
  (`intake.ts:294`). It is NOT dead code, and it is kept. What changes is the experimentation
  model — per-site A/B becomes **fleet-wide cohort A/B**:
  1. **Stop auto-creating the four default experiments at intake.** Per-site experiments can
     never conclude: SMB traffic (~hundreds of visits/month) never reaches significance, and two
     of the four surfaces (`hero_layout`, `cta_placement`) vary per-site layout against
     design-system consistency. The `hero_layout` surface retires as designed.
     **Migration contract:** `bundle.experiments` stays in the type and becomes `[]` (no schema
     change, no dual path). Known touchpoints to update in the same change: the owner experiments
     page (`app/(owner)/experiments/[slug]`) gets an empty state; smoke tests and
     launch-boundary assertions that expect seeded experiments; any bundle fixtures/expectations
     that assume four experiments exist; `ExperimentControlForm`/admin affordances render against
     an empty list.
  2. **Keep the rails dormant:** runtime, assignment, analytics capture, schema. The owner-facing
     experiments page gets an empty state. Add one canonical fixture that exercises the
     assignment/render path so the dormant code stays type-checked and rendered, not rotting.
  3. **Post-launch re-activation model:** experiments are defined per fleet cohort (e.g., "all
     auto-body sites on design system 3") over design-system-exposed knobs only (sticky CTA, form
     length, CTA prominence). Visitors are still assigned per-site; analysis pools across the
     cohort (the existing `cohort` field anticipates this). A concluded winner updates the
     **design system default** and rolls out on recompile — one test improves every customer's
     site, which is the "we optimize, you do nothing" mechanism made real.

**Keep:** `drift-detection.ts` (owner fact-review flow, not generation), `market-benchmark.ts` and
`generated-site-v3-benchmark-corpus.ts` (script-only competitive reference; cheap to keep, revisit
in Phase 5).

**Estimated removal:** ~3,500–4,500 lines of `lib/` + scripts, 2 fewer model-call paths.

### Phase 2 — Collapse the judgment stack to gate + judge

1. Create `lib/generation-gate.ts` (or fold into `generated-site-qa.ts`): the single deterministic
   gate. Absorb the *unique* checks from `generation-quality-v2.ts` (placeholder/internal-state
   scan, source-grounding of services/phone/hours, service title dedupe/malformation, hero
   template-filler detection, doorway-page sentence overlap) and drop the weighted 8-dimension
   rubric, score caps, and advisory taste scoring.
   - **Split the copy-lint regexes by what they actually are.** Objective leakage checks
     (placeholder text, internal-state language, meta-instructional copy, facts not backed by the
     graph) stay deterministic — regex is the right tool. Subjective taste policing
     (`detectCopyTasteIssuesInTexts` hedging/clipped-sentence heuristics, "generic heading"
     pattern lists) moves out of post-hoc lint entirely: it becomes prompt guidance in the copy
     call plus the judge's remit. Regex lists that grade a frontier model's prose grow forever
     and false-positive; stop growing them.
   - **One placeholder scanner, one sensitive-claim scanner.** `claim-verification.ts` carries its
     own placeholder-pattern list and sensitive-claim regexes that partially duplicate the QA
     placeholder scan and `editor-guardrails.ts`. Merge each category into a single shared module
     the gate and the edit layer both import. Sensitive/regulated-claim gating stays deterministic
     — it is exactly the objective, boundary-sensitive invariant the process rule protects.
   - **`standard.ts` / `qa.ts` (50+ standard criteria) are scoped to prospect reporting and
     analytics correlation only** — they never become a generation judge. The gate is the only
     generation-time deterministic authority.
2. Delete `lib/generation-scorecard.ts` and dimension gates. Delete
   `lib/generated-site-repair-targets.ts` classification.
3. Keep `lib/visual-qa.ts` as the one judge. Simplify its output to
   `{ verdict: ship | revise | not_evaluated, craftScore?: number, findings[], limitations[] }`.
   `craftScore` is diagnostic only; the gate consumes the verdict, never a numeric threshold.
   Remove the parallel 8 sub-scores entirely.
4. Rewrite `lib/generated-site-readiness.ts` as the thin orchestrator: gate → judge →
   (regenerate once) → gate → judge → verdict. Target well under 200 lines.

**Stored-artifact policy compliance (AGENTS.md two-tier rule):** `generationQa` lives inside stored
`SiteVersionV3`, which is strict-tier, and `GenerationQaMetadata` in `lib/models.ts:1085-1089`
currently hard-references the deleted modules' types — including a literal
`import("./craft-loop").CraftLoopReport`, so file deletion breaks typecheck unless types move
first. The migration contract:

1. **Type layer (do this before deleting files, in Phase 1a where needed):** replace the typed
   references in `GenerationQaMetadata` with a single `legacy?: LegacyGenerationQaV1` field typed
   as `Record<string, unknown>` sub-shapes (`scorecard`, `repairTargets`, `repairLog`,
   `qualityReport`, `craftLoop`). Old rows parse; nothing in new code can consume the legacy
   fields as structured data.
2. **Write layer + version discriminator:** the new gate writes an explicit
   `generationQa.schemaVersion: "generation-qa-v4"` and never emits legacy fields. Legacy rows
   are identified by a missing/older `schemaVersion` — a crisp discriminator, not inference from
   field presence — and that discriminator is what drives the admin "stale schema — regenerate"
   notice.
3. **Read/UI layer:** admin candidate surfaces soft-render legacy rows via the existing
   `siteVersionV3Issue` "stale schema — regenerate" notice; repository reads stay unchecked so
   stale rows load; writes assert the new shape.
4. **Backfill:** `backfill:generation-qa-v4 -- --check` enumerates affected rows. The applied
   migration removes legacy visual grades, marks those internal candidates pending, and preserves
   render artifacts; it never guesses a new verdict or deletes a row.

**Estimated removal:** ~2,500 lines, one duplicated model-QA path.

### Phase 3 — Replace the repair loop with regenerate-with-feedback

1. Delete `lib/generated-site-repair-loop.ts`, `lib/generated-site-v3-quality-repair.ts`, and the
   repair-loop plumbing in `generated-site-readiness.ts`; delete or gut
   `lib/generated-site-repair.ts` and `app/api/generated-qa/run/route.ts`'s repair entry (keep a
   "re-run QA" admin action; repair becomes "regenerate").
2. **Keep mechanical cleanup** (dedupe, filler-fact removal, internal-eyebrow strip, stale-hours
   drop) — move it *into the compiler* as a normalization pass so it happens at build time instead
   of as post-hoc repair.
3. Add the regeneration path, with an explicit execution contract:
   - **Finding classification (deterministic):** judge/gate findings are classified copy-only vs
     structural. Copy-only → re-run the copy deck with findings appended, recompile, re-gate,
     re-judge. Structural (sections, media, layout implicated) → full re-entry from the planner:
     planner → copy → compile → gate → judge.
   - **State:** regeneration always produces a **new draft version**; the judged version is never
     mutated and is persisted alongside with its QA verdict, so the failure→retry pair is
     auditable. The retry carries provenance (attempt number, triggering findings, producer
     versions) per the regenerable-artifact policy.
   - **Bounds and invariants:** exactly one retry, then `operator_review`. Published and
     owner-touched versions are never regenerated (existing invariant, re-asserted at the entry
     point). Cost/telemetry: the retry's model calls record through the same
     `telemetry`/generation-cost counters as the first pass, attributed to the same run.
4. `LODESTA_REPAIR_MODE` goes away.

**Estimated removal:** ~1,500 lines net (regen path is small — it reuses the existing pipeline).

### Phase 4a — Deterministic planner behind the existing `SiteDirectorPlanV1` contract

This is the core architectural shift to (a), staged so the planner/compiler contract never breaks.
`SiteDirectorPlanV1` stays the structure owner — the copy deck and compiler keep consuming it
unchanged; **do not delete the plan types**.

1. Rename/reframe `generated-site-v3-archetypes.ts` as **design systems** — the product surface.
   Each design system **fixes** geometry and chrome deterministically: spacing rhythm, buttons,
   cards, density, header mode, per-role presentation choices, and its section menu with ordering
   rules. Each system also **exposes a tuned expression surface** set per-business by the LLM:
   a font-pairing menu (3–5 pairings, each validated against every template the system offers),
   a palette-seed input (deterministic token generator derives the full palette with contrast
   guaranteed by construction), and a mood/voice register. No other model overrides.
2. Build the deterministic planner: design-system assignment (vertical + brand cues + seed) plus
   **section selection** rules keyed on fact availability (services count, photos, reviews/proof,
   hours, service area, story). Most of this logic already exists as the compiler's
   fallback/canonical flow — promote it to a first-class producer emitting `SiteDirectorPlanV1`.
3. **Collapse the competing design planners to zero.** Two active systems plus one dormant one
   currently shape design direction: (a) `generation-planning.ts` at intake (hardcoded vertical
   mood/typography/image signal tables, an optional `aiPlanning` OpenAI override path, and DALL-E
   mockup generation via `image-generation.ts`) — active; (b) the LLM Site Director at planning
   time — active; (c) `design-brief-v1.ts` — **dormant but honored**: `createDesignBrief` is
   called only from a verification script, yet the compiler consumes
   `bundle.presenceAssessment?.designBrief` (`generated-site-v3-compiler.ts:236`) if present — a
   read path for an artifact normal generation never produces. Remove all of it: delete
   design-brief-v1 *and* the compiler's consumption path, and delete the intake
   design-directions/mockup step. Design direction is the design system + expression surface. If
   prospect/outbound demos need mockups, that's a sales-surface decision to make separately.
4. **One brand-expression owner: `lib/brand-expression-v1.ts` (new, final contract).** Two
   divergent theme paths exist today — `brand-derivation-v2.ts` (brand cues as overrides on a
   preset) and `site-identity-v1.ts` inside the compiler (seeded deterministic palette with
   optional cues) — producing different results for the same business. Both are replaced by one
   module that owns the full chain: cue extraction (absorbed from brand-derivation-v2) →
   palette-seed resolution (model choice, see below) → deterministic token generation with
   contrast by construction → tokens consumed by the compiler. `brand-derivation-v2.ts` and
   `site-identity-v1.ts`'s theme logic are deleted once it lands; shared color-parsing/HSL
   helpers consolidate into it.
   **Where the expression taste calls come from (pipeline order):** deterministic code
   (`image-palette.ts`) extracts candidate hex seeds from the logo/media; the **Business
   Understanding call (LLM call 1)** is extended with a `brandExpression` output — mood/voice
   register, font posture, and a ranked choice among the extracted seed candidates. Design-system
   assignment then runs deterministically on vertical + those outputs; font posture maps
   deterministically onto the assigned system's tuned pairing menu; the token generator derives
   the palette. Everything downstream of call 1 stays deterministic, and the order works because
   understanding precedes assignment. (This extends the `BusinessUnderstandingV2` schema — a
   regenerable intermediate, so no backfill obligation, but carry provenance per policy.)
5. **Collapse media decisions to one owner.** Today four layers decide media: asset analysis (LLM
   scores/crops), media-floor-v1 (deterministic slot matrix), director plan assignment (LLM), and
   compiler allocation. New split per the taste-vs-derivation principle: the vision call reports
   only what vision can see (content tags, focal point, quality flags — facts, not choices);
   allocation is one deterministic pass in the planner using those facts + the media-floor matrix.
6. **Consolidate the brief-shaped artifacts and voice profiles** — `creative-brief.ts`,
   `site-dossier-v1.ts`, design brief, and `copy-system-v1.ts`'s `CopyBriefV1` — into one
   business brief that feeds the copy call. Likewise one canonical voice profile: today
   copy-system-v1 (prose voice rules), generated-copy-v2 (`GeneratedCopyVoiceProfileV2` enums),
   and the quality profiles each define voice separately. Overlapping "summarize the business for
   downstream prompts" shapes are accretion, not architecture.
7. **Golden tests:** deterministic planner output for every canonical fixture is snapshot-tested
   (same input → same plan), which the LLM director could never guarantee.
8. Run both planners side by side on the fixture set — this is the clean A/B point. The
   deterministic planner must produce output operators judge ≥ the model director's before 4b.

### Phase 4b — Remove the model director; concentrate creative spend on copy

1. Delete `lib/site-director-plan-generation-v1.ts` (1,063 lines) and the catalog-manifest prompt
   assembly in `generated-site-v3-director-manifest.ts` / `director-constraint-manifest-v1.ts`.
   The director's `creativeDiversityDirective` / `geometryDiversityDirective` strategy fields die
   with it — machinery that pushed per-site differentiation directly against the product's need
   for fleet consistency (while fingerprint-v1 measured the diversity nothing acted on).
2. Move the per-section **copy brief** (point / proof / customer question / avoid) into the copy
   deck call: the planner emits slot shapes; `generated-copy-v2` writes briefs and copy in one
   call on `generationModel` (the strongest model — where the creative budget now goes).
3. Brand expression is owned end-to-end by `brand-expression-v1` (Phase 4a item 4) — cue
   extraction, seed resolution, token generation. No separate brand-derivation path survives 4b.

**Result:** the "which site does this business get" question becomes debuggable, testable, and
consistent. Creative model spend concentrates on the one thing models are reliably great at — copy.

**Estimated removal:** ~2,000–2,500 lines and the largest prompt in the system (40–60KB/call).

### Gate before Phase 5 — prove the replacement before deleting optionality

Phase 5 removes catalog/compiler surface that is cheap to keep and expensive to rebuild. It does
not start until **at least one pilot design system beats current production output** in a
structured subjective review: side-by-side operator review of real fixture businesses — pilot
design system vs. current-pipeline generation vs. the business's existing site and one local
competitor — scored on "would this owner pay." This review loop is the same one Phase 6 uses; the
gate just requires its first win early. (Pilot design-system tuning can and should start in
parallel with Phases 1–3; it is design work, not blocked on any deletion.)

Implementation note: the required evidence is stored as a `design-system-gate-review-v1`
`v3_review_packet` artifact (`lib/design-system-gate-review-v1.ts`). The early Phase 5 gate passes
on the first real fixture review where the pilot design system is the winner and scores above
current pipeline output. Phase 6 still requires 2–3 real fixtures before that design system
graduates to intake. Synthetic verifier fixtures prove the schema only; Phase 5 still requires a
real operator-recorded artifact before trimming public renderer/compiler surface.

### Phase 5 — Catalog and compiler diet

With 5–7 fixed design systems, most of the combinatorial surface is unreachable:

1. Trim `generated-site-v3-visual-controls.ts` (1,090 lines) and
   `generated-site-v3-art-direction-catalog.ts` to the options the design systems actually use.
   Delete enum values with no reachable producer.
2. Trim `generated-site-v3-section-templates.ts` to the templates in the design systems' menus.
3. Shrink `generated-site-v3-compiler.ts` (6,624 lines) accordingly — dead template branches,
   dead control combinations, the director-plan reconciliation paths that no longer vary.
4. `generated-site-v3-quality-profiles.ts` keeps only what section selection and copy voice use.

**Boundary note:** these files back the public renderer. Do this phase behind the full render
verification (`verify:render-browser` + canonical fixture snapshots) and per AGENTS.md make the
customer-visible changes explicit in the change description.

**Estimated removal:** 3,000–5,000 lines depending on how much of the compiler is reachable-only-in-theory.

### Phase 6 — Make the 5–7 design systems actually great (the product work)

This is where the effort freed by Phases 1–5 goes. It's design work, not systems work, and the
pilot system starts in parallel with Phases 1–3 (see the gate before Phase 5). The v4 bake-off
harness concept lives on here as **template discovery**: offline freeform composition runs that
compete against the catalog, with winning section patterns promoted into the catalog by hand.

1. For each design system: hand-tune against 2–3 real fixture businesses until it clears the
   internal bar ("would this owner pay $X/mo, shown next to their current site and a local
   competitor's"). Use the market benchmark corpus as the reference set.
2. **Fix the fixture gap:** canonical fixtures currently pin every design knob to one aesthetic
   (16/16 businesses on `editorial_serif_clean_sans` / `light_editorial` / `open` /
   `hairline_surface`). Rebuild the canonical set so every design system and every menu section is
   exercised by at least one fixture. This becomes the regression surface for Phase 5's trims.
3. Only after a design system clears the bar for its pilot vertical does it graduate to intake.
   Recommended pilot order: auto_body (existing asset library + expression-v4 learnings), then one
   appointment vertical (salon/dental), then trades.

### Phase 7 — Customization at the edit layer

1. Point `AiEditChat` / owner editing at the design-system knob surface: brand tokens, preset
   swaps within the assigned system, copy slots, media choice/crop, section show/hide where the
   menu allows.
2. Guardrail: the edit layer can never emit a state the compiler + deterministic gate wouldn't
   accept. Reuse the gate as the edit-time validator (one more payoff of having exactly one gate).
   The sensitive-claim guardrails in `editor-guardrails.ts` stay deterministic — owner-edit claim
   safety is a boundary-sensitive invariant, per the process rule.
3. **Replace regex intent parsing with model intent classification.** `ai-editor.ts` currently
   routes owner requests via word-boundary regexes (`mentionsHero`, `mentionsCta`,
   `extractRequestedServices` …) — deterministic code doing language understanding, the inverse
   of the taste-lint mistake. The edit layer is the product's customization story; intent parsing
   is a small LLM call that classifies the request onto the knob surface (or to operator review),
   with the deterministic guardrails validating whatever it proposes.
4. Explicitly do not expose: cross-system layout changes, arbitrary colors outside token mapping,
   free-form CSS. If an owner request can't map to a knob, it routes to operator review — that's
   the managed-service promise working as intended.

### Second-wave candidates (after the phases above land; tracked, not scheduled)

- **Deterministic full-site fallback path.** `modelFallbackPolicy: "allow"` lets the pipeline
  produce whole sites with zero LLM calls via deterministic fallbacks — a second parallel
  generation system to maintain. Restrict it to fixtures/tests/renderer verification; real intake
  fails loud (`"fail"`) instead of silently producing a fallback site.
- **Generation-cost machinery** (`generation-cost.ts`, budget gating in readiness/intake). Its
  complexity exists because there were 6–7 metered calls with conditional QA spend. At 3 calls,
  collapse to a simple per-generation counter + cap.
- **`generated-site-v3-quality-profiles.ts` diet** (imported by 8 modules today): after 4b, keep
  only vertical → voice register and section-selection inputs; the control/presentation mappings
  fold into the design systems.
- **`readiness-aggregator-v2.ts` / leftover v2 readiness types**: fold into the Phase 2 gate once
  admin surfaces migrate.
- **`fact-coverage.ts` needs a consumer or deletion**: its only pipeline consumer today is the
  scorecard (deleted in Phase 2). The natural home is Phase 4a section selection — "eligible
  unsurfaced facts" is exactly the planner's input signal. Wire it there or delete it.
- **Duplicate fact-derivation and admin-audit consolidation**:
  `business-context-refresh-v2.sourceFactsFromBusinessProfile()` re-implements what
  `business-fact-graph.ts` owns — consolidate to one exported derivation. Merge
  `business-identity-service-v2.ts` into `business-context-refresh-v2.ts` (both re-analyze the
  same fact graph from separate admin endpoints).
- **One-off report artifacts with no reader** (`asset-selection-v2.ts` report, `image-palette`
  extraction results, `ad-hoc-design-examples.ts`): audit alongside the Phase 1 report-route
  sweep; keep only what an admin surface actually renders.

## 5. What we are explicitly NOT doing

- Not building a design tool or free-form editor (that's Wix; different product).
- Not keeping expression-v4 "just in case." If/when we want a model-as-designer R&D track later,
  it starts fresh as a bake-off against the design systems, and its wins get promoted **into** the
  catalog, never shipped per-site.
- Not adding any new scorer, dimension, or loop during this plan. Quality gaps found along the way
  are fixed in the design systems, section rules, or copy prompt.
- Not preserving legacy shapes for internal surfaces (pre-launch clean-break policy) — but stored
  `SiteVersionV3` reads stay tolerant per the two-tier artifact policy.

## 6. Verification per phase

- Every phase: `npm run typecheck`; `npm run smoke:dev`; `npm run verify:render-browser` for
  Phases 1a (renderer v4 removal), 5, and 6.
- Phase 2/3: regenerate 3–5 fixture businesses end-to-end; confirm gate+judge verdicts are
  produced, one-shot regen fires on an induced failure, and admin candidate pages degrade legibly
  on pre-change rows (stale-schema notice, not error pages).
- Phase 4a: golden-file test — deterministic planner output for the canonical fixtures is stable
  across runs (same input → same plan), which was impossible to assert under the LLM director;
  side-by-side fixture A/B vs. the model director reviewed before 4b.
- Gate before Phase 5: real `design-system-gate-review-v1` artifact recorded and passing (pilot
  design system ≥ current output on real fixtures) before any catalog/compiler trimming.
- Phase 5/6: canonical fixture snapshots (one per design system × device) reviewed side-by-side
  before/after; publish-gate backfill `--check` clean.

## 7. Success metrics

- **The one that matters:** first generation an operator would confidently show a paying customer,
  per pilot vertical — measured by the structured subjective review loop (side-by-side vs. current
  output, the business's existing site, and a local competitor), not by internal scores.
- LLM calls per generation: 6–7 → 3 (+capped vision). Cost per generation should drop ~40–60%.
- `lib/` generation+QA footprint: target 12–18k lines removed across Phases 1–5.
- Same input → same site (deterministic planning), so every quality fix is attributable.
- Zero report-only subsystems: everything that runs either blocks, feeds a prompt, or is deleted.

## 8. Risks and mitigations

- **Sameness across the fleet.** Mitigation: brand-token mapping (their colors/photos/voice) is the
  differentiation surface; design systems × verticals × brand cues gives enough variety for
  non-competing local businesses. Revisit only after sites are good.
- **Deterministic section rules miss odd businesses.** Mitigation: the pre-compile resolution gate
  already blocks unresolved verticals to operator review; that stays. Odd businesses are an
  operator-assisted path pre-launch, not a generation-complexity driver.
- **We might want model-planned layouts later.** Mitigation: the deterministic planner emits the
  same plan shape the compiler already consumes, so a future planner (model or otherwise) is a
  drop-in producer — nothing in this plan forecloses (b); it stops paying for it now.
- **Renderer-touching deletions (v4 sections, catalog trims) regress published previews.**
  Mitigation: repository scan for reachable usages before each deletion; fixture snapshots;
  `verify:render-browser` gating.
