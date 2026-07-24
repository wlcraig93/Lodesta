alter table source_snapshots drop constraint source_snapshots_source_type_check;
alter table source_snapshots
  add constraint source_snapshots_source_type_check
  check (source_type in ('website', 'web_research', 'owner_input', 'operator_input'));
