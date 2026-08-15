-- Pre-launch clean cut: the canonical initial-build author is Luna High.
-- The architecture plan is retained inside the regenerable run document, so no
-- normalized storage change is required.
update operator_settings
set
  value = jsonb_set(value, '{siteAgentModel}', '"gpt-5.6-luna"', true),
  version = version + 1,
  updated_by = 'migration:202608030001',
  updated_at = now()
where key = 'site_authoring_models'
  and value->>'siteAgentModel' = 'gpt-5.6-sol';
