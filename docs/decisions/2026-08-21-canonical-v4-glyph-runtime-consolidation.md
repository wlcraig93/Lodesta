# Canonical V4 glyph and runtime consolidation

Status: reversible release complete; evidence set and destructive reset pending owner decisions

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

V1–V3 derivations remain temporarily because retained database references are boundary-sensitive. After the confirmed prelaunch reset proves zero references, a second release deletes those branches and the V1 source. At that point R8/V2 bytes exist only in sealed evidence and cannot be rebuilt or selected. That is an intentional one-way door.

## Reversible release evidence

Release `3cb58520e0b7157406416344bf2048beb798b591` completed the coordinated web, worker, and sandbox rollout. Railway web deployment `28706815-f2e9-4839-83fc-ac5a9a173395` and worker deployment `68a62add-0685-4e17-8468-1ffaeebd3022` both reported the exact release SHA before promotion. Sandbox deployment `sandbox_deployment_a3f0e8ed6e5c35f306f7e3da3343d837`, Worker version `fae65bfb-ef3b-44ff-a008-41b89e3ac443`, and image `sha256:f482aa2303cf1f01ec1ddf958dbde767919fb065f1f3747a28aac9682ac9aaee` passed the compile, replay, isolation, repair, and manifest canary. Authenticated post-promotion deep health passed and the maintenance lease was released.

The first attempt exposed and safely stopped on a release-workflow deadlock: the new web controller required the new sandbox manifest, while the pre-promotion check required full deep health before moving the sandbox pointer. The workflow now uses a narrow authenticated release-identity probe before promotion and reserves full deep health for after promotion. No sandbox pointer moved during the failed attempt.

## Historical evidence and previews

The decisive controls and treatments are sealed as content-addressed archives in the private `wlcraig93/Lodesta-evidence` GitHub release `canonical-authoring-evidence-2026-08-21`, outside the application blob broker and artifact-orphan audit. A complete archive includes database provenance, exact artifact/workspace/runtime bytes, screenshots, the original six font binaries, and frozen experiment inputs. All eight assets (139,329,603 bytes) were independently downloaded and verified after upload. The checked-in registry is the integrity anchor. Reset verification uses the local verified copies and never calls GitHub, so destructive authorization has no third-party availability dependency. A localhost-only viewer rejects analytics and form mutations.

Historical bundles intentionally reproduce their original glyph defects. New finalized artifacts use the corrected managed fonts. Retained artifact bytes are never rewritten.

Implementation audit found an important provenance limitation before reset: the six hosted V4 runs still have their exact database graph and artifact/workspace blobs and can be sealed under this contract. The matched R8 controls (`run_4ff1721a1f754748bcfa3dc93281a478` and `run_edecd4f2d67040c29f6e7dd646ef7205`) were private local runs. Their reports and QA captures survive, but their exact artifact and workspace blobs were never persisted to the hosted stores and remain supplemental evidence only. On owner approval, the reconstructable decisive-evidence registry substitutes the complete retained hosted R8 baselines `run_c0d04e7292b84ae5981654959cafdc4a` for Kind and `run_07b17e4678b24fe9bcbd18928ea1ecc3` for Surge. Incomplete local bytes are never represented as fully reconstructable archives.

## Reset boundary

The existing `maintenance:reset-prelaunch-site-authoring` operator is repaired rather than duplicated. Its live-schema contract expects `site_agent_workspace_checkpoints`, `analytics_collection_daily`, and `source_snapshot_mirror_references`; retired tables must remain absent. The operator nulls the checkpoint cycle, deletes those dependencies in foreign-key order, preserves the prospect/outbound corpus, verifies all evidence bundles, and requires a fresh exact report confirmation.

Implementation approval does not authorize applying the reset. The destructive confirmation is collected only after the reversible release and all eight retained archives are verified locally against the checked-in registry.

## Promotion record correction

Five V4 artifacts contain non-portable symbols; the sixth is clean. The frozen nine-category blinded scores remain unchanged. Portable glyph rendering is a technical precondition for future comparisons. V4 promotion stands because the R8 navigation failure was structural and repeated across both businesses, whereas the glyph defect is a deterministic platform gap corrected centrally.
