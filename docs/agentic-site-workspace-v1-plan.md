# Lodesta Agentic Website Platform V1

**Status:** Domain-neutral architecture and convergence observability implemented; pilot remains unauthorized

**Revised:** 2026-07-20

## Decision

Replace V3's planner, compiler, and template presentation system with:

> Canonical local-business data + one website manager agent + shared Lodesta capabilities + isolated builds + immutable releases.

The qualitative bakeoff decision stands: preserve canonical ingestion and shared infrastructure while replacing templated presentation with agent-authored websites. The generated examples were reviewed directly even though the preregistered questionnaire was not completed. Further bakeoff work and artifact archival are out of scope.

The experimentation milestone proved an objectively valid private candidate and one real patch-only edit. The active milestone fixes shared presentation defects, validates fresh untuned sites, proves representative owner edits, and admits at most three closely observed concierge owners through an explicit pilot-entry review.

**Execution outcome (2026-07-20):** the four-site discovery cohort completed and shared presentation/ingestion defects were corrected in release `agentic-site-platform-v1.16`. The frozen validation cohort produced one valid candidate, one in-scope vertical-classification false negative, and one bounded authoring failure. The edit battery passed its element-restyle task but failed its page-add task. The preregistered stop rule fired, no spare or target rerun was used, and `pilot-entry-report.json` is ineligible. The three-owner pilot did not begin.

Generation supports any suitable local business without requiring a configured vertical module. Auto body remains the only production enrichment module: when classification matches, it contributes terminology and domain context to the same manager; when it does not, the same neutral pipeline continues without it. The module registry is never an eligibility gate.

Cloudflare Sandbox executes untrusted builds. Railway and Next.js serve immutable R2 artifacts. Cloudflare public edge delivery remains deferred.

## Repository Reset

- Label the final V3 checkpoint before destructive work.
- Run the Cloudflare and quality spikes before resetting the active application.
- After both spikes pass, establish packages for web/public serving, workers, sandbox control, contracts, business data, the site agent, trusted runtime, and verification.
- Port only shared-platform code that has no V3 presentation dependencies and still matches the approved contract.
- Delete V3 planning, copy slots, vertical pack, templates, design systems, compiler, renderer, editor, candidate model, judge stack, obsolete scripts, and compatibility paths.
- Update `AGENTS.md`, deployment documentation, smoke flows, and architecture verification during the reset.
- Delete pre-launch V3 rows through an explicit operator command before assert-empty migrations. Add no backfills, aliases, shims, or dual writes.

The retired V3 implementation remains available through Git history only and is not a source of go-forward requirements.

## Versioned Authorities

### `BusinessStateV3`

Canonical identity, contacts, locations, hours, service areas, offerings, proof, assets, links, and source-grounded facts. It contains no required vertical identity.

### `SiteIntentV3`

Audience, positioning, voice, conversion intent, page requirements, brand constraints, and enabled capabilities. It contains no template IDs or copy slots.

### `VerticalContextModuleV1`

Optional immutable domain knowledge and skill configuration. A matching module enriches the shared manager context but never selects a different generator.

### `SitePublicBuildInputV3`

Immutable public facts, evidence, assets, forms, capabilities, intent, and optional domain context. Private or ineligible data never enters a sandbox.

### `SiteWorkspaceRevisionV1`

Content-addressed source revision with exact-parent concurrency.

### `SiteBuildArtifactV1`

Finalized HTML, CSS, manifests, QA, screenshots, hashes, runtime-series binding, toolchain version, and sandbox-image digest.

### `SiteVersionV4`

Immutable candidate or published release.

### `SiteAgentSessionV1` and `SiteAgentRunV2`

Conversation, model, skills, aggregate usage, checkpoints, and sandbox lease. `SiteAgentRunV2` is the compact run envelope; hierarchical `SiteAgentTraceSpanV1` records attempts, turns, model requests, tool calls, builds, inspections, critics, and private expiring payload references. `SiteEditObjectiveV1` is a separate immutable request objective keyed by run.

### `SiteVersionApprovalV1` and `SitePublicationReadinessV1`

An immutable operator decision bound to the exact version and artifact hash, plus derived publication readiness across objective QA, canonical-state freshness, asset rights, forms, redirects, unresolved site findings, and approval. Readiness is never stored as a second mutable authority.

### `TrustedRuntimeSeriesV1`

Stable compatibility series and currently active audited patch.

### `TrustedRuntimePatchV1`

Immutable content-hashed runtime bundle with provenance, security status, compatibility results, and promotion record.

## Optional Domain Context

Ship one optional enrichment module, `auto_body`, without making it a generation prerequisite.

