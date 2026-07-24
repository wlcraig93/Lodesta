-- Canonical first-party website analytics. Pre-launch clean cut approved only after
-- scripts/report-analytics-cutover.ts proves zero active published sites and events.

alter table public.sites
  add column reporting_timezone text not null default 'UTC'
  check (char_length(reporting_timezone) between 1 and 100);

alter table public.website_setups
  add column reporting_timezone text not null default 'UTC'
  check (char_length(reporting_timezone) between 1 and 100);

drop function public.create_website_setup(uuid,text,text,text,text);
create function public.create_website_setup(
  target_owner_user_id uuid,
  target_source_url text,
  target_normalized_source text,
  target_reporting_timezone text,
  target_idempotency_key text,
  target_creation_request_hash text
)
returns setof public.website_setups
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.website_setups;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_owner_user_id::text, 0));
  select * into existing from public.website_setups
    where owner_user_id = target_owner_user_id and idempotency_key = target_idempotency_key;
  if found then
    if existing.creation_request_hash <> target_creation_request_hash then
      raise exception 'idempotency_key_conflict';
    end if;
    return next existing;
    return;
  end if;
  if public.private_user_active_operation_count(target_owner_user_id) >= 3 then
    raise exception 'concurrent_project_limit';
  end if;
  return query
    insert into public.website_setups (
      id, owner_user_id, source_url, normalized_source, reporting_timezone,
      status, idempotency_key, creation_request_hash
    ) values (
      'setup_' || replace(gen_random_uuid()::text, '-', ''), target_owner_user_id,
      target_source_url, target_normalized_source, target_reporting_timezone,
      'queued', target_idempotency_key, target_creation_request_hash
    ) returning *;
