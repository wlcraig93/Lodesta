-- Distinguish prospects that have never been searched from completed Places
-- searches that returned no credible candidate. `not_found` remains reserved for
-- a later web-research conclusion.

alter table public.prospects
  drop constraint if exists prospects_research_state_check;

alter table public.prospects
  add constraint prospects_research_state_check
    check (research_state in ('pending', 'matched', 'ambiguous', 'no_result', 'not_found'));
