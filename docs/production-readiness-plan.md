# Production Readiness Plan — From Generated Candidates to Paying Customers

Status: draft v5 (2026-07-09, updated after generation simplification). Owner: Willie + agent sessions.

Supersedes nothing; **absorbs and sequences** the existing plans rather than replacing them.
The generation simplification work makes the canonical engine a deterministic
`SiteDirectorPlanV1`, one brand-expression owner, the deterministic generation
gate, visual QA, and owner-safe edit intent routing. `docs/launch-plan.md`
remains the source for claim / billing / domain mechanics. This document adds
the missing top layer: what "good
enough that a stranger pays" means, the decided control surface, and the ordered path.

## 1. Goal and definition of done

A cold prospect receives a claim link, looks at a site generated for their business
with zero human copywriting or design input, and pays a monthly subscription to keep it.

The funnel IS the metric — and the highest-risk hypothesis is commercial, not
technical: *will cold prospects trust and pay?* Generation quality is a means to
conversion, not the goal. So this plan runs a **concierge revenue test (Phase 1.5)**
gated on a deliberately small entry bar — one vertical, ~20 operator-approved
candidates — not on the full quality program. The standing failure mode to guard
against is the quality program expanding again before the market gets a vote.
The near-term shape is deliberately narrow: **one vertical, one excellent draft,
one real commercial test.** Choice, breadth, and retention machinery are all
downstream of that test.
Everything serves four conversion moments, in order of leverage:

1. **First impression** — "this looks like a real, good website for *my* business,
   not a template." (distinctiveness + identity + copy specificity)
2. **Trust** — "the facts are right and I control them." (truth spine + claim
   verification + rights handling)
3. **Ownership** — "I chose this." (fact verification at claim, the design pick
   once the choice experiment earns its place, facts-first editing)
4. **Retention** — "it keeps getting better without my effort." (propose-and-approve
   improvement loop)

Leading indicators until real funnel data exists: deterministic gate pass rate,
visual QA finding rate, operator first-pass acceptance rate, and operator review
time per candidate. **These are engineering signals, not launch gates** —
from Phase 1.5 onward, prospect feedback sessions and real funnel metrics (open
rate, claim rate, checkout rate, objections) outrank all internal proxies.

## 2. Decided operating model (control surface)

