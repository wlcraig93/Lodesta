# Keep sandbox preparation and promotion inside the request

## September 18: failure handling must not reuse a broken connection

The request-bound correction below remains necessary, but it does not make an
interrupted RPC connection usable. The independent canary on release `349ef110`
left a journal in `running/preparing` with a mutation lock and no matching build
process. Cloudflare logged an inactive Durable Object at the same time. This
correlation does not identify the exact preparation-owner call or the originating
provider cause.

Cloudflare documents that exceptions can leave a Durable Object stub broken, and
subsequent requests require a new stub. The pinned Sandbox SDK captures one stub
per `getSandbox` call. Lodesta currently reuses that handle for failure recording,
cleanup, and promotion readback. A local fault fixture separately proves that a
failed terminal-journal write bypasses cleanup and leaves later polls observing
the retained state. [Cloudflare error-handling contract](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)

The scoped correction uses a fresh, lifecycle-configured
handle only for owned failure finalization or ambiguous-promotion readback. It
does not retry the failed business mutation. A process-start request is treated
as potentially committed before its response arrives, so response loss cannot
trigger destructive candidate cleanup. If finalization is itself unavailable,
the client propagates the explicit `sandbox_operation_failed` response to the
existing controller replacement boundary instead of polling a stranded journal.

No new queue, journal state, stale-lock threshold, retry count, deadline, or
model orchestration is introduced. Only the lock owner may attempt its cleanup;
an ambiguous cleanup response never licenses another removal. The controller's
existing single destroy/restore/replay remains responsible for infrastructure
recovery. A silently canceled owner whose HTTP error never arrives is still
bounded by the existing 210-second operation deadline; no observer guesses that
a live owner has died. Retained artifacts and current published sites are not
rewritten by this correction.

Acceptance requires poisoned-handle, terminal-write, process-start ambiguity and
promotion-readback fixtures; client-to-controller recovery; full preflight; a
coordinated deployment; independent cold/warm and restart tests; and an ordinary
private retained-source edit. Local tests alone are not hosted acceptance.

Local verification passes: TypeScript, the full static preflight, browser and
sandbox suites, and isolated launch-flow smoke. The initial browser attempt was
blocked by the local execution environment's Chromium launch permission; the
authorized browser/sandbox rerun passes. This is complete phase coverage, not
one uninterrupted preflight invocation. Hosted deployment and independent
acceptance remain pending.

### Architecture assessment and limit of this correction

Isolation, a last-known-good generation, immutable checkpoints and exclusive
mutation ownership protect actual product requirements. The complexity under
review is execution ownership: status requests currently prepare and promote
work, compilation outlives those requests, and locks and journals must bridge
their interruption boundaries. This is not a model-quality problem, and it is
not evidence that every observed failure originates in Railway or Cloudflare.

The fresh-handle correction fixes an SDK-contract violation; it does not prove
the cause of the provider interruption. An explicit `sandbox_operation_failed`
response can also originate from an observing request, not just the preparation
owner. Fail-fast recovery therefore does not assert that the owner has stopped:
the existing controller must confirm sandbox destruction before restoring the
retained checkpoint and replaying the pending mutation. Failed destruction must
remain fenced, never overlap a replacement execution.

A possible simpler successor would give one executor ownership of preparation,
build and activation, leaving status polling read-only. That design is not part
of this patch and has not been validated. If the scoped correction merely moves
the stranded-operation failure to another phase, retain that evidence and
reassess the execution boundary rather than declaring reliability or layering
on additional retries, lock stealing or timers. A successful canary followed by
a failing independent test is a failed acceptance, not a pass with caveats.

## September 9: request-bound execution correction

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
