# Canonical V4 glyph and runtime consolidation

Status: canonical validation complete; legacy retirement prepared for release

Date: 2026-08-21

## Decision

Optimized V4 remains Lodesta's sole canonical authoring generator. Lodesta will guarantee portable authored text through pinned managed-font coverage and a deterministic blocking glyph check, materialize the already-deployed V4 JavaScript as the direct canonical runtime source, seal the eight decisive Kind/Surge experiment runs outside operational blob stores, then reset prelaunch generated-site data before retiring V1–V3.

The rollout is deliberately split by reversibility. Font coverage and direct runtime materialization are an ordinary coordinated release. Evidence sealing is additive. The live reset remains behind a draining maintenance lease, a fresh inventory hash, eight verified archives, and an exact operator confirmation. Legacy code and rows are removed only after the reset proves zero references.

## Portable glyph boundary

Every managed Lodesta family provides its own same-family portable symbol faces. Existing Figtree bytes cover U+2197. A pinned OFL Noto Sans Symbols 2 v2.008 subset covers U+21AF, U+2713, and U+2733. The checked coverage manifest records exact binary hashes and canonical cmap ranges for all trusted fonts; CI validates those pins without adding a permanent font-parser dependency.

Agent-authored copy and controls do not use emoji. Icons are authored as accessible inline SVG. Owner-authoritative emoji is never silently removed: publishing waits for owner approval of textual replacement or explicit portable font support.

`render.missing_glyph` examines visible DOM and pseudo-element text against the computed managed Lodesta family. System-only fallback, emoji presentation, and ZWJ sequences are unsupported. The finding is available to the author during mechanical inspection and blocks finalization with a concrete ordinary-text or inline-SVG repair.

This is a functional portability gate, not an aesthetic critic. It adds no repair continuation, retry counter, or orchestration.

## Runtime provenance

`site-runtime-v4.js` is the direct source of the active canonical JavaScript. Its SHA-256 must equal the active retained runtime patch before release. Because the bytes are unchanged, this decision creates neither a runtime patch nor a runtime series.

The confirmed prelaunch reset and post-reset validation proved zero V1–V3 references, so the second release deletes those derivations and the V1 source. R8/V2 bytes then exist only in sealed evidence and cannot be rebuilt or selected. That is an intentional one-way door.

## Reversible release evidence

Release `3cb58520e0b7157406416344bf2048beb798b591` completed the coordinated web, worker, and sandbox rollout. Railway web deployment `28706815-f2e9-4839-83fc-ac5a9a173395` and worker deployment `68a62add-0685-4e17-8468-1ffaeebd3022` both reported the exact release SHA before promotion. Sandbox deployment `sandbox_deployment_a3f0e8ed6e5c35f306f7e3da3343d837`, Worker version `fae65bfb-ef3b-44ff-a008-41b89e3ac443`, and image `sha256:f482aa2303cf1f01ec1ddf958dbde767919fb065f1f3747a28aac9682ac9aaee` passed the compile, replay, isolation, repair, and manifest canary. Authenticated post-promotion deep health passed and the maintenance lease was released.

Release `2c4d3b23d42794933908858868eb87d68fb5791c` completed the canonical-only runtime rollout. Railway web deployment `06c85d46-d11c-41f5-8fe4-5f978833cfe8` and worker deployment `2abfb5c7-194f-45d3-bfbc-ebf5c2a36f7a` both reported the exact release SHA before promotion. Sandbox deployment `sandbox_deployment_6a42f623fd441bfb8ed8705f52b9054f`, Worker version `5f5e113b-73b5-47a8-b152-3c936ec59f32`, and image `sha256:5f127c8891290f7d811ba768fb4438fdeaac6666fca85a1aa04fbad1c6560d36` passed the compile, replay, isolation, repair, and manifest canary. Authenticated post-promotion deep health passed and the maintenance lease was released. The image digest was pinned after deployment, as required by the hand-maintained release-state provenance model.

