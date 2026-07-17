# Canonical Business Control Plane and Generation Architecture

**Status:** Implemented

**Approved:** 2026-07-16

**Scope:** Pre-launch hard cutover

This document supersedes every earlier generation-pipeline and fact-graph plan. It is the only canonical architecture for business ingestion, managed-site control, generation, owner edits, and published-site provenance. The cutover keeps no legacy generator, fact authority, dossier authority, migration shim, dual read/write path, or compatibility adapter.

## Product Contract

One URL creates a protected managed-site candidate through one pipeline:

1. Validate the URL, crawl it, retain immutable source snapshots, and record observations.
2. Run one Business Understanding model call for bounded interpretation and evidence proposals.
3. Run capped asset-vision calls and retain immutable asset revisions.
4. Deterministically verify evidence and resolve a protected-preview business snapshot.
5. Select one vertical pack and one of two compatible design systems.
6. Build one `GenerationPlan`.
7. Run one whole-site, slot-addressed `SiteCopy` model call.
8. Compile one strict `SiteVersionV3`.
9. Run one objective browser gate and one final multimodal judge.
10. Permit at most one regeneration; any further failure goes to operator review.

Normal traces contain one plan, copy, compile, gate, and judge. A copy revision reuses the plan. An alternate-system revision may create exactly one replacement plan inside the single permitted regeneration.

## Three Authorities

### 1. Canonical business state

Mutable normalized tables own business identity, locations, contact facts, hours, service areas, offerings, proof, external links, assets, and asset revision pointers. This is the authority for what the business is and offers.

- Crawl and Places results are observations, never owner truth.
- Source observations can power protected previews.
- Public offerings require confirmed status and public visibility.
- Catalog-backed and custom offerings use the same `BusinessOfferingV1` contract.
- Catalog IDs are append-only. Retired IDs remain resolvable for retained snapshots but cannot be newly selected.
- Owner or operator changes update canonical state even when compilation or QA later fails.

### 2. Site intent

`SiteIntentV1` owns how canonical facts should be presented: audience, positioning, voice, primary conversion, featured offerings, offering page modes, selected proof, brand constraints, immutable form-definition selection, and slot-addressed copy overrides.

- Site intent never becomes business truth.
- Cosmetic copy edits recompile the stored plan without a model call.
- Contact, hours, form-definition, and copy changes use deterministic recompile.
- Structural changes use explicit canonical regeneration.
- Generation consumes both authorities only through an immutable input snapshot.

### 3. Immutable published inputs and outputs

Every candidate and version references an immutable `GenerationInputSnapshotV1`, `FormDefinitionV1`, source snapshots, and asset revisions. `SiteVersionV3` is immutable apart from lifecycle status.

- A retained version always renders its own snapshot, form, and asset revisions, never current mutable rows.
- Source snapshots, form definitions, asset revisions, and snapshot bindings use delete-restrict semantics while retained candidates or versions reference them.
- Owner asset deletion marks the mutable asset inactive for future generations; it does not delete retained revision bytes.
- Candidate acceptance copies every referenced generation and QA artifact to site ownership and rebinds the version before candidate cleanup.
- Immutable schema evolution uses a new schema version and readers for every retained version. Immutable rows are never backfilled in place.
- An asset revision records the retained binary's actual SHA-256, byte count, MIME type, dimensions, and durable storage path. A remote website reference that was not downloaded is diagnostic input only and cannot enter a generation snapshot.

## Ingestion and Evidence

Ingestion retains `SourceSnapshotV1` and `FactObservationV1` before resolving any generation input. Observations record value, normalized value, confidence, source block, and status. They do not directly mutate confirmed business truth.

- Website and Google Places are retained as separate source snapshots. Sanitized Places snapshots contain matched identity, contact, location, category fields, and place IDs, never ratings, counts, review text, or raw provider payloads.
- Resolution is deterministic: website scalars win, accepted Places scalars fill missing fields, conflicting non-selected scalars remain `conflict` observations, and list fields use website-first union semantics.
- Model-cleaned service names are eligible only when their `sourceText` matches a retained source block or the underlying observed service. Ungrounded services are dropped, not repaired.
- `BusinessUnderstandingV2` is retained in the immutable generation input as non-authoritative interpretation. Its story, vertical judgment, conversion judgment, and brand expression never become owner-confirmed business facts.
- Every resolved preview fact has a selected observation or an owner/operator change as provenance. Extractor and provider confidence is retained; intake does not stamp observed facts with confidence `1`.

