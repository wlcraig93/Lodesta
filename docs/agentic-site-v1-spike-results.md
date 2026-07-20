# Agentic Site V1 Spike Results

**Status:** Quality passed; Cloudflare passed

**Recorded:** 2026-07-19

## Frozen Inputs

- Canonical plan: `docs/agentic-site-workspace-v1-plan.md`
- Subjective rubric: `docs/credible-customer-draft-v1.md`
- Fixtures: four frozen auto-body inputs from the retired V3 bakeoff corpus, retained in Git history rather than the active V4 tree
- Model: the configured `gpt-5.6-sol`
- Objective validator: `bakeoff-neutral-gate-v1`

## Agent Quality Result

The final full run is `.data/agentic-site-v1/quality-spike/quality-2026-07-19T23-02-37-051Z`. It produced:

- 4/4 objectively valid customer drafts.
- 4/4 objectively valid preregistered edits.
- Zero unsupported final claims.
- No fixture-specific code or prompt branches.
- Credible, distinct desktop and mobile presentations for Austin Dent & Paint, East Austin Collision, and South Congress Collision.

The North Loop fixture failed the frozen subjective rubric because its retained canonical street value contained a navigation/contact fragment (`or visit`) and was rendered literally. The public projection was changed to reject address streets containing obvious contact or navigation fragments. The affected fixture was rerun at `.data/agentic-site-v1/quality-spike/quality-2026-07-19T23-20-30-005Z` and produced:

- 1/1 objectively valid draft on the first candidate.
- 1/1 objectively valid preregistered CTA edit.
- Zero unsupported claims.
- A customer-ready desktop and mobile result with no malformed address exposure.

Together these results satisfy the frozen quality-spike gate. The observed shared fixes were public phone and hours formatting, malformed-address exclusion, automotive-safe regulated-language detection, 14px minimum readable text, AA contrast, complete mobile navigation, and decorative-element text protection. No template behavior was added.

## Quality Review

The final reviewed drafts pass all five frozen criteria:

1. Each has a distinct identity and composition.
2. Desktop and mobile hierarchy, navigation, and conversion paths are coherent.
3. Services, proof, and contact details remain grounded in eligible canonical inputs.
4. No placeholders, internal field names, clipped navigation, broken media, or decorative text obstruction remain.
5. Each is suitable to present as a customer proposal without manual redesign.

The four edits also remain visible and coherent: editorial rich-media hero, stronger sparse-source service hierarchy, revised no-media CTA treatment, and a new page for an existing eligible service.

## Latency Observation

The final full run used two concurrent fixture workers. Per-fixture aggregate model time, including initial generation, an optional repair, the owner edit, and an optional edit repair, was:

| Fixture | Calls | Aggregate model time |
| --- | ---: | ---: |
| Austin rich media | 4 | 527 seconds |
| East sparse | 3 | 329 seconds |
| North no media | 3 | 405 seconds |
| South service breadth | 2 | 296 seconds |

All initial candidate flows remained under the 15-minute quality gate. Focused edits are not yet within the 90-second launch target. Per the canonical plan, this is a latency-only remediation item and does not invalidate the quality architecture; optimize it after the real sandbox/session/tool loop exists.

## Cloudflare Sandbox Result

The permanent Lodesta Cloudflare account completed the provider run recorded at
`.data/agentic-site-v1/spike/measure-mrsjguxt.json`. The deployed spike used the
`standard-2` container image, a maximum-instance ceiling of 100, deny-by-default
container egress, direct RPC backups to the bound R2 bucket, and authenticated
same-origin preview proxying.

Measured results:

| Workload | Samples | Nearest-rank p95 | Maximum |
| --- | ---: | ---: | ---: |
| Warm rebuild and preview | 20 | 1.735 seconds | 1.933 seconds |
| Independent cold R2 restore | 10 | 9.411 seconds | 9.411 seconds |
| Concurrent isolated build | 20 | 7.761 seconds | 8.799 seconds |

All provider assertions passed:

- Exact-parent revision conflicts are rejected.
- Public container egress is denied.
- All ten cold restores succeed.
- All twenty concurrent builds succeed and retain isolated marker content.
- Build sessions perform zero package installs.
- Warm preview p95 remains under 15 seconds.
- Cold restore p95 remains under 45 seconds.
- Every run session is destroyed. A post-run Cloudflare account query found all
  31 named measurement instances in the `inactive` state and none active.

The spike also established:

- `standard-2` container configuration using current RPC transport.
- Authenticated fixed-operation Worker bridge.
- Exact-parent workspace revisions and bounded source writes.
- Prebaked React, TypeScript, and Vite dependency tree with no session installs.
- Warm session reuse, build, tokenized preview exposure, diagnostics, backup/restore calls, and explicit destruction.
- Worker TypeScript validation and local scaffold build.
- Exact Cloudflare container image build from `cloudflare/sandbox:0.12.3`, including the locked scaffold dependency installation.
- A declared `max_instances` ceiling of 100. At `standard-2` this reserves at most 100 vCPU, 600 GiB memory, and 1.2 TB disk, below Cloudflare's documented account ceilings of 1,500 vCPU, 6 TiB memory, and 30 TB disk.
- Deny-by-default container egress, with the fixed egress assertion confirming an external HTTPS fetch is rejected.
- Authenticated SDK preview proxying and exact-parent conflict rejection.
- Direct RPC streaming of workspace archives into the bound R2 bucket, avoiding separate S3-style R2 credentials.
- Twenty warm rebuilds, ten independent cold R2 restores, and twenty concurrent
  isolated provider builds.

The local Docker prerequisite is resolved with Colima, Docker Buildx, and an
isolated untracked Docker CLI configuration. The permanent Cloudflare account is
authorized through Wrangler's encrypted keyring. The `.env.local` Cloudflare
token and zone placeholders remain empty.

The local `wrangler dev` runtime did not stand in for the provider concurrency
gate. Four simultaneous local containers interrupted their runtime connections
on this four-core host, so the final concurrency and destruction assertions use
the deployed Cloudflare runtime exclusively.

Both prerequisite spikes passed. The clean V3 reset and V4 walking-skeleton
cutover were subsequently completed under the canonical plan. The permanent
provider checks remain available through `npm run verify:site-sandbox-v1` and
`npm run verify:agentic-site-walking-skeleton`.
