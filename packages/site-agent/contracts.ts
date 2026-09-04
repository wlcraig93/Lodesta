import { z } from "zod";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import {
  candidateRedirectSchema,
  leadFormConfigurationSchema,
  leadFormFieldSchema,
  retiredSourcePathSchema,
  type SiteAgentApiProvider,
  type SiteElementSelection,
  type SitePublicBuildInput
} from "@/packages/site-contracts";
import { validateWorkspaceSourcePolicy } from "./source-policy";
import type { ManagerTaskKind } from "./skills";
import type { ManagerAuthoringProfile } from "./authoring-profile";
import type { SiteAuthoringContext } from "./context";
import { imageCreationActions, imageCreationPurposes, imageCreationSizes } from "./image-creation";

export const workspaceSourceFileSchema = z.object({
  path: z.string().regex(/^src\/[a-zA-Z0-9_.\/-]+\.(?:ts|tsx|css)$/).refine((value) => !value.split("/").some((part) => part === ".." || part === "." || !part), "Unsafe source path."),
  content: z.string().max(1_000_000)
}).strict();
export type WorkspaceSourceFile = z.infer<typeof workspaceSourceFileSchema>;

export const workspaceReferenceFileSchema = z.object({
  path: z.string().regex(/^source-site\/[a-zA-Z0-9_.\/-]+\.(?:md|jsonl)$/).refine((value) => !value.split("/").some((part) => part === ".." || part === "." || !part), "Unsafe reference path."),
  content: z.string().max(1_000_000)
}).strict();
export type WorkspaceReferenceFile = z.infer<typeof workspaceReferenceFileSchema>;

export type SourceWorkspaceSummary = {
  root: "source-site/";
  readOnly: true;
  sourceCount: number;
  manifestPaths: string[];
  pageCount: number;
  contentPageCount: number;
  fileCount: number;
  bytes: number;
};

export const workspaceReadablePathSchema = z.union([
  workspaceSourceFileSchema.shape.path,
  workspaceReferenceFileSchema.shape.path
]);

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
  buildInput: SitePublicBuildInput;
  authoringContext: SiteAuthoringContext;
  runId?: string;
  instruction: string;
  kind: ManagerTaskKind;
  sourceWorkspace?: SourceWorkspaceSummary;
  route?: { apiProvider: SiteAgentApiProvider; modelId: string };
  selection?: SiteElementSelection;
  guardrails?: Partial<ManagerRunGuardrails>;
  signal?: AbortSignal;
  continuation?: {
    apiProvider: SiteAgentApiProvider;
    modelId: string;
    inputHash: `sha256:${string}`;
    skillIdentity: string;
    stablePrefixHash: `sha256:${string}`;
    responseCount: number;
    items: ResponseInputItem[];
  };
  /** Canonical profile override used by the workflow; direct callers receive the same default. */
  authoringProfile?: ManagerAuthoringProfile;
};

export type ManagerContinuationIncrement = {
  kind: "model_output" | "tool_result" | "continuation_prompt";
  responseCount: number;
  stablePrefixHash: `sha256:${string}`;
  items: ResponseInputItem[];
  workspaceHash?: `sha256:${string}`;
};

export type ManagerRunGuardrails = {
  maxCostUsd: number;
  maxConsecutiveIdenticalFailures: number;
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
  focusRoute: z.string().startsWith("/").max(300),
  changedRoutes: z.array(z.string().startsWith("/").max(300)).min(1),
  redirects: z.array(candidateRedirectSchema),
  retiredSourcePaths: z.array(retiredSourcePathSchema),
}).strict();
export type ManagerCompletion = z.infer<typeof managerCompletionSchema>;

