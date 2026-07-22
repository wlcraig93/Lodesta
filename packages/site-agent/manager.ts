import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseFunctionToolCall, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { getAgentModelSettings } from "@/lib/operator-settings";
import { sha256, stableJson } from "@/packages/business-data";
import { sitePlanV1Schema, type SiteElementSelectionV1, type SitePlanV1, type SitePublicBuildInputV3 } from "@/packages/site-contracts";
import {
  managerCandidateCritiqueSchema,
  managerCompletionV3Schema,
  managerDiscussionSchema,
  managerEditPreflightSchema,
  managerToolArguments,
  managerToolNameSchema,
  type ManagerCompletionV3,
  type ManagerModelUsageV1,
  type ManagerRunLimitsV3,
  type ManagerRunRequestV3,
  type ManagerToolExecutionV3,
  type ManagerToolRuntimeV3,
  type ManagerToolTraceV3,
  type ManagerTraceEventV1,
  type WorkspaceSourceFile
} from "./contracts";
import { managerBuildContext, managerEvidencePacket, websiteManagerPromptVersion, websiteManagerSystemPrompt } from "./prompts";

export type { ManagerRunRequestV3 } from "./contracts";

type ManagerResponseV3 = Pick<Response, "output" | "output_text" | "usage" | "status" | "error" | "incomplete_details">;

export interface ManagerResponsesClientV3 {
  create(params: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<ManagerResponseV3>;
}

const defaultLimits: ManagerRunLimitsV3 = {
  maxResponses: 20,
  maxToolCalls: 20,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 200_000,
  maxDurationMs: 20 * 60_000
};

export class WebsiteManagerAgent {
  constructor(private readonly injectedClient?: ManagerResponsesClientV3) {}

