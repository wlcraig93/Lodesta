# Keep sandbox preparation and promotion inside the request

September 9, 2026. Focused infrastructure correction passes full local preflight
and standalone smoke; coordinated deployment and live validation remain pending.
This is not evidence of a successful new site generation.

## Evidence and cause

The latest coordinated release's first synthetic canary timed out on the first
pair of identical concurrent mutations. Both callers observed the same operation
ID, frozen in `running/promoting`. Its second complete canary passed, and a fresh
post-release ten-pair canary also passed. Retain all three observations: the
failure is intermittent, not disproved by a later pass. Exact release and private
evidence identities are in the generated-site authoring status document.

The Worker currently sends a status response before running preparation or
promotion in `ctx.waitUntil`. Cloudflare cancels pending HTTP-triggered background
work 30 seconds after the response ends. The operation holds filesystem locks
across multiple container RPCs; a canceled invocation can leave its lock and
journal behind, preventing subsequent polls from progressing. This is a concrete
lifecycle vulnerability consistent with the failure, not a claim that historical
provider logs conclusively identified this particular cancellation. A hung RPC
can leave similar evidence. [Cloudflare's context documentation](https://developers.cloudflare.com/workers/runtime-apis/context/)

## Smaller implementation

- Mutation submission retains the deterministic request and operation journal,
  then returns `202`. It does not start post-response background work.
- The existing status GET awaits queued preparation or running-operation
  advancement and returns the resulting current journal. Preparation and
  promotion therefore execute while that HTTP response remains outstanding.
- Compilation stays an asynchronous container process. Polls check its progress;
  the Worker does not synchronously wait for the entire compilation.
- Status requests use the existing 150-second general request ceiling, capped by
  the remaining 210-second operation deadline. The old separate ten-second
  status ceiling is removed because this request now performs preparation or
  promotion. The 30-second submission acknowledgement and single identical
  submission replay remain unchanged.
- Acceptance, mutation and finalization locks, immutable generations, atomic
  promotion/readback, journals, and the existing bounded fresh-sandbox recovery
  stay intact. No lock stealing, extra retries, new queue, consumer, scheduling
  layer or model orchestration is added.

An accepted request that is never polled remains queued. Replaying the identical
request and polling drives that same operation. A real client disconnect,
provider termination or indefinitely hung RPC can still abandon work; the
existing deadline and recovery boundary handle that case. This change removes
the routine short post-response lifetime, not every possible process failure.

## Verification and rollout

Execute actual Worker handler/function fixtures with deferred preparation and
promotion. The status response must remain unresolved until that work completes,
without any `waitUntil` calls; submission remains immediate and does not start
the work. Concurrent observers must not steal a live finalizer's lock. Preserve
the earlier queued-journal, process-cleanup and ambiguous-promotion regressions.
Client fixtures verify the request ceiling and remaining deadline together.

Run typecheck, sandbox and full preflight verification, then deploy only through
the coordinated GitHub Actions release. Inspect its first canary as well as the
final outcome. After release, run independent fresh-session synthetic validation
before paid owner-journey and business-site evaluations. A retry or recovered
failure is recorded as such, never relabelled a clean first pass. No retained
customer artifact, authority, model default, copy or visual template changes.
