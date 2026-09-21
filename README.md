# Lodesta

Lodesta is an AI-first managed website and local-presence platform for US small businesses. The product is pre-launch. Suitable local businesses can generate sites without a configured domain module; auto body currently has the only optional production context enrichment.

The current website system uses canonical business data, one website manager agent, shared Lodesta capabilities, isolated Railway sandboxes, immutable site artifacts, and Railway/Next.js serving. It does not use presentation templates, copy slots, a planner/compiler design system, or per-vertical generator branches.

The canonical architecture and implementation sequence are documented in [docs/product-path-simplification-plan.md](docs/product-path-simplification-plan.md).

## Architecture

- `packages/business-data`: complete website mirroring, regenerable page indexing, normalized business state, and public sandbox projection.
- `packages/acquisition`: Website Health Reports, outbound campaigns, prospects, adoption, and their worker.
- `packages/vertical-context`: non-executable auto-body context plus a test-only extensibility module.
- `packages/site-agent`: the single website-authoring agent, its tools, and knowledge skills.
- `packages/site-sandbox`: Railway sandbox client used to build and edit a site.
- `workers/site-sandbox`: the site compiler copied into each Railway sandbox.
- `workers/recovery-watchdog`: stateless fifteen-minute recovery trigger for the Railway web service.
- `packages/site-verification`: sanitizer, factual-claim validation, browser gate, contact sheets, and finalization.
- `packages/site-artifacts`: content-addressed local or R2 artifact storage.
- `packages/platform-data`: canonical repository contracts and Supabase implementation.
- `packages/site-platform`: sessions, runs, clarifications, immutable candidates, publishing, restore, and rollback.
- `packages/site-capabilities`: lead-inbox forms, analytics, maps, safe links, and capability policy.
- `packages/control-plane`: typed business-state and site-intent mutations.
- `packages/trusted-runtime`: audited runtime-series patching and rollback.

Public and authenticated previews serve the same finalized HTML/CSS bytes. Agent-authored code never runs in a visitor browser; public artifacts contain only static HTML/CSS and the platform-owned trusted runtime.

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:4330` by default. `npm run dev` starts Next.js and the authoring worker. Site builds run in a Railway sandbox created for that session.

`npm run dev:worker` is an explicit operator command that polls and mutates the shared queues and recovery state; normal development never starts it automatically. Production runs the Railway web service and the Railway authoring worker, with the scheduled Cloudflare recovery watchdog as the recovery trigger.

For read-only local UI inspection without a browser sign-in, use `npm run dev:inspect`. The inspection launcher accepts only a loopback `HOST`, disables Supabase browser auth and admin-token access for that process, and does not start the background worker. Admin and owner pages remain available in the existing `local_open` mode, while mutating API requests remain unauthorized. Use the normal signed-in development flow whenever testing authentication, ownership, creation, publishing, or another write path.

`npm run start` is the guarded local production-build launcher and clears hosted release provenance. Railway alone uses `npm run start:production` with the release workflow's exact SHA.

Important surfaces:

- `/admin/sites`: admin site creation and management.
- `/account`: owner entry router and multi-site chooser.
- `/account/onboarding`: create an independent signed-in website project from any public source URL.
- `/admin/site-queue`: candidate-version and operator-review queue.
- `/settings`: site-authoring and ingestion model settings.
- `/workspace/:slug`: owner home, site status, and next action.
- `/workspace/:slug/website`: site-authoring manager, preview, history, and publishing.
- `/workspace/:slug/inbox`: website lead inbox.
- `/workspace/:slug/results`: owner-readable first-party analytics.
- `/workspace/:slug/business`: canonical business data and site intent.
- `/workspace/:slug/settings`: proof-first custom domains, redirects, and access.
- `/sites/:slug/*`: published immutable site artifact.

Copy `.env.example` to local environment configuration and provide real values outside git. Website generation requires OpenAI, Supabase, a Railway sandbox token, and artifact-storage credentials. Synthetic test inputs are constructed at runtime and are never visual baselines.

## Verification

```bash
npm run verify:static
npm run verify:browser
npm run verify:sandbox
npm run verify:preflight
npm run smoke:dev
```

Set `LODESTA_VERIFY_LIVE_DATABASE=true` only when the canonical baseline has been applied to the target environment and the browser-role denial checks should run against it.

The model-spending owner journey is intentionally outside ordinary CI. Configure
the dedicated non-production values documented in `.env.example`, start the
target application, and run `npm run canary:owner-journey`. The command uses a
real Supabase magic link, creates and edits a multi-file site, publishes it,
submits a synthetic lead through the published form, verifies its exact values
are retained once and visible in the owner's inbox, then disposes the dedicated
canary site while retaining audit records. Screenshots and non-secret
evidence are written under gitignored `.data/owner-journey/`.

After the runtime release suite passes, promote the content-hashed trusted runtime through the audited series RPC:

```bash
npm run runtime:promote -- --apply --verified-by=<operator-id>
```

Product refinement uses the same signed-in `/account/onboarding` flow as customers. Every confirmed creation is an independent project, even when the same account or another account has used the source URL before.

## Deployment

Railway hosts the Next.js web service and worker. Supabase stores canonical authorities, the compact source manifest, the page-level text index, and operational records. R2 stores content-addressed website response bodies, assets, workspace archives, runtime patches, and finalized site bytes. Railway sandboxes run website builds. Cloudflare for SaaS remains the custom-domain integration, and Cloudflare Workers still host the artifact broker and recovery watchdog.

Required service configuration is documented in `.env.example`. Run `npm run verify:deployment-config` after package or Railway configuration changes. Use `/api/health` for liveness and the authenticated deep health check for service readiness.

Controller changes are released only through the serialized post-CI GitHub workflow documented in [docs/production-release.md](docs/production-release.md). Railway GitHub autodeploy remains disabled so the release workflow deploys the exact same commit to both Railway services.

The application schema is created from the canonical baseline followed by the reviewed forward migrations under `supabase/migrations`. Strict immutable authorities are never rewritten in place. Regenerable operational records use canonical unversioned names; the application has no compatibility readers or dual-write paths.

## Security Boundaries

- Sandbox input contains only `SitePublicBuildInput`; private evidence and secrets never enter the build environment.
- Sandbox sessions perform no network installs and import only the prebaked Lodesta SDK and allowlisted toolchain.
- HTML, CSS, routes, links, assets, forms, capabilities, structured data, and factual claims are validated before persistence.
- Forms, analytics, maps, domains, internal redirects, publishing, runtime behavior, and all backend functions are platform-owned.
- Preview forms remain disabled outside eligible published versions.
- Public writes pass through server-side authorization, validation, rate limiting, and URL-safety boundaries.
- Supabase browser clients are Auth-only. RLS and privileges deny `anon` and `authenticated` direct application-table access.
- Site ownership is exact `sites.owner_user_id` equality; source URLs never confer ownership.

See `AGENTS.md` for the repository's clean-break, stored-artifact, security, testing, and git rules.
