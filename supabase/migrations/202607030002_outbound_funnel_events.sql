-- W4: instrument the Phase 1.5 outreach funnel explicitly.
--
-- Existing events remain valid; these additional names let reports distinguish
-- claim-link opens, design-choice interactions, checkout starts, and paid
-- conversion without overloading claim_started/claim_completed.

alter table outbound_events drop constraint if exists outbound_events_type_check;

alter table outbound_events
  add constraint outbound_events_type_check
  check (
    type in (
      'mailer_sent',
      'claim_link_opened',
      'preview_viewed',
      'picker_interaction',
      'claim_started',
      'checkout_started',
      'claim_completed',
      'paid',
      'published',
      'support_contact',
      'disqualified',
      'credibility_feedback'
    )
  );
