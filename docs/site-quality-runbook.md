# Private Site Quality Runbook

This program evaluates fresh agent-authored sites without templates, generated-output fixtures, or visual baselines. Every site remains `experimental`, private, unindexable, form-disabled, and non-publishable.

## Cohorts

1. Freeze four discovery URLs and at least two ordered spares with `npm run quality:site -- plan --cohort=discovery --round=1 --url=... --spare=...`. This frozen discovery cohort is the first quality baseline; no generated output is committed as a comparison fixture.
2. Run each target once with `npm run quality:site -- run --cohort=discovery --round=1`. A weak generation stays in the sample. Only an external crawl failure before understanding or authoring unlocks a predeclared spare; evidence, model, generation, and verification failures remain.
3. Inspect the retained artifact and captures under `.data/site-quality`. Record shared agent, prompt, SDK, ingestion, or verifier causes. Do not add URL branches, templates, visual baselines, or target-specific rules.
4. After shared fixes deploy, freeze three untouched validation URLs plus spares with `--cohort=validation --round=1`. No prior cohort URL may reappear. If a general platform fix is necessary, exactly one fresh replacement cohort may be frozen with `--round=2 --general-fix-reason="..."`; the first cohort remains immutable.
5. Record the product owner and independent reviews with `npm run quality:site -- review --cohort=validation --round=<1|2>`. The independent reviewer must not have implemented or iterated the builder or selected targets.
6. Run the four-task edit battery and `AGENT_READY_SITE_URLS=... AGENT_READY_REPORT_PATH=.data/site-quality/agent-ready-report.json npm run verify:agent-ready-sites`.
7. Run `npm run quality:site -- pilot-entry --edit-battery-report=<path> --agent-ready-report=.data/site-quality/agent-ready-report.json`. Admission requires three of three eligible candidates, both reviews, all four edits, three live relevant Agent Ready scans, and no exhausted stage or workflow safety budget.

The fixed `credible-customer-draft-v1` criteria are business-specific identity; coherent hierarchy, navigation, and conversion; grounded content; finished desktop/mobile presentation; and customer readiness without redesign. Discovery review also checks that agent CSS did not reduce the managed location panel below its usable presentation floor.

## Edit Battery

Create a private JSON plan matching `site-edit-battery-v1` for one retained validation site. The four required tasks are `element_restyle`, `add_page`, `move_form`, and `mobile_fix`. Run it with `npm run quality:edit-battery -- --plan=<path>`.

Every task must create a passing immutable candidate, apply at least one exact patch, use no post-initial `write_file`, and remain unpublished. Failures stop the battery and remain in its report.

## Pilot

Pilot admission does not make publishing automatic. The first pilot is limited to three concierge owners. Every candidate requires an operator review bound to the exact version and artifact hash before publish. Pilot sites are intentionally indexable only after approved publication. Expansion requires an explicit exit review covering quality, edit reliability, operator intervention, incidents, retention, support burden, latency, and measured model/infrastructure usage. Monetary caps remain deferred until quality and workflow readiness are established.

Before the V3 contract migration, checkpoint and push the verified release, stop initiating generation work, let queued/running work finish, and acquire the global maintenance lease. The acquire command checks for active work before and after taking the lease and releases it if a race is detected:

```bash
npm run maintenance:workspace-cutover -- acquire --minutes=120
npm run maintenance:workspace-cutover -- status
```

Choose one stable `<run-id>`, then create the private recovery evidence while the platform is quiescent:

```bash
npm run snapshot:site-v3-database -- --run-id=<run-id>
npm run audit:artifact-blobs -- --report=.data/maintenance/site-v3-<run-id>-artifact-audit.json
npm run cutover:site-v3 -- --mode=report --run-id=<run-id> --operator=<operator-id> --reason="<reason>" --database-backup=.data/cutovers/site-v3/<run-id>/database.dump --r2-audit-report=.data/maintenance/site-v3-<run-id>-artifact-audit.json
```

Report mode requires an active lease, zero queued/running runs, a PostgreSQL custom-format public-schema dump, and a passing R2 audit. It binds their paths and hashes plus the Supabase hostname into the private report and redacted manifest. Inspect the complete private report and commit/push the redacted manifest before using its exact cleanup token.

Cleanup rechecks the environment, recovery hashes, lease, active-run count, and inventory hash. It destroys every enumerated sandbox first, deletes rows second, and deletes blobs last. An unknown sandbox disposition or partial row cleanup blocks the migration; a blob failure leaves auditable orphans rather than dangling retained references. The migration is assert-only and must encounter no retained pre-cutover site authorities. No cleanup is implicit in deployment or verification.

Keep the lease active through the coordinated broker, sandbox, application, and watchdog deployment and through Supabase, sandbox, smoke, and artifact-boundary verification. Release it only after those checks pass, then run the V3 walking skeleton. A failed skeleton blocks the discovery cohort and is fixed forward; V2 is never restored.
