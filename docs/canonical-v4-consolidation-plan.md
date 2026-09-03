# Canonical V4 consolidation

Status: proposed, August 21, 2026. Not an approved product-owner decision.

Three owner decisions are required before implementation: adding `render.missing_glyph` as a blocking gate finding (Phase 1), authorizing the prelaunch reset (Phase 4), and the deferred design-authority schema change.

V4 is promoted and that promotion holds. This program closes the one rendering defect the bake-off missed, collapses the runtime to a single canonical source, and clears the accumulated prelaunch generated-site data — in an order where every irreversible step stands behind a proof.

## Shape

The work divides on reversibility, not on topic.

- **Phases 1, 2, and 5 are releases.** Code changes, shipped through the normal release path, reversible by revert.
- **Phases 3 and 4 are a runbook.** A one-time destructive operation against live data under a maintenance lease, not reversible.

Phases 1 and 2 share one sandbox image build and one `sandboxImageDigest` update. Phase 5 is a separate release because its precondition — zero references to V1–V3 — only becomes true after Phase 4 has run.

## Phase 1 — Guarantee that authored text renders

Five of the six retained V4 runs render a missing-glyph box in the homepage first viewport. Neither R8 control does.

| Run | Business | Codepoint | Location |
|---|---|---|---|
| `run_9aa92465f7f74955ac76632128211f96` | Kind 1 | `✳` U+2733 | hero proof mark |
| `run_ddbf867f44a542e1b41a2fb9397d92c3` | Kind 2 | `✳` U+2733 | hero note |
| `run_fe8092f18990423ab875a21cbb4d24c3` | Kind 3 | — | clean; used no symbol beyond `→` and `↗` |
| `run_cd6c6dc8abea4aa7b8008be84a58b5b5` | Surge 1 | `↗` U+2197 | hero call-to-action button |
| `run_d6f0ebc5250142a9a218ca653170e627` | Surge 2 | `↯` U+21AF | hero badge, renders as the literal words `NO GLYPH` |
| `run_fb98492673ba4085879c9794726b74c7` | Surge 3 | `✓` U+2713 | hero trust line |

This is a platform capability gap, not authoring judgment. Every managed face in `workers/site-sandbox/scaffold/platform/font-library.ts` is a Latin subset, which excludes all four codepoints. No `@font-face` in the repository declares `unicode-range`, so a Latin-only face claims coverage it does not have. The declared fallbacks — `Georgia`, `ui-serif`, `system-ui` — are not installed by `workers/site-sandbox/Dockerfile` and are not guaranteed anywhere else in the chain. The agent-facing `packages/site-agent/font-library.ts` describes each family's character and roles and says nothing about codepoint coverage, so the author had no way to respect a constraint it was never given.

Because coverage falls through to the visitor's own system fonts, a published symbol can render on one visitor's device and fail on another's. This is boundary-sensitive published behavior, not a capture artifact.

**Guarantee it.**

- Add an OFL-licensed symbol face subset to the symbol ranges — Noto Sans Symbols 2 covers all four failing codepoints — as the final entry in every stack in `platformFontStyles`. Ship its license file per the existing `app/fonts/*-OFL.txt` convention.
- Add the binary to both `public/_lodesta/fonts/` and `workers/site-sandbox/scaffold/public/_lodesta/fonts/`, and add its filename to `trustedFontFiles`. The gate allowlist at `packages/site-verification/browser-gate.ts:1400` and the assertion at `scripts/verify-site-authoring-platform.ts:135` both read that list.
- Add `unicode-range` to the Latin faces so the fallback chain engages rather than the Latin face absorbing every codepoint. Hygiene; the symbol face is the fix.
- Declare coverage in `packages/site-agent/font-library.ts` and add one skill line preferring authored inline SVG for icons. The author's SVG, not platform artwork — no conflict with the V4 boundary.

`platformFontStyles` is prepended to final CSS at `packages/site-verification/finalizer.ts:59`, so this is a single-point, forward-only change. New artifacts gain the guarantee; retained artifacts keep their baked bytes untouched.

**Detect what escapes it.**

- Compute a `render.missing_glyph` finding in `packages/site-verification/browser-gate.ts` alongside the existing render findings: collect every non-ASCII codepoint in rendered text, resolve each against its element's computed font, report any that falls through to last resort.
- Register it in `blockingIds` in `packages/site-contracts/platform-manifest.ts`, next to `render.escaped_sequence`, its closest analogue, and add it to the surfaced finding list in `packages/site-platform/manager-runtime.ts`.

`browser-gate.ts` is shared, so one implementation serves both tiers: `inspect_site` surfaces it mid-run for the author to repair inside the loop it already runs, and the release gate blocks it at finalization. No new tool, no new phase, no repair continuation. The finding is objective and functional, so blocking on it is consistent with the Simplification Doctrine.

