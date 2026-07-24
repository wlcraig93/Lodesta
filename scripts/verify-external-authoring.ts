import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@/packages/business-data";
import {
  externalAuthoringBatchItemSchema,
  externalAuthoringBatchSchema,
  externalAuthoringCredentialSchema,
  externalAuthoringExecutionSchema,
  externalAuthoringOperationSchema,
  LocalExternalAuthoringRepository
} from "@/packages/external-authoring";
import { draftPreviewGrant, previewLink, validatePreviewSecret } from "@/packages/platform-operations";
import { WorkspaceManagerRuntime } from "@/packages/site-platform/manager-runtime";

const root = process.cwd();
const [route, migration, mediaPublicationMigration, config, skill, finalizer, readiness, previewRoute, exchangeRoute, mcpService, workflow] = await Promise.all([
  readFile(join(root, "app/api/operator/mcp/route.ts"), "utf8"),
  readFile(join(root, "supabase/migrations/202607230010_external_codex_authoring.sql"), "utf8"),
  readFile(join(root, "supabase/migrations/202607230013_canonical_media_publication.sql"), "utf8"),
  readFile(join(root, "integrations/codex/lodesta-operator.config.toml.example"), "utf8"),
  readFile(join(root, "integrations/codex/skills/lodesta-external-authoring/SKILL.md"), "utf8"),
  readFile(join(root, "packages/site-verification/finalizer.ts"), "utf8"),
  readFile(join(root, "packages/site-platform/publication-readiness.ts"), "utf8"),
  readFile(join(root, "app/preview/[previewId]/[[...path]]/route.ts"), "utf8"),
  readFile(join(root, "app/api/previews/[previewId]/session/route.ts"), "utf8"),
  readFile(join(root, "packages/external-authoring/mcp-service.ts"), "utf8"),
  readFile(join(root, "packages/site-platform/workflow.ts"), "utf8")
]);

const expectedTools = [
  "claim_next_site", "get_execution_status", "list_files", "read_file", "write_file",
  "delete_file", "apply_patch", "build_preview", "inspect_site", "request_input", "finish"
];
for (const tool of expectedTools) assert(route.includes(`"${tool}"`) || route.includes("managerToolNameSchema.options"), `${tool} is not discoverable.`);
assert(route.includes('if (toolName === "create_image") continue'), "External MCP exposes Lodesta-side image generation.");
assert(route.includes("maximumRequestBytes = 6 * 1024 * 1024"), "MCP body limit is missing.");
assert(route.includes("requests > 120"), "MCP credential rate limit is missing.");
assert(!route.includes("request.headers.get(\"cookie\")"), "Owner browser cookies authenticate the MCP route.");
assert(config.includes('forced_login_method = "chatgpt"'), "Dedicated profile does not require ChatGPT login.");
assert(config.includes('bearer_token_env_var = "LODESTA_MCP_BEARER_TOKEN"'), "Dedicated profile embeds or omits the bearer credential.");
assert(config.includes('url = "https://lodesta.example/api/operator/mcp/"'), "Dedicated profile uses an MCP URL that redirects and can drop authorization.");
assert(config.includes("tool_timeout_sec = 1200"), "Dedicated profile cannot survive long inspection calls.");
assert(config.includes('default_tools_approval_mode = "approve"'), "Dedicated MCP approval behavior is not explicit.");
for (const tool of expectedTools) assert(config.includes(`"${tool}"`), `Dedicated profile does not allow ${tool}.`);
assert(!config.includes('"create_image"'), "Dedicated profile allows create_image.");
assert(skill.includes("ordinary HTTP reconnect") && skill.includes("stable idempotency key"), "Skill omits reconnect or retry semantics.");

