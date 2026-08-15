# Website Health Report calibration

`WebsiteHealthReport` schema v2 is Lodesta's canonical website-health assessment.
External URLs, retained site artifacts, and published Lodesta sites use the same
criterion registry and scoring policy. Target adapters may acquire different
evidence, but they may not redefine a criterion or its score.

The public projection intentionally withholds the grade until criterion-level
calibration is complete and a product owner explicitly approves public grading.
Internal reports expose the canonical grade, uncapped raw score, evidence
completeness, applied caps, and an ungraded `site_author` subscore for bake-offs.

## Reproducible calibration set

Review at least 30 retained sites across at least five verticals. At least ten sites
must receive independent reviews from two reviewers. A reviewed entry is immutable
and must be pinned to:

- retained `SourceSnapshot` IDs and content hashes;
- the `BusinessState` revision and hash;
- the `SiteIntent` revision and hash;
- the `SitePublicBuildInput` ID and hash;
- the artifact/version and Website Health Report ID and hash;
- the screenshot-set hash;
- the route-selection identity and the three requested semantic slots.

Never replace a retained input with a fresh crawl. A new crawl is a new calibration
entry because research inputs can change independently of the site author or
verifier.

For every applicable model-judged criterion, record the automated status, the
human-supported status, reviewer identity, review timestamp, and a disagreement
note when they differ. Also retain evaluator availability, identity, latency, cost,
and confidence telemetry. Confidence does not make a finding score-eligible.

Run:

```sh
npm run calibrate:website-assessments -- path/to/calibration.json
```

Calibration passes only when:

- the corpus includes 30 sites, five verticals, and ten dual-reviewed sites;
- every scored inferred criterion has at least 85% opportunity precision;
- reviewer agreement is at least 80%;
- automated-to-human ranking agreement is strong (Spearman at least 0.80);
- all disagreements are documented; and
- every retained input, selected slot, and screenshot hash agrees across reviews.

Deterministic disagreements are verifier bugs and have no acceptable error budget.
A model-judged criterion remains advisory and `not_yet_scored` until its
criterion-level calibration is encoded in a new registry identity.

## Evidence and comparability

A dimension with no calibrated, score-eligible criteria is `not_yet_scored`. Its
weight is excluded, the report discloses the active weight and renormalization, and
the dimension cannot trigger a cap. Collection failures instead produce
`insufficient_evidence`: they make the report provisional and disable formal
comparison without penalizing the site's grade.

Formal comparisons require identical registry, scanner, route-selection, viewport,
frame-position, evaluator, and requested semantic-slot identities. Resolved paths
may differ when they satisfy the same semantic slots. The bake-off comparison uses
the ungraded `site_author` subscore; platform, source-research, and shared findings
remain visible but do not change that subscore.

Visual models receive native 1280×900 desktop and 390×844 mobile frames at the top,
middle, and bottom of no more than three semantic routes. Full-page strips are not
valid evidence for typography or defects. Browser measurements decide measurable
properties; the model is limited to calibrated composition and taste.

## Promotion and release rules

Calibration output never promotes a criterion automatically. Before exposing a
public grade, a product owner must approve the registry identity, scoring policy,
and public projection in a recorded plan change.

Subjective design, copy, SEO, CRO, content-depth, trust, and accessibility
heuristics remain advisory. Only deterministic safety, factual, capability, and
functional violations may block a generated candidate. Navigation reachability is
retained as advisory evidence until the current-toolchain artifact corpus and menu
fixtures show every known failure and zero false blocks. Promotion is a clean
verification-policy identity change preceded by the stored-data report; it is not
a runtime flag.

`SiteBuildArtifact.qa` remains the strict prepublication evidence carrier. The
health assessment stores regenerable screenshot and methodology evidence beside
the retained artifact without changing the artifact schema.

## Source-input stability

Compare two retained source preparations with:

```sh
npm run diagnose:source-preparations -- \
  path/to/before-source-snapshot.json \
  path/to/before-business-state.json \
  path/to/after-source-snapshot.json \
  path/to/after-business-state.json
```

The diagnostic reports added, removed, and changed canonical facts and classifies
supported exclusions as deduplication, invalid-value filtering, conflict
suppression, or changed public eligibility. An unclassified removal is an
`unexplained_loss`; affected bake-offs are formally incomparable until it is
reviewed. A raw fact-count decrease alone is not evidence of a recall regression.

## Public report claim boundaries

The public report separates three kinds of output:

- **Measured:** deterministic or calibrated checks backed by retained site evidence,
  including availability, links, browser behavior, mobile layout, metadata, crawl
  access, structured data, content destinations, and available accessibility and
  performance signals.
- **Advisory:** evidence-backed visual/editorial review and emerging AEO or
  agent-readiness observations. These remain clearly labeled and do not affect the
  public grade.
- **Not measured:** live rankings, keyword volume, backlinks, domain authority,
  Search Console performance, competitor share of search, manual
  assistive-technology testing, and completed third-party transactions.

The site-inventory projection reports URLs discovered, selected, assessed, and
failed; substantive and thin sampled pages; and page-type counts for services,
locations, proof, comparisons, editorial content, and other useful destinations.
It always discloses whether the inventory is complete, bounded, restricted,
incomplete, or derived from a retained artifact.

Page quantity is not a ranking proxy. A missing comparison or location page is not
automatically a defect, and a large inventory is not automatically a strength.
Recommendations must be tied to real customer intent and call for specific,
non-duplicative first-party content. External search and competitor performance
requires a separate connected-data or market-research product and must never be
inferred from an on-site crawl.