## Phase 2 — Collapse the runtime to one canonical source

Serving is already data-driven: `app/_lodesta/runtime/[file]/route.ts` resolves series to patch to blob with no per-series code branch. The debt is not the series IDs, it is that `buildSiteRuntimeBytes` derives V2, V3, and V4 by string surgery on `packages/trusted-runtime/site-runtime-v1.js`, guarded by `if (!source.includes(...)) throw`.

- Materialize the exact deployed V4 bytes as a canonical runtime source file and assert its SHA-256 equals the active V4 patch before removing anything. A mismatch blocks the phase and becomes a separate runtime release.
- Change `buildSiteRuntimeBytes` to accept only the canonical series and read that file directly.
- Create no new runtime series or patch. The materialized source reproduces the deployed bytes exactly or the phase does not proceed.

Legacy branch removal — the V1→V2→V4 surgery, the V3 transformation, `platformCapabilityStylesFor`'s V1/V2/V3 branches, and the V3 `source-policy.ts` branch — is deferred to Phase 5. Removing them here would leave the retained V2 artifacts still in the database un-rebuildable during the window before the reset.

Ship Phases 1 and 2 as one release: one image build, one `sandboxImageDigest` update in `packages/site-contracts/platform-manifest.ts`, one preflight.

## Phase 3 — Seal the evidence

Eight runs: the Kind and Surge R8 controls and the six V4 runs listed above.

Add one evidence-export operator producing a content-addressed archive per run containing the run, session, event and sanitized telemetry records; the site, business state, intent, public input, forms, workspace revision, artifact, and version payloads; exact artifact files and QA screenshots; the workspace archive and source sidecar; referenced source snapshots and eligible assets; exact runtime-patch bytes; the prompt, skill, authoring-profile, model, toolchain, sandbox-image, and capability-CSS identities; the frozen R8 profile and the evaluation record; and a canonical manifest of every file hash plus an overall bundle hash.

**Bundle the six font binaries.** Artifact CSS carries absolute `url("/_lodesta/fonts/…")` references baked in at finalization. An archive that omits the woff2 files renders with a different fallback chain than the original — and since the glyph defect *is* a fallback-chain artifact, the bundle would fail to reproduce the thing it exists to record.

**Store the archives outside the audited stores.** `artifactBlobStores` is `["artifact", "workspace"]` in `packages/site-artifacts/blob-store.ts:12`, and `collectReferencedObjects()` in `scripts/audit-artifact-blobs.ts` builds the referenced set purely from database rows. After Phase 4 there are almost no rows left, so everything in an audited store becomes an orphan — at the exact moment the archives are the only surviving copy. Add a third store the audit never enumerates rather than teaching the audit a registry exception. A structural exclusion cannot fail the way a conditional can.

Add a tracked registry recording each run ID, archive key, byte count, content hash, artifact hash, runtime identity, treatment label, and its `render.missing_glyph` findings. Add a local read-only viewer that serves an extracted artifact, its exact runtime bytes, and the bundled fonts from localhost, blocking analytics and form mutations while preserving navigation and visual behavior. Raw archive bytes stay unmodified.

Sealing order relative to Phase 1 does not matter once fonts are bundled: retained artifacts already carry the old stack in their baked CSS, and adding a face never rewrites them.

## Phase 4 — Complete and apply the reset

Extend `maintenance:reset-prelaunch-site-authoring`. Do not add a second destructive operator and do not add a selective-retention mode.

**The existing reset cannot currently complete.** Ten tables hold `on delete restrict` foreign keys into the generated-site graph and the reset never touches any of them. Each blocks a delete the reset already attempts:

| Table | Blocks |
|---|---|
| `site_agent_workspace_checkpoints` | `site_agent_runs`, `site_public_build_inputs`, `site_workspace_revisions` |
| `analytics_collection_daily` | `sites` |
| `website_setups` | `sites`, `site_agent_runs`, `site_agent_sessions` |
| `source_snapshot_mirror_references` | `source_snapshots` |
| `generation_experiment_runs` | `sites`, `site_versions`, `site_agent_runs`, `website_assessments` |
| `model_bakeoff_runs` | `sites`, `site_versions`, `site_agent_runs`, `website_assessments` |
| `authoring_execution_bundles` | `site_agent_runs`, `site_public_build_inputs` |
| `external_authoring_batch_items` | `sites`, `site_versions`, `site_agent_runs`, `site_agent_sessions` |
| `external_authoring_executions` | `site_agent_runs` |
| `prospect_observations` | `website_assessments` |

