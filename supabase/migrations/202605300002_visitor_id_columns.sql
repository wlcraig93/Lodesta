-- Add visitor ids used by analytics attribution.

alter table analytics_events
  add column if not exists visitor_id text;

create index if not exists analytics_events_site_visitor_time_idx
  on analytics_events(site_id, visitor_id, occurred_at desc)
  where visitor_id is not null;
