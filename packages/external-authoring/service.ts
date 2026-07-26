import { sha256, stableJson, WebsiteCrawlError } from "@/packages/business-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";
import { normalizeBootstrapSourceUrl } from "@/packages/site-platform/source-url";
import {
  externalAuthoringBatchItemSchema,
  externalAuthoringBatchSchema,
  type DerivedBatchItemStatus,
  type DerivedBatchStatus,
  type ExternalAuthoringBatch,
  type ExternalAuthoringBatchItem,
  type ExternalAuthoringExecution
} from "./contracts";
import { externalAuthoringRepository, type ExternalAuthoringRepository } from "./repository";
import { assertExternalAuthoringBundleCurrent } from "./runtime-compatibility";

export type ExternalAuthoringBatchInput = {
  name: string;
  requestedBy: string;
  idempotencyKey: string;
  websites: Array<{ url: string; businessName?: string }>;
};

export async function createExternalAuthoringBatch(
  input: ExternalAuthoringBatchInput,
  repository: ExternalAuthoringRepository = externalAuthoringRepository
) {
  if (!input.websites.length || input.websites.length > 500) throw new Error("A batch must contain between 1 and 500 websites.");
  const requestedWebsites = input.websites.map((website) => ({
    sourceUrl: website.url,
    normalizedSource: normalizeBatchUrl(website.url),
    businessNameHint: website.businessName?.trim() || undefined
  }));
  if (new Set(requestedWebsites.map((item) => item.normalizedSource)).size !== requestedWebsites.length) {
    throw new Error("A batch cannot contain the same normalized website more than once.");
  }
  const batchId = deterministicId("external_batch", {
    schemaVersion: 1,
    requestedBy: input.requestedBy,
    idempotencyKey: input.idempotencyKey
  });
  const existing = await repository.getBatch(batchId);
  if (existing) {
    const existingItems = await repository.listBatchItems(existing.id);
    const sameRequest = existing.name === input.name
      && existing.requestedBy === input.requestedBy
      && existingItems.length === requestedWebsites.length
      && existingItems.every((item, index) => (
        item.ordinal === index
        && item.sourceUrl === requestedWebsites[index]?.sourceUrl
        && item.normalizedSource === requestedWebsites[index]?.normalizedSource
        && item.businessNameHint === requestedWebsites[index]?.businessNameHint
      ));
    if (!sameRequest) throw new Error("Batch idempotency conflict.");
    return { batch: existing, items: existingItems, created: false as const };
  }
  const now = new Date().toISOString();
  const campaignId = deterministicId("campaign", { schemaVersion: 1, batchId });
  await platformOperationsRepository.createOutboundCampaign({
    id: campaignId,
    name: input.name,
    channel: "manual",
    status: "draft",
    metadata: {
      externalAuthoringBatchId: batchId,
      plannedRecipients: input.websites.length
    }
  });
  const batch = externalAuthoringBatchSchema.parse({
    schemaVersion: 1,
    id: batchId,
    name: input.name,
    requestedBy: input.requestedBy,
    campaignId,
    createdAt: now
  });
  const items = requestedWebsites.map((website, ordinal) => {
    const normalizedSource = website.normalizedSource;
    const preparationKey = sha256(stableJson({
      schemaVersion: 1,
      batchId,
      ordinal,
      normalizedSource
    }));
    return externalAuthoringBatchItemSchema.parse({
      schemaVersion: 1,
      id: deterministicId("external_item", { schemaVersion: 1, preparationKey }),
      batchId,
      ordinal,
      sourceUrl: website.sourceUrl,
      normalizedSource,
      businessNameHint: website.businessNameHint,
      preparationKey,
      preparationStatus: "queued",
      preparationAttempts: 0,
      createdAt: now,
      updatedAt: now
    });
  });
  await repository.createBatch(batch, items);
  return { batch, items, created: true as const };
}