These four decisions are settled (2026-07-02; #2 revised 2026-07-03) and the rest
of the plan encodes them:

1. **Post-publish improvements: propose-and-approve.** Lodesta continuously drafts
   improvements against a shadow draft; the owner is notified and one-click approves.
   Nothing ships without owner action. The permanent guard is: never mutate published,
   owner-approved, or owner-touched stored versions outside the owner/operator draft
   path.
   **Boundary — content vs platform:** this rule governs *stored site versions*
   (copy, facts, design, structure — anything that changes what the site says or how
   it looks as a design decision). It does not govern *platform deployments*: shared-
   renderer bug fixes, security patches, performance, and accessibility corrections
   ship via normal deploys and re-render existing versions without owner approval —
   which is already how the shared-renderer architecture works. If a platform change
   would visibly alter content or design intent, it is a content change and goes
   through propose-and-approve.
2. **Owner design input: a staged choice experiment, not a promised feature**
   (revised 2026-07-03 from "pick 1-of-3 at claim"). The trust frame is "we made
   this for your business," never "pick from a menu." The ladder: single direction
   through the concierge test → **primary + alternate** (the operator-chosen best
   direction presented confidently, one alternate behind a secondary action) as the
   first choice experiment → three directions only if the alternate measurably
   lifts paid conversion. Direction count is a commercial experiment, not a reason
   to resurrect parallel planning systems. The experiment is killed if
   choice increases hesitation or cost without improving paid conversion — if one
   generated site is not persuasive, three will not fix the underlying problem.
   Whatever the owner picks, design is Lodesta-owned afterward.
3. **Owner edit model: facts-first + AI chat.** The owner's primary surface is their
   business data (hours, services, offers, photos, story); the site regenerates from
   it. Free-text requests go through the AI edit chat, which emits typed, validated
   owner-safe intents/mutations or routes to concierge review. Direct text editing
   stays limited to today's safe slots (`lib/v3-editor.ts`).
4. **Launch gate: operator-reviewed.** Every candidate passes human review before a
   claim link goes out. The plan invests in review throughput; autonomy is earned
   later by acceptance-rate evidence, not assumed.

### Who controls what (canonical table)

| Surface | Owner | Lodesta |
|---|---|---|
| Business facts (NAP, hours, services, offers, credentials) | Edits + verifies; canonical author after claim | Extracts, proposes, never publishes unverified |
| Photos, logo, brand assets | Uploads, attests rights, removes | Selects placement, treatment, fallback gallery |
| Copy | Few direct slots (hero/FAQ/contact) + chat requests | Authors everything; lint + fact-consistency gated |
| Layout / composition / responsive | Primary-or-alternate pick at claim (while the experiment runs); nothing after | Owns entirely, including improvement proposals |
| Design system (palette, type, controls) | Indirect via brand assets + the claim-time pick | Owns entirely |
| SEO, schema, performance, a11y, conversion scaffolding | — | Owns entirely |
| Publishing | Approves every publish | Gates every publish (QA + claim gate) |
| Post-publish changes | Approves proposals; initiates via facts/chat | Proposes; never auto-applies content changes |
| Platform/runtime (renderer fixes, security, perf) | — | Deploys without approval; content-neutral by definition |

### The five mechanisms of change (exhaustive)

Every way a stored site version can change, so nothing else grows by accident:

1. **Fact edit → regenerate** (owner, primary): business-profile change recompiles
   affected sections; copy referencing changed facts refreshes through the existing
   copy lint + quality gates.
2. **AI chat → typed mutation** (owner): chat translates a request into the validated
   mutation vocabulary (`rewrite_section_copy`, `swap_presentation`, etc.); invalid or
   out-of-scope requests are declined or routed to concierge.
3. **Direct slot edit** (owner): current v3-editor fields, unchanged scope.
4. **Action-list proposal → one-click approve** (Lodesta-initiated): findings +
   deterministic regeneration/edit output, drafted, QA-gated, owner-approved,
   then published.
5. **Operator concierge** (fallback at early scale): operator applies changes through
   the same admin tooling; same gates.

All five converge on the same path: mutate draft → recompile → QA gates → owner
publish. There is no sixth path for stored versions. (Platform deployments change
rendering code, not stored versions — see the content-vs-platform boundary above.)

## 3. Architecture: four layers, one verifier

Mapping onto code that already exists — this is a naming and policy layer, not a rebuild:

1. **Evidence layer** (regenerable): crawl output, page prose (new), public presence
   signals, asset analysis, review evidence (new, private), dossier (new). Soft-checked,
   regenerable, never a backfill obligation.
2. **Truth spine** (strict): `BusinessFactGraph` / `BusinessFact` / `RenderableFact`
   with provenance, confidence, renderSafety, owner verification. The only
   owner-writable store. Strict schema, backfill-on-change rules apply.
3. **Expression layer** (regenerable intermediates, strict output): business
   understanding, brand expression, deterministic director plan, generated copy
   deck, visual controls → compiler → `SiteVersionV3`. Only the final
   `SiteVersionV3` is strict.
4. **Verification** (the gate stack): deterministic generation gate, render
   inspection, visual QA, and readiness.

**Storage policy change (adopt immediately):** strict stored-schema + per-change
backfill obligations apply to exactly two shapes — public `SiteVersionV3` and the
fact graph. All intermediates (`businessUnderstanding`, `siteDirectorPlanV1`,
`generatedCopyDeck`, `brandExpression`, `brandCueReport`, dossier, and similar
debug artifacts) become regenerable cache: stored for debugging, read with
`siteVersionV3Issue`-style soft checks, regenerated when stale. Update the
"Stored Artifact Schema Changes" section of AGENTS.md to this two-tier rule.
This removes the standing backfill tax on the coupled `generated-site-v3-*`
shapes.

**Regenerable ≠ unaccountable.** Every intermediate keeps a provenance stamp —
prompt/config version (the copy system is already hash-versioned), model id, input
hashes, timestamp, and an explicit stale marker — and the evidence snapshots that fed
a published version are retained for as long as that version exists. "Why did the
site say this?" must always be answerable from stored artifacts, especially once
owners challenge facts. Caches may be regenerated; the audit trail may not.

## 4. Workstreams

### W1 — Ingestion: slurp more, keep it, prove what's used

Premise verified: the crawler retains zero body prose (`CrawlPageSummary` is
metadata + extracted facts only) and understanding sees title/meta/facts for ≤6 pages.
Two salons are near-identical by the time generation starts.

1. **Run the fact-coverage readout first** (`lib/fact-coverage.ts` exists for exactly
   this): measure what the *current* crawl surfaces vs misses on the benchmark corpus.
   Its output decides how much of 2–4 below is funded.
2. **Retain prose:** `mainText` (cleaned, capped per-page and total) on
   `CrawlPageSummary`, populated in the existing DOM walk.
3. **Widen breadth:** raise `maxInternalPages` (currently 6/8) with per-page purpose
   tags, within URL-safety and cost budgets.
4. **Review evidence — private, never rendered, never a claim source.** Ingest
   review text/ratings from public presence sources into the evidence layer as
   non-renderable evidence. It steers *emphasis and positioning* — which services to
   lead with, what tone fits — but never originates factual claims on its own. A
   review-derived claim ("same-day turnaround") publishes only by entering the fact
   graph as an unverified fact and clearing the standard owner-verification gate
   like any other fact; until then it stays internal. Review text never renders as
   quotes and is never attributed. **Direct testimonials publish only when supplied
   by the owner or explicitly licensed** — third-party review text carries platform-
   policy and rights risk that owner confirmation alone does not cure. The owner-
   supplied testimonial flow rides the existing owner-assets rights pattern.
5. **Dossier composer:** deterministic `composeSiteDossierV1()` assembling sectioned
   markdown from prose + facts + presence + understanding + asset/brand notes. No LLM.
   Feeds the deterministic planner and copy prompts; surfaces in a CandidateReviewPane panel.
   Stored as evidence-layer cache (no backfill; old rows simply lack it).

### W2 — Truth spine: the fact graph becomes the owner's product

1. **MVP fact schema (hard boundary):** NAP, hours, services (with per-service
   detail), service areas, credentials/licenses, offers/specials, photos/brand
   assets, social links. That is the v1 owner-editable set. Everything else
   (FAQs-as-facts, payment methods, languages, year established, team) is deferred
   until something in the funnel demonstrates it affects conversion.
2. **Business profile surface:** evolve the owner assets page into a full business
   profile (facts + photos + brand), writing to the fact graph with owner provenance.
3. **Fact-driven regeneration:** a fact change marks dependent sections stale and
   recompiles them through the standard gates. Hours change = one tap, site correct.
4. **Fact-consistency lint (not bind-by-id):** extend the deterministic generation
   gate and content-safety scanners so checkable claims in copy (numbers, hours,
   service names, geography) must trace to spine facts. Full bind-by-reference copy
   was evaluated and rejected as over-engineering; lint achieves the guarantee at
   a fraction of the cost.

### W3 — Expression: deterministic systems, not parallel judges

The generation simplification work collapsed the old design brief, mockup,
scorecard, repair, and LLM-director paths into one canonical expression engine:
deterministic `SiteDirectorPlanV1`, a design-system catalog, one brand-expression
owner, the compiler, and the gate stack. This plan adds only:

1. **Feed the dossier** into the deterministic planner and copy prompts once W1.5 lands.
2. **Copy specificity pressure:** vertical playbooks (`lib/copy-system-v1.ts`,
   in flight) + review themes + prose evidence. Repeated phrase problems should be
   captured through operator review notes and promoted into the deterministic gate
   only when they recur.
3. **Section library targets** (from the audit, priority order): process axis
   (stepper/timeline), signature moments (stat_band, pull_quote_band, full-bleed
   band — exactly one per site), service-page composition v2 (cross-links, process
   snippet, location strip, media), merged location+contact variant. Target ~40–45
   active templates from today's 28; every addition ships with contract-suite
   coverage and detector coverage.
4. **Identity anchors** (workstream D, promoted to first-class): logo extraction v2,
   brand-color derivation into palette candidates with contrast gates, wordmark
   variants. "Feels like my business" is a conversion lever, not polish.
5. **Design directions, N as a dial:** default remains one deterministic direction.
   Primary+alternate or three-direction experiments are generated as separate
   reviewed candidates from the same canonical planner/compiler rails. Each
   direction must compile and pass the gate stack independently; directions that
   fail gates are dropped. If alternates are consistently near-duplicate or visibly
   worse, that is catalog/compiler feedback, not a reason to add another judging
   layer.

**Explicitly deferred:** free-form layout IR / grammar authoring. The composition
planner (bounded intents + deterministic validation + fallback floor) is the chosen
mechanism for structural variety. Escalate only if the fingerprint metric plateaus
below threshold *after* the section library and composition planner are fully
deployed — and then only with the adversarial-harness-calibration and
editor-round-trip gates on record.

### W4 — Verification and measurement

1. **Detector promotion cadence** (workstream E): every human-found defect class
   becomes an automated detector in the same change; warnings during burn-in,
   blocking after two clean weeks.
2. **Benchmark cadence:** weekly generation runs on a mixed-vertical corpus (the
   all-Austin-tire-shops set can't distinguish "system is templated" from "corpus
   is monochrome"). Track gate failures, visual QA findings, operator-review
   outcomes, and review time; regressions block the week's quality-affecting merges.
3. **Repeated-copy and sameness notes** (W3.2) join operator review until they are
   stable enough to promote into deterministic detectors.
4. **Funnel instrumentation from the first outreach (Phase 1.5):** claim-link open →
   picker interaction → checkout start → paid, per vertical (and later per design
   direction). Prospect/owner feedback sessions run alongside — internal metrics
   never gate launch decisions alone.

### W5 — Claim experience (the moment of purchase)

1. **Claim security — ownership verification before power.** A bearer claim link
   alone never grants canonical-owner authority. Before fact editing, billing
   attachment, or publishing: (a) claim links are sent only to independently
   sourced business contacts (crawled site contact, listed business phone/email —
   never an address supplied by the claimant), and (b) the claim flow includes a
   verification challenge against the business's contact of record (code to the
   listed phone/email). During the concierge phase the operator verifies identity
   manually; the challenge automates the same check. Disputed or suspicious claims
   route to the operator.
2. **Primary + alternate presentation (when the choice experiment runs):** the
   claim page leads with the operator-chosen primary direction, full-bleed and
   confident — "we made this for your business" — with the alternate behind a
   secondary action ("prefer a different feel?"), desktop/mobile previews for both.
   Never a symmetric menu: a confident recommendation with one escape hatch reads
   as a designer who listened; a 3-way grid reads as a template store. The operator
   picks the primary during review; the owner may swap. **Owner-swap rate is a
   first-class signal** — every time an owner overrules the operator's pick, that
   is direct data on what generation and review are misjudging.
3. **Capacity and unit-economics model (prerequisite for scale decisions):** a
   maintained sheet/script computing — LLM + compile cost per candidate (×
   directions), render/QA compute, operator review minutes per candidate,
   candidates/day per operator, gate-failure drop rate, unpaid-candidate rate,
   failed-claim rate, downstream conversion, refund/chargeback rate, manual support
   minutes per customer per month, domain costs — yielding cost per paid customer
   AND expected payback period against churn. Cost-per-paid-customer alone is
   misleading if early churn is high; payback period is the decision number.
   Outreach volume and direction count are arithmetic decisions against this
   model, not vibes. First populated with real numbers in Phase 1.5.
4. **Operator decision + throughput.** Deterministic checks and the one model visual
   judgment carry the diagnostic detail. The operator records one explicit
   `approved_for_outreach` or `needs_work` decision with rationale, review time, and
   any consciously accepted defects; the operator does not re-score the same site
   across another set of dimensions. Throughput work: side-by-side direction
   comparison, one-look accept, keyboard-driven queue triage, batch archive.
   Review-time targets come from the capacity model rather than a fixed guess; the
   operator is the launch-phase rate limiter, so their tooling is production
   infrastructure, not admin chrome.

### W6 — Paying-customer operations (retention machinery)

Gaps identified for a business that charges monthly. **Build order and scope are
set by Phase 1.5 evidence** — items here are candidates, not commitments:

1. **Owner dashboard:** one page per site — status, pending proposals, recent
   inquiries/analytics, business profile link, domain status, billing link.
2. **Email notifications:** proposal ready, draft awaiting publish, inquiry received
   (daily digest), payment failure. No email = the propose-and-approve loop stalls.
3. **Stripe customer portal** for subscription management, payment history, receipts,
   cancellation. Buy, don't build.
4. **Propose-and-approve loop, productionized:** deterministic regeneration or
   owner-safe edit proposals run against a draft clone, never the published version
   → proposals land in the action list → notification → one-click approve → gates →
   owner publishes. Monthly cadence via the existing job scheduler. This converts
   every future generator improvement into visible customer value — the core
   retention argument for the subscription.
5. **AI edit chat v1:** wire `AiEditChat` to the owner-safe mutation subset with the
   same gate path. Concierge (operator) handles what chat declines.

### W7 — Commercial launch slice (defined before outreach, not after)

One page, written before Phase 1.5 begins, answering:

- **Vertical(s):** one or two, chosen for benchmark-corpus strength + reachable
  prospect lists (e.g., auto services, where the corpus and image library are deepest).
- **Offer and price:** monthly price point, what's included (site, domain, edits,
  monthly improvements), setup fee or none.
