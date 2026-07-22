# Product-Path Simplification

Status: implementation complete; deployment pending
Date: 2026-07-22

## Decision

Lodesta has one website-authoring architecture: a strong model working directly in a
safe multi-file workspace, supplied with verified business evidence, ordinary file
tools, a build command, and one release-boundary verifier.

The product is intentionally narrower than a general application builder. It builds and
edits local-business websites. It does not generate authentication systems, application
databases, arbitrary backends, package graphs, or user-defined runtime code.

Complexity belongs at two places:

1. before authoring, where ingestion assembles evidence-backed business context; and
2. after authoring, where deterministic verification, immutable artifacts, publishing,
   and the trusted runtime protect public output.

There is no orchestration framework between the model and its workspace.

## Authority boundary

The strict authorities remain versioned and fail loud: `BusinessStateV3`,
`SiteIntentV3`, `SourceSnapshotV1`, `AssetRevisionV1`, `FormDefinitionV2`,
`SitePublicBuildInputV3`, `SiteWorkspaceRevisionV1`, `SiteBuildArtifactV1`,
`SiteVersionV4`, `TrustedRuntimeSeriesV1`, and `TrustedRuntimePatchV1`.

They have one TypeScript name each. There are no unversioned aliases for versioned wire
contracts. Mutable owner truth advances monotonically; retained inputs, workspaces,
artifacts, versions, and runtime patches remain immutable.

Regenerable operational records use canonical unversioned names: `SiteAgentSession`,
`SiteAgentRun`, and `SiteAgentRunEvent`. Because Lodesta has no production sites, the
2026-07-22 migration is an assert-empty hard cut: an operator explicitly removes any
pre-launch experimental site first, then the migration replaces the active run/event
contracts and drops the obsolete edit-objective table. It does not translate historical
attempts, retain archive tables, or create compatibility paths.

## Canonical flow

1. Ingestion creates canonical business state, site intent, public facts, source
   snapshots, asset revisions, forms, and one immutable public build input.
2. An owner instruction creates one run against the current workspace head.
3. The manager receives a compact evidence packet, one universal authoring skill, the
   owner instruction, and ordinary workspace tools.
4. The model freely creates or edits safe `.ts`, `.tsx`, and `.css` modules beneath
   `src/`, while retaining `src/site.tsx` and `src/styles.css` as required entry files.
5. The model may build and optionally inspect. `finish` automatically performs the same
   verification when no current inspection exists.
6. A passing workspace becomes an immutable workspace revision, build artifact, and
   private candidate. Publishing remains a separate explicit boundary.

There is no planner phase, frozen plan, edit-objective fixture, anchor protocol,
replacement counter, per-tool budget, convergence detector, automatic critic, or
automatic repair continuation. Correctable tool and compiler errors go back to the
model in the same conversation.

## Tools and limits

The manager has nine tools:

- `list_files`
- `read_file`
- `write_file`
- `delete_file`
- `apply_patch`
- `build_preview`
- `inspect_site`
- `request_input`
- `finish`

Standing limits are only the overall deadline, input/output tokens, workspace size, and
platform concurrency. The workspace boundary currently permits at most 80 files and
4 MB of authored source.

## Evidence and skills

The authoring context contains public business evidence, owner-confirmed intent,
eligible assets/forms/capabilities, the exact task, current workspace access, and SDK
usage. Serving-only agent policy and raw crawl payloads are excluded.

There is one universal `website-authoring` skill. It contains concrete knowledge about
evidence use, responsive local-business presentation, conversion paths, exact edits,
and the release boundary. Skills may become more knowledgeable, but they must not become
fixed layouts, section recipes, templates, or vertical generator branches.

## Exact edits and clarification

For an explicit owner edit, the requested outcome wins. Unrelated advisory findings do
not broaden or block the edit. The model preserves unrelated routes and behavior, but
the release boundary does not prohibit an intentional owner-requested removal; it only
blocks resulting broken navigation or links.

