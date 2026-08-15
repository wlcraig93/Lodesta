# Operator bulk authoring boundary

Status: deferred
Date: 2026-07-30

Lodesta does not maintain an MCP server, customer-connected ChatGPT surface, alternate
authoring execution engine, or per-owner/site MCP credentials.

If operator-scale authoring is revisited, it should be a private operator tool that
submits bounded batches to the same `SiteAuthoringKernel` and persistent run queue used
by the product. Authentication and transport may use an operator’s ChatGPT or Codex
entitlement when the supported platform contract is known, but the tool must not create
a second workspace model, finalizer, run schema, or publication path.

The future tool must remain incapable of publishing, changing ownership, configuring
domains, or bypassing owner-authority and artifact-integrity checks. No database schema,
route, credential model, package, or compatibility shim is reserved until that work is
actually prioritized.
