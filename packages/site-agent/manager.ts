import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseFunctionToolCall, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import type { ModelCatalog } from "@/lib/model-catalog";
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
import {
  authoringBriefAlertCharacters,
  authoringBriefCharacters,
  createManagerDiscussionBrief
} from "./briefs";
import { DeterministicManagerHistory, managerPromptTelemetry } from "./history";
import { managerBuildContext, websiteManagerPromptIdentity, websiteManagerSystemPrompt } from "./prompts";
import {
  establishProviderAuthoringCapabilities,
  type ProviderAuthoringCapabilities
} from "./provider-capabilities";
import { isEstablishedOpenRouterAuthoringRoute } from "./provider-routes";
import { taskSkillFor } from "./skills";
import { openRouterAnthropicMessagesClient } from "./openrouter-anthropic-messages";
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
type ManagerOutputItem = Response["output"][number] | ResponseInputItem;
type ManagerResponse = Pick<Response, "id" | "model" | "output_text" | "status" | "error" | "incomplete_details"> & {
  output: ManagerOutputItem[];
  usage?: ProviderResponseUsage;
  openrouter_metadata?: unknown;
};

export interface ManagerResponsesClient {
  create(params: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<ManagerResponse>;
}

export class WebsiteManagerAgent {
  constructor(
    private readonly injectedClient?: ManagerResponsesClient,
    private readonly openRouterCatalogLoader?: () => Promise<ModelCatalog>
  ) {}

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
    telemetry: {
      firstSuccessfulBuildMs?: number;
      modelRequests: number;
      noToolResponses: number;
      toolCalls: Record<string, number>;
      unchangedPathRereads: number;
      parallelToolViolations: number;
      upstreamChanges: number;
      contextWindowTokens: number;
      maxOutputTokens: number;
      usableInputTokens: number;
      contextUtilizationHighWater: number;
      contextHighWaterRequest?: number;
    };
  }> {
    const route = input.route
      ? validatedSiteAgentRoute(input.route.apiProvider, input.route.modelId)
      : await configuredSiteAgentRoute();
    const { apiProvider, modelId } = route;
    const providerCapability = await establishProviderAuthoringCapabilities(apiProvider, modelId, {
      loadOpenRouterCatalog: this.openRouterCatalogLoader
    });
    const maxOutputTokens = 64_000;
    const usableInputTokens = providerCapability.descriptor.contextWindowTokens - maxOutputTokens;
    if (usableInputTokens <= 0) {
      throw new SiteAuthoringTerminalError(
        "context_capacity_exhausted",
        "provider",
        false,
        `context_capacity_exhausted:${providerCapability.descriptor.contextWindowTokens}:${maxOutputTokens}`
      );
    }
    const client = this.injectedClient ?? configuredResponsesClient(providerCapability.descriptor);
    const availableTools = websiteManagerTools;
    const providerTools = projectToolsForProvider(availableTools, providerCapability.descriptor);
    const guardrails = guardrailsFor(input, input.guardrails);
    const startedAt = Date.now();
    const usage = emptyUsage();
    const toolRecords: ManagerToolRecord[] = [];
    const replayedCalls = new Map<string, { inputHash: `sha256:${string}`; result: ManagerToolExecution; status: "succeeded" | "failed" }>();
    const briefCreatedAt = new Date().toISOString();
    const briefCharacters = authoringBriefCharacters(input.authoringBrief);
    const briefProvenance = {
      schemaVersion: 1 as const,
      kind: "site-authoring-brief-provenance" as const,
      producer: websiteManagerPromptIdentity,
      modelRoute: route,
      skill: taskSkillFor(input.kind).identity,
      guidance: input.authoringBrief.guidance
        ? { id: input.authoringBrief.guidance.id, version: input.authoringBrief.guidance.version }
        : undefined,
      inputHash: input.buildInput.inputHash,
      generatedAt: briefCreatedAt,
      stale: false,
      regeneration: "fresh" as const
    };
    const openAiCacheEnabled = providerCapability.descriptor.cacheStrategy === "openai_implicit_explicit";
    const stableExplicitCache = openAiCacheEnabled
      || providerCapability.descriptor.cacheStrategy === "anthropic_explicit";
    const textBlock = {
      type: "input_text" as const,
      text: JSON.stringify(managerBuildContext({
        authoringBrief: input.authoringBrief,
        instruction: input.instruction,
        kind: input.kind,
        selection: input.selection
      })),
      ...(!input.mediaSheet && stableExplicitCache ? { prompt_cache_breakpoint: { mode: "explicit" as const } } : {})
    };
    const initialContext: ResponseInputItem[] = [{
      role: "user",
      type: "message",
      content: [textBlock, ...(input.mediaSheet ? [{
        type: "input_image" as const,
        image_url: input.mediaSheet.dataUrl,
        detail: "high" as const,
        ...(stableExplicitCache ? { prompt_cache_breakpoint: { mode: "explicit" as const } } : {})
      }] : [])]
    }];
    const history = new DeterministicManagerHistory(initialContext);
    let responseCount = 0;
    let noToolResponses = 0;
    let firstSuccessfulBuildMs: number | undefined;
    const toolCallCounts = new Map<string, number>();
    let consecutiveFailureFingerprint: string | undefined;
    let consecutiveIdenticalFailures = 0;
    let parallelToolViolations = 0;
    let upstreamChanges = 0;
    let lastUpstreamProvider: string | undefined;
    let lastInputTokens = 0;
    let contextUtilizationHighWater = 0;
    let contextHighWaterRequest: number | undefined;
    let contextWarningEmitted = false;

    while (true) {
      assertWithinCostGuardrail(usage, guardrails.maxCostUsd);
      if (lastInputTokens >= usableInputTokens) {
        throw new SiteAuthoringTerminalError(
          "context_capacity_exhausted",
          "provider",
          false,
          `context_capacity_exhausted:input=${lastInputTokens}:usable=${usableInputTokens}:request=${responseCount}`
        );
      }
      const turnIndex = responseCount + 1;
      const turnId = eventId("turn");
      const modelIdValue = eventId("model");
      const turnStartedAt = new Date().toISOString();
      const runtimeMessage = runtimeStateMessage(input.runtime.stateSummary());
      history.appendRuntimeState(runtimeMessage);
      const activeTail = history.activeTailItems(turnIndex);
      const projectedTail = providerCapability.descriptor.cacheStrategy === "anthropic_explicit"
        ? withRollingPromptCacheBreakpoint(activeTail)
        : activeTail;
      const requestHistory = [...history.prefixItems(), ...projectedTail];
      const promptTelemetry = managerPromptTelemetry({
        instructions: websiteManagerSystemPrompt,
        tools: providerTools,
        stablePrefix: history.prefixItems(),
        activeTail: projectedTail,
        runtimeState: runtimeMessage,
        requestIndex: turnIndex
      });
      await input.onEvents?.([
        runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "running", turnIndex, startedAt: turnStartedAt, summary: { historyItems: requestHistory.length, ...promptTelemetry } }),
        runEvent({
          id: modelIdValue,
          kind: "model_request",
          name: "responses.create",
          status: "running",
          turnIndex,
          apiProvider,
          modelId,
          startedAt: turnStartedAt,
          summary: {
            historyItems: requestHistory.length,
            authoringBriefCharacters: briefCharacters,
            authoringBriefAlert: briefCharacters > authoringBriefAlertCharacters,
            unchangedPathRereads: history.unchangedPathRereads(),
            contextWindowTokens: providerCapability.descriptor.contextWindowTokens,
            maxOutputTokens,
            usableInputTokens,
            contextUtilizationHighWater,
            ...promptTelemetry
          }
        })
      ]);
      const responseStartedAt = Date.now();
      let response: ManagerResponse;
      let transportRetries = 0;
      try {
        response = await createWithTransportRetry(client, routedResponseParams({
          model: modelId,
          instructions: websiteManagerSystemPrompt,
          input: requestHistory,
          tools: providerTools,
          tool_choice: "required",
          parallel_tool_calls: false,
          store: false,
          include: ["reasoning.encrypted_content"],
          reasoning: { effort: siteAgentReasoningEffort },
          text: { verbosity: siteAgentTextVerbosity },
          max_output_tokens: maxOutputTokens,
          ...(openAiCacheEnabled ? {
            prompt_cache_key: cacheKey(input),
            prompt_cache_options: { mode: "implicit", ttl: "30m" }
          } : {})
        }, providerCapability.descriptor, input.runId), {
          signal: input.signal,
          modelId,
          onRetry: () => { transportRetries += 1; }
        });
      } catch (error) {
        const completedAt = new Date().toISOString();
        const errorCode = diagnosticErrorCode(error);
        await input.onEvents?.([
          runEvent({
            id: modelIdValue,
            kind: "model_request",
            name: "responses.create",
            status: "failed",
            turnIndex,
            apiProvider,
            modelId,
            startedAt: turnStartedAt,
            completedAt,
            errorCode,
            summary: { error: errorCode, transportRetries, ...promptTelemetry },
            payload: modelTurnPayload(requestHistory, undefined, websiteManagerPromptIdentity, route, {
              promptTelemetry,
              briefProvenance,
              providerCapabilities: providerCapability.descriptor,
              providerCapabilityCheck: providerCapability.check
            })
          }),
          runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "failed", turnIndex, startedAt: turnStartedAt, completedAt, errorCode, summary: { error: errorCode } })
        ]);
        throw classifyModelProviderError(error);
      }
      responseCount += 1;
      const responseUsage = usageForModel(modelId, response.usage, Date.now() - responseStartedAt);
      const upstreamProvider = selectedUpstreamProvider(response, apiProvider);
      const upstreamChanged = Boolean(
        upstreamProvider
        && lastUpstreamProvider
        && upstreamProvider !== lastUpstreamProvider
      );
      if (upstreamChanged) upstreamChanges += 1;
      const previousUpstreamProvider = upstreamChanged ? lastUpstreamProvider : undefined;
      if (upstreamProvider) lastUpstreamProvider = upstreamProvider;
      lastInputTokens = responseUsage.inputTokens;
      const contextUtilization = usableInputTokens > 0 ? responseUsage.inputTokens / usableInputTokens : 1;
      if (contextUtilization > contextUtilizationHighWater) {
        contextUtilizationHighWater = contextUtilization;
        contextHighWaterRequest = responseCount;
      }
      mergeUsage(usage, response.usage, startedAt, modelId);
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      const parallelToolViolation = calls.length > 1;
      const modelCompletedAt = new Date().toISOString();
      await input.onEvents?.([runEvent({
        id: modelIdValue, kind: "model_request", name: "responses.create", status: "succeeded", turnIndex,
        startedAt: turnStartedAt, completedAt: modelCompletedAt, ...usageFields(responseUsage, route, response),
        summary: {
          outputItems: response.output.length,
          functionCalls: calls.length,
          toolNames: calls.map((call) => call.name),
          noToolResponse: calls.length === 0,
          parallelToolViolation,
          upstreamChanged,
          previousUpstreamProvider,
          upstreamProvider,
          contextWindowTokens: providerCapability.descriptor.contextWindowTokens,
          maxOutputTokens,
          usableInputTokens,
          inputCapacityUtilization: contextUtilization,
          contextUtilizationHighWater,
          transportRetries,
          ...promptTelemetry
        },
        payload: modelTurnPayload(requestHistory, response, websiteManagerPromptIdentity, route, {
          promptTelemetry,
          briefProvenance,
          providerCapabilities: providerCapability.descriptor,
          providerCapabilityCheck: providerCapability.check
        })
      })]);
      await input.onUsage?.({ usage: { ...usage }, responseUsage, responseIndex: responseCount, apiProvider, modelId });
      if (contextUtilization >= 0.8 && !contextWarningEmitted) {
        contextWarningEmitted = true;
        const warningAt = new Date().toISOString();
        await input.onEvents?.([runEvent({
          id: eventId("context"),
          kind: "model_request",
          name: "context.capacity.warning",
          status: "succeeded",
          turnIndex,
          apiProvider,
          modelId,
          startedAt: warningAt,
          completedAt: warningAt,
          summary: {
            inputTokens: responseUsage.inputTokens,
            contextWindowTokens: providerCapability.descriptor.contextWindowTokens,
            maxOutputTokens,
            usableInputTokens,
            inputCapacityUtilization: contextUtilization,
            requestIndex: responseCount
          }
        })]);
      }
      if (responseUsage.costSource === "unavailable") {
        throw new SiteAuthoringTerminalError(
          "cost_telemetry_unavailable",
          "platform",
          false,
          `cost_telemetry_unavailable:${apiProvider}:${modelId}`
        );
      }
      if (parallelToolViolation) parallelToolViolations += 1;

      if (!calls.length) {
        noToolResponses += 1;
        history.noteNoToolResponse({
          responseItems: [
            ...response.output as ResponseInputItem[],
            { role: "user", type: "message", content: [{ type: "input_text", text: "Continue the website task using the available workspace tools." }] }
          ],
          responseIndex: responseCount
        });
        await input.onEvents?.([runEvent({ id: turnId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "succeeded", turnIndex, startedAt: turnStartedAt, completedAt: new Date().toISOString(), summary: { functionCalls: 0 } })]);
        continue;
      }

      const deferAfterFirst = calls.length > 1 && calls.some((call) => !isReadOnlyToolName(call.name));
      for (const [callIndex, rawCall] of calls.entries()) {
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
        const deferred = deferAfterFirst && callIndex > 0;
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
          } else if (deferred) {
            status = "failed";
            execution = resultForDeferredToolCall(rawCall.call_id, name);
            replayedCalls.set(rawCall.call_id, { inputHash, result: execution, status });
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
        const workspaceMutated = workspaceHashBefore !== workspaceHashAfter
          || (toolName === "create_image" && status === "succeeded" && execution.diagnosticOutput.ok !== false);
        const unchangedRereadsBefore = history.unchangedPathRereads();
        const functionOutput: ResponseInputItem = {
          type: "function_call_output",
          call_id: rawCall.call_id,
          output: execution.modelOutput as never
        };
        history.noteTool({
          responseItems: response.output as ResponseInputItem[],
          includeResponseItems: callIndex === 0,
          functionOutput,
          responseIndex: responseCount,
          callId: rawCall.call_id,
          toolName: name ?? "list_files",
          status,
          arguments: parsedArguments,
          diagnostic: execution.diagnosticOutput,
          workspaceHashBefore,
          workspaceHashAfter,
          workspaceMutated
        });
        toolCallCounts.set(toolName, (toolCallCounts.get(toolName) ?? 0) + 1);
        if (
          (
            toolName === "build_preview"
            || (toolName === "finish" && execution.diagnosticOutput.buildPerformed === true)
          )
          && execution.diagnosticOutput.failureStage !== "compilation"
          && firstSuccessfulBuildMs === undefined
        ) {
          firstSuccessfulBuildMs = Date.now() - startedAt;
        }
        await input.onEvents?.([runEvent({
          id: toolEventId, kind: managerOperationKind(toolName), name: toolName, status, turnIndex,
          startedAt: started, completedAt: toolRecord.completedAt,
          ...(metering ? toolMeteringFields(metering) : {}),
          errorCode: status === "failed" ? diagnosticErrorCode(execution.diagnosticOutput.error ?? "tool_failed") : undefined,
          summary: {
            callId: rawCall.call_id,
            inputHash,
            outputHash,
            ok: execution.diagnosticOutput.ok,
            replayed,
            unchangedPathReread: history.unchangedPathRereads() > unchangedRereadsBefore,
            providerCapabilityViolation: parallelToolViolation,
            deferred
          },
          payload: {
            arguments: parsedArguments,
            modelResult: readableModelResult(execution.modelOutput),
            diagnosticResult: execution.diagnosticOutput,
            metering: metering ? { apiProvider: metering.apiProvider, modelId: metering.modelId, usage: metering.usage } : undefined
          }
        })]);
        await input.onProgress?.({ toolRecord, usage: { ...usage, durationMs: Date.now() - startedAt }, responseUsage, responseIndex: responseCount, apiProvider, modelId });
        if (terminalError) throw terminalError;
        if (!deferred && (workspaceMutated || (isReleaseTool(toolName) && status === "succeeded"))) {
          consecutiveFailureFingerprint = undefined;
          consecutiveIdenticalFailures = 0;
        } else if (!deferred && isReleaseTool(toolName) && status === "failed") {
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
            responses: responseCount,
            telemetry: {
              firstSuccessfulBuildMs,
              modelRequests: responseCount,
              noToolResponses,
              toolCalls: Object.fromEntries([...toolCallCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
              unchangedPathRereads: history.unchangedPathRereads(),
              parallelToolViolations,
              upstreamChanges,
              contextWindowTokens: providerCapability.descriptor.contextWindowTokens,
              maxOutputTokens,
              usableInputTokens,
              contextUtilizationHighWater,
              contextHighWaterRequest
            }
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
    const providerCapability = await establishProviderAuthoringCapabilities(apiProvider, modelId, {
      loadOpenRouterCatalog: this.openRouterCatalogLoader
    });
    const result = await structuredResponse({
      client: this.injectedClient ?? configuredResponsesClient(providerCapability.descriptor),
      route,
      providerCapabilities: providerCapability.descriptor,
      name: "manager_discussion",
      schema: managerDiscussionJsonSchema,
      system: websiteManagerSystemPrompt,
      content: [{ type: "input_text", text: JSON.stringify(createManagerDiscussionBrief(input)) }],
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
  providerCapabilities: ProviderAuthoringCapabilities;
  name: string;
  schema: Record<string, unknown>;
  system: string;
  content: Array<Record<string, unknown>>;
  maxOutputTokens: number;
  signal?: AbortSignal;
}) {
  const startedAt = Date.now();
  const response = await createWithTransportRetry(input.client, routedResponseParams({
    model: input.route.modelId, instructions: input.system,
    input: [{ role: "user", type: "message", content: input.content as never }],
    store: false, parallel_tool_calls: false, reasoning: { effort: siteAgentReasoningEffort },
    text: { verbosity: siteAgentTextVerbosity, format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } },
    max_output_tokens: input.maxOutputTokens
  }, input.providerCapabilities), {
    signal: input.signal,
    modelId: input.route.modelId
  });
  if (!response.output_text) throw new Error("Website manager response did not contain structured output text.");
  return { value: JSON.parse(response.output_text) as unknown, usage: usageForModel(input.route.modelId, response.usage, Date.now() - startedAt) };
}

function configuredResponsesClient(capabilities: ProviderAuthoringCapabilities): ManagerResponsesClient {
  const apiProvider = capabilities.apiProvider;
  const apiKey = apiProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(`${apiProvider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} is required for website manager runs.`);
  const origin = configuredAppOrigin();
  if (capabilities.transport === "openrouter_anthropic_messages") {
    return openRouterAnthropicMessagesClient({
      apiKey,
      headers: openRouterRequestHeaders(capabilities, origin)
    });
  }
  const client = new OpenAI({
    apiKey,
    baseURL: apiProvider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined,
    maxRetries: 0,
    timeout: siteAgentRunGuardrailDefaults.initial_build.deadlineMs,
    defaultHeaders: apiProvider === "openrouter"
      ? openRouterRequestHeaders(capabilities, origin)
      : undefined
  });
  return { create: (params, options) => client.responses.create(params, options) };
}

export function openRouterRequestHeaders(
  capabilities: ProviderAuthoringCapabilities,
  origin?: string
): Record<string, string> {
  if (capabilities.apiProvider !== "openrouter") return {};
  return {
    ...(origin ? { "HTTP-Referer": origin } : {}),
    "X-OpenRouter-Title": "Lodesta",
    "X-OpenRouter-Metadata": "enabled",
    ...(capabilities.strictToolStrategy === "anthropic_beta_strict_tools"
      ? { "x-anthropic-beta": "structured-outputs-2025-11-13" }
      : {})
  };
}

export function projectToolsForProvider(
  tools: Tool[],
  capabilities: ProviderAuthoringCapabilities
): Tool[] {
  if (capabilities.strictToolStrategy !== "anthropic_beta_strict_tools") return tools;
  return tools.map((value) => {
    if (value.type !== "function") return value;
    return {
      ...value,
      parameters: anthropicStrictSchema(value.parameters)
    };
  }) as Tool[];
}

function anthropicStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anthropicStrictSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const constraintGuidance = anthropicConstraintGuidance(source);
  const result = Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !anthropicUnsupportedSchemaKeywords.has(key))
      .map(([key, nested]) => [key, anthropicStrictSchema(nested)])
  );
  if (constraintGuidance.length) {
    result.description = [
      typeof source.description === "string" ? source.description : undefined,
      ...constraintGuidance
    ].filter(Boolean).join(" ");
  }
  return result;
}

