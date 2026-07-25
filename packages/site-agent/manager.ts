import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseFunctionToolCall, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { configuredAppOrigin } from "@/lib/app-origin";
import { getSiteAuthoringModelSettings } from "@/lib/operator-settings";
import { sha256, stableJson } from "@/packages/business-data";
import { siteAgentApiProviderSchema, type SiteAgentApiProvider, type SiteElementSelection, type SitePublicBuildInput } from "@/packages/site-contracts";
import {
  managerCompletionSchema,
  managerDiscussionSchema,
  managerToolArguments,
  managerToolNameSchema,
  type ManagerCompletion,
  type ManagerModelUsage,
  type ManagerRunGuardrails,
  type ManagerRunRequest,
  type ManagerToolExecution,
  type ManagerToolRuntime,
  type ManagerToolRecord,
  type ManagerRunEvent,
  type WorkspaceSourceFile
} from "./contracts";
import {
  classifyModelProviderError,
  isSiteAuthoringTerminalError,
  SiteAuthoringTerminalError
} from "./failures";
import { managerBuildContext, managerEvidencePacket, websiteManagerPromptIdentity, websiteManagerSystemPrompt } from "./prompts";
import {
  isSupportedSiteAgentModel,
  managerGuardrailsForKind,
  siteAgentRunGuardrailDefaults,
  siteAgentReasoningEffort,
  siteAgentTextVerbosity,
  usageForModel
} from "./run-policy";

export type { ManagerRunRequest } from "./contracts";

type ProviderResponseUsage = NonNullable<Response["usage"]> & {
  cost?: number | null;
  cost_details?: { upstream_inference_cost?: number | null } | null;
};
type ManagerResponse = Pick<Response, "id" | "model" | "output" | "output_text" | "status" | "error" | "incomplete_details"> & {
  usage?: ProviderResponseUsage;
  openrouter_metadata?: unknown;
};

export interface ManagerResponsesClient {
  create(params: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<ManagerResponse>;
}

export class WebsiteManagerAgent {
  constructor(private readonly injectedClient?: ManagerResponsesClient) {}

