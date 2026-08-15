# Simplified Site Authoring and Owner Authority

Status: implemented in code; pre-launch data cutover and deployment pending
Date: 2026-07-30

## Decision

Lodesta has one model-led authoring system:

**URL → private project → one capable agent builds → best complete candidate preview →
owner edits and reviews → owner publishes**

The in-app model runner and persistent worker use the same `SiteAuthoringKernel`,
instructions, skill, context, workspace semantics, domain tools, and
candidate-finalization contract. There is no alternate authoring transport or execution
engine in the product.

There are no mandatory briefs, plan boards, critic agents, automatic repair agents,
variant orchestrators, readiness scores, or subjective publishability gates. The one
approved exception is the model-authored, mechanically exhaustive initial-build route
and source-disposition ledger recorded in
`docs/decisions/2026-08-03-luna-architecture-authoring-workflow.md`.

## Creation and source material

A valid public URL from an authenticated user creates a private project and queues
authoring immediately. The same URL may be used by multiple projects and never confers
ownership or reveals another account.

Crawl pages, metadata, structured data, screenshots, research, and retained assets are
provisional source artifacts with provenance. Initial website capture completes as a
separate, model-free preparation step before authoring starts. Its immutable snapshot is
reusable across retries and different authoring prompts, so those runs do not recrawl the
site. It does not have to be transformed into a brief, evidence ledger, or canonical fact
package. If preparation cannot retain a complete snapshot, the run fails clearly and
retryably instead of starting the author with empty or partially attached source data.

A missing or disputed business name does not block project creation. The initial identity
may remain provisional until source research or the owner resolves it.

## One authoring kernel

The shared kernel provides:

- private project and run lifecycle;
- current owner-authoritative business state and site intent;
- raw provisional sources and retained assets;
- persistent safe workspace file operations;
- managed images, forms, actions, maps, and links;
- sandbox build and browser inspection;
- confirmed typed owner-authority changes;
- owner input requests; and
- exact candidate finalization.

For an initial build with a retained website, a Luna High architecture request owns
information architecture and page count; the Luna High workspace author owns layout,
design, copy, responsive behavior, and implementation of that complete ledger. For
edits, rebases, and source-free builds, the workspace author retains ordinary
architectural discretion. Product quality otherwise improves through instructions,
skills, source retrieval, visual references, asset handling, browser inspection, and
managed capabilities.

Standing limits are the overall deadline, metered model-cost fuse, workspace size,
platform concurrency, and the exact deterministic repeated-release-failure guard in
`docs/site-authoring-runaway-guardrails-plan.md`. Token totals are telemetry.

## Authority precedence

The canonical rule is:

> Provisional discoveries may inform a candidate but do not override it. Newer
> owner-authoritative operational or intent changes supersede older candidates.

`ownerOperationalRevision` advances only for authenticated, explicitly confirmed owner
changes to identity, contact details, location, hours, services, external actions,
active assets, managed forms, or enabled capabilities. `ownerIntentRevision` advances
only for explicit owner direction, brand constraints, goals, or site preferences.
Serving-time agent access policy has its own general `SiteIntent.revision` change and
does not advance owner intent or stale site presentation.

Crawl refreshes, search results, inferred facts, and model suggestions never advance
either owner revision and never stale a reviewed candidate.

Settings and chat use the same typed control-plane command. A freeform code edit cannot
change canonical operational state. Applying an owner change records actor and timestamp,
stales older unpublished candidates as `stale_owner_authority`, and queues one coalesced
follow-up authoring update. An active run may finish for history, but its result is stale
and cannot become current.

Restoring an older design restores its presentation and rebases current owner authority
before creating a new candidate. The already-live site is unchanged until the owner
publishes a replacement.

## Candidate integrity

Finalization retains an immutable workspace revision, build artifact, candidate manifest,
and exact private preview. It checks only:

- coherent workspace, input, artifact, and hash references;
- permitted dependencies and retained assets;
- successful compilation and trusted-runtime rendering;
- working internal navigation;
- valid managed forms/actions and runtime patch; and
- complete retained-artifact references.

Technical failures return clear diagnostics to the same run. They do not launch a critic
or open-ended repair workflow. Design taste, SEO/CRO advice, clipping heuristics, model
opinions, crawl freshness, and evidence-completeness scores are advisory.

Candidate integrity states are `current`, `stale_owner_authority`, and
`failed_integrity`; version history additionally retains superseded and published
versions. There is no generic `publishable` state.

## Owner-controlled publication

Finalization never publishes. The owner-only, bodyless publish endpoint selects the exact
candidate already associated with the requested version. It verifies:

- exact authenticated equality with `sites.owner_user_id`;
- retained workspace, artifact, assets, sources, managed forms, and trusted runtime;
- artifact hashes and hard-gate status; and
- both candidate owner revisions equal current owner authority.

Publication does not compare newer crawls or rerun subjective validators. Authority
mismatch is a typed conflict directing the owner to the refreshed candidate or active
update.

## Quality evaluation

Use a small offline canary set covering incomplete sources, multi-location businesses,
weak imagery, conflicting provisional discoveries, and mobile layouts. Judge output by
owner-review usefulness and obvious visual/functional quality. Feed lessons into the
shared skill, tools, and context rather than adding blocking heuristics.

The product promises a strong private first result that the owner reviews and publishes;
it does not promise deterministic factual perfection.

## Clean cut

The live generation-experiment subsystem, variant orchestration, synthetic scorecards,
experiment dashboards, batch preparation UI, evaluator schemas, mandatory brief/plan/
critic artifacts, and business-name bootstrap gate are retired. Historical migrations
remain immutable migration history; the forward clean-cut migration drops their live
tables after an explicit reviewed pre-launch reset.

Strict retained artifact schemas use the new owner-revision fields with no aliases or
dual readers. Migration `202607300001_simplified_site_authoring.sql` intentionally fails
while pre-launch retained site data exists. Run the reset in report mode, review the exact
inventory and confirmation hash, drain authoring, then apply it explicitly before the
migration.

## Acceptance

- URL creation starts authoring without a source-backed business-name gate.
- Partial or contradictory sources still reach a run or clear owner question.
- Provisional refresh does not stale or block a candidate.
- Confirmed owner operational or intent changes stale older candidates and coalesce one
  follow-up update.
- Restored presentation rebases current owner values.
- Broken builds, navigation, assets, forms, runtime, and hashes fail candidate integrity.
- Subjective advice never independently blocks candidate creation or publication.
- All in-app authoring runs use the same worker, run contract, and retained artifact shape.
- Typecheck, smoke, browser rendering, stored-artifact reporting, and the representative
  visual canary pass before deployment.