const anthropicUnsupportedSchemaKeywords = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties"
]);

function anthropicConstraintGuidance(value: Record<string, unknown>) {
  const guidance: string[] = [];
  if (typeof value.pattern === "string") guidance.push(`Must match ${value.pattern}.`);
  if (typeof value.minimum === "number") guidance.push(`Minimum: ${value.minimum}.`);
  if (typeof value.maximum === "number") guidance.push(`Maximum: ${value.maximum}.`);
  if (typeof value.exclusiveMinimum === "number") guidance.push(`Must be greater than ${value.exclusiveMinimum}.`);
  if (typeof value.exclusiveMaximum === "number") guidance.push(`Must be less than ${value.exclusiveMaximum}.`);
  if (typeof value.minLength === "number") guidance.push(`Minimum length: ${value.minLength}.`);
  if (typeof value.maxLength === "number") guidance.push(`Maximum length: ${value.maxLength}.`);
  if (typeof value.minItems === "number") guidance.push(`Minimum items: ${value.minItems}.`);
  if (typeof value.maxItems === "number") guidance.push(`Maximum items: ${value.maxItems}.`);
  return guidance;
}

function selectedSiteAgentRoute(configuredProvider: SiteAgentApiProvider, configuredModelId: string) {
  const apiProvider = siteAgentApiProviderSchema.safeParse(process.env.LODESTA_SITE_AGENT_PROVIDER?.trim() || configuredProvider);
  if (!apiProvider.success) {
    throw new SiteAuthoringTerminalError("unknown_internal_failure", "platform", false, "site_agent_api_provider_invalid");
  }
  const modelId = process.env.LODESTA_SITE_AGENT_MODEL?.trim() || configuredModelId;
  return validatedSiteAgentRoute(apiProvider.data, modelId);
}

