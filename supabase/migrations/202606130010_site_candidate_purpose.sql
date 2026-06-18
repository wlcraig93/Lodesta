alter table site_candidates
  add column if not exists candidate_purpose text not null default 'customer_prospect'
  check (candidate_purpose in ('customer_prospect', 'test_generation'));

update site_candidates
set candidate_purpose = 'customer_prospect'
where candidate_purpose is null;

create index if not exists site_candidates_purpose_created_idx
  on site_candidates(candidate_purpose, created_at desc);
