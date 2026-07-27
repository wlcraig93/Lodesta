import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { hashSecret } from "@/lib/hash-secret";
import { sha256, stableJson } from "@/packages/business-data";
import { managerToolArguments, type ManagerToolName } from "@/packages/site-agent/contracts";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAgentRunSchema } from "@/packages/site-contracts";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";
import { assertConfiguredSiteSandboxRuntimeReady } from "@/packages/site-sandbox";
import { platformOperationsRepository } from "@/packages/platform-operations";
import {
  externalAuthoringClaimSchema,
  externalAuthoringCredentialSchema,
  externalAuthoringExecutionSchema,
  externalAuthoringOperationSchema,
  type ExternalAuthoringClaim,
  type ExternalAuthoringCredential,
  type ExternalAuthoringOperation
} from "./contracts";
import { externalAuthoringRepository } from "./repository";
import {
  assertExternalAuthoringBundleCurrent
} from "./runtime-compatibility";

const claimLeaseMs = 20 * 60_000;
const executionDeadlineMs = 2 * 60 * 60_000;
const workspaceToolNames = [
  "list_files",
  "search_files",
  "read_files",
  "write_file",
  "delete_file",
  "apply_patch",
  "edit_file",
  "build_preview",
  "inspect_site",
  "request_input",
  "finish"
] as const satisfies readonly ManagerToolName[];

export const externalMcpToolNames = ["claim_next_site", "get_execution_status", ...workspaceToolNames] as const;
export type ExternalMcpToolName = typeof externalMcpToolNames[number];

export async function createExternalAuthoringCredential(label: string) {
  const id = `mcp_credential_${randomUUID().replaceAll("-", "")}`;
  const secret = randomBytes(32).toString("base64url");
  const token = `lodesta_mcp_${id}.${secret}`;
  const credential = externalAuthoringCredentialSchema.parse({
    schemaVersion: 1,
    id,
    tokenHash: hashCredentialToken(token),
    label,
    status: "active",
    createdAt: new Date().toISOString()
  });
  await externalAuthoringRepository.saveCredential(credential);
  return { credential, token };
}

export async function authenticateExternalMcp(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || bearer.length > 512) return null;
  const credential = await externalAuthoringRepository.findActiveCredential(hashCredentialToken(bearer));
  if (!credential) return null;
  const now = new Date().toISOString();
  await externalAuthoringRepository.saveCredential(externalAuthoringCredentialSchema.parse({
    ...credential,
    lastUsedAt: now
  }));
  return credential;
}

export async function recordExternalMcpRequest(input: {
  credential: ExternalAuthoringCredential;
  toolName?: string;
  accepted: boolean;
}) {
  return externalAuthoringRepository.recordCredentialRequest({
    credentialId: input.credential.id,
    toolName: input.toolName,
    accepted: input.accepted,
    occurredAt: new Date().toISOString()
  });
}

