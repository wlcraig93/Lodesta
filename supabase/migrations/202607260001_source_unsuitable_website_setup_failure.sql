alter table website_setups
  drop constraint website_setups_failure_code_check;

alter table website_setups
  add constraint website_setups_failure_code_check
  check (
    failure_code is null
    or failure_code in (
      'source_invalid',
      'source_unsuitable',
      'crawl_temporarily_unavailable',
      'crawl_robots_disallowed',
      'crawl_unsupported_content',
      'crawl_primary_unavailable',
      'bootstrap_failed',
      'worker_interrupted'
    )
  );
