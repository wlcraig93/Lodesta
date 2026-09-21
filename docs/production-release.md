# Production release

The GitHub Actions `Production release` workflow deploys the Railway web service and authoring worker from the same commit. Website builds run in a Railway sandbox created for that session. Cloudflare still hosts R2, the artifact broker, the recovery watchdog, and custom domains.

Database migrations remain reviewed operator actions. Before controller code that depends on a migration is released, apply only the unapplied forward migrations in order and run `npm run verify:database-live -- --environment=production`. Never replay the baseline.

The replayable source-mirror cutover is a pre-launch hard cutover. Before applying `202608010002_replayable_source_mirror.sql`, acquire draining maintenance, run `npm run maintenance:reset-prelaunch-site-authoring`, review its retained inventory and hash, and apply the exact reported confirmation. The reset must leave the retired source-object and chunk tables empty; the migration then replaces them with immutable resource/page manifests and removes pgvector. Run the stored-data report, live database verification, and blob audit after the migration. Existing website projects are recreated from their source URL rather than read through a compatibility path.

After cutover, website capture is a separate pre-authoring preparation step and runs again only on an explicit admin recapture. It makes no model call, has its own deadline, and must produce a complete retained snapshot before the authoring deadline starts. Subsequent authoring attempts and alternative prompts reuse that immutable snapshot instead of crawling again. Admins can inspect the full terminal page/resource manifest and use the authenticated offline replay; owners and public visitors cannot access the replay surface.

Apply `202608040005_incremental_source_snapshot_readiness.sql` before releasing the controller that calls the incremental snapshot functions. The migration requires the retired staging tables to be empty, replaces the single large finalization transaction with bounded canonical resource/page writes, and keeps a snapshot hidden from repository readers until its manifest is complete. Run live database verification immediately afterward.

Apply `202609100001_atomic_prepared_source_input_finalization.sql` under an owned draining maintenance lease after running authoring reaches zero, before deploying its controller. Compare the live finalizer and migration ledger with the reviewed predecessor; apply the forward migration and ledger entry in one transaction, then verify the new function and service-role-only privileges. It replaces the old finalizer signature with one canonical function whose optional `prepared_input_document` binds newly retained research without adopting discarded media. It does not rewrite retained inputs or artifacts. Existing named-argument calls omit this optional value; do not retain a second finalizer overload or a fallback dispatch. Keep database migration evidence separate from fresh-site quality acceptance.

## One-time configuration

Configure the production environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `RAILWAY_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LODESTA_ADMIN_TOKEN`
- `LODESTA_MAINTENANCE_LEASE_OWNER`

Configure the production environment variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_WEB_SERVICE_ID`
- `RAILWAY_WORKER_SERVICE_ID`
- `LODESTA_APP_ORIGIN`

The Cloudflare token must be able to read the account and the R2 buckets used by the artifact broker. The workflow proves Worker identity and R2 access before release work starts. Railway GitHub autodeploy is disabled for both services. The web service uses `railway.toml`; the worker service uses `railway.worker.toml` as its Railway config path. GitHub Actions is the only authority that uploads either CI-verified checkout. It submits with `railway up --detach --json`, then treats the existing explicit deployment-status and release-identity polling—not Railway's best-effort build-log stream—as the acceptance gate. Both services are polled inside one aggregate bound; a short Railway control-plane timeout is retained as evidence and retried, while an explicit failed, crashed, or cancelled deployment still fails immediately.

Railway service variables use `LODESTA_EXECUTION_ROLE=web` for web and `LODESTA_EXECUTION_ROLE=site-authoring-worker` for the runner. Release and rollback steps use `LODESTA_EXECUTION_ROLE=release`. Each hosted identity also requires `NODE_ENV=production`, the exact full `LODESTA_RELEASE_GIT_SHA`, and a non-loopback HTTPS `LODESTA_APP_ORIGIN`; no role grants authority by itself.

The Railway web health check uses the canonical `/api/health/` path. The slash is significant because the application enforces trailing-slash URLs and Railway treats the resulting `308` from `/api/health` as an unhealthy response rather than following it.

## Normal release

1. CI verifies the exact `main` commit. Automatic release admission requires a successful originating `push` on `main` from this repository; a pull-request run whose branch happens to be named `main` is not trusted release provenance. Automatic releases reuse that exact CI success rather than repeating the full local preflight. A manual main-branch dispatch still runs full preflight. Both paths unconditionally verify checkout SHA, execution authority, both controller identities, and final health.
2. The workflow records the current Railway deployment identities, then acquires a 90-minute draining database maintenance lease. The claim functions enforce this fence inside Postgres. The workflow waits at most 30 minutes for running authoring to reach zero. A timeout records `authoring_drain_timeout`, releases the lease, and does not deploy.
3. Web and worker are deployed from the same release SHA. Web must return that exact SHA from authenticated identity health, and the runner must emit it in its structured `worker_started` event. Deep health runs after both identities match, then maintenance is released.

The accepted prelaunch consequence is a bounded authoring blackout between lease acquisition and release. New claims are rejected by the database fence during that interval.

Authenticated `/api/health?deep=1` checks repository and browser readiness. It does not call a sandbox. Completed previews and public sites are artifact-backed.

## Rollback

For an operator rollback, dispatch `Production rollback` with the prior Git SHA. The workflow renews an already-owned lease or acquires one, waits at most 30 minutes for drain, deploys both Railway services from the target checkout, verifies both report the target SHA, runs deep health, and releases maintenance. Failure leaves maintenance active and uploads evidence for operator intervention.

The rollback workflow rejects commits that lack `railway.worker.toml` before acquiring maintenance.

