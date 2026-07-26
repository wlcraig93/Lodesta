import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import {
  authoringExecutionBundleSchema,
  authoringOutboxEventSchema,
  externalAuthoringBatchItemSchema,
  externalAuthoringBatchSchema,
  externalAuthoringClaimSchema,
  externalAuthoringCredentialSchema,
  externalAuthoringExecutionSchema,
  externalAuthoringOperationSchema,
  stagedBlobReceiptSchema,
  type AuthoringExecutionBundle,
  type AuthoringOutboxEvent,
  type ExternalAuthoringBatch,
  type ExternalAuthoringBatchItem,
  type ExternalAuthoringClaim,
  type ExternalAuthoringCredential,
  type ExternalAuthoringExecution,
  type ExternalAuthoringOperation,
  type StagedBlobReceipt
} from "./contracts";

export interface ExternalAuthoringRepository {
  createBatch(batch: ExternalAuthoringBatch, items: ExternalAuthoringBatchItem[]): Promise<void>;
  getBatch(batchId: string): Promise<ExternalAuthoringBatch | null>;
  listBatches(): Promise<ExternalAuthoringBatch[]>;
  listBatchItems(batchId: string): Promise<ExternalAuthoringBatchItem[]>;
  getBatchItem(itemId: string): Promise<ExternalAuthoringBatchItem | null>;
  claimNextPreparation(workerId: string): Promise<ExternalAuthoringBatchItem | null>;
  saveBatchItem(item: ExternalAuthoringBatchItem): Promise<void>;
  requestBatchCancellation(batchId: string, at: string): Promise<void>;
  saveBundle(bundle: AuthoringExecutionBundle): Promise<void>;
  getBundle(bundleId: string): Promise<AuthoringExecutionBundle | null>;
  saveExecution(execution: ExternalAuthoringExecution): Promise<void>;
  requeueExecution(executionId: string, at: string): Promise<void>;
  expireExecutionDeadlines(at: string): Promise<string[]>;
  getExecution(executionId: string): Promise<ExternalAuthoringExecution | null>;
  getExecutionForRun(runId: string): Promise<ExternalAuthoringExecution | null>;
  listExecutionsByStatuses(statuses: ExternalAuthoringExecution["status"][], limit?: number): Promise<ExternalAuthoringExecution[]>;
  claimNext(input: {
    claimId: string;
    bindingId: string;
    workerKeyHash: string;
    capabilityHash: string;
    leaseExpiresAt: string;
    deadlineAt: string;
  }): Promise<{ claim: ExternalAuthoringClaim; execution: ExternalAuthoringExecution; reattached: boolean } | null>;
  getClaim(claimId: string): Promise<ExternalAuthoringClaim | null>;
  releaseClaim(claimId: string, at: string): Promise<void>;
  fenceClaim(claimId: string, at: string): Promise<void>;
  reserveOperation(operation: ExternalAuthoringOperation, expectedStateRevision: number, capabilityHash: string): Promise<ExternalAuthoringOperation | null>;
  markOperationRunning(operationId: string, capabilityHash: string): Promise<boolean>;
  getOperationByKey(operationKey: string): Promise<ExternalAuthoringOperation | null>;
  getOperation(operationId: string): Promise<ExternalAuthoringOperation | null>;
  completeOperation(input: {
    operationId: string;
    capabilityHash: string;
    result: Record<string, unknown>;
    workspaceHash?: string;
    checkpointKey?: string;
    checkpointHash?: string;
  }): Promise<ExternalAuthoringOperation>;
  failOperation(operationId: string, capabilityHash: string, errorCode: string, result?: Record<string, unknown>): Promise<ExternalAuthoringOperation | null>;
  saveCredential(credential: ExternalAuthoringCredential): Promise<void>;
  listCredentials(): Promise<ExternalAuthoringCredential[]>;
  findActiveCredential(tokenHash: string): Promise<ExternalAuthoringCredential | null>;
  revokeCredential(credentialId: string, at: string): Promise<void>;
  recordCredentialRequest(input: { credentialId: string; toolName?: string; accepted: boolean; occurredAt: string }): Promise<number>;
  saveStagedBlobReceipt(receipt: StagedBlobReceipt): Promise<void>;
  enqueueOutbox(event: AuthoringOutboxEvent): Promise<void>;
  claimOutbox(workerId: string): Promise<AuthoringOutboxEvent | null>;
  completeOutbox(eventId: string, at: string): Promise<void>;
  failOutbox(eventId: string, error: string, retryAt: string): Promise<void>;
}

type LocalState = {
  batches: Record<string, ExternalAuthoringBatch>;
  items: Record<string, ExternalAuthoringBatchItem>;
  bundles: Record<string, AuthoringExecutionBundle>;
  executions: Record<string, ExternalAuthoringExecution>;
  claims: Record<string, ExternalAuthoringClaim>;
  operations: Record<string, ExternalAuthoringOperation>;
  credentials: Record<string, ExternalAuthoringCredential>;
  credentialRequests: Array<{ credentialId: string; toolName?: string; accepted: boolean; occurredAt: string }>;
  stagedBlobs: Record<string, StagedBlobReceipt>;
  outbox: Record<string, AuthoringOutboxEvent>;
};

const emptyLocalState = (): LocalState => ({
  batches: {},
  items: {},
  bundles: {},
  executions: {},
  claims: {},
  operations: {},
  credentials: {},
  credentialRequests: [],
  stagedBlobs: {},
  outbox: {}
});

