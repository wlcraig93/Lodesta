# Lodesta Product Design Language

## Direction

Lodesta-owned UI should feel like an AI operations workspace: modern, dense, calm, precise, evidence-forward, and action-oriented. The useful reference set is Ramp, Linear, and Roadrunner-style SaaS, adapted to Lodesta's managed website and local-presence workflows.

This document applies to Lodesta product, marketing, admin, editor, account, settings, and internal review surfaces. It does not apply to generated customer websites, which remain governed by `--site-*`, the public site renderer, and theme presets.

## Product Vocabulary

Design around the actual operating objects in the product:

- Agent runs: generation, crawl, objective QA, final visual judgment, publication, maintenance, and telemetry steps.
- Evidence: source facts, crawl notes, rendered screenshots, scores, checks, leads, and analytics signals.
- Approvals: owner-confirmed facts, asset-rights attestations, objective QA gates, publish confirmation, and safe apply actions.
- Next actions: the smallest useful operator or owner action available from the current state.
- Comparisons: source site versus generated site, current version versus draft, failing checks versus resolved checks.

## Visual Principles

- Use a quiet product canvas with white or lightly raised surfaces.
- Favor compact information density over landing-page composition.
- Keep hierarchy explicit through typography, spacing, border weight, and position before decoration.
- Use panels for bounded work objects, not for every section of a page.
- Make agent activity legible with stages, statuses, evidence, and outcomes.
- Do not use decorative dashboards, generic website-builder chrome, gratuitous gradients, or marketing-first admin screens.

## Color Roles

- Forest (`--product-color-primary`) is the primary product action color. Use it for decisive actions, active states, progress fills, and focused product intent.
- Amber (`--product-color-intelligence`) is reserved for agent/intelligence signals: automation highlights, recommendations, suggested next steps, pending attention, and generated insight. Do not use amber for ordinary primary buttons.
- Status colors are semantic only: success, warning, error, and info states should use the matching status tokens.
- Customer-site color is separate. Do not use `--site-*` to style Lodesta-owned UI, and do not change generated customer-site styling to satisfy product UI needs.

## Tokens

Lodesta-owned UI uses `--product-*` CSS custom properties from `app/product-tokens.css`.

- Surface tokens describe product app chrome: canvas, raised canvas, panels, selected states, disabled states, and inverse code blocks.
- Text tokens describe role, not shade: default, subtle, muted, tertiary, inverse, nav, and nav-subtle.
- Border tokens describe strength: default, subtle, strong, emphasis, dashed.
- Elevation tokens describe use: card, soft card, preview, focus, and error.
- Token names are mode-ready so future dark-mode overrides can be added without changing call sites.

## Typography

Lodesta uses two intentionally scoped sans-serif families. Inter is the product family for editor, admin, owner/account, authentication, forms, tables, navigation, and other application UI; it is exposed through `--product-font-sans` and is the root default. Figtree is the brand family for the marketing home surface, marketing header and footer, and brand-led marketing headings; it is exposed through `--brand-font-sans`. Both families are self-hosted as normal and italic variable WOFF2 files through `next/font/local`. The Lodesta wordmark remains independent outlined artwork and does not determine the application font.

Use `--product-font-weight-regular` (400) for reading, `--product-font-weight-medium` (500) for most controls and headings, and `--product-font-weight-strong` (600) only for important metrics or urgent state emphasis. Font tokens must include an internal `ui-sans-serif` fallback so a missing Next.js font variable can never invalidate the complete declaration or expose the browser-default serif.

| Role | Size | Weight | Line height |
| --- | ---: | ---: | ---: |
| Diagnostic microcopy and overlines | 12px | 500 | 1.3 |
| Metadata, captions, and badges | 13px | 500 | 1.35 |
| Compact controls and navigation | 14px | 500 | 1.3 |
| Primary UI and chat text | 15px | 400 | 1.5 |
| Inputs and reading copy | 16px | 400 | 1.55 |
| Lede and supporting copy | 18px | 400 | 1.55 |
| Panel heading | 20px | 500 | 1.25 |
| Product page title | 30px desktop / 26px mobile | 500 | 1.15 |
| Marketing section heading | 32–56px fluid | 500 | 1.05 |
| Marketing hero heading | 48–84px fluid | 400 | 0.98 |

Use size, spacing, text-color roles, borders, and selected surfaces before adding font weight. Uppercase and tracking are limited to short overlines, diagnostic labels, and compact status badges; buttons, navigation, headings, and ordinary labels use sentence or title case. Keep `--product-font-mono` for identifiers and code. The Google OAuth control may retain its vendor-specific typography.

Generated customer websites and all content rendered inside preview iframes are explicitly outside this contract. They remain governed by immutable artifacts, the trusted runtime, and `--site-*`; never alter their typography as part of Lodesta product UI work.

## Recipes

### App Shell

Use for Lodesta-owned navigation and workspace structure. Keep navigation persistent, direct, and compact. The shell should help an operator understand where they are and what work object is active.

### Page Header

Use for the object and task currently in focus. Prefer one short label, one clear title, concise supporting copy, and the most important action. Avoid hero-scale typography in operational screens.

### Toolbar

Use for filters, mode switches, and view-level actions. Controls should remain compact and predictable.

### Panel

Use for a bounded work object, such as a report section, run summary, QA group, or version group. Panels use default surface, border, radius, and card shadow tokens.

### Metric Card

Use for a small numeric or state summary. Metrics should be scannable and should not carry explanatory copy that belongs in a panel.

### Table

Use for lists where comparison matters. Keep headings terse, labels stable, and actions predictable.

### Badge

Use for status, category, severity, or provenance. Badges should be semantic, not decorative.

### Button

Use forest primary buttons only for decisive actions. Secondary buttons should remain neutral. Do not style Lodesta product buttons with `--site-*`.

### Segmented Control

Use for mode switches with mutually exclusive values, such as draft versus QA review or preview dimensions. Active states use forest, not amber.

### Evidence Card

Use for source facts, crawl notes, findings, screenshot artifacts, or proof items. Evidence cards should name the evidence type, state the finding, and include the provenance or consequence when available.

### Preview Frame

Use for embedded generated-site previews and review packets. The frame should stay visually neutral so the customer site remains inspectable.

### Agent Timeline

Forward-looking pattern for run stages and model/tool activity. Show stage, state, timestamp or duration, and important output. Amber can mark intelligent suggestions or generated insights, not every step.

### Command Dock

Forward-looking pattern for structured agent edits and operator commands. It should pair a concise request surface with status, guardrails, and resulting operations.

## Implementation Rules

- Add or update Lodesta-owned UI with `--product-*` tokens.
- Keep application UI on `--product-font-sans`; reserve `--brand-font-sans` for the documented marketing boundary.
- Keep generated customer websites on `--site-*`.
- Do not introduce Tailwind, shadcn/ui, Radix, component libraries, remotely loaded fonts, or a new icon set unless explicitly requested.
- Prefer existing global classes and local React components until repeated product UI patterns justify a component library.
