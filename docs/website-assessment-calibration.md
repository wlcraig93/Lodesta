# Website assessment calibration

The canonical assessment is evidence-first. Its composite score and verdict are provisional and internal; the public prospect report intentionally exposes findings, evidence, coverage, and what is working without a score or grade.

## Initial calibration set

Review 25–30 sites across the two or three launch verticals. Use one primary reviewer and spot-check a varied subset with a second reviewer. Grow the set as new verticals activate.

For every applicable criterion, record:

- the immutable assessment ID and rubric version;
- the reviewer and review timestamp;
- the automated status and the status supported by human review;
- a short note for every disagreement.

Run:

```sh
npm run calibrate:website-assessments -- path/to/calibration.json
```

The output reports per-criterion disagreements and precision. Inferred opportunities should meet at least 85% precision before they are candidates for public use. Deterministic checks should be corrected by construction; every deterministic disagreement is a bug investigation, not an acceptable error budget.

## Promotion rules

Calibration output does not automatically expose a public score or change the release hard gate.

Before public score or verdict exposure, a product owner must:

1. inspect every disagreement;
2. confirm coverage behavior across launch verticals and low-traffic CrUX fallbacks;
3. approve the rubric version and score bands in a recorded plan change;
4. update the public projection and its tests in one clean cut.

Only deterministic safety or functional criteria may be proposed for the release hard gate. Design, copy, SEO, CRO, content-depth, trust, and automated accessibility findings remain advisory unless a separate product-owner decision explicitly changes that boundary.
