-- Canonical operational website assessments and prospect-report clean cut.
-- Pre-launch clean cut: retired prospect jobs must be drained or explicitly removed
-- by an operator before this migration is applied.

do $$
begin
  if exists (select 1 from public.prospect_report_jobs limit 1) then
    raise exception 'retired_prospect_report_jobs_not_empty: drain or explicitly clear pre-launch jobs before applying the website-assessment cutover';
  end if;
  if exists (select 1 from public.prospect_reports where job_id is not null limit 1) then
    raise exception 'retired_prospect_report_job_references_present: explicitly resolve pre-launch report jobs before applying the website-assessment cutover';
  end if;
end $$;

drop function if exists public.claim_prospect_report_job(text);
drop table public.prospect_report_jobs;
alter table public.prospect_reports drop column job_id;

create table public.website_assessments (
  id text primary key,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  target_kind text not null check (target_kind in ('public_url', 'site_artifact', 'published_site')),
  source_key text not null,
  source_url text,
  site_id text references public.sites(id) on delete restrict,
  artifact_id text references public.site_build_artifacts(id) on delete restrict,
  version_id text references public.site_versions(id) on delete restrict,
  rubric_identity text not null,
  scanner_identity text not null,
  assessment_json jsonb,
  error_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint website_assessments_target_shape check (
    (target_kind = 'public_url' and source_url is not null and artifact_id is null)
    or (target_kind = 'published_site' and source_url is not null and site_id is not null)
    or (target_kind = 'site_artifact' and site_id is not null and artifact_id is not null)
  ),
  constraint website_assessments_completion_shape check (
    (status = 'completed' and assessment_json is not null and completed_at is not null)
    or status <> 'completed'
  ),
  constraint website_assessments_payload_identity check (
    assessment_json is null
    or (
      assessment_json @> '{"schemaVersion": 1}'::jsonb
      and assessment_json ->> 'id' = id
      and assessment_json #>> '{target,kind}' = target_kind
      and assessment_json #>> '{target,sourceKey}' = source_key
      and assessment_json #>> '{target,siteId}' is not distinct from site_id
      and assessment_json #>> '{target,artifactId}' is not distinct from artifact_id
      and assessment_json #>> '{target,versionId}' is not distinct from version_id
      and assessment_json #>> '{producer,rubricIdentity}' = rubric_identity
      and assessment_json #>> '{producer,scannerIdentity}' = scanner_identity
    )
  )
);
create index website_assessments_source_key_created_idx
  on public.website_assessments(source_key, created_at desc);
create index website_assessments_site_id_created_idx
  on public.website_assessments(site_id, created_at desc)
  where site_id is not null;
create index website_assessments_artifact_id_idx
  on public.website_assessments(artifact_id)
  where artifact_id is not null;
create index website_assessments_version_id_idx
  on public.website_assessments(version_id)
  where version_id is not null;

alter table public.prospect_reports
  add column assessment_id text references public.website_assessments(id) on delete restrict;
alter table public.prospect_reports
  add column business_strength_json jsonb;
create index prospect_reports_assessment_id_idx
  on public.prospect_reports(assessment_id)
  where assessment_id is not null;

create table public.website_assessment_jobs (
  id text primary key,
  assessment_id text not null references public.website_assessments(id) on delete restrict,
  prospect_report_id text references public.prospect_reports(id) on delete restrict,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 2 check (max_attempts > 0),
  run_after timestamptz not null,
  locked_by text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index website_assessment_jobs_assessment_id_idx
  on public.website_assessment_jobs(assessment_id);
create index website_assessment_jobs_prospect_report_id_idx
  on public.website_assessment_jobs(prospect_report_id)
  where prospect_report_id is not null;
create index website_assessment_jobs_queue_idx
  on public.website_assessment_jobs(run_after, created_at)
  where status = 'queued';
create unique index website_assessment_jobs_active_assessment_idx
  on public.website_assessment_jobs(assessment_id)
  where status in ('queued', 'running');
create unique index website_assessment_jobs_prospect_report_unique_idx
  on public.website_assessment_jobs(prospect_report_id)
  where prospect_report_id is not null;

create function public.enforce_website_assessment_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.target_kind is distinct from new.target_kind
    or old.source_key is distinct from new.source_key
    or old.source_url is distinct from new.source_url
    or old.site_id is distinct from new.site_id
    or old.artifact_id is distinct from new.artifact_id
    or old.version_id is distinct from new.version_id
    or old.rubric_identity is distinct from new.rubric_identity
    or old.scanner_identity is distinct from new.scanner_identity then
    raise exception 'website_assessment_identity_is_immutable';
  end if;
  if old.assessment_json is not null and old.assessment_json is distinct from new.assessment_json then
    raise exception 'completed_website_assessment_payload_is_immutable';
  end if;
  if old.status = 'completed' and new is distinct from old then
    raise exception 'completed_website_assessment_is_immutable';
  end if;
  return new;
end;
$$;
create trigger website_assessments_immutable_update
  before update on public.website_assessments
  for each row execute function public.enforce_website_assessment_immutability();

create function public.claim_website_assessment_job(worker_id text)
returns setof public.website_assessment_jobs
language plpgsql
security definer
set search_path = public
as $$
declare target_id text;
begin
  update public.website_assessment_jobs
    set status = 'failed',
        error = coalesce(error, 'stale_worker_exhausted_attempts'),
        completed_at = now(),
        updated_at = now()
    where status = 'running'
      and locked_at < now() - interval '30 minutes'
      and attempts >= max_attempts;

  select id into target_id
    from public.website_assessment_jobs
    where (
      status = 'queued' and run_after <= now()
    ) or (
      status = 'running'
      and locked_at < now() - interval '30 minutes'
      and attempts < max_attempts
    )
    order by run_after, created_at
    for update skip locked
    limit 1;
  if target_id is null then return; end if;
  return query
    update public.website_assessment_jobs
      set status = 'running',
          attempts = attempts + 1,
          locked_by = worker_id,
          locked_at = now(),
          updated_at = now()
      where id = target_id
      returning *;
end;
$$;

alter table public.website_assessments enable row level security;
alter table public.website_assessment_jobs enable row level security;
revoke all on table public.website_assessments from public, anon, authenticated;
revoke all on table public.website_assessment_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.website_assessments to service_role;
grant select, insert, update, delete on table public.website_assessment_jobs to service_role;
revoke all on function public.enforce_website_assessment_immutability() from public, anon, authenticated;
revoke all on function public.claim_website_assessment_job(text) from public, anon, authenticated;
grant execute on function public.claim_website_assessment_job(text) to service_role;
