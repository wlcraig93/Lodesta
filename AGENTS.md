# Agent Instructions

## Project Context

Lodesta is an AI-first managed website and local-presence platform for US small businesses. This repo is in pre-launch development and currently has no production customers.

## Pre-Launch Operating Mode

- Prefer clean go-forward implementations over backwards compatibility for all pre-launch internal product work.
- For internal/admin/dev schemas, APIs, routes, types, jobs, fixtures, and workflows, replace obsolete shapes and paths instead of maintaining dual legacy/new behavior.
- When replacing behavior, update all known callers, tests, fixtures, docs, scripts, and migrations to the new canonical implementation in the same change, then remove the obsolete path.
- Do not add aliases, compatibility redirects, dual read/write paths, fallback dispatch, deprecation layers, or feature flags solely to preserve old internal behavior.
- Keep one canonical implementation for product behavior, models, UI patterns, and configuration.
- Preserve compatibility only when explicitly requested or when required for security, privacy, data safety, external platform contracts, or boundary-sensitive public/customer behavior.
- Update or remove this pre-launch section when the first production customer is onboarded.
- This operating mode does not override security, privacy, data safety, or explicit user instructions.

## Compatibility Boundary

- Clean-breakable by default: admin/operator UI, settings, dashboards, intake/admin workflows, local dev tooling, docs, and internal component patterns.
- Boundary-sensitive by default: finalized customer-site artifacts, trusted-runtime resolution, public `/sites/*` output, preview routes, SEO/robots/sitemap behavior, analytics/form submission surfaces, repository/schema contracts that back public/customer flows, auth, custom domains, adoption invitations, privacy, and URL-safety logic.
- If uncertain whether a utility, type, API handler, or component affects generated customer websites or public/customer flows, treat it as boundary-sensitive and confirm before changing it.
- When intentionally changing a boundary-sensitive area, make the customer/public behavior explicit and update callers, docs, and tests in the same change.

## Simplification Doctrine

- The website agent gets broad freedom while authoring. Facts, security, capabilities, asset rights, and release integrity are enforced at the verification gate, release service, and trusted runtime.
- When generation or editing fails or produces poor output, fix it by improving context, skills, prompts, tools, or the hard verification gate — never by adding orchestration between the model and its workspace.
- Do not add planning phases, mandatory tool sequences, edit-anchor or replacement-count protocols, per-action budgets or counters, automatic critics, automatic repair continuations, or convergence checks. Reintroducing any of these requires an explicit product-owner decision recorded in a plan document.
- The standing run limits are the overall deadline, metered model-cost fuse, workspace size, and concurrency. Input/output token totals are telemetry, not terminal budgets. The sole approved convergence exception is the exact deterministic release-failure guard recorded in `docs/site-authoring-runaway-guardrails-plan.md`. Prefer deleting a constraint over tuning it.
- Subjective quality findings (design, copy, SEO/CRO heuristics) are advisory. Only safety, factual, capability, and functional violations block a candidate, and an explicit owner edit is never blocked by unrelated subjective findings.

## Stored Artifact Schema Changes

