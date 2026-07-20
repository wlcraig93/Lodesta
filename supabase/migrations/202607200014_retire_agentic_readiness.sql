-- The readiness runner was never a launch authority and is retired cleanly.
-- An operator reported zero readiness-owned sessions before this migration.

do $$
begin
  if exists (
    select 1 from site_agent_sessions
    where owner_id like 'readiness\_v1\_%' escape '\'
  ) then
    raise exception 'retiring agentic readiness requires readiness-owned sessions to be removed explicitly';
  end if;
end $$;

drop function if exists cleanup_agentic_readiness_v1(text, text);