- **Terms and ownership (trust-critical, decided before first checkout):**
  - Domain: registered in the owner's name or transferable to them on request;
    never held hostage.
  - Cancellation: what happens to the site (grace period, static export offered,
    domain transfer), written as policy.
  - Included service: edit/support limits per month, what routes to concierge vs
    is out of scope.
  - Refunds: e.g., full refund in first 30 days, cancel anytime.
  - Marketing rights: whether Lodesta may use generated drafts/screenshots in its
    own outreach and portfolio, stated explicitly.
- **Outreach trust posture (a generated site for someone's business can read as
  impersonation if handled clumsily):**
  - Candidate previews stay token-gated and no-indexed (already true today:
    unclaimed sites 404 on `/sites/*` and previews are token routes) — verify and
    keep it that way.
  - Every preview carries a visible label: a draft prepared by Lodesta, not the
    business's official site.
  - Takedown on request, immediately and unconditionally.
  - Cold-email compliance: identified sender, physical address, working opt-out,
    suppression list honored across campaigns.
- **Outreach channel:** how claim links reach verified business contacts, expected
  open/claim/checkout rates to compare reality against.
- **Capacity:** operator hours available, candidates/week, from the W5.3 model.
- **Kill/scale criteria:** the payback-period ceiling from W5.3 and the minimum
  conversion that justifies scaling outreach.