They are all `restrict`, so the reset fails loudly rather than cascading silently — but it does fail. Add each to the report inventory and to the deletion order ahead of its parent. `prospect_observations` is preserved data: extend the existing `deleteSiteAssessments` guard, which already blocks on prospect references, to cover `generation_experiment_runs.website_assessment_id` and `model_bakeoff_runs.website_assessment_id` as well.

**Report.** Inventory every table below, with exact sorted target-ID digests. Enumerate authority and boundary-sensitive rows individually; summarize high-cardinality children by parent while keeping their exact ID digest inside the report hash. Record before-state digests for preserved prospect and campaign tables. Verify all eight evidence archives before emitting an apply confirmation. Application continues to require the current report hash, a valid maintenance lease, a drained authoring queue, and a fresh matching inventory.

**Must be empty afterwards.** Sites, business states, intents, forms; public build inputs and association rows; workspace revisions, sidecars, checkpoints, sessions, runs, continuations, messages, events; build artifacts, versions, captures, previews, domains, redirects, inquiries, analytics and `analytics_collection_daily`; site-bound assessments and their jobs; `website_setups`; `staged_blob_receipts`; source snapshots, their chunk/object/page/resource tables and `source_snapshot_mirror_references`; `generation_experiments`, `generation_experiment_runs`, `model_bakeoff_experiments`, `model_bakeoff_runs`; `vertical_demand_events`; and `businesses` and `asset_revisions`.

Delete `businesses` unconditionally. After a global reset every business is a generated-site business — `outbound_prospects` stores `business_name` as plain text with no foreign key to `businesses`, and nothing in the prospect or outbound corpus references it. Qualifying the delete would reintroduce complement-set logic in the one table that does not need it.

**Preserved.** Supabase Auth users; the full `prospect_*` family; `outbound_campaigns`, `outbound_prospects`, `outbound_events`; assessments unrelated to generated sites; `site_sandbox_deployments` and `site_sandbox_control`; `operator_settings` and `operator_setting_audits`; `site_agent_maintenance_leases`; and the active V4 runtime series with its active and previous rollback patches.

**Drained, not deleted.** `authoring_outbox`, `authoring_execution_bundles`, and the `external_authoring_*` family must hold zero active work before apply. Assert drained, not empty.

Before deleting sites, null only the permitted site-facing references on preserved records: `outbound_prospects.site_id`, `outbound_prospects.preview_id`, and `outbound_events.site_id`. If a retained authority depends on a site-specific assessment that cannot be detached without rewriting an immutable payload, block and require explicit disposition rather than rewriting it.

Destroy sandboxes before deleting their sessions; confirmed-absent counts as destroyed.

**Interruption.** No resume token. `deleteAll` and `updateAll` use `.not(column, "is", null)`, so re-running against an already-empty table is a no-op and the reset is genuinely idempotent. On interruption: keep maintenance active, rerun the report against remaining rows, review and confirm the new hash, reapply.

**Then reclaim blobs** as a separate reviewed operation through the existing `audit:artifact-blobs` flow, which already carries its own hashed orphan report and confirmation. Require zero missing referenced objects before and zero managed orphans after.

## Phase 5 — Remove legacy runtime code

Only after Phase 4 proves zero references.

- Delete the V1–V3 runtime series and patch rows, and their unreferenced patch blobs.
- Remove the V1→V2→V4 string surgery and the V3 transformation from `packages/trusted-runtime/index.ts`.
- Remove the V1/V2/V3 branches from `platformCapabilityStylesFor` and the V3 branch from `workers/site-sandbox/scaffold/platform/source-policy.ts`.
- Remove the legacy public SDK surfaces, keeping the narrowed managed-form and headless navigation authoring surface.
- Constrain runtime promotion and rollback to patches within the canonical series.

Keep `packages/trusted-runtime/site-runtime-v1.js` until Phase 2's materialized source is deployed and verified; it is the root that V2 and V4 are derived from, not a peer implementation.

Update fixtures deliberately. `scripts/verify-site-authoring-platform.ts` uses `site-runtime-v1` in 35 places and `scripts/support/synthetic-site-input.ts:6` defaults to it. These read as arbitrary series strings, but `platformCapabilityStylesFor` branches on the ID, so a blind rename swaps `legacyLocationCapabilityStyles` for `headlessCapabilityStyles` and silently changes what those verifications assert.

`scripts/verify-baseline-release-candidate.ts:21` imports `retained-control-profile.ts` from `.design/`, which is why the bake-off fixture is in Railway builds. Removing the R8 harnesses breaks that script unless both go together.

Product and admin UI refer to the canonical generator; `site-runtime-v4` may remain the internal immutable series ID. Do not rename historical evidence.

