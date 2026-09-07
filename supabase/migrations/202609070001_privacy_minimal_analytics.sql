-- Owner-approved privacy-minimal analytics, 2026-09-07.
-- Read-only preflight: zero active published sites and zero analytics events.
-- Fail closed under an exclusive lock if that changes; never erase analytics history.
set local lock_timeout = '5s';
lock table public.analytics_events, public.sites in access exclusive mode;
do $$ begin
  if exists (select 1 from public.analytics_events)
    or exists (select 1 from public.sites where status = 'active' and published_version_id is not null)
  then raise exception 'privacy_minimal_analytics_cutover_not_empty'; end if;
end $$;

alter table public.analytics_events
  drop column visitor_key,
  drop column visit_id,
  drop column landing_path,
  add column page_view_id text not null check (char_length(page_view_id) between 8 and 120);
create index analytics_events_site_page_view_idx
  on public.analytics_events(site_id, page_view_id, occurred_at);
-- Dropping the obsolete included columns also drops the old time index.
create index analytics_events_site_time_idx
  on public.analytics_events(site_id, occurred_at desc)
  include (event_type, page_view_id, channel, page_path, device_category);

create or replace function public.analytics_report(
  p_site_id text, p_from date, p_to date, p_compare_from date, p_compare_to date,
  p_interval text, p_timezone text, p_channel text, p_source text,
  p_page text, p_action text, p_device text
)
returns jsonb language sql stable security definer set search_path = public as $$
with
windows as (
  select 'current' as period, p_from::timestamp at time zone p_timezone as starts,
    (p_to + 1)::timestamp at time zone p_timezone as ends
  union all
  select 'comparison', p_compare_from::timestamp at time zone p_timezone,
    (p_compare_to + 1)::timestamp at time zone p_timezone
  where p_compare_from is not null and p_compare_to is not null
),
window_events as (
  select e.*, w.period,
    e.event_type in ('form_submit','call_click','email_click','directions_click','booking_click','ordering_click') as is_action
  from analytics_events e join windows w on e.occurred_at >= w.starts and e.occurred_at < w.ends
  where e.site_id = p_site_id
),
filtered as (
  select e.* from window_events e
  where (p_channel is null or e.channel = p_channel)
    and (p_source is null or coalesce(e.source, e.referrer_host, 'direct') = p_source)
    and (p_page is null or e.page_path = p_page)
    and (p_device is null or e.device_category = p_device)
    and (p_action is null or exists (
      select 1 from window_events a
      where a.period = e.period and a.page_view_id = e.page_view_id and a.event_type = p_action
    ))
),
dimensions as (
  select e.*, d.dimension, d.key
  from filtered e cross join lateral (
    values
      ('total', 'total'),
      ('trend', date_trunc(p_interval, e.occurred_at at time zone p_timezone)::date::text),
      ('channels', e.channel),
      ('sources', coalesce(e.source, e.referrer_host, 'direct')),
      ('campaigns', e.campaign),
      ('pages', e.page_path),
      ('actions', case when e.is_action then e.event_type end),
      ('devices', e.device_category)
  ) d(dimension, key)
  where d.key is not null and (e.period = 'current' or d.dimension = 'total')
),
grouped as (
  select period, dimension, key,
    count(distinct page_view_id) filter (where event_type = 'page_view')::bigint as page_views,
    array_agg(distinct page_view_id) filter (where event_type = 'page_view') as view_ids,
    array_agg(distinct page_view_id) filter (where is_action) as action_ids,
    count(*) filter (where event_type = 'form_submit')::bigint as leads,
    count(*) filter (where is_action)::bigint as customer_actions,
    count(*) filter (where event_type = 'form_start')::bigint as form_starts,
    round(coalesce(sum(case when event_type = 'engagement' then (properties->>'engagedMs')::numeric else 0 end), 0) / 1000)::bigint as engaged_seconds,
    percentile_cont(0.5) within group (order by (properties->>'elapsedMs')::numeric)
      filter (where is_action) / 1000 as median_seconds_to_action
  from dimensions group by period, dimension, key
),
matched as (
  select g.*, cardinality(array(
    select unnest(g.view_ids) intersect select unnest(g.action_ids)
  )) as action_page_views from grouped g
),
results as (
  select period, dimension, key, page_views, customer_actions,
    jsonb_build_object(
      'key', key,
      'label', case when dimension = 'pages' and key = '/' then 'Homepage'
        when key = 'direct' then 'Direct / unknown'
        when dimension in ('pages', 'campaigns') then key
        else initcap(replace(replace(replace(key, 'form_submit', 'form submission'), '_click', ''), '_', ' ')) end,
      'bucket', key,
      'page_views', page_views, 'leads', leads,
      'customer_actions', customer_actions, 'action_page_views', action_page_views,
      'action_rate', case when page_views = 0 then 0 else action_page_views::numeric / page_views end,
      'form_starts', form_starts, 'engaged_seconds', engaged_seconds,
      'median_seconds_to_action', median_seconds_to_action
    ) as value
  from matched
),
ranked as (
  select *, row_number() over (
    partition by period, dimension order by page_views desc, customer_actions desc, key
  ) as rank from results
),
collections as (
  select dimension, jsonb_agg(value order by page_views desc, customer_actions desc, key) as value
  from ranked where period = 'current' and dimension not in ('total', 'trend') and rank <= 100
  group by dimension
),
health as (
  select max(last_event_at) filter (where reason = 'accepted') as last_accepted_at,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'accepted'), 0)::bigint as accepted,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'internal'), 0)::bigint as internal,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'bot'), 0)::bigint as bot,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'preview'), 0)::bigint as preview,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'duplicate'), 0)::bigint as duplicate,
    coalesce(sum(event_count) filter (where day between p_from and p_to and reason = 'invalid'), 0)::bigint as invalid
  from analytics_collection_daily where site_id = p_site_id
)
select coalesce((select jsonb_object_agg(dimension, value) from collections), '{}'::jsonb)
  || jsonb_build_object(
    'current', coalesce((select value from results where period = 'current' and dimension = 'total'), '{}'::jsonb),
    'comparison', case when p_compare_from is null then null else coalesce(
      (select value from results where period = 'comparison' and dimension = 'total'), '{}'::jsonb) end,
    'trend', coalesce((select jsonb_agg(value order by key) from results where dimension = 'trend'), '[]'::jsonb),
    'collection_health', (select to_jsonb(h) from health h)
  );
