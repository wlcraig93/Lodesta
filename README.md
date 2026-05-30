# Lodesta

SMB Presence Autopilot is an AI-first managed website and local-presence platform for US small businesses.

This repository currently contains the launch foundation:

- Next.js + TypeScript app shell
- Structured canonical models
- Typed repository boundary with local and Supabase implementations
- Standard criteria registry
- Dynamic public-site renderer
- Tokenized noindex preview route
- Intake, audit, forms, analytics, monthly action-list, and experiment APIs
- Analytics summaries for traffic sources, click-map aggregates, section outcomes, funnels, experiments, Web Vitals, and Standard correlations
- URL crawler that extracts technical SEO signals and owner-verifiable facts without copying protected site assets into previews
- Stripe-ready claim checkout flow
- Cloudflare for SaaS-ready custom-domain flow
- Supabase Auth-ready owner login/account flow
- Lead workflow delivery logging with optional Resend email and webhook notifications
- Review-mode optimization loop with one-click draft edits, QA gate, and explicit publish confirmation
- Opt-in experiment runtime for content-neutral sticky CTA, CTA prominence, form length/order, and hero-layout testing
- Explicit experiment holdout percentage so cohort-level lift can be compared against a persistent control
- Experiment learning registry that can adopt directional winners into future generation defaults and roll them back
- Supabase schema draft aligned to the structured site model
- Railway worker scaffold

See `docs/launch-plan.md` for the formal product and architecture plan this implementation follows.

## Local Development

```bash
npm install
npm run dev
```

To run the launch-flow smoke checks against a local dev server:

```bash
npm run smoke:dev
```

If a server is already running, use:

```bash
npm run smoke
```

To verify the local Stripe webhook signature and claim-completion logic without calling Stripe:

```bash
npm run verify:launch-boundaries
npm run verify:stripe-webhook
```

Open:

- `http://localhost:3000` for the operator dashboard
- `http://localhost:3000/settings` for operator runtime settings
- `http://localhost:3000/preview/demo-token` for the pre-claim preview
- `http://localhost:3000/sites/joes-pizza` for the public rendered site
- `http://localhost:3000/editor/joes-pizza` for curated owner editing
- `http://localhost:3000/business/joes-pizza` for owner-truth business facts
- `http://localhost:3000/analytics/joes-pizza` for first-party analytics
- `http://localhost:3000/optimization/joes-pizza` for action list and QA
- `http://localhost:3000/experiments/joes-pizza` for experiment opt-in, rollback, and assignment reporting
- `http://localhost:3000/claim/joes-pizza` for fact verification and checkout
- `http://localhost:3000/domains/joes-pizza` for custom-domain connection
- `http://localhost:3000/leads/joes-pizza` for form submissions and CSV export
- `http://localhost:3000/versions/joes-pizza` for version history and rollback
- `http://localhost:3000/auth/login` for owner login
- `http://localhost:3000/account` for the authenticated owner dashboard

Useful API smoke routes:

- `POST /api/intake`
- `POST /api/preview-tokens`
- `GET /api/preview-tokens?siteId=site_joes_pizza`
- `POST /api/presence/assess`
- `POST /api/audits/run`
- `POST /api/qa/run`
- `POST /api/action-list/apply`
- `POST /api/action-list/apply-all`
- `POST /api/action-list/dismiss`
- `POST /api/forms/submit`
- `POST /api/analytics`
- `POST /api/business-profile`
- `POST /api/experiments/update`
- `POST /api/experiments/learn`
- `GET /api/experiments/learn?siteId=site_joes_pizza`
- `POST /api/experiments/assign`
- `GET /api/experiments/analyze?siteId=site_joes_pizza`
- `POST /api/sites/update-section`
- `GET /api/sites/versions?siteId=site_joes_pizza`
- `POST /api/sites/versions`
- `POST /api/claim`
- `POST /api/domains`
- `POST /api/jobs`
- `POST /api/jobs/process`
- `GET /api/jobs`
- `GET /api/sites`
- `GET /api/leads?siteId=site_joes_pizza`
- `GET /api/leads/export?siteId=site_joes_pizza`

Admin CLI:

