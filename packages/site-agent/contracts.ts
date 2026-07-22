import { z } from "zod";
import { sitePlanV1Schema, type SiteEditObjectiveV1, type SiteElementSelectionV1, type SitePlanV1, type SitePublicBuildInputV3 } from "@/packages/site-contracts";
import { validateWorkspaceSourcePolicy } from "./source-policy";
import type { ManagerTaskKind } from "./skills";

export const workspaceSourceFileSchema = z.object({
  path: z.enum(["src/site.tsx", "src/styles.css"]),
  content: z.string().min(1).max(240_000)
}).strict();
export type WorkspaceSourceFile = z.infer<typeof workspaceSourceFileSchema>;

export function assertCompleteWorkspace(files: WorkspaceSourceFile[]) {
  const parsed = files.map((file) => workspaceSourceFileSchema.parse(file));
  const paths = new Set(parsed.map((file) => file.path));
  if (parsed.length !== 2 || !paths.has("src/site.tsx") || !paths.has("src/styles.css")) {
    throw new Error("A complete workspace requires exactly src/site.tsx and src/styles.css.");
  }
  const findings = validateWorkspaceSourcePolicy(parsed);
  if (findings.length) throw new Error(findings.map((finding) => `${finding.path}: ${finding.message}`).join("\n"));
  return parsed;
}

export type ManagerRunRequestV3 = {
  buildInput: SitePublicBuildInputV3;
  instruction: string;
  kind: ManagerTaskKind;
  selection?: SiteElementSelectionV1;
  objective?: SiteEditObjectiveV1;
  objectiveFindings?: string[];
  limits?: Partial<ManagerRunLimitsV3>;
  signal?: AbortSignal;
};

export type ManagerRunLimitsV3 = {
  maxResponses: number;
  maxToolCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxDurationMs: number;
};

export const managerCompletionV3Schema = z.object({
  schemaVersion: z.literal("manager-completion-v3"),
  visualThesis: z.string().min(80).max(3000),
  contentArchitecture: z.string().min(80).max(5000),
  ownerMessage: z.string().min(1).max(1200),
  workspaceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sandboxRevision: z.string().min(1).max(255),
  publicBuildInputId: z.string().min(1).max(160),
  toolchainVersion: z.string().min(1).max(120),
  sandboxImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  inspectionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  planHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();
export type ManagerCompletionV3 = z.infer<typeof managerCompletionV3Schema>;

export const managerToolNameSchema = z.enum([
  "set_site_plan",
  "read_workspace",
  "search_workspace",
  "write_file",
  "apply_patch",
  "build_preview",
  "inspect_candidate",
  "finish"
]);
export type ManagerToolNameV3 = z.infer<typeof managerToolNameSchema>;

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const exactPatchFileSchema = z.object({
  path: workspaceSourceFileSchema.shape.path,
  expectedContentHash: hash,
  replacements: z.array(z.object({
    oldText: z.string().min(1).max(120_000),
    newText: z.string().max(120_000)
  }).strict()).min(1).max(30)
}).strict();
export const managerToolArguments = {
  set_site_plan: sitePlanV1Schema.innerType().omit({ schemaVersion: true }),
  read_workspace: z.object({
    path: workspaceSourceFileSchema.shape.path,
    startLine: z.number().int().positive().nullish().transform((value) => value ?? undefined),
    endLine: z.number().int().positive().nullish().transform((value) => value ?? undefined)
  }).strict(),
  search_workspace: z.object({
    query: z.string().min(1).max(500),
    path: workspaceSourceFileSchema.shape.path.nullish().transform((value) => value ?? undefined),
    maxResults: z.number().int().min(1).max(100).nullish().transform((value) => value ?? 40)
  }).strict(),
  write_file: z.object({ path: workspaceSourceFileSchema.shape.path, content: workspaceSourceFileSchema.shape.content }).strict(),
  apply_patch: z.object({ files: z.array(exactPatchFileSchema).min(1).max(2) }).strict(),
  build_preview: z.object({ expectedWorkspaceHash: hash }).strict(),
  inspect_candidate: z.object({ expectedWorkspaceHash: hash, expectedSandboxRevision: z.string().min(1).max(255) }).strict(),
  finish: managerCompletionV3Schema.omit({ schemaVersion: true })
} satisfies Record<ManagerToolNameV3, z.ZodTypeAny>;

export type ManagerToolCallV3 = {
  callId: string;
  name: ManagerToolNameV3;
  arguments: Record<string, unknown>;
};

export type ManagerToolExecutionV3 = {
  modelOutput: string | Array<Record<string, unknown>>;
  traceOutput: Record<string, unknown>;
  completion?: ManagerCompletionV3;
};

export interface ManagerToolRuntimeV3 {
  acceptPlan(plan: SitePlanV1): void;
  execute(call: ManagerToolCallV3): Promise<ManagerToolExecutionV3>;
  stateSummary(): Record<string, unknown>;
}

export type ManagerToolTraceV3 = {
  callId: string;
  name: ManagerToolNameV3;
  inputHash: `sha256:${string}`;
  outputHash: `sha256:${string}`;
  status: "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  output: Record<string, unknown>;
};

export type ManagerTraceEventV1 = {
  id: string;
  parentSpanId?: string;
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
  schemaVersion: z.literal("manager-discussion-v1"),
  response: z.string().min(1).max(3000),
  proposedAction: z.string().max(1200).nullish().transform((value) => value ?? undefined),
  requiresApply: z.boolean()
}).strict();
export type ManagerDiscussionV1 = z.infer<typeof managerDiscussionSchema>;

export const managerEditPreflightSchema = z.object({
  schemaVersion: z.literal("manager-edit-preflight-v1"),
  decision: z.enum(["ready", "clarification_required"]),
  taskKind: z.enum(["focused_edit", "page_edit", "seo_aeo_improvement"]).nullable(),
  operation: z.enum(["restyle", "add_page", "move_form", "mobile_fix", "content", "seo", "other"]).nullable(),
  requestedOutcome: z.string().min(1).max(1200),
  clarificationQuestion: z.string().min(1).max(600).nullable()
}).strict().superRefine((value, context) => {
  if (value.decision === "ready" && (!value.taskKind || !value.operation || value.clarificationQuestion)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Ready preflight requires a task kind and operation without a clarification question." });
  }
  if (value.decision === "clarification_required" && (!value.clarificationQuestion || value.taskKind || value.operation)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Ambiguous preflight requires only a clarification question." });
  }
});
export type ManagerEditPreflightV1 = z.infer<typeof managerEditPreflightSchema>;

export type ManagerModelUsageV1 = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  costEstimateStatus: "configured" | "unavailable";
  durationMs: number;
};

export const managerCandidateCritiqueSchema = z.object({
  schemaVersion: z.literal("manager-candidate-critique-v1"),
  verdict: z.enum(["ship", "revise"]),
  summary: z.string().min(1).max(1200),
  findings: z.array(z.object({
    route: z.string().startsWith("/"),
    area: z.enum(["identity", "hierarchy", "composition", "coherence", "mobile", "conversion", "craft", "task_completion"]),
    severity: z.enum(["high", "normal", "low"]),
    message: z.string().min(1).max(600)
  }).strict()).max(12)
}).strict().superRefine((value, context) => {
  if (value.verdict === "ship" && value.findings.some((finding) => finding.severity === "high")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A shippable candidate cannot retain a high-severity visual finding." });
  }
  if (value.verdict === "revise" && value.findings.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A revision verdict requires a concrete visual finding." });
  }
});
export type ManagerCandidateCritiqueV1 = z.infer<typeof managerCandidateCritiqueSchema>;
