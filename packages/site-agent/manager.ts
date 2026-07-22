import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseFunctionToolCall, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { getSiteAuthoringModelSettings } from "@/lib/operator-settings";
import { sha256, stableJson } from "@/packages/business-data";
import type { SiteElementSelectionV1, SitePublicBuildInputV3 } from "@/packages/site-contracts";
import {
  managerCompletionSchema,
  managerDiscussionSchema,
  managerToolArguments,
  managerToolNameSchema,
  type ManagerCompletion,
  type ManagerModelUsage,
  type ManagerRunLimits,
  type ManagerRunRequest,
  type ManagerToolExecution,
  type ManagerToolRuntime,
  type ManagerToolRecord,
  type ManagerRunEvent,
  type WorkspaceSourceFile
} from "./contracts";
import { managerBuildContext, managerEvidencePacket, websiteManagerPromptVersion, websiteManagerSystemPrompt } from "./prompts";

export type { ManagerRunRequest } from "./contracts";

type ManagerResponse = Pick<Response, "output" | "output_text" | "usage" | "status" | "error" | "incomplete_details">;

export interface ManagerResponsesClient {
  create(params: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<ManagerResponse>;
}

const defaultLimits: ManagerRunLimits = {
  maxInputTokens: 2_000_000,
  maxOutputTokens: 200_000,
  maxDurationMs: 20 * 60_000
};

export class WebsiteManagerAgent {
  constructor(private readonly injectedClient?: ManagerResponsesClient) {}

