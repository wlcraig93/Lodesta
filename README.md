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
- URL crawler that extracts technical SEO signals and owner-verifiable facts without copying protected site assets into previews
- Stripe-ready claim checkout flow
- Cloudflare for SaaS-ready custom-domain flow
- Supabase Auth-ready owner login/account flow
- Lead workflow delivery logging with optional Resend email and webhook notifications
- Review-mode optimization loop with one-click draft edits and QA gate
- Narrow experiment runtime for content-neutral sticky CTA testing
- Explicit experiment holdout percentage so cohort-level lift can be compared against a persistent control
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

Open:

- `http://localhost:3000` for the operator dashboard
- `http://localhost:3000/preview/demo-token` for the pre-claim preview
- `http://localhost:3000/sites/joes-pizza` for the public rendered site
- `http://localhost:3000/editor/joes-pizza` for curated owner editing
- `http://localhost:3000/business/joes-pizza` for owner-truth business facts
- `http://localhost:3000/analytics/joes-pizza` for first-party analytics
- `http://localhost:3000/optimization/joes-pizza` for action list and QA
- `http://localhost:3000/experiments/joes-pizza` for experiment assignment reporting
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
- `POST /api/forms/submit`
- `POST /api/analytics`
- `POST /api/business-profile`
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

```bash
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- list-sites
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- create-site-from-url http://127.0.0.1:4330/sites/joes-pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- import-batch http://127.0.0.1:4330/sites/joes-pizza http://127.0.0.1:4330/sites/joes-pizza/menu
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- run-presence http://127.0.0.1:4330/sites/joes-pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- run-audit site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- run-qa site_joes_pizza published
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- apply-safe-findings site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- create-preview site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- connect-domain site_joes_pizza www.joespizza.example
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- update-business site_joes_pizza '{"phone":"+15551234567","services":["Pizza","Catering"]}'
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- monthly-action-list site_joes_pizza
LODESTA_API_URL=http://127.0.0.1:4330 npm run cli -- health deep
```

The CLI calls the same HTTP API as the app. It is intended for operator/admin workflows from Codex, Claude Code, or a terminal.
If `LODESTA_ADMIN_TOKEN` is set on the server, set the same variable in the CLI environment; the CLI sends it as a bearer token.
The batch-import job generates structured sites and tokenized previews for outbound lists. The monthly action-list job runs the Standard audit, analytics summary, lead count, QA checks, and experiment analysis through the same repository boundary used by the web app.

## Deployment Readiness

Use `/api/health` as the Railway liveness endpoint. It returns a small public response without exposing configuration details.

Use `/api/health?deep=1` or `npm run cli -- health deep` as the admin readiness check. When `LODESTA_ADMIN_TOKEN` is set, send it through the CLI environment or as a bearer token. The deep check verifies repository connectivity plus required and optional service configuration without returning secret values.

Minimum Railway web service environment:

- `NEXT_PUBLIC_APP_URL`
- `LODESTA_REPOSITORY=supabase`
- `LODESTA_ADMIN_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional launch integrations:

- `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` for checkout
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_FALLBACK_ORIGIN` for custom domains
- `RESEND_API_KEY` and `WORKFLOW_FROM_EMAIL` for lead notifications
- `OPENAI_API_KEY` for future hosted AI generation calls

Recommended Railway services:

- Web: `npm run start` after `npm run build`
- Worker: `npm run worker -- process-all` on a schedule or long-running worker strategy once the queue volume justifies it

## Architecture Defaults

- Use Next.js + TypeScript for launch.
- Use Railway for the web service and job workers.
- Use Supabase Auth/Postgres/Storage for persistence.
- Use Cloudflare for SaaS later for scaled customer domains, SSL, and CDN.
- Keep public sites structured and multi-tenant instead of generating one app/codebase per customer.
- Treat scraped photos/logos/copy as source references before claim. Generated previews use extracted facts, licensed/generated assets, and owner-granted uploads only.
- Serve speculative previews from random repository-backed tokens, not slugs. Preview routes are noindex and default generated tokens expire after 30 days.
- Keep unclaimed generated sites out of `sitemap.xml` and render their slug routes with `noindex`; tokenized previews are the pre-claim surface.
- Custom domains resolve by host header through middleware: registered customer hostnames rewrite to the same structured `/sites/{slug}` renderer.

