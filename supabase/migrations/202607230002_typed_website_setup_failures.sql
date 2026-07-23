begin;

alter table website_setups
  drop constraint website_setups_failure_code_check;

update website_setups
set
  failure_code = 'crawl_temporarily_unavailable',
  updated_at = now()
where failure_code = 'website_crawl_failed';

alter table website_setups
  add constraint website_setups_failure_code_check
    check (
      failure_code is null
      or failure_code in (
        'source_invalid',
        'crawl_temporarily_unavailable',
        'crawl_robots_disallowed',
        'crawl_unsupported_content',
        'crawl_primary_unavailable',
        'bootstrap_failed',
        'worker_interrupted'
      )
    );

create or replace function retry_website_setup(target_setup_id text, target_owner_user_id uuid)
returns setof website_setups
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  perform 1 from website_setups
    where id = target_setup_id and owner_user_id = target_owner_user_id
      and status = 'failed'
      and failure_code in ('crawl_temporarily_unavailable', 'bootstrap_failed', 'worker_interrupted')
    for update;
  if not found then return; end if;
  if private_user_active_operation_count(target_owner_user_id) >= 3 then
    raise exception 'concurrent_project_limit';
  end if;
  return query update website_setups set
    status = 'queued',
    failure_code = null,
    failure_reason = null,
    locked_by = null,
    locked_at = null,
    updated_at = now()
    where id = target_setup_id returning *;
end;
$$;

revoke all on function retry_website_setup(text,uuid) from public, anon, authenticated;
grant execute on function retry_website_setup(text,uuid) to service_role;

commit;
