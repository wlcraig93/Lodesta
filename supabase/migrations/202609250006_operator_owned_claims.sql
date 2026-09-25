-- Prospect projects are built under the operator's own account, because
-- authoring requires an owner. A claim link records the operator who created
-- it, and redeeming it moves ownership from that operator (or from nobody) to
-- the claimant. Any other owned project can never be taken over.
alter table public.adoption_invitations add column created_by_user_id uuid references auth.users(id) on delete restrict;

drop function public.create_site_claim_link(text, text, timestamptz);

create or replace function public.create_site_claim_link(
  target_site_id text,
  target_token_hash text,
  target_expires_at timestamptz,
  actor_id uuid
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
  if target_site.status = 'paused'
    or (target_site.owner_user_id is not null and target_site.owner_user_id is distinct from actor_id) then
    raise exception 'site_not_claimable';
  end if;
  update adoption_invitations set revoked_at = now()
    where site_id = target_site.id and consumed_at is null and revoked_at is null;
  return query insert into adoption_invitations (id, site_id, token_hash, expires_at, created_by_user_id)
    values ('invitation_' || replace(gen_random_uuid()::text, '-', ''), target_site.id, target_token_hash, target_expires_at, actor_id)
    returning *;
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
  -- Only an unowned project, or one still owned by the operator who created
  -- the link, and never a disposed one.
  update sites set owner_user_id = target_owner_user_id, updated_at = now()
    where id = invitation.site_id and status <> 'paused'
      and (owner_user_id is null or owner_user_id = invitation.created_by_user_id);
  if not found then return; end if;
  return query update adoption_invitations
    set consumed_at = now(), consumed_by_user_id = target_owner_user_id
    where id = invitation.id and consumed_at is null returning *;
end;
$$;

revoke all on function public.create_site_claim_link(text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.consume_adoption_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.create_site_claim_link(text, text, timestamptz, uuid) to service_role;
grant execute on function public.consume_adoption_invitation(text, uuid) to service_role;