  async run(input: ManagerRunRequestV3 & {
    runtime: ManagerToolRuntimeV3;
    onPlanAccepted?: (plan: SitePlanV1, planningAttempt: number) => Promise<void>;
    onProgress?: (progress: { trace: ManagerToolTraceV3; usage: ManagerModelUsageV1; responseUsage: ManagerModelUsageV1; responseIndex: number; modelId: string }) => Promise<void>;
    traceParentSpanId?: string;
    onTrace?: (events: ManagerTraceEventV1[]) => Promise<void>;
  }): Promise<{
    completion: ManagerCompletionV3;
    modelId: string;
    promptVersion: string;
    usage: ManagerModelUsageV1;
    traces: ManagerToolTraceV3[];
    responses: number;
    planningAttempts: number;
    sitePlan: SitePlanV1;
  }> {
    const settings = await getAgentModelSettings();
    const modelId = process.env.LODESTA_SITE_AGENT_MODEL ?? settings.settings.siteAgentModel;
    const client = this.injectedClient ?? configuredResponsesClient();
    const limits = limitsFor(input, input.limits);
    const startedAt = Date.now();
    const usage = emptyUsage();
    const traces: ManagerToolTraceV3[] = [];
    const replayedCalls = new Map<string, { inputHash: `sha256:${string}`; result: ManagerToolExecutionV3; status: "succeeded" | "failed" }>();
    const context = managerBuildContext({
      buildInput: input.buildInput,
      verticalContext: input.buildInput.domainContext,
      instruction: input.instruction,
      kind: input.kind,
      selection: input.selection,
      objective: input.objective,
      objectiveFindings: input.objectiveFindings
    });
    const initialContext: ResponseInputItem = {
      role: "user",
      type: "message",
      content: [{ type: "input_text", text: JSON.stringify(context) }]
    };
    const planning = await establishSitePlan({
      client,
      modelId,
      initialContext,
      buildInput: input.buildInput,
      runtime: input.runtime,
      usage,
      limits,
      startedAt,
      signal: input.signal,
      onPlanAccepted: input.onPlanAccepted,
      traceParentSpanId: input.traceParentSpanId,
      onTrace: input.onTrace
    });
    traces.push(...planning.traces);
    const protocolFrames: ResponseInputItem[][] = [];
    let responseCount = 0;
    let toolCount = 0;
    let terminalFinishPending = false;

    while (responseCount < limits.maxResponses || terminalFinishPending) {
      const finishOnly = terminalFinishPending;
      terminalFinishPending = false;
      assertWithinLimits({
        limits,
        usage,
        startedAt,
        responseCount: finishOnly ? limits.maxResponses : responseCount,
        toolCount: finishOnly ? limits.maxToolCalls : toolCount
      });
      const history: ResponseInputItem[] = [
        initialContext,
        ...protocolFrames.slice(-2).flat(),
        runtimeStateMessage(input.runtime.stateSummary())
      ];
      const turnIndex = responseCount + 1;
      const turnSpanId = traceId("turn");
      const modelSpanId = traceId("model");
      const turnStartedAt = new Date().toISOString();
      const responseStartedAt = Date.now();
      await input.onTrace?.([
        traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "running", turnIndex, startedAt: turnStartedAt, summary: { historyItems: history.length } }),
        traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create", status: "running", turnIndex, modelId, startedAt: turnStartedAt, summary: { historyItems: history.length, toolChoice: finishOnly ? "finish_only" : "required", parallelToolCalls: false } })
      ]);
      let response: ManagerResponseV3;
      try {
        response = await createWithOneTransportRetry(client, {
          model: modelId,
          instructions: websiteManagerSystemPrompt,
          input: history,
          tools: finishOnly ? finishOnlyTools : workingTools,
          tool_choice: finishOnly ? { type: "function", name: "finish" } : "required",
          parallel_tool_calls: false,
          store: false,
          include: ["reasoning.encrypted_content"],
          reasoning: { effort: "high" },
          text: { verbosity: "low" },
          max_output_tokens: Math.min(64_000, Math.max(1, limits.maxOutputTokens - usage.outputTokens))
        }, boundedSignal(input.signal, limits.maxDurationMs - (Date.now() - startedAt)));
      } catch (error) {
        const completedAt = new Date().toISOString();
        const errorCode = traceErrorCode(error);
        await input.onTrace?.([
          traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create", status: "failed", turnIndex, modelId, startedAt: turnStartedAt, completedAt, errorCode, summary: { error: errorCode }, payload: modelTurnPayload(history, undefined, websiteManagerPromptVersion, finishOnly) }),
          traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "failed", turnIndex, startedAt: turnStartedAt, completedAt, errorCode, summary: { error: errorCode } })
        ]);
        throw error;
      }
      responseCount += 1;
      const responseUsage = usageFor(response.usage, Date.now() - responseStartedAt);
      mergeUsage(usage, response.usage, startedAt);
      assertWithinLimits({
        limits,
        usage,
        startedAt,
        responseCount: finishOnly ? limits.maxResponses : responseCount,
        toolCount: finishOnly ? limits.maxToolCalls : toolCount
      });
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      if (calls.length !== 1) {
        const completedAt = new Date().toISOString();
        const errorCode = `manager_tool_protocol_expected_one_call_received_${calls.length}`;
        await input.onTrace?.([
          traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create", status: "succeeded", turnIndex, modelId, startedAt: turnStartedAt, completedAt, ...usageFields(responseUsage), summary: { outputItems: response.output.length, functionCalls: calls.length }, payload: modelTurnPayload(history, response, websiteManagerPromptVersion, finishOnly) }),
          traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "failed", turnIndex, startedAt: turnStartedAt, completedAt, errorCode, summary: { functionCalls: calls.length } })
        ]);
        throw new Error(errorCode);
      }
      toolCount += 1;
      const rawCall = calls[0];
      let name;
      let parsedArguments: Record<string, unknown>;
      try {
        name = managerToolNameSchema.parse(rawCall.name);
        if (finishOnly && name !== "finish") throw new Error("manager_finish_grace_protocol_violation");
        const rawArguments = JSON.parse(rawCall.arguments) as Record<string, unknown>;
        parsedArguments = managerToolArguments[name].parse(rawArguments) as Record<string, unknown>;
      } catch (error) {
        const completedAt = new Date().toISOString();
        const errorCode = traceErrorCode(error);
        await input.onTrace?.([
          traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create", status: "succeeded", turnIndex, modelId, startedAt: turnStartedAt, completedAt, ...usageFields(responseUsage), summary: { outputItems: response.output.length, functionCalls: 1, toolName: rawCall.name, protocolError: errorCode }, payload: modelTurnPayload(history, response, websiteManagerPromptVersion, finishOnly) }),
          traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "failed", turnIndex, startedAt: turnStartedAt, completedAt, errorCode, summary: { toolName: rawCall.name, protocolError: errorCode } })
        ]);
        throw error;
      }
      const inputHash = sha256(stableJson({ name, arguments: parsedArguments }));
      const started = new Date().toISOString();
      const toolSpanId = traceId("tool");
      const operationKind = name === "build_preview" ? "build" : name === "inspect_candidate" ? "inspection" : undefined;
      const operationSpanId = operationKind ? traceId(operationKind) : undefined;
      await input.onTrace?.([
        traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create", status: "succeeded", turnIndex, modelId, startedAt: turnStartedAt, completedAt: started, ...usageFields(responseUsage), summary: { outputItems: response.output.length, functionCalls: 1, toolName: name, finishOnly }, payload: modelTurnPayload(history, response, websiteManagerPromptVersion, finishOnly) }),
        traceEvent({ id: toolSpanId, parentSpanId: turnSpanId, kind: "tool_call", name, status: "running", turnIndex, startedAt: started, summary: { callId: rawCall.call_id, inputHash } }),
        ...(operationKind && operationSpanId ? [traceEvent({ id: operationSpanId, parentSpanId: toolSpanId, kind: operationKind, name, status: "running", turnIndex, startedAt: started, summary: { workspaceOperation: name } })] : [])
      ]);
      let execution: ManagerToolExecutionV3;
      let status: "succeeded" | "failed" = "succeeded";
      let terminalRuntimeError: unknown;
      const replay = replayedCalls.get(rawCall.call_id);
      if (replay) {
        if (replay.inputHash !== inputHash) {
          terminalRuntimeError = new Error(`manager_call_id_reused_with_different_input:${rawCall.call_id}`);
          status = "failed";
          execution = {
            modelOutput: JSON.stringify({ ok: false, error: boundedError(terminalRuntimeError) }),
            traceOutput: { ok: false, error: boundedError(terminalRuntimeError) }
          };
        } else {
          execution = replay.result;
          status = replay.status;
        }
      } else {
        try {
          execution = await input.runtime.execute({ callId: rawCall.call_id, name, arguments: parsedArguments });
          if (execution.traceOutput.ok === false) status = "failed";
        } catch (error) {
          status = "failed";
          if (isTerminalRuntimeError(error)) terminalRuntimeError = error;
          execution = {
            modelOutput: JSON.stringify({ ok: false, error: boundedError(error) }),
            traceOutput: { ok: false, error: boundedError(error) }
          };
        }
        replayedCalls.set(rawCall.call_id, { inputHash, result: execution, status });
      }
      const outputHash = sha256(stableJson(execution.traceOutput));
      const trace: ManagerToolTraceV3 = {
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
      const completedAt = trace.completedAt;
      await input.onTrace?.([
        ...(operationKind && operationSpanId ? [traceEvent({ id: operationSpanId, parentSpanId: toolSpanId, kind: operationKind, name, status, turnIndex, startedAt: started, completedAt, errorCode: status === "failed" ? traceErrorCode(execution.traceOutput.error ?? "tool_failed") : undefined, summary: execution.traceOutput })] : []),
        traceEvent({ id: toolSpanId, parentSpanId: turnSpanId, kind: "tool_call", name, status, turnIndex, startedAt: started, completedAt, errorCode: status === "failed" ? traceErrorCode(execution.traceOutput.error ?? "tool_failed") : undefined, summary: { callId: rawCall.call_id, inputHash, outputHash, ok: execution.traceOutput.ok }, payload: { arguments: parsedArguments, modelResult: readableModelResult(execution.modelOutput), traceResult: execution.traceOutput } }),
        traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.turn.${turnIndex}`, status: "succeeded", turnIndex, startedAt: turnStartedAt, completedAt, summary: { toolName: name, toolStatus: status, workspaceHash: execution.traceOutput.workspaceHash } })
      ]);
      await input.onProgress?.({ trace, usage: { ...usage, durationMs: Date.now() - startedAt }, responseUsage, responseIndex: responseCount, modelId });
      if (terminalRuntimeError) throw terminalRuntimeError;
      const callOutput: ResponseInputItem = {
        type: "function_call_output",
        call_id: rawCall.call_id,
        output: execution.modelOutput as never
      };
      protocolFrames.push([...(response.output as ResponseInputItem[]), callOutput]);
      if (execution.completion) {
        return {
          completion: managerCompletionV3Schema.parse(execution.completion),
          modelId,
          promptVersion: websiteManagerPromptVersion,
          usage: { ...usage, durationMs: Date.now() - startedAt },
          traces,
          responses: responseCount,
          planningAttempts: planning.attempts,
          sitePlan: planning.plan
        };
      }
      if (finishOnly) throw new Error("manager_finish_grace_not_completed");
      terminalFinishPending = responseCount === limits.maxResponses && name === "inspect_candidate" && status === "succeeded";
    }
    throw new Error("manager_response_limit_exhausted");
  }

  async discuss(input: {
    buildInput: SitePublicBuildInputV3;
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
        publicEvidencePacket: managerEvidencePacket(input.buildInput),
        verticalContext: input.buildInput.domainContext,
        currentWorkspace: input.currentFiles?.length ? { files: input.currentFiles } : undefined
      }) }],
      signal: input.signal,
      maxOutputTokens: 2500
    });
    return { discussion: managerDiscussionSchema.parse(result.value), modelId, usage: result.usage };
  }

  async preflightEdit(input: {
    instruction: string;
    selection?: ManagerRunRequestV3["selection"];
    routes: string[];
    capabilityIds: string[];
    formBindings: Array<{ id: string; route: string }>;
    signal?: AbortSignal;
  }) {
    const settings = await getAgentModelSettings();
    const modelId = process.env.LODESTA_SITE_PREFLIGHT_MODEL ?? process.env.LODESTA_SITE_AGENT_MODEL ?? settings.settings.siteAgentModel;
    const result = await structuredResponse({
      client: this.injectedClient ?? configuredResponsesClient(),
      modelId,
      name: "manager_edit_preflight_v1",
      schema: managerEditPreflightJsonSchema,
      system: "Classify a requested website edit without designing or editing the site. Ask one concise clarification only when the requested outcome is genuinely ambiguous. Never invent a route slug or exact selector the owner did not specify.",
      content: [{ type: "input_text", text: JSON.stringify({ instruction: input.instruction, selection: input.selection, existingRoutes: input.routes, capabilityIds: input.capabilityIds, formBindings: input.formBindings }) }],
      signal: input.signal,
      maxOutputTokens: 1200,
      reasoningEffort: "low"
    });
    return { preflight: managerEditPreflightSchema.parse(result.value), modelId, usage: result.usage };
  }

  async critiqueCandidate(input: {
    buildInput: SitePublicBuildInputV3;
    visualThesis: string;
    contentArchitecture: string;
    taskInstruction: string;
    taskKind: ManagerRunRequestV3["kind"];
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
      business: { name: input.buildInput.business.name, intent: managerEvidencePacket(input.buildInput).intent },
      visualThesis: input.visualThesis,
      contentArchitecture: input.contentArchitecture,
      task: { kind: input.taskKind, instruction: input.taskInstruction },
      routes: input.routes,
      findingRouteRule: "Every finding.route must exactly equal one of the supplied route paths."
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

async function establishSitePlan(input: {
  client: ManagerResponsesClientV3;
  modelId: string;
  initialContext: ResponseInputItem;
  buildInput: SitePublicBuildInputV3;
  runtime: ManagerToolRuntimeV3;
  usage: ManagerModelUsageV1;
  limits: ManagerRunLimitsV3;
  startedAt: number;
  signal?: AbortSignal;
  onPlanAccepted?: (plan: SitePlanV1, planningAttempt: number) => Promise<void>;
  traceParentSpanId?: string;
  onTrace?: (events: ManagerTraceEventV1[]) => Promise<void>;
}) {
  const traces: ManagerToolTraceV3[] = [];
  let feedback = "Call set_site_plan with the complete evidence-bound plan before reading or changing workspace files.";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    assertWithinLimits({ limits: input.limits, usage: input.usage, startedAt: input.startedAt, responseCount: 0, toolCount: 0 });
    const turnStartedAt = new Date().toISOString();
    const turnSpanId = traceId("planning_turn");
    const modelSpanId = traceId("planning_model");
    const history: ResponseInputItem[] = [
      input.initialContext,
      { role: "user", type: "message", content: [{ type: "input_text", text: feedback }] }
    ];
    await input.onTrace?.([
      traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.planning.${attempt}`, status: "running", turnIndex: attempt, startedAt: turnStartedAt, summary: { planningAttempt: attempt } }),
      traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create.plan", status: "running", turnIndex: attempt, modelId: input.modelId, startedAt: turnStartedAt, summary: { planningAttempt: attempt, toolChoice: "set_site_plan" } })
    ]);
    const responseStartedAt = Date.now();
    let response: ManagerResponseV3 | undefined;
    try {
      response = await createWithOneTransportRetry(input.client, {
        model: input.modelId,
        instructions: websiteManagerSystemPrompt,
        input: history,
        tools: planningTools,
        tool_choice: { type: "function", name: "set_site_plan" },
        parallel_tool_calls: false,
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: "high" },
        text: { verbosity: "low" },
        max_output_tokens: Math.min(16_000, Math.max(1, input.limits.maxOutputTokens - input.usage.outputTokens))
      }, boundedSignal(input.signal, input.limits.maxDurationMs - (Date.now() - input.startedAt)));
      const responseUsage = usageFor(response.usage, Date.now() - responseStartedAt);
      mergeUsage(input.usage, response.usage, input.startedAt);
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
      if (calls.length !== 1 || calls[0].name !== "set_site_plan") {
        throw new Error(`manager_site_plan_expected_one_call_received_${calls.length}`);
      }
      const rawCall = calls[0];
      const parsed = managerToolArguments.set_site_plan.parse(JSON.parse(rawCall.arguments));
      const plan = sitePlanV1Schema.parse({ schemaVersion: "site-plan-v1", ...parsed });
      validateSitePlan(plan, input.buildInput);
      input.runtime.acceptPlan(plan);
      await input.onPlanAccepted?.(plan, attempt);
      const inputHash = sha256(stableJson({ name: "set_site_plan", arguments: parsed }));
      const trace: ManagerToolTraceV3 = {
        callId: rawCall.call_id,
        name: "set_site_plan",
        inputHash,
        outputHash: sha256(stableJson({ ok: true, planHash: sha256(stableJson(plan)) })),
        status: "succeeded",
        startedAt: turnStartedAt,
        completedAt: new Date().toISOString(),
        output: { ok: true, planHash: sha256(stableJson(plan)), planningAttempt: attempt }
      };
      traces.push(trace);
      await input.onTrace?.([
        traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create.plan", status: "succeeded", turnIndex: attempt, modelId: input.modelId, startedAt: turnStartedAt, completedAt: trace.completedAt, ...usageFields(responseUsage), summary: { planningAttempt: attempt, toolName: "set_site_plan" }, payload: modelTurnPayload(history, response, websiteManagerPromptVersion) }),
        traceEvent({ id: traceId("planning_tool"), parentSpanId: turnSpanId, kind: "tool_call", name: "set_site_plan", status: "succeeded", turnIndex: attempt, startedAt: turnStartedAt, completedAt: trace.completedAt, summary: trace.output }),
        traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.planning.${attempt}`, status: "succeeded", turnIndex: attempt, startedAt: turnStartedAt, completedAt: trace.completedAt, summary: { planningAttempt: attempt, planHash: trace.output.planHash } })
      ]);
      return { plan, attempts: attempt, traces };
    } catch (error) {
      const message = boundedError(error);
      const completedAt = new Date().toISOString();
      feedback = `The prior plan was rejected: ${message}. Submit one corrected complete set_site_plan call.`;
      await input.onTrace?.([
        traceEvent({ id: modelSpanId, parentSpanId: turnSpanId, kind: "model_request", name: "responses.create.plan", status: "failed", turnIndex: attempt, modelId: input.modelId, startedAt: turnStartedAt, completedAt, errorCode: traceErrorCode(error), summary: { planningAttempt: attempt, error: message }, payload: modelTurnPayload(history, response, websiteManagerPromptVersion) }),
        traceEvent({ id: turnSpanId, parentSpanId: input.traceParentSpanId, kind: "turn", name: `manager.planning.${attempt}`, status: "failed", turnIndex: attempt, startedAt: turnStartedAt, completedAt, errorCode: traceErrorCode(error), summary: { planningAttempt: attempt, error: message } })
      ]);
      if (attempt === 2) throw new Error(`manager_site_plan_rejected:${message}`);
    }
  }
  throw new Error("manager_site_plan_rejected");
}

function validateSitePlan(plan: SitePlanV1, buildInput: SitePublicBuildInputV3) {
  const plannedPaths = new Set(plan.routes.map((route) => normalizePlanPath(route.path)));
  for (const requirement of buildInput.intent.pageRequirements.filter((page) => page.required)) {
    const requiredPath = requirement.slug ? `/${requirement.slug}` : "/";
    if (!plannedPaths.has(requiredPath)) throw new Error(`site_plan_missing_required_route:${requiredPath}`);
  }
  const factIds = new Set(buildInput.publicFacts.map((fact) => fact.id));
  const offeringIds = new Set(buildInput.business.offerings.map((offering) => offering.id));
  const capabilities = new Set(buildInput.intent.enabledCapabilities);
  for (const route of plan.routes) {
    for (const factId of route.sourceFactIds) if (!factIds.has(factId)) throw new Error(`site_plan_unknown_source_fact:${factId}`);
    for (const offeringId of route.offeringIds) if (!offeringIds.has(offeringId)) throw new Error(`site_plan_unknown_offering:${offeringId}`);
    for (const capability of route.capabilities) if (!capabilities.has(capability)) throw new Error(`site_plan_disabled_capability:${capability}`);
    if (route.purpose === "service" && (route.offeringIds.length === 0 || route.sourceFactIds.length === 0)) {
      throw new Error(`site_plan_service_requires_evidence:${route.path}`);
    }
  }
}

function normalizePlanPath(path: string) {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}` : "/";
}

async function structuredResponse(input: {
  client: ManagerResponsesClientV3;
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
    model: input.modelId,
    instructions: input.system,
    input: [{ role: "user", type: "message", content: input.content as never }],
    store: false,
    parallel_tool_calls: false,
    reasoning: { effort: input.reasoningEffort ?? "high" },
    text: { verbosity: "low", format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } },
    max_output_tokens: input.maxOutputTokens
  }, boundedSignal(input.signal, 10 * 60_000));
  if (!response.output_text) throw new Error("Website manager response did not contain structured output text.");
  return { value: JSON.parse(response.output_text) as unknown, usage: usageFor(response.usage, Date.now() - startedAt) };
}

