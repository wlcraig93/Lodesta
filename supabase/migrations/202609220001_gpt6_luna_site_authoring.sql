update public.operator_settings
set value = jsonb_build_object(
      'siteAgentProvider', 'openai',
      'siteAgentModel', 'gpt-6-luna'
    ),
    version = version + 1,
    updated_by = 'migration:gpt6_luna_site_authoring',
    updated_at = now()
where key = 'site_authoring_models'
  and value->>'siteAgentProvider' = 'openai'
  and value->>'siteAgentModel' in ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol');