Capability meaning is handled by the model, not an instruction-keyword classifier. The
model explains requests outside static-site scope; source policy and release verification
still make custom backends, authentication, databases, networking, and executable browser
code impossible to ship.

`request_input` is available only before the first source mutation:

- the run enters `needs_input` for seven days;
- its sandbox is checkpointed/destroyed and queue capacity is released;
- the question is visible in the workspace and an operational owner notification is
  attempted;
- a timely answer resumes the same run;
- if the workspace head advanced, the run restarts against the current head with the
  conversation retained;
- an answer after expiry cancels the waiting run and creates a new run against the
  current head.

After mutation, the manager proceeds conservatively: it prefers verified evidence,
omits an ambiguous claim, and reports the open question in its owner message. The
owner-facing UI presents this as an answer-needed condition rather than a mysterious
generation failure.

## Verification

`inspect_site` and finalization call the same verification function and configuration.
The inspection identity includes the workspace hash, public-input hash, verification
policy, source policy, toolchain, sandbox image digest, runtime patch, artifact hash,
findings, and captures. A source mutation invalidates the prior build and inspection.

Finalization runs verification itself when the model never inspected. Browser checks
retry once only for transient infrastructure/timing failures; deterministic content or
policy failures do not retry.

Hard blockers are limited to build/render failure, unsafe output, broken routes/assets/
links, invalid capabilities, and unsupported concrete factual assertions such as hours,
prices, credentials, awards, longevity, service areas, warranties, or other verifiable
claims. Puffery, tone, layout preferences, and marketing advice are warnings.

## Policy-only changes and outcome reporting

Agent-access policy is resolved from current `SiteIntentV3` at request/serving time. A
policy-only update changes the authority without creating a build input, agent run,
workspace revision, artifact, or candidate. It does not stale an otherwise current
candidate.

Walking-skeleton reporting treats generation and policy as separate phases. A later
policy failure can never relabel a successfully retained generation candidate as a
generation failure.

## Operational records

Each run has one result, one execution number for bounded crash recovery, and one flat ordered
event stream. Events may describe the run, model requests, tool calls, builds, and
inspections. There are no parent spans or attempt trees. Large payloads are stored by
immutable reference and expire through object-storage lifecycle policy.

## Acceptance suite

The standing implementation checks are:

- `npm run typecheck`
- `npm run verify:site-intent-persistence`
- `npm run verify:site-agent-manager`
- `npm run verify:site-authoring-platform`
- `npm run verify:site-agent-workspace`
- `npm run verify:site-sandbox-local`
- `npm run verify:render-browser`
- `npm run verify:site-authoring-architecture`
- `npm run verify:artifact-storage-boundaries`
- `npm run verify:trusted-runtime`
- `npm run smoke:dev`

The live walking skeleton remains the final environment-backed acceptance: ingest one
real business, generate and inspect a multi-file candidate, perform an exact edit, prove
policy-only isolation, and retain the private candidate for human comparison.

## Coordinated rollout

Implementation and local verification do not mutate shared infrastructure. Roll out the
clean break as one coordinated release:

1. prove the pre-launch agent run, event, and edit-objective tables are empty;
2. apply migrations `202607220001` through `202607220003`;
3. build and deploy the Cloudflare sandbox Worker and its updated container, then record
   the deployed image digest in the code-owned platform manifest;
4. deploy the web application and run worker against that exact manifest;
5. install the one-day `agent-run-events/` object lifecycle rule; and
6. run Supabase, deployed-sandbox, smoke, release-boundary, and live walking-skeleton
   verification before allowing new website runs.

The application and deployed-sandbox verifiers intentionally fail closed while either
side still exposes the prior schema or version manifest.

## Change-control rule

Failures are fixed by improving evidence, skills, prompts, tools, or the hard boundary.
Reintroducing planners, critics, anchor protocols, budgets/counters, mandatory tool
sequences, automatic repair continuations, or convergence gates requires an explicit
product-owner decision recorded in a new plan.
