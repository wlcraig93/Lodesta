create table workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table sites (
  id text primary key,
  workspace_id text references workspaces(id) on delete cascade,
  slug text not null unique,
  status text not null default 'draft',
  site_model jsonb not null,
  extension_model jsonb not null default '{"workflows":[],"customBlocks":[]}',
  presence_assessment jsonb not null default '{}',
  created_at timestamptz not null default now()
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

create table form_submissions (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  form_id text,
  page_id text,
  payload jsonb not null,
  metadata jsonb not null default '{}',
  submitted_at timestamptz not null default now(),
  source_url text,
  user_agent text,
  ip_hash text,
  status text not null default 'new'
);

create table workflow_deliveries (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  workflow_id text not null,
  submission_id text references form_submissions(id) on delete set null,
  destination text not null check (destination in ('email', 'crm_placeholder', 'webhook')),
  target text,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  message text not null,
  response_status int,
  error text,
  created_at timestamptz not null default now()
);

create table analytics_events (
  id text primary key,
  site_id text references sites(id) on delete cascade,
  session_id text not null,
  page_id text,
  event_type text not null,
  event jsonb not null,
  occurred_at timestamptz not null default now()
);

create table optimization_findings (
  id text not null,
  site_id text references sites(id) on delete cascade,
  standard_criterion_id text,
  category text not null,
  severity text not null,
  title text not null,
  rationale text not null,
  recommended_action text not null,
  status text not null default 'open',
  apply_mode text not null,
  suggested_edit_payload jsonb,
  expected_outcome_metric text,
  created_at timestamptz not null default now(),
  primary key (site_id, id)
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
  type text not null check (type in ('mailer_sent', 'preview_viewed', 'claim_started', 'claim_completed', 'published', 'support_contact', 'disqualified', 'credibility_feedback')),
  occurred_at timestamptz not null default now(),
  value numeric,
  metadata jsonb not null default '{}'
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

create index analytics_events_site_time_idx on analytics_events(site_id, occurred_at desc);
create index analytics_events_site_event_time_idx on analytics_events(site_id, event_type, occurred_at desc);
create index sites_workspace_idx on sites(workspace_id);
create unique index business_profiles_site_idx on business_profiles(site_id);
create index site_assets_site_kind_idx on site_assets(site_id, kind);
create index site_assets_site_rights_idx on site_assets(site_id, rights_status);
create index form_submissions_site_time_idx on form_submissions(site_id, submitted_at desc);
create index form_submissions_site_status_time_idx on form_submissions(site_id, status, submitted_at desc);
create index forms_site_idx on forms(site_id);
create index site_versions_site_status_idx on site_versions(site_id, status);
create index workflow_deliveries_site_time_idx on workflow_deliveries(site_id, created_at desc);
create index workflow_deliveries_submission_idx on workflow_deliveries(submission_id);
create index optimization_findings_site_status_idx on optimization_findings(site_id, status);
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
create index jobs_status_created_idx on jobs(status, created_at);
create index jobs_queue_ready_idx on jobs(status, run_after, created_at);
create index jobs_running_lock_idx on jobs(status, locked_at);

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
alter table form_submissions enable row level security;
alter table workflow_deliveries enable row level security;
alter table analytics_events enable row level security;
alter table optimization_findings enable row level security;
alter table experiments enable row level security;
alter table experiment_learnings enable row level security;
alter table preview_tokens enable row level security;
alter table domains enable row level security;
alter table outbound_campaigns enable row level security;
alter table outbound_prospects enable row level security;
alter table outbound_events enable row level security;
alter table claims enable row level security;
alter table jobs enable row level security;

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

create policy "site owners can read claimed form submissions"
on form_submissions for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed workflow deliveries"
on workflow_deliveries for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed analytics events"
on analytics_events for select
using (public.is_claimed_site_owner(site_id));

create policy "site owners can read claimed optimization findings"
on optimization_findings for select
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
