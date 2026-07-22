# Lodesta V1 Launch Plan

**Status:** Pilot blocked pending the explicit V3 cutover and fresh frozen validation

**Architecture authority:** [Lodesta Agentic Website Platform V1](agentic-site-workspace-v1-plan.md)

## Product

Lodesta builds and manages high-quality websites for US local businesses. V1 ingests verifiable business facts from an existing URL, produces a protected customer-ready draft, and gives the owner an AI website workspace for controlled visual and content changes. Auto body supplies the first optional domain-context module but is not an eligibility gate.

The product is intentionally narrower than a general application builder. It owns the shared backend capabilities and refuses requests for arbitrary authentication, databases, payments, custom server code, dependencies, secrets, or unsupported embeds.

## V1 Contract

- Canonical `BusinessStateV3` owns business truth and provenance.
- `SiteIntentV3` owns presentation goals without templates or layout recipes.
- One `WebsiteManagerAgent` authors a complete React/TypeScript/CSS workspace in Cloudflare Sandbox.
- The trusted compiler surface is limited to Lodesta SDK hooks; no agent-authored JavaScript reaches visitors.
- Forms/inbox, analytics, maps, links, domains, internal redirects, metadata, structured data, publishing, runtime interactions, and rollback are platform-owned.
- Sanitization, claim grounding, capability authorization, browser QA, and immutable finalization are hard gates.
- Candidate, preview, and production HTML/CSS bytes are identical.
- Owners use Discuss and Apply, page/element selection, canonical-data controls, version comparison, publish, restore, and rollback.
- Operators see failed objective gates and unresolved subjective findings in one queue.

## Launch Sequence

1. Deploy the shared phone/location presentation fixes, exact-version approvals, derived readiness, owner/operator workflow, and response-level diagnostics.
2. Run four frozen discovery URLs once, fix shared causes only, and deploy the coordinated release.
3. Run three untouched validation URLs once. All must pass objective QA and the fixed customer-draft rubric with product-owner and independent review. At most one fresh cohort may follow a general platform fix.
4. Prove element restyle, page addition, form movement, and mobile repair through patch-only edits on a retained validation site.
5. Pass relevant Agent Ready checks, including generated-site Markdown, robots policy, cache separation, JSON-LD, custom-domain behavior, and external scans.
6. Delete disposable quality data, then admit at most three manually selected local-business owners to a concierge pilot.
7. Require exact operator approval before every publish and hold an explicit exit review before expansion.

The operational procedure is [Private Site Quality Runbook](site-quality-runbook.md). Generated quality outputs remain ignored under `.data`; they are evidence for the immediate decision, never product fixtures or visual baselines. Monetary caps follow demonstrated quality and workflow readiness.

## Initial Managed Surface

- URL ingestion and source retention.
- Optional auto-body domain context through the shared module boundary; unmatched suitable local businesses use the same manager with neutral context.
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
- R2 with separate artifact and workspace buckets: Railway accesses immutable exact artifact keys through a least-privilege broker, while the sandbox Worker can access only opaque workspace archives. Inventory and deletion require separate operator-scoped credentials.
- Cloudflare Sandbox `standard-2` containers for isolated builds with a prebaked dependency tree and deny-by-default egress. Containers start only on the first build, Vite starts only for an authenticated live-preview request, successful or failed terminal runs explicitly destroy the container, and account capacity is capped at five instances with at most four runs claimed concurrently.
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