$$;
revoke all on function public.analytics_report(text,date,date,date,date,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.analytics_report(text,date,date,date,date,text,text,text,text,text,text,text) to service_role;

-- Retain inquiry semantics; remove only obsolete browser identity collection.
drop function public.create_inquiry_from_form(text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text,jsonb);
create function public.create_inquiry_from_form(
  p_site_id text, p_form_id text, p_page_id text, p_payload jsonb,
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
      'userAgent', p_user_agent, 'ipHash', p_ip_hash
    ), p_dedupe_key
  ) returning * into event_row;

  if p_analytics_event is not null then
    insert into analytics_events (
      id, schema_version, site_id, site_version_id, event_id, event_type,
      page_view_id, page_path, channel, source, medium, campaign, referrer_host,
      device_category, properties, occurred_at, created_at
    ) values (
      'analytics_' || replace(gen_random_uuid()::text, '-', ''), 1, p_site_id,
      p_analytics_event->>'siteVersionId', p_analytics_event->>'eventId', 'form_submit',
      p_analytics_event->>'pageViewId', p_analytics_event->>'pagePath',
      p_analytics_event->>'channel', p_analytics_event->>'source', p_analytics_event->>'medium',
      p_analytics_event->>'campaign', p_analytics_event->>'referrerHost',
      p_analytics_event->>'deviceCategory', coalesce(p_analytics_event->'properties', '{}'),
      (p_analytics_event->>'occurredAt')::timestamptz, now()
    ) on conflict (site_id, event_id) do nothing;
    perform record_analytics_collection(p_site_id, 'accepted', now());
  end if;

  return jsonb_build_object('inquiry', to_jsonb(inquiry_row), 'event', to_jsonb(event_row), 'duplicate', false);
end; $$;
revoke all on function public.create_inquiry_from_form(text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_inquiry_from_form(text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;
