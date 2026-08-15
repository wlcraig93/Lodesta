alter table public.source_snapshot_objects
  drop constraint source_snapshot_objects_kind_check;

alter table public.source_snapshot_objects
  add constraint source_snapshot_objects_kind_check
  check (kind in ('robots', 'sitemap', 'http_body', 'rendered_dom', 'screenshot'));

create index source_snapshot_objects_snapshot_id_idx
  on public.source_snapshot_objects(source_snapshot_id, id);

create index source_snapshot_chunks_live_snapshot_id_idx
  on public.source_snapshot_chunks(source_snapshot_id, id)
  where stale_at is null;