  async run(input: ManagerRunRequest & {
    runtime: ManagerToolRuntime;
    onProgress?: (progress: { toolRecord: ManagerToolRecord; usage: ManagerModelUsage; responseUsage: ManagerModelUsage; responseIndex: number; modelId: string }) => Promise<void>;
    onEvents?: (events: ManagerRunEvent[]) => Promise<void>;
  }): Promise<{
    completion: ManagerCompletion;
    modelId: string;
    promptVersion: string;
    usage: ManagerModelUsage;
    toolRecords: ManagerToolRecord[];
    responses: number;
  }> {
    const settings = await getSiteAuthoringModelSettings();
    const modelId = process.env.LODESTA_SITE_AGENT_MODEL ?? settings.settings.siteAgentModel;
    const client = this.injectedClient ?? configuredResponsesClient();
    const limits = limitsFor(input, input.limits);
    const startedAt = Date.now();
    const usage = emptyUsage();
    const toolRecords: ManagerToolRecord[] = [];
    const replayedCalls = new Map<string, { inputHash: `sha256:${string}`; result: ManagerToolExecution; status: "succeeded" | "failed" }>();
    const initialContext: ResponseInputItem = {
      role: "user",
      type: "message",
      content: [{ type: "input_text", text: JSON.stringify(managerBuildContext({
        buildInput: input.buildInput,
        verticalContext: input.buildInput.domainContext,
        instruction: input.instruction,
        kind: input.kind,
        selection: input.selection
      })) }]
    };
    const history: ResponseInputItem[] = [initialContext];
    let responseCount = 0;

    while (true) {
      assertWithinLimits({ limits, usage, startedAt });
      const turnIndex = responseCount + 1;
      const turnId = eventId("turn");
      const modelIdValue = eventId("model");
      const turnStartedAt = new Date().toISOString();
      const requestHistory = [...history, runtimeStateMessage(input.runtime.stateSummary())];
      await input.onEvents?.([
        runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "running", turnIndex, startedAt: turnStartedAt, summary: { historyItems: requestHistory.length } }),
        runEvent({ id: modelIdValue, kind: "model_request", name: "responses.create", status: "running", turnIndex, modelId, startedAt: turnStartedAt, summary: { historyItems: requestHistory.length } })
      ]);
      const responseStartedAt = Date.now();
      let response: ManagerResponse;
      try {
        response = await createWithOneTransportRetry(client, {
          model: modelId,
          instructions: websiteManagerSystemPrompt,
          input: requestHistory,
          tools: managerTools,
          tool_choice: "required",
          parallel_tool_calls: false,
          store: false,
          include: ["reasoning.encrypted_content"],
          reasoning: { effort: "high" },
          text: { verbosity: "low" },
          max_output_tokens: Math.min(64_000, Math.max(1, limits.maxOutputTokens - usage.outputTokens))
        }, boundedSignal(input.signal, limits.maxDurationMs - (Date.now() - startedAt)));
      } catch (error) {
        const completedAt = new Date().toISOString();
        const errorCode = diagnosticErrorCode(error);
        await input.onEvents?.([
          runEvent({ id: modelIdValue, kind: "model_request", name: "responses.create", status: "failed", turnIndex, modelId, startedAt: turnStartedAt, completedAt, errorCode, summary: { error: errorCode }, payload: modelTurnPayload(requestHistory, undefined, websiteManagerPromptVersion) }),
          runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "failed", turnIndex, startedAt: turnStartedAt, completedAt, errorCode, summary: { error: errorCode } })
        ]);
        throw error;
      }
      responseCount += 1;
      const responseUsage = usageFor(response.usage, Date.now() - responseStartedAt);
      mergeUsage(usage, response.usage, startedAt);
      assertWithinLimits({ limits, usage, startedAt });
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      const modelCompletedAt = new Date().toISOString();
      await input.onEvents?.([runEvent({
        id: modelIdValue, kind: "model_request", name: "responses.create", status: "succeeded", turnIndex, modelId,
        startedAt: turnStartedAt, completedAt: modelCompletedAt, ...usageFields(responseUsage),
        summary: { outputItems: response.output.length, functionCalls: calls.length }, payload: modelTurnPayload(requestHistory, response, websiteManagerPromptVersion)
      })]);
      history.push(...response.output as ResponseInputItem[]);

      if (!calls.length) {
        history.push({ role: "user", type: "message", content: [{ type: "input_text", text: "Continue the website task using the available workspace tools." }] });
        await input.onEvents?.([runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "succeeded", turnIndex, startedAt: turnStartedAt, completedAt: new Date().toISOString(), summary: { functionCalls: 0 } })]);
        continue;
      }

      for (const rawCall of calls) {
        const started = new Date().toISOString();
        let name: ReturnType<typeof managerToolNameSchema.parse> | undefined;
        let parsedArguments: Record<string, unknown> = {};
        let execution: ManagerToolExecution;
        let status: "succeeded" | "failed" = "succeeded";
        try {
          name = managerToolNameSchema.parse(rawCall.name);
          parsedArguments = managerToolArguments[name].parse(JSON.parse(rawCall.arguments)) as Record<string, unknown>;
          const inputHash = sha256(stableJson({ name, arguments: parsedArguments }));
          const replay = replayedCalls.get(rawCall.call_id);
          if (replay && replay.inputHash !== inputHash) throw new Error(`manager_call_id_reused_with_different_input:${rawCall.call_id}`);
          if (replay) {
            execution = replay.result;
            status = replay.status;
          } else {
            try {
              execution = await input.runtime.execute({ callId: rawCall.call_id, name, arguments: parsedArguments });
              if (execution.diagnosticOutput.ok === false) status = "failed";
            } catch (error) {
              status = "failed";
              execution = toolError(error);
            }
            replayedCalls.set(rawCall.call_id, { inputHash, result: execution, status });
          }
        } catch (error) {
          status = "failed";
          execution = toolError(error);
        }
        const toolName = name ?? rawCall.name;
        const inputHash = sha256(stableJson({ name: toolName, arguments: parsedArguments }));
        const outputHash = sha256(stableJson(execution.diagnosticOutput));
        const toolRecord: ManagerToolRecord = {
          callId: rawCall.call_id,
          name: name ?? "list_files",
          inputHash,
          outputHash,
          status,
          startedAt: started,
          completedAt: new Date().toISOString(),
          output: execution.diagnosticOutput
        };
        toolRecords.push(toolRecord);
        const operationKind = toolName === "build_preview" ? "build" : toolName === "inspect_site" || toolName === "finish" ? "inspection" : "tool_call";
        await input.onEvents?.([runEvent({
          id: eventId("tool"), kind: operationKind, name: toolName, status, turnIndex,
          startedAt: started, completedAt: toolRecord.completedAt,
          errorCode: status === "failed" ? diagnosticErrorCode(execution.diagnosticOutput.error ?? "tool_failed") : undefined,
          summary: { callId: rawCall.call_id, inputHash, outputHash, ok: execution.diagnosticOutput.ok },
          payload: { arguments: parsedArguments, modelResult: readableModelResult(execution.modelOutput), diagnosticResult: execution.diagnosticOutput }
        })]);
        history.push({ type: "function_call_output", call_id: rawCall.call_id, output: execution.modelOutput as never });
        await input.onProgress?.({ toolRecord, usage: { ...usage, durationMs: Date.now() - startedAt }, responseUsage, responseIndex: responseCount, modelId });
        if (execution.needsInput) throw new ManagerNeedsInputError(execution.needsInput.question);
        if (execution.completion) {
          await input.onEvents?.([runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "succeeded", turnIndex, startedAt: turnStartedAt, completedAt: new Date().toISOString(), summary: { toolName, completed: true } })]);
          return {
            completion: managerCompletionSchema.parse(execution.completion),
            modelId,
            promptVersion: websiteManagerPromptVersion,
            usage: { ...usage, durationMs: Date.now() - startedAt },
            toolRecords,
            responses: responseCount
          };
        }
      }
      await input.onEvents?.([runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "succeeded", turnIndex, startedAt: turnStartedAt, completedAt: new Date().toISOString(), summary: { toolNames: calls.map((call) => call.name) } })]);
    }
  }

  async discuss(input: {
    buildInput: SitePublicBuildInputV3;
    message: string;
    currentFiles?: WorkspaceSourceFile[];
    selection?: SiteElementSelectionV1;
    signal?: AbortSignal;
  }) {
    const settings = await getSiteAuthoringModelSettings();
    const modelId = process.env.LODESTA_SITE_AGENT_MODEL ?? settings.settings.siteAgentModel;
    const result = await structuredResponse({
      client: this.injectedClient ?? configuredResponsesClient(), modelId, name: "manager_discussion_v1", schema: managerDiscussionJsonSchema,
      system: websiteManagerSystemPrompt,
      content: [{ type: "input_text", text: JSON.stringify({
        role: "Discuss the requested change without modifying source. Be concise, state what would change, and identify unsupported capability requests.",
        message: input.message, selection: input.selection, publicEvidencePacket: managerEvidencePacket(input.buildInput),
        verticalContext: input.buildInput.domainContext, currentWorkspace: input.currentFiles?.length ? { files: input.currentFiles } : undefined
      }) }],
      signal: input.signal, maxOutputTokens: 2500
    });
    return { discussion: managerDiscussionSchema.parse(result.value), modelId, usage: result.usage };
  }

}