export async function claimNextExternalSite(input: {
  bindingId: string;
  workerKey: string;
}) {
  const workerKey = input.workerKey.trim();
  if (!workerKey || workerKey.length > 160) throw new Error("worker_key_invalid");
  const bindingId = input.bindingId.trim();
  if (!bindingId || bindingId.length > 160) throw new Error("claim_binding_invalid");
  await assertConfiguredSiteSandboxRuntimeReady();
  const claimId = `claim_${randomUUID().replaceAll("-", "")}`;
  const capability = deriveCapability({ claimId, bindingId, workerKey });
  const result = await externalAuthoringRepository.claimNext({
    claimId,
    bindingId,
    workerKeyHash: sha256(workerKey),
    capabilityHash: sha256(capability),
    leaseExpiresAt: new Date(Date.now() + claimLeaseMs).toISOString(),
    deadlineAt: new Date(Date.now() + executionDeadlineMs).toISOString()
  });
  if (!result) return { available: false as const };
  const reattachedCapability = deriveCapability({
    claimId: result.claim.id,
    bindingId: result.claim.bindingId,
    workerKey
  });
  if (sha256(reattachedCapability) !== result.claim.capabilityHash) throw new Error("claim_capability_derivation_failed");
  const [bundle, run] = await Promise.all([
    result.execution.bundleId ? externalAuthoringRepository.getBundle(result.execution.bundleId) : null,
    sitePlatformRepository.getAgentRun(result.execution.runId)
  ]);
  if (!bundle || !run) throw new Error("claimed_execution_bundle_missing");
  const [buildInput, messages] = await Promise.all([
    sitePlatformRepository.getPublicBuildInput(bundle.publicBuildInputId),
    sitePlatformRepository.listAgentMessages(run.sessionId)
  ]);
  if (!buildInput) throw new Error("claimed_execution_input_missing");
  await assertExternalAuthoringBundleCurrent({
    execution: result.execution,
    bundle,
    claimId: result.claim.id,
    publicBuildInputHash: buildInput.inputHash
  });
  return {
    available: true as const,
    reattached: result.reattached,
    claimId: result.claim.id,
    capability: reattachedCapability,
    leaseGeneration: result.claim.leaseGeneration,
    leaseExpiresAt: result.claim.leaseExpiresAt,
    executionId: result.execution.id,
    stateRevision: result.execution.stateRevision,
    deadlineAt: result.execution.deadlineAt,
    run: {
      id: run.id,
      kind: run.kind,
      instruction: messages.filter((message) => message.runId === run.id && message.role === "operator").map((message) => message.content).join("\n\n")
    },
    bundle,
    publicBuildInput: buildInput
  };
}

export async function getExternalExecutionStatus(input: { claimId: string; capability: string }) {
  const loaded = await loadClaimContext(input);
  const { claim, execution } = loaded.claim.status === "active"
    ? await authorizeClaim(input)
    : loaded;
  if (claim.status !== "active" && !(claim.status === "released" && execution.status === "completed")) {
    throw new Error("external_claim_fenced");
  }
  const operation = execution.currentOperationId
    ? await externalAuthoringRepository.getOperation(execution.currentOperationId)
    : null;
  return {
    claimId: claim.id,
    leaseGeneration: claim.leaseGeneration,
    leaseExpiresAt: claim.leaseExpiresAt,
    executionId: execution.id,
    status: execution.status,
    stateRevision: execution.stateRevision,
    workspaceHash: execution.workspaceHash,
    deadlineAt: execution.deadlineAt,
    currentOperation: operation ? {
      id: operation.id,
      toolName: operation.toolName,
      status: operation.status,
      deadlineAt: operation.deadlineAt
    } : undefined,
    finalization: execution.finalizationKey ? {
      finalizationKey: execution.finalizationKey,
      completedAt: execution.completedAt
    } : undefined
  };
}

