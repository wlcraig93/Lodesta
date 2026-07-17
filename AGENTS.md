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
- Boundary-sensitive by default: generated customer-site renderer, theme presets, public `/sites/*` output, preview-token routes, SEO/robots/sitemap behavior, analytics/form submission surfaces, repository/schema contracts that back public/customer flows, auth, billing, webhooks, privacy, and URL-safety logic.
- If uncertain whether a utility, type, API handler, or component affects generated customer websites or public/customer flows, treat it as boundary-sensitive and confirm before changing it.
- When intentionally changing a boundary-sensitive area, make the customer/public behavior explicit and update callers, docs, and tests in the same change.

## Stored Artifact Schema Changes

- Stored artifact policy is two-tier. Strict authorities are normalized canonical business state, `SiteIntentV1`, immutable `SourceSnapshotV1`, `AssetRevisionV1`, `FormDefinitionV1`, `GenerationInputSnapshotV1`, and public `SiteVersionV3`. Public rendering, owner truth, publish gates, form handling, and auditability depend on these shapes.
- Mutable business state and site intent evolve through typed control-plane changes and monotonically increasing revisions. Immutable snapshots, asset revisions, form definitions, and site versions are never rewritten or backfilled in place; schema evolution creates a new version and readers must support every retained version.
- Regenerable intermediates are caches: `businessUnderstanding`, `generationPlan`, `siteCopy`, evidence manifest, generation trace, generation judge, and similar prompt/debug artifacts may be added or reshaped without a historical backfill. Old internal candidates may simply lack them or show a stale/regenerate notice in admin surfaces.
- Regenerable does not mean unaccountable. Intermediates that affect a generated or published candidate should carry provenance where practical: producer/prompt/config version, model id when model-backed, input hashes, timestamp, and a stale marker or equivalent regeneration signal. Evidence snapshots that fed a published version must remain answerable for as long as that version exists.
- Source snapshots, asset revision binaries, form definitions, generation snapshots, and artifacts referenced by a retained version must use delete-restrict or independent-copy semantics. Owner deletion marks mutable assets inactive for future versions; it never breaks a retained version.
- Do not delete stored rows from migrations to satisfy a strict schema change; backfill or report them so an operator decides. Pre-launch test data may be deleted only by an explicit operator command before an assert-empty hard cutover.
- Keep strict fail-loud assertions on boundary-sensitive surfaces (public `/sites/*`, owner editor, APIs). Admin/operator surfaces must degrade legibly instead: soft-check with `siteVersionV3Issue` and show a "stale schema — regenerate" notice, never a raw error page. Repository reads of internal candidate records stay unchecked so repair surfaces can load stale rows; writes assert.
- When adding a new strict assertion, run the stored-data report first and prove zero violations or perform an explicit pre-launch hard cutover. Never add a compatibility reader without an external boundary requirement.

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
- Generated customer websites are boundary-sensitive and remain governed by `--site-*`, the public renderer, and theme presets.
