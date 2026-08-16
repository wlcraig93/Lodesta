# Managed capabilities, editable recipes, and Runtime V4

Date: 2026-08-15
Status: implemented in the repository; diagnostics, treatment screen, and deployment promotion pending

## Decision

Lodesta keeps one canonical website generator and separates five responsibilities:

1. Owner authority owns facts, field schemas, destinations, enabled capabilities, and authorized integrations.
2. Trusted capabilities own behavior that must remain safe and reliable, including managed form submission and managed navigation state, focus, and approved destinations.
3. Editable source recipes provide Lodesta's opinionated first implementation and appearance.
4. The prompt and authoring skill explain ownership, precedence, and contextual adaptation.
5. Verification blocks objective safety, factual, capability, accessibility, and functional failures without enforcing one visual template.

The go-forward trusted runtime is `site-runtime-v4`. V3 keeps its immutable experiment provenance and is not redefined. V4 carries forward V2's audited navigation state machine and managed-form behavior while removing platform-owned navigation artwork and presentation.

The repository implementation selects V4 for new authoring. Deployment promotion and current-input repointing remain deliberately separate operations and may occur only after the mechanistic diagnostic, six-run treatment screen, release verification, stored-data report, and maintenance-fenced cutover.

## Why recipes live in source instead of the prompt or runtime

A prompt can describe a design goal, but it reproduces exact component code probabilistically. That is the wrong place for a dependable initial implementation. A trusted runtime can reproduce code exactly, but presentation placed there competes with the generated site and prevents an owner from freely changing it.

Editable recipe files give every blank initial build a concrete, working starting point while remaining ordinary workspace source. The author can adapt tokens or structure, and later owner edits preserve the result unconditionally. Runtime code remains limited to behavior that Lodesta must trust. The prompt therefore carries only judgment and precedence: managed capabilities own behavior, recipes are editable defaults, and owner intent plus existing source outrank those defaults.

This boundary removes the prior contradiction in which the prompt named a `MobileNavigation` convention absent from a blank workspace while V2 CSS silently supplied icon and panel presentation.

## Navigation boundary

V4 exposes `NavigationDisclosure` as an optional managed behavior primitive and requires explicit authored trigger content. It renders no fallback icon. Runtime owns open state, accessible labels, Escape handling, focus containment and restoration, inert background, modal scroll locking, one-open-at-a-time behavior, and internal-link closing. Workspace source owns artwork, breakpoints, placement, dimensions, animation, hierarchy, and appearance.

The only V4 platform CSS for navigation is the functional hidden-state rule for a managed panel. Verified native semantic navigation remains an allowed escape hatch.

## Managed-form boundary

The V4 authoring SDK exposes only `LeadForm`, `LeadField`, `LeadSubmit`, and `LeadFormStatus`. `LeadField` owns each label/control association and permits wrapper, label, control, help-text styling. `LeadForm` without children still renders the complete retained schema automatically.

Field identity, revision, validation semantics, status handling, endpoint, and the `lead_inbox` destination remain Lodesta-owned. V4 rejects low-level legacy imports, invented or duplicate fields, missing configured fields, missing status output, and alternate destinations. `LeadLabel` and `LeadControl` remain available only to legacy SDKs needed by retained artifacts.

## Recipe provenance and preservation

Blank initial-build workspaces contain a token-driven full-screen mobile-navigation recipe and a schema-driven managed-form recipe, each with component-scoped CSS. Every recipe file starts with a comment-compatible header containing an ID, version, and SHA-256 hash of the exact UTF-8 body bytes after the header.

Exact body bytes classify the recipe as untouched. Missing headers, whitespace-only changes, formatting changes, and structural changes all classify it as customized. This asymmetry is intentional: a false customized result may suppress an upgrade offer, while a false untouched result could overwrite owner work.

Provenance is deterministic tooling metadata, not a model judgment. The authoring skill unconditionally preserves existing workspace source during edits, restores, and unrelated requests. Recipes are materialized only for blank initial builds or an explicitly owner-approved full rebuild; they are never injected, restored, or upgraded automatically.

