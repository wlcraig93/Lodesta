-- Every transactional email goes through the notification outbox and is sent
-- by the worker. A report access email belongs to no site: its recipient is
-- the address the requester typed into the report form, resolved at delivery
-- time from prospect_report_leads by subject_id.
alter table public.owner_notifications alter column site_id drop not null;

alter table public.owner_notifications drop constraint owner_notifications_kind_check;
alter table public.owner_notifications add constraint owner_notifications_kind_check
  check (kind in ('lead', 'run_ready', 'run_failed', 'run_needs_input', 'domain_attention', 'site_unreachable', 'form_unreachable', 'report_access'));

alter table public.owner_notifications drop constraint owner_notifications_audience_check;
alter table public.owner_notifications add constraint owner_notifications_audience_check
  check (audience in ('owner', 'operator', 'requester'));

-- Requester emails are exactly the site-less report access emails.
alter table public.owner_notifications add constraint owner_notifications_requester_shape_check
  check ((audience = 'requester') = (kind = 'report_access') and (audience = 'requester') = (site_id is null));
