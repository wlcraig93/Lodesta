# Lodesta Agentic Website Platform V1

**Status:** Active experimentation implementation; not pilot authorization

**Revised:** 2026-07-20

## Decision

Replace V3's planner, compiler, and template presentation system with:

> Canonical local-business data + one website manager agent + shared Lodesta capabilities + isolated builds + immutable releases.

The qualitative bakeoff decision stands: preserve canonical ingestion and shared infrastructure while replacing templated presentation with agent-authored websites. The generated examples were reviewed directly even though the preregistered questionnaire was not completed. Further bakeoff work and artifact archival are out of scope.

The current implementation milestone proves an objectively valid private candidate and one real patch-only edit. It does not establish product readiness, authorize publication, or authorize an owner pilot.

V1 supports auto body only. The architecture proves future vertical extensibility through contracts and a synthetic test module, but does not build another production module, generic fallback module, or vertical-attribute framework.

Cloudflare Sandbox executes untrusted builds. Railway and Next.js serve immutable R2 artifacts. Cloudflare public edge delivery remains deferred.

## Repository Reset

- Label the final V3 checkpoint before destructive work.
- Run the Cloudflare and quality spikes before resetting the active application.
- After both spikes pass, establish packages for web/public serving, workers, sandbox control, contracts, business data, the site agent, trusted runtime, and verification.
- Port only shared-platform code that has no V3 presentation dependencies and still matches the approved contract.
- Delete V3 planning, copy slots, vertical pack, templates, design systems, compiler, renderer, editor, candidate model, judge stack, obsolete scripts, and compatibility paths.
- Update `AGENTS.md`, deployment documentation, smoke flows, and architecture verification during the reset.
- Delete pre-launch V3 rows through an explicit operator command before assert-empty migrations. Add no backfills, aliases, shims, or dual writes.

The existing `generation-pipeline-clean-break.md` describes the historical V3 implementation and is not a source of go-forward requirements.

## Versioned Authorities

### `BusinessStateV2`

Canonical identity, contacts, locations, hours, service areas, offerings, proof, assets, links, and reviewed vertical classification.

### `SiteIntentV2`

Audience, positioning, voice, conversion intent, page requirements, brand constraints, and enabled capabilities. It contains no template IDs or copy slots.

### `VerticalContextModuleV1`

Immutable vertical knowledge and skill configuration.

### `SitePublicBuildInputV1`

Immutable public facts, evidence, assets, forms, capabilities, intent, and pinned vertical module. Private or ineligible data never enters a sandbox.

### `SiteWorkspaceRevisionV1`

Content-addressed source revision with exact-parent concurrency.

### `SiteBuildArtifactV1`

Finalized HTML, CSS, manifests, QA, screenshots, hashes, runtime-series binding, toolchain version, and sandbox-image digest.

### `SiteVersionV4`

Immutable candidate or published release.

### `SiteAgentSessionV1` and `SiteAgentRunV1`

Conversation, model, skills, tools, patches, usage, checkpoints, and sandbox lease.

### `TrustedRuntimeSeriesV1`

Stable compatibility series and currently active audited patch.

### `TrustedRuntimePatchV1`

Immutable content-hashed runtime bundle with provenance, security status, compatibility results, and promotion record.

## Vertical Boundary

Ship only `auto_body`.

Its module contains:

- Stable ID, version, status, aliases, and classification signals.
- Terminology and customer language.
- Append-only offering catalog with tombstoned IDs.
- Customer journeys and conversion recommendations.
- Stricter-only proof cautions.
- Content, FAQ, SEO, and AEO opportunities.
- Vertical skill and evaluation references.

It cannot contain templates, layouts, styles, fixed copy, page recipes, executable code, form processors, or generator branching.

Offerings remain catalog-backed or custom, are proposed rather than automatically confirmed, and remain owner-editable through the typed control plane.

Do not implement additional modules, `general_local_service`, generic EAV storage, or module-defined business attributes. Unsupported production verticals return `unsupported_vertical`.

Register a synthetic test-only module to prove that another module can pass through context loading and public projection without modifying generation, runtime, verification, or publishing code.

## Agent And Shared Capabilities