export const managerToolNameSchema = z.enum([
  "list_files",
  "search_files",
  "read_files",
  "search_sources",
  "read_source_page",
  "list_source_pages",
  "list_source_resources",
  "adopt_source_asset",
  "search_public_web",
  "retry_source",
  "inspect_assets",
  "retrieve_public_source",
  "write_file",
  "delete_file",
  "apply_patch",
  "edit_file",
  "configure_lead_form",
  "create_image",
  "build_preview",
  "inspect_site",
  "request_input",
  "finish"
]);
export type ManagerToolName = z.infer<typeof managerToolNameSchema>;

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const patchFileSchema = z.object({ path: workspaceSourceFileSchema.shape.path, content: workspaceSourceFileSchema.shape.content.nullable() }).strict();
const readFileSchema = z.object({
  path: workspaceReadablePathSchema,
  startLine: z.number().int().positive().nullish().transform((value) => value ?? undefined),
  endLine: z.number().int().positive().nullish().transform((value) => value ?? undefined)
}).strict();
const targetedEditSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().nonnegative(),
  content: z.string().max(250_000).nullable()
}).strict();
const imageCreationArgumentObject = z.object({
  action: z.enum(imageCreationActions),
  purpose: z.enum(imageCreationPurposes),
  prompt: z.string().min(1).max(8000),
  sourceAssetIds: z.array(z.string().min(1).max(160)).max(4),
  size: z.enum(imageCreationSizes),
  alt: z.string().min(1).max(500)
}).strict();
const leadFormToolFieldSchema = leadFormFieldSchema.extend({
  options: leadFormFieldSchema.shape.options.nullable().transform((value) => value ?? undefined),
  placeholder: leadFormFieldSchema.shape.placeholder.nullable().transform((value) => value ?? undefined),
  helpText: leadFormFieldSchema.shape.helpText.nullable().transform((value) => value ?? undefined)
}).strict();

