# Site-version publication metadata

The owner-journey canary exposed a committed-publication/failed-response defect on September 6, 2026. PostgreSQL's `to_jsonb(now()::text)` placed a space-separated timestamp with a `+00` offset inside the version JSON. The strict public datetime contract requires ISO format. Publication committed, then `getSiteVersion` rejected the embedded timestamp before applying the already-authoritative relational publication columns.

The read-only stored-data report found 22 retained versions: 21 embedded documents parsed, and the sole failure was the temporary canary's `publishedAt`. All 22 complete projections parsed when lifecycle columns were applied first. No rows were changed. Reproduce the audit with `npm run report:site-version-publication` using the explicit hosted repository configuration.

The canonical reader now assembles the version from its retained fields and authoritative `status`, `published_at`, `replaced_version_id`, and `stale_reason` columns, then validates the complete strict public contract once. Invalid column timestamps, invalid immutable hashes, invalid creation timestamps and other schema violations remain errors. This is not a permissive datetime parser or a fallback runtime. It restores the intended authority order and leaves historical bytes untouched.

Forward migration `202609060001_site_publication_timestamp.sql` changes only `to_jsonb(now()::text)` to `to_jsonb(now())` inside the existing publication function. PostgreSQL serializes the typed timestamp as an ISO JSON string. All ownership, artifact, workspace, input, runtime, form, asset and source checks, row locks, and privileges remain identical. The migration does not rewrite stored version rows.

The repository regression reproduces the observed failure, verifies the correct public projection and unchanged retained payload, and rejects invalid authority. It also compares the entire forward function definition with its predecessor, allowing only the timestamp serialization expression to differ.

Local fixtures do not prove hosted publication or inbox delivery. Record the applied migration, coordinated release, actual public render, anonymous synthetic inquiry, inbox evidence and precise temporary-site cleanup before accepting the customer workflow.

The forward migration was applied to the audited prelaunch database at `2026-09-06T21:26:05Z`, after its read-only dry run verified the live predecessor, complete migration sequence, typed serialization and service-role-only execution. Live database verification passed afterward. The post-migration 22-version report is unchanged: the historical embedded timestamp remains untouched and every authoritative projection is valid. Full local preflight, focused strict-boundary fixtures, TypeScript and sequential standalone smoke passed. Coordinated controller release and the end-to-end owner retest are still pending at this checkpoint.
