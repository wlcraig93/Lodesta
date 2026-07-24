-- Repair the verified-authoring finalizer that was deployed with an update to
-- the nonexistent site_agent_runs.public_build_input_id column. The canonical
-- run authority retains publicBuildInputId inside the strict run JSON payload.

begin;

do $$
declare
  finalizer_signature regprocedure :=
    'public.finalize_verified_authoring(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
  deployed_definition text;
  repaired_definition text;
  obsolete_assignment constant text :=
    E'\n    public_build_input_id = run_document->>''publicBuildInputId'',';
begin
  select pg_get_functiondef(finalizer_signature)
    into deployed_definition;

  if deployed_definition is null then
    raise exception 'verified_authoring_finalizer_missing';
  end if;

  repaired_definition := replace(
    deployed_definition,
    obsolete_assignment,
    ''
  );

  if repaired_definition is distinct from deployed_definition then
    execute repaired_definition;
  end if;

  select pg_get_functiondef(finalizer_signature)
    into deployed_definition;

  if position(obsolete_assignment in deployed_definition) > 0
    or position('run = run_document' in deployed_definition) = 0 then
    raise exception 'canonical_verified_authoring_finalizer_postcondition_failed';
  end if;
end
$$;

revoke all on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_verified_authoring(
  text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

commit;
