# Generated Site V3 Artifact Contract

## Purpose

V3 review and generation decisions must be durable. Screenshots, art direction choices, media decisions, copy evaluations, cost reports, and review packets should be stored through `generation_artifacts`, not only in docs or temporary files.

## Reused Artifact Types

- `copy_artifact`
- `asset_selection_report`
- `claim_report`
- `policy_report`
- `performance_audit_report`
- `visual_benchmark`

## New Artifact Types

- `art_direction_decision`: selected/rejected recipe ids, input signals, validation result, token versions, rationale.
- `media_asset_decision`: selected media source, rights status, usage scope, source/artifact ref, policy notes, real-work implication flag.
- `copy_evaluation_report`: candidate set, scores, selected candidate, rejected candidates, rejection reasons, verifier result.
- `v3_review_packet`: screenshots, reviewer, date, rubric dimensions, score rationale, blocker notes, benchmark comparison.
- `generation_cost_report`: V3 model/image/browser cost categories, cap status, deterministic fallback reason.

## Storage Rules

- Use `generation_selected` for artifacts that define the selected generated site.
- Use `generation_candidate` for rejected but useful generation candidates.
- Use `eval_candidate` for retained examples used to calibrate evaluators.
- Use `qa_evidence` for screenshots, review packets, visual benchmark artifacts, and cost reports.
- Every artifact must include a content hash and producer version.

## Admin Review Requirement

The admin review UI should display the selected V3 composition, art direction, media decisions, copy artifacts, QA evidence, screenshots, costs, and blockers without requiring raw JSON inspection.
