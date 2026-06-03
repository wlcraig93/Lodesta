# Site Generation Lifecycle

Lodesta separates generated candidate artifacts from durable managed sites.

## Concepts

- **Agent runs** are operational telemetry. They record what happened during generation and remain useful for debugging failures, but they are not product objects.
- **Site generations** are generated candidate artifacts from intake. A generation stores the candidate bundle, source URL, source host, business summary, candidate slug, and promotion state.
- **Managed sites** are durable public or owner-facing website objects. Claims, publishing, preview tokens, forms, analytics, domains, and billing attach only to managed sites.

## Flow

1. Intake receives a source URL.
2. The agent records a telemetry run.
3. A successful run creates a `site_generations` row with a `sitegen_...` id and generation-scoped bundle/asset identity.
4. Admin review happens under `/admin/site-generations/:id`.
5. Promotion creates a managed `sites` row with a `site_...` id and managed-site-scoped identity.
6. Preview tokens, public `/sites/*` pages, claims, publishing, analytics, forms, domains, and billing become available only after promotion.

Failed generations remain visible through `agent_runs`; they do not need failed `site_generations` rows.

## Identity Rules

Generation identity is intentionally not stable by source URL. Generating the same source one hundred times should create one hundred separate `sitegen_...` candidates with distinct asset ids and storage paths.

Promotion is the only place that assigns managed-site identity. During promotion, Lodesta rewrites bundle ids, nested site references, version ids, form ids, finding ids, experiment ids, asset ids, mockup references, and presence assessment references to the managed `site_...` identity.

Promotion is idempotent: once a generation has `status = 'promoted'` and `created_site_id`, repeated promotion returns the existing managed site.
