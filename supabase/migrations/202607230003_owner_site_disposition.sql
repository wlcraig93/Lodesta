begin;

create or replace function dispose_owned_site(target_site_id text, target_owner_user_id uuid)
returns setof sites
language plpgsql
security definer
set search_path = public
as $$
declare
  disposed_at timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  perform 1
    from sites
    where id = target_site_id and owner_user_id = target_owner_user_id
    for update;
  if not found then return; end if;

  update site_agent_run_events
    set status = 'cancelled', completed_at = disposed_at
    where status = 'running'
      and run_id in (
        select id from site_agent_runs
        where site_id = target_site_id and status in ('queued', 'running', 'needs_input')
      );

  update site_agent_runs
    set
      status = 'cancelled',
      completed_at = disposed_at,
      run = jsonb_set(
        jsonb_set(run, '{status}', to_jsonb('cancelled'::text), true),
        '{completedAt}',
        to_jsonb(to_char(disposed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        true
      )
    where site_id = target_site_id and status in ('queued', 'running', 'needs_input');

  update site_agent_sessions
    set lease_expires_at = disposed_at, rotate_at = disposed_at, updated_at = disposed_at
    where site_id = target_site_id and status in ('active', 'checkpointed', 'rotating');

  update website_setups
    set status = 'canceled', locked_by = null, locked_at = null, updated_at = disposed_at
    where site_id = target_site_id
      and owner_user_id = target_owner_user_id
      and status <> 'canceled';

  update preview_grants
    set revoked_at = coalesce(revoked_at, disposed_at)
    where site_id = target_site_id;
  delete from active_domains where site_id = target_site_id;
  update domains
    set status = 'expired', routing_status = 'pending', updated_at = disposed_at
    where site_id = target_site_id and status <> 'expired';

  return query
    update sites
      set status = 'paused', owner_user_id = null, updated_at = disposed_at
      where id = target_site_id and owner_user_id = target_owner_user_id
      returning *;
end;
$$;

revoke all on function dispose_owned_site(text,uuid) from public, anon, authenticated;
grant execute on function dispose_owned_site(text,uuid) to service_role;

commit;
