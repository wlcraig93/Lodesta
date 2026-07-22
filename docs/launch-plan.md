# Lodesta V1 Product Refinement

**Status:** Private product refinement; no global customer-admission score is active

**Architecture authority:** [Product-Path Simplification](product-path-simplification-plan.md)

## Product

Lodesta builds and manages high-quality websites for US local businesses. V1 ingests
verifiable business facts from an existing URL, produces a protected draft, and gives
the owner an AI website workspace for visual and content changes. Auto body supplies the
first optional domain-context module but is not an eligibility gate.

The product is intentionally narrower than a general application builder. It owns shared
backend capabilities and refuses arbitrary authentication, databases, payments, custom
server code, dependencies, secrets, or unsupported embeds.

## V1 Contract

- Canonical `BusinessStateV3` owns business truth and provenance.
- `SiteIntentV3` owns presentation goals without templates or layout recipes.
- One `WebsiteManagerAgent` authors a React/TypeScript/CSS workspace in Cloudflare Sandbox.
- No agent-authored JavaScript reaches visitors.
- Forms, analytics, maps, domains, redirects, publishing, runtime interactions, and rollback are platform-owned.
- Sanitization, claim grounding, capability authorization, browser QA, and immutable finalization are hard release gates.
- Candidate, preview, and production HTML/CSS bytes are identical.
- The exact artifact requires operator approval before publication.

## Current Work

1. Deploy the coordinated site-authoring simplification and verify its infrastructure boundaries.
2. Generate private sites with `npm run experiment:site -- --url=<https-url>` as useful product questions arise.
3. Inspect each candidate and exercise edits through the real owner workspace instead of a scripted test protocol.
4. Record subjective observations in the attempt's freeform `notes.md`; use the report provenance and objective findings to compare attempts.
5. Improve evidence, skills, prompts, or tools when a problem is understood. Add hard verification only for factual, safety, capability, or functional violations.

Experiments may be repeated against the same or different businesses. There are no fixed
sample sizes, reserved URLs, rerun restrictions, quality scores, required edit categories,
or admission verdicts. A future customer-evaluation process will be designed only after
the product's real strengths and recurring failure modes are understood.

## Per-Site Publication Boundary

Private experimentation does not weaken shipping controls. A site can publish only when:

- it is not marked experimental;
- its candidate uses the current business state and site intent;
- its exact artifact passed objective QA;
- all rendered assets have publication rights;
- forms and active redirects are valid; and
- an operator approved that exact artifact hash.

These checks are enforced in application readiness and the database promotion function.

## Initial Managed Surface

- URL ingestion and source retention.
- Optional domain context through the shared module boundary.
- Multi-page website creation and AI-guided visual/content edits.
- Canonical fact and offering changes through typed control-plane requests.
- Managed forms and inbox, first-party analytics, maps, and safe links.
- SEO/AEO metadata, JSON-LD, robots, sitemap, and text/Markdown discovery routes.
- Protected preview, claim, billing, custom domains, immutable publishing, version history, and rollback.

Scheduling, customer authentication, ecommerce, custom applications, additional production
domain modules, arbitrary plug-ins, and fleet-wide autonomous experimentation remain deferred.

## Infrastructure Verification

- Next.js and Railway host product UI, APIs, public artifact serving, and workers.
- Supabase stores canonical authorities and operational records.
- R2 stores immutable source archives, assets, screenshots, runtime patches, and finalized bytes.
- Cloudflare Sandbox runs isolated builds with a prebaked dependency tree and deny-by-default egress.
- Cloudflare for SaaS provides custom-domain integration where configured.

Fresh databases apply ordered files under `supabase/migrations`; there is no parallel
monolithic schema file. Before deployed authoring is enabled, run Supabase, sandbox,
artifact-boundary, browser, trusted-runtime, smoke, and live walking-skeleton verification.
Agent Ready scanning is an optional technical check rather than an admission requirement.

Do not add a runtime rule, template, URL-specific branch, grader, or domain-specific
generator to make one experimental site look better.
