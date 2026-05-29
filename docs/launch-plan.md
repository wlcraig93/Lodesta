# SMB Presence Autopilot Launch Plan

## Product Decision

Build an outcome-driven local-business website and presence platform, not a general website builder. The website is the acquisition wedge and first managed surface. The recurring product is a managed optimization loop that starts with review-mode recommendations and grows into broader presence management over time.

Explicit launch stance:

- Build the product first, then test the outbound mailer wedge with real businesses.
- Start with review-mode suggestions and one-click apply, not broad autonomous edits.
- Include the analytics and experiment data spine in launch because it powers the recursive improvement engine.
- Use a structured-canonical site model, not one generated codebase per customer.
- Use curated editing: owners edit content, facts, images, CTAs, colors, variants, and section order; the system owns layout, responsive behavior, conversion scaffolding, and QA gates.
- Support code/custom components later as platform-authored extensions, not customer-authored arbitrary code in V1.

## Architecture Decisions

- Product app: Next.js + TypeScript.
- Public sites: dynamic structured renderer backed by versioned site JSON.
- Database/auth: Supabase Auth and Postgres.
- Deployment: Railway for the app, API, and worker processes.
- Custom domains: Cloudflare for SaaS for scaled customer domains, SSL, and CDN; Railway's Cloudflare integration is not a replacement for multi-tenant custom hostname management.
- Assets: pre-claim previews use generated/licensed imagery and extracted facts. Scraped photos, logos, and marketing copy are reference-only until owner grant.
- Workers: use the same repository/API contracts as the web app. Railway workers are acceptable for launch; crawler-heavy or browser-heavy jobs can move to dedicated worker infrastructure later if volume or anti-bot behavior requires it.
- Deployment readiness: `/api/health` is the Railway liveness endpoint, `/api/health?deep=1` is the admin readiness endpoint, and `npm run verify:supabase` proves the Supabase repository contract against a live project after `supabase/schema.sql` is applied.

## Canonical Models

Core data layers:

- `BusinessProfile`: owner-truth facts, provenance, verification state, services, hours, NAP, links, photos, reviews summary.
- `SiteModel`: theme, pages, sections, field policies, versions, publish state.
- `ExtensionModel`: forms, workflows, integrations, custom blocks.
- `OptimizationModel`: audits, findings, apply history, experiments, analytics, QA.

Every AI, UI, CLI, and worker action should mutate through the same repository boundary.

## Launch Scope

1. Foundation
   - App shell, auth-ready owner pages, dashboard, local and Supabase repositories, schema.
   - Structured public renderer with SEO metadata, LocalBusiness schema, sitemap, robots, preview noindex.

2. Site Standard
   - Codify measurable SEO, conversion, trust, accessibility, and vertical-specific criteria.
   - Use the Standard for generation, audits, preview scoring, QA, and future optimization policy.

3. Generation and Import
   - Prompt-to-site and URL-to-site.
   - URL crawl extracts facts, links, schema, SEO signals, forms, image references, and presence notes without copying protected assets into public previews.
   - Generated sites include service pages and local area pages where facts support them.

4. Preview Wedge
   - Tokenized, private, noindex previews.
   - Current-site score versus generated-draft score.
   - Concrete failed checks with business consequences.
   - Creative plan from visual/brand inspection prompts; generated mockups can be used as planning artifacts, not as final page output.

5. Curated Editor
   - Inline approved text fields.
   - Theme presets, section variants, section ordering.
   - Responsive preview.
   - AI chat dock that applies constrained mutations through tools.
   - Field policies define what owners can edit, what experiments can vary, and what the system owns.

6. Forms, Leads, and Workflows
   - Flexible form definitions.
   - JSON lead submissions.
   - Spam guard with honeypot and submit-timing checks.
   - Lead status operations: new, reviewed, spam.
   - Workflow deliveries for email, webhook, and CRM placeholders.
   - CSV export.

7. Analytics and Measurement
   - First-party event capture: pageviews, clicks, tel clicks, outbound booking/order clicks, section views, form starts/submits, scroll depth, engagement time, web vitals, experiment assignment.
   - Lead metadata: source URL, session id, landing path, referrer host, UTM fields.
   - Summaries by page, CTA role, section, experiment variant, and baseline window.

8. Review-Mode Optimization
   - Monthly action-list job runs audit, QA, analytics summary, leads summary, and experiment analysis.
   - Findings have apply modes: `auto_fix`, `one_click`, `manual_service`.
   - Individual apply and apply-all safe recommendations.
   - QA gate before publish.
   - Version history and rollback for safety.

9. Experiments
   - Launch with narrow content-neutral experiments only.
   - First surfaces: sticky CTA and CTA prominence.
   - Owner-truth content is never autonomously rewritten.
   - Fleet/cohort learning matters more than per-site significance for low-traffic SMBs.

10. Claim, Billing, and Domains
   - Claim requires terms, management authority, and fact verification.
   - Claims store the authenticated Supabase user id when available plus owner email, so later owner access can be authorized through Supabase Auth rather than an operator token.
   - Verified claim facts update canonical provenance.
   - Stripe checkout is used when configured.
   - Cloudflare for SaaS custom hostname registration persists DNS/verification instructions.

11. CLI and Workers
   - CLI calls the same HTTP APIs as the app.
   - Required launch commands: create from URL, batch import, run presence, run audit, run QA, create preview, publish, apply safe findings, inspect leads, connect domain, monthly action list, process jobs.
   - Worker runner processes durable queued jobs through the repository context.

## Later Surfaces

- Listings sync through buy/partner/build decision.
- Review management.
- Booking modules.
- Inquiry auto-replies.
- CRM integrations.
- Paid ads and revenue-share attribution.
- Platform-authored custom components.
- Broader autopilot once enough QA, attribution, and owner trust exists.

## Validation

The initial outbound wedge is intentionally tested after the product surface exists. The test should measure:

- Mailer to preview visit rate.
- Preview visit to claim rate.
- Claim to paid conversion.
- Owner trust in the score.
- Whether generated sites feel sufficiently specific to the business.
- Which verticals produce the best response.

Do not let Phase 0 demand validation block product implementation; this is an explicit strategic decision for this project.
