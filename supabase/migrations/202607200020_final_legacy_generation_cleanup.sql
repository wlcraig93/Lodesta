-- Reconcile pre-candidate generation tables that survived an earlier pre-launch cleanup.
-- Environments where the original cleanup applied remain a safe no-op.

begin;

do $$
declare
  relation_name text;
  has_rows boolean;
begin
  foreach relation_name in array array['generation_artifacts', 'site_generations'] loop
    if to_regclass(format('public.%I', relation_name)) is null then
      continue;
    end if;
    execute format('select exists (select 1 from public.%I limit 1)', relation_name) into has_rows;
    if has_rows then
      raise exception 'final legacy generation cleanup requires public.% to be empty', relation_name;
    end if;
  end loop;
end $$;

drop table if exists public.generation_artifacts restrict;
drop table if exists public.site_generations restrict;

commit;