## 5. Sequencing

Phases gate on evidence, not calendar. Each phase's exit criteria are measurable.
The claim → Stripe → publish infrastructure already works, so revenue testing does
not wait for the retention machinery.

- **Phase 0 — Land and stabilize (now).** Finish and land the in-flight work
  (archetype/geometry diversity, director expansion, copy-system versioning, asset
  rights). Adopt the two-tier storage policy + provenance stamps + AGENTS.md update.
  Stand up weekly benchmark cadence on a mixed-vertical corpus.
  *Exit:* clean tree, typecheck + contract suites green, first weekly vector report.
- **Phase 1 — Quality to "operator proud" (continues in parallel after 1.5 starts).**
  Bespoke-plan workstreams B/C/D/E to completion; W1 ingestion (fact-coverage
  readout → prose → dossier → review evidence); W3.2 copy specificity; service
  pages v2. Scoped to the W7 vertical(s) first — depth in one vertical beats
  breadth across ten. **This phase does not gate revenue contact**: as soon as the
  Phase 1.5 entry bar below is met, outreach begins and the remaining Phase 1 work
  proceeds alongside it, re-prioritized by what prospects actually object to.
  **Scope armor (hard constraints until 1.5 reports):** no owner-facing choice UI,
  no dashboard, no AI edit chat, no retention loop, no automation beyond what
  helps generate, review, and send one good candidate. Internally, generation may
  produce alternates for the operator; the prospect sees only the best one.
  *Exit:* deterministic gate and visual QA pass on the target-vertical corpus;
  zero blocking render defects across the 12-combo audit; operator first-pass
  acceptance ≥ 70% against the W5.4 rubric; 3–5 prospect feedback sessions on real
  candidates ("would you pay for this?") with reactions recorded.
