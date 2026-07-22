# Cloudflare Sandbox And R2 Cutover Runbook

This runbook moves Lodesta from the combined sandbox/R2 Worker to the cost-bounded build-only architecture. The maintenance window begins before the workspace copy and remains quiesced until the new broker, sandbox Worker, Railway variables, post-cutover audit, and Mencia acceptance checks all pass.

## Permanent Boundaries

- Railway/Next.js serves candidate, share-preview, published, and custom-domain traffic from immutable artifact bytes. Customer traffic never starts a container.
- `lodesta-artifact-broker-v1` binds only `lodesta-agentic-sites-v1` and exposes authenticated exact-object `PUT`, `GET`, and `HEAD`.
- `lodesta-site-sandbox-v1` binds only `lodesta-workspace-backups-v1`. It starts a container at the first `build_preview`, starts Vite only for an authenticated live-preview request, and explicitly destroys the container on terminal success/failure.
- R2 inventory, migration, and deletion use direct S3 credentials available only in the operator environment. Lifecycle rules use the operator's authenticated Wrangler session so the object credentials remain bucket-scoped. Do not put either form of operator authority on Railway or either Worker.
- `WorkspaceSourceSidecarV1` objects live at `workspace-sources/:backupId.json` in the artifact bucket. They are immutable, protected references for retained revisions, and are used for discussion without a sandbox.

## One-Time Credentials And Bucket

1. Create `lodesta-workspace-backups-v1` if it does not already exist.
2. Create a read/list audit credential and a separate read/list/write/delete maintenance credential scoped only to the two Lodesta buckets.
3. Configure the private operator environment variables documented in `.env.example`. Never paste their values into logs, source, shell history, Railway, or Worker variables.
4. Create distinct random bearer tokens for `SANDBOX_TOKEN` and `ARTIFACT_BROKER_TOKEN`. The Railway variables must match the corresponding Worker secret and must not share a value.

## Preflight

```bash
npm run typecheck
npm run verify:agentic-architecture
npm run verify:artifact-storage-boundaries
npm run verify:r2-maintenance-access
npm run verify:agentic-site-platform-v1
npm run verify:render-browser
npm run audit:artifact-blobs
```

The pre-cutover v1 baseline is retained locally under `.data/maintenance`. Do not run an orphan deletion during this cutover.

## Quiesced Cutover

Drain queued/running site-agent work, then acquire the durable lease:

```bash
npm run maintenance:workspace-cutover -- acquire --minutes=30
npm run maintenance:workspace-cutover -- status
```

The database trigger blocks enqueue and the atomic claim function blocks claims while this lease is active. Renew it before ten minutes remain and abort immediately if renewal fails:

```bash
npm run maintenance:workspace-cutover -- renew --minutes=30
```

Copy every retained archive, verify both locations, extract and verify every source sidecar, and create the immutable overlap manifest:

```bash
npm run migrate:workspace-blobs
```

Deploy the exact-object broker first and configure its distinct secret. Put the new sandbox secret before deploying the sandbox Worker: the old Worker ignores that secret, while the new Worker requires it immediately on cutover.

```bash
npm run deploy:artifact-broker
npx wrangler secret put ARTIFACT_BROKER_TOKEN --config workers/artifact-broker/wrangler.jsonc
npx wrangler secret put SANDBOX_TOKEN --config workers/site-sandbox/wrangler.jsonc
npm run deploy:site-sandbox
```

When Wrangler uses Colima and its default Docker credential configuration refers to the absent Docker Desktop helper, use a private Docker config without credential helpers:

```bash
DOCKER_HOST=unix:///absolute/path/to/.colima/default/docker.sock \
DOCKER_CONFIG=/absolute/path/to/Lodesta/.data/maintenance/docker-config \
npm run deploy:site-sandbox
```

Configure Railway with `LODESTA_ARTIFACT_STORAGE=r2`, `LODESTA_ARTIFACT_BROKER_URL`, `LODESTA_ARTIFACT_BROKER_TOKEN`, `LODESTA_SANDBOX_URL`, `LODESTA_SANDBOX_TOKEN`, `LODESTA_ADMIN_TOKEN`, `LODESTA_HASH_SECRET`, `LODESTA_CLAIM_CHALLENGE_SECRET`, and the canonical `LODESTA_APP_ORIGIN`; remove the retired `LODESTA_R2_BRIDGE_*` variables. The three application secrets must be distinct strong random values. Never configure operator R2 credentials on Railway.

