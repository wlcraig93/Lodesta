# Authoring infrastructure hardening record

Date: 2026-08-17
Status: hosted hardening released and verified; current product bake-off paused after Kind

## Branch cleanup

The active local `main` branch was repointed to recipe-materialization commit `e613d34f`. At the start of this work, `origin/main` was its direct parent at `06c51f2a`, so the intended remote update remains a fast-forward.

Accidental local commit `385976445dc19ccc903de50b07b938441d80fbcc` was reviewed as generated experiment output and Wrangler state rather than canonical product source. Its local branch reference was removed; it was never merged into the active history or pushed as the go-forward branch. The generated files are intentionally discarded. Historical decision records that cite the commit as experiment provenance remain unchanged.

The coordinated release succeeded. Local and remote `develop` were deleted, and `main` is the sole active branch.

The first coordinated release also bootstraps the separately deployed worker service. Its evidence records the absence of a prior worker deployment explicitly rather than inventing one. Deliberate two-service rollback is accepted only for retained releases that contain `railway.worker.toml`; a pre-split target fails validation before maintenance is acquired. After this clean cut, every eligible rollback target has both controller manifests and both retained identities.

## Canonical operational boundary

- Local development commands force the local file repository and clear hosted execution identity.
- Hosted execution is default-deny and requires production mode, an exact release SHA, a non-loopback HTTPS application origin, and one explicit role.
- The Railway web service cannot claim authoring work or mutate sandbox control.
- The Railway authoring worker is the sole normal hosted queue consumer and cannot mutate sandbox control.
- The recovery watchdog reaps and repairs stale work but never claims healthy queued work or processes website assessments.
- Release and rollback workflows are the only sandbox-control authorities and coordinate web, worker, and sandbox promotion through the Postgres maintenance fence.
- The first three runtime series remain renderable only because retained immutable artifacts reference them; new authoring has one canonical candidate, `site-runtime-v4`.

## Evidence and remaining gates

The retained-data inventory is recorded in `docs/decisions/2026-08-15-managed-capabilities-editable-recipes.md`. Code verification must pass before hosted changes. Hosted release additionally requires a correctly scoped Cloudflare credential, two separately configured Railway services, exact release-identity reporting, and release evidence showing the maintenance lifecycle and sandbox pointer transition.

The hardened release completed at exact SHA `f35fcbd5bd172a9d3ed8ea84afb8bc91215730c3`. CI run `32046486439` and coordinated release run `32046853300` passed. Web and worker reported the same SHA before sandbox promotion; the green sandbox deployment `sandbox_deployment_a22339bcc8d459db43125cd29ae1837e` was promoted; authenticated deep health passed; and maintenance was released.

The first fresh Kind treatment, `run_b40b340df360410da0a3cc6cbc7a297f`, succeeded through the ordinary hosted worker and hard release gate. Three separate sandbox applies succeeded across multi-minute browser-inspection gaps with no timeout, replay, or recycle. This validates the infrastructure correction: interactive authoring sandboxes now use `keepAlive: true` and are explicitly destroyed, rather than sleeping while external browser inspection is still part of the same logical session.

The current product bake-off remains paused. Kind required three inspections and multiple source repairs, used a non-matched Sol author route, cost $3.25439530, and did not clearly beat the retained R8 visual. Under the predeclared adaptive rule, Surge was not started. Existing inputs remain unchanged; the next comparison must be a matched Luna/frozen-architecture Kind run before the broader reliability screen can resume.
