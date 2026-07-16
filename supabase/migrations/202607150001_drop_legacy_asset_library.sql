drop table if exists asset_library_reviews;
drop table if exists asset_library_assets;
drop table if exists asset_library_batches;

-- The protected storage schema rejects direct SQL deletion. The confirmation-
-- gated cleanup:generation-precutover command empties and removes this bucket
-- through the Storage API before this migration is applied.
