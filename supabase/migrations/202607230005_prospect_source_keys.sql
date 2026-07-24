do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prospect_reports' and column_name = 'place_id'
  ) then
    alter table prospect_reports rename column place_id to source_key;
  end if;
end
$$;

alter table prospect_reports add column if not exists resolution_usage jsonb;
drop index if exists prospect_reports_place_idx;
create index if not exists prospect_reports_source_key_idx on prospect_reports(source_key, created_at desc);