async function configuredSiteAgentRoute() {
  const settings = await getSiteAuthoringModelSettings();
  return selectedSiteAgentRoute(settings.settings.siteAgentProvider, settings.settings.siteAgentModel);
}

function validatedSiteAgentRoute(apiProvider: SiteAgentApiProvider, modelId: string) {
  if (apiProvider === "openai" && !isSupportedSiteAgentModel(modelId)) {
    throw new SiteAuthoringTerminalError(
      "unknown_internal_failure",
      "platform",
      false,
      `site_agent_model_pricing_missing:${modelId}`
    );
  }
  if (apiProvider === "openrouter" && !isEstablishedOpenRouterAuthoringRoute(modelId)) {
    throw new SiteAuthoringTerminalError(
      "unknown_internal_failure",
      "platform",
      false,
      `provider_authoring_capabilities_missing:${apiProvider}:${modelId}`
    );
  }
  return { apiProvider, modelId };
}

function routedResponseParams(
  params: ResponseCreateParamsNonStreaming,
  capabilities: ProviderAuthoringCapabilities,
  sessionId?: string
) {
  if (capabilities.apiProvider !== "openrouter") return params;
  const {
    include: _include,
    prompt_cache_key: _promptCacheKey,
    prompt_cache_options: _promptCacheOptions,
    ...portableParams
  } = params;
  return {
    ...portableParams,
    provider: {
      only: capabilities.eligibleZdrUpstreams,
      allow_fallbacks: true,
      data_collection: "deny",
      zdr: true
    },
    ...(sessionId ? { session_id: sessionId.slice(0, 256) } : {})
  } as ResponseCreateParamsNonStreaming;
}