function configuredResponsesClient(): ManagerResponsesClientV3 {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for website manager runs.");
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 10 * 60_000 });
  return { create: (params, options) => client.responses.create(params, options) };
}

async function createWithOneTransportRetry(
  client: ManagerResponsesClientV3,
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

function limitsFor(input: ManagerRunRequestV3, override?: Partial<ManagerRunLimitsV3>): ManagerRunLimitsV3 {
  const base = { ...defaultLimits, maxDurationMs: input.kind === "initial_build" ? 20 * 60_000 : 10 * 60_000 };
  return { ...base, ...override };
}

function assertWithinLimits(input: { limits: ManagerRunLimitsV3; usage: ManagerModelUsageV1; startedAt: number; responseCount: number; toolCount: number }) {
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
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 };
}

function mergeUsage(target: ManagerModelUsageV1, value: Response["usage"], startedAt: number) {
  const next = usageFor(value, Date.now() - startedAt);
  target.inputTokens += next.inputTokens;
  target.cachedInputTokens += next.cachedInputTokens;
  target.outputTokens += next.outputTokens;
  target.estimatedCostUsd += next.estimatedCostUsd;
  target.costEstimateStatus = target.costEstimateStatus === "configured" && next.costEstimateStatus === "configured" ? "configured" : next.costEstimateStatus;
  target.durationMs = Date.now() - startedAt;
}

