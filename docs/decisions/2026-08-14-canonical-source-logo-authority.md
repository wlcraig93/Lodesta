# Canonical source-logo authority

Date: 2026-08-14
Status: implemented
Canonical authoring/runtime: V2 (unchanged)

## Decision

Each retained website crawl supplies at most one canonical source-logo presentation asset. The source mirror continues to retain exact response bytes for audit and replay, but raw logo candidates are not authoring choices.

During source preparation the platform ranks retained first-party image resources, selects the strongest usable logo candidate, runs the shared deterministic logo-presentation recipe once, and stores one immutable business-bound asset revision. Its logical asset ID is stable for the business; its revision identity binds the source snapshot, selected source content hash, and recipe version. If no candidate is usable, the crawl remains valid without a logo.

The mutable `BusinessState` contains at most one active source-derived logo. A newly prepared source logo replaces prior source-derived logo references for future build inputs. An active owner-uploaded logo remains authoritative and leaves the prepared source logo inactive. Retained source snapshots, asset revisions, public build inputs, workspaces, artifacts, and versions are never rewritten.

Authors receive the canonical logo through the unchanged managed `Asset` interface. Source visual evidence and source-resource browsing omit raw logo alternatives, and `adopt_source_asset` accepts only non-logo media.

## Stored-data review

The pre-change non-production review found:

- 332 sites and business states.
- 312 active source-derived logos.
- Zero businesses with more than one active source-derived logo.
- Zero businesses with simultaneous active owner-uploaded and source-derived logos.
- 20 businesses without an active logo.

Historical immutable records remain unchanged. Migration `202608140002_canonical_source_logo_recapture.sql` was applied to non-production so a future recrawl can atomically retain its canonical logo revision, advance mutable business authority, and create the next public build input without changing owner authority.
