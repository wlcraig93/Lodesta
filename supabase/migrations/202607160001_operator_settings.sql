-- Canonical operator-owned model configuration used by generation runtime.
create table if not exists public.operator_settings (
  key text primary key,
  value jsonb not null,
  version int not null default 1 check (version >= 1),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.operator_setting_audits (
  id text primary key,
  setting_key text not null,
  status text not null check (status in ('changed', 'rejected')),
  changed_by text not null,
  changed_at timestamptz not null default now(),
  previous_value jsonb,
  new_value jsonb,
  error text
);

create index if not exists operator_setting_audits_key_time_idx
  on public.operator_setting_audits(setting_key, changed_at desc);

alter table public.operator_settings enable row level security;
alter table public.operator_setting_audits enable row level security;

grant select, insert, update, delete on public.operator_settings to service_role;
grant select, insert, update, delete on public.operator_setting_audits to service_role;