  async run(input: ManagerRunRequest & {
    runtime: ManagerToolRuntime;
    onUsage?: (progress: { usage: ManagerModelUsage; responseUsage: ManagerModelUsage; responseIndex: number; apiProvider: SiteAgentApiProvider; modelId: string }) => Promise<void>;
    onProgress?: (progress: { toolRecord: ManagerToolRecord; usage: ManagerModelUsage; responseUsage: ManagerModelUsage; responseIndex: number; apiProvider: SiteAgentApiProvider; modelId: string }) => Promise<void>;
    onEvents?: (events: ManagerRunEvent[]) => Promise<void>;
  }): Promise<{
    completion: ManagerCompletion;
    apiProvider: SiteAgentApiProvider;
    modelId: string;
    promptIdentity: string;
    usage: ManagerModelUsage;
    toolRecords: ManagerToolRecord[];
    responses: number;
  }> {
    const settings = await getSiteAuthoringModelSettings();
    const route = selectedSiteAgentRoute(settings.settings.siteAgentProvider, settings.settings.siteAgentModel);
    const { apiProvider, modelId } = route;
    const client = this.injectedClient ?? configuredResponsesClient(apiProvider);
    const guardrails = guardrailsFor(input, input.guardrails);
    const startedAt = Date.now();
    const usage = emptyUsage();
    const toolRecords: ManagerToolRecord[] = [];
    const replayedCalls = new Map<string, { inputHash: `sha256:${string}`; result: ManagerToolExecution; status: "succeeded" | "failed" }>();
    const initialContext: ResponseInputItem = {
      role: "user",
      type: "message",
      content: [{ type: "input_text", text: JSON.stringify(managerBuildContext({
        buildInput: input.buildInput,
        authoringContext: input.authoringContext,
        verticalContext: input.buildInput.domainContext,
        instruction: input.instruction,
        kind: input.kind,
        selection: input.selection
      })) }, ...(input.mediaSheet ? [{
        type: "input_image" as const,
        image_url: input.mediaSheet.dataUrl,
        detail: "high" as const
      }] : [])]
    };
    const history: ResponseInputItem[] = [initialContext];
    let responseCount = 0;
    let consecutiveFailureFingerprint: string | undefined;
    let consecutiveIdenticalFailures = 0;

    while (true) {
      assertWithinCostGuardrail(usage, guardrails.maxCostUsd);
      const turnIndex = responseCount + 1;
      const turnId = eventId("turn");
      const modelIdValue = eventId("model");
      const turnStartedAt = new Date().toISOString();
      const requestHistory = [...history, runtimeStateMessage(input.runtime.stateSummary())];
      await input.onEvents?.([
        runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "running", turnIndex, startedAt: turnStartedAt, summary: { historyItems: requestHistory.length } }),
        runEvent({ id: modelIdValue, kind: "model_request", name: "responses.create", status: "running", turnIndex, apiProvider, modelId, startedAt: turnStartedAt, summary: { historyItems: requestHistory.length } })
      ]);
      const responseStartedAt = Date.now();
      let response: ManagerResponse;
      try {
        response = await createWithOneTransportRetry(client, routedResponseParams({
          model: modelId,
          instructions: websiteManagerSystemPrompt,
          input: requestHistory,
          tools: managerTools,
          tool_choice: "required",
          parallel_tool_calls: false,
          store: false,
          include: ["reasoning.encrypted_content"],
          reasoning: { effort: siteAgentReasoningEffort },
          text: { verbosity: siteAgentTextVerbosity },
          max_output_tokens: 64_000
        }, apiProvider, input.runId), input.signal);
      } catch (error) {
        const completedAt = new Date().toISOString();
        const errorCode = diagnosticErrorCode(error);
        await input.onEvents?.([
          runEvent({ id: modelIdValue, kind: "model_request", name: "responses.create", status: "failed", turnIndex, apiProvider, modelId, startedAt: turnStartedAt, completedAt, errorCode, summary: { error: errorCode }, payload: modelTurnPayload(requestHistory, undefined, websiteManagerPromptIdentity, route) }),
          runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "failed", turnIndex, startedAt: turnStartedAt, completedAt, errorCode, summary: { error: errorCode } })
        ]);
        throw classifyModelProviderError(error);
      }
      responseCount += 1;
      const responseUsage = usageForModel(modelId, response.usage, Date.now() - responseStartedAt);
      mergeUsage(usage, response.usage, startedAt, modelId);
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      const modelCompletedAt = new Date().toISOString();
      await input.onEvents?.([runEvent({
        id: modelIdValue, kind: "model_request", name: "responses.create", status: "succeeded", turnIndex,
        startedAt: turnStartedAt, completedAt: modelCompletedAt, ...usageFields(responseUsage, route, response),
        summary: { outputItems: response.output.length, functionCalls: calls.length }, payload: modelTurnPayload(requestHistory, response, websiteManagerPromptIdentity, route)
      })]);
      history.push(...response.output as ResponseInputItem[]);
      await input.onUsage?.({ usage: { ...usage }, responseUsage, responseIndex: responseCount, apiProvider, modelId });
      if (responseUsage.costSource === "unavailable") {
        throw new SiteAuthoringTerminalError(
          "cost_telemetry_unavailable",
          "platform",
          false,
          `cost_telemetry_unavailable:${apiProvider}:${modelId}`
        );
      }

      if (!calls.length) {
        history.push({ role: "user", type: "message", content: [{ type: "input_text", text: "Continue the website task using the available workspace tools." }] });
        await input.onEvents?.([runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "succeeded", turnIndex, startedAt: turnStartedAt, completedAt: new Date().toISOString(), summary: { functionCalls: 0 } })]);
        continue;
      }

      for (const rawCall of calls) {
        const started = new Date().toISOString();
        const toolEventId = eventId("tool");
        let name: ReturnType<typeof managerToolNameSchema.parse> | undefined;
        let parsedArguments: Record<string, unknown> = {};
        let execution: ManagerToolExecution;
        let status: "succeeded" | "failed" = "succeeded";
        let terminalError: SiteAuthoringTerminalError | undefined;
        let stalledError: SiteAuthoringTerminalError | undefined;
        let metering: ManagerToolExecution["metering"];
        let replayed = false;
        const workspaceHashBefore = runtimeWorkspaceHash(input.runtime.stateSummary());
        try {
          name = managerToolNameSchema.parse(rawCall.name);
          parsedArguments = managerToolArguments[name].parse(JSON.parse(rawCall.arguments)) as Record<string, unknown>;
          const inputHash = sha256(stableJson({ name, arguments: parsedArguments }));
          const replay = replayedCalls.get(rawCall.call_id);
          if (replay && replay.inputHash !== inputHash) throw new Error(`manager_call_id_reused_with_different_input:${rawCall.call_id}`);
          if (replay) {
            execution = replay.result;
            status = replay.status;
            replayed = true;
          } else {
            try {
              if (isOwnerVisibleSlowTool(name)) {
                await recordBestEffort(input.onEvents, runEvent({
                  id: toolEventId,
                  kind: managerOperationKind(name),
                  name,
                  status: "running",
                  turnIndex,
                  startedAt: started,
                  summary: {}
                }));
              }
              execution = await input.runtime.execute({ callId: rawCall.call_id, name, arguments: parsedArguments });
              if (execution.diagnosticOutput.ok === false) status = "failed";
              metering = execution.metering;
              if (metering) {
                mergeMeteredUsage(usage, metering.usage, startedAt);
                if (metering.usage.costSource === "unavailable") {
                  terminalError = new SiteAuthoringTerminalError(
                    "cost_telemetry_unavailable",
                    "platform",
                    false,
                    `tool_cost_telemetry_unavailable:${toolNameForMetering(name)}:${metering.apiProvider}:${metering.modelId}`
                  );
                }
              }
            } catch (error) {
              status = "failed";
              execution = toolError(error);
              if (isSiteAuthoringTerminalError(error)) terminalError = error;
            }
            replayedCalls.set(rawCall.call_id, { inputHash, result: execution, status });
          }
        } catch (error) {
          status = "failed";
          execution = toolError(error);
        }
        const workspaceHashAfter = runtimeWorkspaceHash(input.runtime.stateSummary());
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
        await input.onEvents?.([runEvent({
          id: toolEventId, kind: managerOperationKind(toolName), name: toolName, status, turnIndex,
          startedAt: started, completedAt: toolRecord.completedAt,
          ...(metering ? toolMeteringFields(metering) : {}),
          errorCode: status === "failed" ? diagnosticErrorCode(execution.diagnosticOutput.error ?? "tool_failed") : undefined,
          summary: { callId: rawCall.call_id, inputHash, outputHash, ok: execution.diagnosticOutput.ok, replayed },
          payload: {
            arguments: parsedArguments,
            modelResult: readableModelResult(execution.modelOutput),
            diagnosticResult: execution.diagnosticOutput,
            metering: metering ? { apiProvider: metering.apiProvider, modelId: metering.modelId, usage: metering.usage } : undefined
          }
        })]);
        history.push({ type: "function_call_output", call_id: rawCall.call_id, output: execution.modelOutput as never });
        await input.onProgress?.({ toolRecord, usage: { ...usage, durationMs: Date.now() - startedAt }, responseUsage, responseIndex: responseCount, apiProvider, modelId });
        if (terminalError) throw terminalError;
        const workspaceMutated = workspaceHashBefore !== workspaceHashAfter
          || (toolName === "create_image" && status === "succeeded" && execution.diagnosticOutput.ok !== false);
        if (workspaceMutated || (isReleaseTool(toolName) && status === "succeeded")) {
          consecutiveFailureFingerprint = undefined;
          consecutiveIdenticalFailures = 0;
        } else if (isReleaseTool(toolName) && status === "failed") {
          const failureFingerprint = releaseFailureFingerprint(toolName, workspaceHashAfter, execution);
          if (failureFingerprint === consecutiveFailureFingerprint) {
            consecutiveIdenticalFailures += 1;
          } else {
            consecutiveFailureFingerprint = failureFingerprint;
            consecutiveIdenticalFailures = 1;
          }
          if (consecutiveIdenticalFailures >= guardrails.maxConsecutiveIdenticalFailures) {
            stalledError = new SiteAuthoringTerminalError(
              "authoring_stalled",
              "authoring",
              false,
              `authoring_stalled:${toolName}:${failureFingerprint}:${consecutiveIdenticalFailures}`
            );
          }
        }
        if (stalledError) throw stalledError;
        if (execution.needsInput) throw new ManagerNeedsInputError(execution.needsInput.question);
        if (execution.completion) {
          await input.onEvents?.([runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "succeeded", turnIndex, startedAt: turnStartedAt, completedAt: new Date().toISOString(), summary: { toolName, completed: true } })]);
          return {
            completion: managerCompletionSchema.parse(execution.completion),
            apiProvider,
            modelId,
            promptIdentity: websiteManagerPromptIdentity,
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
    buildInput: SitePublicBuildInput;
    message: string;
    currentFiles?: WorkspaceSourceFile[];
    selection?: SiteElementSelection;
    signal?: AbortSignal;
  }) {
    const settings = await getSiteAuthoringModelSettings();
    const route = selectedSiteAgentRoute(settings.settings.siteAgentProvider, settings.settings.siteAgentModel);
    const { apiProvider, modelId } = route;
    const result = await structuredResponse({
      client: this.injectedClient ?? configuredResponsesClient(apiProvider), route, name: "manager_discussion", schema: managerDiscussionJsonSchema,
      system: websiteManagerSystemPrompt,
      content: [{ type: "input_text", text: JSON.stringify({
        role: "Discuss the requested change without modifying source. Be concise, state what would change, and identify unsupported capability requests. Speak in owner-facing page and section terms. Do not mention source paths, filenames, selectors, framework internals, internal error codes, or raw run telemetry.",
        message: input.message, selection: input.selection, publicEvidencePacket: managerEvidencePacket(input.buildInput),
        verticalContext: input.buildInput.domainContext, currentWorkspace: input.currentFiles?.length ? { files: input.currentFiles } : undefined
      }) }],
      signal: input.signal, maxOutputTokens: 2500
    });
    return { discussion: managerDiscussionSchema.parse(result.value), apiProvider, modelId, usage: result.usage };
  }

}

