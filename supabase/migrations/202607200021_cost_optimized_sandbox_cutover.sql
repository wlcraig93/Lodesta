-- Atomic sandbox capacity, durable cutover leases, and maintenance findings.

alter table site_agent_sessions
  add column sandbox_last_started_at timestamptz,
  add column sandbox_last_destroyed_at timestamptz,
  add column sandbox_provisioned_ms bigint not null default 0 check (sandbox_provisioned_ms >= 0),
  add column sandbox_destroy_attempts integer not null default 0 check (sandbox_destroy_attempts >= 0);

create index site_agent_runs_v2_running_capacity_idx
  on site_agent_runs_v2(id)
  where status = 'running';

alter table site_agent_maintenance_leases_v1
  add column lease_token_hash text;

update site_agent_maintenance_leases_v1
set lease_token_hash = 'sha256:' || repeat('0', 64)
where lease_token_hash is null;

alter table site_agent_maintenance_leases_v1
  alter column lease_token_hash set not null,
  add constraint site_agent_maintenance_lease_token_hash_check
    check (lease_token_hash ~ '^sha256:[a-f0-9]{64}$');

drop function if exists claim_site_agent_maintenance_v1(text, timestamptz);

create function acquire_site_agent_maintenance_v2(
  task_name text,
  lease_token_hash_value text,
  lease_until_value timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if lease_token_hash_value !~ '^sha256:[a-f0-9]{64}$' or lease_until_value <= now() then
    raise exception 'invalid maintenance lease request';
  end if;
  insert into site_agent_maintenance_leases_v1(task, lease_token_hash, lease_until, claimed_at)
  values (task_name, lease_token_hash_value, lease_until_value, now())
  on conflict (task) do update
    set lease_token_hash = excluded.lease_token_hash,
        lease_until = excluded.lease_until,
        claimed_at = excluded.claimed_at
  where site_agent_maintenance_leases_v1.lease_until <= now();
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create function renew_site_agent_maintenance_v2(
  task_name text,
  lease_token_hash_value text,
  lease_until_value timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if lease_until_value <= now() then return false; end if;
  update site_agent_maintenance_leases_v1
  set lease_until = lease_until_value
  where task = task_name
    and lease_token_hash = lease_token_hash_value
    and lease_until > now();
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create function release_site_agent_maintenance_v2(task_name text, lease_token_hash_value text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare affected_rows integer := 0;
begin
  delete from site_agent_maintenance_leases_v1
  where task = task_name and lease_token_hash = lease_token_hash_value;
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create function site_agent_maintenance_active_v1(task_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from site_agent_maintenance_leases_v1
    where task = task_name and lease_until > now()
  );
$$;

revoke all on function acquire_site_agent_maintenance_v2(text, text, timestamptz) from public;
revoke all on function renew_site_agent_maintenance_v2(text, text, timestamptz) from public;
revoke all on function release_site_agent_maintenance_v2(text, text) from public;
revoke all on function site_agent_maintenance_active_v1(text) from public;
grant execute on function acquire_site_agent_maintenance_v2(text, text, timestamptz) to service_role;
grant execute on function renew_site_agent_maintenance_v2(text, text, timestamptz) to service_role;
grant execute on function release_site_agent_maintenance_v2(text, text) to service_role;
grant execute on function site_agent_maintenance_active_v1(text) to service_role;

create or replace function claim_site_agent_run_v2(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target site_agent_runs_v2%rowtype;
  claimed jsonb;
  now_value timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('site_agent_run_capacity_v1'));
  if exists (
    select 1 from site_agent_maintenance_leases_v1
    where task = 'workspace_storage_cutover' and lease_until > now_value
  ) then return null; end if;
  if (select count(*) from site_agent_runs_v2 where status = 'running') >= 4 then return null; end if;
  select * into target from site_agent_runs_v2 where id = target_run_id for update;
  if target.id is null or target.status <> 'queued' then return null; end if;
  claimed := jsonb_set(jsonb_set(jsonb_set(jsonb_set(target.run, '{status}', '"running"'::jsonb), '{stage}', '"authoring"'::jsonb),
    '{attempt}', to_jsonb(coalesce((target.run ->> 'attempt')::integer, 0) + 1)), '{heartbeatAt}', to_jsonb(now_value));
  update site_agent_runs_v2 set status = 'running', run = claimed where id = target_run_id;
  return claimed;
end;
$$;

create function block_site_agent_enqueue_during_cutover_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'queued' and exists (
    select 1 from site_agent_maintenance_leases_v1
    where task = 'workspace_storage_cutover' and lease_until > now()
  ) then
    raise exception 'workspace_storage_cutover_active';
  end if;
  return new;
end;
$$;

create trigger site_agent_runs_v2_cutover_enqueue_guard
before insert or update of status on site_agent_runs_v2
for each row execute function block_site_agent_enqueue_during_cutover_v1();

alter table site_operator_queue drop constraint if exists site_operator_queue_reason_check;
alter table site_operator_queue add constraint site_operator_queue_reason_check check (reason in (
  'objective_failure', 'subjective_finding', 'unsupported_capability', 'stale_candidate', 'authority_publish_failure', 'maintenance_failure'
));