assert(migration.includes("total_active >= 4 or external_active >= 3"), "Atomic capacity invariant is missing.");
assert(migration.includes("staged_blob_receipt_missing"), "Finalization does not trust staged blob receipts.");
assert(migration.includes("target_execution.finalization_key = target_finalization_key"), "Finalization retry retention is missing.");
assert(migration.includes("preview_token_cutover_required") && migration.includes("drop table preview_tokens"), "Preview hard cut is incomplete.");
assert(migration.includes("claim_lease_expired") && migration.includes("status = 'fenced'"), "Expired claims are not fenced.");
assert(migration.includes("greatest(c.lease_expires_at, coalesce(c.operation_deadline_at"), "Long operations do not extend the effective logical claim lease.");
assert(migration.includes("external_idempotency_key_conflict"), "A reused idempotency key can silently change a mutation.");
assert(migration.includes("requeue_external_authoring_execution"), "Clarification/retry fencing is not transactional.");
assert(migration.includes("site_candidate_finalized"), "Candidate assessment outbox is missing.");
assert(mediaPublicationMigration.includes("drop column if exists reference_asset_preview_policy_accepted_at"), "Retired external batch media approval state remains durable.");
assert(mediaPublicationMigration.includes("create or replace function public.promote_site_version") && !mediaPublicationMigration.includes("asset.reference_only"), "Database publication still carries a media-specific blocker.");
assert(!finalizer.includes("referenceOnlyAssetFindings") && !finalizer.includes("asset.reference_only"), "Finalizer still classifies source media as preview-only.");
assert(!readiness.includes("preview_only_reference_assets") && !readiness.includes("asset.reference_only"), "Application publication readiness still blocks source media.");
assert(previewRoute.includes("location.hash.slice(1)") && previewRoute.includes("history.replaceState"), "Preview shell does not exchange and clear the fragment.");
assert(exchangeRoute.includes("HttpOnly; Secure; SameSite=Strict"), "Preview cookie security attributes are incomplete.");
assert(exchangeRoute.includes("Path=/preview/"), "Preview cookie is not path scoped.");
const executeWorkspaceToolSource = mcpService.slice(mcpService.indexOf("export async function executeExternalWorkspaceTool"));
assert(
  executeWorkspaceToolSource.indexOf("getOperationByKey(operationKey)") < executeWorkspaceToolSource.indexOf("const { claim, execution } = await authorizeClaim(input)"),
  "A lost finish response cannot be replayed after finalization releases the claim."
);
assert(workflow.includes("workspaceHash: runtimeSnapshot.workspaceHash"), "Durable execution state does not retain the canonical runtime workspace hash.");

const { GET: handleMcpGet } = await import("@/app/api/operator/mcp/route");
assert.equal((await handleMcpGet(new Request("http://localhost/api/operator/mcp"))).status, 401, "Missing MCP bearer token was accepted.");
assert.equal((await handleMcpGet(new Request("http://localhost/api/operator/mcp", {
  headers: { cookie: "sb-access-token=owner-browser-cookie" }
}))).status, 401, "Owner browser cookie authenticated MCP.");
assert.equal((await handleMcpGet(new Request("http://localhost/api/operator/mcp", {
  headers: { authorization: "Bearer lodesta_mcp_invalid.invalid" }
}))).status, 401, "Invalid MCP bearer token was accepted.");

process.env.LODESTA_PREVIEW_HMAC_KEYS = JSON.stringify({ v1: "verification-preview-key-000000000000000000000000" });
process.env.LODESTA_PREVIEW_HMAC_ACTIVE_KEY_VERSION = "v1";
const previewA = draftPreviewGrant({
  previewId: "preview_verification123456",
  siteId: "site_verification",
  siteVersionId: "version_verification",
  expiresAt: "2099-01-01T00:00:00.000Z"
});
const previewB = draftPreviewGrant({
  previewId: previewA.id,
  siteId: previewA.siteId,
  siteVersionId: previewA.siteVersionId,
  expiresAt: previewA.expiresAt
});
assert.equal(previewA.secretHash, previewB.secretHash, "A lost preview response cannot recover the same secret.");
const secret = previewLink(previewA, "https://lodesta.example").split("#")[1];
assert(secret && validatePreviewSecret(previewA, secret), "Derived preview secret does not validate.");
assert(!previewLink(previewA, "https://lodesta.example").split("#")[0].includes(secret), "Preview secret leaked into the request path.");

const runtime = new WorkspaceManagerRuntime({
  kind: "initial_build",
  publicBuildInputId: "input_verification",
  toolchainVersion: "verification",
  sandboxImageDigest: `sha256:${"a".repeat(64)}`,
  initialFiles: [
    { path: "src/site.tsx", content: "export default function Site(){return <main>Hello</main>}" },
    { path: "src/styles.css", content: "main{display:block}" }
  ],
  initialSandboxRevision: "sandbox-1",
  applyBuild: async () => ({ revision: "sandbox-2", buildDurationMs: 1, previewPath: "/preview" }),
  inspect: async () => ({
    passed: true,
    inspectionHash: `sha256:${"b".repeat(64)}`,
    modelSummary: {},
    diagnosticSummary: {}
  })
});
const firstWrite = await runtime.execute({ callId: "write-1", name: "write_file", arguments: { path: "src/styles.css", content: "main{display:block}" } });
const secondWrite = await runtime.execute({ callId: "write-2", name: "write_file", arguments: { path: "src/styles.css", content: "main{display:block}" } });
assert.equal(firstWrite.diagnosticOutput.unchanged, true);
assert.equal(secondWrite.diagnosticOutput.unchanged, true);
assert.equal(runtime.snapshot().metrics.builds, 0);