export class ManagerNeedsInputError extends Error {
  readonly code = "needs_input";
  constructor(readonly question: string) { super(question); }
}

async function structuredResponse(input: {
  client: ManagerResponsesClient;
  route: { apiProvider: SiteAgentApiProvider; modelId: string };
  name: string;
  schema: Record<string, unknown>;
  system: string;
  content: Array<Record<string, unknown>>;
  maxOutputTokens: number;
  signal?: AbortSignal;
}) {
  const startedAt = Date.now();
  const response = await createWithOneTransportRetry(input.client, routedResponseParams({
    model: input.route.modelId, instructions: input.system,
    input: [{ role: "user", type: "message", content: input.content as never }],
    store: false, parallel_tool_calls: false, reasoning: { effort: siteAgentReasoningEffort },
    text: { verbosity: siteAgentTextVerbosity, format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } },
    max_output_tokens: input.maxOutputTokens
  }, input.route.apiProvider), input.signal);
  if (!response.output_text) throw new Error("Website manager response did not contain structured output text.");
  return { value: JSON.parse(response.output_text) as unknown, usage: usageForModel(input.route.modelId, response.usage, Date.now() - startedAt) };
}

function configuredResponsesClient(apiProvider: SiteAgentApiProvider): ManagerResponsesClient {
  const apiKey = apiProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(`${apiProvider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} is required for website manager runs.`);
  const origin = configuredAppOrigin();
  const client = new OpenAI({
    apiKey,
    baseURL: apiProvider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined,
    maxRetries: 0,
    timeout: siteAgentRunGuardrailDefaults.initial_build.deadlineMs,
    defaultHeaders: apiProvider === "openrouter"
      ? {
          ...(origin ? { "HTTP-Referer": origin } : {}),
          "X-OpenRouter-Title": "Lodesta",
          "X-OpenRouter-Metadata": "enabled"
        }
      : undefined
  });
  return { create: (params, options) => client.responses.create(params, options) };
}

