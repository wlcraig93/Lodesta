begin;

create or replace function public.cancel_site_agent_run(
  target_run_id text,
  target_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  retained public.site_agent_runs;
  run_value jsonb;
  completed_iso text := to_char(
    target_completed_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
begin
  select * into retained
    from public.site_agent_runs
    where id = target_run_id
    for update;

  if retained.id is null then return null; end if;
  if retained.status not in ('queued', 'running', 'needs_input') then
    return retained.run;
  end if;

  run_value := retained.run - 'inputExpiresAt' - 'workerId' - 'heartbeatAt';
  run_value := jsonb_set(run_value, '{status}', '"cancelled"', true);
  run_value := jsonb_set(
    run_value,
    '{executionNumber}',
    to_jsonb(coalesce((retained.run->>'executionNumber')::integer, 0) + 1),
    true
  );
  run_value := jsonb_set(run_value, '{retryableByOwner}', 'false', true);
  run_value := jsonb_set(run_value, '{completedAt}', to_jsonb(completed_iso), true);

  update public.site_agent_runs set
    status = 'cancelled',
    completed_at = target_completed_at,
    run = run_value
    where id = retained.id
      and status in ('queued', 'running', 'needs_input');

  update public.site_agent_continuation_heads set
    status = 'terminal',
    head = jsonb_set(
      jsonb_set(head, '{status}', '"terminal"', true),
      '{updatedAt}',
      to_jsonb(completed_iso),
      true
    ),
    updated_at = target_completed_at
    where run_id = retained.id;

  update public.site_agent_run_events set
    status = 'cancelled',
    completed_at = target_completed_at,
    error_code = 'owner_cancelled'
    where run_id = retained.id
      and status = 'running';

  return run_value;
end;
$$;

revoke all on function public.cancel_site_agent_run(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.cancel_site_agent_run(text,timestamptz)
  to service_role;

drop function public.cancel_site_agent_needs_input_run(text,timestamptz);

commit;
