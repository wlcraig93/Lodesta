create or replace function claim_site_agent_run_v1(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target site_agent_runs_v1%rowtype;
  claimed jsonb;
  now_value timestamptz := now();
begin
  select * into target from site_agent_runs_v1 where id = target_run_id for update;
  if target.id is null or target.status <> 'queued' then return null; end if;

  claimed := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(target.run, '{status}', '"running"'::jsonb),
        '{stage}', '"authoring"'::jsonb
      ),
      '{attempt}', to_jsonb(coalesce((target.run ->> 'attempt')::integer, 0) + 1)
    ),
    '{heartbeatAt}', to_jsonb(now_value)
  );

  update site_agent_runs_v1
  set status = 'running', run = claimed
  where id = target_run_id;
  return claimed;
end;
$$;

revoke all on function claim_site_agent_run_v1(text) from public;
grant execute on function claim_site_agent_run_v1(text) to service_role;
