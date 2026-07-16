-- W5.1: a bare claim row must not imply business-contact verification.
--
-- Earlier Phase 1.5 scaffolding defaulted verification_level to
-- contact_verified. That made missing verification metadata indistinguishable
-- from a completed contact challenge. New claims start unverified until an
-- operator/manual process or automated contact-code challenge stamps them.

alter table claims drop constraint if exists claims_verification_level_check;

alter table claims
  alter column verification_level set default 'unverified';

update claims
set verification_level = 'unverified'
where verification_level = 'contact_verified'
  and verified_at is null
  and verification_method is null
  and verified_by is null;

alter table claims
  add constraint claims_verification_level_check
  check (verification_level in ('unverified', 'contact_verified', 'owner_verified', 'operator_verified'));
