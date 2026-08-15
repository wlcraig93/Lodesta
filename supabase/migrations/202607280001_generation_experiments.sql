-- Generation experiments supersede the model-only bake-off organizer with a
-- process-aware, reproducible experiment contract. Existing model_bakeoff_*
-- rows remain untouched as retained historical lab evidence; all new writes
-- use these canonical generation-experiment tables.

create table public.generation_experiments (
  id text primary key,
  schema_version integer not null check (schema_version = 2),
  status text not null check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'paused_credit')),
  requested_by text not null,
  document jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz
);

create table public.generation_experiment_runs (
  id text primary key,
  experiment_id text not null references public.generation_experiments(id) on delete restrict,
  schema_version integer not null check (schema_version = 2),
  ordinal integer not null check (ordinal >= 0),
  source_key text not null,
  variant_key text not null,
  replicate integer not null check (replicate between 1 and 4),
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
  unique (experiment_id, source_key, variant_key, replicate)
);

create index generation_experiment_runs_status_idx
  on public.generation_experiment_runs(experiment_id, status, ordinal);

alter table public.generation_experiments enable row level security;
alter table public.generation_experiment_runs enable row level security;
revoke all on table public.generation_experiments from public, anon, authenticated;
revoke all on table public.generation_experiment_runs from public, anon, authenticated;
grant all on table public.generation_experiments to service_role;
grant all on table public.generation_experiment_runs to service_role;
