# Site Candidate Lifecycle

Lodesta separates generated candidate artifacts from durable managed sites while preserving the immutable inputs behind every retained version.

## Concepts

- **Agent runs** are operational telemetry. They record what happened during generation and remain useful for debugging failures, but they are not product objects.
- **Site candidates** are generated candidate artifacts from intake. A site candidate stores the candidate bundle, source URL, source host, business summary, candidate slug, and acceptance state.
- **Managed sites** are durable public or owner-facing website objects. Claims, publishing, preview tokens, forms, analytics, domains, and billing attach only to managed sites.

## Flow

1. Intake receives a source URL.
2. The agent records a telemetry run.
3. A successful run creates a `site_candidates` row with a `sitecand_...` id and candidate-scoped bundle/asset identity.
4. Admin review happens under `/admin/site-candidates/:id`.
5. Acceptance creates a managed `sites` row with a `site_...` id and managed-site-scoped identity.
6. Preview tokens, public `/sites/*` pages, claims, publishing, analytics, forms, domains, and billing become available only after acceptance.

Failed generations remain visible through `agent_runs`; they do not need failed `site_candidates` rows.

## Identity Rules

Candidate identity is intentionally not stable by source URL. Generating the same source one hundred times should create one hundred separate `sitecand_...` candidates with distinct asset ids and storage paths.

Acceptance is the only place that assigns managed-site identity. During acceptance, Lodesta rewrites the business and site ids, version ids, form ownership, experiment ids, asset ids, public-presence signal ids, and presence-assessment references to the managed `site_...` identity. Every generation and QA artifact referenced by the accepted version is copied to site ownership with provenance and immutable input hashes before candidate cleanup.

Regeneration for an existing managed site creates a new candidate linked by `intendedSiteId` from an exact `GenerationInputSnapshotV1`. Acceptance is blocked when that snapshot is stale relative to current business state or site intent. An accepted candidate appends a new immutable `SiteVersionV3`; older retained versions continue to reference and render their own snapshots, plans, copy, forms, assets, evidence manifests, traces, judge results, themes, and objective QA artifacts. Acceptance never rewrites canonical business state.

Deterministic owner changes recompile the stored plan and copy against a new immutable snapshot without entering the model loop. Copy whose evidence is contradicted by the new snapshot blocks automatic publication and escalates to structural regeneration. Structural owner changes enter the same bounded canonical generation path as managed regeneration.

Acceptance is idempotent: once a candidate has `status = 'accepted'` and `accepted_site_id`, repeated acceptance returns the existing managed site.