export async function executeExternalWorkspaceTool(input: {
  claimId: string;
  capability: string;
  expectedStateRevision: number;
  idempotencyKey: string;
  toolName: ManagerToolName;
  arguments: unknown;
  signal?: AbortSignal;
}) {
  if (!workspaceToolNames.includes(input.toolName as typeof workspaceToolNames[number])) throw new Error("external_tool_not_allowed");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,159}$/.test(input.idempotencyKey)) throw new Error("idempotency_key_invalid");
  const initial = await loadClaimContext(input);
  const args = managerToolArguments[input.toolName].parse(input.arguments) as Record<string, unknown>;
  const argumentsHash = sha256(stableJson(args));
  const operationKey = sha256(stableJson({
    schemaVersion: 1,
    claimId: initial.claim.id,
    leaseGeneration: initial.claim.leaseGeneration,
    idempotencyKey: input.idempotencyKey,
    toolName: input.toolName,
    argumentsHash,
    preStateRevision: input.expectedStateRevision
  }));
  const retained = await externalAuthoringRepository.getOperationByKey(operationKey);
  if (retained) return retainedOperationResult(retained);
  const { claim, execution } = await authorizeClaim(input);

  const now = new Date().toISOString();
  const operation = externalAuthoringOperationSchema.parse({
    schemaVersion: 1,
    id: deterministicId("operation", { schemaVersion: 1, operationKey }),
    executionId: execution.id,
    claimId: claim.id,
    leaseGeneration: claim.leaseGeneration,
    operationKey,
    idempotencyKeyHash: sha256(input.idempotencyKey),
    toolName: input.toolName,
    argumentsHash,
    preStateRevision: input.expectedStateRevision,
    preWorkspaceHash: execution.workspaceHash,
    status: "reserved",
    deadlineAt: new Date(Date.now() + operationTimeoutMs(input.toolName)).toISOString(),
    createdAt: now,
    updatedAt: now
  });
  const reserved = await externalAuthoringRepository.reserveOperation(
    operation,
    input.expectedStateRevision,
    sha256(input.capability)
  );
  if (!reserved) return { ok: false as const, status: "capacity_wait" as const, retryAfterMs: 5_000 };
  if (!await externalAuthoringRepository.markOperationRunning(reserved.id, sha256(input.capability))) {
    const current = await externalAuthoringRepository.getOperationByKey(operationKey);
    return current ? retainedOperationResult(current) : { ok: false as const, status: "operation_lost" as const };
  }

  const startedAt = Date.now();
  try {
    const outcome = await siteAuthoringWorkflow.executeExternalTool({
      executionId: execution.id,
      operationId: reserved.id,
      toolName: input.toolName,
      arguments: args,
      signal: input.signal
    });
    const durationMs = Date.now() - startedAt;
    if (outcome.finalization) {
      const completedRun = withExternalUsage(outcome.finalization.run, input.toolName, durationMs, outcome.checkpoint.bytes);
      const finalized = await sitePlatformRepository.finalizeVerifiedAuthoring({
        finalizationKey: outcome.finalization.finalizationKey,
        revision: outcome.finalization.revision,
        artifact: outcome.finalization.artifact,
        version: outcome.finalization.version,
        run: completedRun,
        session: outcome.finalization.session,
        previewGrantDocument: outcome.finalization.previewGrant,
        outboxDocument: outcome.finalization.outbox,
        external: {
          executionId: execution.id,
          batchItemId: execution.batchItemId,
          claimId: claim.id,
          leaseGeneration: claim.leaseGeneration,
          capabilityHash: sha256(input.capability),
          expectedStateRevision: input.expectedStateRevision,
          receiptIds: outcome.finalization.receiptIds
        }
      });
      await externalAuthoringRepository.enqueueOutbox(outcome.finalization.outbox);
      if (process.env.LODESTA_REPOSITORY === "local") {
        await completeLocalExternalFinalization({
          claim,
          execution,
          capability: input.capability,
          operation: reserved,
          checkpoint: outcome.checkpoint,
          finalization: outcome.finalization
        });
      }
      return {
        ok: true as const,
        completed: true as const,
        executionId: execution.id,
        stateRevision: input.expectedStateRevision + 1,
        candidateVersionId: finalized.version.id,
        previewId: outcome.finalization.previewGrant.id,
        modelUsage: "unavailable" as const
      };
    }
    const completed = await externalAuthoringRepository.completeOperation({
      operationId: reserved.id,
      capabilityHash: sha256(input.capability),
      result: compactToolResult(outcome.tool),
      workspaceHash: outcome.workspaceHash,
      checkpointKey: outcome.checkpoint.key,
      checkpointHash: outcome.checkpoint.contentHash
    });
    const currentRun = await sitePlatformRepository.getAgentRun(execution.runId);
    if (currentRun) {
      const updatedRun = withExternalUsage(currentRun, input.toolName, durationMs, outcome.checkpoint.bytes);
      const needsInput = input.toolName === "request_input" ? outcome.tool.needsInput : undefined;
      await sitePlatformRepository.saveAgentRun(needsInput
        ? siteAgentRunSchema.parse({
          ...updatedRun,
          status: "needs_input",
          stage: "needs_input",
          inputQuestion: needsInput.question,
          inputExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
        })
        : updatedRun);
      if (needsInput) {
        const latestExecution = await externalAuthoringRepository.getExecution(execution.id);
        if (latestExecution) {
          await externalAuthoringRepository.saveExecution(externalAuthoringExecutionSchema.parse({
            ...latestExecution,
            status: "needs_input",
            updatedAt: new Date().toISOString()
          }));
        }
      }
    }
    return {
      ok: true as const,
      executionId: execution.id,
      operationId: completed.id,
      stateRevision: completed.postStateRevision,
      workspaceHash: completed.postWorkspaceHash,
      ...compactToolResult(outcome.tool)
    };
  } catch (error) {
    const message = safeMessage(error);
    await externalAuthoringRepository.failOperation(
      reserved.id,
      sha256(input.capability),
      failureCode(error),
      { ok: false, error: message }
    ).catch(() => undefined);
    throw error;
  }
}