async function createWithTransportRetry(
  client: ManagerResponsesClient,
  params: ResponseCreateParamsNonStreaming,
  options: {
    signal?: AbortSignal;
    modelId: string;
    onRetry?: (retry: { attempt: number; delayMs: number; status?: number }) => void;
  }
) {
  const maximumAttempts = options.modelId === "moonshotai/kimi-k3" ? 4 : 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const response = await client.create(params, options.signal ? { signal: options.signal } : undefined);
      if (response.status === "failed") throw new Error(response.error?.message ?? "manager_model_failed");
      if (response.status === "incomplete") throw new Error(`manager_model_incomplete:${response.incomplete_details?.reason ?? "unknown"}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= maximumAttempts || options.signal?.aborted || !transientTransportError(error)) throw error;
      const delayMs = transportRetryDelayMs(error, attempt, options.modelId);
      options.onRetry?.({ attempt: attempt + 1, delayMs, status: transportStatus(error) });
      await abortableDelay(delayMs, options.signal);
    }
  }
  throw lastError;
}

function transportRetryDelayMs(error: unknown, attempt: number, modelId: string) {
  const status = transportStatus(error);
  if (status === 429) {
    const retryAfter = retryAfterMs(error);
    if (retryAfter !== undefined) return Math.min(retryAfter, 60_000);
    if (modelId === "moonshotai/kimi-k3") return [5_000, 15_000, 30_000][attempt] ?? 30_000;
  }
  if (modelId === "moonshotai/kimi-k3" && status !== undefined && status >= 500) {
    return [2_000, 5_000, 15_000][attempt] ?? 15_000;
  }
  return 1_000;
}

function retryAfterMs(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const response = record.response && typeof record.response === "object"
    ? record.response as Record<string, unknown>
    : undefined;
  const value = headerValue(record.headers, "retry-after") ?? headerValue(response?.headers, "retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function headerValue(headers: unknown, name: string) {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (!headers || typeof headers !== "object") return undefined;
  const value = Object.entries(headers as Record<string, unknown>)
    .find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function transportStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function abortableDelay(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("transport_retry_aborted"));
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function transientTransportError(error: unknown) {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number") return status === 408 || status === 409 || status === 429 || status >= 500;
  return error instanceof TypeError
    || /timeout|timed out|connection|socket|network|unexpected end of json input|unterminated json|invalid json response/i.test(boundedError(error));
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

function isReleaseTool(name: string): name is "build_preview" | "finish" {
  return name === "build_preview" || name === "finish";
}

function releaseFailureFingerprint(
  toolName: "build_preview" | "finish",
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

function isReadOnlyToolName(value: string) {
  return value === "list_files" || value === "search_files" || value === "read_files";
}

function resultForDeferredToolCall(callId: string, name: string): ManagerToolExecution {
  const value = {
    ok: false,
    error: "deferred_due_to_serial_tool_contract",
    callId,
    toolName: name,
    guidance: "The provider returned multiple calls despite serial execution. This call was not executed; issue it again alone if it is still needed."
  };
  return { modelOutput: JSON.stringify(value), diagnosticOutput: value };
}

function cacheKey(input: Pick<ManagerRunRequest, "runId" | "buildInput">) {
  return sha256(stableJson({
    schemaVersion: 1,
    purpose: "site-authoring",
    run: input.runId ?? input.buildInput.id
  })).slice("sha256:".length);
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
  target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0);
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
    cacheWriteTokens: metering.usage.cacheWriteTokens,
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
    cacheWriteTokens: usage.cacheWriteTokens,
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

function withRollingPromptCacheBreakpoint(items: ResponseInputItem[]) {
  if (!items.length) return items;
  const last = items.at(-1);
  if (!last || last.type !== "message" || !Array.isArray(last.content)) return items;
  let marked = false;
  const content = [...last.content].reverse().map((block) => {
    if (marked || block.type !== "input_text") return block;
    marked = true;
    return {
      ...block,
      prompt_cache_breakpoint: { mode: "explicit" as const }
    };
  }).reverse();
  if (!marked) return items;
  return [
    ...items.slice(0, -1),
    { ...last, content }
  ] as ResponseInputItem[];
}

function modelTurnPayload(
  history: ResponseInputItem[],
  response: ManagerResponse | undefined,
  promptIdentity: string,
  route: { apiProvider: SiteAgentApiProvider; modelId: string },
  telemetry: Record<string, unknown>
) {
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
      textVerbosity: siteAgentTextVerbosity,
      ...telemetry
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

export const websiteManagerTools: Tool[] = [
  tool("list_files", "List every current source file with its hash and size.", { type: "object", additionalProperties: false, properties: {}, required: [] }),
  tool("search_files", "Find literal text across the workspace. Pass an empty paths array to search every source file.", {
    type: "object", additionalProperties: false, required: ["query", "paths", "caseSensitive"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 500 },
      paths: { type: "array", minItems: 0, maxItems: 20, items: sourcePathSchema },
      caseSensitive: { type: "boolean" }
    }
  }),
  tool("read_files", "Read one or more source files, each optionally by line window.", {
    type: "object", additionalProperties: false, required: ["files"],
    properties: {
      files: {
        type: "array", minItems: 1, maxItems: 20,
        items: {
          type: "object", additionalProperties: false, required: ["path", "startLine", "endLine"],
          properties: { path: sourcePathSchema, startLine: { type: ["integer", "null"], minimum: 1 }, endLine: { type: ["integer", "null"], minimum: 1 } }
        }
      }
    }
  }),
  tool("apply_patch", "Atomically create, replace, or delete one or more complete source files. Use null content to delete a file.", {
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
  tool("inspect_site", "Optionally inspect a current successful build visually in Lodesta's browser. Returns screenshots and visual observations only; it never runs hard release verification.", { type: "object", additionalProperties: false, properties: {}, required: [] }),
  tool("finish", "Finish when the workspace is ready. This automatically builds dirty or unbuilt source and checks only technical release safety and operability.", {
    type: "object", additionalProperties: false, required: ["ownerMessage"],
    properties: { ownerMessage: { type: "string", minLength: 1, maxLength: 1200 } }
  })
];

function tool(name: string, description: string, parameters: Record<string, unknown>): Tool { return { type: "function", name, description, parameters, strict: true }; }

const managerDiscussionJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "response", "proposedAction", "requiresApply"],
  properties: { schemaVersion: { type: "string", const: "manager-discussion" }, response: { type: "string" }, proposedAction: { type: ["string", "null"] }, requiresApply: { type: "boolean" } }
};
