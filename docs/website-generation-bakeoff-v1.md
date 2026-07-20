# Website Generation Bakeoff V1

**Status:** Historical protocol. The product direction was concluded qualitatively by the owner after directly reviewing the generated sites; the locked questionnaire was not completed and this protocol must not be resumed as if it were completed evidence.

**Status:** Concluded by qualitative product decision

**Decision:** Retain canonical ingestion and shared capabilities; replace templated presentation with an agent-authored freeform website workspace.

## Outcome

The generated contestant sites were reviewed, but the owner did not complete the full preregistered pairwise questionnaire in the review UI. The run therefore has no completed quantitative result and must not be represented as satisfying the numerical decision thresholds below.

The visual difference was sufficient for the owner to make the product decision without finishing that scoring workflow: canonical ingestion remains valuable, while the planner/compiler/template presentation strategy will be replaced by the architecture in [agentic-site-workspace-v1-plan.md](agentic-site-workspace-v1-plan.md).

This bakeoff is closed rather than pending. Its incomplete questionnaire is not an outstanding task. Do not resume the review UI, run the remaining scoring/model-review/report stages, or rerun the experiment unless the owner explicitly reopens it. Reusable claim, sanitizer, and browser verification were promoted into the agentic platform; the bakeoff runner, workbench, and contestant artifacts are no longer part of the active product tree. The protocol below is retained only as a historical decision record.

## Historical Purpose

This bakeoff was designed to test two separate architectural questions without conflating them:

1. Does freeform model-owned presentation outperform the production planner, compiler, and design systems when both receive the same canonical business input?
2. Does Lodesta's canonical ingestion plane improve a freeform site's factual coverage and trustworthiness compared with a raw target-domain crawl?

The bakeoff was decision support for the next generator investment. The qualitative owner decision recorded above now governs.

## Frozen Arms

- **Arm A, `canonical_templated`:** the production URL-to-snapshot pipeline, planner, whole-site copy call, compiler, and shipping design system.
- **Arm B, `canonical_freeform`:** the exact immutable canonical snapshot produced for Arm A, rendered by the freeform generation prompt.
- **Arm C, `url_freeform`:** a target-domain-only raw crawl rendered by the same freeform prompt used by Arm B. It does not receive the canonical fact resolution, evidence manifest, Places enrichment, site intent, or vertical pack.

Arm A versus B isolates presentation. Arm B versus C isolates canonical ingestion. Arm A versus C compares the two complete systems.

The freeform prompt is developed against the four committed harness fixtures using both input shapes, then frozen by hash before live target one. Fixture copy and fixture outputs are never contestants. A live run stops on configuration-hash drift instead of mixing prompt or model versions.

## Target And Crawl Rules

- The ordered target list is committed at `config/benchmark-targets/bakeoff-v1.txt` before generation.
- Preflight selects the first twelve passing URLs in order and uses the remaining entries only as ordered replacements.
- A target must be a live US auto-body business with enough public content to generate the required routes and no crawl or browser failure.
- Arm C uses the production crawl transport and the same 12-page default and 16-page hard maximum. The absence of canonical resolution is the variable; a smaller crawl budget is not.
- All thirty-six contestant sites finish before human review begins. A failed arm is recorded rather than hand-replaced after outputs are visible.

## Freeform Contract

Arms B and C return a structured multi-page artifact with shared CSS, two to five routes, disabled preview forms, declared rendered-text claims, and declared JSON-LD claims. The sanitizer rejects executable markup, event handlers, network CSS, unsafe links, unknown assets, active forms, and undeclared runtime scripts. Only supplied retained image assets may render.

Both freeform arms receive the same system prompt, model settings, output contract, one optional bounded revision, and neutral gate. Resource differences are measured rather than artificially normalized.

## Neutral Gate

The same browser and trust gate evaluates every arm for:

- route completeness and resolvable internal navigation;
- the declared runtime script boundary, allowing only Lodesta's canonical JSON-LD and header behavior in Arm A;
- non-submitting preview forms;
- desktop, tablet, and mobile rendering, including overflow, contrast, text size, CTA availability, accessibility structure, console failures, and loaded visible or lazy media;
- claim declarations that are locatable after normalized text matching and supported by allowed source references;
- every factual JSON-LD property, including fail-closed review, rating, award, warranty, credential, insurance, and offer assertions;
- target-domain and enrichment coverage reported separately.

Gate failures remain visible in the report. The runner never adds a case-specific product rule to make an output pass. A gate-only recapture is allowed before human review when it corrects an evaluator defect; it cannot recrawl, call a model, or modify contestant HTML, facts, copy, or design.

## Human Review

The owner completes thirty-six forced choices in three locked sessions of twelve:

- twelve A versus B comparisons;
- twelve B versus C comparisons;
- twelve A versus C comparisons.

Every comparison requires Option 1, Option 2, or Tie plus at least one reason tag. A tie is not a win and never shrinks the denominator. Business order and left/right placement are deterministic and identity-masked, although Arm A's two production design systems may make perfect masking impossible. Comparisons from the same business are interleaved rather than adjacent.

After all visual sessions lock, the owner reviews one deterministic trust-sensitive claim per available business/arm group against its cited source. Visual choices cannot change after identities become inferable from the trust audit.

## Independent Model Critique

Only after human visual and trust review is immutable, one masked multimodal critique ranks all three sites for each business. It receives desktop and mobile homepage captures plus route text, not arm identities or human choices. Each critique persists the judge model, prompt version, input hash, usage, and masked rationale.

## Preregistered Interpretation

- More than two intransitive per-business preference cycles makes subjective evidence inconclusive.
- A visual win requires at least eight wins out of twelve; ties count against the threshold.
- Arm B beating A is evidence about the presentation layer, not evidence against canonical ingestion.
- Freeform presentation is eligible for investment only when B beats A at least 8/12 and B also clears all objective and sampled trust checks with target-domain coverage no worse than A.
- Canonical ingestion has a positive signal when B beats C at least 8/12, or when visual results are within two wins and B has at least a ten-point target-domain coverage advantage.
- Raw-crawl freeform is eligible for deeper investigation only when C beats both B and A at least 8/12, clears all objective and sampled trust checks, and matches or exceeds B's target-domain coverage.
- No outcome automatically replaces the production generator. The result greenlights or rejects further investment and identifies concrete output defects.

## Historical Commands And Artifacts

```sh
npm run bakeoff:preflight
npm run bakeoff:run -- --execute --confirm=RUN_LIVE_BAKEOFF
npm run bakeoff:review -- --run-id=<run-id>
npm run bakeoff:model-review -- --run-id=<run-id>
npm run bakeoff:report -- --run-id=<run-id>
npm run bakeoff:verify -- --run-id=<run-id>
```

Tracked source contains the protocol, target order, contracts, runner, verifier, and four fixture inputs. Live crawls, snapshots, generated sites, captures, review records, critiques, and reports stay under `.data/bakeoffs/<run-id>/`. The final report records human pairwise results and reasons, preference cycles, gate and trust metrics, model rankings, token/resource totals, provenance hashes, and the preregistered recommendation.

The first execution uses run ID `bakeoff-v1-2026-07-18T16-06-58-056Z-25d2b959`.
