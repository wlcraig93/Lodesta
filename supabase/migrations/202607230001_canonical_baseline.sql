-- Lodesta canonical pre-launch baseline.
-- Apply only to an empty application schema. Supabase Auth is preserved separately.

create extension if not exists pgcrypto with schema extensions;

create table businesses (
  id text primary key,
  name text not null,
  vertical text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sites (
  id text primary key,
  owner_user_id uuid references auth.users(id) on delete restrict,
  business_id text not null references businesses(id) on delete restrict,
  slug text not null unique,
  source_url text,
  normalized_source text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  published_version_id text,
  current_workspace_revision_id text,
  current_public_build_input_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sites_owner_user_id_idx on sites(owner_user_id);
create index sites_owner_source_idx on sites(owner_user_id, normalized_source) where owner_user_id is not null;

create table business_states (
  business_id text primary key references businesses(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  revision integer not null check (revision > 0),
  state_hash text not null,
  state jsonb not null,
  updated_at timestamptz not null
);

create table site_intents (
  id text primary key,
  site_id text not null unique references sites(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  revision integer not null check (revision > 0),
  intent_hash text not null,
  intent jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table source_snapshots (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  source_type text not null check (source_type in ('website', 'web_research', 'owner_input', 'operator_input')),
  source_url text,
  content_hash text not null,
  captured_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (business_id, content_hash)
);

create table asset_revisions (
  id text primary key,
  asset_id text not null,
  business_id text not null references businesses(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  content_hash text not null,
  storage_path text not null unique,
  public_url text,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes integer not null check (bytes > 0),
  width integer,
  height integer,
  origin text not null check (origin in ('source_website', 'owner_upload', 'platform_generated')),
  provenance jsonb not null,
  created_at timestamptz not null
);
create index asset_revisions_business_id_idx on asset_revisions(business_id);
create index asset_revisions_business_content_hash_idx on asset_revisions(business_id, content_hash);

create table form_definitions (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  revision integer not null check (revision > 0),
  status text not null check (status in ('candidate_only', 'published', 'retired')),
  definition jsonb not null,
  created_at timestamptz not null
);

create table site_public_build_inputs (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  business_id text not null references businesses(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  business_state_revision integer not null check (business_state_revision > 0),
  site_intent_revision integer not null check (site_intent_revision > 0),
  domain_context_id text,
  domain_context_version text,
  input_hash text not null unique,
  input jsonb not null,
  created_at timestamptz not null
);
create table site_public_build_input_sources (
  input_id text not null references site_public_build_inputs(id) on delete restrict,
  source_snapshot_id text not null references source_snapshots(id) on delete restrict,
  primary key (input_id, source_snapshot_id)
);
create table site_public_build_input_assets (
  input_id text not null references site_public_build_inputs(id) on delete restrict,
  asset_revision_id text not null references asset_revisions(id) on delete restrict,
  primary key (input_id, asset_revision_id)
);
create table site_public_build_input_forms (
  input_id text not null references site_public_build_inputs(id) on delete restrict,
  form_definition_id text not null references form_definitions(id) on delete restrict,
  primary key (input_id, form_definition_id)
);

create table site_workspace_revisions (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  parent_revision_id text references site_workspace_revisions(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  source_hash text not null,
  source_archive_key text not null unique,
  files jsonb not null,
  created_by_kind text not null check (created_by_kind in ('agent', 'owner', 'operator', 'system')),
  created_by_id text not null,
  created_at timestamptz not null,
  unique (site_id, revision_number),
  unique (site_id, source_hash)
);

create table trusted_runtime_patches (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  series_id text not null,
  version text not null,
  content_hash text not null unique,
  storage_key text not null unique,
  provenance jsonb not null,
  security_status text not null check (security_status in ('pending', 'audited', 'revoked')),
  compatibility_status text not null check (compatibility_status in ('pending', 'passed', 'failed')),
  promoted_at timestamptz,
  promoted_by text,
  created_at timestamptz not null
);
create table trusted_runtime_series (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  name text not null,
  active_patch_id text not null references trusted_runtime_patches(id) on delete restrict,
  previous_patch_id text references trusted_runtime_patches(id) on delete restrict,
  updated_at timestamptz not null,
  updated_by text not null
);

create table site_build_artifacts (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  workspace_revision_id text not null references site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  runtime_series_id text not null references trusted_runtime_series(id) on delete restrict,
  runtime_patch_at_finalization text not null references trusted_runtime_patches(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  artifact_hash text not null unique,
  storage_prefix text not null unique,
  artifact jsonb not null,
  hard_gate_status text not null check (hard_gate_status in ('passed', 'failed')),
  toolchain_version text not null,
  sandbox_image_digest text not null,
  created_at timestamptz not null
);

create table site_versions (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  schema_version integer not null check (schema_version = 1),
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('candidate', 'stale', 'published', 'superseded', 'rolled_back', 'rejected')),
  artifact_id text not null references site_build_artifacts(id) on delete restrict,
  workspace_revision_id text not null references site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  version jsonb not null,
  created_by_kind text not null check (created_by_kind in ('agent', 'owner', 'operator', 'system')),
  created_by_id text not null,
  created_at timestamptz not null,
  published_at timestamptz,
  replaced_version_id text references site_versions(id) on delete restrict,
  stale_reason text,
  unique (site_id, version_number)
);
create unique index site_versions_one_published_idx on site_versions(site_id) where status = 'published';
alter table sites add constraint sites_published_version_fk foreign key (published_version_id) references site_versions(id) on delete restrict;
alter table sites add constraint sites_workspace_revision_fk foreign key (current_workspace_revision_id) references site_workspace_revisions(id) on delete restrict;
alter table sites add constraint sites_public_build_input_fk foreign key (current_public_build_input_id) references site_public_build_inputs(id) on delete restrict;

create table site_version_sources (
  version_id text not null references site_versions(id) on delete restrict,
  source_snapshot_id text not null references source_snapshots(id) on delete restrict,
  primary key (version_id, source_snapshot_id)
);
create table site_version_assets (
  version_id text not null references site_versions(id) on delete restrict,
  asset_revision_id text not null references asset_revisions(id) on delete restrict,
  primary key (version_id, asset_revision_id)
);
create table site_version_forms (
  version_id text not null references site_versions(id) on delete restrict,
  form_definition_id text not null references form_definitions(id) on delete restrict,
  primary key (version_id, form_definition_id)
);

create table site_agent_sessions (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  principal_kind text not null check (principal_kind in ('owner', 'operator')),
  principal_id text not null,
  schema_version text not null check (schema_version = 'site-agent-session'),
  status text not null check (status in ('active', 'checkpointed', 'rotating', 'closed', 'failed')),
  current_workspace_revision_id text references site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  sandbox_provider text not null check (sandbox_provider = 'cloudflare'),
  sandbox_id text,
  sandbox_last_started_at timestamptz,
  sandbox_last_destroyed_at timestamptz,
  sandbox_provisioned_ms bigint not null default 0 check (sandbox_provisioned_ms >= 0),
  sandbox_destroy_attempts integer not null default 0 check (sandbox_destroy_attempts >= 0),
  lease_token_hash text not null,
  lease_expires_at timestamptz not null,
  rotate_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table site_agent_runs (
  id text primary key,
  session_id text not null references site_agent_sessions(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-agent-run'),
  kind text not null check (kind in ('initial_build', 'edit', 'rebase')),
  status text not null check (status in ('queued', 'running', 'needs_input', 'succeeded', 'failed', 'cancelled')),
  exact_parent_revision_id text references site_workspace_revisions(id) on delete restrict,
  output_revision_id text references site_workspace_revisions(id) on delete restrict,
  execution_driver text not null default 'responses_api' check (execution_driver in ('responses_api', 'external_mcp')),
  model_id text,
  run jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  check (
    (execution_driver = 'responses_api' and model_id is not null)
    or (execution_driver = 'external_mcp' and model_id is null)
  )
);
create index site_agent_runs_queue_idx on site_agent_runs(started_at) where status in ('queued', 'running');
create index site_agent_runs_site_idx on site_agent_runs(site_id, started_at desc);
create index site_agent_sessions_principal_idx on site_agent_sessions(site_id, principal_kind, principal_id, updated_at desc);

create table site_agent_messages (
  id text primary key,
  schema_version text not null check (schema_version = 'site-agent-message'),
  session_id text not null references site_agent_sessions(id) on delete restrict,
  run_id text references site_agent_runs(id) on delete restrict,
  role text not null check (role in ('owner', 'agent', 'operator', 'system')),
  content text not null,
  selection jsonb,
  created_at timestamptz not null
);

create table site_agent_run_events (
  sequence bigint generated always as identity unique,
  id text primary key,
  run_id text not null references site_agent_runs(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-agent-run-event'),
  kind text not null check (kind in ('run', 'turn', 'model_request', 'tool_call', 'build', 'inspection')),
  name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  turn_index integer,
  model_id text,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  summary jsonb not null default '{}',
  payload_ref text,
  payload_hash text,
  payload_expires_at timestamptz,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz
);

create table site_agent_maintenance_leases (
  task text primary key,
  lease_token_hash text not null,
  lease_until timestamptz not null,
  claimed_at timestamptz not null
);

create table website_setups (
  id text primary key,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  source_url text not null,
  normalized_source text not null,
  source_revision integer not null default 1 check (source_revision > 0),
  status text not null check (status in ('queued', 'processing', 'linked', 'failed', 'canceled')),
  site_id text references sites(id) on delete restrict,
  session_id text references site_agent_sessions(id) on delete restrict,
  run_id text references site_agent_runs(id) on delete restrict,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  idempotency_key text not null,
  creation_request_hash text not null,
  locked_by text,
  locked_at timestamptz,
  failure_code text check (failure_code is null or failure_code in ('source_invalid', 'crawl_temporarily_unavailable', 'crawl_robots_disallowed', 'crawl_unsupported_content', 'crawl_primary_unavailable', 'bootstrap_failed', 'worker_interrupted')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, idempotency_key)
);
create index website_setups_owner_source_idx on website_setups(owner_user_id, normalized_source);
create index website_setups_owner_updated_idx on website_setups(owner_user_id, updated_at desc);
create index website_setups_queue_idx on website_setups(created_at) where status in ('queued', 'processing');

create table preview_grants (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  site_version_id text not null references site_versions(id) on delete restrict,
  secret_hash text not null,
  key_version text not null,
  secret_version integer not null default 1 check (secret_version > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index preview_grants_site_idx on preview_grants(site_id, created_at desc);

create table adoption_invitations (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table domains (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  hostname text not null,
  status text not null check (status in ('pending_verification', 'provisioning', 'active', 'attention_required', 'expired', 'conflict')),
  ownership_proof_status text not null check (ownership_proof_status in ('pending', 'verified')),
  routing_status text not null check (routing_status in ('pending', 'active')),
  provider_status text not null check (provider_status in ('pending', 'active', 'invalid')),
  certificate_status text not null check (certificate_status in ('pending', 'active', 'invalid')),
  verification_name text not null,
  verification_value text not null,
  routing_name text not null,
  routing_target text not null,
  expires_at timestamptz not null,
  provider_hostname_id text,
  ownership_verified_at timestamptz,
  activated_at timestamptz,
  attention_required_at timestamptz,
  provider_invalid_count integer not null default 0,
  first_provider_invalid_at timestamptz,
  last_provider_invalid_at timestamptz,
  execution_failure_count integer not null default 0,
  last_execution_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table active_domains (
  hostname text primary key,
  domain_id text not null unique references domains(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  claimed_at timestamptz not null
);
create unique index domains_one_active_hostname_idx on domains(hostname) where status in ('active', 'attention_required');
create index domains_site_idx on domains(site_id, created_at desc);

create table site_redirects (
  id text primary key default ('redirect_' || replace(gen_random_uuid()::text, '-', '')),
  site_id text not null references sites(id) on delete restrict,
  source_path text not null,
  destination_path text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, source_path),
  check (source_path <> destination_path)
);

create table inquiries (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  source_channel text not null default 'form',
  contact_name text,
  contact_email text,
  contact_email_normalized text,
  contact_phone text,
  contact_phone_normalized text,
  status text not null default 'new' check (status in ('new', 'needs_reply', 'replied', 'booked', 'won', 'lost', 'spam', 'archived')),
  ai_enrichment jsonb,
  ai_enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table inquiry_events (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  inquiry_id text not null references inquiries(id) on delete restrict,
  type text not null,
  actor text not null check (actor in ('visitor', 'owner', 'ai', 'system')),
  message_text text,
  payload jsonb,
  source_url text,
  page_id text,
  form_id text,
  metadata jsonb not null default '{}',
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index inquiry_events_dedupe_idx on inquiry_events(site_id, dedupe_key) where dedupe_key is not null;

create table analytics_events (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  session_id text not null,
  page_id text,
  event_type text not null,
  event jsonb not null,
  occurred_at timestamptz not null default now(),
  visitor_id text
);
create index analytics_events_site_time_idx on analytics_events(site_id, occurred_at desc);

create table control_plane_change_requests (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'control-plane-change-request'),
  target_authority text not null,
  change_kind text not null,
  payload jsonb not null,
  impact text not null,
  status text not null,
  expected_business_revision integer,
  expected_intent_revision integer,
  requested_by text not null,
  requested_at timestamptz not null,
  decided_by text,
  decided_at timestamptz,
  failure_reason text
);
create table site_operator_queue (
  id text primary key,
  schema_version text not null check (schema_version = 'operator-queue-item'),
  site_id text not null references sites(id) on delete restrict,
  version_id text references site_versions(id) on delete restrict,
  run_id text references site_agent_runs(id) on delete restrict,
  reason text not null,
  severity text not null,
  status text not null,
  findings jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text
);
create table vertical_demand_events (
  id text primary key,
  schema_version text not null check (schema_version = 'vertical-demand-event'),
  source_url text not null,
  observed_vertical text,
  requested_by text not null,
  status text not null check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null,
  reviewed_at timestamptz,
  reviewed_by text
);
create table operator_settings (
  key text primary key,
  value jsonb not null,
  version integer not null default 1,
  updated_by text,
  updated_at timestamptz not null default now()
);
create table operator_setting_audits (
  id text primary key,
  setting_key text not null,
  status text not null check (status in ('changed', 'rejected')),
  changed_by text not null,
  changed_at timestamptz not null default now(),
  previous_value jsonb,
  new_value jsonb,
  error text
);

create table outbound_campaigns (
  id text primary key,
  name text not null,
  channel text not null check (channel in ('direct_mail', 'email', 'phone', 'manual')),
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'completed')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
create table outbound_prospects (
  id text primary key,
  campaign_id text not null references outbound_campaigns(id) on delete restrict,
  site_id text references sites(id) on delete restrict,
  business_name text not null,
  vertical text,
  source_url text,
  preview_id text references preview_grants(id) on delete restrict,
  mailing_code text,
  status text not null default 'queued' check (status in ('queued', 'mailed', 'preview_viewed', 'adoption_started', 'adopted', 'published', 'disqualified')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  mailed_at timestamptz,
  first_preview_viewed_at timestamptz,
  adoption_started_at timestamptz,
  adopted_at timestamptz,
  published_at timestamptz,
  disqualified_at timestamptz
);
create table outbound_events (
  id text primary key,
  campaign_id text not null references outbound_campaigns(id) on delete restrict,
  prospect_id text references outbound_prospects(id) on delete restrict,
  site_id text references sites(id) on delete restrict,
  type text not null check (type in ('mailer_sent', 'invitation_opened', 'preview_viewed', 'picker_interaction', 'adoption_started', 'adoption_completed', 'published', 'support_contact', 'disqualified', 'credibility_feedback')),
  occurred_at timestamptz not null default now(),
  value numeric,
  metadata jsonb not null default '{}'
);

create table prospect_reports (
  id text primary key,
  source_key text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  job_id text,
  source_url text,
  source_host text,
  website_kind text not null,
  report_json jsonb,
  resolution_usage jsonb,
  unlocked_at timestamptz,
  lead_id text,
  error_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz
);
create index prospect_reports_source_key_idx on prospect_reports(source_key, created_at desc);
create table prospect_report_leads (
  id text primary key,
  report_id text not null references prospect_reports(id) on delete restrict,
  email text not null,
  contact_name text,
  phone text,
  ip_hash text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null
);
create table prospect_report_jobs (
  id text primary key,
  report_id text not null references prospect_reports(id) on delete restrict,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  run_after timestamptz not null,
  locked_by text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index prospect_report_jobs_queue_idx on prospect_report_jobs(run_after) where status = 'queued';

create function private_user_active_operation_count(target_owner_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from website_setups
      where owner_user_id = target_owner_user_id and status in ('queued', 'processing'))
    +
    (select count(*) from site_agent_runs r
      join sites s on s.id = r.site_id
      where s.owner_user_id = target_owner_user_id and r.status in ('queued', 'running'));
$$;

create function create_website_setup(
  target_owner_user_id uuid,
  target_source_url text,
  target_normalized_source text,
  target_idempotency_key text,
  target_creation_request_hash text
)
returns setof website_setups
language plpgsql
security definer
set search_path = public
as $$
declare
  existing website_setups;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  select * into existing from website_setups
    where owner_user_id = target_owner_user_id and idempotency_key = target_idempotency_key;
  if found then
    if existing.creation_request_hash <> target_creation_request_hash then
      raise exception 'idempotency_key_conflict';
    end if;
    return next existing;
    return;
  end if;
  if private_user_active_operation_count(target_owner_user_id) >= 3 then
    raise exception 'concurrent_project_limit';
  end if;
  return query
    insert into website_setups (
      id, owner_user_id, source_url, normalized_source, status, idempotency_key, creation_request_hash
    ) values (
      'setup_' || replace(gen_random_uuid()::text, '-', ''), target_owner_user_id,
      target_source_url, target_normalized_source, 'queued', target_idempotency_key, target_creation_request_hash
    ) returning *;
end;
$$;

create function claim_next_website_setup(worker_id text)
returns setof website_setups
language plpgsql
security definer
set search_path = public
as $$
declare target_id text;
begin
  update website_setups
    set status = 'failed', failure_code = 'worker_interrupted',
      failure_reason = 'Setup processing stopped before it completed.',
      locked_by = null, locked_at = null, updated_at = now()
    where status = 'processing' and attempts >= max_attempts
      and locked_at < now() - interval '75 minutes';
  select id into target_id from website_setups
    where status = 'queued' or (
      status = 'processing' and attempts < max_attempts and locked_at < now() - interval '75 minutes'
    )
    order by created_at for update skip locked limit 1;
  if target_id is null then return; end if;
  return query update website_setups
    set status = 'processing', attempts = attempts + 1, locked_by = worker_id,
      locked_at = now(), updated_at = now()
    where id = target_id returning *;
end;
$$;

create function link_website_setup(
  target_setup_id text,
  target_source_revision integer,
  target_site_id text,
  target_session_id text,
  target_run_id text
)
returns setof website_setups
language plpgsql
security definer
set search_path = public
as $$
declare target_owner uuid;
begin
  select owner_user_id into target_owner from website_setups
    where id = target_setup_id and status = 'processing' and source_revision = target_source_revision
    for update;
  if target_owner is null then return; end if;
  update sites set owner_user_id = target_owner, updated_at = now()
    where id = target_site_id
      and (owner_user_id is null or owner_user_id = target_owner);
  if not found then return; end if;
  if not exists (
    select 1 from site_agent_sessions
    where id = target_session_id and site_id = target_site_id
  ) then return; end if;
  if not exists (
    select 1 from site_agent_runs
    where id = target_run_id and site_id = target_site_id and session_id = target_session_id
  ) then return; end if;
  return query update website_setups
    set status = 'linked', site_id = target_site_id, session_id = target_session_id,
      run_id = target_run_id, locked_by = null, locked_at = null, updated_at = now()
    where id = target_setup_id and status = 'processing' and source_revision = target_source_revision
    returning *;
end;
$$;

create function cancel_website_setup(target_setup_id text, target_owner_user_id uuid)
returns setof website_setups
language plpgsql
security definer
set search_path = public
as $$
declare
  setup_record website_setups;
  site_owner uuid;
  site_published_version text;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  select * into setup_record from website_setups
    where id = target_setup_id and owner_user_id = target_owner_user_id and status <> 'canceled'
    for update;
  if setup_record.id is null then return; end if;
  if setup_record.site_id is not null then
    select owner_user_id, published_version_id into site_owner, site_published_version
      from sites where id = setup_record.site_id for update;
    if site_published_version is not null or (site_owner is not null and site_owner <> target_owner_user_id) then
      return;
    end if;
    if site_owner = target_owner_user_id then
      update sites set owner_user_id = null, updated_at = now() where id = setup_record.site_id;
    end if;
  end if;
  return query update website_setups
    set status = 'canceled', locked_by = null, locked_at = null, updated_at = now()
    where id = setup_record.id returning *;
end;
$$;

create function update_website_setup_source(
  target_setup_id text,
  target_owner_user_id uuid,
  target_source_url text,
  target_normalized_source text
)
returns setof website_setups
language plpgsql
security definer
set search_path = public
as $$
declare current_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  select status into current_status from website_setups
    where id = target_setup_id and owner_user_id = target_owner_user_id
      and status in ('queued', 'processing', 'failed')
    for update;
  if current_status is null then return; end if;
  if current_status = 'failed' and private_user_active_operation_count(target_owner_user_id) >= 3 then
    raise exception 'concurrent_project_limit';
  end if;
  return query update website_setups set
    source_url = target_source_url,
    normalized_source = target_normalized_source,
    source_revision = source_revision + 1,
    status = 'queued',
    site_id = null,
    session_id = null,
    run_id = null,
    locked_by = null,
    locked_at = null,
    failure_code = null,
    failure_reason = null,
    updated_at = now()
    where id = target_setup_id returning *;
end;
$$;

create function retry_website_setup(target_setup_id text, target_owner_user_id uuid)
returns setof website_setups
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  perform 1 from website_setups
    where id = target_setup_id and owner_user_id = target_owner_user_id
      and status = 'failed'
      and failure_code in ('crawl_temporarily_unavailable', 'bootstrap_failed', 'worker_interrupted')
    for update;
  if not found then return; end if;
  if private_user_active_operation_count(target_owner_user_id) >= 3 then
    raise exception 'concurrent_project_limit';
  end if;
  return query update website_setups set
    status = 'queued',
    failure_code = null,
    failure_reason = null,
    locked_by = null,
    locked_at = null,
    updated_at = now()
    where id = target_setup_id returning *;
end;
$$;

create function enqueue_site_agent_run(run_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_owner uuid;
begin
  select owner_user_id into target_owner from sites where id = run_document->>'siteId';
  if target_owner is not null then
    perform pg_advisory_xact_lock(hashtextextended(target_owner::text, 0));
    if private_user_active_operation_count(target_owner) >= 3 then
      raise exception 'concurrent_project_limit';
    end if;
  end if;
  insert into site_agent_runs (
    id, session_id, site_id, schema_version, kind, status, exact_parent_revision_id,
    output_revision_id, model_id, run, started_at, completed_at
  ) values (
    run_document->>'id', run_document->>'sessionId', run_document->>'siteId',
    run_document->>'schemaVersion', run_document->>'kind', run_document->>'status',
    run_document->>'exactParentRevisionId', run_document->>'outputRevisionId',
    run_document->>'modelId', run_document, (run_document->>'startedAt')::timestamptz,
    nullif(run_document->>'completedAt', '')::timestamptz
  );
  return run_document;
end;
$$;

create function claim_site_agent_run(target_run_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_run jsonb;
begin
  if exists (
    select 1 from site_agent_maintenance_leases
    where task = 'workspace-cutover' and lease_until > now()
  ) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('site-agent-global-capacity', 0));
  if (select count(*) from site_agent_runs where status = 'running') >= 4 then return null; end if;
  update site_agent_runs
    set status = 'running',
      run = jsonb_set(
        jsonb_set(
          jsonb_set(run, '{status}', '"running"', true),
          '{stage}', '"authoring"', true
        ),
        '{executionNumber}', to_jsonb(coalesce((run->>'executionNumber')::integer, 0) + 1), true
      )
    where id = target_run_id and status = 'queued'
    returning run into target_run;
  return target_run;
end;
$$;

create function bootstrap_site(
  site_document jsonb,
  state_document jsonb,
  intent_document jsonb,
  form_documents jsonb,
  source_documents jsonb,
  asset_documents jsonb,
  public_input_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare item jsonb;
begin
  insert into businesses (
    id, name, vertical, created_at, updated_at
  ) values (
    state_document->>'businessId', state_document#>>'{identity,name}',
    coalesce(public_input_document#>>'{domainContext,id}', 'general_local'),
    (site_document->>'createdAt')::timestamptz, (site_document->>'updatedAt')::timestamptz
  );
  insert into sites (
    id, owner_user_id, business_id, slug, source_url, normalized_source, status, created_at, updated_at
  ) values (
    site_document->>'id', nullif(site_document->>'ownerUserId', '')::uuid,
    site_document->>'businessId', site_document->>'slug', site_document->>'sourceUrl',
    site_document->>'normalizedSource', site_document->>'status',
    (site_document->>'createdAt')::timestamptz, (site_document->>'updatedAt')::timestamptz
  );
  insert into business_states values (
    state_document->>'businessId', state_document->>'siteId', (state_document->>'schemaVersion')::integer,
    (state_document->>'revision')::integer, state_document->>'stateHash', state_document,
    (state_document->>'updatedAt')::timestamptz
  );
  insert into site_intents (
    id, site_id, schema_version, revision, intent_hash, intent, created_at, updated_at
  ) values (
    intent_document->>'id', intent_document->>'siteId', (intent_document->>'schemaVersion')::integer,
    (intent_document->>'revision')::integer, intent_document->>'intentHash', intent_document,
    (intent_document->>'updatedAt')::timestamptz, (intent_document->>'updatedAt')::timestamptz
  );
  for item in select * from jsonb_array_elements(form_documents) loop
    insert into form_definitions values (
      item->>'id', item->>'siteId', (item->>'schemaVersion')::integer, (item->>'revision')::integer,
      item->>'status', item, (item->>'createdAt')::timestamptz
    );
  end loop;
  for item in select * from jsonb_array_elements(source_documents) loop
    insert into source_snapshots (
      id, business_id, schema_version, source_type, source_url, content_hash, captured_at, payload
    ) values (
      item->>'id', item->>'businessId', (item->>'schemaVersion')::integer, item->>'sourceType', item->>'sourceUrl',
      item->>'contentHash', (item->>'capturedAt')::timestamptz, item->'payload'
    );
  end loop;
  for item in select * from jsonb_array_elements(asset_documents) loop
    insert into asset_revisions (
      id, asset_id, business_id, schema_version, content_hash, storage_path, public_url,
      mime_type, bytes, width, height, origin, provenance, created_at
    ) values (
      item->>'id', item->>'assetId', item->>'businessId', (item->>'schemaVersion')::integer,
      item->>'contentHash', item->>'storageKey', item->>'publicUrl', item->>'mimeType',
      (item->>'bytes')::integer, (item->>'width')::integer, (item->>'height')::integer,
      item->>'origin', item->'provenance', (item->>'createdAt')::timestamptz
    );
  end loop;
  insert into site_public_build_inputs (
    id, site_id, business_id, schema_version, business_state_revision, site_intent_revision,
    domain_context_id, domain_context_version, input_hash, input, created_at
  ) values (
    public_input_document->>'id', public_input_document->>'siteId', public_input_document->>'businessId',
    (public_input_document->>'schemaVersion')::integer,
    (public_input_document->>'businessStateRevision')::integer,
    (public_input_document->>'siteIntentRevision')::integer,
    public_input_document#>>'{domainContext,id}', public_input_document#>>'{domainContext,version}',
    public_input_document->>'inputHash', public_input_document,
    (public_input_document->>'createdAt')::timestamptz
  );
  insert into site_public_build_input_sources
    select public_input_document->>'id', value
    from jsonb_array_elements_text(public_input_document->'sourceSnapshotIds');
  insert into site_public_build_input_assets
    select public_input_document->>'id', value
    from jsonb_array_elements_text(public_input_document->'assetRevisionIds');
  insert into site_public_build_input_forms
    select public_input_document->>'id', value->>'id'
    from jsonb_array_elements(public_input_document->'forms');
  update sites set current_public_build_input_id = public_input_document->>'id'
    where id = site_document->>'id';
  return jsonb_build_object('siteId', site_document->>'id');
end;
$$;

create function promote_site_version(target_version_id text, actor_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_site_id text; target_artifact_id text; previous_id text;
begin
  select site_id, artifact_id into target_site_id, target_artifact_id
    from site_versions where id = target_version_id and status in ('candidate', 'superseded') for update;
  if target_site_id is null then raise exception 'version_not_promotable'; end if;
  perform 1 from sites where id = target_site_id and owner_user_id is not null for update;
  if not found then raise exception 'site_not_owned'; end if;
  if not exists (select 1 from site_build_artifacts where id = target_artifact_id and hard_gate_status = 'passed') then
    raise exception 'artifact_hard_gate_failed';
  end if;
  select id into previous_id from site_versions where site_id = target_site_id and status = 'published' for update;
  update site_versions set status = 'superseded', version = jsonb_set(version, '{status}', '"superseded"', true)
    where id = previous_id;
  update site_versions set
    status = 'published', published_at = now(), replaced_version_id = previous_id,
    version = jsonb_set(jsonb_set(version, '{status}', '"published"', true), '{publishedAt}', to_jsonb(now()::text), true)
    where id = target_version_id;
  update form_definitions set status = 'published'
    where id in (select form_definition_id from site_version_forms where version_id = target_version_id);
  update sites set status = 'active', published_version_id = target_version_id, updated_at = now()
    where id = target_site_id;
  return jsonb_build_object('siteId', target_site_id, 'versionId', target_version_id, 'actorId', actor_id);
end;
$$;

create function set_trusted_runtime_series(series_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from trusted_runtime_patches
    where id = series_document->>'activePatchId'
      and series_id = series_document->>'id'
      and security_status = 'audited' and compatibility_status = 'passed'
  ) then raise exception 'runtime_patch_not_promotable'; end if;
  insert into trusted_runtime_series (
    id, schema_version, name, active_patch_id, previous_patch_id, updated_at, updated_by
  ) values (
    series_document->>'id', (series_document->>'schemaVersion')::integer,
    series_document->>'name', series_document->>'activePatchId',
    nullif(series_document->>'previousPatchId', ''),
    (series_document->>'updatedAt')::timestamptz, series_document->>'updatedBy'
  ) on conflict (id) do update set
    active_patch_id = excluded.active_patch_id, previous_patch_id = excluded.previous_patch_id,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return series_document;
end;
$$;

create function claim_domain_ownership(domain_id text, verified_at timestamptz)
returns setof domains
language plpgsql
security definer
set search_path = public
as $$
declare target domains;
begin
  select * into target from domains where id = domain_id and status = 'pending_verification'
    and ownership_proof_status = 'pending' and expires_at > verified_at for update;
  if target.id is null then return; end if;
  begin
    insert into active_domains(hostname, domain_id, site_id, claimed_at)
      values (target.hostname, target.id, target.site_id, verified_at);
  exception when unique_violation then
    return;
  end;
  return query update domains set
    ownership_proof_status = 'verified', ownership_verified_at = verified_at,
    status = 'provisioning', updated_at = verified_at
    where id = domain_id returning *;
end;
$$;

create function consume_adoption_invitation(target_token_hash text, target_owner_user_id uuid)
returns setof adoption_invitations
language plpgsql
security definer
set search_path = public
as $$
declare invitation adoption_invitations;
begin
  select * into invitation from adoption_invitations
    where token_hash = target_token_hash and consumed_at is null and expires_at > now() for update;
  if invitation.id is null then return; end if;
  update sites set owner_user_id = target_owner_user_id, updated_at = now()
    where id = invitation.site_id and owner_user_id is null;
  if not found then return; end if;
  return query update adoption_invitations
    set consumed_at = now(), consumed_by_user_id = target_owner_user_id
    where id = invitation.id and consumed_at is null returning *;
end;
$$;

create function claim_prospect_report_job(worker_id text)
returns setof prospect_report_jobs
language plpgsql
security definer
set search_path = public
as $$
declare target_id text;
begin
  select id into target_id from prospect_report_jobs
    where status = 'queued' and run_after <= now()
    order by run_after, created_at for update skip locked limit 1;
  if target_id is null then return; end if;
  return query update prospect_report_jobs set
    status = 'running', attempts = attempts + 1, locked_by = worker_id,
    locked_at = now(), updated_at = now()
    where id = target_id returning *;
end;
$$;

create function acquire_site_agent_maintenance(task_name text, lease_token_hash_value text, lease_until_value timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into site_agent_maintenance_leases(task, lease_token_hash, lease_until, claimed_at)
    values (task_name, lease_token_hash_value, lease_until_value, now())
    on conflict (task) do update set
      lease_token_hash = excluded.lease_token_hash, lease_until = excluded.lease_until, claimed_at = now()
    where site_agent_maintenance_leases.lease_until <= now();
  return found;
end; $$;
create function renew_site_agent_maintenance(task_name text, lease_token_hash_value text, lease_until_value timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update site_agent_maintenance_leases set lease_until = lease_until_value
    where task = task_name and lease_token_hash = lease_token_hash_value and lease_until > now();
  return found;
end; $$;
create function release_site_agent_maintenance(task_name text, lease_token_hash_value text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from site_agent_maintenance_leases where task = task_name and lease_token_hash = lease_token_hash_value;
  return found;
end; $$;
create function site_agent_maintenance_active(task_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from site_agent_maintenance_leases where task = task_name and lease_until > now());
$$;

create function create_inquiry_from_form(
  p_site_id text, p_form_id text, p_page_id text, p_visitor_id text, p_payload jsonb,
  p_metadata jsonb, p_source_url text, p_user_agent text, p_ip_hash text,
  p_contact_name text, p_contact_email text, p_contact_email_normalized text,
  p_contact_phone text, p_contact_phone_normalized text, p_message_text text, p_dedupe_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inquiry_id text := 'inquiry_' || replace(gen_random_uuid()::text, '-', '');
begin
  if not exists (
    select 1 from form_definitions f
    join site_version_forms vf on vf.form_definition_id = f.id
    join site_versions v on v.id = vf.version_id
    where f.id = p_form_id and f.site_id = p_site_id and f.status = 'published' and v.status = 'published'
  ) then raise exception 'form_not_published'; end if;
  if p_dedupe_key is not null and exists (
    select 1 from inquiry_events where site_id = p_site_id and dedupe_key = p_dedupe_key
  ) then return jsonb_build_object('deduplicated', true); end if;
  insert into inquiries (
    id, site_id, contact_name, contact_email, contact_email_normalized,
    contact_phone, contact_phone_normalized
  ) values (
    inquiry_id, p_site_id, p_contact_name, p_contact_email, p_contact_email_normalized,
    p_contact_phone, p_contact_phone_normalized
  );
  insert into inquiry_events (
    id, site_id, inquiry_id, type, actor, message_text, payload, source_url,
    page_id, form_id, metadata, dedupe_key
  ) values (
    'inquiry_event_' || replace(gen_random_uuid()::text, '-', ''), p_site_id, inquiry_id,
    'form_submission', 'visitor', p_message_text, p_payload, p_source_url,
    p_page_id, p_form_id, coalesce(p_metadata, '{}') || jsonb_build_object(
      'visitorId', p_visitor_id, 'userAgent', p_user_agent, 'ipHash', p_ip_hash
    ), p_dedupe_key
  );
  return jsonb_build_object('inquiryId', inquiry_id, 'deduplicated', false);
end; $$;

create function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger sites_updated_at before update on sites for each row execute function set_updated_at();
create trigger businesses_updated_at before update on businesses for each row execute function set_updated_at();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'businesses','sites','business_states','site_intents','source_snapshots','asset_revisions',
    'form_definitions','site_public_build_inputs','site_public_build_input_sources',
    'site_public_build_input_assets','site_public_build_input_forms','site_workspace_revisions',
    'trusted_runtime_patches','trusted_runtime_series','site_build_artifacts','site_versions',
    'site_version_sources','site_version_assets','site_version_forms','site_agent_sessions',
    'site_agent_runs','site_agent_messages','site_agent_run_events','site_agent_maintenance_leases',
    'website_setups','preview_grants','adoption_invitations','domains','active_domains',
    'site_redirects','inquiries','inquiry_events','analytics_events','control_plane_change_requests',
    'site_operator_queue','vertical_demand_events','operator_settings','operator_setting_audits',
    'outbound_campaigns','outbound_prospects','outbound_events','prospect_reports',
    'prospect_report_leads','prospect_report_jobs'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('revoke all on table %I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table %I to service_role', table_name);
  end loop;
end $$;

revoke all on schema public from public, anon, authenticated;
revoke all on function private_user_active_operation_count(uuid) from public, anon, authenticated;
revoke all on function create_website_setup(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function claim_next_website_setup(text) from public, anon, authenticated;
revoke all on function link_website_setup(text,integer,text,text,text) from public, anon, authenticated;
revoke all on function cancel_website_setup(text,uuid) from public, anon, authenticated;
revoke all on function update_website_setup_source(text,uuid,text,text) from public, anon, authenticated;
revoke all on function retry_website_setup(text,uuid) from public, anon, authenticated;
revoke all on function enqueue_site_agent_run(jsonb) from public, anon, authenticated;
revoke all on function claim_site_agent_run(text) from public, anon, authenticated;
revoke all on function bootstrap_site(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function promote_site_version(text,text) from public, anon, authenticated;
revoke all on function set_trusted_runtime_series(jsonb) from public, anon, authenticated;
revoke all on function claim_domain_ownership(text,timestamptz) from public, anon, authenticated;
revoke all on function consume_adoption_invitation(text,uuid) from public, anon, authenticated;
revoke all on function claim_prospect_report_job(text) from public, anon, authenticated;
revoke all on function acquire_site_agent_maintenance(text,text,timestamptz) from public, anon, authenticated;
revoke all on function renew_site_agent_maintenance(text,text,timestamptz) from public, anon, authenticated;
revoke all on function release_site_agent_maintenance(text,text) from public, anon, authenticated;
revoke all on function site_agent_maintenance_active(text) from public, anon, authenticated;
revoke all on function create_inquiry_from_form(text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function set_updated_at() from public, anon, authenticated;

grant usage on schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function create_website_setup(uuid,text,text,text,text) to service_role;
grant execute on function claim_next_website_setup(text) to service_role;
grant execute on function link_website_setup(text,integer,text,text,text) to service_role;
grant execute on function cancel_website_setup(text,uuid) to service_role;
grant execute on function update_website_setup_source(text,uuid,text,text) to service_role;
grant execute on function retry_website_setup(text,uuid) to service_role;
grant execute on function enqueue_site_agent_run(jsonb) to service_role;
grant execute on function claim_site_agent_run(text) to service_role;
grant execute on function bootstrap_site(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function promote_site_version(text,text) to service_role;
grant execute on function set_trusted_runtime_series(jsonb) to service_role;
grant execute on function claim_domain_ownership(text,timestamptz) to service_role;
grant execute on function consume_adoption_invitation(text,uuid) to service_role;
grant execute on function claim_prospect_report_job(text) to service_role;
grant execute on function acquire_site_agent_maintenance(text,text,timestamptz) to service_role;
grant execute on function renew_site_agent_maintenance(text,text,timestamptz) to service_role;
grant execute on function release_site_agent_maintenance(text,text) to service_role;
grant execute on function site_agent_maintenance_active(text) to service_role;
grant execute on function create_inquiry_from_form(text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text) to service_role;
