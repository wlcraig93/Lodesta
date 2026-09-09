# Canonical source-logo authority

Date: 2026-08-14
Status: implemented
Canonical authoring/runtime: V2 (unchanged)

## Decision

Each retained website crawl supplies at most one canonical source-logo presentation asset. The source mirror continues to retain exact response bytes for audit and replay, but raw logo candidates are not authoring choices.

During source preparation the platform ranks retained first-party image resources, selects the strongest usable logo candidate, runs the shared deterministic logo-presentation recipe once, and stores one immutable business-bound asset revision. Its logical asset ID is stable for the business; its revision identity binds the source snapshot, selected source content hash, and recipe version. If no candidate is usable, the crawl remains valid without a logo.

The mutable `BusinessState` contains at most one active source-derived logo. A newly prepared source logo replaces prior source-derived logo references for future build inputs. An active owner-uploaded logo remains authoritative and leaves the prepared source logo inactive. Retained source snapshots, asset revisions, public build inputs, workspaces, artifacts, and versions are never rewritten.

Authors receive the canonical logo through the unchanged managed `Asset` interface. Source visual evidence and source-resource browsing omit raw logo alternatives, and `adopt_source_asset` accepts only non-logo media.

## September 8 amendment: explicitly identify a missed source mark

The August decision assumed logo recognition had succeeded whenever source media reached the author. HD Electric disproved that assumption: a clear crest with an opaque CDN filename appeared in the initial contact sheet, while the managed asset set contained no logo. The tool nevertheless asserted that the logo was already supplied and rejected the logo kind. An earlier author worked around this by calling the crest an icon. Subsequent Luna and Terra attempts omitted or replaced it. This is an interface contradiction, not proof that it alone explains every model choice.

`adopt_source_asset` now permits `kind=logo` only to identify a missed business mark from retained website evidence when no active logo exists. It uses the same canonical materializer, business-stable asset identity, content/snapshot/recipe-bound revision, preparation receipt and verified-finalization transaction as existing source assets. Repeating the same adoption returns the same active canonical ref. A different source logo cannot replace an active source-derived or owner-uploaded logo. The selected resource must belong to a website snapshot already in the authoring input for this business and have an actual retained page/initiator association. New web research cannot confer identity authority through this operation.

Filename labels remain advisory identification hints. The model judges the retained pixels; no detector, model stage, automatic restoration, registry or presentation policy is added. Recognized raw alternatives remain excluded from source browsing. Existing managed logos remain authoritative. Owner intent and existing source still outrank initial-build guidance. If a resource was already retained as non-logo media with the same prepared content, this operation fails rather than rewriting its authority or bypassing content uniqueness.

This is a new-tool-argument capability, not a strict stored-data assertion or migration. Retained assets, public inputs, workspaces, versions and runtime bytes are unchanged. Executable fixtures cover the opaque-resource miss, shared canonical output, invalid page association, idempotent adoption, rejection of source and owner-logo replacement, unchanged source bytes, and form/media authority separation.

## Stored-data review

The pre-change non-production review found:

- 332 sites and business states.
- 312 active source-derived logos.
- Zero businesses with more than one active source-derived logo.
- Zero businesses with simultaneous active owner-uploaded and source-derived logos.
- 20 businesses without an active logo.

Historical immutable records remain unchanged. Migration `202608140002_canonical_source_logo_recapture.sql` was applied to non-production so a future recrawl can atomically retain its canonical logo revision, advance mutable business authority, and create the next public build input without changing owner authority.