## Persistence Boundary

Application routes call `lib/repository.ts`, not the local store directly. The current `localRepository` keeps demo data in process memory and durable worker jobs in `.data/jobs.json`; it exists so the launch surface can be built and tested before Supabase credentials are configured.

Supabase implementation path:

1. Run `supabase/schema.sql` in the target Supabase project.
2. Set `LODESTA_REPOSITORY=supabase`.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for server-side repository access.
4. Keep `SUPABASE_ANON_KEY` available for the browser/auth layer when the dashboard auth screens are wired.
5. Run `npm run verify:supabase` against that environment. It creates a unique verification site, preview token, audit, analytics events, lead, claim, fallback domain, and queued job, then deletes the verification rows unless `-- --keep` is passed.
6. Move assets to Supabase Storage or an S3-compatible bucket with explicit rights status on each `AssetReference`.
7. Keep worker processing behind the same repository methods so Railway web and worker services share one persistence layer.

The local repository remains the default for development and seeded demos. The Supabase repository is server-only and is intended for Railway web/worker services; do not expose the service role key to client components.
The schema enables RLS and owner-read policies for claimed site data. Public writes such as analytics and form submissions still go through the Next.js API/repository boundary, which keeps spam checks, attribution capture, and workflow delivery in one place.

Supabase verification examples:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run verify:supabase
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run verify:supabase -- --keep
```

The verifier disables Stripe and Cloudflare calls by default so it only tests database persistence. Pass `-- --live-integrations` only when you intentionally want to exercise configured third-party APIs.

## Auth

Owner login uses Supabase magic links. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for browser login, and configure Supabase redirect URLs to include `/auth/callback`. Without those variables, the login and account pages render a clear setup state instead of failing.

Operator/admin APIs are open in local development when `LODESTA_ADMIN_TOKEN` is blank. In deployed environments, set `LODESTA_ADMIN_TOKEN` to require bearer-token authorization for operator-only generation, jobs, site listing, preview token management, and cross-site exports. Owner-facing site APIs also accept the authenticated claim owner through Supabase Auth. Claim records store both the authenticated Supabase user id when present and the owner email, so owner access can be proven by user id or by a later magic-link login with the same email. Public site analytics ingestion, experiment assignment, form submission, and claim POST remain available for visitor/customer flows.

## Billing And Domains

Claim checkout uses Stripe only when both `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are set. Without those variables, the claim API returns an explicit unconfigured checkout object so local demos can continue without live billing.
Verified facts selected during claim update the site's `BusinessProfile.provenance` as owner-confirmed fields, which keeps later schema, optimization, and presence-sync decisions gated on explicit confirmation.

Custom-domain registration uses Cloudflare for SaaS only when both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are set. Without those variables, the domain API returns the fallback CNAME target from `CLOUDFLARE_FALLBACK_ORIGIN`.

Set `LODESTA_PLATFORM_HOSTS` to a comma-separated list of app/dashboard hostnames that should not be treated as customer domains. `localhost`, `127.0.0.1`, Railway hostnames, and `NEXT_PUBLIC_APP_URL` are already treated as platform hosts.

## Lead Workflows

Form submissions are stored as JSON leads and then run through the site's configured workflows. V1 supports:

- `email`: logs a skipped delivery locally unless `RESEND_API_KEY` is set, then sends through Resend from `WORKFLOW_FROM_EMAIL`.
- `webhook`: posts the lead payload to the configured workflow URL.
- `crm_placeholder`: records a skipped delivery so CRM destinations can be added without changing the lead model.

Workflow delivery attempts are visible on the leads page and returned from `GET /api/leads?siteId=...`.
Lead submissions also capture source URL, session id, landing path, referrer host, and UTM fields as metadata so form-source attribution is available before the broader optimization layer gets smarter.