const directory = await mkdtemp(join(tmpdir(), "lodesta-external-authoring-"));
try {
  const repository = new LocalExternalAuthoringRepository(join(directory, "state.json"));
  const now = "2026-07-23T12:00:00.000Z";
  const credential = externalAuthoringCredentialSchema.parse({
    schemaVersion: 1,
    id: "mcp_credential_verify",
    tokenHash: sha256("verify-token"),
    label: "Verification",
    status: "active",
    createdAt: now
  });
  await repository.saveCredential(credential);
  assert.equal((await repository.findActiveCredential(credential.tokenHash))?.id, credential.id);
  await repository.revokeCredential(credential.id, "2026-07-23T12:01:00.000Z");
  assert.equal(await repository.findActiveCredential(credential.tokenHash), null, "Revoked MCP credential still authenticates.");
  const batch = externalAuthoringBatchSchema.parse({
    schemaVersion: 1,
    id: "external_batch_verify",
    name: "Verification",
    requestedBy: "operator:verify",
    campaignId: "campaign_verify",
    createdAt: now
  });
  const item = externalAuthoringBatchItemSchema.parse({
    schemaVersion: 1,
    id: "external_item_verify",
    batchId: batch.id,
    ordinal: 0,
    sourceUrl: "https://example.com/",
    normalizedSource: "https://example.com/",
    preparationKey: `sha256:${"c".repeat(64)}`,
    preparationStatus: "completed",
    preparationAttempts: 1,
    createdAt: now,
    updatedAt: now
  });
  await repository.createBatch(batch, [item]);
  await repository.saveExecution(externalAuthoringExecutionSchema.parse({
    schemaVersion: 1,
    id: "execution_verify",
    runId: "run_verify",
    batchItemId: item.id,
    status: "queued",
    stateRevision: 0,
    createdAt: now,
    updatedAt: now
  }));
  const claimOne = await repository.claimNext({
    claimId: "claim_verify_one",
    bindingId: "binding_verify",
    workerKeyHash: sha256("worker-verify"),
    capabilityHash: sha256("capability-verify"),
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    deadlineAt: "2099-01-01T00:00:00.000Z"
  });
  assert(claimOne && !claimOne.reattached);
  const reconnect = await repository.claimNext({
    claimId: "claim_verify_reconnect",
    bindingId: "binding_verify",
    workerKeyHash: sha256("worker-verify"),
    capabilityHash: sha256("different-capability-is-ignored"),
    leaseExpiresAt: "2099-01-02T00:00:00.000Z",
    deadlineAt: "2099-01-02T00:00:00.000Z"
  });
  assert(reconnect?.reattached);
  assert.equal(reconnect.claim.id, claimOne.claim.id);
  assert.equal(reconnect.claim.leaseGeneration, claimOne.claim.leaseGeneration);

  const operationKey = sha256("stable-operation");
  const operation = externalAuthoringOperationSchema.parse({
    schemaVersion: 1,
    id: "operation_verify",
    executionId: claimOne.execution.id,
    claimId: claimOne.claim.id,
    leaseGeneration: claimOne.claim.leaseGeneration,
    operationKey,
    idempotencyKeyHash: sha256("idempotency-key"),
    toolName: "write_file",
    argumentsHash: sha256("arguments"),
    preStateRevision: 0,
    status: "reserved",
    deadlineAt: "2099-01-01T00:00:00.000Z",
    createdAt: now,
    updatedAt: now
  });
  const reserved = await repository.reserveOperation(operation, 0, sha256("capability-verify"));
  const repeated = await repository.reserveOperation(operation, 0, sha256("capability-verify"));
  assert.equal(reserved?.id, repeated?.id, "Lost mutation response creates a second operation.");
  await assert.rejects(
    repository.reserveOperation(externalAuthoringOperationSchema.parse({
      ...operation,
      id: "operation_verify_conflict",
      operationKey: sha256("conflicting-operation"),
      argumentsHash: sha256("different-arguments")
    }), 0, sha256("capability-verify")),
    /external_idempotency_key_conflict/,
    "Reusing an idempotency key for different arguments was accepted."
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

process.stdout.write("External Codex authoring verification passed.\n");