export class ManagerNeedsInputError extends Error {
  readonly code = "needs_input";
  constructor(readonly question: string) { super(question); }
}

async function structuredResponse(input: {
  client: ManagerResponsesClient;
  modelId: string;
  name: string;
  schema: Record<string, unknown>;
  system: string;
  content: Array<Record<string, unknown>>;
  maxOutputTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}) {
  const startedAt = Date.now();
  const response = await createWithOneTransportRetry(input.client, {
    model: input.modelId, instructions: input.system,
    input: [{ role: "user", type: "message", content: input.content as never }],
    store: false, parallel_tool_calls: false, reasoning: { effort: input.reasoningEffort ?? "high" },
    text: { verbosity: "low", format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } },
    max_output_tokens: input.maxOutputTokens
  }, boundedSignal(input.signal, 10 * 60_000));
  if (!response.output_text) throw new Error("Website manager response did not contain structured output text.");
  return { value: JSON.parse(response.output_text) as unknown, usage: usageFor(response.usage, Date.now() - startedAt) };
}

function configuredResponsesClient(): ManagerResponsesClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for website manager runs.");
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 10 * 60_000 });
  return { create: (params, options) => client.responses.create(params, options) };
}

async function createWithOneTransportRetry(client: ManagerResponsesClient, params: ResponseCreateParamsNonStreaming, signal: AbortSignal) {
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

function limitsFor(input: ManagerRunRequest, override?: Partial<ManagerRunLimits>): ManagerRunLimits {
  return { ...defaultLimits, maxDurationMs: input.kind === "initial_build" ? 20 * 60_000 : 10 * 60_000, ...override };
}

function assertWithinLimits(input: { limits: ManagerRunLimits; usage: ManagerModelUsage; startedAt: number }) {
  if (input.usage.inputTokens >= input.limits.maxInputTokens) throw new Error("manager_input_token_limit_exhausted");
  if (input.usage.outputTokens >= input.limits.maxOutputTokens) throw new Error("manager_output_token_limit_exhausted");
  if (Date.now() - input.startedAt >= input.limits.maxDurationMs) throw new Error("manager_duration_limit_exhausted");
}

function boundedSignal(signal: AbortSignal | undefined, durationMs: number) {
  const timeout = AbortSignal.timeout(Math.max(1, durationMs));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function emptyUsage(): ManagerModelUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 };
}

function mergeUsage(target: ManagerModelUsage, value: Response["usage"], startedAt: number) {
  const next = usageFor(value, Date.now() - startedAt);
  target.inputTokens += next.inputTokens;
  target.cachedInputTokens += next.cachedInputTokens;
  target.outputTokens += next.outputTokens;
  target.estimatedCostUsd += next.estimatedCostUsd;
  target.costEstimateStatus = target.costEstimateStatus === "configured" && next.costEstimateStatus === "configured" ? "configured" : next.costEstimateStatus;
  target.durationMs = Date.now() - startedAt;
}

