-- One-time pre-launch authority reclassification for the Site V3 hard cutover.
-- The function remains strict: only an unpublished, unclaimed draft with no
-- owner-facing footprint may become experimental, under the maintenance lease.

create function reclassify_prelaunch_draft_site_for_v3_cutover_v1(
  target_run_id text,
  target_site_id text,
  target_business_id text,
  confirmation_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target sites%rowtype;
  active_run_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('site_v3_prelaunch_reclassification_v1'));

  if confirmation_token <> 'reclassify-prelaunch-draft:' || target_run_id || ':' || target_site_id || ':' || target_business_id then
    raise exception 'site V3 pre-launch reclassification confirmation does not match the exact target';
  end if;
  if not exists (
    select 1 from site_agent_maintenance_leases_v1
    where task = 'workspace_storage_cutover' and lease_until > now()
  ) then
    raise exception 'site V3 pre-launch reclassification requires the active maintenance lease';
  end if;
  select count(*) into active_run_count
  from site_agent_runs_v2
  where status in ('queued', 'running');
  if active_run_count <> 0 then
    raise exception 'site V3 pre-launch reclassification requires zero queued or running runs';
  end if;

  select * into target
  from sites
  where id = target_site_id
  for update;
  if target.id is null
    or target.business_id <> target_business_id
    or target.status <> 'draft'
    or target.workspace_id is not null
    or target.published_version_id is not null
  then
    raise exception 'site V3 pre-launch reclassification requires the exact unclaimed unpublished draft';
  end if;
  if exists (select 1 from domains where site_id = target_site_id)
    or exists (select 1 from claims where site_id = target_site_id)
    or exists (select 1 from inquiries where site_id = target_site_id)
    or exists (select 1 from preview_tokens where site_id = target_site_id)
    or exists (select 1 from site_versions_v4 where site_id = target_site_id and status = 'published')
  then
    raise exception 'site V3 pre-launch reclassification found an owner-facing or published footprint';
  end if;

  update sites
  set status = 'experimental', updated_at = now()
  where id = target_site_id and status = 'draft';
  if not found then
    raise exception 'site V3 pre-launch reclassification lost its conditional update race';
  end if;

  return jsonb_build_object(
    'ok', true,
    'runId', target_run_id,
    'siteId', target_site_id,
    'businessId', target_business_id,
    'fromStatus', 'draft',
    'toStatus', 'experimental',
    'reclassifiedAt', now()
  );
end;
$$;

revoke all on function reclassify_prelaunch_draft_site_for_v3_cutover_v1(text, text, text, text) from public;
grant execute on function reclassify_prelaunch_draft_site_for_v3_cutover_v1(text, text, text, text) to service_role;
