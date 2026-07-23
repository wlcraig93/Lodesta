# Lodesta

Lodesta is an AI-first managed website and local-presence platform for US small businesses. The product is pre-launch. Suitable local businesses can generate sites without a configured domain module; auto body currently has the only optional production context enrichment.

The current website system uses canonical business data, one website manager agent, shared Lodesta capabilities, isolated Cloudflare builds, immutable site artifacts, and Railway/Next.js serving. It does not use presentation templates, copy slots, a planner/compiler design system, or per-vertical generator branches.

The canonical architecture and implementation sequence are documented in [docs/product-path-simplification-plan.md](docs/product-path-simplification-plan.md).

## Architecture

- `packages/business-data`: crawl ingestion, normalized business state, and public sandbox projection.
- `packages/acquisition`: presence reports, outbound campaigns, prospects, adoption, and their worker.
- `packages/vertical-context`: non-executable auto-body context plus a test-only extensibility module.
- `packages/site-agent`: the single website-authoring agent, its tools, and knowledge skills.
- `packages/site-sandbox`: authenticated client for the Cloudflare Sandbox bridge.
- `workers/site-sandbox`: deny-by-default, prebaked Cloudflare build environment.
- `workers/recovery-watchdog`: stateless fifteen-minute recovery trigger for the Railway web service.
- `packages/site-verification`: sanitizer, factual-claim validation, browser gate, contact sheets, and finalization.
- `packages/site-artifacts`: content-addressed local or R2 artifact storage.
- `packages/platform-data`: canonical repository contracts and Supabase implementation.
- `packages/site-platform`: sessions, runs, clarifications, immutable candidates, publishing, restore, and rollback.
- `packages/site-capabilities`: managed forms, analytics, maps, safe links, and capability policy.
- `packages/control-plane`: typed business-state and site-intent mutations.
- `packages/trusted-runtime`: audited runtime-series patching and rollback.

Public and authenticated previews serve the same finalized HTML/CSS bytes. Agent-authored code never runs in a visitor browser; public artifacts contain only static HTML/CSS and the platform-owned trusted runtime.

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:4330` by default. `npm run dev` starts the Next.js app and a local-only fast recovery worker; use `npm run dev:web` when only the web process is needed. Production uses the web process plus the scheduled Cloudflare recovery watchdog, not a persistent Railway worker.

Important surfaces:

- `/admin/sites`: admin site creation and management.
- `/account`: owner entry router and multi-site chooser.
- `/account/onboarding`: create an independent signed-in website project from any public source URL.
- `/admin/site-queue`: candidate-version and operator-review queue.
- `/settings`: site-authoring and ingestion model settings.
- `/workspace/:slug`: owner home, site status, and next action.
- `/workspace/:slug/website`: site-authoring manager, preview, history, and publishing.
- `/workspace/:slug/inbox`: managed form inbox.
- `/workspace/:slug/results`: owner-readable first-party analytics.
- `/workspace/:slug/business`: canonical business data and site intent.
- `/workspace/:slug/settings`: proof-first custom domains, redirects, and access.
- `/sites/:slug/*`: published immutable site artifact.

Copy `.env.example` to local environment configuration and provide real values outside git. Website generation requires OpenAI, Supabase, Cloudflare Sandbox, and artifact-storage credentials. Synthetic test inputs are constructed at runtime and are never visual baselines.

## Verification

```bash
npm run typecheck
npm run verify:architecture
npm run verify:database
npm run verify:authoring
npm run verify:runtime
npm run verify:account-setup-domain
npm run verify:acquisition
npm run verify:render-browser
npm run smoke:dev
```

Set `LODESTA_VERIFY_LIVE_DATABASE=true` only when the canonical baseline has been applied to the target environment and the browser-role denial checks should run against it.

After the runtime release suite passes, promote the content-hashed trusted runtime through the audited series RPC:

```bash
npm run runtime:promote -- --apply --verified-by=<operator-id>
```

Product refinement uses the same signed-in `/account/onboarding` flow as customers. Every confirmed creation is an independent project, even when the same account or another account has used the source URL before.

## Deployment

Railway hosts the Next.js web service and worker. Supabase stores canonical authorities and operational records. R2 stores immutable source archives, assets, screenshots, runtime patches, and finalized site bytes. Cloudflare Sandbox runs untrusted website builds; Cloudflare for SaaS remains the custom-domain integration.

Required service configuration is documented in `.env.example`. Run `npm run verify:deployment-config` after package or Railway configuration changes. Use `/api/health` for liveness and the authenticated deep health check for service readiness.

The application schema is created from the sole canonical file under `supabase/migrations`. Strict immutable authorities are never rewritten in place. Regenerable operational records use canonical unversioned names; the application has no compatibility readers or dual-write paths.

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