- One `WebsiteManagerAgent` owns site coherence and owner conversation.
- Global skills cover initial construction, visual direction, focused edits, SEO/AEO, and QA repair.
- The auto-body skill is additional context for the same manager.
- Crawling, URL safety, source retention, fact resolution, sanitization, form authorization, verification, and publishing remain deterministic services.
- Optional visual or factual critics are read-only.
- Add another agent only after a bounded evaluation demonstrates measurable benefit.

Platform-owned capabilities cover forms and inbox, analytics, managed location panels with verified directions links, proof, assets, safe links, domains, redirects, publishing, rollback, robots, sitemaps, structured data, and trusted interactions. Embedded map providers and scheduling remain deferred.

Generated sites cannot add backend services, dependencies, secrets, embeds, arbitrary scripts, or custom capability implementations.

## Sandbox And Toolchain

- Use Cloudflare `standard-2` containers with RPC transport. HTTP and WebSocket transports are not permitted for the agent workspace because RPC is the current multiplexed SDK path and the older WebSocket transport is deprecated.
- Prebake the pinned Node runtime, package manager, React build toolchain, locked dependencies, Lodesta SDK, and scaffold into a versioned custom image.
- Sessions perform no network package installation.
- Generated source imports only allowlisted prebaked dependencies.
- Dependency or SDK updates require a platform-owned image rebuild.
- Retained public artifacts never require the original build image to render.

Agent-authored React, TypeScript, and CSS execute only in the sandbox. Released sites contain static HTML and CSS plus the trusted Lodesta runtime, never agent-authored browser JavaScript.

SDK-bound canonical values automatically emit claim declarations with source fact IDs. The agent declares only free-text assertions.

## Trusted Runtime Patching

Static site HTML references a stable runtime-series path such as `/_lodesta/runtime/site-v1.js`, not a permanently pinned patch URL.

The serving layer:

1. Resolves the series to its active audited patch.
2. Redirects the series request to an immutable content-hashed patch URL.
3. Serves the series resolution with `no-store` or a maximum 60-second cache.
4. Serves the patch URL with long-lived immutable caching.
5. Exposes the resolved patch ID in response metadata and request logs.

`SiteBuildArtifactV1` records the runtime series and patch active during finalization. Promoting a compatible security patch updates the series mapping without modifying site artifacts or republishing every site.

Runtime patch promotion requires unit, security, capability, CSP, browser, and retained-artifact compatibility tests; internal staged preview; operator approval; an immutable audit record; atomic promotion; and immediate rollback.

Patch releases within one series remain backward compatible with every retained artifact using that series. A breaking runtime change creates a new series and requires deterministic re-finalization into new `SiteVersionV4` releases.

Preview and production serve identical site HTML, CSS, assets, and the same active runtime-series resolution.

## Artifact Finalization

1. Receive HTML, CSS, metadata, capability bindings, and claim declarations.
2. Parse and sanitize HTML and CSS.
3. Validate routes, assets, links, forms, capabilities, metadata, and claims.
4. Materialize platform-owned JSON-LD and metadata.
5. Inject the trusted runtime-series reference.
6. Validate final site bytes.
7. Hash and persist the immutable artifact.

## Serving And Sandbox Sessions

- Railway and Next.js resolve hostname and published version, verify the retained manifest, and serve immutable R2 bytes.
- Preview and production serve the same artifact bytes; authorization disables preview submissions externally.
- A future edge worker may implement the same artifact-resolution contract.

One active owner session leases one sandbox:

- Reuse it across serialized `Apply` operations.
- Require the exact parent workspace revision.
- Checkpoint and destroy after ten idle minutes.
- Rotate after two continuous hours.
- Restore only from persisted source and input.
- Restrict fast previews to the authenticated owner session.

## Implementation Sequence

### 1. Freeze And Run Disposable Spikes

- Reconcile and label V3.
- Freeze further V3 generator development.
- Keep spike code isolated and non-shipping.
- Delete spike code after recording measurements, frozen configurations, and findings.

Cloudflare spike must pass:

- Custom image, authenticated bridge, deny-by-default egress, files, commands, previews, extraction, R2 backup and restore, timeout, and destruction.
- Warm source-change-to-preview p95 of 15 seconds or less across 20 runs.
- Cold restore-to-preview p95 of 45 seconds or less across 10 runs.
- Twenty concurrent isolated builds with zero failures, crossover, or leaked containers.
- Configuration allowing at least 100 pilot sessions and documented account and regional limits.
- Resource and cost measurement without a monetary threshold.

