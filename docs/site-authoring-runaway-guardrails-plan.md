# Site-authoring runaway guardrails

Status: approved product-owner decision, July 24, 2026.

Lodesta authoring runs no longer stop on cumulative input or output token totals or on a second model-loop duration budget. Usage remains recorded as telemetry.

Site-authoring runs use three safety guardrails:

- An absolute deadline of 60 minutes for an initial build and 25 minutes for an edit or rebase, measured from the beginning of the workflow and including research.
- A total metered model-cost fuse of $15 for an initial build and $8 for an edit or rebase. Architecture, research, Responses API authoring, and GPT Image asset generation all contribute to the same total. The fuse is checked before another model request; a successful finalization already returned by the model is retained.
- A deterministic stall stop after three consecutive failures of `finish` (the only release tool) against the same workspace with the same normalized diagnostic. Workspace mutation, a successful `finish`, or a different `finish` failure resets the streak. Reads, builds, and inspections neither count toward nor reset it.

The hosted worker refills spare authoring slots on its bounded polling tick rather than waiting for an entire claimed batch to finish. It retains one in-flight set for the worker lifetime. A non-transient claim, assessment, or unexpected execution rejection stops new admission and drains that set before the worker surfaces the failure; normal run failures still resolve through their existing durable finalization path. A run returned from a claim that raced with shutdown is already owned and is started only so the worker can drain it, with no further claims or assessment work.

This is the explicit product-owner exception required by the Simplification Doctrine for a convergence check. The check is intentionally restricted to `finish` (`isReleaseTool` in `packages/site-agent/manager.ts`); `build_preview` and `inspect_site` failures are ordinary author feedback and never count toward the stall streak. It does not score subjective quality, impose an authoring sequence, or count ordinary tool use.

Two provider conditions are not terminal (owner decision, September 24, 2026). The per-response output limit stays 64,000 tokens; a response cut off at that limit is not applied, and the author receives a turn error ("your response was cut off; write in smaller pieces") and continues. A temporarily unavailable provider (rate limit, 5xx, transport failure) is retried with exponential backoff (one second doubling to a one-minute cap, honoring Retry-After) until the run-deadline signal aborts the request; an exhausted quota or credit balance is not retried. The absolute deadline and the metered cost fuse remain the hard limits for both. The architecture planner's single structured response still fails if it is truncated.

If provider or catalog cost telemetry is unavailable, the run stops rather than continuing without an enforceable cost fuse. GPT Image 2 cost is calculated from the API's text-input, image-input, and image-output token usage using the local pricing catalog; missing or internally inconsistent image usage also fails closed.

The exact consolidated manager prompt is hashed into the prompt identity recorded in the platform manifest. Initial-build architecture has its own retained producer identity, derived from its model, reasoning profile, system prompt, and schema version.
