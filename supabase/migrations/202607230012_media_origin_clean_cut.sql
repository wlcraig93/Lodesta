-- Pre-launch media-origin clean cut. Retained authority payloads are intentionally
-- not migrated because rights status and asset origin are different semantics.
-- Run the manifest-bound generated-site reset before applying this migration.

begin;

do $$
begin
  if exists (select 1 from public.business_states limit 1)
    or exists (select 1 from public.asset_revisions limit 1)
    or exists (select 1 from public.site_public_build_inputs limit 1)
    or exists (select 1 from public.site_versions limit 1) then
    raise exception 'media_origin_cutover_requires_empty_authorities: run the reviewed pre-launch generated-site reset first';
  end if;
end $$;

alter table public.asset_revisions
  add column if not exists origin text;

alter table public.asset_revisions
  alter column origin set not null,
  alter column provenance set not null;

alter table public.asset_revisions
  drop constraint if exists asset_revisions_origin_check;

alter table public.asset_revisions
  add constraint asset_revisions_origin_check
  check (origin in ('source_website', 'owner_upload', 'platform_generated'));

alter table public.asset_revisions
  drop column if exists rights_status,
  drop column if exists attestation;

commit;
