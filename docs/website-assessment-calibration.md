# Website assessment calibration

The canonical assessment is evidence-first. Its composite score and verdict are provisional and internal; the public prospect report intentionally exposes findings, evidence, coverage, and what is working without a score or grade.

## Initial calibration set

Review 25–30 sites across the two or three launch verticals. Use one primary reviewer and spot-check a varied subset with a second reviewer. Grow the set as new verticals activate.

For every applicable criterion, record:

- the immutable assessment ID and rubric identity;
- the reviewer and review timestamp;
- the automated status and the status supported by human review;
- a short note for every disagreement.

For Visual Quality, also record the methodology and evaluator identities, evaluator
availability, latency and estimated cost, plus the automated and human-supported
status for every visual check. A second reviewer independently reviews at least ten
varied sites so reviewer agreement can be measured separately from model precision.

Run:

```sh
npm run calibrate:website-assessments -- path/to/calibration.json
```

The output reports per-criterion disagreements and precision. Inferred opportunities should meet at least 85% precision before they are candidates for public use. Deterministic checks should be corrected by construction; every deterministic disagreement is a bug investigation, not an acceptable error budget.

Visual findings are initially limited to concrete screenshot-grounded checks at
90% confidence. The calibration report measures per-check precision, reviewer
agreement, unavailable rate, latency, and cost. Any publicly eligible visual check
below 85% precision must be removed from the public projection in the next clean
methodology cutover.

## Promotion rules

Calibration output does not automatically expose a public score or change the release hard gate.

Before public score or verdict exposure, a product owner must:

1. inspect every disagreement;
2. confirm coverage behavior across launch verticals and low-traffic CrUX fallbacks;
3. approve the rubric identity and score bands in a recorded plan change;
4. update the public projection and its tests in one clean cut.

Only deterministic safety or functional criteria may be proposed for the release hard gate. Design, copy, SEO, CRO, content-depth, trust, and automated accessibility findings remain advisory unless a separate product-owner decision explicitly changes that boundary.

## First-generation quality calibration

The product-owner decision recorded in `docs/website-generation-quality-plan.md` makes three browser findings objective release blockers: unreachable clipped managed-capability content, a visible interactive control with no visible affordance, and body/control text contrast that is deterministically computed from opaque foreground text over an opaque solid background. Ambiguous image, gradient, transparency, filter, opacity, or blend-mode contrast remains advisory.

Retained-artifact scoring uses the same evidence boundaries:

- current browser evidence with no body/control text below 16px passes readable text; a retained sub-16px finding is a warning, with sub-12px visible text reported separately;
- dedicated service paths receive service-detail credit only when they are substantive and not materially repetitive;
- alternative-text credit requires descriptive rendered evidence rather than a merely non-empty attribute;
- clipped managed content and empty controls reduce functional integrity;
- orphan routes are advisory IA evidence, not broken destinations; and
- LCP, INP, and CLS remain unknown without independent field or lab evidence.

Unknown criteria remain excluded from both the numerator and denominator. Therefore scores from an earlier rubric identity are not comparable to scores from this calibration. Baselines and post-change results must use the same rubric and scanner identities.