Before quality-spike generation, freeze `credible-customer-draft-v1`. A site passes only when all are true:

1. Business-specific visual identity, not a visible template variant.
2. Coherent hierarchy, navigation, and conversion path.
3. Grounded and appropriate copy, proof, and service presentation.
4. Finished desktop and mobile presentation without placeholder or obvious AI residue.
5. Suitable to send to the business without manual redesign.

The historical four-example quality spike informed the reset but is not an active gate or baseline. Go-forward development uses runtime synthetic inputs for deterministic protocol verification and live private experiments for visual assessment; it persists no generated example output as a ratchet.

Failure changes the new agent, context, tools, or sandbox approach before reset. It does not automatically revive templates.

### 2. Reset And Establish The Platform Shell

- Apply explicit pre-launch deletion and baseline migrations.
- Create the clean package and deployment boundaries.
- Port approved auth, ingestion, URL safety, evidence, assets, forms, analytics, domains, and publish-safety behavior.
- Update strict artifact policy to the new contracts.
- Enforce no V3 imports, compatibility behavior, dual writes, or vertical-ID branches.

### 3. Build Trust Boundary And Capabilities

- Implement schemas, retention, public projection, revisions, concurrency, and the module registry.
- Implement the auto-body and synthetic test modules.
- Implement forms, analytics, maps, proof, assets, links, metadata, runtime-series resolution, and trusted interactions.
- Promote the generic claim checker into `ArtifactClaimValidatorV1` and prove its expected verdicts against inline corrected claim vectors.
- Promote reusable sanitizer and browser-inspection logic, then delete the bakeoff harness.
- Add inline hostile workspace and source-policy vectors.

### 4. Complete The Walking Skeleton

Run one hand-authored workspace through Cloudflare build and artifact finalization; immutable persistence; authenticated preview and Railway public serving; runtime-series resolution and patch rollback; managed form submission and analytics; candidate promotion, replacement, and rollback; and rendering retained versions after later source, form, asset, or runtime changes.

### 5. Stabilize The Trust Boundary

- Make sensitive-claim scanning span-aware and require a supported declaration for each occurrence.
- Remove fact-support heuristics that let model-authored paraphrases expand canonical facts.
- Harden source policy, sanitization, preview CSP, and artifact diagnostics.
- Replace frozen generated examples with inline regression vectors and runtime synthetic inputs. Synthetic inputs may drive development and CI, but their outputs are never persisted as visual baselines.

### 6. Implement The Enforced Manager Tool Loop

- Use the official OpenAI SDK with stored responses disabled, parallel calls disabled, SDK retries disabled, and one application-level transport retry.
- Replace the full-workspace proposal with `read_workspace`, initial-only `write_file`, exact-anchor `apply_patch`, `build_preview`, `inspect_candidate`, and `finish`.
- Enforce source mutation, successful build, objective inspection, and unchanged finish state in platform code. Prompt instructions are not authority.
- Keep large source, diagnostics, and captures in private content-addressed blobs. Persist only hashes, keys, timings, and compact envelopes on `SiteAgentRunV1`.
- Keep `run.attempts` as the bounded candidate-attempt record. Builds and inspections are tool events, not new attempts.
- Bound initial and edit loops only to prevent runaway execution: 20 Responses calls, 20 tool calls, two million input tokens, 200,000 output tokens, 20 minutes for an initial build, 10 minutes for an edit, 96 KB/800 lines per `read_workspace` call, 30 successfully applied exact replacement spans, and six failed anchors. Initial runs allow four matched build/inspection cycles; edits and the single critic continuation allow three.
- `call_id` is idempotent: replaying the same call with the same normalized input returns the retained result, while reusing it with different input fails closed.

### 7. Make Experimentation Non-Publishable

- Apply `202607200013_experimental_site_status.sql` to add the database status constraint and promotion guard, and apply the assert-empty `202607200014_retire_agentic_readiness.sql` cleanup after the retired readiness rows are explicitly removed.
- Add explicit `experimental` site status and bootstrap mode.
- Reject promotion for experimental sites in both local and Supabase repositories, including automatic publish-after-success flows.
- Serve experimental candidates only through authenticated version-artifact routes. Public, token-preview, and form-submission paths remain unavailable.
- Preserve the existing operator queue for objective failures and unresolved subjective findings.

