create extension if not exists pgcrypto;

create table workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table businesses (
  id text primary key,
  workspace_id text references workspaces(id) on delete cascade,
  name text not null,
  vertical text not null,
  profile_json jsonb not null,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_locations (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  label text,
  address jsonb,
  service_areas text[] not null default '{}',
  phone text,
  email text,
  hours jsonb,
  geo jsonb,
  google_place_id text,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sites (
  id text primary key,
  workspace_id text references workspaces(id) on delete cascade,
  business_id text not null references businesses(id) on delete restrict,
  slug text not null unique,
  status text not null default 'draft',
  is_primary boolean not null default true,
  site_model jsonb not null,
  extension_model jsonb not null default '{"forms":[],"workflows":[],"inboundSettings":{"captureMode":"form_only","aiHandlingMode":"classify_only","notificationMode":"all_inquiries"},"customBlocks":[]}',
  presence_assessment jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table site_locations (
  site_id text not null references sites(id) on delete cascade,
  location_id text not null references business_locations(id) on delete cascade,
  role text not null default 'covered' check (role in ('primary', 'covered')),
  created_at timestamptz not null default now(),
  primary key (site_id, location_id)
);

create table business_profiles (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  name text not null,
  vertical text not null,
  profile jsonb not null,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table site_assets (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  kind text not null check (kind in ('photo', 'logo', 'mockup', 'screenshot', 'icon', 'document', 'other')),
  url text,
  alt text not null,
  source text not null check (source in ('generated', 'licensed', 'uploaded', 'website_reference', 'placeholder')),
  rights_status text not null check (rights_status in ('preclaim_safe', 'customer_granted', 'reference_only', 'unknown')),
  usage_scope text not null check (usage_scope in ('preclaim_preview', 'published_site', 'owner_dashboard', 'internal_planning', 'reference_only')),
  owner_approved boolean not null default false,
  provenance jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table site_versions (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  status text not null check (status in ('draft', 'published')),
  version_model jsonb not null,
  created_at timestamptz not null default now()
);

create table forms (
  id text not null,
  site_id text references sites(id) on delete cascade,
  name text not null,
  schema jsonb not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id)
);

create table inquiries (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  source_channel text not null default 'form' check (source_channel in ('form', 'chat', 'email', 'phone', 'sms', 'booking')),
  contact_name text,
  contact_email text,
  contact_email_normalized text,
  contact_phone text,
  contact_phone_normalized text,
  status text not null default 'new' check (status in ('new', 'needs_reply', 'replied', 'booked', 'won', 'lost', 'spam', 'archived')),
  notification_state text not null default 'queued' check (notification_state in ('queued', 'processing', 'completed', 'partial', 'failed', 'skipped')),
  ai_enrichment_state text not null default 'queued' check (ai_enrichment_state in ('queued', 'processing', 'succeeded', 'retrying', 'rate_limited', 'failed', 'skipped')),
  ai_enrichment jsonb,
  ai_enriched_at timestamptz,
  ai_enrichment_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table inquiry_events (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  inquiry_id text references inquiries(id) on delete cascade,
  type text not null check (type in ('form_submission', 'chat_message', 'email_received', 'email_sent', 'owner_note', 'ai_note', 'booking_created')),
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

create table inquiry_deliveries (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  inquiry_id text references inquiries(id) on delete cascade,
  event_id text references inquiry_events(id) on delete set null,
  workflow_id text not null,
  destination text not null check (destination in ('email', 'crm_placeholder', 'webhook')),
  target text,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  message text not null,
  response_status int,
  error text,
  provider_message_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table analytics_events (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  session_id text not null,
  visitor_id text,
  page_id text,
  event_type text not null,
  event jsonb not null,
  occurred_at timestamptz not null default now()
);

create table experiments (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  cohort text not null,
  hypothesis text not null,
  surface text not null,
  variants jsonb not null,
  holdout_percent numeric,
  primary_metric text not null,
  status text not null default 'draft',
  started_at timestamptz,
  concluded_at timestamptz,
  rolled_back_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table experiment_learnings (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  experiment_id text references experiments(id) on delete cascade,
  cohort text not null,
  surface text not null,
  primary_metric text not null,
  winner_variant_id text not null,
  winner_label text not null,
  control_variant_id text not null,
  confidence text not null check (confidence in ('insufficient_data', 'directional', 'strong')),
  observed_lift numeric not null default 0,
  winner_action_rate numeric not null default 0,
  control_action_rate numeric not null default 0,
  total_assignments int not null default 0,
  metric_actions int not null default 0,
  standard_criterion_id text not null,
  generation_rule text not null,
  status text not null default 'active' check (status in ('active', 'rolled_back')),
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz
);

create table preview_tokens (
  token text primary key,
  site_id text references sites(id) on delete cascade,
  version_id text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table domains (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  hostname text not null unique,
  kind text not null check (kind in ('preview', 'platform_slug', 'custom')),
  status text not null default 'pending',
  provider text not null default 'railway',
  provider_hostname_id text,
  verification jsonb not null default '{}',
  created_at timestamptz not null default now()
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
  campaign_id text references outbound_campaigns(id) on delete cascade,
  site_id text references sites(id) on delete set null,
  business_name text not null,
  vertical text,
  source_url text,
  preview_token text references preview_tokens(token) on delete set null,
  mailing_code text,
  status text not null default 'queued' check (status in ('queued', 'mailed', 'preview_viewed', 'claim_started', 'claimed', 'published', 'disqualified')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  mailed_at timestamptz,
  first_preview_viewed_at timestamptz,
  claim_started_at timestamptz,
  claimed_at timestamptz,
  published_at timestamptz,
  disqualified_at timestamptz
);

create table outbound_events (
  id text primary key,
  campaign_id text references outbound_campaigns(id) on delete cascade,
  prospect_id text references outbound_prospects(id) on delete set null,
  site_id text references sites(id) on delete set null,
  type text not null check (type in ('mailer_sent', 'claim_link_opened', 'preview_viewed', 'picker_interaction', 'claim_started', 'checkout_started', 'claim_completed', 'paid', 'published', 'support_contact', 'disqualified', 'credibility_feedback')),
  occurred_at timestamptz not null default now(),
  value numeric,
  metadata jsonb not null default '{}'
);

create table prospect_reports (
  id text primary key,
  place_id text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  job_id text,
  source_url text,
  source_host text,
  website_kind text not null default 'no_website' check (website_kind in ('owned_website', 'no_website', 'social_or_aggregator')),
  report_json jsonb,
  unlocked_at timestamptz,
  lead_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table prospect_report_leads (
  id text primary key,
  report_id text not null references prospect_reports(id) on delete cascade,
  email text not null,
  contact_name text,
  phone text,
  ip_hash text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table claims (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_email text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  status text not null default 'preview',
  fact_verification jsonb not null default '{}',
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create table jobs (
  id text primary key,
  kind text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}',
  result jsonb,
  error text,
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts >= 1 and max_attempts <= 10),
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table worker_heartbeats (
  worker_id text primary key,
  pid integer not null,
  host text not null,
  repository_mode text not null check (repository_mode in ('local', 'supabase')),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  current_job_id text references jobs(id) on delete set null,
  current_job_kind text,
  updated_at timestamptz not null default now()
);

create index worker_heartbeats_last_seen_at_idx on worker_heartbeats(last_seen_at desc);

create table agent_runs (
  id text primary key,
  run_type text not null,
  agent_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  actor_type text,
  actor_id text,
  source text not null check (source in ('admin_console', 'api', 'job')),
  source_url text,
  source_host text,
  target_type text,
  target_id text,
  input_summary text,
  output_summary text,
  input_json jsonb,
  output_json jsonb,
  metadata jsonb not null default '{}',
  tags text[] not null default '{}',
  notes text,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table site_candidates (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  agent_run_id text references agent_runs(id) on delete set null,
  source_url text,
  source_host text,
  business_name text not null,
  vertical text not null,
  candidate_slug text not null,
  bundle_json jsonb not null,
  status text not null default 'ready' check (status in ('ready', 'blocked', 'accepted', 'archived')),
  candidate_purpose text not null default 'customer_prospect' check (candidate_purpose in ('customer_prospect', 'test_generation')),
  intended_site_id text references sites(id) on delete set null,
  accepted_site_id text references sites(id) on delete set null,
  accepted_version_id text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table site_artifacts (
  id text primary key,
  site_candidate_id text references site_candidates(id) on delete cascade,
  site_id text references sites(id) on delete cascade,
  scope text not null check (scope in ('candidate_selected', 'site_selected', 'qa_evidence')),
  artifact_type text not null check (artifact_type in ('evidence_ledger', 'generation_plan', 'site_copy', 'generation_review', 'generation_failure', 'operator_decision')),
  artifact_version text not null,
  provenance_json jsonb not null,
  content_hash text not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  check (site_candidate_id is not null or site_id is not null)
);

create table agent_run_spans (
  id text primary key,
  run_id text not null references agent_runs(id) on delete cascade,
  parent_span_id text references agent_run_spans(id) on delete set null,
  span_type text not null,
  name text not null,
  status text not null default 'running' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  input_json jsonb,
  output_json jsonb,
  metadata jsonb not null default '{}',
  artifact_refs jsonb not null default '{}',
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms int
);

create table agent_model_calls (
  id text primary key,
  run_id text not null references agent_runs(id) on delete cascade,
  span_id text references agent_run_spans(id) on delete set null,
  provider text not null,
  model text not null,
  endpoint text not null,
  operation text not null,
  status text not null default 'running' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  request_json jsonb,
  response_json jsonb,
  usage_json jsonb,
  input_tokens int,
  output_tokens int,
  cache_creation_tokens int,
  cache_read_tokens int,
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms int
);

create table operator_settings (
  key text primary key,
  value jsonb not null,
  version int not null default 1 check (version >= 1),
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

create index analytics_events_site_time_idx on analytics_events(site_id, occurred_at desc);
create index analytics_events_site_event_time_idx on analytics_events(site_id, event_type, occurred_at desc);
create index analytics_events_site_visitor_time_idx on analytics_events(site_id, visitor_id, occurred_at desc) where visitor_id is not null;
create index sites_workspace_idx on sites(workspace_id);
create index businesses_workspace_idx on businesses(workspace_id);
create index businesses_name_idx on businesses(name);
create index business_locations_business_idx on business_locations(business_id);
create index business_locations_google_place_idx on business_locations(google_place_id) where google_place_id is not null;
create index sites_business_idx on sites(business_id);
create unique index sites_one_primary_per_business_idx on sites(business_id) where is_primary;
create index site_locations_location_idx on site_locations(location_id);
create unique index business_profiles_site_idx on business_profiles(site_id);
create index site_assets_site_kind_idx on site_assets(site_id, kind);
create index site_assets_site_rights_idx on site_assets(site_id, rights_status);
create index inquiries_site_time_idx on inquiries(site_id, created_at desc);
create index inquiries_site_status_time_idx on inquiries(site_id, status, created_at desc);
create index inquiries_notification_queue_idx on inquiries(notification_state, created_at);
create index inquiries_ai_queue_idx on inquiries(ai_enrichment_state, created_at);
create index inquiries_email_normalized_idx on inquiries(site_id, contact_email_normalized) where contact_email_normalized is not null;
create index inquiries_phone_normalized_idx on inquiries(site_id, contact_phone_normalized) where contact_phone_normalized is not null;
create index inquiry_events_inquiry_time_idx on inquiry_events(inquiry_id, created_at desc);
create index inquiry_events_site_time_idx on inquiry_events(site_id, created_at desc);
create index inquiry_events_dedupe_idx on inquiry_events(site_id, type, dedupe_key, created_at desc) where dedupe_key is not null;
create index forms_site_idx on forms(site_id);
create index site_versions_site_status_idx on site_versions(site_id, status);
create index inquiry_deliveries_site_time_idx on inquiry_deliveries(site_id, created_at desc);
create index inquiry_deliveries_inquiry_time_idx on inquiry_deliveries(inquiry_id, created_at desc);
create index experiments_site_status_idx on experiments(site_id, status);
create index experiment_learnings_status_cohort_idx on experiment_learnings(status, cohort, surface, primary_metric);
create index experiment_learnings_site_status_idx on experiment_learnings(site_id, status);
create index experiment_learnings_experiment_status_idx on experiment_learnings(experiment_id, status);
create index preview_tokens_site_created_idx on preview_tokens(site_id, created_at desc);
create index domains_site_idx on domains(site_id);
create index claims_site_idx on claims(site_id);
create index claims_owner_email_idx on claims(owner_email);
create index claims_owner_user_idx on claims(owner_user_id);
create unique index claims_stripe_checkout_session_idx on claims(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index outbound_campaigns_status_created_idx on outbound_campaigns(status, created_at desc);
create index outbound_prospects_campaign_status_idx on outbound_prospects(campaign_id, status);
create index outbound_prospects_site_idx on outbound_prospects(site_id);
create index outbound_prospects_preview_token_idx on outbound_prospects(preview_token);
create index outbound_events_campaign_time_idx on outbound_events(campaign_id, occurred_at desc);
create index outbound_events_prospect_time_idx on outbound_events(prospect_id, occurred_at desc);
create index outbound_events_site_time_idx on outbound_events(site_id, occurred_at desc);
create index prospect_reports_place_completed_idx on prospect_reports(place_id, completed_at desc)
  where status = 'completed';
create unique index prospect_reports_one_active_place_idx on prospect_reports(place_id)
  where status in ('queued', 'running');
create index prospect_report_leads_report_idx on prospect_report_leads(report_id, created_at desc);
create index jobs_status_created_idx on jobs(status, created_at);
create index jobs_queue_ready_idx on jobs(status, run_after, created_at);
create index jobs_running_lock_idx on jobs(status, locked_at);
create unique index jobs_one_inquiry_notification_idx
  on jobs ((payload ->> 'inquiryId'))
  where kind = 'inquiry_notification' and payload ? 'inquiryId';
create unique index jobs_one_inquiry_ai_enrichment_idx
  on jobs ((payload ->> 'inquiryId'))
  where kind = 'inquiry_ai_enrichment' and payload ? 'inquiryId';
create index agent_runs_created_at_idx on agent_runs(created_at);
create index agent_runs_source_host_idx on agent_runs(source_host);
create index agent_runs_target_idx on agent_runs(target_type, target_id);
create index agent_runs_type_status_created_idx on agent_runs(run_type, status, created_at);
create index site_candidates_status_created_idx on site_candidates(status, created_at desc);
create index site_candidates_business_idx on site_candidates(business_id);
create index site_candidates_source_host_idx on site_candidates(source_host);
create index site_candidates_agent_run_idx on site_candidates(agent_run_id);
create index site_candidates_accepted_site_idx on site_candidates(accepted_site_id);
create index site_artifacts_candidate_idx on site_artifacts(site_candidate_id, scope, artifact_type);
create index site_artifacts_site_idx on site_artifacts(site_id, scope, artifact_type);
create index site_artifacts_content_hash_idx on site_artifacts(content_hash);
create index agent_run_spans_run_started_idx on agent_run_spans(run_id, started_at);
create index agent_model_calls_run_idx on agent_model_calls(run_id);
create index agent_model_calls_span_idx on agent_model_calls(span_id);
create index operator_setting_audits_key_time_idx on operator_setting_audits(setting_key, changed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger inquiries_set_updated_at
before update on inquiries
for each row
execute function public.set_updated_at();

create or replace function public.create_inquiry_from_form(
  p_site_id text,
  p_form_id text,
  p_page_id text,
  p_visitor_id text,
  p_payload jsonb,
  p_metadata jsonb,
  p_source_url text,
  p_user_agent text,
  p_ip_hash text,
  p_contact_name text,
  p_contact_email text,
  p_contact_email_normalized text,
  p_contact_phone text,
  p_contact_phone_normalized text,
  p_message_text text,
  p_dedupe_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lock_key bigint;
  existing_event inquiry_events%rowtype;
  target_inquiry inquiries%rowtype;
  created_event inquiry_events%rowtype;
  duplicate boolean := false;
begin
  lock_key := hashtextextended(p_site_id || ':' || coalesce(p_form_id, '') || ':' || coalesce(p_dedupe_key, ''), 0);
  perform pg_advisory_xact_lock(lock_key);

  select *
  into existing_event
  from inquiry_events
  where site_id = p_site_id
    and type = 'form_submission'
    and dedupe_key = p_dedupe_key
    and created_at >= now() - interval '2 minutes'
    and coalesce((metadata ->> 'dedupe')::boolean, false) = false
  order by created_at desc
  limit 1;

  if found then
    select *
    into target_inquiry
    from inquiries
    where id = existing_event.inquiry_id
      and site_id = p_site_id;

    insert into inquiry_events (
      id,
      site_id,
      inquiry_id,
      type,
      actor,
      message_text,
      payload,
      source_url,
      page_id,
      form_id,
      metadata,
      dedupe_key
    )
    values (
      gen_random_uuid()::text,
      p_site_id,
      target_inquiry.id,
      'form_submission',
      'visitor',
      p_message_text,
      p_payload,
      p_source_url,
      p_page_id,
      p_form_id,
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'dedupe', true,
        'duplicateOfEventId', existing_event.id,
        'dedupeWindowSeconds', 120
      ),
      p_dedupe_key
    )
    returning * into created_event;

    update inquiries
    set updated_at = now()
    where id = target_inquiry.id
    returning * into target_inquiry;

    duplicate := true;
  else
    insert into inquiries (
      id,
      site_id,
      source_channel,
      contact_name,
      contact_email,
      contact_email_normalized,
      contact_phone,
      contact_phone_normalized,
      status,
      notification_state,
      ai_enrichment_state
    )
    values (
      gen_random_uuid()::text,
      p_site_id,
      'form',
      nullif(p_contact_name, ''),
      nullif(p_contact_email, ''),
      nullif(p_contact_email_normalized, ''),
      nullif(p_contact_phone, ''),
      nullif(p_contact_phone_normalized, ''),
      'new',
      'queued',
      'queued'
    )
    returning * into target_inquiry;

    insert into inquiry_events (
      id,
      site_id,
      inquiry_id,
      type,
      actor,
      message_text,
      payload,
      source_url,
      page_id,
      form_id,
      metadata,
      dedupe_key
    )
    values (
      gen_random_uuid()::text,
      p_site_id,
      target_inquiry.id,
      'form_submission',
      'visitor',
      p_message_text,
      p_payload,
      p_source_url,
      p_page_id,
      p_form_id,
      coalesce(p_metadata, '{}'::jsonb),
      p_dedupe_key
    )
    returning * into created_event;

    insert into jobs (id, kind, status, payload, max_attempts)
    values (
      gen_random_uuid()::text,
      'inquiry_notification',
      'queued',
      jsonb_build_object('siteId', p_site_id, 'inquiryId', target_inquiry.id),
      3
    )
    on conflict do nothing;

    insert into jobs (id, kind, status, payload, max_attempts)
    values (
      gen_random_uuid()::text,
      'inquiry_ai_enrichment',
      'queued',
      jsonb_build_object('siteId', p_site_id, 'inquiryId', target_inquiry.id),
      3
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'inquiry', to_jsonb(target_inquiry),
    'event', to_jsonb(created_event),
    'duplicate', duplicate
  );
end;
$$;

create or replace function public.claim_next_job(worker_id text, stale_after_seconds int default 900)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update jobs
  set status = 'failed',
      error = coalesce(error, 'Job lock expired after all retry attempts.'),
      completed_at = now(),
      locked_by = null,
      locked_at = null,
      updated_at = now()
  where status = 'running'
    and locked_at < now() - make_interval(secs => stale_after_seconds)
    and attempts >= max_attempts;

  return query
  with candidate as (
    select id
    from jobs
    where (
      status = 'queued'
      and run_after <= now()
    )
    or (
      status = 'running'
      and locked_at < now() - make_interval(secs => stale_after_seconds)
      and attempts < max_attempts
    )
    order by created_at asc
    for update skip locked
    limit 1
  )
  update jobs
  set status = 'running',
      attempts = jobs.attempts + 1,
      started_at = now(),
      locked_at = now(),
      locked_by = worker_id,
      updated_at = now()
  from candidate
  where jobs.id = candidate.id
  returning jobs.*;
end;
$$;

create or replace function public.merge_businesses(source_business_id text, target_business_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  moved_sites integer := 0;
  moved_site_candidates integer := 0;
  moved_locations integer := 0;
  target_has_primary boolean := false;
begin
  if source_business_id is null or target_business_id is null or source_business_id = '' or target_business_id = '' then
    return jsonb_build_object('ok', false, 'reason', 'Source and target business ids are required.');
  end if;
  if source_business_id = target_business_id then
    return jsonb_build_object('ok', false, 'reason', 'Source and target business ids must differ.');
  end if;
  if not exists (select 1 from businesses where id = source_business_id) then
    return jsonb_build_object('ok', false, 'reason', 'Source business not found.');
  end if;
  if not exists (select 1 from businesses where id = target_business_id) then
    return jsonb_build_object('ok', false, 'reason', 'Target business not found.');
  end if;

  select exists(select 1 from sites where business_id = target_business_id and is_primary) into target_has_primary;
  if target_has_primary then
    update sites
    set is_primary = false
    where business_id = source_business_id
      and is_primary;
  end if;

  update sites
  set business_id = target_business_id
  where business_id = source_business_id;
  get diagnostics moved_sites = row_count;

  update site_candidates
  set business_id = target_business_id,
      updated_at = now()
  where business_id = source_business_id;
  get diagnostics moved_site_candidates = row_count;

  update business_locations
  set business_id = target_business_id,
      updated_at = now()
  where business_id = source_business_id;
  get diagnostics moved_locations = row_count;

  delete from businesses where id = source_business_id;

  return jsonb_build_object(
    'ok', true,
    'sourceBusinessId', source_business_id,
    'targetBusinessId', target_business_id,
    'movedSites', moved_sites,
    'movedSiteCandidates', moved_site_candidates,
    'movedLocations', moved_locations
  );
end;
$$;

create or replace function public.is_claimed_site_owner(target_site_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from claims
    where claims.site_id = target_site_id
      and claims.status = 'claimed'
      and (
        claims.owner_user_id = auth.uid()
        or lower(claims.owner_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      )
  );
$$;

alter table workspaces enable row level security;
alter table sites enable row level security;
alter table business_profiles enable row level security;
alter table site_assets enable row level security;
alter table site_versions enable row level security;
alter table forms enable row level security;
alter table inquiries enable row level security;
alter table inquiry_events enable row level security;
alter table inquiry_deliveries enable row level security;
alter table analytics_events enable row level security;
alter table experiments enable row level security;
alter table experiment_learnings enable row level security;
alter table preview_tokens enable row level security;
alter table domains enable row level security;
alter table outbound_campaigns enable row level security;
alter table outbound_prospects enable row level security;
alter table outbound_events enable row level security;
alter table prospect_reports enable row level security;
alter table prospect_report_leads enable row level security;
alter table claims enable row level security;
alter table jobs enable row level security;
alter table agent_runs enable row level security;
alter table businesses enable row level security;
alter table business_locations enable row level security;
alter table site_locations enable row level security;
alter table site_candidates enable row level security;
alter table site_artifacts enable row level security;
alter table agent_run_spans enable row level security;
alter table agent_model_calls enable row level security;
alter table operator_settings enable row level security;
alter table operator_setting_audits enable row level security;

create policy "site owners can read claimed sites"
on sites for select
using (public.is_claimed_site_owner(id));

create policy "site owners can read claimed business profiles"
on business_profiles for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed site assets"
on site_assets for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed site versions"
on site_versions for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed forms"
on forms for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed inquiries"
on inquiries for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can update claimed inquiry status"
on inquiries for update
using (public.is_claimed_site_owner(site_id))
with check (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed inquiry events"
on inquiry_events for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed inquiry deliveries"
on inquiry_deliveries for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed analytics events"
on analytics_events for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed experiments"
on experiments for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed experiment learnings"
on experiment_learnings for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed domains"
on domains for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read own claims"
on claims for select
using (
  owner_user_id = auth.uid()
  or lower(owner_email) = lower(nullif(auth.jwt() ->> 'email', ''))
);

grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to authenticated;
grant all privileges on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Evidence/truth model v1 (Phase 1)
create table if not exists external_sources (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  source_type text not null check (source_type in ('website', 'web_search', 'google_places', 'owner_input')),
  external_ref text,
  connected_by_owner boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists external_sources_business_idx on external_sources(business_id);

create table if not exists fact_candidates (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  source_id text references external_sources(id) on delete set null,
  source_type text not null check (source_type in ('website', 'web_search', 'google_places', 'owner_input')),
  field_key text not null,
  -- Null for google_places rows: values are live-resolved, never persisted.
  proposed_value jsonb,
  normalized_value jsonb,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  status text not null default 'discovered'
    check (status in ('discovered', 'system_selected_for_preview', 'owner_confirmed', 'owner_rejected', 'superseded', 'drift_candidate')),
  evidence_label text,
  evidence_excerpt text,
  evidence_url text,
  -- google_places comparison metadata (no raw values)
  place_id text,
  comparison_result jsonb,
  observed_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fact_candidates_business_idx on fact_candidates(business_id, field_key, status);

create table if not exists service_definitions (
  id text primary key,
  vertical text not null,
  slug text not null,
  name text not null,
  category text,
  aliases text[] not null default '{}',
  default_questions jsonb not null default '[]',
  page_strategy text not null default 'auto' check (page_strategy in ('auto', 'always', 'never')),
  created_at timestamptz not null default now(),
  unique (vertical, slug)
);

create table if not exists business_services (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  service_definition_id text references service_definitions(id) on delete set null,
  custom_name text,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'hidden', 'rejected')),
  confirmation_source text check (confirmation_source in ('owner', 'website', 'web_search', 'import')),
  owner_notes text,
  pricing_model text,
  starting_price text,
  featured boolean not null default false,
  publish_landing_page boolean,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (service_definition_id is not null or custom_name is not null)
);

create index if not exists business_services_business_idx on business_services(business_id, status);

create table if not exists business_service_attributes (
  id text primary key,
  business_service_id text not null references business_services(id) on delete cascade,
  key text not null,
  value jsonb not null,
  source text not null default 'owner_confirmed' check (source in ('owner_confirmed', 'imported_candidate')),
  created_at timestamptz not null default now(),
  unique (business_service_id, key)
);

alter table external_sources enable row level security;
alter table fact_candidates enable row level security;
alter table service_definitions enable row level security;
alter table business_services enable row level security;
alter table business_service_attributes enable row level security;

-- Claims verification levels, audit, revisions (Phase 1.5)
alter table claims add column if not exists verification_level text not null default 'unverified'
  check (verification_level in ('unverified', 'contact_verified', 'owner_verified', 'operator_verified'));
alter table claims add column if not exists verification_method text;
alter table claims add column if not exists verified_by text;
alter table claims add column if not exists verified_at timestamptz;

create table if not exists owner_audit_log (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  site_id text,
  actor text not null,
  actor_role text not null check (actor_role in ('owner', 'operator', 'system')),
  action text not null,
  field_key text,
  prior_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists owner_audit_log_business_idx on owner_audit_log(business_id, created_at desc);

create table if not exists fact_revisions (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  field_key text not null,
  value jsonb not null,
  revision int not null,
  source text not null check (source in ('owner_confirmed', 'system_selected_for_preview', 'operator')),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (business_id, field_key, revision)
);

create index if not exists fact_revisions_business_idx on fact_revisions(business_id, field_key, revision desc);

-- Publish records: which site version went live, from which fact snapshot,
-- and the rollback pointer. site_versions already exist in bundle storage;
-- this records the publish event itself.
create table if not exists publish_records (
  id text primary key,
  site_id text not null,
  version_id text not null,
  fact_snapshot jsonb not null default '{}',
  risk_tier text not null default 'safe' check (risk_tier in ('safe', 'preview_approved', 'operator_approved')),
  published_by text not null,
  published_at timestamptz not null default now(),
  rolled_back_to text
);

create index if not exists publish_records_site_idx on publish_records(site_id, published_at desc);

alter table owner_audit_log enable row level security;
alter table fact_revisions enable row level security;
alter table publish_records enable row level security;
