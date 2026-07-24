alter table site_versions add column if not exists stale_reason text;
alter table site_versions drop constraint site_versions_status_check;
alter table site_versions
  add constraint site_versions_status_check
  check (status in ('candidate', 'stale', 'published', 'superseded', 'rolled_back', 'rejected'));

create or replace function promote_site_version(target_version_id text, actor_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_site_id text; target_artifact_id text; previous_id text;
begin
  select site_id, artifact_id into target_site_id, target_artifact_id
    from site_versions where id = target_version_id and status in ('candidate', 'superseded') for update;
  if target_site_id is null then raise exception 'version_not_promotable'; end if;
  perform 1 from sites where id = target_site_id and owner_user_id is not null for update;
  if not found then raise exception 'site_not_owned'; end if;
  if not exists (select 1 from site_build_artifacts where id = target_artifact_id and hard_gate_status = 'passed') then
    raise exception 'artifact_hard_gate_failed';
  end if;
  select id into previous_id from site_versions where site_id = target_site_id and status = 'published' for update;
  update site_versions set status = 'superseded', version = jsonb_set(version, '{status}', '"superseded"', true)
    where id = previous_id;
  update site_versions set
    status = 'published', published_at = now(), replaced_version_id = previous_id,
    version = jsonb_set(jsonb_set(version, '{status}', '"published"', true), '{publishedAt}', to_jsonb(now()::text), true)
    where id = target_version_id;
  update form_definitions set status = 'published'
    where id in (select form_definition_id from site_version_forms where version_id = target_version_id);
  update sites set status = 'active', published_version_id = target_version_id, updated_at = now()
    where id = target_site_id;
  return jsonb_build_object('siteId', target_site_id, 'versionId', target_version_id, 'actorId', actor_id);
end;
$$;

revoke all on function promote_site_version(text,text) from public, anon, authenticated;
grant execute on function promote_site_version(text,text) to service_role;