export function hashCredentialToken(token: string) {
  return `sha256:${createHmac("sha256", hashSecret()).update(`external-mcp:${token}`).digest("hex")}` as const;
}

function deriveCapability(input: { claimId: string; bindingId: string; workerKey: string }) {
  return createHmac("sha256", hashSecret())
    .update(stableJson({
      schemaVersion: 1,
      purpose: "external-authoring-claim-capability",
      claimId: input.claimId,
      bindingId: input.bindingId,
      workerKey: input.workerKey
    }))
    .digest("base64url");
}

async function authorizeClaim(input: { claimId: string; capability: string }) {
  const { claim, execution } = await loadClaimContext(input);
  if (claim.status !== "active") throw new Error("external_claim_fenced");
  const effectiveLeaseExpiry = Math.max(
    Date.parse(claim.leaseExpiresAt),
    claim.operationDeadlineAt ? Date.parse(claim.operationDeadlineAt) : 0
  );
  if (effectiveLeaseExpiry <= Date.now()) {
    await externalAuthoringRepository.fenceClaim(claim.id, new Date().toISOString());
    throw new Error("external_claim_fenced");
  }
  if (execution.deadlineAt && Date.parse(execution.deadlineAt) <= Date.now()) {
    await failExecutionDeadline(claim, execution);
    throw new Error("external_execution_deadline_exceeded");
  }
  if (!execution.bundleId) throw new Error("external_execution_unpinned");
  const bundle = await externalAuthoringRepository.getBundle(execution.bundleId);
  if (!bundle) throw new Error("external_execution_bundle_missing");
  await assertExternalAuthoringBundleCurrent({
    execution,
    bundle,
    claimId: claim.id
  });
  return { claim, execution };
}

async function loadClaimContext(input: { claimId: string; capability: string }) {
  if (input.capability.length < 32 || input.capability.length > 256) throw new Error("external_claim_fenced");
  const claim = await externalAuthoringRepository.getClaim(input.claimId);
  if (!claim || claim.capabilityHash !== sha256(input.capability)) throw new Error("external_claim_fenced");
  const execution = await externalAuthoringRepository.getExecution(claim.executionId);
  if (!execution) throw new Error("external_execution_missing");
  return { claim, execution };
}

async function failExecutionDeadline(
  claim: ExternalAuthoringClaim,
  execution: NonNullable<Awaited<ReturnType<typeof externalAuthoringRepository.getExecution>>>
) {
  const now = new Date().toISOString();
  await externalAuthoringRepository.fenceClaim(claim.id, now);
  await externalAuthoringRepository.saveExecution(externalAuthoringExecutionSchema.parse({
    ...execution,
    status: "failed",
    currentOperationId: undefined,
    completedAt: now,
    lastActivityAt: now,
    updatedAt: now
  }));
  const run = await sitePlatformRepository.getAgentRun(execution.runId);
  if (run) {
    await sitePlatformRepository.saveAgentRun(siteAgentRunSchema.parse({
      ...run,
      status: "failed",
      stage: "failed",
      failureCode: "execution_deadline_exceeded",
      failureCategory: "worker",
      retryableByOwner: true,
      failureReason: "The external two-hour execution deadline elapsed. The last durable draft was preserved and can be retried.",
      completedAt: now
    }));
  }
}

function retainedOperationResult(operation: ExternalAuthoringOperation) {
  if (operation.status === "succeeded") return {
    ok: true as const,
    retained: true as const,
    operationId: operation.id,
    stateRevision: operation.postStateRevision,
    workspaceHash: operation.postWorkspaceHash,
    ...(operation.result ?? {})
  };
  if (operation.status === "failed" || operation.status === "cancelled") return {
    ok: false as const,
    retained: true as const,
    operationId: operation.id,
    status: operation.status,
    errorCode: operation.errorCode,
    ...(operation.result ?? {})
  };
  return {
    ok: true as const,
    retained: true as const,
    operationId: operation.id,
    status: "in_progress" as const,
    deadlineAt: operation.deadlineAt
  };
}

