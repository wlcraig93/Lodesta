# Keep visual evidence in authoring history

September 5, 2026. Local correction; deployed status is recorded separately.

## Evidence

Private run `run_8d863a10dcf54b5894a0325f6df751db` completed a 32-route candidate, but its gallery described a photograph of people handling cut wood as a climber in a tree. Image inspection event 71779 provided four explicitly paired resource labels and previews. Preview 2 is the climber; preview 3 is the cut-wood photograph. Reconstructing both previews from hash-verified retained bytes reproduces the recorded preview byte lengths. Adoption 71789 used preview 3's correct resource and hash but preview 2's subject description. This does not indicate a blob substitution.

Request 6 contained six images: two stable references and four inspected assets. It adopted the first asset. Before request 7, `oneTurnVisualEvidenceView` removed all four inspected images because any intervening model output counted as consumption. Request 7 therefore contained only the two stable references when it described and adopted the wrong subject. Labels remained, accompanied by an unjustified assertion that the images had been inspected. The deterministic loss of pixel context is proven; its causal contribution to the model's association error is a hypothesis, not an established reliability result.

## Decision

Remove that image-pruning view. Image-bearing tool results retain their labels and pixels in ordinary authoring history, like other evidence, until the existing provider compaction replaces the older history. A tool call is not proof that the author understood every image or no longer needs it. This also lets a multi-edit visual repair continue to consult its original capture.

No new agent, review stage, forced tool sequence, retry, counter, image-memory store or source mutation is introduced. Canonical continuation storage, restored-history behavior and provider compaction stay unchanged. Retained customer artifacts are untouched. Exact fact/capability verification and the approved prose-advisory policy are unchanged.

This follows the Responses API's documented manual-state contract: each request receives the history the application supplies; earlier inputs are not implicit memory. [Official conversation-state documentation](https://developers.openai.com/api/docs/guides/conversation-state#manually-manage-conversation-state).

## Cost and verification

Retaining evidence increases later request payloads and may increase image tokens, latency and cost. The completed diagnostic produced 96 tool-preview images totaling 12,764,445 binary bytes across asset and page inspections; this is cumulative evidence, not a measured new request or a token estimate. Do not claim savings or that model mistakes are eliminated. Preserve the existing overall deadline, model-cost fuse and provider context handling. Measure the next ordinary run before expanding the acceptance screen; do not quietly raise the fuse.

The regression fails under the old code and passes with the correction. It covers four paired previews surviving a serial adoption, identical live/restored views, detached request arrays, and removal of pre-compaction images only at the provider's canonical compaction boundary. Full local preflight (including manager, typecheck, browser and sandbox checks) and sequential standalone launch-flow smoke pass. The `visual-history-preflight.log` and `visual-history-smoke.log` files are retained in the experiment evidence directory referenced by [authoring status](generated-site-authoring-status.md). Coordinated deployment and a hosted generation/edit remain separate validation steps.
