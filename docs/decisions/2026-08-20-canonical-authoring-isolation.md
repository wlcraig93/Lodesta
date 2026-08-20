# Recipe-free V4 isolation

Date: 2026-08-20
Status: implemented; hosted comparison pending

## Decision

Keep the V4 trusted-capability boundary and remove visual recipes from the canonical candidate. Blank initial builds receive the minimal site scaffold plus `src/required-destinations.tsx`, not prebuilt navigation or managed-form components. The author creates the visual system, shared shell, navigation, and form layout directly for the business.

V4 continues to carry V2's audited managed-navigation state machine while emitting no platform icon, geometry, breakpoint, color, spacing, or motion. Its public form surface remains `LeadForm`, `LeadField`, `LeadSubmit`, and `LeadFormStatus`; field identity, validation, revision, status, endpoint, and `lead_inbox` destination remain trusted.

## Rationale

The matched A Step Above comparison tested V4 together with four editable recipe files and recipe-specific guidance. That combined treatment took more time, cost, requests, inspections, and edits than the R8-era control, and its authored mobile recipe created viewport overflow before repair. The result rejects that combined treatment for promotion but does not identify the headless runtime as the cause.

Recipes are therefore removed as an experimental variable. The compact skill expresses Lodesta's outcome preference—a contained full-screen mobile menu is the usual starting point—without supplying a visual implementation. Existing workspace source remains unconditionally preserved during edits. Owner-authoritative customer destinations remain structurally materialized because they are authority, not presentation.

This is a simplification, not a new generator family or product label. Internal provenance remains `site-runtime-v4`; the product exposes one canonical generator after promotion. Historical V4-plus-recipe candidates retain their original source and runtime bytes.

## Evidence sequence

1. Run the same frozen A Step Above authority, inventory, architecture plan, logo, Luna author model, and private cost ceiling against recipe-free V4.
2. Compare hard-gate outcome, infrastructure integrity, cost, duration, model requests, inspection cycles, targeted edits, navigation/form behavior, and human-reviewed composition with the valid R8/V2 control and the V4-plus-recipes arm.
3. Stop and repair if the recipe-free arm has a material functional or convergence failure.
4. If it is at least comparable to R8 without navigation repair churn, run Surge before promotion.
5. Only after recipe-free V4 is established may recipes return as a separate treatment. Their addition must demonstrate material reliability or quality improvement rather than merely encode a plausible default.

No existing public input is repointed by this decision.
