create index if not exists inquiries_owner_overview_idx
  on public.inquiries(site_id, status)
  where status in ('new', 'needs_reply');

create index if not exists site_operator_queue_owner_overview_idx
  on public.site_operator_queue(site_id, status)
  where status in ('open', 'in_review');

create or replace function public.owner_account_overview(target_owner_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'siteId', owned_site.id,
        'versions', coalesce((
          select jsonb_agg(
            version_row.version
              || jsonb_build_object('status', version_row.status)
              || jsonb_strip_nulls(jsonb_build_object(
                'publishedAt', version_row.published_at,
                'replacedVersionId', version_row.replaced_version_id,
                'staleReason', version_row.stale_reason
              ))
            order by version_row.version_number desc
          )
          from public.site_versions version_row
          where version_row.site_id = owned_site.id
        ), '[]'::jsonb),
        'runs', coalesce((
          select jsonb_agg(recent_run.run order by recent_run.started_at desc)
          from (
            select run_row.run, run_row.started_at
            from public.site_agent_runs run_row
            where run_row.site_id = owned_site.id
            order by run_row.started_at desc
            limit 8
          ) recent_run
        ), '[]'::jsonb),
        'replyInquiryCount', (
          select count(*)::integer
          from public.inquiries inquiry
          where inquiry.site_id = owned_site.id
            and inquiry.status in ('new', 'needs_reply')
        ),
        'domainAttention', exists (
          select 1
          from public.domains domain
          where domain.site_id = owned_site.id
            and domain.status = 'attention_required'
        ),
        'openQueueCount', (
          select count(*)::integer
          from public.site_operator_queue queue_item
          where queue_item.site_id = owned_site.id
            and queue_item.status in ('open', 'in_review')
        )
      )
      order by owned_site.created_at desc
    ),
    '[]'::jsonb
  )
  from public.sites owned_site
  where owned_site.owner_user_id = target_owner_user_id;
$$;

revoke all on function public.owner_account_overview(uuid) from public;
revoke all on function public.owner_account_overview(uuid) from anon;
revoke all on function public.owner_account_overview(uuid) from authenticated;
grant execute on function public.owner_account_overview(uuid) to service_role;
