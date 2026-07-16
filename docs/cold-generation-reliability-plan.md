# Cold Generation + Worker Reliability Plan

Status: merged v2 (2026-07-03) — supersedes the v1 draft in this file and the
standalone "Cold Generation + Worker Reliability" proposal; this is the
canonical doc. Owner: Willie + agent sessions.
Parent: `docs/production-readiness-plan.md`. This sprint IS the Phase 0 exit /
Phase 1 entry: **the first valid weekly vector report on a real corpus is the
Phase 0 exit artifact.** That framing is load-bearing — this is a step in the
revenue plan, not an infrastructure project with its own gravity.

Trigger: the first live `benchmark:vector:weekly` run correctly failed with
`scoredTargets: 0` against six real US businesses. The zero-score guard worked;
the failures it surfaced are the same failures a real prospect's URL would hit
in the concierge test, which makes Track 1 the critical path to revenue, not
just to a green report.

## Order of work

1. **Track 1 diagnostics** (typed failures, report fidelity, preflight) — ~day one.
2. **Track 1 fix loop** — re-run the six known URLs, classify, fix at the root,
   regression fixture per class.
3. **Track 2 core** (worker visibility) — gated: starts only after Track 1
   diagnostics land and the six-URL re-run is classified. Track 2 is the more
   fun build; the gate exists so it cannot absorb the week.
4. **Track 3 (GTM parallel)** — runs throughout; no code dependencies.

## Diagnosis recap (2026-07-03, verified)

Three distinct problems behind the single exit code — the OpenAI key was
verified working, so "model unavailable" is ruled out:

1. **Model output rejected by validation** (yostauto.com, radiantplumbing.com:
   director plan failed validation; austintireman.com: copy deck returned
   null). Canonical mode correctly refuses deterministic fallback and throws
   ([lib/site-candidate-service.ts:353](../lib/site-candidate-service.ts)).
   Prime suspect: drift between prompt and validator after the recent catalog/
   manifest landing — `lib/director-constraint-manifest-v1.ts` and the
   validator must be generated from the same manifest.
2. **Pre-compile blocks reported without reasons** (qualitybodyshopaustin.com,
   birdsbarbershop.com, esteatx.com): resolution-gate blockers exist in the
   `_precompile_block` / `identity_reconcile_report` artifacts, but the
   benchmark reporter only reads `qa?.blockers` (empty for pre-compile blocks)
   and truncates error strings mid-JSON.
3. **Corpus problems**: the mixed set was Framer/Webflow template showcases —
   rejected by the US-only check, asset-fetch failures, pre-compile blocks.
   Not valid generation targets and not representative of prospects.

## Track 1 — Cold generation reliability

### Typed generation failure metadata

Every generation failure carries, from throw site to report:

- `stage`: `queued | crawl | precompile_gate | asset_analysis | director |
  copy | compile | qa`
- `code`: stable machine-readable reason
- `message`: full human-readable error — never parsed from strings, never
  truncated
- `jobId`, `runId`, `siteCandidateId?`
- `validationIssues?`, `blockers?`, `artifactRefs?`

For thrown director/copy failures, carry `siteCandidateId` and stage in the
thrown error, or persist a failed-generation artifact before throwing —
failures must be durable, not just report-visible.

### Benchmark report fidelity

`run-benchmark-vector` target records include: `status`, `stage`,
`candidateId`, `adminReviewUrl`, `blockers` (fetched from the persisted
pre-compile artifact — exact ids/titles/details), `errorDetail`,
`validationIssues` (structured, not clipped strings), `vector`, `coverage`,
`costEstimate`. Per-run cost totals seed the W5.3 capacity model with real
numbers.

### Target preflight

A preflight command runs before any weekly spend: rejects non-US,
demo/template, multi-location-risk (heuristic — blocking with operator
override, not pretended precision), non-crawlable, and missing-NAP/services
targets, and produces a checked pass/fail report with reasons. No model spend
on targets that cannot pass the gates.

### Corpus

Checked-in benchmark target file (consumed via
`LODESTA_BENCHMARK_TARGETS_FILE`): 12–18 real US single-location businesses,
4–6 verticals, **≥3 targets per measured vertical** (pairwise
fingerprint/copy-overlap metrics need ≥2 scored; the third is slack for
failures — which is why acceptance below says ≥2 scored). Not active outreach
prospects. Template showcases remain visual references only.

### Strictness (unchanged, deliberate)

- No deterministic director/copy fallback in canonical/benchmark mode.
- No loosening pre-compile gates to make reports green.
- Zero-score guard remains blocking. It just paid for itself.

### Fix loop

1. Re-run the six known failing URLs after typed diagnostics land.
2. Classify each failure: schema/prompt/validator mismatch, catalog or
   manifest drift, extraction gap, correct pre-compile block, transient
   provider failure.
3. Fix structural classes at the root; add a regression fixture per class to
   the contracts/verify suites.
4. Make copy-deck nulls impossible to hide: typed failure distinguishing
   timeout, refusal, invalid JSON, lint rejection, and empty output.
5. Retry transient provider failures once (via `lib/timeout-config.ts`
   budgets). Never retry deterministic validation failures — that burns money
   and hides the bug.
