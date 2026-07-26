import { z } from "zod";

const identifier = z.string().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const isoTimestamp = z.string().datetime({ offset: true });

export const modelBakeoffStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "completed_with_errors",
  "paused_credit"
]);

export const modelBakeoffRunStatusSchema = z.enum([
  "queued",
  "building",
  "assessing",
  "completed",
  "failed"
]);

export const modelBakeoffSourceSchema = z.object({
  key: identifier,
  label: z.string().min(1).max(160),
  profile: z.string().min(1).max(240),
  url: z.string().url()
}).strict();

export const modelBakeoffCandidateSchema = z.object({
  key: identifier,
  label: z.string().min(1).max(160),
  apiProvider: z.enum(["openai", "openrouter"]),
  modelId: z.string().min(1).max(160)
}).strict();

export const modelBakeoffExperimentSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  name: z.string().min(1).max(180),
  purpose: z.string().min(1).max(1_000),
  requestedBy: identifier,
  status: modelBakeoffStatusSchema,
  sources: z.array(modelBakeoffSourceSchema).min(1).max(12),
  candidates: z.array(modelBakeoffCandidateSchema).min(1).max(12),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  startedAt: isoTimestamp.optional(),
  completedAt: isoTimestamp.optional()
}).strict();

export const modelBakeoffRunSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  experimentId: identifier,
  ordinal: z.number().int().nonnegative(),
  source: modelBakeoffSourceSchema,
  candidate: modelBakeoffCandidateSchema,
  status: modelBakeoffRunStatusSchema,
  siteId: identifier.optional(),
  sessionId: identifier.optional(),
  runId: identifier.optional(),
  candidateVersionId: identifier.optional(),
  assessmentId: identifier.optional(),
  failureCode: z.string().min(1).max(160).optional(),
  failureReason: z.string().min(1).max(2_000).optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  startedAt: isoTimestamp.optional(),
  completedAt: isoTimestamp.optional()
}).strict();

export type ModelBakeoffStatus = z.infer<typeof modelBakeoffStatusSchema>;
export type ModelBakeoffRunStatus = z.infer<typeof modelBakeoffRunStatusSchema>;
export type ModelBakeoffSource = z.infer<typeof modelBakeoffSourceSchema>;
export type ModelBakeoffCandidate = z.infer<typeof modelBakeoffCandidateSchema>;
export type ModelBakeoffExperiment = z.infer<typeof modelBakeoffExperimentSchema>;
export type ModelBakeoffRun = z.infer<typeof modelBakeoffRunSchema>;