export class LocalExternalAuthoringRepository implements ExternalAuthoringRepository {
  private queue = Promise.resolve();
  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "external-authoring.json")) {}

  createBatch(batch: ExternalAuthoringBatch, items: ExternalAuthoringBatchItem[]) {
    return this.write((state) => {
      const value = externalAuthoringBatchSchema.parse(batch);
      const parsedItems = items.map((item) => externalAuthoringBatchItemSchema.parse(item));
      const existing = state.batches[value.id];
      if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error("Batch idempotency conflict.");
      state.batches[value.id] = value;
      for (const item of parsedItems) {
        const duplicate = Object.values(state.items).find((candidate) => candidate.preparationKey === item.preparationKey);
        if (duplicate && duplicate.id !== item.id) throw new Error("Preparation key conflict.");
        state.items[item.id] = item;
      }
    });
  }
  async getBatch(batchId: string) { return clone((await this.read()).batches[batchId] ?? null); }
  async listBatches() { return Object.values((await this.read()).batches).sort(byCreatedDesc).map(clone); }
  async listBatchItems(batchId: string) { return Object.values((await this.read()).items).filter((item) => item.batchId === batchId).sort((a, b) => a.ordinal - b.ordinal).map(clone); }
  async getBatchItem(itemId: string) { return clone((await this.read()).items[itemId] ?? null); }
  async claimNextPreparation(workerId: string) {
    let result: ExternalAuthoringBatchItem | null = null;
    await this.write((state) => {
      const staleBefore = Date.now() - 30 * 60_000;
      const item = Object.values(state.items)
        .filter((candidate) => !state.batches[candidate.batchId]?.cancelRequestedAt)
        .filter((candidate) => candidate.preparationStatus === "queued" || (candidate.preparationStatus === "running" && candidate.preparationLockedAt && Date.parse(candidate.preparationLockedAt) < staleBefore))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.ordinal - b.ordinal)[0];
      if (!item) return;
      item.preparationStatus = "running";
      item.preparationAttempts += 1;
      item.preparationLockedBy = workerId;
      item.preparationLockedAt = new Date().toISOString();
      item.updatedAt = item.preparationLockedAt;
      delete item.preparationFailureCode;
      delete item.preparationFailureReason;
      result = clone(item);
    });
    return result;
  }
  saveBatchItem(item: ExternalAuthoringBatchItem) { return this.write((state) => { state.items[item.id] = externalAuthoringBatchItemSchema.parse(item); }); }
  requestBatchCancellation(batchId: string, at: string) {
    return this.write((state) => {
      const batch = state.batches[batchId];
      if (batch) batch.cancelRequestedAt ??= at;
      for (const execution of Object.values(state.executions)) {
        const item = state.items[execution.batchItemId];
        if (item?.batchId === batchId && !["completed", "failed", "cancelled"].includes(execution.status)) {
          execution.status = "cancelled";
          execution.completedAt = at;
          execution.updatedAt = at;
          for (const claim of Object.values(state.claims)) {
            if (claim.executionId === execution.id && claim.status === "active") {
              claim.status = "fenced";
              claim.updatedAt = at;
              claim.lastActivityAt = at;
            }
          }
          for (const operation of Object.values(state.operations)) {
            if (operation.executionId === execution.id && operation.status === "reserved") {
              operation.status = "cancelled";
              operation.errorCode = "batch_cancelled";
              operation.completedAt = at;
              operation.updatedAt = at;
            }
          }
          const running = execution.currentOperationId
            ? state.operations[execution.currentOperationId]?.status === "running"
            : false;
          if (!running) execution.currentOperationId = undefined;
        }
      }
    });
  }
  saveBundle(bundle: AuthoringExecutionBundle) { return this.write((state) => { state.bundles[bundle.id] = authoringExecutionBundleSchema.parse(bundle); }); }
  async getBundle(bundleId: string) { return clone((await this.read()).bundles[bundleId] ?? null); }
  saveExecution(execution: ExternalAuthoringExecution) { return this.write((state) => { state.executions[execution.id] = externalAuthoringExecutionSchema.parse(execution); }); }
  requeueExecution(executionId: string, at: string) {
    return this.write((state) => {
      const execution = state.executions[executionId];
      if (!execution || ["completed", "cancelled"].includes(execution.status)) return;
      execution.status = "queued";
      execution.currentOperationId = undefined;
      execution.completedAt = undefined;
      execution.deadlineAt = undefined;
      execution.updatedAt = at;
      for (const claim of Object.values(state.claims)) {
        if (claim.executionId === executionId && claim.status === "active") {
          claim.status = "fenced"; claim.lastActivityAt = at; claim.updatedAt = at;
        }
      }
      for (const operation of Object.values(state.operations)) {
        if (operation.executionId === executionId && ["reserved", "running"].includes(operation.status)) {
          operation.status = "cancelled";
          operation.errorCode = "execution_requeued";
          operation.completedAt = at;
          operation.updatedAt = at;
        }
      }
    });
  }
  async expireExecutionDeadlines(at: string) {
    const expired: string[] = [];
    await this.write((state) => {
      for (const execution of Object.values(state.executions)) {
        if (!execution.deadlineAt || execution.deadlineAt > at || !["claimed", "needs_input", "authoring", "finalizing"].includes(execution.status)) continue;
        expired.push(execution.id);
        execution.status = "failed";
        execution.currentOperationId = undefined;
        execution.completedAt = at;
        execution.lastActivityAt = at;
        execution.updatedAt = at;
        for (const claim of Object.values(state.claims)) {
          if (claim.executionId === execution.id && claim.status === "active") {
            claim.status = "fenced";
            claim.operationDeadlineAt = undefined;
            claim.lastActivityAt = at;
            claim.updatedAt = at;
          }
        }
        for (const operation of Object.values(state.operations)) {
          if (operation.executionId === execution.id && ["reserved", "running"].includes(operation.status)) {
            operation.status = "cancelled";
            operation.errorCode = "execution_deadline_exceeded";
            operation.completedAt = at;
            operation.updatedAt = at;
          }
        }
      }
    });
    return expired;
  }
  async getExecution(executionId: string) { return clone((await this.read()).executions[executionId] ?? null); }
  async getExecutionForRun(runId: string) { return clone(Object.values((await this.read()).executions).find((item) => item.runId === runId) ?? null); }
  async listExecutionsByStatuses(statuses: ExternalAuthoringExecution["status"][], limit = 100) {
    return Object.values((await this.read()).executions)
      .filter((execution) => statuses.includes(execution.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 1000)))
      .map(clone);
  }
  async claimNext(input: {
    claimId: string;
    bindingId: string;
    workerKeyHash: string;
    capabilityHash: string;
    leaseExpiresAt: string;
    deadlineAt: string;
  }): Promise<{ claim: ExternalAuthoringClaim; execution: ExternalAuthoringExecution; reattached: boolean } | null> {
    let result: { claim: ExternalAuthoringClaim; execution: ExternalAuthoringExecution; reattached: boolean } | null = null;
    await this.write((state) => {
      const nowMs = Date.now();
      for (const expired of Object.values(state.claims)) {
        const effectiveExpiry = Math.max(
          Date.parse(expired.leaseExpiresAt),
          expired.operationDeadlineAt ? Date.parse(expired.operationDeadlineAt) : 0
        );
        if (expired.status !== "active" || effectiveExpiry > nowMs) continue;
        expired.status = "fenced";
        expired.operationDeadlineAt = undefined;
        expired.lastActivityAt = new Date(nowMs).toISOString();
        expired.updatedAt = expired.lastActivityAt;
        const expiredExecution = state.executions[expired.executionId];
        if (expiredExecution && !["completed", "failed", "cancelled", "needs_input"].includes(expiredExecution.status)) {
          expiredExecution.status = "queued";
          expiredExecution.currentOperationId = undefined;
          expiredExecution.updatedAt = expired.updatedAt;
        }
        for (const operation of Object.values(state.operations)) {
          if (operation.claimId === expired.id && ["reserved", "running"].includes(operation.status)) {
            operation.status = "cancelled";
            operation.errorCode = "claim_lease_expired";
            operation.completedAt = expired.updatedAt;
            operation.updatedAt = expired.updatedAt;
          }
        }
      }
      const existing = Object.values(state.claims).find((claim) =>
        claim.bindingId === input.bindingId
        && claim.workerKeyHash === input.workerKeyHash
        && claim.status === "active"
        && Math.max(
          Date.parse(claim.leaseExpiresAt),
          claim.operationDeadlineAt ? Date.parse(claim.operationDeadlineAt) : 0
        ) > Date.now()
      );
      if (existing) {
        existing.leaseExpiresAt = input.leaseExpiresAt;
        existing.lastActivityAt = new Date().toISOString();
        existing.updatedAt = existing.lastActivityAt;
        result = { claim: clone(existing), execution: clone(state.executions[existing.executionId]), reattached: true };
        return;
      }
      const execution = Object.values(state.executions)
        .filter((candidate) => candidate.status === "queued")
        .filter((candidate) => {
          const item = state.items[candidate.batchItemId];
          return item?.preparationStatus === "completed" && !state.batches[item.batchId]?.cancelRequestedAt;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!execution) return;
      const now = new Date().toISOString();
      const generation = Math.max(0, ...Object.values(state.claims).filter((claim) => claim.executionId === execution.id).map((claim) => claim.leaseGeneration)) + 1;
      const claim = externalAuthoringClaimSchema.parse({
        schemaVersion: 1,
        id: input.claimId,
        executionId: execution.id,
        bindingId: input.bindingId,
        workerKeyHash: input.workerKeyHash,
        capabilityHash: input.capabilityHash,
        leaseGeneration: generation,
        status: "active",
        leaseExpiresAt: input.leaseExpiresAt,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now
      });
      state.claims[claim.id] = claim;
      Object.assign(execution, { status: "claimed", claimedAt: execution.claimedAt ?? now, lastActivityAt: now, deadlineAt: execution.deadlineAt ?? input.deadlineAt, updatedAt: now } satisfies Partial<ExternalAuthoringExecution>);
      result = { claim: clone(claim), execution: clone(execution), reattached: false };
    });
    return result;
  }
  async getClaim(claimId: string) { return clone((await this.read()).claims[claimId] ?? null); }
  releaseClaim(claimId: string, at: string) { return this.write((state) => { const claim = state.claims[claimId]; if (claim) Object.assign(claim, { status: "released", operationDeadlineAt: undefined, lastActivityAt: at, updatedAt: at }); }); }
  fenceClaim(claimId: string, at: string) { return this.write((state) => { const claim = state.claims[claimId]; if (claim) Object.assign(claim, { status: "fenced", operationDeadlineAt: undefined, lastActivityAt: at, updatedAt: at }); }); }
  async reserveOperation(operation: ExternalAuthoringOperation, expectedStateRevision: number, capabilityHash: string): Promise<ExternalAuthoringOperation | null> {
    let result: ExternalAuthoringOperation | null = null;
    await this.write((state) => {
      const existing = Object.values(state.operations).find((item) => item.operationKey === operation.operationKey);
      if (existing) { result = clone(existing); return; }
      const conflicting = Object.values(state.operations).find((item) =>
        item.claimId === operation.claimId
        && item.leaseGeneration === operation.leaseGeneration
        && item.idempotencyKeyHash === operation.idempotencyKeyHash
      );
      if (conflicting) throw new Error("external_idempotency_key_conflict");
      const claim = state.claims[operation.claimId];
      const execution = state.executions[operation.executionId];
      if (!claim || claim.status !== "active" || claim.capabilityHash !== capabilityHash || claim.leaseGeneration !== operation.leaseGeneration || Date.parse(claim.leaseExpiresAt) <= Date.now()) throw new Error("external_claim_fenced");
      if (!execution || execution.stateRevision !== expectedStateRevision) throw new Error("external_state_revision_conflict");
      const activeServer = Object.values(state.operations).filter((item) => ["reserved", "running"].includes(item.status) && ["build_preview", "inspect_site", "finish"].includes(item.toolName)).length;
      if (["build_preview", "inspect_site", "finish"].includes(operation.toolName) && activeServer >= 3) return;
      const value = externalAuthoringOperationSchema.parse(operation);
      state.operations[value.id] = value;
      claim.operationDeadlineAt = value.deadlineAt;
      claim.lastActivityAt = new Date().toISOString();
      claim.updatedAt = claim.lastActivityAt;
      execution.currentOperationId = value.id;
      execution.status = value.toolName === "finish" ? "finalizing" : "authoring";
      execution.updatedAt = new Date().toISOString();
      result = clone(value);
    });
    return result;
  }
  async getOperationByKey(operationKey: string) { return clone(Object.values((await this.read()).operations).find((item) => item.operationKey === operationKey) ?? null); }
  async getOperation(operationId: string) { return clone((await this.read()).operations[operationId] ?? null); }
  async markOperationRunning(operationId: string, capabilityHash: string) {
    let claimed = false;
    await this.write((state) => {
      const operation = state.operations[operationId];
      const claim = operation ? state.claims[operation.claimId] : undefined;
      if (!operation || operation.status !== "reserved" || claim?.capabilityHash !== capabilityHash || claim.status !== "active") return;
      operation.status = "running";
      operation.updatedAt = new Date().toISOString();
      claimed = true;
    });
    return claimed;
  }
  async completeOperation(input: { operationId: string; capabilityHash: string; result: Record<string, unknown>; workspaceHash?: string; checkpointKey?: string; checkpointHash?: string }) {
    let result!: ExternalAuthoringOperation;
    await this.write((state) => {
      const operation = state.operations[input.operationId];
      const claim = operation ? state.claims[operation.claimId] : undefined;
      const execution = operation ? state.executions[operation.executionId] : undefined;
      if (!operation || !claim || !execution || claim.status !== "active" || claim.capabilityHash !== input.capabilityHash || claim.leaseGeneration !== operation.leaseGeneration) throw new Error("external_claim_fenced");
      if (operation.status === "succeeded") { result = clone(operation); return; }
      if (execution.stateRevision !== operation.preStateRevision) throw new Error("external_state_revision_conflict");
      if (Date.parse(operation.deadlineAt) <= Date.now()) throw new Error("external_operation_deadline_exceeded");
      const now = new Date().toISOString();
      Object.assign(operation, { status: "succeeded", result: input.result, postStateRevision: operation.preStateRevision + 1, postWorkspaceHash: input.workspaceHash, completedAt: now, updatedAt: now } satisfies Partial<ExternalAuthoringOperation>);
      Object.assign(execution, { stateRevision: execution.stateRevision + 1, workspaceHash: input.workspaceHash, checkpointKey: input.checkpointKey, checkpointHash: input.checkpointHash, currentOperationId: undefined, lastActivityAt: now, updatedAt: now } satisfies Partial<ExternalAuthoringExecution>);
      claim.operationDeadlineAt = undefined;
      claim.lastActivityAt = now;
      claim.updatedAt = now;
      result = clone(operation);
    });
    return result;
  }
  async failOperation(operationId: string, capabilityHash: string, errorCode: string, resultValue?: Record<string, unknown>) {
    let result: ExternalAuthoringOperation | null = null;
    await this.write((state) => {
      const operation = state.operations[operationId];
      const claim = operation ? state.claims[operation.claimId] : undefined;
      if (!operation || !claim || claim.capabilityHash !== capabilityHash) return;
      if (!["reserved", "running"].includes(operation.status)) {
        result = clone(operation);
        return;
      }
      const now = new Date().toISOString();
      Object.assign(operation, { status: "failed", errorCode, result: resultValue, completedAt: now, updatedAt: now } satisfies Partial<ExternalAuthoringOperation>);
      const execution = state.executions[operation.executionId];
      if (execution) { execution.currentOperationId = undefined; execution.updatedAt = now; }
      claim.operationDeadlineAt = undefined;
      claim.lastActivityAt = now;
      claim.updatedAt = now;
      result = clone(operation);
    });
    return result;
  }
  saveCredential(credential: ExternalAuthoringCredential) { return this.write((state) => { state.credentials[credential.id] = externalAuthoringCredentialSchema.parse(credential); }); }
  async listCredentials() { return Object.values((await this.read()).credentials).sort(byCreatedDesc).map(clone); }
  async findActiveCredential(tokenHash: string) { return clone(Object.values((await this.read()).credentials).find((item) => item.tokenHash === tokenHash && item.status === "active") ?? null); }
  revokeCredential(credentialId: string, at: string) { return this.write((state) => { const credential = state.credentials[credentialId]; if (credential) Object.assign(credential, { status: "revoked", revokedAt: at }); }); }
  async recordCredentialRequest(input: { credentialId: string; toolName?: string; accepted: boolean; occurredAt: string }) {
    let count = 0;
    await this.write((state) => {
      state.credentialRequests.push(input);
      const cutoff = Date.parse(input.occurredAt) - 60_000;
      state.credentialRequests = state.credentialRequests.filter((item) => Date.parse(item.occurredAt) >= cutoff);
      count = state.credentialRequests.filter((item) => item.credentialId === input.credentialId).length;
    });
    return count;
  }
  saveStagedBlobReceipt(receipt: StagedBlobReceipt) { return this.write((state) => { state.stagedBlobs[receipt.id] = stagedBlobReceiptSchema.parse(receipt); }); }
  enqueueOutbox(event: AuthoringOutboxEvent) {
    return this.write((state) => {
      const value = authoringOutboxEventSchema.parse(event);
      const existing = Object.values(state.outbox).find((item) => item.eventType === value.eventType && item.aggregateId === value.aggregateId);
      if (existing) return;
      state.outbox[value.id] = value;
    });
  }
  async claimOutbox(workerId: string) {
    let result: AuthoringOutboxEvent | null = null;
    await this.write((state) => {
      const event = Object.values(state.outbox).filter((item) => item.status === "pending" && item.runAfter <= new Date().toISOString()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!event) return;
      event.status = "processing"; event.attempts += 1; event.lockedBy = workerId; event.lockedAt = new Date().toISOString(); result = clone(event);
    });
    return result;
  }
  completeOutbox(eventId: string, at: string) { return this.write((state) => { const event = state.outbox[eventId]; if (event) Object.assign(event, { status: "completed", completedAt: at, lockedBy: undefined, lockedAt: undefined }); }); }
  failOutbox(eventId: string, error: string, retryAt: string) { return this.write((state) => { const event = state.outbox[eventId]; if (event) Object.assign(event, { status: event.attempts >= 5 ? "failed" : "pending", lastError: error.slice(0, 2000), runAfter: retryAt, lockedBy: undefined, lockedAt: undefined }); }); }

  private async read() {
    const raw = await readFile(this.path, "utf8").catch(() => undefined);
    return raw ? { ...emptyLocalState(), ...JSON.parse(raw) as Partial<LocalState> } : emptyLocalState();
  }
  private write(operation: (state: LocalState) => void | Promise<void>) {
    const next = this.queue.then(async () => {
      const state = await this.read();
      await operation(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temp, this.path);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

class SupabaseExternalAuthoringRepository implements ExternalAuthoringRepository {
  private get client() { return getSupabaseAdminClient(); }

  async createBatch(batch: ExternalAuthoringBatch, items: ExternalAuthoringBatchItem[]) {
    const value = externalAuthoringBatchSchema.parse(batch);
    await data(this.client.from("external_authoring_batches").insert({
      id: value.id, schema_version: value.schemaVersion, name: value.name, requested_by: value.requestedBy, campaign_id: value.campaignId,
      cancel_requested_at: value.cancelRequestedAt, created_at: value.createdAt
    }).select("id").single(), "Create external authoring batch");
    if (items.length) await data(this.client.from("external_authoring_batch_items").insert(items.map(itemToRow)).select("id"), "Create external authoring batch items");
  }
  async getBatch(batchId: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_batches").select("*").eq("id", batchId).maybeSingle(), "Get external batch"); return row ? batchFromRow(row) : null; }
  async listBatches() { return (await data<Record<string, unknown>[]>(this.client.from("external_authoring_batches").select("*").order("created_at", { ascending: false }), "List external batches")).map(batchFromRow); }
  async listBatchItems(batchId: string) { return (await data<Record<string, unknown>[]>(this.client.from("external_authoring_batch_items").select("*").eq("batch_id", batchId).order("ordinal"), "List external batch items")).map(itemFromRow); }
  async getBatchItem(itemId: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_batch_items").select("*").eq("id", itemId).maybeSingle(), "Get external batch item"); return row ? itemFromRow(row) : null; }
  async claimNextPreparation(workerId: string) { const row = await maybe<Record<string, unknown>>(this.client.rpc("claim_external_batch_preparation", { target_worker_id: workerId }).maybeSingle(), "Claim external batch preparation"); return row ? itemFromRow(row) : null; }
  async saveBatchItem(item: ExternalAuthoringBatchItem) { await data(this.client.from("external_authoring_batch_items").upsert(itemToRow(item)).select("id").single(), "Save external batch item"); }
  async requestBatchCancellation(batchId: string, at: string) {
    await data(this.client.rpc("cancel_external_authoring_batch", {
      target_batch_id: batchId,
      target_cancelled_at: at
    }), "Cancel external batch");
  }
  async saveBundle(bundle: AuthoringExecutionBundle) { const value = authoringExecutionBundleSchema.parse(bundle); await data(this.client.from("authoring_execution_bundles").upsert(bundleToRow(value)).select("id").single(), "Save authoring bundle"); }
  async getBundle(bundleId: string) { const row = await maybe<Record<string, unknown>>(this.client.from("authoring_execution_bundles").select("bundle").eq("id", bundleId).maybeSingle(), "Get authoring bundle"); return row ? authoringExecutionBundleSchema.parse(row.bundle) : null; }
  async saveExecution(execution: ExternalAuthoringExecution) { await data(this.client.from("external_authoring_executions").upsert(executionToRow(execution)).select("id").single(), "Save external execution"); }
  async requeueExecution(executionId: string, at: string) {
    await data(this.client.rpc("requeue_external_authoring_execution", {
      target_execution_id: executionId,
      target_requeued_at: at
    }), "Requeue external execution");
  }
  async expireExecutionDeadlines(at: string) {
    return await data<string[]>(this.client.rpc("expire_external_authoring_execution_deadlines", {
      target_expired_at: at
    }), "Expire external execution deadlines");
  }
  async getExecution(executionId: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_executions").select("*").eq("id", executionId).maybeSingle(), "Get external execution"); return row ? executionFromRow(row) : null; }
  async getExecutionForRun(runId: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_executions").select("*").eq("run_id", runId).maybeSingle(), "Get run external execution"); return row ? executionFromRow(row) : null; }
  async listExecutionsByStatuses(statuses: ExternalAuthoringExecution["status"][], limit = 100) {
    if (!statuses.length) return [];
    const rows = await data<Record<string, unknown>[]>(this.client.from("external_authoring_executions")
      .select("*")
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(Math.max(1, Math.min(limit, 1000))), "List external authoring executions by status");
    return rows.map(executionFromRow);
  }
  async claimNext(input: { claimId: string; bindingId: string; workerKeyHash: string; capabilityHash: string; leaseExpiresAt: string; deadlineAt: string }) {
    const row = await maybe<{ claimId: string; executionId: string; leaseGeneration: number; reattached: boolean }>(this.client.rpc("claim_next_external_authoring", {
      target_claim_id: input.claimId,
      target_binding_id: input.bindingId,
      target_worker_key_hash: input.workerKeyHash,
      target_capability_hash: input.capabilityHash,
      target_lease_expires_at: input.leaseExpiresAt,
      target_deadline_at: input.deadlineAt
    }).maybeSingle(), "Claim external authoring");
    if (!row) return null;
    const [claim, execution] = await Promise.all([this.getClaim(row.claimId), this.getExecution(row.executionId)]);
    if (!claim || !execution) throw new Error("Claimed external authoring state is unavailable.");
    return { claim, execution, reattached: row.reattached };
  }
  async getClaim(claimId: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_claims").select("*").eq("id", claimId).maybeSingle(), "Get external claim"); return row ? claimFromRow(row) : null; }
  async releaseClaim(claimId: string, at: string) { await data(this.client.from("external_authoring_claims").update({ status: "released", operation_deadline_at: null, last_activity_at: at, updated_at: at }).eq("id", claimId).select("id").single(), "Release external claim"); }
  async fenceClaim(claimId: string, at: string) { await data(this.client.from("external_authoring_claims").update({ status: "fenced", operation_deadline_at: null, last_activity_at: at, updated_at: at }).eq("id", claimId).select("id").single(), "Fence external claim"); }
  async reserveOperation(operation: ExternalAuthoringOperation, expectedStateRevision: number, capabilityHash: string) {
    const row = await maybe<Record<string, unknown>>(this.client.rpc("reserve_external_authoring_operation", {
      operation_document: operation,
      expected_state_revision: expectedStateRevision,
      provided_capability_hash: capabilityHash
    }).maybeSingle(), "Reserve external operation");
    return row ? operationFromRow(row) : null;
  }
  async getOperationByKey(operationKey: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_operations").select("*").eq("operation_key", operationKey).maybeSingle(), "Get external operation"); return row ? operationFromRow(row) : null; }
  async getOperation(operationId: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_operations").select("*").eq("id", operationId).maybeSingle(), "Get external operation"); return row ? operationFromRow(row) : null; }
  async markOperationRunning(operationId: string, capabilityHash: string) {
    const claim = await maybe<{ id: string }>(this.client.from("external_authoring_operations").select("id,external_authoring_claims!inner(capability_hash,status)").eq("id", operationId).eq("status", "reserved").eq("external_authoring_claims.capability_hash", capabilityHash).eq("external_authoring_claims.status", "active").maybeSingle(), "Authorize external operation start");
    if (!claim) return false;
    const row = await maybe<{ id: string }>(this.client.from("external_authoring_operations").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", operationId).eq("status", "reserved").select("id").maybeSingle(), "Start external operation");
    return Boolean(row);
  }
  async completeOperation(input: { operationId: string; capabilityHash: string; result: Record<string, unknown>; workspaceHash?: string; checkpointKey?: string; checkpointHash?: string }) {
    return operationFromRow(await data<Record<string, unknown>>(this.client.rpc("complete_external_authoring_operation", {
      target_operation_id: input.operationId,
      provided_capability_hash: input.capabilityHash,
      target_result: input.result,
      target_workspace_hash: input.workspaceHash,
      target_checkpoint_key: input.checkpointKey,
      target_checkpoint_hash: input.checkpointHash
    }).single(), "Complete external operation"));
  }
  async failOperation(operationId: string, capabilityHash: string, errorCode: string, result?: Record<string, unknown>) {
    const row = await maybe<Record<string, unknown>>(this.client.rpc("fail_external_authoring_operation", {
      target_operation_id: operationId,
      provided_capability_hash: capabilityHash,
      target_error_code: errorCode,
      target_result: result ?? null
    }).maybeSingle(), "Fail external operation");
    return row ? operationFromRow(row) : null;
  }
  async saveCredential(credential: ExternalAuthoringCredential) { const value = externalAuthoringCredentialSchema.parse(credential); await data(this.client.from("external_authoring_credentials").upsert({ id: value.id, schema_version: value.schemaVersion, token_hash: value.tokenHash, label: value.label, status: value.status, created_at: value.createdAt, revoked_at: value.revokedAt, last_used_at: value.lastUsedAt }).select("id").single(), "Save external credential"); }
  async listCredentials() { return (await data<Record<string, unknown>[]>(this.client.from("external_authoring_credentials").select("*").order("created_at", { ascending: false }), "List external credentials")).map(credentialFromRow); }
  async findActiveCredential(tokenHash: string) { const row = await maybe<Record<string, unknown>>(this.client.from("external_authoring_credentials").select("*").eq("token_hash", tokenHash).eq("status", "active").maybeSingle(), "Find external credential"); return row ? credentialFromRow(row) : null; }
  async revokeCredential(credentialId: string, at: string) { await data(this.client.from("external_authoring_credentials").update({ status: "revoked", revoked_at: at }).eq("id", credentialId).select("id").single(), "Revoke external credential"); }
  async recordCredentialRequest(input: { credentialId: string; toolName?: string; accepted: boolean; occurredAt: string }) {
    await data(this.client.from("external_authoring_credential_requests").insert({ credential_id: input.credentialId, tool_name: input.toolName, accepted: input.accepted, occurred_at: input.occurredAt }).select("id").single(), "Record external credential request");
    const cutoff = new Date(Date.parse(input.occurredAt) - 60_000).toISOString();
    const result = await data<Array<{ id: number }>>(this.client.from("external_authoring_credential_requests").select("id").eq("credential_id", input.credentialId).gte("occurred_at", cutoff), "Count external credential requests");
    return result.length;
  }
  async saveStagedBlobReceipt(receipt: StagedBlobReceipt) { const value = stagedBlobReceiptSchema.parse(receipt); await data(this.client.from("staged_blob_receipts").upsert({ id: value.id, schema_version: value.schemaVersion, storage_key: value.storageKey, content_hash: value.contentHash, bytes: value.bytes, etag: value.etag, finalization_key: value.finalizationKey, staged_at: value.stagedAt, consumed_at: value.consumedAt }).select("id").single(), "Save staged blob receipt"); }
  async enqueueOutbox(event: AuthoringOutboxEvent) { const value = authoringOutboxEventSchema.parse(event); await data(this.client.from("authoring_outbox").upsert({ id: value.id, schema_version: value.schemaVersion, event_type: value.eventType, aggregate_id: value.aggregateId, payload: value.payload, status: value.status, attempts: value.attempts, run_after: value.runAfter, locked_by: value.lockedBy, locked_at: value.lockedAt, last_error: value.lastError, created_at: value.createdAt, completed_at: value.completedAt }, { onConflict: "event_type,aggregate_id", ignoreDuplicates: true }).select("id"), "Enqueue authoring outbox"); }
  async claimOutbox(workerId: string) { const row = await maybe<Record<string, unknown>>(this.client.rpc("claim_authoring_outbox", { target_worker_id: workerId }).maybeSingle(), "Claim authoring outbox"); return row ? outboxFromRow(row) : null; }
  async completeOutbox(eventId: string, at: string) { await data(this.client.from("authoring_outbox").update({ status: "completed", completed_at: at, locked_by: null, locked_at: null }).eq("id", eventId).select("id").single(), "Complete authoring outbox"); }
  async failOutbox(eventId: string, error: string, retryAt: string) { const row = await data<{ attempts: number }>(this.client.from("authoring_outbox").select("attempts").eq("id", eventId).single(), "Read authoring outbox"); await data(this.client.from("authoring_outbox").update({ status: row.attempts >= 5 ? "failed" : "pending", last_error: error.slice(0, 2000), run_after: retryAt, locked_by: null, locked_at: null }).eq("id", eventId).select("id").single(), "Fail authoring outbox"); }
}

export const externalAuthoringRepository: ExternalAuthoringRepository = process.env.LODESTA_REPOSITORY === "local"
  ? new LocalExternalAuthoringRepository(process.env.LODESTA_EXTERNAL_AUTHORING_LOCAL_STATE_PATH?.trim() || undefined)
  : new SupabaseExternalAuthoringRepository();

function batchFromRow(row: Record<string, unknown>) { return externalAuthoringBatchSchema.parse({ schemaVersion: row.schema_version, id: row.id, name: row.name, requestedBy: row.requested_by, campaignId: row.campaign_id, cancelRequestedAt: row.cancel_requested_at ?? undefined, createdAt: row.created_at }); }
function itemFromRow(row: Record<string, unknown>) { return externalAuthoringBatchItemSchema.parse({ schemaVersion: row.schema_version, id: row.id, batchId: row.batch_id, ordinal: row.ordinal, sourceUrl: row.source_url, normalizedSource: row.normalized_source, businessNameHint: row.business_name_hint ?? undefined, preparationKey: row.preparation_key, preparationStatus: row.preparation_status, preparationAttempts: row.preparation_attempts, preparationLockedBy: row.preparation_locked_by ?? undefined, preparationLockedAt: row.preparation_locked_at ?? undefined, preparationFailureCode: row.preparation_failure_code ?? undefined, preparationFailureReason: row.preparation_failure_reason ?? undefined, siteId: row.site_id ?? undefined, prospectId: row.prospect_id ?? undefined, sessionId: row.session_id ?? undefined, runId: row.run_id ?? undefined, candidateVersionId: row.candidate_version_id ?? undefined, previewId: row.preview_id ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }); }
function itemToRow(item: ExternalAuthoringBatchItem) { const value = externalAuthoringBatchItemSchema.parse(item); return { id: value.id, batch_id: value.batchId, schema_version: value.schemaVersion, ordinal: value.ordinal, source_url: value.sourceUrl, normalized_source: value.normalizedSource, business_name_hint: value.businessNameHint, preparation_key: value.preparationKey, preparation_status: value.preparationStatus, preparation_attempts: value.preparationAttempts, preparation_locked_by: value.preparationLockedBy, preparation_locked_at: value.preparationLockedAt, preparation_failure_code: value.preparationFailureCode, preparation_failure_reason: value.preparationFailureReason, site_id: value.siteId, prospect_id: value.prospectId, session_id: value.sessionId, run_id: value.runId, candidate_version_id: value.candidateVersionId, preview_id: value.previewId, created_at: value.createdAt, updated_at: value.updatedAt }; }
function bundleToRow(value: AuthoringExecutionBundle) { return { id: value.id, run_id: value.runId, schema_version: value.schemaVersion, bundle_hash: value.bundleHash, instruction_version: value.instructionVersion, instruction_hash: value.instructionHash, skill_contract_version: value.skillContractVersion, skill_contract_hash: value.skillContractHash, public_build_input_id: value.publicBuildInputId, public_build_input_hash: value.publicBuildInputHash, source_policy_version: value.sourcePolicyVersion, source_policy_hash: value.sourcePolicyHash, verification_policy_version: value.verificationPolicyVersion, verification_policy_hash: value.verificationPolicyHash, tool_schema_hash: value.toolSchemaHash, toolchain_version: value.toolchainVersion, sandbox_image_digest: value.sandboxImageDigest, bundle: value, created_at: value.createdAt }; }
function executionToRow(execution: ExternalAuthoringExecution) { const value = externalAuthoringExecutionSchema.parse(execution); return { id: value.id, run_id: value.runId, batch_item_id: value.batchItemId, bundle_id: value.bundleId, schema_version: value.schemaVersion, status: value.status, state_revision: value.stateRevision, workspace_hash: value.workspaceHash, checkpoint_key: value.checkpointKey, checkpoint_hash: value.checkpointHash, current_operation_id: value.currentOperationId, finalization_key: value.finalizationKey, claimed_at: value.claimedAt, last_activity_at: value.lastActivityAt, deadline_at: value.deadlineAt, completed_at: value.completedAt, created_at: value.createdAt, updated_at: value.updatedAt }; }
function executionFromRow(row: Record<string, unknown>) { return externalAuthoringExecutionSchema.parse({ schemaVersion: row.schema_version, id: row.id, runId: row.run_id, batchItemId: row.batch_item_id, bundleId: row.bundle_id ?? undefined, status: row.status, stateRevision: row.state_revision, workspaceHash: row.workspace_hash ?? undefined, checkpointKey: row.checkpoint_key ?? undefined, checkpointHash: row.checkpoint_hash ?? undefined, currentOperationId: row.current_operation_id ?? undefined, finalizationKey: row.finalization_key ?? undefined, claimedAt: row.claimed_at ?? undefined, lastActivityAt: row.last_activity_at ?? undefined, deadlineAt: row.deadline_at ?? undefined, completedAt: row.completed_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }); }
function claimFromRow(row: Record<string, unknown>) { return externalAuthoringClaimSchema.parse({ schemaVersion: row.schema_version, id: row.id, executionId: row.execution_id, bindingId: row.binding_id, workerKeyHash: row.worker_key_hash, capabilityHash: row.capability_hash, leaseGeneration: row.lease_generation, status: row.status, leaseExpiresAt: row.lease_expires_at, operationDeadlineAt: row.operation_deadline_at ?? undefined, lastActivityAt: row.last_activity_at, createdAt: row.created_at, updatedAt: row.updated_at }); }
function operationFromRow(row: Record<string, unknown>) { return externalAuthoringOperationSchema.parse({ schemaVersion: row.schema_version, id: row.id, executionId: row.execution_id, claimId: row.claim_id, leaseGeneration: row.lease_generation, operationKey: row.operation_key, idempotencyKeyHash: row.idempotency_key_hash, toolName: row.tool_name, argumentsHash: row.arguments_hash, preStateRevision: row.pre_state_revision, postStateRevision: row.post_state_revision ?? undefined, preWorkspaceHash: row.pre_workspace_hash ?? undefined, postWorkspaceHash: row.post_workspace_hash ?? undefined, status: row.status, result: row.result ?? undefined, errorCode: row.error_code ?? undefined, deadlineAt: row.deadline_at, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined }); }
function credentialFromRow(row: Record<string, unknown>) { return externalAuthoringCredentialSchema.parse({ schemaVersion: row.schema_version, id: row.id, tokenHash: row.token_hash, label: row.label, status: row.status, createdAt: row.created_at, revokedAt: row.revoked_at ?? undefined, lastUsedAt: row.last_used_at ?? undefined }); }
function outboxFromRow(row: Record<string, unknown>) { return authoringOutboxEventSchema.parse({ schemaVersion: row.schema_version, id: row.id, eventType: row.event_type, aggregateId: row.aggregate_id, payload: row.payload, status: row.status, attempts: row.attempts, runAfter: row.run_after, lockedBy: row.locked_by ?? undefined, lockedAt: row.locked_at ?? undefined, lastError: row.last_error ?? undefined, createdAt: row.created_at, completedAt: row.completed_at ?? undefined }); }
function byCreatedDesc<T extends { createdAt: string }>(a: T, b: T) { return b.createdAt.localeCompare(a.createdAt); }
function clone<T>(value: T): T { return structuredClone(value); }
async function data<T = unknown>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); if (result.data === null) throw new Error(`${operation}: no data returned`); return result.data; }
async function maybe<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, operation: string) { const result = await query; if (result.error) throw new Error(`${operation}: ${result.error.message}`); return result.data; }
