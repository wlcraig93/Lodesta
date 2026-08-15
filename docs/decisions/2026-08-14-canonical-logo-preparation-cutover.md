# Canonical logo preparation cutover

Date: 2026-08-14
Environment: non-production
Canonical authoring/runtime: V2 (unchanged)

## Reviewed stored-data report

Before cutover:

- 331 sites.
- 311 active source-derived logo authorities.
- 247 active source logos without a valid preparation receipt or decoded dimensions.
- 64 active source logos using the legacy revision formula.
- 254 retained immutable public build inputs referencing an affected historical revision.
- 184 source logos required pixel normalization; 127 were examined and intentionally preserved with an empty operation list.

The cutover created new immutable recipe-bound asset revisions and updated only mutable `BusinessState` asset pointers used by future build inputs. It did not rewrite retained asset revisions, public build inputs, workspace revisions, build artifacts, site versions, or public runtime bytes.

The first apply attempt stopped before mutable authority updates when the existing unique `(business_id, content_hash)` index rejected an unchanged-byte preparation receipt. Migration `202608140001_immutable_logo_preparation_revisions.sql` replaced that uniqueness constraint with a non-unique lookup index because immutable revision/provenance identity and byte identity are intentionally distinct. The migration and non-production ledger were verified before the idempotent cutover resumed.

After cutover:

- 311 of 311 active source logos use the canonical recipe-bound revision formula.
- Zero active source logos lack preparation provenance or valid dimensions.
- Zero active source logos use the legacy formula.
- Zero retained build inputs were rewritten.
- Final report hash: `sha256:c8e69e7c19b5c0f18ce3bf2e58adbe3c8261f668a6482948ab84f433abc7ee2e`.

## Operational outcome

Logo preparation is now a platform responsibility. Source adoption, retained/canary cloning, experiment cloning, and source-evidence previews use the same Sharp preparation algorithm. Owner-uploaded originals remain byte-exact, and only canonical owner-upload logo revisions retain the bounded authored-crop verification exception.

The author-visible `Asset` interface is unchanged. V2 remains canonical; this cutover does not promote V3 or add an authoring profile.