The first attempt exposed and safely stopped on a release-workflow deadlock: the new web controller required the new sandbox manifest, while the pre-promotion check required full deep health before moving the sandbox pointer. The workflow now uses a narrow authenticated release-identity probe before promotion and reserves full deep health for after promotion. No sandbox pointer moved during the failed attempt.

## Historical evidence and previews

The decisive controls and treatments are sealed as content-addressed archives in the private `wlcraig93/Lodesta-evidence` GitHub release `canonical-authoring-evidence-2026-08-21`, outside the application blob broker and artifact-orphan audit. A complete archive includes database provenance, exact artifact/workspace/runtime bytes, screenshots, the original six font binaries, and frozen experiment inputs. All eight assets (139,329,603 bytes) were independently downloaded and verified after upload. The checked-in registry is the integrity anchor. Reset verification uses the local verified copies and never calls GitHub, so destructive authorization has no third-party availability dependency. A localhost-only viewer rejects analytics and form mutations.

Historical bundles intentionally reproduce their original glyph defects. New finalized artifacts use the corrected managed fonts. Retained artifact bytes are never rewritten.

Implementation audit found an important provenance limitation before reset: the six hosted V4 runs still have their exact database graph and artifact/workspace blobs and can be sealed under this contract. The matched R8 controls (`run_4ff1721a1f754748bcfa3dc93281a478` and `run_edecd4f2d67040c29f6e7dd646ef7205`) were private local runs. Their reports and QA captures survive, but their exact artifact and workspace blobs were never persisted to the hosted stores and remain supplemental evidence only. On owner approval, the reconstructable decisive-evidence registry substitutes the complete retained hosted R8 baselines `run_c0d04e7292b84ae5981654959cafdc4a` for Kind and `run_07b17e4678b24fe9bcbd18928ea1ecc3` for Surge. Incomplete local bytes are never represented as fully reconstructable archives.

## Reset boundary

The existing `maintenance:reset-prelaunch-site-authoring` operator is repaired rather than duplicated. Its live-schema contract expects `site_agent_workspace_checkpoints`, `analytics_collection_daily`, and `source_snapshot_mirror_references`; retired tables must remain absent. The operator nulls the checkpoint cycle, deletes those dependencies in foreign-key order, preserves the prospect/outbound corpus, verifies all evidence bundles, and requires a fresh exact report confirmation.

Implementation approval does not authorize applying the reset. The destructive confirmation is collected only after the reversible release and all eight retained archives are verified locally against the checked-in registry.

The owner subsequently approved and applied the exact reset inventory. The separate artifact audit then removed 42,631 database-unreferenced managed objects (5,306,934,306 bytes), reported zero missing referenced objects and zero remaining managed orphans, and deliberately left 10,301 unknown-prefix objects untouched. Cleanup used one temporary two-bucket maintenance credential; it was revoked immediately after the post-audit passed, so the cleanup left no additional standing Cloudflare token.

## Canonical validation and legacy retirement

Two fresh post-reset canonical generations passed the hard release gate: one rich automotive source and one sparse, dated wallcovering source. Both used `site-runtime-v4`, produced working managed modal navigation and custom managed forms, recorded zero `render.missing_glyph` findings, and completed every sandbox mutation on its first transport attempt without replay, recycle, or timeout. The sparse-source run required deterministic authoring repairs for copy, contrast, and typography, but never reconstructed navigation containment.

The live retirement report then proved that every retained public input, workspace revision, artifact, and version references only the canonical series. No V1–V3 series is required for historical rendering. This satisfies the one-way-door precondition: the direct V4 source remains, promotion and rollback accept only V4, and the V1–V3 source transformations, capability-style branches, native SDK facade, R8 execution fixture, and obsolete cutover operators are removed together. Historical R8/V2 bytes remain available only in the sealed evidence archives.

## Promotion record correction

Five V4 artifacts contain non-portable symbols; the sixth is clean. The frozen nine-category blinded scores remain unchanged. Portable glyph rendering is a technical precondition for future comparisons. V4 promotion stands because the R8 navigation failure was structural and repeated across both businesses, whereas the glyph defect is a deterministic platform gap corrected centrally.
