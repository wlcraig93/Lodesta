# Lodesta

Lodesta is an AI-first managed website and local-presence platform for US small businesses. The product is pre-launch and V1 currently supports auto-body businesses.

The current website system uses canonical business data, one website manager agent, shared Lodesta capabilities, isolated Cloudflare builds, immutable site artifacts, and Railway/Next.js serving. It does not use presentation templates, copy slots, a planner/compiler design system, or per-vertical generator branches.

The canonical architecture and implementation sequence are documented in [docs/agentic-site-workspace-v1-plan.md](docs/agentic-site-workspace-v1-plan.md).

## Architecture

- `packages/business-data`: crawl ingestion, normalized business state, and public sandbox projection.
- `packages/vertical-context`: non-executable auto-body context plus a test-only extensibility module.
- `packages/site-agent`: the single manager agent, visual/task critic, and versioned prompt contract.
- `packages/site-sandbox`: authenticated client for the Cloudflare Sandbox bridge.
- `workers/site-sandbox`: deny-by-default, prebaked Cloudflare build environment.
- `packages/site-verification`: sanitizer, factual-claim validation, browser gate, contact sheets, and finalization.
- `packages/site-artifacts`: content-addressed local or R2 artifact storage.
- `packages/platform-data`: V4 repository contracts and Supabase implementation.
- `packages/site-platform`: sessions, runs, bounded repair, immutable candidates, publishing, restore, and rollback.
- `packages/site-capabilities`: managed forms, analytics, maps, safe links, and capability policy.
- `packages/control-plane`: typed business-state and site-intent mutations.
- `packages/trusted-runtime`: audited runtime-series patching and rollback.

Public and authenticated previews serve the same finalized HTML/CSS bytes. Agent-authored code never runs in a visitor browser; public artifacts contain only static HTML/CSS and the platform-owned trusted runtime.

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:4330` by default. `npm run dev` starts the Next.js app and the platform worker; use `npm run dev:web` when only the web process is needed.

Important surfaces:

- `/dashboard`: operator dashboard.
- `/admin/sites`: site inventory.
- `/admin/site-queue`: candidate-version and operator-review queue.
- `/settings`: agent and critic model settings.
- `/editor/:slug`: owner website workspace with Discuss and Apply.
- `/business/:slug`: canonical business data and site intent.
- `/versions/:slug`: immutable version history, publish, restore, and rollback.
- `/leads/:slug`: managed form inbox.
- `/analytics/:slug`: first-party analytics.
- `/sites/:slug/*`: published immutable site artifact.

Copy `.env.example` to local environment configuration and provide real values outside git. Experimental generation requires OpenAI, Supabase, Cloudflare Sandbox, and artifact-storage credentials. Synthetic test inputs are constructed at runtime and are never visual baselines.

## Verification

```bash
npm run typecheck
npm run verify:agentic-architecture
npm run verify:agentic-site-platform-v1
npm run verify:trusted-runtime
npm run verify:render-browser
npm run smoke:dev
```

Live integration checks require `.env.local`:

```bash
npm run verify:supabase
npm run verify:site-sandbox-v1
npm run verify:agentic-site-walking-skeleton
```

After the runtime release suite passes, promote the content-hashed trusted runtime through the audited series RPC:

```bash
npm run runtime:promote -- --apply --verified-by=<operator-id>
```

The current live check is a private, non-publishable experiment:

```bash
npm run verify:agentic-live-experiment
```

It creates one private candidate and exercises an observed patch-only edit. It is not a readiness evaluation or authorization for an owner pilot.

## Deployment

Railway hosts the Next.js web service and worker. Supabase stores canonical authorities and operational records. R2 stores immutable source archives, assets, screenshots, runtime patches, and finalized site bytes. Cloudflare Sandbox runs untrusted website builds; Cloudflare for SaaS remains the custom-domain integration.

Required service configuration is documented in `.env.example`. Run `npm run verify:deployment-config` after package or Railway configuration changes. Use `/api/health` for liveness and the authenticated deep health check for service readiness.

Database changes are additive migration files under `supabase/migrations`. Strict immutable authorities are never rewritten in place. The pre-launch V3 deletion was an explicit hard cutover; no compatibility readers or dual-write paths remain.

## Security Boundaries

- Sandbox input contains only `SitePublicBuildInputV1`; private evidence and secrets never enter the build environment.
- Sandbox sessions perform no network installs and import only the prebaked Lodesta SDK and allowlisted toolchain.
- HTML, CSS, routes, links, assets, forms, capabilities, structured data, and factual claims are validated before persistence.
- Forms, analytics, maps, domains, internal redirects, publishing, runtime behavior, and all backend functions are platform-owned.
- Preview forms remain disabled outside eligible published versions.
- Public writes pass through server-side authorization, validation, rate limiting, and URL-safety boundaries.

See `AGENTS.md` for the repository's clean-break, stored-artifact, security, testing, and git rules.
