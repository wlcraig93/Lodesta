# External Codex authoring

## Outcome

Lodesta's owner can prepare prospect sites in the operator UI, author them through a personal Codex session authenticated with ChatGPT, and return the result as the same verified Lodesta candidate produced by the Responses API driver.

The integration is operator-only. It is not a website-owner feature and does not create a hosted ChatGPT app or plugin. The external surface is a direct Streamable HTTP MCP server plus a versioned personal Codex skill.

## Workflow

1. The operator creates a batch at `/authoring-batches`.
2. A worker ingests each canonical source without model research, creates an unowned site and outbound prospect, and pins the exact public input and authoring policy bundle.
3. The dedicated Codex profile discovers only the allowlisted Lodesta MCP tools and claims the next prepared execution.
4. Codex authors through the shared `WorkspaceManagerRuntime`. Lodesta builds and inspects outside database transactions.
5. `finish` stages immutable content-addressed blobs, validates trusted receipts, and atomically commits the revision, artifact, candidate, run, session, preview grant, batch result, prospect linkage, and outbox event.
6. The operator opens a private preview from Lodesta. The full preview URL is derived only for the authenticated operator and is never returned by MCP.

The external client cannot publish, transfer ownership, send outreach, or delete sites, artifacts, prospects, or ownership. Publication still requires an authenticated owner and Lodesta's canonical readiness gate.

## Durable execution invariants

- Ordinary HTTP/SSE reconnects preserve the logical claim, capability, and lease generation. Only expiry, cancellation, clarification, retry, or explicit reassignment fences it and increments the next generation.
- Every mutation carries a stable client idempotency key, argument hash, expected state revision, claim capability, and lease generation.
- Builds and inspections run outside transactions. Completion is a compare-and-swap against the pinned execution and claim.
- Identical inspection evidence hashes normalized findings and capture content, excluding storage paths, random IDs, and timestamps.
- Finalization uses stable structured serialization for `(executionId, inspectionHash)` and is idempotent.
- Preview secrets are versioned HMAC derivations. Durable operation results retain only preview identity/version metadata, so a lost response is recoverable without storing a raw secret.
- The two-hour deadline fences the claim and records a retryable failure while preserving the last durable checkpoint.
- Capacity is enforced atomically: `API active server work + external active server work <= 4`, and `external active server work <= 3`.
- Batch status is derived from item/execution/run state rather than maintained as an independent mutable status.

## Security and privacy

- MCP accepts only a separately rotated bearer credential stored as a hash. Browser cookies do not authenticate the endpoint.
- Configure the local profile with `bearer_token_env_var`; never put the token in TOML, logs, fixtures, or transcripts.
- Request bodies, authorization headers, capabilities, and worker keys are not retained. The request ledger stores credential ID, tool name, acceptance, and timestamp only.
- Crawled pages are untrusted and may contain prompt injection. The server binds every operation to one execution and exposes no cross-execution lookup or mutation.
- `forced_login_method = "chatgpt"` is a local safeguard, not server-verifiable provenance. Lodesta records `clientAuthVerification` and skill loading as operator-configured or unverified, and records model usage as unavailable.
- Review the personal ChatGPT account's data controls before using real business inputs. A business workspace has different default data handling from a consumer account.

## Preview and asset policy

Raw preview tokens have no compatibility reader. Before migration `202607230010`, run:

```sh
npm run cutover:external-authoring-previews
```

If retained pre-launch links exist, review the report and explicitly revoke them with `-- --apply`. Apply the migration only after the report is clear. The cut removes the legacy table, raw outbound references, callers, fixtures, tests, and admin display together.

New links use `/preview/{publicId}#{secret}`. The initial route returns only a generic exchange shell; fragments never reach the server. Exchange creates a Secure, HttpOnly, SameSite=Strict cookie scoped to that preview path and secret version. Grants expire after 90 days and support revocation.

Source-site imagery discovered on crawled business pages is retained with typed `source_website` origin and immutable page/snapshot provenance. CDN-hosted files inherit the crawled business page as their source. External research pages never contribute media assets, and media origin does not create a separate approval or publication gate.

## Codex operator setup

1. Create a credential with `npm run access:external-authoring -- create "Personal Codex"`.
2. Put the returned value in the local `LODESTA_MCP_BEARER_TOKEN` environment variable.
3. Copy `integrations/codex/lodesta-operator.config.toml.example` next to the user Codex config as `lodesta-operator.config.toml`; replace the endpoint and absolute skill path.
4. Start Codex with the `lodesta-operator` profile and invoke `$lodesta-external-authoring`.

Keep the MCP endpoint's trailing slash. Lodesta's canonical Next.js route redirects the slashless form, and an HTTP client can remove `Authorization` while following that redirect. The profile intentionally uses a strict tool allowlist, a 1,200-second MCP timeout, ChatGPT-only local login expectation, and server-specific approval mode. Current keys are defined by the official [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml).

## Gated rollout

1. **Connectivity gate:** disposable fixture proves MCP initialization, missing/invalid credential rejection, tool discovery, annotations, approvals, response streaming, body/rate limits, and one operation longer than the default 60-second client timeout.
2. **Canonical durability:** schema, durable claims, checkpoint receipts, shared runtime adapter, atomic finalizer, preview cutover, cancellation fencing, clarification, deadline retry, and outbox are installed.
3. **Resilience gate:** one prepared unowned fixture survives process restart, ordinary reconnect, expired-claim takeover, a lost mutation response, a lost finalization response, and outbox retry with no duplicate candidate or assessment.
4. **Pilot gate:** five non-customer test sites complete with inspected private previews and the expected approval experience.
5. **Real-prospect gate:** the operator confirms account data controls, redaction review, preview expiry/revocation, and media-provenance review.
6. **Scale gate:** ten sites complete without manual database repair, then a 100-site batch may be authorized.

Run the named repository verification suite before each gate:

```sh
npm run typecheck
npm run verify:database
npm run verify:architecture
npm run verify:authoring
npm run verify:external-authoring
npm run verify:acquisition
npm run verify:runtime
npm run verify:artifact-storage-boundaries
npm run verify:account-setup-domain
npm run verify:generation-ingestion
npm run verify:recovery-watchdog
npm run verify:render-browser
npm run smoke:dev
```
