-- Add visitor ids used by analytics and lead attribution.

alter table analytics_events
  add column if not exists visitor_id text;

alter table form_submissions
  add column if not exists visitor_id text;

create index if not exists analytics_events_site_visitor_time_idx
  on analytics_events(site_id, visitor_id, occurred_at desc)
  where visitor_id is not null;

create index if not exists form_submissions_site_visitor_time_idx
  on form_submissions(site_id, visitor_id, submitted_at desc)
  where visitor_id is not null;
