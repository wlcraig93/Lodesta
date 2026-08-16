# Canonical generator consolidation

> Superseded for the runtime/capability boundary by `2026-08-15-managed-capabilities-editable-recipes-runtime-v4.md`. The single-profile consolidation remains in force; V1-V3 are retained-history renderers, not selectable new-authoring generators.

Date: 2026-08-15
Status: implemented and verified

## Decision

Lodesta has one executable initial-build generator:

- profile `canonical`, containing the accepted `baseline-release-candidate-v1` behavior;
- direct OpenAI `gpt-5.6-luna` at high reasoning by default for architecture and authoring;
- trusted runtime `site-runtime-v2`;
- retained-mirror architecture and pull-based source evidence;
- platform-prepared canonical logo authority; and
- the ordinary candidate verification and owner-controlled publication boundary.

The accepted profile behavior is retained because it is bound to the Kind and Surge
evidence. Historical run records keep their original profile provenance, while all new
execution uses the semantic `canonical` identifier rather than an experiment label.

## Clean cut

Owner onboarding and private retained-mirror canaries both enqueue the canonical profile.
The admin canary may vary the model for an explicit comparison, but it cannot select a
different prompt, skill, evidence policy, architecture treatment, or runtime.

The live workflow rejects any non-canonical `authoringProfileId`. Historical profile IDs
remain reader-only values so pre-launch diagnostic runs can still be inspected. They do
not authorize execution or retry. Obsolete visual-evidence runners and their live
verification hook are removed. Raw `.design` experiment evidence remains preserved locally
and is ignored by Git rather than carried in the product branch.

This consolidation does not promote V3, V4–V11, a feedback treatment, a copy specialist,
or a visual-direction stage. Their outcomes remain historical experiment evidence.

## Verification requirement

Before a commit or deployment checkpoint:

1. the canonical-profile regression must pass;
2. TypeScript, authoring, media/logo, runtime, canary, and browser-render verification
   must pass in proportion to the touched boundary-sensitive surfaces; and
3. no live API, UI, worker, retry, or canary path may dispatch a retired profile.

Fresh multi-replicate post-logo canaries remain a separate evaluation task. They are not
part of this hygiene cutover and must not reintroduce selectable generator profiles.
