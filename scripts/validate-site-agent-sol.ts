import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { configuredArtifactBlobStore } from "../packages/site-artifacts";
import { sitePlatformRepository } from "../packages/platform-data";
import { siteAuthoringWorkflow } from "../packages/site-platform/workflow";

const model = "gpt-5.6-sol";
const apiProvider = "openai";
const maxCostUsd = Number(process.env.LODESTA_SOL_VALIDATION_MAX_COST_USD ?? 4);
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 4) {
  throw new Error("LODESTA_SOL_VALIDATION_MAX_COST_USD must be greater than 0 and no more than 4.");
}
const reportRoot = join(process.cwd(), ".data", "site-agent-sol-validations");
const sourceRunId = process.env.LODESTA_SOL_VALIDATION_SOURCE_RUN_ID?.trim()
  || "run_843bbbd14a5244c8bdd630a6f8bc99d1";
const operatorId = "lodesta_sol_validation";
const startedAt = new Date().toISOString();
const reportDirectory = join(reportRoot, `${startedAt.replaceAll(":", "-")}-${sourceRunId}`);
await mkdir(reportDirectory, { recursive: true });

let validationRunId: string | undefined;
let result: Record<string, unknown>;
try {
  const sourceRun = await sitePlatformRepository.getAgentRun(sourceRunId);
  if (!sourceRun) throw new Error(`validation_source_run_not_found:${sourceRunId}`);
  const [site, buildInput] = await Promise.all([
    sitePlatformRepository.getSite(sourceRun.siteId),
    sitePlatformRepository.getPublicBuildInput(sourceRun.publicBuildInputId)
  ]);
  if (!site || !buildInput) throw new Error("validation_source_state_unavailable");
  if (site.currentPublicBuildInputId !== buildInput.id) {
    throw new Error(`validation_source_input_is_not_current:${site.currentPublicBuildInputId}:${buildInput.id}`);
  }
  const session = await siteAuthoringWorkflow.getOrCreateSession({
    siteId: site.id,
    principal: { kind: "operator", id: operatorId },
    buildInput
  });
  let run = await siteAuthoringWorkflow.enqueueRun({
    session,
    kind: "initial_build",
    instruction: "Create the best complete customer-facing website supported by the retained source evidence.",
    requestedBy: operatorId,
    origin: "system",
    publishAfterSuccess: false,
    modelRoute: { apiProvider, modelId: model }
  });
  validationRunId = run.id;
  if (!run.guardrails) throw new Error("validation_run_guardrails_unavailable");
  run = {
    ...run,
    guardrails: {
      ...run.guardrails,
      maxCostUsd
    }
  };
  await sitePlatformRepository.saveAgentRun(run);
  console.log(JSON.stringify({
    status: "validation_started",
    sourceRunId,
    validationRunId,
    maxCostUsd,
    reportDirectory
  }));

  const completed = await siteAuthoringWorkflow.executeRunAndFinalize(run.id);
  const events = await sitePlatformRepository.listAgentRunEvents(run.id, { limit: 1000 });
  const modelRequests = events.filter(
    (event) => event.kind === "model_request" && event.name === "responses.create" && event.status === "succeeded"
  );
  const requestMetrics = modelRequests.map((event, index) => ({
    index: index + 1,
    requestId: event.providerRequestId,
    inputTokens: event.inputTokens ?? 0,
    cachedInputTokens: event.cachedInputTokens ?? 0,
    uncachedInputTokens: Math.max(0, (event.inputTokens ?? 0) - (event.cachedInputTokens ?? 0)),
    cacheWriteTokens: event.cacheWriteTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    reasoningTokens: event.reasoningTokens ?? 0,
    costUsd: event.costUsd ?? 0,
    latencyMs: event.modelDurationMs ?? 0,
    inputCapacityUtilization: numberValue(event.summary.inputCapacityUtilization),
    stablePrefixBytes: numberValue(event.summary.stablePrefixBytes),
    appendedTailBytes: numberValue(event.summary.appendedTailBytes),
    requestPayloadBytes: numberValue(event.summary.requestPayloadBytes),
    screenshotBytes: numberValue(event.summary.screenshotBytes),
    imageCount: numberValue(event.summary.imageCount)
  }));
  const runEvent = events.find(
    (event) => event.kind === "run" && event.status === "succeeded"
  ) ?? [...events].reverse().find((event) => event.kind === "run");
  const half = Math.ceil(requestMetrics.length / 2);
  const firstHalfUncached = requestMetrics.slice(0, half).map((request) => request.uncachedInputTokens);
  const secondHalfUncached = requestMetrics.slice(half).map((request) => request.uncachedInputTokens);
  const continuityPairs = requestMetrics.slice(1).map((request, index) => ({
    request: request.index,
    previousInputTokens: requestMetrics[index]!.inputTokens,
    cachedInputTokens: request.cachedInputTokens,
    passed: request.cachedInputTokens >= requestMetrics[index]!.inputTokens * 0.9
  }));
  const continuityRate = continuityPairs.length
    ? continuityPairs.filter((pair) => pair.passed).length / continuityPairs.length
    : 0;
  const totalUncachedInputTokens = sum(requestMetrics.map((request) => request.uncachedInputTokens));
  const durationMs = completed.completedAt
    ? Date.parse(completed.completedAt) - Date.parse(completed.startedAt)
    : Date.now() - Date.parse(completed.startedAt);
  const artifact = completed.outputArtifactId
    ? await sitePlatformRepository.getBuildArtifact(completed.outputArtifactId)
    : undefined;
  const contradictionFindings = artifact?.qa.findings.filter((finding) =>
    finding.id === "fact.sdk_value_mismatch"
    || (finding.id === "html.forbidden_tag" && /preload|link/i.test(finding.message))
  ) ?? [];
  const screenshots = artifact ? await retainScreenshots(artifact.qa.screenshotKeys, reportDirectory) : [];
  const toolCounts = countBy(events.filter((event) => event.kind === "tool_call"), (event) => event.name);
  const contextHighWater = Math.max(0, ...requestMetrics.map((request) => request.inputCapacityUtilization ?? 0));
  const firstHalfMedian = median(firstHalfUncached);
  const secondHalfMedian = median(secondHalfUncached);
  const technicalAcceptance = {
    succeeded: completed.status === "succeeded",
    noContradictions: contradictionFindings.length === 0,
    noHardFindings: artifact?.qa.findings.every((finding) => finding.severity !== "error") ?? false,
    totalUncachedInputBelow500k: totalUncachedInputTokens < 500_000,
    requestCountAtMost20: requestMetrics.length <= 20,
    durationWithin12Minutes: durationMs <= 12 * 60_000,
    cacheContinuityAtLeast80Percent: continuityRate >= 0.8,
    uncachedInputDidNotMateriallyGrow: secondHalfMedian <= firstHalfMedian * 1.1,
    contextBelowWarningBoundary: contextHighWater < 0.8
  };
  const technicalPassed = Object.values(technicalAcceptance).every(Boolean);
  result = {
    schemaVersion: 1,
    kind: "site-agent-sol-validation-report",
    createdAt: new Date().toISOString(),
    outcome: validationOutcome(completed.failureCode, completed.status, technicalPassed),
    sourceRun: {
      id: sourceRun.id,
      status: sourceRun.status,
      failureCode: sourceRun.failureCode,
      publicBuildInputId: sourceRun.publicBuildInputId,
      publicBuildInputHash: buildInput.inputHash,
      comparableVisualArtifact: Boolean(sourceRun.outputArtifactId),
      visualComparison: sourceRun.outputArtifactId
        ? "manual_comparison_required"
        : "not_applicable_source_run_never_produced_an_artifact"
    },
    validationRun: {
      id: completed.id,
      status: completed.status,
      failureCode: completed.failureCode,
      failureReason: completed.failureReason,
      artifactId: completed.outputArtifactId,
      workspaceRevisionId: completed.outputRevisionId,
      candidateVersionId: completed.candidateVersionId
    },
    route: { apiProvider, model },
    maxCostUsd,
    actualCostUsd: completed.usage.kind === "model_reported" ? completed.usage.costUsd : undefined,
    durationMs,
    requestCount: requestMetrics.length,
    totalUncachedInputTokens,
    cacheContinuityRate: continuityRate,
    continuityPairs,
    firstHalfMedianUncachedInputTokens: firstHalfMedian,
    secondHalfMedianUncachedInputTokens: secondHalfMedian,
    contextUtilizationHighWater: contextHighWater,
    contextHighWaterRequest: runEvent?.summary.contextHighWaterRequest,
    historyBytesHighWater: Math.max(0, ...requestMetrics.map((request) => request.requestPayloadBytes ?? 0)),
    screenshotBytesHighWater: Math.max(0, ...requestMetrics.map((request) => request.screenshotBytes ?? 0)),
    imageCountHighWater: Math.max(0, ...requestMetrics.map((request) => request.imageCount ?? 0)),
    buildCount: nestedNumber(runEvent?.summary, "runtimeMetrics", "builds"),
    lastSuccessfulBuildMs: runEvent?.summary.firstSuccessfulBuildMs,
    toolCounts,
    unchangedPathRereads: numberValue(runEvent?.summary.unchangedPathRereads) ?? 0,
    parallelToolViolations: numberValue(runEvent?.summary.parallelToolViolations) ?? 0,
    findings: artifact?.qa.findings ?? [],
    contradictionFindings,
    screenshots,
    technicalAcceptance,
    manualVisualReviewRequired: completed.status === "succeeded",
    requestMetrics
  };
} catch (error) {
  const run = validationRunId
    ? await sitePlatformRepository.getAgentRun(validationRunId).catch(() => undefined)
    : undefined;
  const code = run?.failureCode;
  result = {
    schemaVersion: 1,
    kind: "site-agent-sol-validation-report",
    createdAt: new Date().toISOString(),
    outcome: validationOutcome(code, run?.status ?? "failed", false),
    sourceRunId,
    validationRunId,
    route: { apiProvider, model },
    maxCostUsd,
    actualCostUsd: run?.usage.kind === "model_reported" ? run.usage.costUsd : undefined,
    failureCode: code,
    failureReason: run?.failureReason,
    infrastructureError: error instanceof Error ? error.message : String(error)
  };
}

