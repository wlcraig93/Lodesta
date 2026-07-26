# Production release

The GitHub Actions `Production release` workflow is the sole owner of Lodesta controller and site-sandbox production deployments. It always verifies the compatible Cloudflare sandbox before uploading the exact checked-out Git commit to Railway. Database migrations and irreversible schema cutovers remain separate operator actions.

Continuous integration runs the named `verify:static`, `verify:browser`, and
`verify:sandbox` stages independently, retains non-blocking dependency-audit
JSON, and keeps the real Wrangler container dry run separate. The production
workflow reuses the static and sandbox stages; browser verification and the
model-spending owner journey must already have passed before the release
candidate is pushed.

Before pushing controller code that depends on a forward migration, inspect the
target Supabase migration ledger, apply only the unapplied reviewed migrations
in repository order, and run `LODESTA_VERIFY_LIVE_DATABASE=true npm run
verify:database`. After applying them, set the operator-only
`LODESTA_CUTOVER_DATABASE_URL` and run `npm run verify:database-live --
--environment=nonproduction` or `--environment=production`. This command
requires the remote ledger to equal the repository sequence, runs the live
schema and browser-role checks, and emits a non-secret migration-set hash for
the release evidence. Never replay the canonical baseline over an existing
schema.

## One-time configuration

Create a GitHub environment named `production` and limit deployment branches to `main`. Keep William as the required reviewer through the first coordinated production cutover and successful rollback drill. After both are verified, remove the required reviewer; successful `main` CI then becomes the automatic release gate. The separately dispatched rollback workflow remains an explicit operator action.

Configure these environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `LODESTA_SANDBOX_TOKEN`
- `RAILWAY_TOKEN` (a project-scoped token)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LODESTA_ADMIN_TOKEN`

Configure these environment variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `LODESTA_SANDBOX_URL`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_SERVICE_ID`
- `LODESTA_APP_ORIGIN`

In the Railway service settings, disable GitHub autodeploy while retaining the repository source. A push to `main` must not create a Railway deployment directly. The post-CI workflow uses `railway up --ci` with explicit project, environment, and service IDs, so its archive always comes from the CI-verified checkout rather than whichever repository commit is newest when Railway starts.

## Release

1. Merge the intended release commit to `main`.
2. `Continuous integration` verifies that exact commit. A successful main-branch run automatically starts `Production release`; a failed or cancelled CI run cannot deploy.
3. The release workflow records the CI head SHA, runs its production preflight, captures the active Cloudflare and Railway deployment IDs, and compares the live sandbox manifest with the release manifest.
4. If the manifests match, it reuses Cloudflare without taking maintenance. If they differ, it acquires a 90-minute draining maintenance lease, waits up to 75 minutes for running API and external executions, renews the lease, and then deploys Cloudflare with strict conflict detection, an immediate container rollout, and the release SHA as its version tag and message.
5. The deployed-sandbox canary bootstraps a synthetic workspace, applies known source, compiles it, reads the artifact, checks the compiler manifest, and destroys the session.
6. The actual Cloudflare image digest and release SHA are set on Railway without triggering an independent deployment. `railway up --ci` then uploads the same checkout.
7. The workflow polls the Railway deployment, requires authenticated deep health, releases maintenance when it was acquired, and uploads non-secret evidence for 90 days.

App-only releases therefore do not pause authoring or rebuild sandbox containers. A sandbox rollout occurs only when the deterministic Docker context, Worker bridge, production Wrangler config, dependency lockfile, or canonical scaffold/toolchain inputs change.

Queued and owner-input API runs are not runtime-pinned and continue on the new sandbox after maintenance. Immutable external-authoring bundles remain pinned; if accessed after an incompatible release, they fail as `platform_version_mismatch` without replaying or rewriting retained work.

The public `/api/health` endpoint remains shallow liveness. Authenticated `/api/health?deep=1` is readiness and returns `503` when the live sandbox health is unavailable, malformed, timed out, or reports a different compatibility manifest.

## Failure and rollback

If Cloudflare deployment, its compile canary, or a conclusively pre-switch Railway build fails, the release workflow restores the captured Cloudflare version, reruns the previous-manifest compile canary and controller deep health, and only then releases maintenance.

If Railway has switched or its state is ambiguous, the workflow does not guess. Maintenance remains active. Explicitly dispatch `Production rollback` with the previous Git SHA, Cloudflare version ID, sandbox image digest, and maintenance lease owner from the failed release artifact. It redeploys the exact prior source to Railway, restores the prior Cloudflare version, verifies the compile canary and deep health, and releases maintenance.

Do not manually replay failed website runs or add compatibility fallbacks. Failed run records are immutable; resolve only their operator-review items after the restored production pair passes deep health.
