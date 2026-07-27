import { platformOperationsRepository, type WebsiteAssessmentRecord } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import { siteAuthoringWorkflow } from "@/packages/site-platform/workflow";
import type { SiteAgentRun } from "@/packages/site-contracts";
import { enqueueSiteArtifactAssessment } from "@/packages/website-assessment/service";
import {
  denverPlumberBakeoffCandidates,
  denverPlumberBakeoffId,
  denverPlumberBakeoffSources
} from "./catalog";
import {
  type ModelBakeoffCandidate,
  type ModelBakeoffSource,
  modelBakeoffExperimentSchema,
  modelBakeoffRunSchema,
  type ModelBakeoffExperiment,
  type ModelBakeoffRun,
  type ModelBakeoffStatus
} from "./contracts";
import { modelBakeoffRepository, type ModelBakeoffRepository } from "./repository";

export type ModelBakeoffRunView = {
  item: ModelBakeoffRun;
  agentRun?: SiteAgentRun;
  assessment?: WebsiteAssessmentRecord;
  servedModelIds: string[];
  upstreamProviders: string[];
  requestCount: number;
};

export type ModelBakeoffView = {
  experiment: ModelBakeoffExperiment;
  rows: ModelBakeoffRunView[];
  totals: {
    completed: number;
    failed: number;
    active: number;
    totalCostUsd: number;
    assessmentCostUsd: number;
    medianDurationMs?: number;
    medianQualityScore?: number;
  };
};

export type ModelBakeoffDefinition = {
  id: string;
  name: string;
  purpose: string;
  requestedBy: string;
  sources: ModelBakeoffSource[];
  candidates: ModelBakeoffCandidate[];
};

export function createModelBakeoffRecords(definition: ModelBakeoffDefinition, now = new Date().toISOString()) {
  const experiment = modelBakeoffExperimentSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    name: definition.name,
    purpose: definition.purpose,
    requestedBy: definition.requestedBy,
    status: "queued",
    sources: definition.sources,
    candidates: definition.candidates,
    createdAt: now,
    updatedAt: now
  });
  const runs = definition.sources.flatMap((source, sourceIndex) =>
    definition.candidates.map((candidate, candidateIndex) => modelBakeoffRunSchema.parse({
      schemaVersion: 1,
      id: `${definition.id}:${source.key}:${candidate.key}`,
      experimentId: definition.id,
      ordinal: sourceIndex * definition.candidates.length + candidateIndex,
      source,
      candidate,
      status: "queued",
      createdAt: now,
      updatedAt: now
    }))
  );
  return { experiment, runs };
}

export async function ensureModelBakeoff(
  definition: ModelBakeoffDefinition,
  repository: ModelBakeoffRepository = modelBakeoffRepository
) {
  const existing = await repository.getExperiment(definition.id);
  if (existing) return existing;
  const { experiment, runs } = createModelBakeoffRecords(definition);
  await repository.createExperiment(experiment, runs);
  return experiment;
}

export async function ensureDenverPlumberBakeoff(
  repository: ModelBakeoffRepository = modelBakeoffRepository
) {
  return ensureModelBakeoff({
    id: denverPlumberBakeoffId,
    name: "Denver plumber authoring bake-off",
    purpose: "Compare four authoring routes across three source-information profiles using the same Lodesta intake, tools, guardrails, verification, and private preview boundary.",
    requestedBy: "lodesta_model_bakeoff",
    sources: denverPlumberBakeoffSources,
    candidates: denverPlumberBakeoffCandidates
  }, repository);
}

