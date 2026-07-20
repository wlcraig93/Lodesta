-- Keep mutable publication state in relational columns while immutable JSON
-- artifacts retain their original candidate document.

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
  select * into target from site_versions_v4 where id = target_version_id for update;
  if target.id is null then raise exception 'site version not found'; end if;
  if target.status <> 'candidate' and target.status <> 'superseded' then
    raise exception 'only candidate or superseded versions may be promoted';
  end if;
  if not exists (
    select 1 from site_build_artifacts
    where id = target.artifact_id and hard_gate_status = 'passed'
  ) then
    raise exception 'site artifact has not passed the hard gate';
  end if;
  if not exists (
    select 1
    from site_public_build_inputs build_input
    join business_states_v2 business_state on business_state.business_id = build_input.business_id
    join site_intents_v2 site_intent on site_intent.site_id = build_input.site_id
    where build_input.id = target.public_build_input_id
      and build_input.business_state_revision = business_state.revision
      and build_input.site_intent_revision = site_intent.revision
  ) then
    raise exception 'stale_candidate';
  end if;
  if exists (
    select 1
    from site_public_build_inputs build_input,
      jsonb_array_elements(coalesce(build_input.input -> 'business' -> 'assets', '[]'::jsonb)) asset
    where build_input.id = target.public_build_input_id
      and asset ->> 'rightsStatus' not in ('preclaim_safe', 'customer_granted')
  ) then
    raise exception 'candidate_contains_unpublishable_media';
  end if;
  if exists (
    select 1
    from site_version_forms version_form
    left join form_definitions_v2 form_definition on form_definition.id = version_form.form_definition_id
    where version_form.version_id = target.id
      and (form_definition.id is null or form_definition.site_id <> target.site_id or form_definition.status = 'retired')
  ) then
    raise exception 'candidate_contains_invalid_form';
  end if;

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
  where id in (
    select form_definition_id from site_version_forms where version_id = target.id
  ) and status = 'candidate_only';

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

-- Repair any V4 rows promoted before this lifecycle step was added.
update form_definitions_v2 form_definition
set status = 'published'
where form_definition.status = 'candidate_only'
  and exists (
    select 1
    from site_version_forms version_form
    join site_versions_v4 version on version.id = version_form.version_id
    where version_form.form_definition_id = form_definition.id
      and version.status = 'published'
  );