function usageFor(value: Response["usage"], durationMs: number): ManagerModelUsage {
  const inputTokens = value?.input_tokens ?? 0;
  const cachedInputTokens = value?.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = value?.output_tokens ?? 0;
  const inputPrice = Number(process.env.LODESTA_MODEL_INPUT_USD_PER_MILLION);
  const outputPrice = Number(process.env.LODESTA_MODEL_OUTPUT_USD_PER_MILLION);
  const configured = Number.isFinite(inputPrice) && inputPrice > 0 && Number.isFinite(outputPrice) && outputPrice > 0;
  return {
    inputTokens, cachedInputTokens, outputTokens,
    estimatedCostUsd: configured ? (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000 : 0,
    costEstimateStatus: configured ? "configured" : "unavailable", durationMs
  };
}

function runEvent(event: ManagerRunEvent) { return event; }
function eventId(prefix: string) { return `${prefix}_${Date.now().toString(36)}${randomUUID().replaceAll("-", "")}`; }
function usageFields(usage: ManagerModelUsage) { return { inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens }; }
function boundedError(error: unknown) { const message = error instanceof Error ? error.message : String(error); return message.length > 4000 ? `${message.slice(0, 3980)}... [truncated]` : message; }
function diagnosticErrorCode(error: unknown) { const message = typeof error === "string" ? error : boundedError(error); return message.length > 160 ? `${message.slice(0, 157)}...` : message; }
function readableModelResult(value: ManagerToolExecution["modelOutput"]) { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return value; } }
function toolError(error: unknown): ManagerToolExecution { const message = boundedError(error); return { modelOutput: JSON.stringify({ ok: false, error: message }), diagnosticOutput: { ok: false, error: message } }; }

function runtimeStateMessage(summary: Record<string, unknown>): ResponseInputItem {
  return { role: "user", type: "message", content: [{ type: "input_text", text: `Current deterministic workspace state:\n${JSON.stringify(summary)}` }] };
}

function modelTurnPayload(history: ResponseInputItem[], response: ManagerResponse | undefined, promptVersion: string) {
  return {
    request: { promptVersion, input: history, toolChoice: "required", parallelToolCalls: false, store: false, reasoningEffort: "high" },
    response: response ? { status: response.status, error: response.error, incompleteDetails: response.incomplete_details, output: response.output, outputText: response.output_text } : undefined
  };
}

const sourcePathSchema = { type: "string", pattern: "^src/[a-zA-Z0-9_./-]+\\.(?:ts|tsx|css)$" };

const managerTools: Tool[] = [
  tool("list_files", "List every current source file with its hash and size.", { type: "object", additionalProperties: false, properties: {}, required: [] }),
  tool("read_file", "Read a source file, optionally by line window.", {
    type: "object", additionalProperties: false, required: ["path", "startLine", "endLine"],
    properties: { path: sourcePathSchema, startLine: { type: ["integer", "null"], minimum: 1 }, endLine: { type: ["integer", "null"], minimum: 1 } }
  }),
  tool("write_file", "Create or replace one complete source file.", {
    type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: sourcePathSchema, content: { type: "string" } }
  }),
  tool("delete_file", "Delete one source file.", {
    type: "object", additionalProperties: false, required: ["path"], properties: { path: sourcePathSchema }
  }),
  tool("apply_patch", "Atomically create, replace, or delete several complete source files. Use null content to delete a file.", {
    type: "object", additionalProperties: false, required: ["files"], properties: {
      files: { type: "array", minItems: 1, maxItems: 80, items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: sourcePathSchema, content: { type: ["string", "null"] } } } }
    }
  }),
  tool("build_preview", "Validate and build the current workspace. Returns compiler or policy errors directly.", { type: "object", additionalProperties: false, properties: {}, required: [] }),
  tool("inspect_site", "Optionally run the same release verification used by finalization and return actionable blockers, advisories, and screenshots.", { type: "object", additionalProperties: false, properties: {}, required: [] }),
  tool("request_input", "Before the first source mutation only, pause and ask one essential owner question when proceeding would require a consequential guess.", {
    type: "object", additionalProperties: false, required: ["question"], properties: { question: { type: "string", minLength: 1, maxLength: 600 } }
  }),
  tool("finish", "Finish after a current successful build. Finalization runs release verification automatically when needed.", {
    type: "object", additionalProperties: false, required: ["ownerMessage"],
    properties: { ownerMessage: { type: "string", minLength: 1, maxLength: 1200 } }
  })
];

function tool(name: string, description: string, parameters: Record<string, unknown>): Tool { return { type: "function", name, description, parameters, strict: true }; }

const managerDiscussionJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "response", "proposedAction", "requiresApply"],
  properties: { schemaVersion: { type: "string", const: "manager-discussion" }, response: { type: "string" }, proposedAction: { type: ["string", "null"] }, requiresApply: { type: "boolean" } }
};
