-- Strict clean break: canonical state no longer requires a vertical module.

do $$
begin
  if exists (select 1 from business_states_v2) or exists (select 1 from site_public_build_inputs) then
    raise exception 'domain-neutral authority cutover requires explicit pre-launch site cleanup';
  end if;
  if exists (select 1 from site_operator_queue where reason = 'unsupported_vertical') then
    raise exception 'remove unsupported-vertical queue rows before domain-neutral cutover';
  end if;
end;
$$;

alter table business_states_v2 rename to business_states_v3;
alter table business_states_v3 drop constraint if exists business_states_v2_schema_version_check;
alter table business_states_v3 add constraint business_states_v3_schema_version_check check (schema_version = 'business-state-v3');
alter index if exists business_states_v2_site_idx rename to business_states_v3_site_idx;
alter table businesses rename column vertical_module_version to domain_context_version;

alter table site_public_build_inputs drop constraint if exists site_public_build_inputs_schema_version_check;
alter table site_public_build_inputs add constraint site_public_build_inputs_schema_version_check check (schema_version = 'site-public-build-input-v2');
alter table site_public_build_inputs rename column vertical_module_id to domain_context_id;
alter table site_public_build_inputs rename column vertical_module_version to domain_context_version;
alter table site_public_build_inputs alter column domain_context_id drop not null;
alter table site_public_build_inputs alter column domain_context_version drop not null;

alter table site_operator_queue drop constraint if exists site_operator_queue_reason_check;
alter table site_operator_queue add constraint site_operator_queue_reason_check check (reason in (
  'objective_failure', 'subjective_finding', 'unsupported_capability', 'stale_candidate', 'authority_publish_failure'
));

do $$
declare definition text;
begin
  select pg_get_functiondef('bootstrap_agentic_site_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := replace(definition, 'bootstrap_agentic_site_v1', 'bootstrap_agentic_site_v2');
  definition := replace(definition, 'business_states_v2', 'business_states_v3');
  definition := replace(definition, 'vertical_module_id', 'domain_context_id');
  definition := replace(definition, 'vertical_module_version', 'domain_context_version');
  definition := replace(definition, '''verticalModule''', '''domainContext''');
  definition := replace(definition, 'state_document -> ''vertical'' ->> ''id''', 'coalesce(state_document -> ''identity'' -> ''categories'' ->> 0, ''local business'')');
  definition := replace(definition, 'state_document -> ''vertical'' ->> ''moduleVersion''', 'public_input_document -> ''domainContext'' ->> ''version''');
  definition := replace(definition, 'state_document -> ''vertical'' ->> ''status''', 'case when public_input_document ? ''domainContext'' then ''reviewed'' else ''unreviewed'' end');
  execute definition;
end;
$$;
drop function bootstrap_agentic_site_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb);
revoke all on function bootstrap_agentic_site_v2(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function bootstrap_agentic_site_v2(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

do $$
declare function_name text; definition text;
begin
  foreach function_name in array array[
    'promote_site_version_v4(text,text)',
    'cleanup_agentic_walking_skeleton_v1(text,text)',
    'cleanup_experimental_site_v1(text,text,text)'
  ] loop
    if to_regprocedure(function_name) is null then continue; end if;
    select pg_get_functiondef(to_regprocedure(function_name)) into definition;
    execute replace(definition, 'business_states_v2', 'business_states_v3');
  end loop;
end;
$$;