export async function processNextExternalPreparation(input: {
  workerId?: string;
  operatorId?: string;
  repository?: ExternalAuthoringRepository;
} = {}) {
  const repository = input.repository ?? externalAuthoringRepository;
  const workerId = input.workerId ?? `external-preparation-${process.pid}`;
  const item = await repository.claimNextPreparation(workerId);
  if (!item) return null;
  const batch = await repository.getBatch(item.batchId);
  if (!batch || batch.cancelRequestedAt) {
    await repository.saveBatchItem(externalAuthoringBatchItemSchema.parse({
      ...item,
      preparationStatus: "failed",
      preparationFailureCode: "batch_cancelled",
      preparationFailureReason: "Batch cancellation was requested before preparation completed.",
      preparationLockedBy: undefined,
      preparationLockedAt: undefined,
      updatedAt: new Date().toISOString()
    }));
    return { itemId: item.id, status: "cancelled" as const };
  }
  try {
    const prepared = await siteAuthoringWorkflow.prepareExternalSite({
      url: item.sourceUrl,
      operatorId: input.operatorId ?? batch.requestedBy,
      batchItemId: item.id,
      preparationKey: item.preparationKey as `sha256:${string}`,
      signal: AbortSignal.timeout(30 * 60_000)
    });
    const prospectId = deterministicId("prospect", { schemaVersion: 1, batchItemId: item.id });
    await platformOperationsRepository.upsertOutboundProspect({
      id: prospectId,
      campaignId: batch.campaignId,
      siteId: prepared.site.id,
      businessName: prepared.state.identity.name,
      sourceUrl: item.sourceUrl,
      status: "queued",
      metadata: {
        externalAuthoringBatchItemId: item.id,
        ...(item.businessNameHint ? { operatorBusinessNameHint: item.businessNameHint } : {})
      }
    });
    const completed = externalAuthoringBatchItemSchema.parse({
      ...item,
      preparationStatus: "completed",
      siteId: prepared.site.id,
      prospectId,
      sessionId: prepared.session.id,
      runId: prepared.run.id,
      preparationLockedBy: undefined,
      preparationLockedAt: undefined,
      preparationFailureCode: undefined,
      preparationFailureReason: undefined,
      updatedAt: new Date().toISOString()
    });
    await repository.saveBatchItem(completed);
    return { itemId: item.id, status: "completed" as const, siteId: completed.siteId, runId: completed.runId };
  } catch (error) {
    const message = safeMessage(error);
    const code = error instanceof WebsiteCrawlError ? error.code : "preparation_failed";
    const retryable = ["crawl_temporarily_unavailable", "crawl_primary_unavailable", "preparation_failed"].includes(code) && item.preparationAttempts < 3;
    await repository.saveBatchItem(externalAuthoringBatchItemSchema.parse({
      ...item,
      preparationStatus: retryable ? "queued" : "failed",
      preparationFailureCode: code,
      preparationFailureReason: message,
      preparationLockedBy: undefined,
      preparationLockedAt: undefined,
      updatedAt: new Date().toISOString()
    }));
    return { itemId: item.id, status: retryable ? "queued" as const : "failed" as const, error: message };
  }
}

export async function getExternalAuthoringBatchView(
  batchId: string,
  repository: ExternalAuthoringRepository = externalAuthoringRepository
) {
  const batch = await repository.getBatch(batchId);
  if (!batch) return null;
  const items = await repository.listBatchItems(batchId);
  const rows = await Promise.all(items.map(async (item) => {
    const [execution, run] = await Promise.all([
      item.runId ? repository.getExecutionForRun(item.runId) : Promise.resolve(null),
      item.runId ? sitePlatformRepository.getAgentRun(item.runId) : Promise.resolve(undefined)
    ]);
    return {
      item,
      execution,
      run,
      status: deriveBatchItemStatus({
        item,
        execution,
        runStatus: run?.status,
        batchCancelRequested: Boolean(batch.cancelRequestedAt)
      })
    };
  }));
  return {
    batch,
    rows,
    status: deriveBatchStatus(rows.map((row) => row.status), Boolean(batch.cancelRequestedAt))
  };
}

export async function cancelExternalAuthoringBatch(
  batchId: string,
  repository: ExternalAuthoringRepository = externalAuthoringRepository
) {
  const batch = await repository.getBatch(batchId);
  if (!batch) throw new Error("Authoring batch not found.");
  const cancelledAt = new Date().toISOString();
  await repository.requestBatchCancellation(batchId, cancelledAt);
  if (process.env.LODESTA_REPOSITORY === "local") {
    const items = await repository.listBatchItems(batchId);
    for (const item of items) {
      if (!item.runId) continue;
      const run = await sitePlatformRepository.getAgentRun(item.runId);
      if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) continue;
      await sitePlatformRepository.saveAgentRun({
        ...run,
        status: "cancelled",
        completedAt: cancelledAt
      });
    }
  }
  return { batchId, cancelRequestedAt: cancelledAt };
}

export async function submitExternalAuthoringClarification(input: {
  batchId: string;
  itemId: string;
  answer: string;
  actorId: string;
  repository?: ExternalAuthoringRepository;
}) {
  const repository = input.repository ?? externalAuthoringRepository;
  const item = await repository.getBatchItem(input.itemId);
  if (!item || item.batchId !== input.batchId || !item.runId || !item.sessionId) {
    throw new Error("External authoring batch item was not found.");
  }
  const execution = await repository.getExecutionForRun(item.runId);
  if (!execution || execution.status !== "needs_input") {
    throw new Error("This execution is not waiting for operator input.");
  }
  if (!execution.bundleId) throw new Error("External authoring execution is unpinned.");
  const bundle = await repository.getBundle(execution.bundleId);
  if (!bundle) throw new Error("External authoring bundle was not found.");
  await assertExternalAuthoringBundleCurrent({
    execution,
    bundle,
    externalRepository: repository
  });
  const run = await siteAuthoringWorkflow.resumeNeedsInput({
    runId: item.runId,
    sessionId: item.sessionId,
    answer: input.answer,
    actorId: input.actorId
  });
  await repository.requeueExecution(execution.id, new Date().toISOString());
  return { item, executionId: execution.id, run };
}

