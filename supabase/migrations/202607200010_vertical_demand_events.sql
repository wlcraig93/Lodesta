create table vertical_demand_events_v1 (
  id text primary key,
  schema_version text not null check (schema_version = 'vertical-demand-event-v1'),
  source_url text not null,
  observed_vertical text,
  requested_by text not null,
  status text not null check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null,
  reviewed_at timestamptz,
  reviewed_by text
);

create index vertical_demand_events_v1_status_idx
  on vertical_demand_events_v1(status, created_at desc);

alter table vertical_demand_events_v1 enable row level security;

grant select, insert, update on vertical_demand_events_v1 to service_role;
