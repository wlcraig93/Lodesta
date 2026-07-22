-- A waiting clarification releases run capacity and never retains a sandbox.

alter table site_agent_runs_v2 drop constraint if exists site_agent_runs_v1_status_check;
alter table site_agent_runs_v2 drop constraint if exists site_agent_runs_v2_status_check;
alter table site_agent_runs_v2 add constraint site_agent_runs_v2_status_check
  check (status in ('queued', 'running', 'needs_input', 'succeeded', 'failed', 'cancelled'));

create index if not exists site_agent_runs_v2_needs_input_expiry_idx
  on site_agent_runs_v2 ((run ->> 'inputExpiresAt'))
  where status = 'needs_input';