### 8. Deploy The Versioned Platform

- Bump the platform, toolchain, manager prompt, claim policy, source policy, sandbox image, and worker deployment as one coordinated release whenever their boundary contracts change.
- Source the sandbox image digest and all version identifiers from code-owned constants; do not duplicate them in environment configuration.
- Build and deploy the pinned custom image and Cloudflare Worker after the trust and tool-loop changes land.
- Query deployed worker diagnostics and fail verification unless its platform, toolchain, manager, claim, source-policy, and image versions exactly match the repository manifest.

The experimentation release is `agentic-site-platform-v1.13`, toolchain `lodesta-static-site-workspace-v1.4`, manager `website-manager-v2.1`, claim policy `artifact-claim-validator-v1.2`, source policy `workspace-source-policy-v4`, and sandbox image `sha256:6967ab68b50dc14fd575972932c61e788358bc347bef0498935440ce1a5a6e2a`.

### 9. Run One Private Live Experiment

Create a private experimental candidate for `terrysbodyshop.com`, inspect desktop and mobile output, and record a narrative assessment of quality, grounding, task completion, latency, usage, and objective findings. Apply at least one observed focused edit and prove from the tool trace that every post-initial mutation used `apply_patch`, never `write_file`.

The Terry's target is acknowledged as previously observed and is not neutral evaluation evidence. There is no pass threshold, rerun allowance, or pilot implication. Retain the candidate, sessions, runs, and captures privately for continued experimentation, and delete them before any pilot begins.

### Deferred Until Pilot Planning

- Pilot-entry targets and an ordered untuned target set.
- A live edit battery covering element restyle, page addition, form movement, and mobile repair.
- Independent review and a fixed customer-draft quality rubric.
- Reliability, latency, and operator-intervention thresholds.
- Cost targets, defined only after quality and workflow readiness are established.
- Explicit reassessment and operator disposition of unresolved subjective findings before a successor candidate can publish.
- Fleet-wide phone display formatting in the SDK or trusted presentation layer while preserving canonical machine-readable values.
- Shared asset-suitability and managed-location presentation improvements informed by additional private experiments, not target-specific generation rules.
- Per-turn input-token monitoring and bounded stale-tool-output compaction if replay growth begins exhausting the existing token ceiling.
- Publication cleanup, retention, support, and incident procedures for real businesses.
- A defined pilot size, mandatory operator review before every publish, and an explicit exit review before expansion.

## Acceptance Tests

- Strict schema, retention, provenance, and immutable-reference tests.
- Runtime-series promotion, content-hash resolution, compatibility, audit, and rollback tests.
- Catalog, custom offering, classification, unsupported-vertical, and confirmation tests.
- Synthetic-module extensibility test.
- Architecture checks for V3 imports, vertical branches, templates, generated scripts, arbitrary dependencies, and compatibility paths.
- Hostile sandbox tests covering secrets, networking, embeds, scripts, links, claims, and capabilities.
- Automatic SDK declaration tests for every canonical hook.
- Forms, analytics, maps, metadata, JSON-LD, domains, internal redirects, preview, public serving, publish, and rollback tests.
- Desktop, tablet, and mobile browser verification.
- Warm reuse, idle destruction, restore, rotation, concurrent Apply, and stale-parent tests.
- Inline claim, hostile-source, sanitizer, and experimental-promotion regression vectors.
- Fake-client manager-loop tests for sequencing, idempotency, limits, interruption, checkpoint recovery, and finish preconditions.
- One private Terry's candidate plus one patch-only edit and a narrative experiment report.

## Assumptions

- Auto body is the only supported V1 production vertical.
- Additional verticals and generic vertical attributes are deferred.
- The product remains pre-launch, permitting a destructive hard cutover.
- Git history is the V3 archive; no active legacy runtime remains after cutover.
- Cloudflare Sandbox is the default provider; E2B is fallback only after a mandatory spike failure.
- Railway and Next.js remain the V1 public-site serving layer.
- Canonical ingestion and shared capabilities remain.
- Runtime security patches may advance within a compatible series without republishing site artifacts.
- Experimental sites are technically non-publishable, even when automatic publication is requested.
- Publishing remains unavailable until a separate pilot plan defines and passes its entry gate.
- Costs and latency are measured during experimentation but are not product gates yet.