## Deferred — typed design authority

`siteIntentSchema` carries `brandConstraints` as free-form colour strings and notes, with no typography field. The author invents its own type scale and font variables in `styles.css` each run, so "use my brand blue" is a re-authoring gamble rather than a product surface, and the same business yields materially different systems across runs.

Add typed design intent to `SiteIntent` covering font pairing from the trusted library, palette roles, density, and logo treatment. The author reads it as input and composes freely within it; an owner edit becomes a typed control-plane change that bumps the intent revision and rebuilds.

This is a strict-authority schema change and needs its own decision. It is deliberately not bundled here; a four-line font fix should not wait on it.

## Rejected — a general quality-inspection agent

Beyond the Simplification Doctrine's bar on automatic critics and repair continuations, this defect is the argument. A nine-category blinded review, applied by a reviewer actively hunting for problems, missed a twelve-pixel box five times out of six — including a badge reading `NO GLYPH` across a hero photograph. A vision critic would fare no better on that class, while `document.fonts.check()` catches it in every run in under a millisecond. Critics detect nondeterministically at a recurring per-candidate cost; the fix here is one `@font-face` block committed once.

The governing rule: if a check can be written, write it and push it as far down as it goes — platform guarantee, then context, then the tools the author already calls, then the gate. If a check cannot be written, a critic will not reliably catch it either, and the fix belongs in the skill.

The legitimate part of the idea is already served by surfacing `render.missing_glyph` through `inspect_site` in Phase 1.

## Evidence correction

`.design/canonical-authoring-bakeoff/EVALUATION.md` records `run_d6f0ebc5250142a9a218ca653170e627` as `Clean`. Amend the reliability table and promotion decision to record the defect, its five affected runs, and its root cause, and add a tenth blinded-review category covering whether every authored glyph renders. The existing nine had no row that could have caught this.

The promotion decision stands. R8's navigation failure is structural across both businesses, its desktop navigation is hamburger-only at 1280px, and its own arms carry text defects. This is a gate gap, not grounds to revert.

## Verification

Per release: `npm run typecheck`, `npm run verify:static`, `npm run verify:preflight`.

Phase 1 and 2 additionally: `npm run verify:render-browser`, `npm run verify:trusted-runtime`, `npm run verify:sandbox` and `npm run verify:site-sandbox-manifest` after the image rebuild; a fixture asserting each of U+2197, U+21AF, U+2713, and U+2733 resolves to a covering face under the managed stack and that a deliberately uncovered codepoint produces `render.missing_glyph`; and a fixture asserting the materialized canonical source SHA equals the active V4 patch.

Phase 3 and 4 additionally: every bundle reconstructs its manifest and passes all file, artifact, workspace, runtime, and overall hashes; tampered, missing, or unregistered evidence blocks reset and blob deletion; the viewer renders desktop, mobile, opened navigation, and form states without external mutation; the report covers every FK-dependent table above; inventory drift invalidates confirmation; boundary and retained-prospect conflicts fail loudly; simulated partial deletion completes through a new report; preserved prospect digests differ only in the declared nullable fields; post-reset must-be-empty counts are zero and drained tables hold no active work.

Phase 5 additionally: V1–V3 runtime, CSS, SDK, and source-policy selection is unreachable; V4 navigation, forms, preview rendering, public rendering, and runtime rollback remain correct.

## Sequencing

1. Release Phases 1 and 2 together. One image build, one digest update.
2. Confirm web, worker, sandbox manifest, image digest, and active V4 runtime identity.
3. Export all eight bundles; independently re-read each and verify every hash; browse each site in the viewer.
4. Acquire draining maintenance; wait for zero active executions.
5. Generate and review the complete reset report; apply under its exact hash confirmation.
6. Run the artifact-blob audit as a separate reviewed operation.
7. Verify zero-site state, prospect preservation, archive retrievability, and active V4 runtime.
8. Release maintenance; run authenticated deep health.
9. Create one fresh site from an unused prospect through canonical V4 and confirm a clean first viewport with no `render.missing_glyph` finding. Record its quality, cost, duration, and infrastructure evidence.
10. Release Phase 5 once the zero-reference assertion passes.

Step 9 must follow Phase 1, not precede it. At the current defect rate a showcase site created before the glyph guarantee would ship a broken hero — and it would be the only site to survive the reset.

## Ongoing prelaunch hygiene

Use local file-backed authoring for ordinary development. Keep hosted experimental sites only long enough to make and record a decision. Seal only decision-bearing evidence. Run cleanup manually after major experiment batches; add no automatic destructive retention job. Disable the global reset when the first production customer is onboarded — customer-era disposal requires a separately designed per-site lifecycle.
