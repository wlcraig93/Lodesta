-- Clean-break the advisory queue to V2 and enforce exact-artifact approval.

do $$
begin
  if exists (select 1 from site_operator_queue limit 1) then
    raise exception 'operator queue V2 cutover requires an explicit operator cleanup first';
  end if;
end $$;

alter table site_operator_queue
  add column schema_version text not null default 'operator-queue-item-v2',
  add column resolution_note text;
alter table site_operator_queue
  add constraint site_operator_queue_schema_version_check check (schema_version = 'operator-queue-item-v2'),
  add constraint site_operator_queue_terminal_resolution_check check (
    status not in ('resolved', 'dismissed')
    or (resolved_by is not null and resolved_at is not null and length(trim(resolution_note)) > 0)
  );

create or replace function promote_site_version_v4(target_version_id text, actor_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target site_versions_v4%rowtype;
  prior_id text;
begin
  select version.* into target
  from site_versions_v4 version
  join sites site on site.id = version.site_id
  where version.id = target_version_id
  for update of version, site;
  if target.id is null then raise exception 'site version not found'; end if;
  if exists (select 1 from sites where id = target.site_id and status = 'experimental') then
    raise exception 'experimental_site_not_publishable';
  end if;
  if target.status <> 'candidate' and target.status <> 'superseded' then
    raise exception 'only candidate or superseded versions may be promoted';
  end if;
  if not exists (
    select 1 from site_build_artifacts
    where id = target.artifact_id and artifact_hash = target.version ->> 'artifactHash' and hard_gate_status = 'passed'
  ) then raise exception 'site artifact has not passed the hard gate'; end if;
  if not exists (
    select 1
    from site_public_build_inputs build_input
    join business_states_v2 business_state on business_state.business_id = build_input.business_id
    join site_intents_v2 site_intent on site_intent.site_id = build_input.site_id
    where build_input.id = target.public_build_input_id
      and build_input.business_state_revision = business_state.revision
      and build_input.site_intent_revision = site_intent.revision
  ) then raise exception 'stale_candidate'; end if;
  if exists (
    select 1
    from site_public_build_inputs build_input,
      jsonb_array_elements(coalesce(build_input.input -> 'business' -> 'assets', '[]'::jsonb)) asset
    where build_input.id = target.public_build_input_id
      and asset ->> 'rightsStatus' not in ('preclaim_safe', 'customer_granted')
  ) then raise exception 'candidate_contains_unpublishable_media'; end if;
  if exists (
    select 1 from site_operator_queue
    where site_id = target.site_id
      and reason = 'subjective_finding'
      and status in ('open', 'in_review')
  ) then raise exception 'candidate_has_open_subjective_findings'; end if;
  if not exists (
    select 1 from site_version_approvals_v1 approval
    where approval.id = (
      select decision.id from site_version_approvals_v1 decision
      where decision.version_id = target.id
        and decision.artifact_hash = target.version ->> 'artifactHash'
      order by decision.created_at desc, decision.id desc
      limit 1
    ) and approval.status = 'approved'
  ) then raise exception 'candidate_requires_operator_approval'; end if;
  if exists (
    select 1
    from site_version_forms version_form
    left join form_definitions_v2 form_definition on form_definition.id = version_form.form_definition_id
    where version_form.version_id = target.id
      and (form_definition.id is null or form_definition.site_id <> target.site_id or form_definition.status = 'retired')
  ) then raise exception 'candidate_contains_invalid_form'; end if;
  if exists (
    select 1
    from site_redirects_v1 redirect
    where redirect.site_id = target.site_id
      and redirect.status = 'active'
      and not exists (
        select 1 from site_build_artifacts artifact,
          jsonb_array_elements(coalesce(artifact.artifact -> 'routes', '[]'::jsonb)) route
        where artifact.id = target.artifact_id
          and route ->> 'path' in (redirect.source_path, redirect.destination_path)
      )
  ) then raise exception 'active_redirect_destination_missing'; end if;

  select id into prior_id from site_versions_v4
  where site_id = target.site_id and status = 'published'
  for update;
  if prior_id is not null then
    update site_versions_v4 set status = 'superseded' where id = prior_id;
  end if;
  update site_versions_v4
  set status = 'published', published_at = now(), replaced_version_id = prior_id
  where id = target.id;
  update form_definitions_v2
  set status = 'published'
  where id in (select form_definition_id from site_version_forms where version_id = target.id)
    and status = 'candidate_only';
  update sites
  set status = 'active', published_version_id = target.id,
      current_workspace_revision_id = target.workspace_revision_id,
      current_public_build_input_id = target.public_build_input_id,
      updated_at = now()
  where id = target.site_id;
  return jsonb_build_object('ok', true, 'publishedVersionId', target.id, 'replacedVersionId', prior_id, 'actorId', actor_id);
end;
$$;
revoke all on function promote_site_version_v4(text, text) from public;
grant execute on function promote_site_version_v4(text, text) to service_role;
