-- Distinct immutable preparation recipes may intentionally preserve the exact
-- same bytes. Revision identity and provenance, not business/content identity,
-- are the authority boundary.
drop index if exists public.asset_revisions_business_content_hash_idx;

create index asset_revisions_business_content_hash_idx
  on public.asset_revisions(business_id, content_hash);