export async function retryExternalAuthoringExecution(input: {
  batchId: string;
  itemId: string;
  actorId: string;
  repository?: ExternalAuthoringRepository;
}) {
  const repository = input.repository ?? externalAuthoringRepository;
  const item = await repository.getBatchItem(input.itemId);
  if (!item || item.batchId !== input.batchId || !item.runId) throw new Error("External authoring batch item was not found.");
  const [execution, run] = await Promise.all([
    repository.getExecutionForRun(item.runId),
    sitePlatformRepository.getAgentRun(item.runId)
  ]);
  if (!execution || !run || execution.status !== "failed" || run.status !== "failed") {
    throw new Error("Only a failed external execution can be retried.");
  }
  if (!run.retryableByOwner) throw new Error("This failure requires operator review before retry.");
  if (run.requestedBy !== input.actorId) {
    const session = await sitePlatformRepository.getAgentSession(run.sessionId);
    if (session?.principal.id !== input.actorId) throw new Error("Session principal mismatch.");
  }
  const now = new Date().toISOString();
  await sitePlatformRepository.saveAgentRun({
    ...run,
    status: "queued",
    stage: "queued",
    failureCode: undefined,
    failureCategory: undefined,
    retryableByOwner: false,
    failureReason: undefined,
    completedAt: undefined,
    startedAt: now
  });
  await repository.requeueExecution(execution.id, now);
  return { item, executionId: execution.id, runId: run.id };
}

export async function expireExternalAuthoringExecutionDeadlines(
  repository: ExternalAuthoringRepository = externalAuthoringRepository
) {
  const now = new Date().toISOString();
  const executionIds = await repository.expireExecutionDeadlines(now);
  if (process.env.LODESTA_REPOSITORY === "local") {
    for (const executionId of executionIds) {
      const execution = await repository.getExecution(executionId);
      if (!execution) continue;
      const run = await sitePlatformRepository.getAgentRun(execution.runId);
      if (!run) continue;
      await sitePlatformRepository.saveAgentRun({
        ...run,
        status: "failed",
        stage: "failed",
        failureCode: "execution_deadline_exceeded",
        failureCategory: "worker",
        retryableByOwner: true,
        failureReason: "The external two-hour execution deadline elapsed. The last durable draft was preserved and can be retried.",
        completedAt: now
      });
    }
  }
  return executionIds;
}

export function deriveBatchItemStatus(input: {
  item: ExternalAuthoringBatchItem;
  execution?: ExternalAuthoringExecution | null;
  runStatus?: "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
  batchCancelRequested?: boolean;
}): DerivedBatchItemStatus {
  if (input.item.preparationStatus === "queued" || input.item.preparationStatus === "running") return "preparing";
  if (input.item.preparationStatus === "failed") return input.item.preparationFailureCode === "batch_cancelled" ? "cancelled" : "failed";
  if (input.item.candidateVersionId) return "candidate_ready";
  if (input.batchCancelRequested) return input.execution?.currentOperationId || input.execution?.status === "authoring" || input.execution?.status === "finalizing" ? "cancelling" : "cancelled";
  if (input.runStatus === "needs_input" || input.execution?.status === "needs_input") return "needs_input";
  if (input.runStatus === "failed" || input.execution?.status === "failed") return "failed";
  if (input.runStatus === "cancelled" || input.execution?.status === "cancelled") return "cancelled";
  if (input.execution?.status === "finalizing") return "finalizing";
  if (input.execution?.status === "authoring") return "authoring";
  if (input.execution?.status === "claimed") return "claimed";
  return "queued";
}

export function deriveBatchStatus(statuses: DerivedBatchItemStatus[], cancelRequested: boolean): DerivedBatchStatus {
  if (!statuses.length || statuses.some((status) => status === "preparing")) return "preparing";
  if (cancelRequested && statuses.some((status) => ["claimed", "authoring", "finalizing", "cancelling"].includes(status))) return "cancelling";
  if (cancelRequested && statuses.every((status) => ["cancelled", "failed", "candidate_ready"].includes(status))) return "cancelled";
  if (statuses.every((status) => status === "queued")) return "ready";
  if (statuses.every((status) => status === "candidate_ready")) return "completed";
  if (statuses.every((status) => ["candidate_ready", "failed", "cancelled"].includes(status))) return "completed_with_errors";
  return "running";
}

function normalizeBatchUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Website URLs must use HTTP or HTTPS.");
  url.hash = "";
  return normalizeBootstrapSourceUrl(url.href);
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(stableJson(value)).slice("sha256:".length, "sha256:".length + 24)}`;
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 2000 ? message : `${message.slice(0, 1980)}…`;
}
