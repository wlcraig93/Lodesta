# Site-authoring runaway guardrails

Status: approved product-owner decision, July 24, 2026.

Lodesta authoring runs no longer stop on cumulative input or output token totals or on a second model-loop duration budget. Usage remains recorded as telemetry.

Responses API runs use three safety guardrails:

- An absolute deadline of 60 minutes for an initial build and 25 minutes for an edit or rebase, measured from the beginning of the workflow and including research.
- A total metered model-cost fuse of $15 for an initial build and $8 for an edit or rebase. Research, Responses API authoring, and GPT Image asset generation all contribute to the same total. The fuse is checked before another model request; a successful finalization already returned by the model is retained.
- A deterministic stall stop after three consecutive failures of the same release tool against the same workspace with the same normalized diagnostic. Workspace mutation, a successful release tool, or a different release failure resets the streak. Reads do not.

This is the explicit product-owner exception required by the Simplification Doctrine for a convergence check. The check is intentionally restricted to `build_preview`, `inspect_site`, and `finish`; it does not score subjective quality, impose an authoring sequence, or count ordinary tool use.

If provider or catalog cost telemetry is unavailable, the run stops rather than continuing without an enforceable cost fuse. GPT Image 2 cost is calculated from the API's text-input, image-input, and image-output token usage using the local pricing catalog; missing or internally inconsistent image usage also fails closed. External MCP authoring retains its separate execution deadlines and does not inherit Responses API cost or stall controls.

The consolidated manager-prompt behavioral descriptor is `website-manager:static-source-access-and-route-visible-canonical-sensitive-facts`; its SHA-256 value is the prompt identity recorded in the platform manifest.