const reportPath = join(reportDirectory, "report.json");
await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ok: result.outcome === "validation_completed", reportPath, ...result }, null, 2));
if (result.outcome !== "validation_completed") process.exitCode = 1;

function validationOutcome(failureCode: string | undefined, status: string, technicalPassed: boolean) {
  if (failureCode === "cost_limit_exhausted") return "validation_cost_fuse_exhausted";
  if (failureCode === "context_capacity_exhausted") return "validation_context_capacity_exhausted";
  if (status === "succeeded") return technicalPassed ? "validation_completed" : "validation_quality_gate_failed";
  if (failureCode === "authoring_unresolved" || failureCode === "authoring_stalled") return "validation_quality_gate_failed";
  return "validation_infrastructure_failed";
}

async function retainScreenshots(keys: string[], directory: string) {
  const store = configuredArtifactBlobStore();
  const retained = [];
  for (const key of keys) {
    const blob = await store.get(key);
    if (!blob) continue;
    const path = join(directory, `${retained.length + 1}-${basename(key).replace(/[^a-zA-Z0-9._-]/g, "_")}.png`);
    await writeFile(path, blob.bytes, { flag: "wx" });
    retained.push({ key, path, bytes: blob.bytes.length, contentHash: blob.contentHash });
  }
  return retained;
}

function countBy<T>(values: T[], keyFor: (value: T) => string) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedNumber(value: Record<string, unknown> | undefined, key: string, nestedKey: string) {
  const nested = value?.[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  return numberValue((nested as Record<string, unknown>)[nestedKey]);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
