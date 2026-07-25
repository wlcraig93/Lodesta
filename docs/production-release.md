# Production release

The GitHub Actions `Production release` workflow is the sole owner of Lodesta controller and site-sandbox production deployments. It always verifies the compatible Cloudflare sandbox before uploading the exact checked-out Git commit to Railway. Database migrations and irreversible schema cutovers remain separate operator actions.

## One-time configuration

Create a GitHub environment named `production` and limit deployment branches to `main`. Do not add a required reviewer to the normal release environment: the successful `main` CI run is the release gate. The separately dispatched rollback workflow remains an explicit operator action.

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
3. The release workflow records the CI head SHA, runs its production preflight, captures the active Cloudflare and Railway deployment IDs, and acquires a 60-minute site-authoring maintenance lease.
4. The workflow compares the live sandbox manifest with the release manifest. If they match, it reuses the existing Cloudflare deployment and image digest. If they differ, it deploys Cloudflare with strict conflict detection, an immediate container rollout, and the release SHA as its version tag and message.
5. The deployed-sandbox canary bootstraps a synthetic workspace, applies known source, compiles it, reads the artifact, checks the compiler manifest, and destroys the session.
6. The actual Cloudflare image digest and release SHA are set on Railway without triggering an independent deployment. `railway up --ci` then uploads the same checkout.
7. The workflow polls the Railway deployment, requires authenticated deep health, releases maintenance, and uploads non-secret evidence for 90 days.

App-only releases therefore do not rebuild or replace sandbox containers. A sandbox rollout occurs only when its deterministic Dockerfile, dependency lockfile, or canonical scaffold/toolchain inputs change.

The public `/api/health` endpoint remains shallow liveness. Authenticated `/api/health?deep=1` is readiness and returns `503` when the live sandbox health is unavailable, malformed, timed out, or reports a different compatibility manifest.

## Failure and rollback

If Cloudflare deployment, its compile canary, or a conclusively pre-switch Railway build fails, the release workflow restores the captured Cloudflare version, reruns the previous-manifest compile canary and controller deep health, and only then releases maintenance.

If Railway has switched or its state is ambiguous, the workflow does not guess. Maintenance remains active. Explicitly dispatch `Production rollback` with the previous Git SHA, Cloudflare version ID, sandbox image digest, and maintenance lease owner from the failed release artifact. It redeploys the exact prior source to Railway, restores the prior Cloudflare version, verifies the compile canary and deep health, and releases maintenance.

Do not manually replay failed website runs or add compatibility fallbacks. Failed run records are immutable; resolve only their operator-review items after the restored production pair passes deep health.
