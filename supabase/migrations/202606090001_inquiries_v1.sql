-- Canonical inbound inquiries replace form_submissions/workflow_deliveries pre-launch.

create extension if not exists pgcrypto;

drop table if exists workflow_deliveries;
drop table if exists form_submissions;

alter table sites
  alter column extension_model set default '{"forms":[],"workflows":[],"inboundSettings":{"captureMode":"form_only","aiHandlingMode":"classify_only","notificationMode":"all_inquiries"},"customBlocks":[]}';

update sites
set extension_model = coalesce(extension_model, '{}'::jsonb) || jsonb_build_object(
  'inboundSettings',
  jsonb_build_object(
    'captureMode', 'form_only',
    'aiHandlingMode', 'classify_only',
    'notificationMode', 'all_inquiries'
  )
)
where extension_model -> 'inboundSettings' is null;

create table if not exists inquiries (
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

create table if not exists inquiry_events (
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

create table if not exists inquiry_deliveries (
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

create index if not exists inquiries_site_time_idx on inquiries(site_id, created_at desc);
create index if not exists inquiries_site_status_time_idx on inquiries(site_id, status, created_at desc);
create index if not exists inquiries_notification_queue_idx on inquiries(notification_state, created_at);
create index if not exists inquiries_ai_queue_idx on inquiries(ai_enrichment_state, created_at);
create index if not exists inquiries_email_normalized_idx on inquiries(site_id, contact_email_normalized) where contact_email_normalized is not null;
create index if not exists inquiries_phone_normalized_idx on inquiries(site_id, contact_phone_normalized) where contact_phone_normalized is not null;
create index if not exists inquiry_events_inquiry_time_idx on inquiry_events(inquiry_id, created_at desc);
create index if not exists inquiry_events_site_time_idx on inquiry_events(site_id, created_at desc);
create index if not exists inquiry_events_dedupe_idx on inquiry_events(site_id, type, dedupe_key, created_at desc) where dedupe_key is not null;
create index if not exists inquiry_deliveries_site_time_idx on inquiry_deliveries(site_id, created_at desc);
create index if not exists inquiry_deliveries_inquiry_time_idx on inquiry_deliveries(inquiry_id, created_at desc);
create unique index if not exists jobs_one_inquiry_notification_idx
  on jobs ((payload ->> 'inquiryId'))
  where kind = 'inquiry_notification' and payload ? 'inquiryId';
create unique index if not exists jobs_one_inquiry_ai_enrichment_idx
  on jobs ((payload ->> 'inquiryId'))
  where kind = 'inquiry_ai_enrichment' and payload ? 'inquiryId';

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

drop trigger if exists inquiries_set_updated_at on inquiries;
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

grant usage on schema public to service_role;
grant select, insert, update, delete on inquiries to service_role;
grant select, insert, update, delete on inquiry_events to service_role;
grant select, insert, update, delete on inquiry_deliveries to service_role;
grant execute on function public.create_inquiry_from_form(
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

alter table inquiries enable row level security;
alter table inquiry_events enable row level security;
alter table inquiry_deliveries enable row level security;

drop policy if exists "site owners can read claimed inquiries" on inquiries;
create policy "site owners can read claimed inquiries"
on inquiries for select
using (public.is_claimed_site_owner(site_id));

drop policy if exists "site owners can update claimed inquiry status" on inquiries;
create policy "site owners can update claimed inquiry status"
on inquiries for update
using (public.is_claimed_site_owner(site_id))
with check (public.is_claimed_site_owner(site_id));

drop policy if exists "site owners can read claimed inquiry events" on inquiry_events;
create policy "site owners can read claimed inquiry events"
on inquiry_events for select
using (public.is_claimed_site_owner(site_id));

drop policy if exists "site owners can read claimed inquiry deliveries" on inquiry_deliveries;
create policy "site owners can read claimed inquiry deliveries"
on inquiry_deliveries for select
using (public.is_claimed_site_owner(site_id));
