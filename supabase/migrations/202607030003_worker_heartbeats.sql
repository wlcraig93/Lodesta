create table if not exists worker_heartbeats (
  worker_id text primary key,
  pid integer not null,
  host text not null,
  repository_mode text not null check (repository_mode in ('local', 'supabase')),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  current_job_id text references jobs(id) on delete set null,
  current_job_kind text,
  updated_at timestamptz not null default now()
);

create index if not exists worker_heartbeats_last_seen_at_idx on worker_heartbeats(last_seen_at desc);

grant select, insert, update on worker_heartbeats to service_role;