export const managerToolArguments = {
  list_files: z.object({}).strict(),
  search_files: z.object({
    query: z.string().min(1).max(500),
    paths: z.array(workspaceReadablePathSchema).max(20),
    caseSensitive: z.boolean()
  }).strict(),
  read_files: z.object({ files: z.array(readFileSchema).min(1).max(20) }).strict(),
  search_sources: z.object({
    query: z.string().min(1).max(500),
    sourceIds: z.array(z.string().min(1).max(160)).max(20),
    filters: z.object({
      paths: z.array(z.string().startsWith("/")).nullish().transform((value) => value ?? undefined),
      statuses: z.array(z.number().int().min(100).max(599)).nullish().transform((value) => value ?? undefined),
      indexability: z.array(z.enum(["indexable", "noindex", "unknown"])).nullish().transform((value) => value ?? undefined),
      sitemapOnly: z.boolean().nullish().transform((value) => value ?? undefined)
    }).strict().nullish().transform((value) => value ?? undefined),
    maxResults: z.number().int().min(1).max(50)
  }).strict(),
  read_source_page: z.object({
    sourceId: z.string().min(1).max(160),
    pageId: z.string().min(1).max(160),
    view: z.enum(["text", "html"]),
    offset: z.number().int().nonnegative(),
    maxChars: z.number().int().min(1).max(20_000)
  }).strict(),
  list_source_pages: z.object({
    sourceId: z.string().min(1).max(160),
    filters: z.object({
      pathPrefix: z.string().startsWith("/").nullish().transform((value) => value ?? undefined),
      statuses: z.array(z.number().int().min(100).max(599)).nullish().transform((value) => value ?? undefined),
      outcomes: z.array(z.enum(["fetched", "excluded", "failed", "unfinished"])).nullish().transform((value) => value ?? undefined),
      indexability: z.array(z.enum(["indexable", "noindex", "unknown"])).nullish().transform((value) => value ?? undefined),
      sitemapOnly: z.boolean().nullish().transform((value) => value ?? undefined)
    }).strict().nullish().transform((value) => value ?? undefined),
    cursor: z.string().max(500).nullish().transform((value) => value ?? undefined),
    limit: z.number().int().min(1).max(200)
  }).strict(),
  list_source_resources: z.object({
    sourceId: z.string().min(1).max(160),
    role: z.enum(["stylesheet", "script", "image", "font", "data", "other"]).nullish().transform((value) => value ?? undefined),
    cursor: z.string().max(500).nullish().transform((value) => value ?? undefined),
    limit: z.number().int().min(1).max(60)
  }).strict(),
  adopt_source_asset: z.object({
    sourceId: z.string().min(1).max(160),
    resourceId: z.string().min(1).max(160),
    sourcePageId: z.string().min(1).max(160),
    kind: z.enum(["photo", "icon", "other"]),
    alt: z.string().max(500)
  }).strict(),
  search_public_web: z.object({
    query: z.string().min(1).max(500),
    domains: z.array(z.string().min(1).max(253)).max(20)
  }).strict(),
  retry_source: z.object({
    sourceId: z.string().min(1).max(160)
  }).strict(),
  inspect_assets: z.object({
    assetIds: z.array(z.string().min(1).max(160)).min(1).max(20)
  }).strict(),
  retrieve_public_source: z.object({
    url: z.string().url().max(2048)
  }).strict(),
  write_file: z.object({ path: workspaceSourceFileSchema.shape.path, content: workspaceSourceFileSchema.shape.content }).strict(),
  delete_file: z.object({ path: workspaceSourceFileSchema.shape.path }).strict(),
  apply_patch: z.object({ files: z.array(patchFileSchema).min(1).max(80) }).strict(),
  edit_file: z.object({
    path: workspaceSourceFileSchema.shape.path,
    expectedContentHash: hash,
    edits: z.array(targetedEditSchema).min(1).max(50)
  }).strict(),
  configure_lead_form: leadFormConfigurationSchema.extend({
    fields: z.array(leadFormToolFieldSchema).min(1).max(30),
    expectedRevision: z.number().int().positive().nullable()
  }).strict(),
  create_image: imageCreationArgumentObject.superRefine((value, context) => {
    if (value.action === "generate" && value.sourceAssetIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Generate does not accept source assets.", path: ["sourceAssetIds"] });
    }
    if (value.action === "edit" && value.sourceAssetIds.length < 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Edit requires at least one source asset.", path: ["sourceAssetIds"] });
    }
  }),
  build_preview: z.object({}).strict(),
  inspect_site: z.object({
    route: z.string().startsWith("/").max(300).nullable().optional().transform((value) => value ?? undefined)
  }).strict(),
  request_input: z.object({ question: z.string().min(1).max(600) }).strict(),
  finish: z.object({
    ownerMessage: z.string().trim().min(1).max(8_000).transform((value) => value.slice(0, 1_200))
  }).strict()
} satisfies Record<ManagerToolName, z.ZodTypeAny>;

export function managerToolArgumentShape(toolName: ManagerToolName): z.ZodRawShape {
  if (toolName === "create_image") return imageCreationArgumentObject.shape;
  return (managerToolArguments[toolName] as z.AnyZodObject).shape;
}

export type ManagerToolCall = {
  callId: string;
  name: ManagerToolName;
  arguments: Record<string, unknown>;
};

export type ManagerToolExecution = {
  modelOutput: string | Array<Record<string, unknown>>;
  diagnosticOutput: Record<string, unknown>;
  metering?: {
    apiProvider: SiteAgentApiProvider;
    modelId: string;
    servedModelId?: string;
    providerRequestId?: string;
    usage: ManagerModelUsage;
  };
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
  apiProvider?: SiteAgentApiProvider;
  modelId?: string;
  servedModelId?: string;
  upstreamProvider?: string;
  providerRequestId?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costSource?: ManagerCostSource;
  upstreamInferenceCostUsd?: number;
  modelDurationMs?: number;
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
  cacheWriteTokens?: number;
  reasoningTokens: number;
  outputTokens: number;
  costUsd: number;
  costSource: ManagerCostSource;
  upstreamInferenceCostUsd: number;
  durationMs: number;
};

export type ManagerCostSource = "provider_reported" | "catalog_estimate" | "mixed" | "unavailable";
