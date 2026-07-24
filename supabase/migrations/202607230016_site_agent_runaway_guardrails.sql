begin;

update site_agent_runs
set run = case
  when execution_driver = 'responses_api' then
    (run - 'limits') || jsonb_build_object(
      'guardrails',
      jsonb_build_object(
        'deadlineAt',
        to_char(
          started_at at time zone 'UTC'
            + case when kind = 'initial_build' then interval '60 minutes' else interval '25 minutes' end,
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'maxCostUsd',
        case when kind = 'initial_build' then 15 else 8 end,
        'maxConsecutiveIdenticalFailures',
        3
      )
    )
  else run - 'limits' - 'guardrails'
end;

do $$
begin
  if exists (
    select 1
    from site_agent_runs
    where run ? 'limits'
      or (
        execution_driver = 'responses_api'
        and (
          not (run ? 'guardrails')
          or run#>>'{guardrails,deadlineAt}' is null
          or run#>>'{guardrails,maxCostUsd}' is null
          or run#>>'{guardrails,maxConsecutiveIdenticalFailures}' is null
        )
      )
      or (execution_driver = 'external_mcp' and run ? 'guardrails')
  ) then
    raise exception 'site_agent_runaway_guardrail_cutover_failed';
  end if;
end
$$;

commit;
