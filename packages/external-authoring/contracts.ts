import { z } from "zod";
import { managerToolNameSchema } from "@/packages/site-agent/contracts";

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const isoTimestamp = z.string().datetime({ offset: true });

export const externalAuthoringBatchSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  name: z.string().min(1).max(160),
  requestedBy: identifier,
  campaignId: identifier,
  cancelRequestedAt: isoTimestamp.optional(),
  createdAt: isoTimestamp
}).strict();
export type ExternalAuthoringBatch = z.infer<typeof externalAuthoringBatchSchema>;

export const externalAuthoringBatchItemSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  batchId: identifier,
  ordinal: z.number().int().nonnegative(),
  sourceUrl: z.string().url(),
  normalizedSource: z.string().min(1).max(2048),
  businessNameHint: z.string().min(1).max(200).optional(),
  preparationKey: hash,
  preparationStatus: z.enum(["queued", "running", "completed", "failed"]),
  preparationAttempts: z.number().int().nonnegative(),
  preparationLockedBy: identifier.optional(),
  preparationLockedAt: isoTimestamp.optional(),
  preparationFailureCode: z.string().min(1).max(160).optional(),
  preparationFailureReason: z.string().min(1).max(2000).optional(),
  siteId: identifier.optional(),
  prospectId: identifier.optional(),
  sessionId: identifier.optional(),
  runId: identifier.optional(),
  candidateVersionId: identifier.optional(),
  previewId: identifier.optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp
}).strict();
export type ExternalAuthoringBatchItem = z.infer<typeof externalAuthoringBatchItemSchema>;

export const authoringExecutionBundleSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  runId: identifier,
  bundleHash: hash,
  instructionVersion: z.string().min(1).max(120),
  instructionHash: hash,
  skillContractVersion: z.string().min(1).max(120),
  skillContractHash: hash,
  publicBuildInputId: identifier,
  publicBuildInputHash: hash,
  sourcePolicyVersion: z.string().min(1).max(120),
  sourcePolicyHash: hash,
  verificationPolicyVersion: z.string().min(1).max(120),
  verificationPolicyHash: hash,
  toolSchemaHash: hash,
  toolchainVersion: z.string().min(1).max(120),
  sandboxImageDigest: hash,
  createdAt: isoTimestamp
}).strict();
export type AuthoringExecutionBundle = z.infer<typeof authoringExecutionBundleSchema>;

export const externalAuthoringExecutionSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  runId: identifier,
  batchItemId: identifier,
  bundleId: identifier.optional(),
  status: z.enum(["queued", "claimed", "needs_input", "authoring", "finalizing", "completed", "failed", "cancelled"]),
  stateRevision: z.number().int().nonnegative(),
  workspaceHash: hash.optional(),
  checkpointKey: z.string().min(1).max(1024).optional(),
  checkpointHash: hash.optional(),
  currentOperationId: identifier.optional(),
  finalizationKey: hash.optional(),
  claimedAt: isoTimestamp.optional(),
  lastActivityAt: isoTimestamp.optional(),
  deadlineAt: isoTimestamp.optional(),
  completedAt: isoTimestamp.optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp
}).strict();
export type ExternalAuthoringExecution = z.infer<typeof externalAuthoringExecutionSchema>;

export const externalAuthoringClaimSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  executionId: identifier,
  bindingId: identifier,
  workerKeyHash: hash,
  capabilityHash: hash,
  leaseGeneration: z.number().int().positive(),
  status: z.enum(["active", "released", "fenced"]),
  leaseExpiresAt: isoTimestamp,
  operationDeadlineAt: isoTimestamp.optional(),
  lastActivityAt: isoTimestamp,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp
}).strict();
export type ExternalAuthoringClaim = z.infer<typeof externalAuthoringClaimSchema>;

export const externalAuthoringOperationSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  executionId: identifier,
  claimId: identifier,
  leaseGeneration: z.number().int().positive(),
  operationKey: hash,
  idempotencyKeyHash: hash,
  toolName: managerToolNameSchema,
  argumentsHash: hash,
  preStateRevision: z.number().int().nonnegative(),
  postStateRevision: z.number().int().nonnegative().optional(),
  preWorkspaceHash: hash.optional(),
  postWorkspaceHash: hash.optional(),
  status: z.enum(["reserved", "running", "succeeded", "failed", "cancelled"]),
  result: z.record(z.string(), z.unknown()).optional(),
  errorCode: z.string().min(1).max(160).optional(),
  deadlineAt: isoTimestamp,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  completedAt: isoTimestamp.optional()
}).strict();
export type ExternalAuthoringOperation = z.infer<typeof externalAuthoringOperationSchema>;

export const externalAuthoringCredentialSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  tokenHash: hash,
  label: z.string().min(1).max(160),
  status: z.enum(["active", "revoked"]),
  createdAt: isoTimestamp,
  revokedAt: isoTimestamp.optional(),
  lastUsedAt: isoTimestamp.optional()
}).strict();
export type ExternalAuthoringCredential = z.infer<typeof externalAuthoringCredentialSchema>;

export const stagedBlobReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  storageKey: z.string().min(1).max(1024),
  contentHash: hash,
  bytes: z.number().int().nonnegative(),
  etag: z.string().min(1).max(512),
  finalizationKey: hash.optional(),
  stagedAt: isoTimestamp,
  consumedAt: isoTimestamp.optional()
}).strict();
export type StagedBlobReceipt = z.infer<typeof stagedBlobReceiptSchema>;

export const authoringOutboxEventSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  eventType: z.literal("site_candidate_finalized"),
  aggregateId: identifier,
  payload: z.object({
    siteId: identifier,
    artifactId: identifier,
    candidateVersionId: identifier
  }).strict(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  attempts: z.number().int().nonnegative(),
  runAfter: isoTimestamp,
  lockedBy: z.string().min(1).max(160).optional(),
  lockedAt: isoTimestamp.optional(),
  lastError: z.string().min(1).max(2000).optional(),
  createdAt: isoTimestamp,
  completedAt: isoTimestamp.optional()
}).strict();
export type AuthoringOutboxEvent = z.infer<typeof authoringOutboxEventSchema>;

export type DerivedBatchItemStatus =
  | "preparing"
  | "queued"
  | "claimed"
  | "needs_input"
  | "authoring"
  | "finalizing"
  | "candidate_ready"
  | "failed"
  | "cancelling"
  | "cancelled";

export type DerivedBatchStatus =
  | "preparing"
  | "ready"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "completed_with_errors";
