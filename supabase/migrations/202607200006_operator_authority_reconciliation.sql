alter table site_operator_queue
  drop constraint if exists site_operator_queue_reason_check;

alter table site_operator_queue
  add constraint site_operator_queue_reason_check
  check (reason in (
    'objective_failure',
    'subjective_finding',
    'unsupported_vertical',
    'unsupported_capability',
    'stale_candidate',
    'authority_publish_failure'
  ));