Recipe CSS is scoped beneath recipe-specific roots, consumes shared `--site-*` tokens, and is self-contained under the sandbox's alphabetical multi-CSS loading. It does not depend on relative stylesheet order.

## Verification boundary

Managed and native navigation share visible-trigger, destination reachability, opened-state, keyboard, Escape, focus, scroll-lock, and viewport verification. V4 verification does not require or measure legacy platform-icon geometry. Header position, density, and aesthetic preference remain advisory.

Managed-form verification requires the retained schema exactly once, one status region, the correct revision and destination, and successful inbox submission for both automatic and custom layouts.

## Stored data, rollout, and rollback

The read-only `report:managed-capabilities-cutover` command inventories all strict public inputs, workspace revisions, artifacts, versions, runtime series, runtime patches, retained navigation/form imports, and owner-created revisions. It does not mutate stored rows.

The `cutover:managed-capabilities` command is dry-run by default. Applying it requires an audited compatible V4 patch, the active `site_authoring_maintenance` lease, zero running or queued authoring runs, an operator identity, and explicit per-site approval when the current workspace revision was owner-created. It creates new immutable V4 public inputs and repoints only mutable current-input references through an atomic expected-current-input fence, so a concurrent authority change cannot be overwritten. It never rewrites retained inputs, workspaces, artifacts, versions, or runtime patches.

Historical rendering remains for every runtime series proven referenced by retained artifacts. Older series are not selectable for new authoring and receive no aliases, fallback dispatch, or live selector. During soak, rollback restores the prior pinned blue/green sandbox deployment and prior immutable current-input references; it does not introduce dual live authoring.

## Future integrations

Raw iframe authoring remains forbidden. Future booking and embeds use `SiteIntent.enabledCapabilities` for capability availability. Authenticated provider connection, enablement, destination, and external-action changes advance `ownerOperationalRevision` under the existing operational-authority contract. No parallel authorization store is permitted. Workspace source may own placement and framing; trusted runtime and release verification own provider security and integrity. Unsupported providers degrade to approved link-outs.

This decision does not implement booking, providers, new schemas, a registry, variants, a builder, arbitrary JavaScript, feature flags, critics, repair orchestration, or convergence machinery.

## Evidence gates still required

Promotion remains blocked until evidence is appended for:

- a same-authority V2/V4 mechanistic diagnostic proving one authored trigger without platform collision and a custom responsive form using only the narrowed SDK;
- three independent Kind and three independent Surge V4-plus-recipe runs passing the release gate without repeated navigation/form loops or sandbox submission recovery;
- release verification, including TypeScript, authoring/runtime contracts, browser rendering, and smoke coverage; and
- the read-only retained-data report and an audited maintenance-fenced cutover record.

The six-run screen evaluates reliability, variance, and repeated brand adaptation. It does not establish broad cross-business template similarity. That judgment is deferred to side-by-side opened mobile menus from at least ten distinct businesses in the first prebuild batch.

## Retained-data report

The read-only report ran against configured storage on 2026-08-15 (America/Chicago) and found:

| Strict record | Count | Runtime distribution |
| --- | ---: | --- |
| Sites | 336 | all 336 current inputs require a new immutable V4 input |
| Public build inputs | 414 | V1 405; V2 4; V3 5 |
| Workspace revisions | 368 | V1 364; V2 2; V3 2 |
| Build artifacts | 368 | V1 364; V2 2; V3 2 |
| Site versions | 368 | V1 364; V2 2; V3 2 |
| Runtime series | 3 | V1, V2, and V3 |
| Runtime patches | 6 | retained across the three series |

All 368 retained workspace sidecars were present and matched their revisions. No current workspace revision was owner-created, and no retained source bypassed `#lodesta-sdk` through a relative legacy SDK path. Retained sources still use low-level form imports (`LeadLabel` 192 revisions and `LeadControl` 201 revisions) and managed navigation (`NavigationDisclosure` 365 revisions).

Therefore V1, V2, and V3 rendering bytes and their legacy SDKs must remain available for retained artifacts. They may be removed only from new-authoring selection. No stored row qualifies for rewriting or deletion, and the cutover must create 336 new immutable V4 public inputs before repointing the corresponding mutable current-input references.
