# Pilot operations runbook

For the internal pilot: five Lodesta-built sites, no outreach, Lodesta staff acting as owners. It covers what alerts mean and the exact recovery actions. Deploys and code rollback are in `docs/production-release.md`.

## Who is alerted, and how

| Signal | Recipient | Source |
| --- | --- | --- |
| New inquiry | The site owner's account sign-in email | `owner_notifications` kind `lead` |
| Change ready, needs an answer, didn't finish | The site owner's account sign-in email | kinds `run_ready`, `run_needs_input`, `run_failed` |
| Live domain stopped pointing to Lodesta for 24 hours | The site owner's account sign-in email | kind `domain_attention` |
| Site or form failing two checks in a row | `LODESTA_OPERATOR_ALERT_EMAIL` | kinds `site_unreachable`, `form_unreachable` |
| Run failed and the owner can't retry | `LODESTA_OPERATOR_ALERT_EMAIL` | kind `run_failed`, audience `operator` |

Email never goes to a business contact or scraped address. A site without an owner produces no email. Synthetic monitor inquiries are recorded and suppressed.

A notification that fails five times ends as `failed` and logs `owner_notification_failed`. Find them with:

```sql
select id, site_id, kind, attempts, last_error, created_at
from owner_notifications where status = 'failed' order by created_at desc;
```

The inquiry itself is always in the owner's inbox; a failed email never loses a lead.

## Monitoring

The worker probes each published site every 5 minutes and each site's forms every 15 minutes. Recent results appear on the admin site page (`/admin/sites/<slug>`, Monitoring panel) and in `site_monitor_checks`.

- **Site failing:** open the admin site page and read the check detail. Common causes are a failed deploy (roll back with `docs/production-release.md`), an R2 or database outage (check `/api/health?deep=1`), or an expired certificate on a custom domain.
- **Form failing:** the published version no longer references the site's form, or the synthetic inquiry on `LODESTA_MONITOR_SYNTHETIC_SITE_ID` was rejected. Submit the form by hand on the site; if it fails, roll back the last deploy.

## Owner-facing recovery actions

| Situation | Action |
| --- | --- |
| A live site must come down now | Site settings → Visibility → Take site offline. Visitors see a 503 "temporarily unavailable" page within about 5 minutes, as cached pages expire. The same version returns with "Put site back online", again within about 5 minutes. |
| A bad edit was published | Take the site offline, then ask for the fix in the chat and publish the new version. Reverting to an older version is not yet available. |
| A domain must stop serving | Site settings → Domain → Remove domain. The hostname claim is released at once; resolution caches expire within a minute. |
| A claim link was sent to the wrong person | Admin site page → Claim link → Revoke open links. A new link also replaces earlier ones. |
| A claim went to the wrong account | Not self-serve. Record the case and transfer ownership with a reviewed database change; never reuse the claim link. |

## Restore drill (required before the pilot, then quarterly)

Goal: prove we can recover the database and published artifacts after data loss.

1. In an isolated Supabase project, restore the latest production backup (Supabase point-in-time recovery or a `pg_dump` taken for the drill).
2. Verify `sites`, `site_versions`, `site_build_artifacts`, `inquiries` and `owner_notifications` row counts match the source at the backup time.
3. For three published versions, read each artifact's files from R2 by their content-addressed keys and verify every file hash in the artifact manifest. Artifact storage is immutable, so a database restore never needs artifact rewrites.
4. Point a local build at the restored project and load one published site's `/sites/<slug>`; it must render with the published version header.
5. Record the date, backup timestamp, durations and any gaps in `docs/reviews/`.

The drill never writes to the production project.

**What this drill does not prove.** It restores the database and reads artifact files that still exist in R2. It proves recovery from database loss with storage intact, not recovery from lost or deleted artifact storage: R2 objects are write-once but have no independent copy today. Losing the bucket would lose published sites' bytes. Before the external pilot, either enable an independent copy of the artifact bucket and include restoring from it in this drill, or record the accepted risk.

## Pilot metrics

Weekly, from the database:

```sql
-- Builds and edits completed, and failures
select kind, status, count(*) from site_agent_runs where started_at > now() - interval '7 days' group by 1, 2;
-- Publishes
select count(*) from site_versions where published_at > now() - interval '7 days';
-- Leads saved and lead emails delivered
select count(*) from inquiries where created_at > now() - interval '7 days';
select status, count(*) from owner_notifications where kind = 'lead' and created_at > now() - interval '7 days' group by 1;
-- Monitor failures
select site_id, kind, count(*) from site_monitor_checks where not ok and checked_at > now() - interval '7 days' group by 1, 2;
```

Operator interventions (manual database changes, reruns, support replies) are logged by hand in the pilot notes, one line each.