Railpack must install Chromium's runtime libraries into the deploy image, not only its build layer. Set `RAILPACK_DEPLOY_APT_PACKAGES` to:

```text
fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libegl1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libxshmfence1
```

Deploy the application from the verified release. Production recovery runs in the web service and is triggered by the separate stateless watchdog described below; there is no persistent Railway polling worker.

While the lease is still active, run:

```bash
npm run verify:supabase
npm run verify:site-sandbox-v1
npm run audit:artifact-blobs
npm run audit:sandbox-cost
npm run smoke
```

The overlap audit must pass while both archive copies exist. For each retained revision it must report the workspace archive and artifact source sidecar as referenced, and manifest-declared artifact/workspace duplicates must match by byte count and SHA-256.

The sandbox cost report uses recorded start-to-destroy wall time as a conservative upper bound. Cloudflare may stop billing earlier when the ten-minute sleep safety net activates; the report never assumes that unobserved sleep time is billable truth.

Revalidate the existing Mencia homepage and a nested service route. All `/_lodesta/assets/*` requests must return the expected image MIME type with nonzero natural dimensions, trusted-runtime resolution must succeed, and no `/_lodesta/*` request may fail. Confirm its version, artifact, asset, and rights records are unchanged.

Release only after every check passes:

```bash
npm run maintenance:workspace-cutover -- release
```

## Local Development Against Cloudflare

Local development uses the same deployed Cloudflare sandbox and artifact broker when `.env.local` contains the live `LODESTA_SANDBOX_*` and `LODESTA_ARTIFACT_BROKER_*` values and sets `LODESTA_ARTIFACT_STORAGE=r2`. Restart `npm run dev` after changing those values; Next.js and the local job worker read them at process startup.

The Lodesta control plane and editor remain on `http://127.0.0.1:4330`. Reading retained artifacts goes through the broker, while a container starts only when a site-agent run first requests `build_preview`. Merely opening the editor, candidate preview, published site, or custom-domain site does not start a sandbox.

## Recovery Watchdog

The production web service processes newly enqueued work through Next.js `after()`. A startup sweep and the `lodesta-recovery-watchdog-v1` Cron Trigger recover dropped work; the local polling worker is never deployed to Railway.

Before cutover, confirm no important run is active and pause the old Railway worker. Configure the same strong random `LODESTA_RECOVERY_WATCHDOG_TOKEN` on Railway and as a Cloudflare Worker secret, then set `LODESTA_RECOVERY_WATCHDOG_URL` on the Worker to the deployed `/api/site-agent/maintenance/` URL. Deploy only after local verification:

```bash
npx wrangler secret put LODESTA_RECOVERY_WATCHDOG_TOKEN --config workers/recovery-watchdog/wrangler.jsonc
npm run deploy:recovery-watchdog
```

Manually trigger the scheduled handler, require an authenticated `202`, and observe one successful fifteen-minute Cron event before removing the obsolete remote Railway worker service. Automatic production recovery uses a four-item batch and a conservative forty-five-minute stale threshold; local commands explicitly retain the fifteen-minute development threshold.

## Trace Lifecycle

Dry-run and review the full artifact-bucket lifecycle configuration before applying the exact report hash:

```bash
npm run configure:r2-lifecycle
npm run configure:r2-lifecycle -- --apply --confirm=set-r2-lifecycle:<reportHash>
```

The rule expires `trace-payloads/` after one day. The application never deletes those blobs. It clears the database payload reference only after `HEAD` observes absence and creates an operator finding when an object remains 48 hours beyond its recorded expiry.

## Seven-Day Rollback Cleanup

Keep the original artifact-bucket archive copies until `rollbackNotBefore` in `.data/maintenance/workspace-blob-cutover.json`. After that time, review the manifest and run only its exact confirmation:

```bash
npm run cleanup:workspace-rollback-copies -- --confirm=delete-old-workspace-blobs:<manifestHash>
npm run audit:artifact-blobs
```

The cleanup deletes only manifest-declared old artifact-bucket archive copies. It first rechecks database retention, workspace destinations, source sidecars, bytes, and hashes; then it verifies old copies are absent and retained objects remain. The cleanup marker makes later audits stop expecting the overlap set.

## Rollback

Before the seven-day cleanup, restore the previous Railway variables and previous sandbox Worker deployment, using the manifest-verified artifact-bucket archive copies. Do not delete or rewrite destination archives or sidecars. If the cutover lease is lost, an inventory changes, a retained blob is missing, copies mismatch, or any acceptance check fails, stop the cutover and retain both buckets for operator review.
