import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseFunctionToolCall, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { getAgentModelSettings } from "@/lib/operator-settings";
import { sha256, stableJson } from "@/packages/business-data";
import type { SiteElementSelectionV1, SitePublicBuildInputV1 } from "@/packages/site-contracts";
import {
  managerCandidateCritiqueSchema,
  managerCompletionV2Schema,
  managerDiscussionSchema,
  managerToolArguments,
  managerToolNameSchema,
  type ManagerCompletionV2,
  type ManagerModelUsageV1,
  type ManagerRunLimitsV2,
  type ManagerRunRequestV2,
  type ManagerToolExecutionV2,
  type ManagerToolRuntimeV2,
  type ManagerToolTraceV2,
  type WorkspaceSourceFile
} from "./contracts";
import { managerBuildContext, websiteManagerPromptVersion, websiteManagerSystemPrompt } from "./prompts";

export type { ManagerRunRequestV2 } from "./contracts";

type ManagerResponseV2 = Pick<Response, "output" | "output_text" | "usage" | "status" | "error" | "incomplete_details">;

export interface ManagerResponsesClientV2 {
  create(params: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<ManagerResponseV2>;
}

const defaultLimits: ManagerRunLimitsV2 = {
  maxResponses: 20,
  maxToolCalls: 20,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 200_000,
  maxDurationMs: 20 * 60_000
};

export class WebsiteManagerAgent {
  constructor(private readonly injectedClient?: ManagerResponsesClientV2) {}

  async run(input: ManagerRunRequestV2 & {
    runtime: ManagerToolRuntimeV2;
    onProgress?: (progress: { trace: ManagerToolTraceV2; usage: ManagerModelUsageV1; modelId: string }) => Promise<void>;
  }): Promise<{
    completion: ManagerCompletionV2;
    modelId: string;
    promptVersion: string;
    usage: ManagerModelUsageV1;
    traces: ManagerToolTraceV2[];
    responses: number;
  }> {
    const settings = await getAgentModelSettings();
    const modelId = process.env.LODESTA_SITE_AGENT_MODEL ?? settings.settings.siteAgentModel;
    const client = this.injectedClient ?? configuredResponsesClient();
    const limits = limitsFor(input, input.limits);
    const startedAt = Date.now();
    const usage = emptyUsage();
    const traces: ManagerToolTraceV2[] = [];
    const replayedCalls = new Map<string, { inputHash: `sha256:${string}`; result: ManagerToolExecutionV2; status: "succeeded" | "failed" }>();
    const context = managerBuildContext({
      buildInput: input.buildInput,
      verticalContext: input.buildInput.verticalModule,
      instruction: input.instruction,
      kind: input.kind,
      selection: input.selection,
      objectiveFindings: input.objectiveFindings
    });
    const history: ResponseInputItem[] = [{
      role: "user",
      type: "message",
      content: [{ type: "input_text", text: JSON.stringify(context) }]
    }];
    let responseCount = 0;
    let toolCount = 0;

    while (responseCount < limits.maxResponses) {
      assertWithinLimits({ limits, usage, startedAt, responseCount, toolCount });
      const response = await createWithOneTransportRetry(client, {
        model: modelId,
        instructions: websiteManagerSystemPrompt,
        input: history,
        tools: managerTools,
        tool_choice: "required",
        parallel_tool_calls: false,
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: "high" },
        text: { verbosity: "low" },
        max_output_tokens: Math.min(64_000, Math.max(1, limits.maxOutputTokens - usage.outputTokens))
      }, boundedSignal(input.signal, limits.maxDurationMs - (Date.now() - startedAt)));
      responseCount += 1;
      mergeUsage(usage, response.usage, startedAt);
      assertWithinLimits({ limits, usage, startedAt, responseCount, toolCount });
      history.push(...response.output as ResponseInputItem[]);
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      if (calls.length !== 1) throw new Error(`manager_tool_protocol_expected_one_call_received_${calls.length}`);
      toolCount += 1;
      const rawCall = calls[0];
      const name = managerToolNameSchema.parse(rawCall.name);
      const rawArguments = JSON.parse(rawCall.arguments) as Record<string, unknown>;
      const parsedArguments = managerToolArguments[name].parse(rawArguments) as Record<string, unknown>;
      const inputHash = sha256(stableJson({ name, arguments: parsedArguments }));
      const started = new Date().toISOString();
      let execution: ManagerToolExecutionV2;
      let status: "succeeded" | "failed" = "succeeded";
      const replay = replayedCalls.get(rawCall.call_id);
      if (replay) {
        if (replay.inputHash !== inputHash) throw new Error(`manager_call_id_reused_with_different_input:${rawCall.call_id}`);
        execution = replay.result;
        status = replay.status;
      } else {
        try {
          execution = await input.runtime.execute({ callId: rawCall.call_id, name, arguments: parsedArguments });
          if (execution.traceOutput.ok === false) status = "failed";
        } catch (error) {
          status = "failed";
          execution = {
            modelOutput: JSON.stringify({ ok: false, error: boundedError(error) }),
            traceOutput: { ok: false, error: boundedError(error) }
          };
        }
        replayedCalls.set(rawCall.call_id, { inputHash, result: execution, status });
      }
      const outputHash = sha256(stableJson(execution.traceOutput));
      const trace: ManagerToolTraceV2 = {
        callId: rawCall.call_id,
        name,
        inputHash,
        outputHash,
        status,
        startedAt: started,
        completedAt: new Date().toISOString(),
        output: execution.traceOutput
      };
      traces.push(trace);
      await input.onProgress?.({ trace, usage: { ...usage, durationMs: Date.now() - startedAt }, modelId });
      history.push({
        type: "function_call_output",
        call_id: rawCall.call_id,
        output: execution.modelOutput as never
      });
      if (execution.completion) {
        return {
          completion: managerCompletionV2Schema.parse(execution.completion),
          modelId,
          promptVersion: websiteManagerPromptVersion,
          usage: { ...usage, durationMs: Date.now() - startedAt },
          traces,
          responses: responseCount
        };
      }
    }
    throw new Error("manager_response_limit_exhausted");
  }

