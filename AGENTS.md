# Agent Instructions

## Project Context

Lodesta is an AI-first managed website and local-presence platform for US small businesses. This repo is in pre-launch development and currently has no production customers.

## Pre-Launch Operating Mode

- Prefer clean go-forward implementations over backwards compatibility.
- Remove obsolete paths when replacing behavior.
- Avoid compatibility shims unless the user explicitly requests them.
- Keep one canonical implementation for product behavior, models, UI patterns, and configuration.
- Update or remove this pre-launch section when the first production customer is onboarded.
- This operating mode does not override security, privacy, data safety, or explicit user instructions.

## Compatibility Boundary

- Clean-breakable by default: admin/operator UI, settings, dashboards, intake/admin workflows, local dev tooling, docs, and internal component patterns.
- Boundary-sensitive by default: generated customer-site renderer, theme presets, public `/sites/*` output, preview-token routes, SEO/robots/sitemap behavior, analytics/form submission surfaces, repository/schema contracts, auth, billing, webhooks, privacy, and URL-safety logic.
- If uncertain whether a utility, type, API handler, or component affects generated customer websites or public/customer flows, treat it as boundary-sensitive and confirm before changing it.
- When intentionally changing a boundary-sensitive area, make the customer/public behavior explicit and update callers, docs, and tests in the same change.

## Stack Context

- Use the existing stack: Next.js App Router, React, TypeScript, plain global CSS, Supabase, Playwright, and Zod.
- Do not introduce Tailwind, shadcn/ui, Radix, component libraries, or new styling frameworks unless explicitly requested.
- Prefer existing repository boundaries, data models, scripts, and style patterns before adding new abstractions.

## Testing Guidance

- Run `npm run typecheck` after TypeScript or route/API changes.
- Run `npm run smoke` when a dev server is already running, or `npm run smoke:dev` when one is not, for launch-flow behavior changes.
- Run `npm run verify:render-browser` when touching browser rendering, preview rendering, generated-site rendering, or Playwright-backed inspection behavior.
- If tests fail in clean-breakable areas, fix them directly. If a failure involves boundary-sensitive customer/public behavior and the fix is not clearly within the requested task, stop and confirm before changing that behavior.

## Design Boundary

- Follow `docs/design/lodesta-product-design-language.md` for Lodesta-owned product UI.
- Do not use internal Lodesta UI work as a reason to touch generated customer-site design.
- Generated customer websites are boundary-sensitive and remain governed by `--site-*`, the public renderer, and theme presets.
