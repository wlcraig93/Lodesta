alter table public.asset_revisions
  drop constraint if exists asset_revisions_content_hash_key;

create unique index if not exists asset_revisions_business_content_hash_idx
  on public.asset_revisions(business_id, content_hash);