  async discuss(input: {
    buildInput: SitePublicBuildInputV1;
    message: string;
    currentFiles?: WorkspaceSourceFile[];
    selection?: SiteElementSelectionV1;
    signal?: AbortSignal;
  }) {
    const settings = await getAgentModelSettings();
    const modelId = process.env.LODESTA_SITE_AGENT_MODEL ?? settings.settings.siteAgentModel;
    const result = await structuredResponse({
      client: this.injectedClient ?? configuredResponsesClient(),
      modelId,
      name: "manager_discussion_v1",
      schema: managerDiscussionJsonSchema,
      system: websiteManagerSystemPrompt,
      content: [{ type: "input_text", text: JSON.stringify({
        role: "Discuss the requested change without modifying source. Be concise, state what would change, and identify unsupported capability requests.",
        message: input.message,
        selection: input.selection,
        publicBuildInput: input.buildInput,
        verticalContext: input.buildInput.verticalModule,
        currentWorkspace: input.currentFiles?.length ? { files: input.currentFiles } : undefined
      }) }],
      signal: input.signal,
      maxOutputTokens: 2500
    });
    return { discussion: managerDiscussionSchema.parse(result.value), modelId, usage: result.usage };
  }

  async critiqueCandidate(input: {
    buildInput: SitePublicBuildInputV1;
    visualThesis: string;
    contentArchitecture: string;
    taskInstruction: string;
    taskKind: ManagerRunRequestV2["kind"];
    routes: Array<{ path: string; title: string; description: string }>;
    contactSheet: Buffer;
    homepageDesktop?: Buffer;
    homepageMobile?: Buffer;
    signal?: AbortSignal;
  }) {
    const settings = await getAgentModelSettings();
    const modelId = process.env.LODESTA_SITE_CRITIC_MODEL ?? settings.settings.siteCriticModel;
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: JSON.stringify({
      role: "Act only as a read-only visual design and task-completion critic. Objective rendering, factual support, links, accessibility, and security are validated elsewhere. Judge whether the requested task is visibly complete, plus business-specific identity, hierarchy, composition, coherence across routes, responsive craft, and conversion clarity. Return revise only for an incomplete requested task or concrete issues that would prevent sending the draft to this business without redesign.",
      business: { name: input.buildInput.business.name, intent: input.buildInput.intent },
      visualThesis: input.visualThesis,
      contentArchitecture: input.contentArchitecture,
      task: { kind: input.taskKind, instruction: input.taskInstruction },
      routes: input.routes
    }) }, { type: "input_image", image_url: dataUrl(input.contactSheet), detail: "high" }];
    if (input.homepageDesktop) content.push({ type: "input_image", image_url: dataUrl(input.homepageDesktop), detail: "high" });
    if (input.homepageMobile) content.push({ type: "input_image", image_url: dataUrl(input.homepageMobile), detail: "high" });
    const result = await structuredResponse({
      client: this.injectedClient ?? configuredResponsesClient(), modelId, name: "manager_candidate_critique_v1",
      schema: managerCandidateCritiqueJsonSchema, system: websiteManagerSystemPrompt, content,
      signal: input.signal, maxOutputTokens: 3000
    });
    return { critique: managerCandidateCritiqueSchema.parse(result.value), modelId, promptVersion: "manager-visual-critic-v1", usage: result.usage };
  }
}

