-- Remove pre-site-candidates generation storage.
-- Current generation persists reviewable outputs through site_candidates and site_artifacts.

drop table if exists generation_artifacts;
drop table if exists site_generations;
