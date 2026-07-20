create or replace function claim_prospect_report_job_v1(worker_id text)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id text;
begin
  select id into target_id
  from jobs
  where kind = 'prospect_presence_report'
    and status = 'queued'
    and run_after <= now()
  order by created_at
  for update skip locked
  limit 1;

  if target_id is null then return; end if;

  return query
  update jobs
  set status = 'running',
      attempts = attempts + 1,
      locked_by = worker_id,
      locked_at = now(),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = target_id
  returning *;
end;
$$;

revoke all on function claim_prospect_report_job_v1(text) from public;
grant execute on function claim_prospect_report_job_v1(text) to service_role;