async function structuredResponse(input: {
  client: ManagerResponsesClientV2;
  modelId: string;
  name: string;
  schema: Record<string, unknown>;
  system: string;
  content: Array<Record<string, unknown>>;
  maxOutputTokens: number;
  signal?: AbortSignal;
}) {
  const startedAt = Date.now();
  const response = await createWithOneTransportRetry(input.client, {
    model: input.modelId,
    instructions: input.system,
    input: [{ role: "user", type: "message", content: input.content as never }],
    store: false,
    parallel_tool_calls: false,
    reasoning: { effort: "high" },
    text: { verbosity: "low", format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } },
    max_output_tokens: input.maxOutputTokens
  }, boundedSignal(input.signal, 10 * 60_000));
  if (!response.output_text) throw new Error("Website manager response did not contain structured output text.");
  return { value: JSON.parse(response.output_text) as unknown, usage: usageFor(response.usage, Date.now() - startedAt) };
}

function configuredResponsesClient(): ManagerResponsesClientV2 {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for website manager runs.");
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 10 * 60_000 });
  return { create: (params, options) => client.responses.create(params, options) };
}

async function createWithOneTransportRetry(
  client: ManagerResponsesClientV2,
  params: ResponseCreateParamsNonStreaming,
  signal: AbortSignal
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.create(params, { signal });
      if (response.status === "failed") throw new Error(response.error?.message ?? "manager_model_failed");
      if (response.status === "incomplete") throw new Error(`manager_model_incomplete:${response.incomplete_details?.reason ?? "unknown"}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt > 0 || signal.aborted || !transientTransportError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

function transientTransportError(error: unknown) {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number") return status === 408 || status === 409 || status === 429 || status >= 500;
  return error instanceof TypeError || /timeout|timed out|connection|socket|network/i.test(boundedError(error));
}

function limitsFor(input: ManagerRunRequestV2, override?: Partial<ManagerRunLimitsV2>): ManagerRunLimitsV2 {
  const base = { ...defaultLimits, maxDurationMs: input.kind === "initial_build" ? 20 * 60_000 : 10 * 60_000 };
  return { ...base, ...override };
}

function assertWithinLimits(input: { limits: ManagerRunLimitsV2; usage: ManagerModelUsageV1; startedAt: number; responseCount: number; toolCount: number }) {
  if (input.responseCount > input.limits.maxResponses) throw new Error("manager_response_limit_exhausted");
  if (input.toolCount > input.limits.maxToolCalls) throw new Error("manager_tool_limit_exhausted");
  if (input.usage.inputTokens > input.limits.maxInputTokens) throw new Error("manager_input_token_limit_exhausted");
  if (input.usage.outputTokens > input.limits.maxOutputTokens) throw new Error("manager_output_token_limit_exhausted");
  if (Date.now() - input.startedAt > input.limits.maxDurationMs) throw new Error("manager_duration_limit_exhausted");
}

function boundedSignal(signal: AbortSignal | undefined, durationMs: number) {
  const timeout = AbortSignal.timeout(Math.max(1, durationMs));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function emptyUsage(): ManagerModelUsageV1 {
  return { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 };
}

function mergeUsage(target: ManagerModelUsageV1, value: Response["usage"], startedAt: number) {
  const next = usageFor(value, Date.now() - startedAt);
  target.inputTokens += next.inputTokens;
  target.outputTokens += next.outputTokens;
  target.estimatedCostUsd += next.estimatedCostUsd;
  target.costEstimateStatus = target.costEstimateStatus === "configured" && next.costEstimateStatus === "configured" ? "configured" : next.costEstimateStatus;
  target.durationMs = Date.now() - startedAt;
}

function usageFor(value: Response["usage"], durationMs: number): ManagerModelUsageV1 {
  const inputTokens = value?.input_tokens ?? 0;
  const outputTokens = value?.output_tokens ?? 0;
  const inputPrice = Number(process.env.LODESTA_MODEL_INPUT_USD_PER_MILLION);
  const outputPrice = Number(process.env.LODESTA_MODEL_OUTPUT_USD_PER_MILLION);
  const configured = Number.isFinite(inputPrice) && inputPrice > 0 && Number.isFinite(outputPrice) && outputPrice > 0;
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: configured ? (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000 : 0,
    costEstimateStatus: configured ? "configured" : "unavailable",
    durationMs
  };
}

function dataUrl(bytes: Buffer) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 4000 ? `${message.slice(0, 3980)}... [truncated]` : message;
}

const hashSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };

const managerTools: Tool[] = [
  tool("read_workspace", "Read a bounded line window from one workspace source file.", {
    type: "object", additionalProperties: false, required: ["path", "startLine", "endLine"],
    properties: { path: { type: "string", enum: ["src/site.tsx", "src/styles.css"] }, startLine: { type: ["integer", "null"], minimum: 1 }, endLine: { type: ["integer", "null"], minimum: 1 } }
  }),
  tool("write_file", "Write one complete source file. Available only during initial construction before the first successful build.", {
    type: "object", additionalProperties: false, required: ["path", "content"],
    properties: { path: { type: "string", enum: ["src/site.tsx", "src/styles.css"] }, content: { type: "string", minLength: 1 } }
  }),
  tool("apply_patch", "Atomically apply up to 30 exact replacements across the two source files. Bundle related fixes into one call; any hash or anchor mismatch leaves every file unchanged.", {
    type: "object", additionalProperties: false, required: ["files"],
    properties: {
      files: {
        type: "array", minItems: 1, maxItems: 2,
        items: {
          type: "object", additionalProperties: false, required: ["path", "expectedContentHash", "replacements"],
          properties: {
            path: { type: "string", enum: ["src/site.tsx", "src/styles.css"] },
            expectedContentHash: hashSchema,
            replacements: {
              type: "array", minItems: 1, maxItems: 30,
              items: { type: "object", additionalProperties: false, required: ["oldText", "newText"], properties: { oldText: { type: "string", minLength: 1 }, newText: { type: "string" } } }
            }
          }
        }
      }
    }
  }),
  tool("build_preview", "Validate source policy and build the exact current workspace into the authenticated fast preview.", {
    type: "object", additionalProperties: false, required: ["expectedWorkspaceHash"], properties: { expectedWorkspaceHash: hashSchema }
  }),
  tool("inspect_candidate", "Run objective artifact and browser inspection for the unchanged successful build.", {
    type: "object", additionalProperties: false, required: ["expectedWorkspaceHash", "expectedSandboxRevision"],
    properties: { expectedWorkspaceHash: hashSchema, expectedSandboxRevision: { type: "string", minLength: 1 } }
  }),
  tool("finish", "Finish only when the exact unchanged workspace has a successful build and passing objective inspection.", {
    type: "object", additionalProperties: false,
    required: ["visualThesis", "contentArchitecture", "ownerMessage", "workspaceHash", "sandboxRevision", "publicBuildInputId", "toolchainVersion", "sandboxImageDigest", "inspectionHash"],
    properties: {
      visualThesis: { type: "string", minLength: 80 }, contentArchitecture: { type: "string", minLength: 80 }, ownerMessage: { type: "string", minLength: 1 },
      workspaceHash: hashSchema, sandboxRevision: { type: "string", minLength: 1 }, publicBuildInputId: { type: "string", minLength: 1 },
      toolchainVersion: { type: "string", minLength: 1 }, sandboxImageDigest: hashSchema, inspectionHash: hashSchema
    }
  })
];

function tool(name: string, description: string, parameters: Record<string, unknown>): Tool {
  return { type: "function", name, description, parameters, strict: true };
}

const managerDiscussionJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "response", "proposedAction", "requiresApply"],
  properties: { schemaVersion: { type: "string", const: "manager-discussion-v1" }, response: { type: "string" }, proposedAction: { type: ["string", "null"] }, requiresApply: { type: "boolean" } }
};

const managerCandidateCritiqueJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "verdict", "summary", "findings"],
  properties: {
    schemaVersion: { type: "string", const: "manager-candidate-critique-v1" }, verdict: { type: "string", enum: ["ship", "revise"] }, summary: { type: "string" },
    findings: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["route", "area", "severity", "message"], properties: {
      route: { type: "string" }, area: { type: "string", enum: ["identity", "hierarchy", "composition", "coherence", "mobile", "conversion", "craft", "task_completion"] },
      severity: { type: "string", enum: ["high", "normal", "low"] }, message: { type: "string" }
    } } }
  }
};
