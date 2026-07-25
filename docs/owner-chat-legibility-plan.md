# Owner Chat Legibility

Status: proposed
Date: 2026-07-24

## Decision

The owner workspace chat panel shows what Lodesta is doing while it works, using the run
event stream Lodesta already records. Today that stream is captured in full, rendered
richly for admins, and collapsed to a seven-state enum before it reaches the owner. The
gap between the owner panel and a comparable agent surface is a presentation gap, not a
capability gap.

This plan surfaces existing intermediates. It does not change how the model works.

## Problem

Four separate defects combine into "sparse and clunky."

**The detail is discarded at the owner boundary.** `SiteAgentRunEvent`
(`packages/site-contracts/index.ts:584`) records every `run`, `turn`, `model_request`,
`tool_call`, `build`, and `inspection` with name, status, timings, and a bounded summary.
`packages/site-platform/run-events.ts` persists all of it and
`components/admin/RunTelemetryInspector.tsx` renders it. The owner receives
`ownerSiteAgentRun()` (`packages/site-platform/owner-run-view.ts:15`), which flattens the
entire stream into one of seven hardcoded label/detail pairs
(`packages/site-platform/owner-run-view.ts:45-80`). A twelve-minute initial build with
forty tool calls displays as the single string "Designing your website."

**There is one agent message per run.** The workflow appends a `role: "agent"` message at
completion (`packages/site-platform/workflow.ts:1184` and siblings). A transcript is
therefore: owner instruction, a long silence under one static status line, one closing
paragraph. Nothing marks progress between those points.

**The poll is expensive, so progress must stay coarse.**
`components/SiteAgentWorkspace.tsx:197-203` polls `/api/site-agent/sessions` every 1800ms.
That handler (`app/api/site-agent/sessions/route.ts:32-60`) reloads the site, every
version, every build artifact, and re-derives publication readiness on each call. The
interval cannot be shortened because the work per call is unbounded in the number of
versions. No streaming exists anywhere in the repository.

**Messages render as unstructured text.** `components/SiteAgentWorkspace.tsx:570` renders
`<p>{message.content}</p>` with `white-space: pre-wrap`. No emphasis, lists, page
references, or timestamps survive.

A fifth defect compounds the others: when `retryableByOwner` is false, the panel ends the
conversation with "Lodesta is reviewing an internal problem. You do not need to keep
retrying" (`packages/site-platform/owner-run-view.ts:42`) and offers no action at all.

## Doctrine and boundary check

This work is presentation of records Lodesta already writes. It adds no planning phase,
mandatory tool sequence, per-action budget, critic, repair continuation, or convergence
check, and it does not sit between the model and its workspace. The Simplification
Doctrine is not engaged.

`SiteAgentRunEvent` is an explicitly regenerable intermediate under the Stored Artifact
Schema policy, so reshaping its owner projection is a clean cut with no retained-payload
version bump and no backfill.

The owner workspace is a boundary-sensitive surface, so its reads keep strict assertions.
Two boundary rules govern the new projection:

- The projection is allow-list only. Model identity, provider identity, token counts,
  cost, request ids, payload references, and internal hashes never cross into an
  owner-facing payload.
- Chat text and activity items are advisory. They never gate a candidate, never affect
  publication readiness, and are never an input to verification.

The design language already specifies the target pattern:
`docs/design/lodesta-product-design-language.md:27` requires agent activity to be legible
through "stages, statuses, evidence, and outcomes," and line 135 describes a run-stage
timeline showing "stage, state, timestamp or duration, and important output." Amber is
reserved for intelligence and attention signals, so ordinary in-progress activity stays
neutral or forest-tinted.

## Owner run activity projection

Add `ownerRunActivity()` beside `ownerRunProgress()` in
`packages/site-platform/owner-run-view.ts`, producing one owner-safe item per event:

```ts
export type OwnerRunActivity = {
  id: string;
  sequence: number;
  kind: "thinking" | "edit" | "image" | "build" | "review" | "question";
  label: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  durationMs?: number;
  detail?: string;
};
```

Event names are the manager tool names (`packages/site-agent/contracts.ts:56-67`), mapped
to owner language:

| Event | Activity kind | Owner label |
| --- | --- | --- |
| `model_request` | `thinking` | Thinking |
| `list_files`, `read_file` | `thinking` | Reviewing the current website |
| `write_file`, `apply_patch` | `edit` | Editing *path* |
| `delete_file` | `edit` | Removing *path* |
| `create_image` | `image` | Creating an image |
| `build_preview` | `build` | Building the preview |
| `inspect_site`, `finish` | `review` | Checking the website |
| `request_input` | `question` | Waiting for your answer |

`turn` events are structural and are not rendered as items; they define grouping
boundaries. `run` events map to the existing stage progress line and are not duplicated.

Consecutive items of the same kind collapse into one expandable row labelled by count, so
a long build reads as a short list of grouped phases rather than forty lines.