The local `127.0.0.1` crawl examples require the running app/worker process to be started with `LODESTA_ALLOW_PRIVATE_CRAWL_URLS=true`; keep that setting disabled in deployed environments.

```bash
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- list-sites
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- create-site-from-url http://127.0.0.1:4330/sites/joes-pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- import-batch http://127.0.0.1:4330/sites/joes-pizza http://127.0.0.1:4330/sites/joes-pizza/menu
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- run-presence http://127.0.0.1:4330/sites/joes-pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- run-audit site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- run-qa site_joes_pizza published
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- apply-safe-findings site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- apply-safe-findings site_joes_pizza qa
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- dismiss-finding site_joes_pizza analytics_engaged_no_action
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- create-preview site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- connect-domain site_joes_pizza www.joespizza.example
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- refresh-domain domain_id
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- update-business site_joes_pizza '{"phone":"+15551234567","services":["Pizza","Catering"]}'
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- monthly-action-list site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- schedule-maintenance launch_maintenance
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- health deep
```

The CLI calls the same HTTP API as the app. It is intended for operator/admin workflows from Codex, Claude Code, or a terminal.
If `LODESTA_ADMIN_TOKEN` is set on the server, set the same variable in the CLI environment; the CLI sends it as a bearer token.
Local Node entry points (`npm run cli`, `npm run worker`, and verification scripts) automatically load `.env` and `.env.local` from the repository root. Shell-provided variables still take precedence.
The batch-import job generates structured sites and tokenized previews for outbound lists. The monthly action-list job runs the Standard audit, analytics summary, lead count, QA checks, and experiment analysis through the same repository boundary used by the web app. `POST /api/jobs/schedule` or `npm run cli -- schedule-maintenance` is the cron-safe scheduler for queuing monthly action-list jobs across all sites without immediately processing them. Action-list applies stage a draft and return QA status; publishing is a separate confirmed action.

## Deployment Readiness

Use `/api/health` as the Railway liveness endpoint. It returns a small public response without exposing configuration details.

Use `/api/health?deep=1` or `npm run cli -- health deep` as the admin readiness check. When `LODESTA_ADMIN_TOKEN` is set, send it through the CLI environment or as a bearer token. The deep check verifies repository connectivity plus required and optional service configuration without returning secret values.

Minimum Railway web service environment:

- `NEXT_PUBLIC_APP_URL`
- `LODESTA_ADMIN_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional launch integrations:

- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` for checkout and claim completion
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_FALLBACK_ORIGIN` for custom domains
- `LODESTA_ALLOW_PRIVATE_CRAWL_URLS=true` only for controlled local testing against localhost/private targets; leave unset or `false` in deployed environments
- `RESEND_API_KEY` for lead notifications
- `LODESTA_WORKFLOW_TIMEOUT_MS` for external email/webhook workflow delivery timeout; default is 5000 ms
- `LODESTA_IP_HASH_SALT` for privacy-preserving daily lead IP hashes
- `LODESTA_RATE_LIMIT_SALT` for public write rate-limit fingerprints
- `GOOGLE_PLACES_API_KEY` for optional Google Places Text Search enrichment of ratings, counts, categories, hours, phone, website, and map URL with provenance
- `OPENAI_API_KEY` for hosted model-backed brand assessment, design-direction planning, screenshot visual QA, and GPT Image planning mockups; model and image options are managed at `/settings`
- `LODESTA_WORKER_ID` for long-running Railway worker identity

Recommended Railway services:

- Web: use root [railway.toml](/Users/williamcraig/Documents/GitHub/Lodesta/railway.toml), which installs Chromium during build, starts `npm run start`, and health-checks `/api/health`.
- Worker: create a second Railway service from the same repo and set its config path to [deploy/railway-worker.toml](/Users/williamcraig/Documents/GitHub/Lodesta/deploy/railway-worker.toml), which installs Chromium during build and runs `npm run worker -- work`.
- Cron: schedule a protected `POST /api/jobs/schedule` call with `{ "task": "launch_maintenance" }` for recurring maintenance, or call `npm run cli -- schedule-maintenance launch_maintenance` from a Railway cron command.
- Run `npm run verify:deployment-config` before deploying after changing package scripts or Railway config.

OpenAI runtime settings:

- Use `/settings` to manage generation model, visual QA model, image model, image size, image quality, and mockup limit.
- Run `npm run seed:openai-settings` before deploying a fresh Supabase environment. Override defaults with `--generation-model`, `--visual-qa-model`, `--image-model`, `--image-size`, `--image-quality`, and `--mockup-limit` when needed.

Browser render inspection:

- Lodesta supports Playwright-installed Chromium as the browser runtime.
- The Railway web and worker configs install Chromium during build with `npm run install:browsers`.
- Run `npm run verify:render-browser` locally after browser installation and before enabling high-volume intake or screenshot-dependent visual QA.
- After deploy, run `LODESTA_API_URL=https://<deployed-app> LODESTA_ADMIN_TOKEN=<token> npm run cli -- health deep` and confirm `render_browser_readiness` is `ok`.