Its module contains:

- Stable ID, version, status, aliases, and classification signals.
- Terminology and customer language.
- Append-only offering catalog with tombstoned IDs.
- Customer journeys and conversion recommendations.
- Stricter-only proof cautions.
- Content, FAQ, SEO, and AEO opportunities.
- Vertical skill and evaluation references.

It cannot contain templates, layouts, styles, fixed copy, page recipes, executable code, form processors, eligibility decisions, or generator branching.

Offerings remain catalog-backed or custom, are proposed rather than automatically confirmed, and remain owner-editable through the typed control plane.

Do not implement additional production modules, a generic EAV attribute system, or module-defined business authorities until a real second domain requires them. Unmatched businesses continue with neutral context and emit nonblocking demand telemetry; they never enter an unsupported-vertical queue or fail generation solely because a module is absent.

Technical generation suitability is domain-neutral: the source must be safely crawlable, expose a source-backed business name, and expose at least one contact method, location, or offering. Module classification is not considered. Claims-sensitive businesses may produce private experimental candidates, but medical, legal, and financial businesses remain outside manually selected pilots until their public-claims policy is approved.

Register a synthetic test-only module to prove that another module can pass through context loading and public projection without modifying generation, runtime, verification, or publishing code.

## Agent And Shared Capabilities

- One `WebsiteManagerAgent` owns site coherence and owner conversation.
- Global skills cover initial construction, visual direction, focused edits, SEO/AEO, and QA repair.
- The auto-body skill is optional additional context for the same manager.
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

Cloudflare Containers are an ephemeral build boundary, not a hosting layer. Authoring and discussion use immutable `WorkspaceSourceSidecarV1` bytes from the artifact bucket and allocate no sandbox. The first `build_preview` call starts a sandbox, the authenticated live-preview request starts Vite on demand, and browser verification renders prepared artifact bytes without Vite. A terminal run checkpoints its archive and source sidecar, creates the immutable candidate, clears the live-preview path, and explicitly destroys the sandbox. The ten-minute `sleepAfter` remains only as a safety net for mid-run pauses. Destruction failures retain the sandbox ID in `rotating` state for durable reaping and an operator finding.

R2 has two live roles. `lodesta-agentic-sites-v1` stores site assets, immutable source sidecars, build artifacts, captures, trusted runtime patches, and expiring trace payloads. The exact-object artifact broker can only `PUT`, `GET`, and `HEAD` that bucket. `lodesta-workspace-backups-v1` stores opaque workspace archives and is bound only to the sandbox Worker. Inventory and deletion are unavailable to both application Workers; operator audit and mutation use separate bucket-scoped S3 credentials from a private maintenance environment.

The two-bucket audit identifies objects by `{store,key}`. During the seven-day storage rollback window, manifest-declared archive copies in both buckets are protected references and must match by bytes and SHA-256 rather than being merged as duplicate keys. Source sidecars are derived references for every retained workspace revision, so a confirmed orphan cleanup cannot delete them. A durable `workspace_storage_cutover` lease blocks both run enqueue and the atomic run claim across copy, deployment, overlap audit, and Railway configuration.

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
- Replace the full-workspace proposal with literal `search_workspace`, bounded `read_workspace`, initial-only `write_file`, exact-anchor `apply_patch`, `build_preview`, `inspect_candidate`, and `finish`.
- Enforce source mutation, successful build, objective inspection, and unchanged finish state in platform code. Prompt instructions are not authority.
- Keep large source, diagnostics, and captures in private content-addressed blobs. Persist only hashes, keys, timings, and compact envelopes on `SiteAgentRunV2`.
- Keep `run.attempts` as the bounded candidate-attempt record. Builds and inspections are tool events, not new attempts.
- Bound initial and edit loops only to prevent runaway execution: 20 working Responses calls, 20 working tool calls, two million input tokens, 200,000 output tokens, 20 minutes for an initial build, 10 minutes for an edit, 96 KB/800 lines per `read_workspace` call, 30 successfully applied exact replacement spans, and six failed anchors. If call 20 produces a passing inspection, permit exactly one terminal response with only the forced `finish` tool; it cannot read, mutate, build, inspect, or extend the working loop. Initial runs allow four matched build/inspection cycles; edits and the single critic continuation allow three.
- `call_id` is idempotent: replaying the same call with the same normalized input returns the retained result, while reusing it with different input fails closed.
- Compact replay history to the immutable initial request, a deterministic current-state projection, and the latest two complete reasoning/function-call/function-output frames. The state projection contains workspace hashes and outlines, routes, build and inspection status, objective checks, unresolved finding fingerprints, and convergence counters.
- Cache successful builds and inspections for an unchanged workspace. Exclude reads and searches from progress accounting; stop after three mutation/build/inspection transitions that neither reach a new workspace state nor reduce findings. Returning to a previously seen workspace hash counts as no progress.

