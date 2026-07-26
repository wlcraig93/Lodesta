-- Temporary pre-launch model-comparison provenance for private website setup.
-- Existing setup intermediates remain nullable because their historical initial
-- provider/model route cannot be reconstructed from mutable operator settings.

alter table public.website_setups
  add column initial_build_api_provider text,
  add column initial_build_model_id text,
  add constraint website_setups_initial_build_route_check check (
    (initial_build_api_provider is null and initial_build_model_id is null)
    or (
      initial_build_api_provider = 'openrouter'
      and initial_build_model_id is not null
      and char_length(initial_build_model_id) between 3 and 120
      and initial_build_model_id ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*/[A-Za-z0-9._~:/-]+$'
    )
  );

drop function public.create_website_setup(uuid,text,text,text,text,text);
create function public.create_website_setup(
  target_owner_user_id uuid,
  target_source_url text,
  target_normalized_source text,
  target_reporting_timezone text,
  target_initial_build_api_provider text,
  target_initial_build_model_id text,
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
  if target_initial_build_api_provider is distinct from 'openrouter'
    or target_initial_build_model_id is null
    or char_length(target_initial_build_model_id) not between 3 and 120
    or target_initial_build_model_id !~ '^[A-Za-z0-9][A-Za-z0-9._~-]*/[A-Za-z0-9._~:/-]+$' then
    raise exception 'invalid_initial_build_route';
  end if;
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
      initial_build_api_provider, initial_build_model_id, status,
      idempotency_key, creation_request_hash
    ) values (
      'setup_' || replace(gen_random_uuid()::text, '-', ''), target_owner_user_id,
      target_source_url, target_normalized_source, target_reporting_timezone,
      target_initial_build_api_provider, target_initial_build_model_id, 'queued',
      target_idempotency_key, target_creation_request_hash
    ) returning *;
end;
$$;
revoke all on function public.create_website_setup(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_website_setup(uuid,text,text,text,text,text,text,text) to service_role;