## Architecture Defaults

- Use Next.js + TypeScript for launch.
- Launch intake is US-only. Admin intake, presence assessment, and generation jobs reject explicit non-US prompts, unsupported country-code domains, and crawled/public-presence country facts that are not US/USA/United States.
- Use Railway for the web service and job workers.
- Use Supabase Auth/Postgres/Storage for persistence.
- Use Cloudflare for SaaS later for scaled customer domains, SSL, and CDN.
- Keep public sites structured and multi-tenant instead of generating one app/codebase per customer.
- Treat scraped photos/logos/copy as source references before claim. Generated previews use extracted facts, licensed/generated assets, and owner-granted uploads only.
- Serve speculative previews from random repository-backed tokens, not slugs. Preview routes are noindex and default generated tokens expire after 30 days.
- Keep unclaimed generated sites out of `sitemap.xml` and render their slug routes with `noindex`; only completed `claimed` sites are indexable, and tokenized previews are the pre-claim surface.
- Keep pre-claim previews and unclaimed public slug routes non-collecting: lead forms render inert, analytics ingestion returns an inactive non-storing response, and experiment assignment is disabled until the claim gate passes.
- Custom domains resolve by host header through middleware: registered customer hostnames rewrite to the same structured `/sites/{slug}` renderer.
- Middleware applies explicit CDN cache policy headers: public site HTML gets a short shared-cache TTL, stored generated assets are immutable, and dashboard/API/auth/form/analytics/preview/editing routes are `no-store`.

## Persistence Boundary

Application routes call `lib/repository.ts`, which now uses the Supabase-backed repository directly. Supabase-backed workers claim queued jobs with a Postgres `claim_next_job` function using `FOR UPDATE SKIP LOCKED`, retry failed attempts with backoff, and recover stale running locks.

Supabase implementation path:

1. Run `supabase/schema.sql` in the target Supabase project.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for server-side repository access.
3. Keep `SUPABASE_ANON_KEY` available for the browser/auth layer when the dashboard auth screens are wired.
4. Create the Supabase Storage bucket `lodesta-assets` for generated image/mockup bytes; keep the `site_assets` registry and each `AssetReference` rights status as the source of truth.
5. Run `npm run verify:supabase` against that environment. It creates a unique verification site, uploads and removes a probe image in `lodesta-assets`, verifies persistence flows, and deletes verification rows unless `-- --keep` is passed. Use `npm run verify:supabase -- --storage-only` to verify only the storage bucket path.
6. Keep worker processing behind the same repository methods so Railway web and worker services share one persistence layer.

The Supabase repository is server-only and is intended for local development, Railway web, and Railway worker services; do not expose the service role key to client components.
The schema enables RLS and owner-read policies for claimed site data. Public writes such as analytics and form submissions still go through the Next.js API/repository boundary, which keeps spam checks, attribution capture, and workflow delivery in one place.