Evidence uses semantic `SourceTextBlock` records with canonical tokens mapped to display spans. A proposal is accepted only when its tokens occur contiguously in one retained block.

- Testimonials render only reconstructed source excerpts with verified adjacent attribution.
- Non-testimonial proof never enters model-authored copy.
- Credentials, insurance support, longevity, warranties, awards, and offers render only as deterministic confirmed values.
- Expired, rejected, inactive, ambiguous, conditional, former, or negated proof does not render publicly.
- A vertical pack may make proof policy stricter but can never weaken the global policy.
- Evidence-yield metrics retain acceptance, rejection reason, and source-sparse classification.

## Control Plane

`POST /api/control-plane/changes` is the single typed mutation surface for canonical business state and site intent. The discriminated payload union owns identity, contact, location, hours, snapshot confirmation, offerings, proof, assets, external links, audience, positioning, voice, conversion, offering presentation, proof selection, brand constraints, forms, and copy overrides.

- The server derives `targetAuthority` and deterministic versus structural impact.
- External-link changes always require operator review and URL-safety validation.
- Public eligibility requires confirmation of every present owner-held fact: name, phone, email, address, hours, service areas, and services.
- Confirmed state persists before compile and is never rolled back on QA failure.
- Structural jobs coalesce by site and use the exact persisted snapshot ID.
- Acceptance rejects stale business-state or site-intent revisions with no override.
- Pending stale candidates must be rebuilt from current authority before acceptance.

Fresh generation and structural regeneration are distinct contracts. `POST /api/intake` requires a URL and accepts optional guidance. Structural regeneration consumes only an exact immutable input snapshot and intended site ID; it does not recrawl or require a retained source URL.

The owner surface exposes canonical facts, offerings, proof confirmations, assets, forms, and managed status. Owners can use structured controls or AI-assisted UI, but both produce the same typed change request. There is no second AI mutation authority.

## Vertical Packs

A vertical is a versioned semantic pack, not a pipeline fork. `VerticalPackV1` owns:

- stable service catalog and aliases;
- process language and primary conversion defaults;
- page recipe and service-page limits;
- form blueprint;
- SEO vocabulary and structured-data semantics;
- copy brief and stricter-only proof policy.

Shared generation code contains no vertical checks. Classification selects a pack; the pack supplies data and recipe choices to the one planner, copy call, compiler, gate, and judge. Auto body is the first shipping pack.

## Design and Judgment

Exactly two design systems ship:

- `precision_shop_editorial` when retained first-party media clears the hero floor;
- `trusted_local_service` otherwise.

The objective gate owns measurable failures only: route/render failure, overflow, contrast, missing media, placeholder/internal text, unsupported claims, fact grounding, form/route integrity, and basic SEO structure. It has no taste score.

The final judge receives homepage desktop/mobile captures, service-page desktop/mobile contact sheets, and the complete rendered text manifest. Its discriminated result is `ship/none`, `revise/copy`, `revise/alternate_system`, or `operator_review/operator_review`. An unavailable alternate is never offered. Judge findings remain internal.

## Public Boundaries

- Public routes load only a published strict `SiteVersionV3` whose snapshot is public-eligible.
- Protected-preview and candidate-only versions return no public site.
- Preview forms are disabled.
- The submission API accepts only the exact form definition referenced by a retained published version.
- Historical published forms remain valid while a retained live version references them.
- Places UI Kit failure falls back to a normal Google Maps link and records load, failure, fallback, and estimated cost telemetry.
- `ManagedSiteStatus` derives from publish state, objective QA, authority freshness, and pending proof confirmation. It does not expose internal judge tasks as owner homework.

## Persistence and Provenance

