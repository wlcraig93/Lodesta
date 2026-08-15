# Luna architecture and authoring workflow

Status: approved product-owner decision, August 3, 2026.

## Decision

Initial website builds use one Luna High architecture request followed by the
ordinary Luna High workspace author. The architecture request receives the
exhaustive canonical source-path inventory and returns an explicit live-route
list plus one disposition for every source path. Lodesta performs deterministic
bookkeeping normalization and validates completeness before authoring begins.

The approved plan and its provenance are retained on the same logical
`SiteAgentRun`. The author receives the plan and de-chromed retained first-party
page content as ordinary workspace source files. The existing `finish` boundary
mechanically requires the emitted routes to match the approved live-route list
and applies the approved redirects and retirements. Every route still receives
static verification; browser verification uses deterministic structural
representatives.

This replaces the prior single-stage Sol High initial-build baseline. Edits and
rebases remain direct authoring operations and do not run another architecture
request.

## Evidence

The retained Kind Pest mirror contained 404 page records. A clean canonical Sol
High control produced 13 live routes, 28 redirects, and 6 retirements for an
estimated $3.8559. The validated Luna workflow produced 203 live routes with no
unaccounted source paths. Luna architecture, purpose work, and authoring cost an
estimated $0.1907 in the canary.

The comparison demonstrates the failure this exception addresses: broad
prompting alone lets a capable author collapse a mature source estate into a
small brochure site. An explicit model-owned architecture artifact preserves
model judgment while making exhaustive source accountability testable.

## Simplification-doctrine exception

This is the explicit product-owner authorization required to add an architecture
phase. Its scope is deliberately narrow:

- initial builds with a retained website inventory only;
- one Luna High architecture model request;
- one mechanically validated, candidate-bound route and disposition ledger;
- no numeric page target or vertical/service catalog;
- no deterministic semantic route decisions;
- no critic, reviewer, tournament, successor run, or repair continuation; and
- no subjective publication gate.

Mechanical normalization may deduplicate repeated route records, derive each
route's mapped source paths, remove a non-live source accidentally repeated in
the route list, and materialize a target the model explicitly selected. It may
not invent a consolidation, redirect, retirement, service, location, or topic.
If the normalized plan remains inconsistent, the run fails normally rather than
launching an automatic repair loop.

## Operational contract

- Architecture and authoring usage share the existing 60-minute deadline and
  $15 metered-cost fuse.
- The retained architecture is reused after a durable pause only when its public
  build input and source-inventory hash remain current.
- The default website-manager route is direct OpenAI `gpt-5.6-luna` with high
  reasoning. Operator-only model overrides remain available for controlled
  comparisons.
- Visual quality, copy quality, and SEO/CRO findings remain advisory. Route
  equality, functional correctness, factual integrity, managed capabilities,
  and release safety retain their existing blocking semantics.
