-- Claim links give control of an unowned, operator-built prospect project to
-- the signed-in account that redeems them. They never prove business
-- ownership and never move a project that already has an owner. An operator
-- can revoke them; creating a new link revokes the site's earlier open links.
alter table public.adoption_invitations add column revoked_at timestamptz;

create or replace function public.create_site_claim_link(
  target_site_id text,
  target_token_hash text,
  target_expires_at timestamptz
)
returns setof public.adoption_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site sites;
begin
  select * into target_site from sites where id = target_site_id for update;
  if target_site.id is null then raise exception 'site_not_found'; end if;
  if target_site.owner_user_id is not null or target_site.status = 'paused' then
    raise exception 'site_not_claimable';
  end if;
  update adoption_invitations set revoked_at = now()
    where site_id = target_site.id and consumed_at is null and revoked_at is null;
  return query insert into adoption_invitations (id, site_id, token_hash, expires_at)
    values ('invitation_' || replace(gen_random_uuid()::text, '-', ''), target_site.id, target_token_hash, target_expires_at)
    returning *;
end;
$$;

create or replace function public.revoke_site_claim_links(target_site_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  revoked integer;
begin
  update adoption_invitations set revoked_at = now()
    where site_id = target_site_id and consumed_at is null and revoked_at is null;
  get diagnostics revoked = row_count;
  return revoked;
end;
$$;

create or replace function public.consume_adoption_invitation(target_token_hash text, target_owner_user_id uuid)
returns setof public.adoption_invitations
language plpgsql
security definer
set search_path = public
as $$
declare invitation adoption_invitations;
begin
  select * into invitation from adoption_invitations
    where token_hash = target_token_hash and consumed_at is null and revoked_at is null and expires_at > now()
    for update;
  if invitation.id is null then return; end if;
  -- Only an unowned, undisposed project can be claimed.
  update sites set owner_user_id = target_owner_user_id, updated_at = now()
    where id = invitation.site_id and owner_user_id is null and status <> 'paused';
  if not found then return; end if;
  return query update adoption_invitations
    set consumed_at = now(), consumed_by_user_id = target_owner_user_id
    where id = invitation.id and consumed_at is null returning *;
end;
$$;

revoke all on function public.create_site_claim_link(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_site_claim_links(text) from public, anon, authenticated;
revoke all on function public.consume_adoption_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.create_site_claim_link(text, text, timestamptz) to service_role;
grant execute on function public.revoke_site_claim_links(text) to service_role;
grant execute on function public.consume_adoption_invitation(text, uuid) to service_role;