### 6A. Make Owner Edits Explicit And Convergent

- Classify every owner Apply request with a server-side structured preflight. Ambiguity returns a clarification without creating a run; transport or model failure returns a clear unavailable response without inventing a default task.
- Persist `SiteEditObjectiveV1` separately from `SiteAgentRunV2`. Preserve existing routes and capability bindings for every edit; enforce an exact new route only when the owner supplied its slug, otherwise enforce capability-level completion such as a new navigable route.
- Attach stable fingerprints to objective findings and return `new`, `remaining`, and `resolved` deltas after each inspection. A subjective critic still runs once after objective success; one bounded repair is allowed. If that subjective repair fails or exhausts a guard, retain the last objectively passing checkpoint as the private candidate, restore or rotate its sandbox state, and send the original critic findings plus the repair failure to the operator queue rather than erasing the valid candidate.

### 6B. Retain Hierarchical Private Traces

- Record one trace per request/run with nested attempt, turn, model-request, tool-call, build, inspection, critic, retry, preflight, and future subagent spans. Database identity sequence orders concurrent writes; client-generated span IDs provide parentage without synchronous ID allocation.
- Retain model request/response envelopes, tool arguments/results, and critic/preflight payloads in private content-addressed storage for 30 days. Reasoning remains encrypted, binary images are omitted, secret-like fields are redacted, and span rows retain hashes and compact summaries after payload expiry.
- The Railway web service owns leased payload cleanup through startup and scheduled recovery sweeps. Admin run pages expose the hierarchy, per-turn usage including cached input tokens, payload expiry, objective, failures, and current run activity.

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

The cost-optimized two-bucket release is `agentic-site-platform-v1.20`, toolchain `lodesta-static-site-workspace-v1.8`, manager `website-manager-v3.0`, claim policy `artifact-claim-validator-v1.3`, source policy `workspace-source-policy-v4`, and the sandbox image digest recorded in `packages/site-contracts/platform-versions.ts` after deployment.

**Cutover verification outcome (2026-07-20):** deterministic contract, manager, architecture, database, sandbox, rendering, and smoke verification passed against the coordinated release. Two preregistered live technical cases were each generated once. The matched auto-body case received optional `auto_body` context and produced an objective-valid checkpoint; its exact patch-only structural edit added `/services-overview`, preserved prior routes and capabilities, and retained the passing candidate when the bounded subjective repair failed. The unmatched landscaping case received no domain context, emitted nonblocking demand telemetry, entered the same manager, and stopped at the deliberate exact-patch budget after its first inspection. The cases exposed and fixed terminal-finish, terminal trace-payload, and candidate-attempt bookkeeping defects. Neither case was rerun, converted into a fixture, or treated as quality, readiness, or pilot evidence.

### 9. Run One Private Live Experiment

Create a private experimental candidate for `terrysbodyshop.com`, inspect desktop and mobile output, and record a narrative assessment of quality, grounding, task completion, latency, usage, and objective findings. Apply at least one observed focused edit and prove from the tool trace that every post-initial mutation used `apply_patch`, never `write_file`.

The Terry's target is acknowledged as previously observed and is not neutral evaluation evidence. There is no pass threshold, rerun allowance, or pilot implication. Retain the candidate, sessions, runs, and captures privately for continued experimentation, and delete them before any pilot begins.

### 10. Refine Shared Presentation And Publication Safety

- Format valid NANP phone values for display while preserving canonical claim, JSON-LD, and `tel:` values; leave international and unknown values unchanged.
- Replace the sparse map placeholder with one shared managed location panel using verified address, deterministic Monday-first hours, and a safe directions link. Preserve available `googlePlaceId` and hours in the existing public-input shape.
- Apply platform capability styles before agent CSS in fast preview and finalization. Let the agent restyle the shared component, while inspecting fresh sites to ensure the usable presentation floor survives the cascade.
- Add exact-version operator approvals, site-scoped finding continuity, derived publication readiness, and matching application/database promotion enforcement.
- Keep control-plane changes reviewable: confirmed truth advances immediately, but every resulting site candidate still requires operator approval before publish.
- Expose readiness blockers, run progress, failed-run retry, exact review decisions, and per-response usage in owner/operator surfaces.

### 11. Run Fresh Quality Discovery And Validation

