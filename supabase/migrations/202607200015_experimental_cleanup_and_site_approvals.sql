-- Explicit experimental cleanup plus immutable exact-artifact review records.

create table site_version_approvals_v1 (
  id text primary key,
  schema_version text not null check (schema_version = 'site-version-approval-v1'),
  site_id text not null references sites(id) on delete restrict,
  version_id text not null references site_versions_v4(id) on delete cascade,
  artifact_hash text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  actor_id text not null,
  note text not null check (length(trim(note)) > 0),
  created_at timestamptz not null
);

create index site_version_approvals_v1_version_idx
  on site_version_approvals_v1(version_id, created_at desc);
alter table site_version_approvals_v1 enable row level security;
grant select, insert on site_version_approvals_v1 to service_role;

create or replace function cleanup_experimental_site_v1(
  target_site_id text,
  target_business_id text,
  confirmation_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  blob_keys jsonb;
begin
  if confirmation_token <> 'delete-experimental:' || target_site_id || ':' || target_business_id then
    raise exception 'experimental cleanup confirmation token does not match the target';
  end if;
  if not exists (
    select 1 from sites
    where id = target_site_id
      and business_id = target_business_id
      and status = 'experimental'
      and published_version_id is null
  ) then
    raise exception 'experimental cleanup requires a matching unpublished experimental site';
  end if;
  if exists (select 1 from site_versions_v4 where site_id = target_site_id and status = 'published') then
    raise exception 'experimental cleanup cannot delete a site with a published version';
  end if;

  select coalesce(jsonb_agg(distinct key_value), '[]'::jsonb) into blob_keys
  from (
    select file ->> 'storageKey' as key_value
    from site_build_artifacts artifact,
      jsonb_array_elements(coalesce(artifact.artifact -> 'files', '[]'::jsonb)) file
    where artifact.site_id = target_site_id
    union all
    select source_archive_key from site_workspace_revisions where site_id = target_site_id
    union all
    select jsonb_array_elements_text(coalesce(attempt -> 'screenshotKeys', '[]'::jsonb))
    from site_agent_runs_v1 run,
      jsonb_array_elements(coalesce(run.run -> 'attempts', '[]'::jsonb)) attempt
    where run.site_id = target_site_id
    union all
    select storage_path from asset_revisions where business_id = target_business_id
  ) retained_keys
  where key_value is not null and key_value <> '';

  update sites
  set published_version_id = null,
      current_workspace_revision_id = null,
      current_public_build_input_id = null
  where id = target_site_id;

  delete from preview_tokens where site_id = target_site_id;
  delete from domains where site_id = target_site_id;
  delete from site_redirects_v1 where site_id = target_site_id;
  delete from inquiry_events where site_id = target_site_id;
  delete from inquiries where site_id = target_site_id;
  delete from analytics_events where site_id = target_site_id;
  delete from claims where site_id = target_site_id;
  delete from site_operator_queue where site_id = target_site_id;
  delete from control_plane_change_requests_v2 where site_id = target_site_id;
  delete from site_agent_messages
  where session_id in (select id from site_agent_sessions where site_id = target_site_id);
  delete from site_agent_runs_v1 where site_id = target_site_id;
  delete from site_agent_sessions where site_id = target_site_id;
  delete from site_version_approvals_v1 where site_id = target_site_id;
  delete from site_version_sources
  where version_id in (select id from site_versions_v4 where site_id = target_site_id);
  delete from site_version_assets
  where version_id in (select id from site_versions_v4 where site_id = target_site_id);
  delete from site_version_forms
  where version_id in (select id from site_versions_v4 where site_id = target_site_id);
  delete from site_versions_v4 where site_id = target_site_id;
  delete from site_build_artifacts where site_id = target_site_id;
  delete from site_workspace_revisions where site_id = target_site_id;
  delete from site_public_build_input_sources
  where input_id in (select id from site_public_build_inputs where site_id = target_site_id);
  delete from site_public_build_input_assets
  where input_id in (select id from site_public_build_inputs where site_id = target_site_id);
  delete from site_public_build_input_forms
  where input_id in (select id from site_public_build_inputs where site_id = target_site_id);
  delete from site_public_build_inputs where site_id = target_site_id;
  delete from form_definitions_v2 where site_id = target_site_id;
  delete from site_intents_v2 where site_id = target_site_id;
  delete from business_states_v2 where site_id = target_site_id;
  delete from fact_observations where business_id = target_business_id;
  delete from business_assets where business_id = target_business_id;
  delete from asset_revisions where business_id = target_business_id;
  delete from business_links where business_id = target_business_id;
  delete from business_offerings where business_id = target_business_id;
  delete from business_proof where business_id = target_business_id;
  delete from source_snapshots where business_id = target_business_id;
  delete from sites where id = target_site_id;
  delete from businesses where id = target_business_id;

  return jsonb_build_object(
    'ok', true,
    'siteId', target_site_id,
    'businessId', target_business_id,
    'blobKeys', blob_keys
  );
end;
$$;

revoke all on function cleanup_experimental_site_v1(text, text, text) from public;
grant execute on function cleanup_experimental_site_v1(text, text, text) to service_role;