function selectedSiteAgentRoute(configuredProvider: SiteAgentApiProvider, configuredModelId: string) {
  const apiProvider = siteAgentApiProviderSchema.safeParse(process.env.LODESTA_SITE_AGENT_PROVIDER?.trim() || configuredProvider);
  if (!apiProvider.success) {
    throw new SiteAuthoringTerminalError("unknown_internal_failure", "platform", false, "site_agent_api_provider_invalid");
  }
  const modelId = process.env.LODESTA_SITE_AGENT_MODEL?.trim() || configuredModelId;
  if (apiProvider.data === "openai" && !isSupportedSiteAgentModel(modelId)) {
    throw new SiteAuthoringTerminalError(
      "unknown_internal_failure",
      "platform",
      false,
      `site_agent_model_pricing_missing:${modelId}`
    );
  }
  if (apiProvider.data === "openrouter" && !modelId.includes("/")) {
    throw new SiteAuthoringTerminalError(
      "unknown_internal_failure",
      "platform",
      false,
      `openrouter_model_slug_invalid:${modelId}`
    );
  }
  return { apiProvider: apiProvider.data, modelId };
}

function routedResponseParams(params: ResponseCreateParamsNonStreaming, apiProvider: SiteAgentApiProvider, sessionId?: string) {
  if (apiProvider !== "openrouter") return params;
  return {
    ...params,
    provider: {
      data_collection: "deny",
      zdr: true,
      require_parameters: true
    },
    ...(sessionId ? { session_id: sessionId.slice(0, 256) } : {})
  } as ResponseCreateParamsNonStreaming;
}

