-- Pre-launch hard cut to the sole SiteIntentV3 / SitePublicBuildInputV3 authority shapes.
-- The explicit site-v3 cutover operator command performs any experimental-data deletion.
-- This migration is intentionally assert-only with respect to retained data.

do $$
begin
  if exists (select 1 from sites)
    or exists (select 1 from business_states_v3)
    or exists (select 1 from site_intents_v2)
    or exists (select 1 from site_public_build_inputs)
    or exists (select 1 from site_workspace_revisions)
    or exists (select 1 from site_build_artifacts)
    or exists (select 1 from site_versions_v4)
  then
    raise exception 'site_v3_hard_cutover_requires_empty_site_authorities';
  end if;
end;
$$;

drop function if exists reclassify_prelaunch_draft_site_for_v3_cutover_v1(text, text, text, text);

alter table site_intents_v2 rename to site_intents_v3;
alter table site_intents_v3 drop constraint if exists site_intents_v2_schema_version_check;
alter table site_intents_v3
  add constraint site_intents_v3_schema_version_check
  check (schema_version = 'site-intent-v3');
alter index if exists site_intents_v2_site_idx rename to site_intents_v3_site_idx;

alter table site_public_build_inputs drop constraint if exists site_public_build_inputs_schema_version_check;
alter table site_public_build_inputs
  add constraint site_public_build_inputs_schema_version_check
  check (schema_version = 'site-public-build-input-v3');

-- Table renames preserve relational dependencies, but PL/pgSQL bodies may retain
-- relation names as source text and be reparsed after a restart. Recreate every
-- public function that still contains the retired authority name.
do $$
declare
  function_oid oid;
  definition text;
begin
  for function_oid in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%site_intents_v2%'
  loop
    select pg_get_functiondef(function_oid) into definition;
    execute replace(definition, 'site_intents_v2', 'site_intents_v3');
  end loop;
end;
$$;