- Stored artifact policy is two-tier. Strict authorities are normalized `BusinessState`, `SiteIntent`, immutable `SourceSnapshot`, `AssetRevision`, `FormDefinition`, `SitePublicBuildInput`, `SiteWorkspaceRevision`, `SiteBuildArtifact`, public `SiteVersion`, `TrustedRuntimeSeries`, and `TrustedRuntimePatch`. Each retained payload carries numeric `schemaVersion: 1`. Public rendering, owner truth, publish gates, form handling, runtime security, and auditability depend on these shapes.
- Mutable business state and site intent evolve through typed control-plane changes and monotonically increasing revisions. Immutable source snapshots, asset revisions, form definitions, public build inputs, workspace revisions, build artifacts, runtime patches, and site versions are never rewritten in place. After production data exists, schema evolution increments the numeric payload version and readers support every retained version.
- `SiteAgentRun`, `SiteAgentSession`, `SiteAgentRunEvent`, screenshots, transient build logs, and prompt/debug artifacts are regenerable intermediates. They may be added or reshaped through an explicit clean cut without historical backfills, but any intermediate that affects a candidate must carry producer, model, skill, input-hash, timestamp, and stale/regeneration provenance where practical.
- `WorkspaceSourceSidecar` is an immutable derived artifact bound to a retained `SiteWorkspaceRevision` by archive key/hash and source hash. It is never rewritten, uses delete-restrict semantics while its revision is retained, and may be regenerated only by an explicit operator command that verifies the retained workspace archive and revision manifest.
- Source snapshots, asset revision binaries, form definitions, public build inputs, workspace archives, build-artifact bytes, and runtime patches referenced by a retained version must use delete-restrict or independent-copy semantics. Owner deletion marks mutable assets inactive for future versions; it never breaks a retained version.
- Do not delete stored rows from migrations to satisfy a strict schema change; backfill or report them so an operator decides. Pre-launch test data may be deleted only by an explicit operator command before an assert-empty hard cutover.
- Keep strict fail-loud assertions on boundary-sensitive surfaces (public `/sites/*`, owner workspace, APIs). Admin/operator surfaces must degrade legibly instead: soft-parse retained contracts and show a "stale schema - rebuild" notice, never a raw error page. Repository reads of failed internal runs may stay soft so repair surfaces can load them; authority writes assert.
- When adding a new strict assertion, run the stored-data report first and prove zero violations or perform an explicit pre-launch hard cutover. Never add a compatibility reader without an external boundary requirement.

## Account And Ownership

- Authentication is the only identity requirement for creating and publishing a Lodesta-hosted project.
- `sites.owner_user_id` is the sole owner authorization source. Owner access uses exact authenticated user-ID equality; email, source URL, business contact data, invitations, and acquisition records never authorize a site.
- Source URLs are reusable and confer no ownership. Same-account matches may prompt for confirmation but never block creation or disclose another account.
- Only verified DNS proof grants an exclusive custom hostname. Pending proof attempts are non-exclusive.
- Application tables are server-only through service-role repositories. Browser Supabase clients are for Auth only; application tables use RLS with no `anon` or `authenticated` policies.
- Account deletion is intentionally restricted while sites are owned. A future deletion flow must transfer or explicitly dispose of owned sites first.

## Secrets And Data

- Never log, commit, or invent real secrets.
- Use `.env.example` for documented placeholder configuration only.
- Do not use production customer data in tests, fixtures, screenshots, or docs.

## Stack Context

- Use the existing stack: Next.js App Router, React, TypeScript, plain global CSS, Supabase, Playwright, and Zod.
- Do not introduce Tailwind, shadcn/ui, Radix, component libraries, or new styling frameworks unless explicitly requested.
- Prefer existing repository boundaries, data models, scripts, and style patterns before adding new abstractions.

## Testing Guidance

- Run `npm run typecheck` after TypeScript or route/API changes.
- Run `npm run smoke` when a dev server is already running, or `npm run smoke:dev` when one is not, for launch-flow behavior changes.
- Run `npm run verify:render-browser` when touching browser rendering, preview rendering, generated-site rendering, or Playwright-backed inspection behavior.
- If tests fail in clean-breakable areas, fix them directly. If a failure involves boundary-sensitive customer/public behavior and the fix is not clearly within the requested task, stop and confirm before changing that behavior.

## Git Hygiene

- Check `git status --short` before editing so existing user or agent changes are visible.
- Do not commit automatically unless the user explicitly asks for a commit, PR, or publish-style handoff.
- Stage only files changed for the current task. Do not stage unrelated dirty files.
- Before committing, inspect the staged diff, run the relevant verification, and use a focused commit message.
- Never revert user changes unless the user explicitly requests it.

## Design Boundary

- Follow `docs/design/lodesta-product-design-language.md` for Lodesta-owned product UI.
- Do not use internal Lodesta UI work as a reason to touch generated customer-site design.
- Generated customer websites are boundary-sensitive and remain governed by finalized immutable artifacts, the trusted runtime, and artifact verification. Lodesta product UI rules do not constrain agent-authored customer-site presentation.
