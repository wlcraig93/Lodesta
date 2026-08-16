# Authoring infrastructure hardening record

Date: 2026-08-16
Status: implementation verification in progress; hosted release and bake-off pending

## Branch cleanup

The active local `main` branch was repointed to recipe-materialization commit `e613d34f`. At the start of this work, `origin/main` was its direct parent at `06c51f2a`, so the intended remote update remains a fast-forward.

Accidental local commit `385976445dc19ccc903de50b07b938441d80fbcc` was reviewed as generated experiment output and Wrangler state rather than canonical product source. Its local branch reference was removed; it was never merged into the active history or pushed as the go-forward branch. The generated files are intentionally discarded. Historical decision records that cite the commit as experiment provenance remain unchanged.

`develop` is retained only until the exact coordinated release succeeds. After that release, local and remote `develop` are deleted and `main` is the sole active branch.

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

The canonical runtime candidate remains unpromoted. After the hardened release is healthy, the first fresh Kind treatment is the stop/go gate. Surge runs only if Kind has no material authoring or infrastructure failure. Existing inputs are not repointed until both corrected comparisons are recorded and the broader reliability screen is explicitly resumed.