function withExternalUsage(run: ReturnType<typeof siteAgentRunSchema.parse>, toolName: ManagerToolName, durationMs: number, storageBytes: number) {
  if (run.usage.kind !== "external_unavailable") throw new Error("external_run_usage_required");
  return siteAgentRunSchema.parse({
    ...run,
    usage: {
      ...run.usage,
      sandboxDurationMs: run.usage.sandboxDurationMs + (toolName === "build_preview" ? durationMs : 0),
      browserDurationMs: run.usage.browserDurationMs + (["inspect_site", "finish"].includes(toolName) ? durationMs : 0),
      storageBytes: run.usage.storageBytes + storageBytes,
      durationMs: run.usage.durationMs + durationMs
    }
  });
}

function compactToolResult(tool: Awaited<ReturnType<typeof siteAuthoringWorkflow.executeExternalTool>>["tool"]) {
  return {
    modelOutput: tool.modelOutput,
    diagnosticOutput: tool.diagnosticOutput,
    needsInput: tool.needsInput,
    completion: tool.completion
  };
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice("sha256:".length, "sha256:".length + 24)}`;
}

function operationTimeoutMs(toolName: ManagerToolName) {
  if (toolName === "inspect_site" || toolName === "finish") return 20 * 60_000;
  if (toolName === "build_preview") return 10 * 60_000;
  return 2 * 60_000;
}

function failureCode(error: unknown) {
  const message = safeMessage(error);
  if (/deadline/i.test(message)) return "execution_deadline_exceeded";
  if (/fenced/i.test(message)) return "external_claim_fenced";
  if (/state_revision/i.test(message)) return "external_state_revision_conflict";
  return "external_tool_failed";
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 2000 ? message : `${message.slice(0, 1980)}…`;
}

async function completeLocalExternalFinalization(input: {
  claim: ExternalAuthoringClaim;
  execution: Awaited<ReturnType<typeof externalAuthoringRepository.getExecution>> & {};
  capability: string;
  operation: ExternalAuthoringOperation;
  checkpoint: { key: string; contentHash: `sha256:${string}`; bytes: number; receiptId: string };
  finalization: NonNullable<Awaited<ReturnType<typeof siteAuthoringWorkflow.executeExternalTool>>["finalization"]>;
}) {
  if (!input.execution) throw new Error("Local external execution is unavailable.");
  const now = new Date().toISOString();
  await externalAuthoringRepository.completeOperation({
    operationId: input.operation.id,
    capabilityHash: sha256(input.capability),
    result: {
      ok: true,
      completed: true,
      candidateVersionId: input.finalization.version.id,
      previewId: input.finalization.previewGrant.id
    },
    workspaceHash: input.finalization.revision.sourceHash,
    checkpointKey: input.checkpoint.key,
    checkpointHash: input.checkpoint.contentHash
  });
  await platformOperationsRepository.createPreviewGrant(input.finalization.previewGrant);
  const item = await externalAuthoringRepository.getBatchItem(input.execution.batchItemId);
  if (item) {
    await externalAuthoringRepository.saveBatchItem({
      ...item,
      candidateVersionId: input.finalization.version.id,
      previewId: input.finalization.previewGrant.id,
      updatedAt: now
    });
    const prospects = await platformOperationsRepository.listOutboundProspects();
    const prospect = prospects.find((candidate) => candidate.id === item.prospectId);
    if (prospect) await platformOperationsRepository.upsertOutboundProspect({ ...prospect, previewId: input.finalization.previewGrant.id });
  }
  await externalAuthoringRepository.saveExecution({
    ...input.execution,
    status: "completed",
    stateRevision: input.execution.stateRevision + 1,
    currentOperationId: undefined,
    finalizationKey: input.finalization.finalizationKey,
    completedAt: now,
    lastActivityAt: now,
    updatedAt: now
  });
  await externalAuthoringRepository.releaseClaim(input.claim.id, now);
}