function usageFor(value: Response["usage"], durationMs: number): ManagerModelUsageV1 {
  const inputTokens = value?.input_tokens ?? 0;
  const cachedInputTokens = value?.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = value?.output_tokens ?? 0;
  const inputPrice = Number(process.env.LODESTA_MODEL_INPUT_USD_PER_MILLION);
  const outputPrice = Number(process.env.LODESTA_MODEL_OUTPUT_USD_PER_MILLION);
  const configured = Number.isFinite(inputPrice) && inputPrice > 0 && Number.isFinite(outputPrice) && outputPrice > 0;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    estimatedCostUsd: configured ? (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000 : 0,
    costEstimateStatus: configured ? "configured" : "unavailable",
    durationMs
  };
}

function traceEvent(event: ManagerTraceEventV1) { return event; }
function traceId(prefix: string) { return `${prefix}_${Date.now().toString(36)}${randomUUID().replaceAll("-", "")}`; }
function usageFields(usage: ManagerModelUsageV1) {
  return { inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens };
}

function dataUrl(bytes: Buffer) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 4000 ? `${message.slice(0, 3980)}... [truncated]` : message;
}

function traceErrorCode(error: unknown) {
  const message = typeof error === "string" ? error : boundedError(error);
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function readableModelResult(value: ManagerToolExecutionV3["modelOutput"]) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function runtimeStateMessage(summary: Record<string, unknown>): ResponseInputItem {
  return {
    role: "user",
    type: "message",
    content: [{
      type: "input_text",
      text: `Deterministic current runtime state. Treat this as authoritative and do not infer evicted tool history:\n${JSON.stringify(summary)}`
    }]
  };
}

function modelTurnPayload(history: ResponseInputItem[], response: ManagerResponseV3 | undefined, promptVersion: string, finishOnly = false) {
  return {
    request: {
      promptVersion,
      input: history,
      toolChoice: finishOnly ? "finish_only" : "required",
      parallelToolCalls: false,
      store: false,
      reasoningEffort: "high"
    },
    response: response ? {
      status: response.status,
      error: response.error,
      incompleteDetails: response.incomplete_details,
      output: response.output,
      outputText: response.output_text
    } : undefined
  };
}

function isTerminalRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message === "manager_no_progress"
    || message.endsWith("_budget_exhausted");
}

const hashSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };

const managerTools: Tool[] = [
  tool("set_site_plan", "Submit the complete evidence-bound route, content, conversion, visual, and responsive plan. This is the only tool available during planning and the accepted plan is immutable for the run.", {
    type: "object", additionalProperties: false,
    required: ["routes", "sharedStructure", "visualDirection", "responsiveIntent"],
    properties: {
      routes: {
        type: "array", minItems: 1, maxItems: 40,
        items: {
          type: "object", additionalProperties: false,
          required: ["path", "purpose", "sourceFactIds", "offeringIds", "ctas", "capabilities"],
          properties: {
            path: { type: "string", pattern: "^/" },
            purpose: { type: "string", enum: ["home", "service", "about", "contact", "location", "gallery", "custom"] },
            sourceFactIds: { type: "array", maxItems: 200, items: { type: "string", minLength: 1 } },
            offeringIds: { type: "array", maxItems: 40, items: { type: "string", minLength: 1 } },
            ctas: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["label", "kind", "target"], properties: {
              label: { type: "string", minLength: 1 }, kind: { type: "string", enum: ["call", "form", "booking", "visit", "navigate"] }, target: { type: "string", minLength: 1 }
            } } },
            capabilities: { type: "array", items: { type: "string", enum: ["forms", "analytics", "maps", "proof", "gallery", "disclosure"] } }
          }
        }
      },
      sharedStructure: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1 } },
      visualDirection: { type: "object", additionalProperties: false, required: ["thesis", "typography", "color", "composition"], properties: {
        thesis: { type: "string", minLength: 40 }, typography: { type: "string", minLength: 20 }, color: { type: "string", minLength: 20 }, composition: { type: "string", minLength: 20 }
      } },
      responsiveIntent: { type: "object", additionalProperties: false, required: ["navigation", "layout", "conversion"], properties: {
        navigation: { type: "string", minLength: 20 }, layout: { type: "string", minLength: 20 }, conversion: { type: "string", minLength: 20 }
      } }
    }
  }),
  tool("read_workspace", "Read a bounded line window from one workspace source file.", {
    type: "object", additionalProperties: false, required: ["path", "startLine", "endLine"],
    properties: { path: { type: "string", enum: ["src/site.tsx", "src/styles.css"] }, startLine: { type: ["integer", "null"], minimum: 1 }, endLine: { type: ["integer", "null"], minimum: 1 } }
  }),
  tool("search_workspace", "Search for an exact literal string across one or both workspace source files and return bounded line matches.", {
    type: "object", additionalProperties: false, required: ["query", "path", "maxResults"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 500 },
      path: { type: ["string", "null"], enum: ["src/site.tsx", "src/styles.css", null] },
      maxResults: { type: ["integer", "null"], minimum: 1, maximum: 100 }
    }
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
    required: ["visualThesis", "contentArchitecture", "ownerMessage", "workspaceHash", "sandboxRevision", "publicBuildInputId", "toolchainVersion", "sandboxImageDigest", "inspectionHash", "planHash"],
    properties: {
      visualThesis: { type: "string", minLength: 80 }, contentArchitecture: { type: "string", minLength: 80 }, ownerMessage: { type: "string", minLength: 1 },
      workspaceHash: hashSchema, sandboxRevision: { type: "string", minLength: 1 }, publicBuildInputId: { type: "string", minLength: 1 },
      toolchainVersion: { type: "string", minLength: 1 }, sandboxImageDigest: hashSchema, inspectionHash: hashSchema, planHash: hashSchema
    }
  })
];