end;
$$;
revoke all on function public.create_website_setup(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_website_setup(uuid,text,text,text,text,text) to service_role;

drop table public.analytics_events;

create table public.analytics_events (
  id text primary key,
  schema_version integer not null check (schema_version = 1),
  site_id text not null references public.sites(id) on delete restrict,
  site_version_id text not null references public.site_versions(id) on delete restrict,
  event_id text not null,
  event_type text not null check (event_type in (
    'page_view','engagement','form_start','form_submit','call_click','email_click',
    'directions_click','booking_click','ordering_click','outbound_click','web_vital'
  )),
  visitor_key text not null,
  visit_id text not null,
  page_path text not null,
  landing_path text not null,
  channel text not null check (channel in ('campaign','organic_search','social','referral','direct')),
  source text,
  medium text,
  campaign text,
  referrer_host text,
  device_category text not null check (device_category in ('mobile','tablet','desktop')),
  properties jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (site_id, event_id)
);
create index analytics_events_site_time_idx
  on public.analytics_events(site_id, occurred_at desc)
  include (event_type, visitor_key, visit_id, channel, page_path, landing_path, device_category);
create index analytics_events_site_visit_idx
  on public.analytics_events(site_id, visit_id, occurred_at);

create table public.analytics_collection_daily (
  site_id text not null references public.sites(id) on delete restrict,
  day date not null,
  reason text not null check (reason in ('accepted','internal','bot','preview','duplicate','invalid')),
  event_count bigint not null default 0 check (event_count >= 0),
  last_event_at timestamptz not null default now(),
  primary key (site_id, day, reason)
);

alter table public.analytics_events enable row level security;
alter table public.analytics_collection_daily enable row level security;
revoke all on table public.analytics_events, public.analytics_collection_daily from public, anon, authenticated;
grant select, insert, update, delete on table public.analytics_events, public.analytics_collection_daily to service_role;

create function public.record_analytics_collection(
  p_site_id text,
  p_reason text,
  p_at timestamptz default now()
)
returns void language sql security definer set search_path = public as $$
  insert into analytics_collection_daily(site_id, day, reason, event_count, last_event_at)
  values (
    p_site_id,
    (p_at at time zone (select reporting_timezone from sites where id = p_site_id))::date,
    p_reason,
    1,
    p_at
  )
  on conflict (site_id, day, reason) do update
    set event_count = analytics_collection_daily.event_count + 1,
        last_event_at = greatest(analytics_collection_daily.last_event_at, excluded.last_event_at);
$$;
revoke all on function public.record_analytics_collection(text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_analytics_collection(text,text,timestamptz) to service_role;

create function public.analytics_report(
  p_site_id text,
  p_from date,
  p_to date,
  p_compare_from date,
  p_compare_to date,
  p_interval text,
  p_timezone text,
  p_channel text,
  p_source text,
  p_page text,
  p_action text,
  p_device text
)
returns jsonb language sql stable security definer set search_path = public as $$
with
bounds as (
  select
    p_from::timestamp at time zone p_timezone as current_start,
    (p_to + 1)::timestamp at time zone p_timezone as current_end,
    case when p_compare_from is null then null else p_compare_from::timestamp at time zone p_timezone end as comparison_start,
    case when p_compare_to is null then null else (p_compare_to + 1)::timestamp at time zone p_timezone end as comparison_end
),
action_visits as (
  select distinct visit_id
  from analytics_events, bounds
  where site_id = p_site_id
    and occurred_at >= least(current_start, coalesce(comparison_start, current_start))
    and occurred_at < greatest(current_end, coalesce(comparison_end, current_end))
    and event_type = p_action
),
filtered as (
  select e.*
  from analytics_events e, bounds
  where e.site_id = p_site_id
    and e.occurred_at >= least(current_start, coalesce(comparison_start, current_start))
    and e.occurred_at < greatest(current_end, coalesce(comparison_end, current_end))
    and (p_channel is null or e.channel = p_channel)
    and (p_source is null or coalesce(e.source, e.referrer_host, 'direct') = p_source)
    and (p_page is null or e.page_path = p_page or e.landing_path = p_page)
    and (p_device is null or e.device_category = p_device)
    and (p_action is null or e.visit_id in (select visit_id from action_visits))
),
current_events as (
  select f.* from filtered f, bounds
  where f.occurred_at >= current_start and f.occurred_at < current_end
),
comparison_events as (
  select f.* from filtered f, bounds
  where comparison_start is not null
    and f.occurred_at >= comparison_start and f.occurred_at < comparison_end
),
current_totals as (
  select
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type = 'form_submit')::bigint as leads,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    count(distinct visit_id) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as action_visits,
    count(*) filter (where event_type = 'form_start')::bigint as form_starts,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds,
    round(percentile_cont(0.5) within group (order by (properties->>'elapsedMs')::numeric) filter (
      where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click')
    ) / 1000)::bigint as median_seconds_to_action
  from current_events
),
comparison_totals as (
  select
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type = 'form_submit')::bigint as leads,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    count(distinct visit_id) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as action_visits,
    count(*) filter (where event_type = 'form_start')::bigint as form_starts,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds,
    round(percentile_cont(0.5) within group (order by (properties->>'elapsedMs')::numeric) filter (
      where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click')
    ) / 1000)::bigint as median_seconds_to_action
  from comparison_events
),
trend_rows as (
  select
    date_trunc(p_interval, occurred_at at time zone p_timezone)::date as bucket,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions
  from current_events
  group by 1 order by 1
),
channel_rows as (
  select
    channel as key,
    initcap(replace(channel, '_', ' ')) as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds
  from current_events group by channel order by visits desc, customer_actions desc limit 100
),
source_rows as (
  select
    coalesce(source, referrer_host, 'direct') as key,
    initcap(replace(coalesce(source, referrer_host, 'direct'), '_', ' ')) as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds
  from current_events group by coalesce(source, referrer_host, 'direct')
  order by visits desc, customer_actions desc limit 100
),
campaign_rows as (
  select
    campaign as key,
    campaign as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds
  from current_events where campaign is not null
  group by campaign order by visits desc, customer_actions desc limit 100
),
page_rows as (
  select
    page_path as key,
    case when page_path = '/' then 'Homepage' else page_path end as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds,
    count(*) filter (where event_type = 'engagement')::bigint as exits
  from current_events group by page_path order by page_views desc, customer_actions desc limit 100
),
landing_rows as (
  select
    landing_path as key,
    case when landing_path = '/' then 'Homepage' else landing_path end as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds
  from current_events group by landing_path order by visits desc, customer_actions desc limit 100
),
action_rows as (
  select
    event_type as key,
    initcap(replace(replace(event_type, '_click', ''), '_', ' ')) as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    0::bigint as page_views,
    count(*)::bigint as customer_actions,
    0::bigint as engaged_seconds
  from current_events
  where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click')
  group by event_type order by customer_actions desc limit 100
),
device_rows as (
  select
    device_category as key,
    initcap(device_category) as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*) filter (where event_type = 'page_view')::bigint as page_views,
    count(*) filter (where event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click'))::bigint as customer_actions,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds
  from current_events group by device_category order by visits desc limit 100
),
visitor_type_rows as (
  select
    case when properties->>'returning' = 'true' then 'returning' else 'new' end as key,
    case when properties->>'returning' = 'true' then 'Returning' else 'New' end as label,
    count(distinct visitor_key)::bigint as visitors,
    count(distinct visit_id)::bigint as visits,
    count(*)::bigint as page_views,
    0::bigint as customer_actions,
    0::bigint as engaged_seconds
  from current_events where event_type = 'page_view'
  group by 1, 2
  order by visits desc
),
health as (
  select
    max(last_event_at) filter (where reason = 'accepted') as last_accepted_at,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'accepted'), 0)::bigint as accepted,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'internal'), 0)::bigint as internal,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'bot'), 0)::bigint as bot,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'preview'), 0)::bigint as preview,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'duplicate'), 0)::bigint as duplicate,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'invalid'), 0)::bigint as invalid
  from analytics_collection_daily
  where site_id = p_site_id
)
select jsonb_build_object(
  'current', (select to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else action_visits::numeric / visits end) from current_totals t),
  'comparison', case when p_compare_from is null then null else (select to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else action_visits::numeric / visits end) from comparison_totals t) end,
  'trend', coalesce((select jsonb_agg(to_jsonb(t)) from trend_rows t), '[]'::jsonb),
  'channels', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else customer_actions::numeric / visits end, 'exits', 0)) from channel_rows t), '[]'::jsonb),
  'sources', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else customer_actions::numeric / visits end, 'exits', 0)) from source_rows t), '[]'::jsonb),
  'campaigns', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else customer_actions::numeric / visits end, 'exits', 0)) from campaign_rows t), '[]'::jsonb),
  'pages', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else customer_actions::numeric / visits end)) from page_rows t), '[]'::jsonb),
  'landing_pages', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else customer_actions::numeric / visits end, 'exits', 0)) from landing_rows t), '[]'::jsonb),
  'actions', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else customer_actions::numeric / visits end, 'exits', 0)) from action_rows t), '[]'::jsonb),
  'devices', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', case when visits = 0 then 0 else customer_actions::numeric / visits end, 'exits', 0)) from device_rows t), '[]'::jsonb),
  'visitor_types', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('action_rate', 0, 'exits', 0)) from visitor_type_rows t), '[]'::jsonb),
  'collection_health', (select to_jsonb(h) from health h)
);
$$;
revoke all on function public.analytics_report(text,date,date,date,date,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.analytics_report(text,date,date,date,date,text,text,text,text,text,text,text) to service_role;

drop function public.create_inquiry_from_form(text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text);
create function public.create_inquiry_from_form(
  p_site_id text, p_form_id text, p_page_id text, p_visitor_id text, p_payload jsonb,
  p_metadata jsonb, p_source_url text, p_user_agent text, p_ip_hash text,
  p_contact_name text, p_contact_email text, p_contact_email_normalized text,
  p_contact_phone text, p_contact_phone_normalized text, p_message_text text, p_dedupe_key text,
  p_analytics_event jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inquiry_row inquiries%rowtype;
  event_row inquiry_events%rowtype;
begin
  if not exists (
    select 1 from form_definitions f
    join site_version_forms vf on vf.form_definition_id = f.id
    join site_versions v on v.id = vf.version_id
    where f.id = p_form_id and f.site_id = p_site_id and f.status = 'published' and v.status = 'published'
  ) then raise exception 'form_not_published'; end if;

  if p_dedupe_key is not null then
    select ie.* into event_row from inquiry_events ie
      where ie.site_id = p_site_id and ie.dedupe_key = p_dedupe_key limit 1;
    if found then
      select i.* into inquiry_row from inquiries i where i.id = event_row.inquiry_id;
      return jsonb_build_object('inquiry', to_jsonb(inquiry_row), 'event', to_jsonb(event_row), 'duplicate', true);
    end if;
  end if;

  insert into inquiries (
    id, site_id, contact_name, contact_email, contact_email_normalized,
    contact_phone, contact_phone_normalized
  ) values (
    'inquiry_' || replace(gen_random_uuid()::text, '-', ''), p_site_id, p_contact_name,
    p_contact_email, p_contact_email_normalized, p_contact_phone, p_contact_phone_normalized
  ) returning * into inquiry_row;

  insert into inquiry_events (
    id, site_id, inquiry_id, type, actor, message_text, payload, source_url,
    page_id, form_id, metadata, dedupe_key
  ) values (
    'inquiry_event_' || replace(gen_random_uuid()::text, '-', ''), p_site_id, inquiry_row.id,
    'form_submission', 'visitor', p_message_text, p_payload, p_source_url,
    p_page_id, p_form_id, coalesce(p_metadata, '{}') || jsonb_build_object(
      'visitorId', p_visitor_id, 'userAgent', p_user_agent, 'ipHash', p_ip_hash
    ), p_dedupe_key
  ) returning * into event_row;

  if p_analytics_event is not null then
    insert into analytics_events (
      id, schema_version, site_id, site_version_id, event_id, event_type, visitor_key,
      visit_id, page_path, landing_path, channel, source, medium, campaign, referrer_host,
      device_category, properties, occurred_at, created_at
    ) values (
      'analytics_' || replace(gen_random_uuid()::text, '-', ''), 1, p_site_id,
      p_analytics_event->>'siteVersionId', p_analytics_event->>'eventId', 'form_submit',
      p_analytics_event->>'visitorKey', p_analytics_event->>'visitId',
      p_analytics_event->>'pagePath', p_analytics_event->>'landingPath',
      p_analytics_event->>'channel', p_analytics_event->>'source', p_analytics_event->>'medium',
      p_analytics_event->>'campaign', p_analytics_event->>'referrerHost',
      p_analytics_event->>'deviceCategory', coalesce(p_analytics_event->'properties', '{}'),
      (p_analytics_event->>'occurredAt')::timestamptz, now()
    ) on conflict (site_id, event_id) do nothing;
    perform record_analytics_collection(p_site_id, 'accepted', now());
  end if;

  return jsonb_build_object('inquiry', to_jsonb(inquiry_row), 'event', to_jsonb(event_row), 'duplicate', false);
end; $$;
revoke all on function public.create_inquiry_from_form(text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_inquiry_from_form(text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create function public.prune_analytics_events(
  p_before timestamptz default (now() - interval '14 months')
)
returns bigint language plpgsql security definer set search_path = public as $$
declare deleted_count bigint;
begin
  delete from analytics_events where occurred_at < p_before;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end; $$;
revoke all on function public.prune_analytics_events(timestamptz) from public, anon, authenticated;
grant execute on function public.prune_analytics_events(timestamptz) to service_role;
