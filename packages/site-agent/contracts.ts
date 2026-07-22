import { z } from "zod";
import { type SiteElementSelectionV1, type SitePublicBuildInputV3 } from "@/packages/site-contracts";
import { validateWorkspaceSourcePolicy } from "./source-policy";
import type { ManagerTaskKind } from "./skills";

export const workspaceSourceFileSchema = z.object({
  path: z.string().regex(/^src\/[a-zA-Z0-9_.\/-]+\.(?:ts|tsx|css)$/).refine((value) => !value.split("/").some((part) => part === ".." || part === "." || !part), "Unsafe source path."),
  content: z.string().max(1_000_000)
}).strict();
export type WorkspaceSourceFile = z.infer<typeof workspaceSourceFileSchema>;

export function assertCompleteWorkspace(files: WorkspaceSourceFile[]) {
  const parsed = files.map((file) => workspaceSourceFileSchema.parse(file));
  const paths = new Set(parsed.map((file) => file.path));
  if (!paths.has("src/site.tsx") || !paths.has("src/styles.css")) {
    throw new Error("A complete workspace requires src/site.tsx and src/styles.css.");
  }
  if (paths.size !== parsed.length) throw new Error("Workspace source paths must be unique.");
  if (parsed.length > 80 || parsed.reduce((total, file) => total + Buffer.byteLength(file.content), 0) > 4_000_000) throw new Error("Workspace source exceeds the file or byte limit.");
  const findings = validateWorkspaceSourcePolicy(parsed);
  if (findings.length) throw new Error(findings.map((finding) => `${finding.path}: ${finding.message}`).join("\n"));
  return parsed;
}

export type ManagerRunRequest = {
  buildInput: SitePublicBuildInputV3;
  instruction: string;
  kind: ManagerTaskKind;
  selection?: SiteElementSelectionV1;
  limits?: Partial<ManagerRunLimits>;
  signal?: AbortSignal;
};

export type ManagerRunLimits = {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxDurationMs: number;
};

export const managerCompletionSchema = z.object({
  schemaVersion: z.literal("manager-completion"),
  ownerMessage: z.string().min(1).max(1200),
  workspaceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sandboxRevision: z.string().min(1).max(255),
  publicBuildInputId: z.string().min(1).max(160),
  toolchainVersion: z.string().min(1).max(120),
  sandboxImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  inspectionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
export type ManagerCompletion = z.infer<typeof managerCompletionSchema>;

export const managerToolNameSchema = z.enum([
  "list_files",
  "read_file",
  "write_file",
  "delete_file",
  "apply_patch",
  "build_preview",
  "inspect_site",
  "request_input",
  "finish"
]);
export type ManagerToolName = z.infer<typeof managerToolNameSchema>;

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const patchFileSchema = z.object({ path: workspaceSourceFileSchema.shape.path, content: workspaceSourceFileSchema.shape.content.nullable() }).strict();
export const managerToolArguments = {
  list_files: z.object({}).strict(),
  read_file: z.object({
    path: workspaceSourceFileSchema.shape.path,
    startLine: z.number().int().positive().nullish().transform((value) => value ?? undefined),
    endLine: z.number().int().positive().nullish().transform((value) => value ?? undefined)
  }).strict(),
  write_file: z.object({ path: workspaceSourceFileSchema.shape.path, content: workspaceSourceFileSchema.shape.content }).strict(),
  delete_file: z.object({ path: workspaceSourceFileSchema.shape.path }).strict(),
  apply_patch: z.object({ files: z.array(patchFileSchema).min(1).max(80) }).strict(),
  build_preview: z.object({}).strict(),
  inspect_site: z.object({}).strict(),
  request_input: z.object({ question: z.string().min(1).max(600) }).strict(),
  finish: managerCompletionSchema.pick({ ownerMessage: true })
} satisfies Record<ManagerToolName, z.ZodTypeAny>;

export type ManagerToolCall = {
  callId: string;
  name: ManagerToolName;
  arguments: Record<string, unknown>;
};

export type ManagerToolExecution = {
  modelOutput: string | Array<Record<string, unknown>>;
  diagnosticOutput: Record<string, unknown>;
  completion?: ManagerCompletion;
  needsInput?: { question: string };
};

export interface ManagerToolRuntime {
  execute(call: ManagerToolCall): Promise<ManagerToolExecution>;
  stateSummary(): Record<string, unknown>;
}

export type ManagerToolRecord = {
  callId: string;
  name: ManagerToolName;
  inputHash: `sha256:${string}`;
  outputHash: `sha256:${string}`;
  status: "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  output: Record<string, unknown>;
};

export type ManagerRunEvent = {
  id: string;
  kind: "turn" | "model_request" | "tool_call" | "build" | "inspection";
  name: string;
  status: "running" | "succeeded" | "failed";
  turnIndex: number;
  modelId?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  errorCode?: string;
  startedAt: string;
  completedAt?: string;
};

export const managerDiscussionSchema = z.object({
  schemaVersion: z.literal("manager-discussion"),
  response: z.string().min(1).max(3000),
  proposedAction: z.string().max(1200).nullish().transform((value) => value ?? undefined),
  requiresApply: z.boolean()
}).strict();
export type ManagerDiscussion = z.infer<typeof managerDiscussionSchema>;

export type ManagerModelUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  costEstimateStatus: "configured" | "unavailable";
  durationMs: number;
};
