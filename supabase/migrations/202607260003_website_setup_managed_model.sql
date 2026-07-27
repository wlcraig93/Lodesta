-- Owner onboarding is model-agnostic. The configured creation route is resolved
-- by the authoring workflow and retained on the resulting SiteAgentRun.

drop function public.create_website_setup(uuid,text,text,text,text,text,text,text);

alter table public.website_setups
  drop constraint website_setups_initial_build_route_check,
  drop column initial_build_api_provider,
  drop column initial_build_model_id,
  add column prospect_report_id text references public.prospect_reports(id) on delete restrict;

create function public.create_website_setup(
  target_owner_user_id uuid,
  target_source_url text,
  target_normalized_source text,
  target_reporting_timezone text,
  target_prospect_report_id text,
  target_idempotency_key text,
  target_creation_request_hash text
)
returns setof public.website_setups
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.website_setups;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  select * into existing from public.website_setups
    where owner_user_id = target_owner_user_id and idempotency_key = target_idempotency_key;
  if found then
    if existing.creation_request_hash <> target_creation_request_hash then
      raise exception 'idempotency_key_conflict';
    end if;
    return next existing;
    return;
  end if;
  if public.private_user_active_operation_count(target_owner_user_id) >= 3 then
    raise exception 'concurrent_project_limit';
  end if;
  return query
    insert into public.website_setups (
      id, owner_user_id, source_url, normalized_source, reporting_timezone,
      prospect_report_id, status, idempotency_key, creation_request_hash
    ) values (
      'setup_' || replace(gen_random_uuid()::text, '-', ''), target_owner_user_id,
      target_source_url, target_normalized_source, target_reporting_timezone,
      target_prospect_report_id, 'queued', target_idempotency_key, target_creation_request_hash
    ) returning *;
end;
$$;

revoke all on function public.create_website_setup(uuid,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_website_setup(uuid,text,text,text,text,text,text) to service_role;