Path detail requires a small emission change. The tool_call summary at
`packages/site-agent/manager.ts:227` currently carries
`{ callId, inputHash, outputHash, ok, replayed }`. Add the workspace-relative paths for
`write_file`, `delete_file`, and `apply_patch`. Summary is bounded and sanitized
(`packages/site-platform/run-events.ts:145-162`) and is stored inline on the row, unlike
`payload`, which lives in blob storage under a 24-hour retention
(`packages/site-platform/run-events.ts:8`). The projection reads summary only, so it
stays correct after payload expiry.

Failures map through the existing owner failure guidance rather than exposing
`errorCode`: a failed activity shows its label with a failed status, and the run-level
explanation continues to come from `ownerRunProgress`.

## Owner events endpoint

Add `GET /api/site-agent/runs/[runId]/events`, authorized with the same
`authorizedSiteActor` check used by the session routes. It returns projected
`OwnerRunActivity` items only — never raw `SiteAgentRunEvent`.

`SitePlatformRepository.listAgentRunEvents(runId, { afterSequence, limit })` already
exists (`packages/platform-data/repository.ts:195`) and is indexed on `(run_id, sequence)`
(`supabase/migrations/202607230009_site_agent_model_routing_telemetry.sql:61`).

One cursor subtlety must be handled explicitly. `sequence` is
`generated always as identity` (`supabase/migrations/202607230001_canonical_baseline.sql:276`)
and events are upserted by id, so an event that opens as `running` and later closes as
`succeeded` **keeps its original sequence**. A naive `afterSequence` cursor would never
observe that status transition. The endpoint therefore returns two sets on each poll:

1. all events with `sequence > cursor`; and
2. all events for the run still in `running` status, regardless of sequence.

Set two is bounded by the number of concurrently open spans, which is small. The client
merges by event id.

## Poll split

Separate the hot and cold paths currently fused in
`app/api/site-agent/sessions/route.ts:32-60`.

The hot path is the run list plus the events cursor. It is cheap, bounded, and safe to
poll at roughly 700ms while a run is active.

The cold path is site, versions, `versionRoutes`, artifacts, and readiness. It is
refetched on run stage transitions, on run completion, and on explicit owner actions
(publish, restore, version selection) — not on a timer.

This removes the repeated `getBuildArtifact` fan-out and readiness derivation from the
polling loop, which is the direct cause of the panel feeling sluggish. Streaming is not
required to reach a responsive panel and is deliberately out of scope; the split alone
makes a sub-second interval affordable.

## Message quality

**Mid-run narration.** Permit `role: "agent"` messages to be appended at turn boundaries
instead of only at run completion. The manager already produces assistant text per turn;
this passes existing output through rather than requesting new output or adding a step.
These messages are advisory chat text under the boundary rules above.

**Constrained markdown.** Replace the raw text node at
`components/SiteAgentWorkspace.tsx:570` with a small renderer supporting bold, italic,
inline code, links, and unordered lists. No raw HTML, no arbitrary embeds. Links are
restricted to same-origin workspace routes and the owner's own published site.

**Timestamps and grouping.** Group messages and activity into run-scoped blocks with a
relative timestamp on each block rather than per message.

## Evidence and exits

**Screenshots.** Runs already capture `run.screenshotKeys`, but the capture route is
admin-gated (`app/api/admin/runs/[runId]/captures/route.ts:7`). Add an owner-authorized
equivalent scoped to runs on sites the caller owns, and show captures inline at
`verifying` and `candidate_ready`. This delivers the evidence-forward requirement in the
design language.

**Every terminal failure gets one action.** Retryable runs keep the existing retry
control. Non-retryable runs offer "Ask Lodesta about this," which opens the composer in
`ask` mode against the existing `/api/site-agent/discuss` endpoint with the failed run in
context. The transcript never ends on a wall.

## Sequencing

1. **Activity timeline.** Summary path enrichment, `ownerRunActivity()`, the owner events
   endpoint with the dual-set cursor, and grouped timeline rendering.
2. **Poll split.** Hot and cold paths separated; interval reduced.
3. **Message quality.** Constrained markdown, then mid-run narration.
4. **Evidence and exits.** Owner capture route, inline screenshots, failure actions.

Steps 1 and 2 are the substance and should ship together; they close the detail gap and
the responsiveness gap respectively. Steps 3 and 4 are independent and can land in either
order.

## Out of scope

Server-sent events and websockets. Token, cost, or model routing disclosure to owners.
Any change to authoring behavior, tool set, guardrails, verification, or the release
gate. Any change to generated customer-site design.

## Verification

`npm run typecheck` after each step. `npm run smoke:dev` after steps 1, 2, and 4, since
they touch launch-flow and run-lifecycle behavior. `npm run verify:render-browser` is not
required — no rendering, preview, or inspection behavior changes.

Add unit coverage for `ownerRunActivity()` asserting that the projection never emits
model id, provider, token, cost, request id, payload reference, or hash fields for any
input event, including failed and cancelled spans.