- Freeze four fresh discovery URLs plus ordered spares under `.data/site-quality`; run each selected target once. Weak output stays in the sample, and only a crawl-stage failure may consume a predeclared spare.
- Review the five `credible-customer-draft-v1` criteria and the managed-location presentation floor. Fix shared causes only, then deploy the coordinated platform/toolchain/prompt/image release.
- Freeze three untouched validation URLs plus spares, disjoint from discovery, and run each selected target once.
- Require all three validation candidates to pass objective QA with zero unsupported claims and receive credible reviews from the product owner and one reviewer who did not implement or iterate the builder or select targets.
- Run a four-task patch-only edit battery on a retained validation site: element restyle, page addition, form movement, and mobile repair.
- Stop after a second validation failure and write a root-cause report; do not tune a third cohort into passing.

Generated quality outputs and captures are private observations, never committed visual fixtures or baselines. The runbook and commands live in `docs/site-quality-runbook.md` and `scripts/site-quality.ts`.

### 12. Run A Three-Owner Concierge Pilot

- Delete the retained Terry's experiment and any disposable quality sites before pilot admission, verifying public 404s, zero residual rows, and blob deletion.
- Admit at most three manually selected suitable local-business owners after a new pilot-entry plan is approved.
- Require operator review and an immutable exact-version approval before every publish. Pilot-published sites intentionally serve `index, follow`; candidates and experimental sites remain `noindex` and unavailable publicly.
- Observe every ingestion, initial build, owner edit, form, publish, rollback, and support event. Record incidents and operator intervention instead of hiding them with target-specific logic.
- Hold an explicit exit review before expansion. Monetary caps remain deferred until quality and workflow readiness are demonstrated; usage and latency are measured from the start.

### Deferred Beyond The Concierge Pilot

- Additional production domain-context modules and generic domain attributes.
- Fleet-wide autonomous optimization or experimentation.
- Monetary acceptance caps and pricing enforcement.
- Scheduling, embedded maps, arbitrary plugins, customer auth, ecommerce, and custom applications.
- More than two retained protocol frames or model-generated history summaries; current compaction is deterministic and protocol-safe.

## Acceptance Tests

- Strict schema, retention, provenance, and immutable-reference tests.
- Runtime-series promotion, content-hash resolution, compatibility, audit, and rollback tests.
- Catalog, custom offering, optional classification, neutral unmatched-business, and confirmation tests.
- Synthetic-module extensibility test.
- Architecture checks for V3 imports, vertical branches, templates, generated scripts, arbitrary dependencies, and compatibility paths.
- Hostile sandbox tests covering secrets, networking, embeds, scripts, links, claims, and capabilities.
- Automatic SDK declaration tests for every canonical hook.
- Forms, analytics, maps, metadata, JSON-LD, domains, internal redirects, preview, public serving, publish, and rollback tests.
- Desktop, tablet, and mobile browser verification.
- Warm reuse, idle destruction, restore, rotation, concurrent Apply, and stale-parent tests.
- Inline claim, hostile-source, sanitizer, and experimental-promotion regression vectors.
- Fake-client manager-loop tests for sequencing, idempotency, limits, interruption, checkpoint recovery, and finish preconditions.
- Apply-preflight tests for clarification and transport failure without run creation, immutable objective persistence, objective route/capability checks, literal source search, compact reasoning-safe frames, same-state cache reuse, finding deltas, and oscillation termination.
- One private Terry's candidate plus one patch-only edit and a narrative experiment report.
- Phone formatting, deterministic hours ordering, shared preview/final location styling, exact approvals, finding continuity, readiness derivation, promotion rejection, review/retry authorization, and response-usage tests.
- Four discovery sites, three untouched validation sites, the four-task edit battery, and the explicit pilot-entry report before an owner pilot.

## Assumptions

- Auto body is the only production domain-context enrichment module, but a module is not required to generate a suitable local-business site.
- Additional domain modules and generic domain attributes are deferred.
- The product remains pre-launch, permitting a destructive hard cutover.
- Git history is the V3 archive; no active legacy runtime remains after cutover.
- Cloudflare Sandbox is the default provider; E2B is fallback only after a mandatory spike failure.
- Railway and Next.js remain the V1 public-site serving layer.
- Canonical ingestion and shared capabilities remain.
- Runtime security patches may advance within a compatible series without republishing site artifacts.
- Experimental sites are technically non-publishable, even when automatic publication is requested.
- Publishing is available only after the fresh-site pilot-entry gate and exact operator approval; experimental sites remain technically non-publishable.
- The first pilot is limited to three concierge owners and requires an explicit exit review before expansion.
- Costs and latency are measured but are not product gates until quality and workflow readiness are established.
