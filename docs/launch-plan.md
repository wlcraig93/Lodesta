# Lodesta V1 Launch Plan

**Status:** Deferred product scope; the current builder milestone is private experimentation only

**Architecture authority:** [Lodesta Agentic Website Platform V1](agentic-site-workspace-v1-plan.md)

## Product

Lodesta builds and manages high-quality websites for US local businesses. V1 starts with auto body, ingests verifiable business facts from an existing URL, produces a protected customer-ready draft, and gives the owner an AI website workspace for controlled visual and content changes.

The product is intentionally narrower than a general application builder. It owns the shared backend capabilities and refuses requests for arbitrary authentication, databases, payments, custom server code, dependencies, secrets, or unsupported embeds.

## V1 Contract

- Canonical `BusinessStateV2` owns business truth and provenance.
- `SiteIntentV2` owns presentation goals without templates or layout recipes.
- One `WebsiteManagerAgent` authors a complete React/TypeScript/CSS workspace in Cloudflare Sandbox.
- The trusted compiler surface is limited to Lodesta SDK hooks; no agent-authored JavaScript reaches visitors.
- Forms/inbox, analytics, maps, links, domains, internal redirects, metadata, structured data, publishing, runtime interactions, and rollback are platform-owned.
- Sanitization, claim grounding, capability authorization, browser QA, and immutable finalization are hard gates.
- Candidate, preview, and production HTML/CSS bytes are identical.
- Owners use Discuss and Apply, page/element selection, canonical-data controls, version comparison, publish, restore, and rollback.
- Operators see failed objective gates and unresolved subjective findings in one queue.

## Launch Sequence

No pilot or launch sequence is currently authorized. The active implementation milestone is one private, technically non-publishable live experiment. Before a pilot, a separate planning decision must define the deferred pilot-entry target set, edit battery, independent review, quality and reliability thresholds, mandatory pre-publish operator review, pilot size, and exit review. Monetary caps follow demonstrated quality and workflow readiness.

## Initial Managed Surface

- URL ingestion and source retention.
- Auto-body vertical context through the shared module boundary.
- Multi-page customer website creation.
- AI-guided visual/content edits.
- Canonical fact and offering changes through typed control-plane requests.
- Managed contact/estimate forms and owner inbox.
- First-party analytics.
- SEO/AEO metadata, JSON-LD, robots, sitemap, and text/markdown discovery routes.
- Protected preview, claim, billing, custom domain, immutable publish, version history, and rollback.

Scheduling, customer auth, ecommerce, custom applications, extra production vertical modules, arbitrary plug-ins, and fleet-wide autonomous experimentation are deferred.

## Infrastructure

- Next.js and Railway for product UI, APIs, public artifact serving, and workers.
- Supabase Auth/Postgres for canonical and operational data.
- R2 for content-addressed source archives, asset revisions, workspace backups, screenshots, runtime patches, and site artifacts.
- Cloudflare Sandbox `standard-2` containers for isolated builds with a prebaked dependency tree and deny-by-default egress.
- Cloudflare for SaaS for customer domains where configured.

Fresh databases are created by applying ordered files under `supabase/migrations`; there is no parallel monolithic schema file. Run `npm run verify:supabase`, `npm run verify:site-sandbox-v1`, and `npm run verify:agentic-site-walking-skeleton` before deployment.

## Decision Metrics

The canonical architecture plan records the launch gates that were deliberately deferred rather than treating experimental momentum as readiness. When a pilot plan is approved, measure:

- URL-to-candidate and edit completion/latency.
- Objective and subjective first-pass rates.
- Unsupported-claim and capability violations.
- Operator intervention rate.
- Preview-to-claim and claim-to-paid conversion.
- Form completion, qualified inquiry volume, and owner retention.
- Support burden and infrastructure/model cost after quality is established.

Do not add a runtime rule, template, URL-specific branch, new grader, or vertical-specific generator to make one evaluation site pass.