async function createWithOneTransportRetry(client: ManagerResponsesClient, params: ResponseCreateParamsNonStreaming, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.create(params, signal ? { signal } : undefined);
      if (response.status === "failed") throw new Error(response.error?.message ?? "manager_model_failed");
      if (response.status === "incomplete") throw new Error(`manager_model_incomplete:${response.incomplete_details?.reason ?? "unknown"}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt > 0 || signal?.aborted || !transientTransportError(error)) throw error;
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

function guardrailsFor(input: ManagerRunRequest, override?: Partial<ManagerRunGuardrails>): ManagerRunGuardrails {
  return { ...managerGuardrailsForKind(input.kind), ...override };
}

function assertWithinCostGuardrail(usage: ManagerModelUsage, maxCostUsd: number) {
  if (usage.costUsd >= maxCostUsd) {
    throw new SiteAuthoringTerminalError(
      "cost_limit_exhausted",
      "budget",
      false,
      `manager_cost_limit_exhausted:${usage.costUsd.toFixed(6)}:${maxCostUsd.toFixed(6)}`
    );
  }
}

function runtimeWorkspaceHash(summary: Record<string, unknown>) {
  const workspace = summary.workspace;
  if (!workspace || typeof workspace !== "object") return undefined;
  const hash = (workspace as Record<string, unknown>).hash;
  return typeof hash === "string" ? hash : undefined;
}

function isReleaseTool(name: string): name is "build_preview" | "inspect_site" | "finish" {
  return name === "build_preview" || name === "inspect_site" || name === "finish";
}

function releaseFailureFingerprint(
  toolName: "build_preview" | "inspect_site" | "finish",
  workspaceHash: string | undefined,
  execution: ManagerToolExecution
) {
  const explicit = execution.diagnosticOutput.failureFingerprint;
  if (typeof explicit === "string" && /^sha256:[a-f0-9]{64}$/.test(explicit)) {
    return sha256(stableJson({ toolName, workspaceHash, failureFingerprint: explicit }));
  }
  return sha256(stableJson({
    toolName,
    workspaceHash,
    failure: stableFailureValue(execution.diagnosticOutput)
  }));
}

function stableFailureValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableFailureValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/cached|duration|timestamp|startedAt|completedAt|storage|payloadRef|key$/i.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableFailureValue(nested)])
  );
}

function emptyUsage(): ManagerModelUsage {
  return { inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, costUsd: 0, costSource: "unavailable", upstreamInferenceCostUsd: 0, durationMs: 0 };
}

function mergeUsage(target: ManagerModelUsage, value: Response["usage"], startedAt: number, modelId: string) {
  const next = usageForModel(modelId, value, Date.now() - startedAt);
  mergeMeteredUsage(target, next, startedAt);
}

function mergeMeteredUsage(target: ManagerModelUsage, next: ManagerModelUsage, startedAt: number) {
  const hadUsage = target.inputTokens > 0 || target.outputTokens > 0;
  target.inputTokens += next.inputTokens;
  target.cachedInputTokens += next.cachedInputTokens;
  target.reasoningTokens += next.reasoningTokens;
  target.outputTokens += next.outputTokens;
  target.costUsd += next.costUsd;
  target.costSource = combinedCostSource(target.costSource, next.costSource, hadUsage);
  target.upstreamInferenceCostUsd += next.upstreamInferenceCostUsd;
  target.durationMs = Date.now() - startedAt;
}

function toolMeteringFields(metering: NonNullable<ManagerToolExecution["metering"]>) {
  return {
    apiProvider: metering.apiProvider,
    modelId: metering.modelId,
    servedModelId: metering.servedModelId,
    providerRequestId: metering.providerRequestId,
    inputTokens: metering.usage.inputTokens,
    cachedInputTokens: metering.usage.cachedInputTokens,
    reasoningTokens: metering.usage.reasoningTokens,
    outputTokens: metering.usage.outputTokens,
    costUsd: metering.usage.costUsd,
    costSource: metering.usage.costSource,
    upstreamInferenceCostUsd: metering.usage.upstreamInferenceCostUsd,
    modelDurationMs: metering.usage.durationMs
  };
}

function toolNameForMetering(name: string | undefined) {
  return name ?? "unknown_tool";
}

function runEvent(event: ManagerRunEvent) { return event; }
function eventId(prefix: string) { return `${prefix}_${Date.now().toString(36)}${randomUUID().replaceAll("-", "")}`; }

function managerOperationKind(toolName: string): ManagerRunEvent["kind"] {
  if (toolName === "build_preview") return "build";
  if (toolName === "inspect_site" || toolName === "finish") return "inspection";
  return "tool_call";
}

function isOwnerVisibleSlowTool(toolName: string) {
  return toolName === "create_image"
    || toolName === "build_preview"
    || toolName === "inspect_site"
    || toolName === "finish";
}

async function recordBestEffort(
  onEvents: ((events: ManagerRunEvent[]) => Promise<void>) | undefined,
  event: ManagerRunEvent
) {
  try {
    await onEvents?.([event]);
  } catch {
    // Owner activity is telemetry only; a failed opening span must not block tool execution.
  }
}
function usageFields(usage: ManagerModelUsage, route: { apiProvider: SiteAgentApiProvider; modelId: string }, response: ManagerResponse) {
  return {
    apiProvider: route.apiProvider,
    modelId: route.modelId,
    servedModelId: response.model,
    upstreamProvider: selectedUpstreamProvider(response, route.apiProvider),
    providerRequestId: response.id,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    costSource: usage.costSource,
    upstreamInferenceCostUsd: usage.upstreamInferenceCostUsd,
    modelDurationMs: usage.durationMs
  };
}
function boundedError(error: unknown) { const message = error instanceof Error ? error.message : String(error); return message.length > 4000 ? `${message.slice(0, 3980)}... [truncated]` : message; }
function diagnosticErrorCode(error: unknown) { const message = typeof error === "string" ? error : boundedError(error); return message.length > 160 ? `${message.slice(0, 157)}...` : message; }
function readableModelResult(value: ManagerToolExecution["modelOutput"]) { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return value; } }
function toolError(error: unknown): ManagerToolExecution { const message = boundedError(error); return { modelOutput: JSON.stringify({ ok: false, error: message }), diagnosticOutput: { ok: false, error: message } }; }

function runtimeStateMessage(summary: Record<string, unknown>): ResponseInputItem {
  return { role: "user", type: "message", content: [{ type: "input_text", text: `Current deterministic workspace state:\n${JSON.stringify(summary)}` }] };
}

function modelTurnPayload(history: ResponseInputItem[], response: ManagerResponse | undefined, promptIdentity: string, route: { apiProvider: SiteAgentApiProvider; modelId: string }) {
  return {
    request: {
      promptIdentity,
      apiProvider: route.apiProvider,
      modelId: route.modelId,
      input: history,
      toolChoice: "required",
      parallelToolCalls: false,
      store: false,
      reasoningEffort: siteAgentReasoningEffort,
      textVerbosity: siteAgentTextVerbosity
    },
    response: response ? { status: response.status, error: response.error, incompleteDetails: response.incomplete_details, output: response.output, outputText: response.output_text } : undefined
  };
}

function combinedCostSource(left: ManagerModelUsage["costSource"], right: ManagerModelUsage["costSource"], hadUsage: boolean): ManagerModelUsage["costSource"] {
  if (!hadUsage) return right;
  if (left === "unavailable" || right === "unavailable") return "unavailable";
  if (left === right) return left;
  return "mixed";
}

function selectedUpstreamProvider(response: ManagerResponse, apiProvider: SiteAgentApiProvider) {
  if (apiProvider === "openai") return "openai";
  const metadata = record(response.openrouter_metadata);
  const endpoints = record(metadata?.endpoints);
  const available = Array.isArray(endpoints?.available) ? endpoints.available : [];
  const selected = available.map(record).find((item) => item?.selected === true);
  return typeof selected?.provider === "string" ? selected.provider : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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
  tool("create_image", "Generate a new image or edit 1-4 available business assets with GPT Image 2. Use this only when it materially improves the site; return value includes the new asset ID and image pixels.", {
    type: "object", additionalProperties: false, required: ["action", "purpose", "prompt", "sourceAssetIds", "size", "alt"],
    properties: {
      action: { type: "string", enum: ["generate", "edit"] },
      purpose: { type: "string", enum: ["hero", "section", "background", "gallery", "logo", "other"] },
      prompt: { type: "string", minLength: 1, maxLength: 8000 },
      sourceAssetIds: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
      size: { type: "string", enum: ["1536x1024", "1024x1536", "1024x1024"] },
      alt: { type: "string", minLength: 1, maxLength: 500 }
    }
  }),
  tool("build_preview", "Validate and build the current workspace. Returns compiler or policy errors directly.", { type: "object", additionalProperties: false, properties: {}, required: [] }),
  tool("inspect_site", "Optionally inspect the current successful build in Lodesta's browser and release verifier. Returns screenshots plus actionable blockers and advisories without requiring finalization.", { type: "object", additionalProperties: false, properties: {}, required: [] }),
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
