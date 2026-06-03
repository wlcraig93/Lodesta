# Lodesta Product Design Language

## Direction

Lodesta-owned UI should feel like an agentic operations workspace: modern, dense, calm, precise, evidence-forward, and action-oriented. The useful reference set is Ramp, Linear, and Roadrunner-style SaaS, adapted to Lodesta's managed website and local-presence workflows.

This document applies to Lodesta product, marketing, admin, editor, account, settings, and internal review surfaces. It does not apply to generated customer websites, which remain governed by `--site-*`, the public site renderer, and theme presets.

## Product Vocabulary

Design around the actual operating objects in the product:

- Agent runs: generation, crawl, visual QA, publication, maintenance, and telemetry steps.
- Evidence: source facts, crawl notes, rendered screenshots, scores, checks, leads, and analytics signals.
- Approvals: owner-confirmed facts, QA gates, publish confirmation, billing/claim gates, and safe apply actions.
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
- Keep generated customer websites on `--site-*`.
- Do not introduce Tailwind, shadcn/ui, Radix, component libraries, external fonts, or a new icon set unless explicitly requested.
- Prefer existing global classes and local React components until repeated product UI patterns justify a component library.