const planningTools = managerTools.filter((candidate) => candidate.type === "function" && candidate.name === "set_site_plan");
const workingTools = managerTools.filter((candidate) => candidate.type === "function" && candidate.name !== "set_site_plan");
const finishOnlyTools = workingTools.filter((candidate) => candidate.type === "function" && candidate.name === "finish");

function tool(name: string, description: string, parameters: Record<string, unknown>): Tool {
  return { type: "function", name, description, parameters, strict: true };
}

const managerDiscussionJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "response", "proposedAction", "requiresApply"],
  properties: { schemaVersion: { type: "string", const: "manager-discussion-v1" }, response: { type: "string" }, proposedAction: { type: ["string", "null"] }, requiresApply: { type: "boolean" } }
};

const managerEditPreflightJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "decision", "taskKind", "operation", "requestedOutcome", "clarificationQuestion"],
  properties: {
    schemaVersion: { type: "string", const: "manager-edit-preflight-v1" },
    decision: { type: "string", enum: ["ready", "clarification_required"] },
    taskKind: { type: ["string", "null"], enum: ["focused_edit", "page_edit", "seo_aeo_improvement", null] },
    operation: { type: ["string", "null"], enum: ["restyle", "add_page", "move_form", "mobile_fix", "content", "seo", "other", null] },
    requestedOutcome: { type: "string" },
    clarificationQuestion: { type: ["string", "null"] }
  }
};

const managerCandidateCritiqueJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "verdict", "summary", "findings"],
  properties: {
    schemaVersion: { type: "string", const: "manager-candidate-critique-v1" }, verdict: { type: "string", enum: ["ship", "revise"] }, summary: { type: "string" },
    findings: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["route", "area", "severity", "message"], properties: {
      route: { type: "string", pattern: "^/" }, area: { type: "string", enum: ["identity", "hierarchy", "composition", "coherence", "mobile", "conversion", "craft", "task_completion"] },
      severity: { type: "string", enum: ["high", "normal", "low"] }, message: { type: "string" }
    } } }
  }
};
