-- Link a prepared setup when its site is either unowned or already owned by
-- the exact setup owner. The simplified bootstrap creates private sites with
-- their owner attached immediately, so requiring an unowned site strands the
-- setup after its session and initial run have already been created.

begin;

create or replace function public.link_website_setup(
  target_setup_id text,
  target_source_revision integer,
  target_site_id text,
  target_session_id text,
  target_run_id text
)
returns setof public.website_setups
language plpgsql
security definer
set search_path = public
as $$
declare
  target_owner uuid;
begin
  select owner_user_id into target_owner
    from public.website_setups
    where id = target_setup_id
      and status = 'processing'
      and source_revision = target_source_revision
    for update;
  if target_owner is null then return; end if;

  update public.sites
    set owner_user_id = target_owner, updated_at = now()
    where id = target_site_id
      and (owner_user_id is null or owner_user_id = target_owner);
  if not found then return; end if;

  if not exists (
    select 1
    from public.site_agent_sessions
    where id = target_session_id and site_id = target_site_id
  ) then return; end if;

  if not exists (
    select 1
    from public.site_agent_runs
    where id = target_run_id
      and site_id = target_site_id
      and session_id = target_session_id
  ) then return; end if;

  return query
    update public.website_setups
      set status = 'linked',
        site_id = target_site_id,
        session_id = target_session_id,
        run_id = target_run_id,
        locked_by = null,
        locked_at = null,
        updated_at = now()
      where id = target_setup_id
        and status = 'processing'
        and source_revision = target_source_revision
      returning *;
end;
$$;

revoke all on function public.link_website_setup(text,integer,text,text,text)
  from public, anon, authenticated;
grant execute on function public.link_website_setup(text,integer,text,text,text)
  to service_role;

commit;
