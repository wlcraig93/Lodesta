# Shared retained source mirrors

Status: implemented for controlled retained-mirror reuse

## Decision

Website-source freshness and retained storage identity are separate concerns.

- A `SourceSnapshot` remains an immutable, business-scoped authority and remains the only source ID stored in build inputs and finalized site versions.
- The large retained website corpus (resources, indexed pages, extracted text, and search vectors) may be owned by one ready website snapshot and referenced by other exact-match website snapshots through `source_snapshot_mirror_references`.
- A reference is immutable, delete-restricted, server-only, and may target only a ready, non-reference website mirror with the same source URL, content hash, and payload.
- Reference snapshots cannot own page or resource rows. Database triggers enforce that invariant.
- Repository reads project the requesting business-scoped snapshot ID over the shared rows, so authoring, search, replay, coverage, and integrity checks continue to operate on the site's own authority.

## Crawl policy

- Normal authoring reuses the website snapshot already attached to its current public build input. It does not recrawl merely because another authoring run starts.
- An explicit source recapture performs a real network crawl. It is not satisfied by a time-window cache.
- If an explicit recapture produces the same content hash as the current website snapshot, the existing snapshot and build input remain current and no duplicate mirror rows are written.
- At the repository persistence boundary, any newly crawled result with the same exact source URL and content hash as another ready canonical mirror becomes a business-scoped reference automatically. The crawl still supplies fresh fact extraction, but its page/resource/search corpus is not duplicated.
- Controlled experiments may explicitly pin an existing retained mirror. They create a new business-scoped snapshot reference and do not perform a network crawl or clone retained page/resource rows.
- New customer intake still crawls unless a future replay-based ingestion path can reproduce all derived business facts, assets, and diagnostics from the retained mirror. A recent URL match alone is not sufficient evidence to reuse another customer's derived authority.

## Why there is no generic TTL cache

A URL-level TTL mixes two different questions: whether the public website should be fetched again, and whether identical captured bytes should be stored twice. It can silently reuse stale facts, while still failing to deduplicate two crawls that happen outside the TTL. Explicit recapture plus content-addressed retention gives predictable freshness and exact storage reuse.

## Safety properties

- Source URLs do not confer ownership or authorization.
- Candidate integrity continues to require every referenced `SourceSnapshot.businessId` to match the site business.
- Shared physical rows never replace the business-scoped authority.
- References cannot chain, cannot point to incomplete snapshots, and cannot be rebound.
- No existing retained rows are deleted or rewritten by the migration.
