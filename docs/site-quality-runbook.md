# Private Site Quality Runbook

This program evaluates fresh sites made by the single website-authoring agent. Generated sites remain private, experimental, unpublished, unindexable, and form-disabled until separately reviewed and approved.

## Baseline

The first fresh candidate produced after the clean site-authoring cutover is the experiment baseline. The deleted pre-cutover candidate is historical visual evidence only and is not a comparison fixture.

Before starting a cohort:

1. Run the deployed walking skeleton through the real HTTP APIs with `npm run verify:site-authoring-live-experiment`.
2. Require initial generation, an exact edit, an intervening structural edit, a real `needs_input` pause/resume against an advanced workspace head, and a policy-only change that creates no generation artifacts.
3. Run `npm run verify:r2-lifecycle` and the environment-backed Supabase, sandbox, artifact, browser, recovery, and trusted-runtime checks.
4. Inspect the retained baseline at desktop and mobile sizes. Keep captures and reports under `.data`; never commit generated website output.

## Cohorts

1. Freeze four discovery URLs and at least two ordered spares with `npm run quality:site -- plan --cohort=discovery --round=1 --url=... --spare=...`.
2. Run every target once with `npm run quality:site -- run --cohort=discovery --round=1`. A weak generation stays in the sample. Only an external crawl failure before business understanding may unlock a predeclared spare.
3. Review retained desktop/mobile captures and exact-edit behavior. Record failures by general cause: evidence, skill, prompt, tool, or hard gate.
4. Change the system only for repeatable failures across businesses. Never add URL branches, templates, target-specific prompts, generated-output fixtures, visual baselines, planners, critics, convergence checks, or orchestration gates.
5. After a general fix deploys, freeze three untouched validation URLs. No discovery URL may reappear. If another general fix is needed, create one fresh replacement validation cohort and retain the prior results.
6. Record product-owner and independent reviews. The independent reviewer must not have implemented the change or selected the targets.

The customer-draft criteria are business-specific identity, coherent hierarchy and navigation, grounded factual content, a clear conversion path, finished mobile/desktop presentation, and no need for redesign before owner review.

## Edit Battery

Create a private JSON plan matching `site-edit-battery-v1` for one retained validation site. The required tasks are `element_restyle`, `add_page`, `move_form`, and `mobile_fix`. Run:

```bash
npm run quality:edit-battery -- --plan=<path>
```

Each task must create a distinct verified candidate through ordinary workspace tools and remain unpublished. The exact owner request wins; advisory findings cannot block it. A failure stops the battery and remains in the report.

## Experiment Reset

Use `npm run cleanup:experimental` only with its exact site/business confirmation token. Capture any evidence that should survive first. The command deletes only an unpublished experimental site and returns its blob keys for explicit storage cleanup.

The `site_authoring_maintenance` lease is the only global authoring pause. Acquire it before coordinated schema or deployment work, keep it active through environment verification, and release it before the live walking skeleton.

## Expansion Rule

Do not widen the authoring skill from one site. Prefer better evidence and tools first, then concise knowledge in the skill, then prompts, and finally narrow deterministic hard gates for security, integrity, or publishability. Any new orchestration layer requires an explicit product-owner decision recorded in a plan.
