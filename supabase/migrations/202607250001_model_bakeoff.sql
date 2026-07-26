-- Regenerable, operator-only model comparison records. Candidate sites,
-- versions, artifacts, and assessments remain retained through their canonical
-- authorities; these rows only organize the experiment and its provenance.

create table public.model_bakeoff_experiments (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  status text not null check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'paused_credit')),
  requested_by text not null,
  document jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz
);

create table public.model_bakeoff_runs (
  id text primary key,
  experiment_id text not null references public.model_bakeoff_experiments(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  ordinal integer not null check (ordinal >= 0),
  source_key text not null,
  candidate_key text not null,
  status text not null check (status in ('queued', 'building', 'assessing', 'completed', 'failed')),
  site_id text references public.sites(id) on delete restrict,
  run_id text references public.site_agent_runs(id) on delete restrict,
  candidate_version_id text references public.site_versions(id) on delete restrict,
  assessment_id text references public.website_assessments(id) on delete restrict,
  failure_code text,
  document jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  unique (experiment_id, ordinal),
  unique (experiment_id, source_key, candidate_key)
);

create index model_bakeoff_runs_experiment_status_idx
  on public.model_bakeoff_runs(experiment_id, status, ordinal);

alter table public.model_bakeoff_experiments enable row level security;
alter table public.model_bakeoff_runs enable row level security;
revoke all on table public.model_bakeoff_experiments from public, anon, authenticated;
revoke all on table public.model_bakeoff_runs from public, anon, authenticated;
grant all on table public.model_bakeoff_experiments to service_role;
grant all on table public.model_bakeoff_runs to service_role;
