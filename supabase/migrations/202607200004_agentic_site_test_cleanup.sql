-- Explicit pre-launch cleanup for the permanent live walking-skeleton verifier.
-- It cannot target ordinary site or business IDs and should be removed when
-- the repository leaves pre-launch operating mode.

create or replace function cleanup_agentic_walking_skeleton_v1(target_site_id text, target_business_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_site_id !~ '^site_walking_[a-f0-9]{12}$'
     or target_business_id !~ '^business_walking_[a-f0-9]{12}$' then
    raise exception 'walking-skeleton cleanup accepts only generated verifier IDs';
  end if;
  if exists (
    select 1 from sites
    where id = target_site_id and business_id <> target_business_id
  ) then
    raise exception 'site and business IDs do not belong together';
  end if;

  update sites
  set published_version_id = null,
      current_workspace_revision_id = null,
      current_public_build_input_id = null
  where id = target_site_id;

  delete from preview_tokens
  where site_version_v4_id in (select id from site_versions_v4 where site_id = target_site_id);
  delete from inquiry_events where site_id = target_site_id;
  delete from inquiries where site_id = target_site_id;
  delete from analytics_events where site_id = target_site_id;
  delete from site_operator_queue where site_id = target_site_id;
  delete from control_plane_change_requests_v2 where site_id = target_site_id;
  delete from site_agent_messages
  where session_id in (select id from site_agent_sessions where site_id = target_site_id);
  delete from site_agent_runs_v1 where site_id = target_site_id;
  delete from site_agent_sessions where site_id = target_site_id;
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

  return jsonb_build_object('ok', true, 'siteId', target_site_id, 'businessId', target_business_id);
end;
$$;

revoke all on function cleanup_agentic_walking_skeleton_v1(text, text) from public;
grant execute on function cleanup_agentic_walking_skeleton_v1(text, text) to service_role;