export async function runModelBakeoffItem(
  itemId: string,
  repository: ModelBakeoffRepository = modelBakeoffRepository,
  options: { maxAuthoringCostUsd?: number } = {}
) {
  const item = await repository.getRun(itemId);
  if (!item) throw new Error(`Model bake-off run not found: ${itemId}`);
  if (item.status !== "queued") return { item, creditExhausted: item.failureCode === "provider_quota_exhausted" };
  const startedAt = new Date().toISOString();
  let current = modelBakeoffRunSchema.parse({
    ...item,
    status: "building",
    startedAt,
    updatedAt: startedAt,
    completedAt: undefined,
    failureCode: undefined,
    failureReason: undefined
  });
  await repository.saveRun(current);
  try {
    const bootstrapped = await siteAuthoringWorkflow.bootstrapFromUrl({
      url: current.source.url,
      ownerId: "lodesta_model_bakeoff",
      reportingTimezone: "America/Denver",
      initialBuildRoute: {
        apiProvider: current.candidate.apiProvider,
        modelId: current.candidate.modelId
      },
      initialBuildMaxCostUsd: options.maxAuthoringCostUsd
    });
    current = modelBakeoffRunSchema.parse({
      ...current,
      siteId: bootstrapped.site.id,
      sessionId: bootstrapped.session.id,
      runId: bootstrapped.run.id,
      publicBuildInputHash: bootstrapped.buildInput.inputHash,
      updatedAt: new Date().toISOString()
    });
    await repository.saveRun(current);

    const agentRun = await siteAuthoringWorkflow.executeRunAndFinalize(bootstrapped.run.id);
    if (agentRun.status !== "succeeded" || !agentRun.outputArtifactId || !agentRun.candidateVersionId) {
      const failed = failItem(current, agentRun.failureCode ?? "authoring_failed", agentRun.failureReason ?? `Authoring ended with ${agentRun.status}.`);
      await repository.saveRun(failed);
      return { item: failed, creditExhausted: failed.failureCode === "provider_quota_exhausted" };
    }
    const artifact = await sitePlatformRepository.getBuildArtifact(agentRun.outputArtifactId);
    if (!artifact) throw new Error("Verified build artifact was not retained.");
    const enqueued = await enqueueSiteArtifactAssessment({
      artifact,
      versionId: agentRun.candidateVersionId
    });
    const updatedAt = new Date().toISOString();
    const completed = modelBakeoffRunSchema.parse({
      ...current,
      candidateVersionId: agentRun.candidateVersionId,
      assessmentId: enqueued?.assessment.id,
      status: enqueued ? "assessing" : "completed",
      updatedAt,
      completedAt: enqueued ? undefined : updatedAt
    });
    await repository.saveRun(completed);
    return { item: completed, creditExhausted: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCode = quotaFailure(message) ? "provider_quota_exhausted" : "bakeoff_execution_failed";
    const failed = failItem(current, failureCode, message);
    await repository.saveRun(failed);
    return { item: failed, creditExhausted: failureCode === "provider_quota_exhausted" };
  }
}

export async function refreshModelBakeoffAssessments(
  experimentId: string,
  repository: ModelBakeoffRepository = modelBakeoffRepository
) {
  const rows = await repository.listRuns(experimentId);
  for (const item of rows.filter((candidate) => candidate.status === "assessing" && candidate.assessmentId)) {
    const assessment = await platformOperationsRepository.getWebsiteAssessment(item.assessmentId!);
    if (!assessment || (assessment.status !== "completed" && assessment.status !== "failed")) continue;
    const now = new Date().toISOString();
    await repository.saveRun(modelBakeoffRunSchema.parse({
      ...item,
      status: assessment.status === "completed" ? "completed" : "failed",
      failureCode: assessment.status === "failed" ? "assessment_failed" : undefined,
      failureReason: assessment.status === "failed" ? assessment.errorCode ?? "Website assessment failed." : undefined,
      updatedAt: now,
      completedAt: now
    }));
  }
}

export async function updateModelBakeoffStatus(
  experimentId: string,
  input: { creditExhausted?: boolean } = {},
  repository: ModelBakeoffRepository = modelBakeoffRepository
) {
  const [experiment, rows] = await Promise.all([
    repository.getExperiment(experimentId),
    repository.listRuns(experimentId)
  ]);
  if (!experiment) throw new Error(`Model bake-off not found: ${experimentId}`);
  let status: ModelBakeoffStatus;
  if (input.creditExhausted) status = "paused_credit";
  else if (rows.some((row) => ["queued", "building", "assessing"].includes(row.status))) status = "running";
  else if (rows.some((row) => row.status === "failed")) status = "completed_with_errors";
  else status = "completed";
  const now = new Date().toISOString();
  const updated = modelBakeoffExperimentSchema.parse({
    ...experiment,
    status,
    startedAt: experiment.startedAt ?? now,
    completedAt: ["completed", "completed_with_errors"].includes(status) ? now : undefined,
    updatedAt: now
  });
  await repository.saveExperiment(updated);
  return updated;
}

export async function getModelBakeoffView(
  experimentId: string,
  repository: ModelBakeoffRepository = modelBakeoffRepository
): Promise<ModelBakeoffView | null> {
  const experiment = await repository.getExperiment(experimentId);
  if (!experiment) return null;
  const items = await repository.listRuns(experimentId);
  const rows = await Promise.all(items.map(async (item): Promise<ModelBakeoffRunView> => {
    const [agentRun, assessment, events] = await Promise.all([
      item.runId ? sitePlatformRepository.getAgentRun(item.runId) : undefined,
      item.assessmentId ? platformOperationsRepository.getWebsiteAssessment(item.assessmentId) : undefined,
      item.runId ? sitePlatformRepository.listAgentRunEvents(item.runId, { limit: 500 }) : []
    ]);
    const successfulRequests = events.filter((event) => event.kind === "model_request" && event.status === "succeeded");
    return {
      item,
      agentRun,
      assessment: assessment ?? undefined,
      servedModelIds: unique(successfulRequests.map((event) => event.servedModelId).filter(isString)),
      upstreamProviders: unique(successfulRequests.map((event) => event.upstreamProvider).filter(isString)),
      requestCount: successfulRequests.length
    };
  }));
  const completed = rows.filter((row) => row.item.status === "completed");
  const durations = completed.map((row) => modelUsage(row.agentRun)?.durationMs).filter(isNumber);
  const scores = completed.map((row) => row.assessment?.assessment?.score?.value).filter(isNumber);
  return {
    experiment,
    rows,
    totals: {
      completed: completed.length,
      failed: rows.filter((row) => row.item.status === "failed").length,
      active: rows.filter((row) => ["queued", "building", "assessing"].includes(row.item.status)).length,
      totalCostUsd: rows.reduce((sum, row) => sum + (modelUsage(row.agentRun)?.costUsd ?? 0), 0),
      assessmentCostUsd: rows.reduce((sum, row) => sum + (row.assessment?.assessment?.visualQuality.evaluator.estimatedCostUsd ?? 0), 0),
      medianDurationMs: median(durations),
      medianQualityScore: median(scores)
    }
  };
}

function failItem(item: ModelBakeoffRun, failureCode: string, failureReason: string) {
  const now = new Date().toISOString();
  return modelBakeoffRunSchema.parse({
    ...item,
    status: "failed",
    failureCode,
    failureReason: failureReason.slice(0, 2_000),
    updatedAt: now,
    completedAt: now
  });
}

function quotaFailure(message: string) {
  return /\b402\b|quota|insufficient[_ ]credits?|credit balance|payment required/i.test(message);
}

function modelUsage(run?: SiteAgentRun) {
  return run?.usage.kind === "model_reported" ? run.usage : undefined;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}