6. Resolution-gate triage for the three blocked real businesses: run
   `scripts/inspect-candidate.ts` per candidate; classify extraction gap
   (fix — restaurants/salons usually publish name/phone/address in JSON-LD;
   missing those is our crawler bug) vs correct strictness (Birds Barbershop
   is multi-location, out of launch scope — likely a *correct* block and a
   corpus-selection lesson).

### Track 1 acceptance criteria

- First valid weekly vector report exists against the new corpus (Phase 0 exit).
- Every target is either scored or precisely blocked/failed with a
  self-sufficient reason — no clipped errors, no empty `blockers` on a blocked
  candidate.
- ≥2 scored targets per measured vertical feeding same-vertical
  fingerprint/copy-overlap metrics.
- Regression coverage exists for each validation-failure class fixed.
- The three real-business blocks are each fixed or documented as correct.

## Track 2 — Worker reliability (core only; gated on Track 1 diagnostics)

Premise (verified): `npm run dev` supervises web + worker via
`scripts/dev.mjs`; `dev:web`/`dev:raw` are web-only; intake status already has
a rudimentary `active | not_processing` worker state. A generation that waits
silently is a worker health/visibility bug, and the Track 1 fix loop is itself
the best stress test of this surface.

### Core scope (build now)

- **Worker heartbeat, separate from job heartbeat** — idle workers must prove
  they exist. Every 2s while alive: `workerId`, pid/host, repository mode,
  `startedAt`, `lastSeenAt`, `currentJobId`, `currentJobKind`. Stale at 10s
  (dev UI warning) / 30s (deployed warning).
- **Honest intake states** — never ambiguous "waiting" past 10s:
  - queued + no live worker heartbeat → `worker.state = "not_processing"`
    ("worker is not running"), with repository-mode mismatch warning when
    detectable (web and worker in different repository modes makes jobs
    mutually invisible — a known class).
  - queued behind a running generation → `"busy"` with the occupying job's
    details.
  - running → current span + elapsed; failed → typed failure code +
    requeue/retry guidance.
- **Minimal worker/queue status endpoint** for the intake UI: active worker
  count, queue depth by kind/status, oldest queued age, running jobs with
  `lockedBy`/`lockedAt`/current span.
- **Dev startup visibility**: `npm run dev` prints web URL, worker id/pid,
  poll interval, repository mode. Add `npm run dev:worker` (worker only) and
  `npm run worker -- status`.
- **Escape hatches**: requeue stale job, process-one-now;
  `npm run worker -- process-once` and `/api/jobs/process` remain manual paths.
- Preserve existing job locks and stale-lock recovery.

### Explicitly deferred (do not build this sprint)

- **Priority lanes.** With one worker and one operator, "maintenance never
  blocks interactive" is solved by process-now; queue priority is a
  distributed-systems feature purchased before there's a queue worth
  prioritizing. Revisit when queue-age warnings actually fire in practice.
- **Concurrency knob.** Default stays one serialized generation worker.
  Raising it is opt-in *after* visibility has been proven in daily use.
- Queue-age warning thresholds beyond the two stale thresholds above.

### Track 2 acceptance criteria

- `npm run dev` shows a visible worker startup line and live heartbeat.
- A queued generation resolves to one of `queued_waiting_for_worker`,
  `queued_worker_busy`, `running`, `blocked`, `ready`, `failed` within 10s.
- Kill the worker → UI reports no active worker within 10s; restart → queued
  job is claimed.
- Worker runtime tests cover heartbeat freshness/staleness, busy status, and
  dev startup assertions.

## Track 3 — GTM parallel (runs throughout; zero code dependencies)

- Write and sign off W7: price, terms, refund policy, domain ownership,
  trust posture.
- Define the manual ownership-verification runbook.
- Candidate approval toward the ~20-candidate entry bar starts as soon as the
  Track 1 fix loop lands for the target vertical — the same fixes gate the
  benchmark and real prospect generation.

Without this track stated, revenue silently serializes behind engineering.
It must not.

## Test plan

- Unit: typed failure serialization; benchmark report records for pre-compile
  block, director validation failure, copy lint failure, transient provider
  failure, and scored success; worker heartbeat freshness/staleness; intake
  status transitions.
- Integration: `npm run verify:worker-runtime`, `verify:job-heartbeat`,
  `verify:deployment-config`, `verify:deterministic-site-director-plan`, and
  `benchmark:vector:weekly` on the preflighted corpus.
- Manual smoke: start `npm run dev`; queue a generation; confirm status
  changes within 10s; kill worker → UI detects; restart → job claimed.

## Definition of done (sprint)

1. First valid weekly vector report on the preflighted corpus — the Phase 0
   exit artifact.
2. Every failed/blocked target in that report carries a precise,
   self-sufficient reason.
3. Regression fixture per validation-failure class fixed; three real-business
   blocks fixed or documented as correct.
4. Worker states are honest within 10s in dev; escape hatches work.
5. W7 signed off and the verification runbook written (Track 3 does not slip
   because engineering ran long).

## Hygiene (from this incident)

- Land the ~6k uncommitted lines with a descriptive message before Tracks 1–2
  churn the same files. No more "." commit messages — bisecting a 38k-line dot
  commit during a regression hunt is avoidable pain.
- Weekly cadence stays operator-run (or internal scheduler) — no GitHub
  Actions scheduled benchmark until secret handling is deliberately approved.
- Keep canonical strictness exactly as is; a regression in the weekly report
  blocks that week's quality-affecting merges (parent-plan rule).