Every persisted regenerable intermediate carries producer and schema version, model ID when model-backed, input hashes, timestamp, and stale state. A version's `artifactRefs` identify the exact input snapshot, evidence manifest, plan, copy, QA review, and operator decision that produced it.

The consolidated schema is the authority. The pre-launch cutover migration asserts that old site and candidate rows are empty, then drops obsolete profile, asset, form, fact-candidate, service, audit, and publish tables. It never deletes rows itself; the explicit operator cleanup command is `npm run cleanup:generation-precutover -- --execute --confirm=DELETE_ALL_PRELAUNCH_CONTROL_PLANE_DATA`.

## CI Ratchets

`npm run verify:generation-architecture -- --cutover` rejects:

- deleted modules, routes, tables, and artifact shapes;
- vertical branching outside classification and the pack registry;
- generation modules importing mutable repositories;
- noncanonical generation entrypoints or illegal trace counts;
- hard-coded forms or public form submission without published-version authorization;
- missing delete-restrict references for immutable snapshots, sources, assets, and forms;
- protected-preview publication and unbounded structural job creation.
- production imports of deterministic test support or generation fallback controls;
- committed full-site baselines and browser captures written outside ignored run directories.

`npm run verify:control-plane` exercises observations-not-truth, public proof policy, owner provenance, catalog and custom offerings, intent-driven generation, immutable assets and snapshots, stale acceptance, protected publication, exact form rendering, candidate-only form rejection, and artifact rebinding.

### Fixture and review artifacts

The four sanitized source cases and their proposals exercise crawl parsing, observation resolution, evidence verification, vertical-pack selection, and asset floors. Frozen presentation-neutral inputs live under `fixtures/generation-pipeline/bakeoff-v1`; they are immutable test data for downstream planning and compilation, not saved website contestants.

`BusinessUnderstandingV2.source` is `deterministic_fallback` in these frozen inputs because the fixture builder is an offline test double. These inputs do not measure production ingestion quality. Production generation requires model-backed understanding and model-backed whole-site copy and fails loudly when either is unavailable. Deterministic slot copy lives only in `lib/test-support/site-copy.ts`; scripts may use it directly, and `lib/sample-data.ts` may use it for the local repository and smoke environment.

`compiler-references.json` commits normalized plan and compiler structure for reviewable diffs, with hashes as supplemental checks. It excludes generated prose, timestamps, runtime IDs, and rendered site payloads. `npm run verify:canonical-generation` rebuilds each fixture, validates its contracts, and compares the frozen input and normalized structure. On structural drift it writes expected and actual artifacts to ignored `.data/generation-reference-diffs`; intentional changes require `npm run freeze:generation-inputs` after reviewing that diff. Full `templated-baseline.json` artifacts are forbidden.

`npm run verify:render-browser` writes screenshots, contact sheets, and a manifest to a unique ignored `.data/generation-review/<run-id>` directory. Verification runs never rewrite tracked design artifacts or delete an earlier local run.

The future bakeoff has two separate experiments. The controlled design test gives both arms the exact same frozen canonical input without recrawling or mutating business state. The templated arm must run the current production planner, live model copy, and compiler; deterministic test copy and saved baselines are never contestants. A later URL-only test gives each arm the same URL and permits independent recrawling so it measures ingestion plus presentation rather than design alone. Neither bakeoff is part of this cleanup.

## Launch Gates

Before any 20-URL pilot:

1. `npm run typecheck`
2. `npm run verify:control-plane`
3. `npm run verify:generation-architecture -- --cutover`
4. `npm run verify:canonical-generation`
5. `npm run verify:generation-pipeline`
6. `npm run verify:generation-judge`
7. `npm run verify:launch-boundaries`
8. `npm run smoke:dev`
9. `npm run verify:render-browser`
10. Four sanitized fixtures pass first-compile objective QA and human desktop/mobile review without URL-specific patches.

Only then run the 20 untuned auto-body URL pilot. Its thresholds remain 20/20 first-compile route/render pass, at least 14/20 first-judge ship, at least 18/20 final ship, at most one whole-site copy schema retry, and zero unsupported public claims. Threshold failures are fixed in ingestion, shared templates, the vertical pack, or prompts, never with URL-specific branches or another grader.
