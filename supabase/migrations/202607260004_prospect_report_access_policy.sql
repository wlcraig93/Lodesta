-- Assign report access on the server, replace report-global unlocks with
-- visitor-specific grants, and attach deliberately public reports to outbound prospects.

alter table public.prospect_reports
  add column access_policy text;

update public.prospect_reports
set access_policy = 'email_gate'
where access_policy is null;

alter table public.prospect_reports
  alter column access_policy set not null,
  add constraint prospect_reports_access_policy_check
    check (access_policy in ('email_gate', 'public_link'));

do $$
begin
  if exists (
    select 1
    from public.prospect_report_leads
    group by report_id, lower(email)
    having count(*) > 1
  ) then
    raise exception 'prospect_report_leads contains duplicate report/email rows; operator review is required before this migration';
  end if;

  if exists (
    select 1
    from public.prospect_reports report
    where report.lead_id is not null
      and not exists (
        select 1
        from public.prospect_report_leads lead
        where lead.id = report.lead_id
      )
  ) then
    raise exception 'prospect_reports contains a lead_id without a retained prospect_report_leads row';
  end if;
end $$;

create unique index prospect_report_leads_report_email_unique
  on public.prospect_report_leads(report_id, lower(email));

create table public.prospect_report_access_grants (
  id text primary key,
  report_id text not null references public.prospect_reports(id) on delete restrict,
  lead_id text not null references public.prospect_report_leads(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint prospect_report_access_grants_expiry_check check (expires_at > created_at)
);

create index prospect_report_access_grants_report_expiry_idx
  on public.prospect_report_access_grants(report_id, expires_at desc);
create index prospect_report_access_grants_lead_id_idx
  on public.prospect_report_access_grants(lead_id);

alter table public.prospect_report_access_grants enable row level security;
revoke all on table public.prospect_report_access_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.prospect_report_access_grants to service_role;

create or replace function public.create_or_reuse_prospect_report_lead(
  target_report_id text,
  target_email text,
  target_contact_name text,
  target_phone text,
  target_ip_hash text,
  target_metadata jsonb
)
returns public.prospect_report_leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.prospect_report_leads;
begin
  insert into public.prospect_report_leads (
    id,
    report_id,
    email,
    contact_name,
    phone,
    ip_hash,
    metadata,
    created_at
  )
  values (
    'prospect_lead_' || replace(gen_random_uuid()::text, '-', ''),
    target_report_id,
    lower(trim(target_email)),
    nullif(trim(target_contact_name), ''),
    nullif(trim(target_phone), ''),
    target_ip_hash,
    coalesce(target_metadata, '{}'::jsonb),
    now()
  )
  on conflict (report_id, lower(email))
  do update set
    contact_name = coalesce(excluded.contact_name, public.prospect_report_leads.contact_name),
    phone = coalesce(excluded.phone, public.prospect_report_leads.phone),
    ip_hash = coalesce(excluded.ip_hash, public.prospect_report_leads.ip_hash),
    metadata = public.prospect_report_leads.metadata || excluded.metadata
  returning * into result;

  return result;
end;
$$;

revoke all on function public.create_or_reuse_prospect_report_lead(text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_or_reuse_prospect_report_lead(text,text,text,text,text,jsonb)
  to service_role;

alter table public.prospect_reports
  drop column unlocked_at,
  drop column lead_id;

alter table public.outbound_prospects
  add column report_id text references public.prospect_reports(id) on delete restrict,
  add column first_report_viewed_at timestamptz;

create unique index outbound_prospects_report_id_unique
  on public.outbound_prospects(report_id)
  where report_id is not null;

alter table public.outbound_events
  drop constraint outbound_events_type_check;
alter table public.outbound_events
  add constraint outbound_events_type_check
    check (type in (
      'mailer_sent',
      'report_viewed',
      'invitation_opened',
      'preview_viewed',
      'picker_interaction',
      'adoption_started',
      'adoption_completed',
      'published',
      'support_contact',
      'disqualified',
      'credibility_feedback'
    ));

create or replace function public.record_outbound_report_view(
  target_report_id text,
  target_occurred_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_prospect public.outbound_prospects;
begin
  update public.outbound_prospects
  set first_report_viewed_at = target_occurred_at
  where report_id = target_report_id
    and first_report_viewed_at is null
  returning * into target_prospect;

  if target_prospect.id is null then
    return false;
  end if;

  insert into public.outbound_events (
    id,
    campaign_id,
    prospect_id,
    site_id,
    type,
    occurred_at,
    metadata
  )
  values (
    gen_random_uuid()::text,
    target_prospect.campaign_id,
    target_prospect.id,
    target_prospect.site_id,
    'report_viewed',
    target_occurred_at,
    jsonb_build_object('reportId', target_report_id)
  );

  return true;
end;
$$;

revoke all on function public.record_outbound_report_view(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_outbound_report_view(text,timestamptz)
  to service_role;

create index prospect_reports_source_policy_created_idx
  on public.prospect_reports(source_key, access_policy, created_at desc);

create unique index prospect_reports_active_source_policy_unique
  on public.prospect_reports(source_key, access_policy)
  where status in ('queued', 'running');
