-- A live custom domain keeps serving through transient DNS or verification
-- problems. routing_failed_since records when our routing probe first saw the
-- hostname stop pointing to Lodesta; only 24 hours of confirmed misrouting
-- moves a live domain to attention_required, which still serves.
alter table public.domains add column routing_failed_since timestamptz;

-- Owners remove a domain explicitly. The exclusive hostname claim is released
-- in the same transaction, so another project can prove it afresh.
create or replace function public.remove_site_domain(target_domain_id text, actor_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_domain domains;
begin
  select domain.* into target_domain
    from domains domain
    join sites site on site.id = domain.site_id
    where domain.id = target_domain_id and site.owner_user_id::text = actor_id
    for update of domain;
  if target_domain.id is null then return false; end if;
  delete from active_domains where domain_id = target_domain.id;
  delete from domains where id = target_domain.id;
  return true;
end;
$$;

revoke all on function public.remove_site_domain(text, text) from public, anon, authenticated;
grant execute on function public.remove_site_domain(text, text) to service_role;