Supabase verification examples:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run verify:supabase
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run verify:supabase -- --keep
```

The verifier disables Stripe and Cloudflare calls by default so it only tests database persistence. Pass `-- --live-integrations` only when you intentionally want to exercise configured third-party APIs.

## Auth

Owner login uses Supabase Google OAuth and magic links. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for browser login, enable the Google provider in Supabase, and configure Supabase redirect URLs to include `/auth/callback`. Without those variables, the login and account pages render a clear setup state instead of failing.

Operator/admin APIs are open only in local development when `LODESTA_ADMIN_TOKEN` is blank and `LODESTA_REQUIRE_AUTH` is not `true`. In deployed/production environments, set `LODESTA_ADMIN_TOKEN` for CLI bearer-token access to operator-only generation, jobs, site listing, preview token management, and cross-site exports; production route guards fail closed if neither a valid token nor the Supabase-authenticated user id in `LODESTA_ADMIN_USER_ID` is present. Admin-only pages such as `/` and `/outbound` use the same admin user-id setting. Owner-facing site APIs also accept the authenticated owner of a completed `claimed` site through Supabase Auth. Claim records store both the authenticated Supabase user id when present and the owner email, so owner access can be proven by user id or by a later magic-link login with the same email after Stripe completion. Public site analytics ingestion, experiment assignment, form submission, and claim POST remain available for visitor/customer flows.

## Billing And Domains

Claim checkout uses Stripe only when both `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are set. Without those variables, the claim API returns an explicit unconfigured checkout object so local demos can continue without live billing.
Set Stripe's webhook endpoint to `https://YOUR_APP_URL/api/stripe/webhook` and configure `STRIPE_WEBHOOK_SECRET`. The webhook handles `checkout.session.completed` and marks the claim as `claimed`, persisting the Stripe customer, subscription, and checkout session ids.
Use `npm run verify:stripe-webhook` for local signature/claim-completion verification before testing a live Stripe webhook.
Verified facts selected during claim update the site's `BusinessProfile.provenance` as owner-confirmed fields, which keeps later schema, optimization, and presence-sync decisions gated on explicit confirmation.
Publishing through `/api/sites/publish` or `/api/sites/versions` is blocked until the site has a completed `claimed` record. A `checkout_required` claim still returns `402 Payment Required`.

Custom-domain registration is also blocked until the site has a completed claim. Once claimed, it uses Cloudflare for SaaS only when both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are set. Without those variables, the domain API returns the fallback CNAME target from `CLOUDFLARE_FALLBACK_ORIGIN`. Use `POST /api/domains/refresh` or `npm run cli -- refresh-domain <domainId>` to refresh provider status after DNS changes. Cloudflare-for-SaaS domains serve only after Cloudflare reports the hostname active. Railway/manual domains are for local or explicitly managed exceptions; deployed auth-enforced environments reject `provider: "railway"` unless `LODESTA_ALLOW_MANUAL_CUSTOM_DOMAINS=true` is set. Host-header domain resolution uses positive customer-domain lookup and serves only completed `claimed` sites, so pending checkout records do not expose customer domains. Unknown non-platform hostnames receive a bare `404`.

## Lead Workflows

Form submissions are stored as JSON leads and then run through the site's configured workflows. V1 supports:

- `email`: logs a skipped delivery locally unless `RESEND_API_KEY` is set, then sends through Resend from `Lodesta <notifications@mail.lodesta.com>`.
- `webhook`: posts the lead payload to the configured workflow URL.
- `crm_placeholder`: records a skipped delivery so CRM destinations can be added without changing the lead model.

Workflow delivery attempts are visible on the leads page and returned from `GET /api/leads?siteId=...`.
Lead submissions also capture source URL, session id, landing path, referrer host, and UTM fields as metadata. The analytics summary rolls those session signals into source attribution, click-map aggregates, funnel/section outcomes, experiment attribution, and Standard correlations. Raw IP addresses are not stored; when proxy headers expose a client IP, Lodesta stores only a salted daily `ip_hash`. Analytics events are retained for longitudinal site performance history while the site/account is active.

Public write routes have in-process abuse limits with hashed client fingerprints. Defaults cover form submissions, analytics ingestion, experiment assignment, claim creation, site intake, presence assessment, and owner asset uploads; set `LODESTA_RATE_LIMIT_SALT` in deployed environments. Route-specific thresholds are code defaults, not deployment environment variables.
URL-based intake, presence assessment, and worker crawl/render jobs also enforce target URL safety before fetching. Private, localhost, link-local, reserved, and DNS-resolved private targets are blocked by default to reduce SSRF risk; use `LODESTA_ALLOW_PRIVATE_CRAWL_URLS=true` only for intentional local fixture testing. Lead workflow webhooks always keep private/internal targets blocked.
