# Production release

The GitHub Actions `Production release` workflow owns controller and Cloudflare sandbox releases. Production has exactly two physical sandbox slots, blue and green. Immutable deployment records retain unlimited release history; the singleton database pointer decides which registered deployment receives new claims.

Database migrations remain reviewed operator actions. Before controller code that depends on a migration is released, apply only the unapplied forward migrations in order and run `npm run verify:database-live -- --environment=production`. Never replay the baseline.

The replayable source-mirror cutover is a pre-launch hard cutover. Before applying `202608010002_replayable_source_mirror.sql`, acquire draining maintenance, run `npm run maintenance:reset-prelaunch-site-authoring`, review its retained inventory and hash, and apply the exact reported confirmation. The reset must leave the retired source-object and chunk tables empty; the migration then replaces them with immutable resource/page manifests and removes pgvector. Run the stored-data report, live database verification, and blob audit after the migration. Existing website projects are recreated from their source URL rather than read through a compatibility path.

After cutover, website capture is a separate pre-authoring preparation step and runs again only on an explicit admin recapture. It makes no model call, has its own deadline, and must produce a complete retained snapshot before the authoring deadline starts. Subsequent authoring attempts and alternative prompts reuse that immutable snapshot instead of crawling again. Admins can inspect the full terminal page/resource manifest and use the authenticated offline replay; owners and public visitors cannot access the replay surface.

Apply `202608040005_incremental_source_snapshot_readiness.sql` before releasing the controller that calls the incremental snapshot functions. The migration requires the retired staging tables to be empty, replaces the single large finalization transaction with bounded canonical resource/page writes, and keeps a snapshot hidden from repository readers until its manifest is complete. Run live database verification immediately afterward.

## One-time configuration

Configure the production environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `LODESTA_SANDBOX_BLUE_TOKEN`
- `LODESTA_SANDBOX_GREEN_TOKEN`
- `RAILWAY_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LODESTA_ADMIN_TOKEN`

Configure the production environment variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `LODESTA_SANDBOX_BLUE_URL`
- `LODESTA_SANDBOX_GREEN_URL`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_SERVICE_ID`
- `LODESTA_APP_ORIGIN`

Blue, green, and development must use distinct Worker URLs and credentials. Railway GitHub autodeploy remains disabled; the release workflow uploads the CI-verified checkout with `railway up --ci`.

## One-time blue-green cutover

This cutover is coordinated maintenance because the legacy controller knows only one sandbox address.

1. Point the new blue URL and token at the verified current production sandbox.
2. Acquire draining maintenance and wait for running authoring to finish:

   ```sh
   npm run maintenance:site-authoring -- acquire --minutes=90 --draining
   npm run maintenance:site-authoring -- wait-active --timeout-minutes=75
   ```

3. Apply `202607310003_minimal_blue_green_sandboxes.sql` and run live migration verification.
4. Review and explicitly cancel legacy pauses that do not have durable checkpoints:

   ```sh
   npm run maintenance:cutover-blue-green-sandbox -- report
   npm run maintenance:cutover-blue-green-sandbox -- apply --confirm=<reviewed-confirmation>
   ```

5. Deploy the checkpoint-aware sandbox to blue while the platform remains drained, then run the deployed backup/restore and compilation canary. The blue Wrangler configuration intentionally retains the existing production Worker name, so this upgrades the verified current sandbox instead of changing its URL.
6. Register that exact blue deployment as active using the Worker version and image digest captured from the deployment evidence:

   ```sh
   npm run sandbox:deployments -- register --initialize --slot blue \
     --worker-version <worker-version> --release-sha <40-character-sha> \
     --image-digest <sha256:image-digest>
   ```

7. Deploy the checkpoint-aware dual-slot controller, require deep health, and release maintenance.
8. Configure and deploy green, canary it, register it as the inactive slot, and perform the first normal promotion.

The stored-data report and confirmation make legacy cancellation explicit. The migration performs no site-authoring reset.

## Normal release

1. CI verifies the exact `main` commit.
2. The release reads the singleton pointer, selects the inactive slot, and calls `assert-slot-available`. A slot with a running execution pin or live sandbox session cannot be reused. There is no third slot fallback.
3. The candidate is deployed directly to the inactive Worker. Its health, source policy, compilation, backup, restore, and exact manifest are canaried.
4. An immutable deployment record is inserted and the inactive slot pointer is updated.
5. The controller capable of addressing both slots is deployed to Railway. Deep health still checks the currently active deployment.
6. Promotion atomically switches the active pointer. The promotion and run claim functions share the `site-sandbox-control` advisory lock, so every new execution receives one unambiguous deployment pin.
7. Old executions finish on their pinned deployment. Paused sandboxes remain warm for five minutes; after teardown, their immutable checkpoints restore into whichever deployment is active when the answered run is claimed.

Normal releases do not acquire maintenance and do not interrupt authoring. Toolchain and image identities may change. HTTP API, artifact, source-policy, storage, and Durable Object identities must remain compatible; changing one of those contracts requires intentionally coordinated maintenance.

Development follows the same pinning rule. A checkout or development-Wrangler change makes the active deployment stale for the next development preflight, which deploys and promotes the inactive slot. It does not invalidate requests already pinned to the immutable active deployment. Restart `npm run dev` before expecting sandbox source changes to affect new runs; old executions continue on their pinned slot until they drain.

Authenticated `/api/health?deep=1` checks only the active deployment and returns `503` when it is unhealthy or its registered manifest does not match. An unhealthy draining deployment creates recovery work but does not make the controller globally unready. Completed previews and public sites are artifact-backed and do not call either sandbox.

## Rollback

If an inactive candidate fails, it is never promoted. If post-promotion health fails, the release workflow atomically restores the prior active pointer. The rollback function fences executions pinned to the failed deployment by advancing their execution number, requeues the same logical runs, expires affected live sessions for recovery, and marks their model continuation stale. Claim-time source compatibility decides whether to restore a current checkpoint or restart from the latest finalized source.

For an operator rollback, dispatch `Production rollback` with the retained sandbox deployment ID and prior Git SHA. Never move a running execution between deployments in place, manually replay runs, or add a compatibility fallback.