- **Phase 1.5 — Concierge revenue test.** The commercial hypothesis test, run thin.
  **Entry bar (deliberately smaller than Phase 1's exit):** one vertical; ~20
  candidates approved against the W5.4 rubric, with the operator able to say, for
  each, why it is sendable — and known defects either fixed or explicitly accepted
  for the test; previews token-gated, no-indexed, and draft-labeled; W7 written
  including terms, trust posture, and price; manual ownership-verification process
  defined; Stripe checkout → claim → publish path tested end to end on a test
  business.
  Then: send real claim links to verified business contacts, take real payments,
  and handle edits/support/billing questions manually through the operator
  concierge path. Single design direction. No dashboard, no notifications, no
  chat — the operator is all of those.
  *Measure:* open rate, claim rate, checkout rate, objections verbatim, review time,
  edit-request themes, support minutes per customer, refunds, payback period
  against the W7 ceiling.
  *Exit:* a go/scale/pivot decision, and an evidence-ranked build list for Phases
  2–4 (which retention features the first customers actually asked for, whether
  prospects want design choice at all, where claim friction actually is).
- **Phase 2 — Claim experience at throughput.** Automated claim verification
  challenge; review-pane throughput work. The choice experiment ships staged:
  single-direction stays the default until 1.5 evidence suggests prospects want
  choice, then primary + alternate runs as an A/B against single-direction —
  choice friction and the multiplied generation/review cost are real, so each rung
  of the ladder (1 → primary+alternate → 3) must pay for itself in measured *paid*
  conversion, not clicks.
  *Exit:* capacity model populated with real per-candidate costs; primary+alternate
  lift measured (expand to 3, hold, or kill the experiment); owner-swap rate
  baselined; median review time meeting the model's target.
- **Phase 3 — Scale what 1.5 validated.** W2 business profile + fact-driven
  regeneration; the W6 items the evidence ranked highest (dashboard, notifications,
  Stripe portal in likely order). Outreach volume scales against the cost ceiling.
  *Exit:* fact-edit → republish round-trip works without operator help; support
  load per customer trending down; zero publish-gate violations in production.
- **Phase 4 — Managed flywheel.** Propose-and-approve loop live on published sites;
  AI chat v1; experiments framework carrying real traffic.
  *Exit (retention is the metric, not activity):* paid-customer retention/churn at
  target; support minutes per customer trending down; leads/contact events
  delivered to owners trending up; owner satisfaction sampled. Proposal acceptance
  rate is a secondary signal only — "improvements shipped per month" is explicitly
  NOT a success metric, because it incentivizes cosmetic churn over customer value.

Remove the pre-launch section of AGENTS.md when Phase 3 exits.

## 6. Non-goals

- No free-form layout IR or per-site HTML/CSS. Composition planner + growing catalog
  is the variety mechanism until the metric proves it insufficient.
- No owner page-builder, theme picker, or post-claim design controls.
- No symmetric design menus. If claim-time choice survives its experiment, it
  stays primary + alternate — a confident recommendation with one escape hatch,
  never "pick a template."
- No autonomous mutation of stored site versions, ever — propose-and-approve is
  permanent for content; platform deployments are the deliberate, bounded exception.
- No published third-party review quotes; testimonials are owner-supplied or
  explicitly licensed only.
- No model-freehanded facts; unverified facts never publish.
- No canonical-owner powers from a bare claim link; verification always precedes
  fact editing, billing, and publishing.
- No autonomous outreach without operator review until acceptance-rate evidence
  justifies a spot-check model.
- No trial/freemium tier, multi-language, or ecommerce in this plan's scope.

## 7. Risks and honest unknowns

- **The commercial hypothesis may fail.** Prospects may not trust cold links, may
  balk at price, or may want a human relationship. Phase 1.5 exists to learn this
  for the cost of a few weeks of operator time instead of the full build. Objections
  and feedback sessions are first-class deliverables, not anecdotes.
- **Distinctiveness may be a treadmill.** A bounded catalog converges as volume
  grows; the section library needs sustained investment. Mitigation: structured
  operator review captures sameness and direction-level conversion data will show
  whether buyers actually feel it.
- **Proxy theater.** Internal metrics (gate pass rate, visual QA finding rate,
  review scores) can improve while conversion doesn't. Guard: from Phase 1.5
  onward, no launch-scope decision is made on internal metrics alone.
- **Approval stall.** Propose-and-approve dies if owners ignore emails. Watch
  proposal-acceptance latency in Phase 4; if it stalls, revisit the tiered/auto-apply
  question with data.
- **Claim fraud/abuse.** Competitors or bad actors claiming businesses they don't
  own. Mitigated by W5.1 verification; residual risk (spoofed contacts, stale
  listings) routes to operator review.
- **Outreach reputation.** An unsolicited generated site can read as impersonation
  or spam, and one angry business owner posting about it costs more than a hundred
  sends earn. The W7 trust posture (draft labeling, no-index, instant takedown,
  email compliance) is the mitigation; it is non-negotiable from the first send.
- **Single-provider model dependency.** The pipeline is OpenAI-only (4–7 calls/site).
  Not urgent pre-launch; provenance-stamped prompts/configs (Section 3) keep
  provider evaluation cheap.
- **Concierge doesn't scale — by design.** Phase 1.5's manual support load is the
  discovery mechanism for what to automate; the risk is staying concierge too long.
  The W7 kill/scale criteria force the decision.

## 8. Verification checklist (per change, unchanged habits)

- `npm run typecheck` after TS/route changes; V3 contract suites on
  compiler/catalog/grammar changes; `npm run verify:render-browser` on renderer
  changes; `npm run smoke` / `smoke:dev` on launch-flow changes.
- Before catalog/compiler trims, require a real passing `design-system-gate-review-v1`
  artifact from side-by-side operator review; verifier fixtures only prove the schema.
- Backfill `--check` before any new strict assertion over the two strict shapes.
- Weekly `run-benchmark-vector` report reviewed; regressions investigated before
  further quality-affecting merges.
- Every human-found rendering defect gets a detector in the same change.
- Funnel metrics reviewed at every phase gate from 1.5 onward.
