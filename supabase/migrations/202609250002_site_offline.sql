-- Owners can take a published site offline and put it back without a new
-- build. 'offline' keeps published_version_id, so going back online serves
-- the exact version that was live. Publishing a new version also brings the
-- site back online. 'paused' keeps its meaning: the owner disposed of the site.
alter table public.sites drop constraint sites_status_check;
alter table public.sites add constraint sites_status_check
  check (status in ('draft', 'active', 'offline', 'paused'));

create or replace function public.set_site_online(target_site_id text, actor_id text, target_online boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site sites;
begin
  select * into target_site from sites
    where id = target_site_id and owner_user_id::text = actor_id
    for update;
  if target_site.id is null then raise exception 'site_owner_required'; end if;
  if target_site.published_version_id is null or target_site.status not in ('active', 'offline') then
    raise exception 'site_not_published';
  end if;
  if target_online and target_site.status = 'offline' then
    if not exists (
      select 1 from site_versions
      where id = target_site.published_version_id and site_id = target_site.id and status = 'published'
    ) then
      raise exception 'published_version_unavailable';
    end if;
    update sites set status = 'active', updated_at = now() where id = target_site.id;
  elsif not target_online and target_site.status = 'active' then
    update sites set status = 'offline', updated_at = now() where id = target_site.id;
  end if;
  return jsonb_build_object(
    'siteId', target_site.id,
    'status', case when target_online then 'active' else 'offline' end,
    'publishedVersionId', target_site.published_version_id
  );
end;
$$;

revoke all on function public.set_site_online(text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_site_online(text, text, boolean) to service_role;
