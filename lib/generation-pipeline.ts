import { join } from "node:path";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import type { BusinessProfile, RegenerableArtifactProvenanceV1, SiteAsset, SiteBundle, SiteVersionV3 } from "./models";
import type { EvidenceLedger } from "./evidence-ledger";
import type { GenerationPlan, SiteCopy } from "./generation-contracts";
import { buildGenerationPlan, alternateDesignSystem } from "./vertical-packs";
import { createSiteCopy } from "./site-copy";
import { compileSite } from "./site-compiler";
import {
  runObjectiveGenerationGate,
  type ObjectiveGenerationGateResult
} from "./generation-objective-gate";
import {
  buildGenerationJudgePacket,
  createGenerationJudge,
  type GenerationJudgeResult,
  type GenerationJudgeRevisionAction
} from "./generation-judge";
import { createRegenerableArtifactProvenanceV1 } from "./regenerable-artifact-provenance";

export const generationPipelineTraceSchemaVersion = "generation-pipeline-trace-v1" as const;

export type GenerationPipelineTrace = {
  schemaVersion: typeof generationPipelineTraceSchemaVersion;
  provenance: RegenerableArtifactProvenanceV1;
  counts: {
    plans: 1 | 2;
    copies: 1 | 2;
    copyModelAttempts: number;
    compiles: 1 | 2;
    gates: 1 | 2;
    judges: 0 | 1 | 2;
  };
  attempts: Array<{
    attempt: 0 | 1;
    designSystem: GenerationPlan["designSystem"];
    copyModelAttempts: number;
    gateStatus: ObjectiveGenerationGateResult["status"];
    judgeVerdict?: GenerationJudgeResult["verdict"];
    judgeAction?: GenerationJudgeResult["action"];
  }>;
};

export type CanonicalGenerationResult = {
  status: "ship" | "operator_review";
  reason?:
    | "objective_gate_failed"
    | "judge_unavailable_or_escalated"
    | "alternate_system_unavailable"
    | "regeneration_did_not_ship";
  plan: GenerationPlan;
  copy: SiteCopy;
  version: SiteVersionV3;
  gate: ObjectiveGenerationGateResult;
  judge?: GenerationJudgeResult;
  trace: GenerationPipelineTrace;
};

type PipelineDependencies = {
  copy: typeof createSiteCopy;
  gate: typeof runObjectiveGenerationGate;
  packet: typeof buildGenerationJudgePacket;
  judge: typeof createGenerationJudge;
};

const defaultDependencies: PipelineDependencies = {
  copy: createSiteCopy,
  gate: runObjectiveGenerationGate,
  packet: buildGenerationJudgePacket,
  judge: createGenerationJudge
};

export async function runCanonicalGenerationPipeline(input: {
  bundle: SiteBundle;
  business?: BusinessProfile;
  evidence: EvidenceLedger;
  assets: SiteAsset[];
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  signal?: AbortSignal;
  artifactRoot?: string;
  dependencies?: Partial<PipelineDependencies>;
}): Promise<CanonicalGenerationResult> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const business = input.business ?? input.bundle.businessProfile;
  const artifactRoot = input.artifactRoot ?? join(process.cwd(), ".data", "canonical-generation", business.siteId);
  const traceCounts = { plans: 1 as 1 | 2, copies: 0, copyModelAttempts: 0, compiles: 0, gates: 0, judges: 0 };
  const traceAttempts: GenerationPipelineTrace["attempts"] = [];
  const brandExpression = input.bundle.presenceAssessment.businessUnderstanding?.brandExpression;
  const brandAssessment = input.bundle.presenceAssessment.brandAssessment;
  let plan = buildGenerationPlan({ business, evidence: input.evidence, assets: input.assets, brandExpression, brandAssessment });
  let revisionAction: GenerationJudgeRevisionAction | undefined;
  let revisionFindings: string[] = [];
  let lastResult: Omit<CanonicalGenerationResult, "status" | "reason" | "trace"> | undefined;

  for (const attempt of [0, 1] as const) {
    if (attempt === 1 && revisionAction === "alternate_system") {
      const alternate = alternateDesignSystem(plan.designSystem, input.assets);
      if (!alternate) {
        if (!lastResult) throw new Error("Alternate-system resolution requires an initial generation result.");
        return finish("operator_review", "alternate_system_unavailable", lastResult, traceCounts, traceAttempts);
      }
      plan = buildGenerationPlan({ business, evidence: input.evidence, assets: input.assets, brandExpression, brandAssessment, designSystemOverride: alternate });
      traceCounts.plans = 2;
    }
    const generated = await dependencies.copy({
      business,
      plan,
      evidence: input.evidence,
      telemetry: input.telemetry,
      spanId: input.spanId,
      signal: input.signal,
      revisionFindings
    });
    traceCounts.copies = incrementOneOrTwo(traceCounts.copies);
    traceCounts.copyModelAttempts += generated.attempts;
    const version = compileSite({ business, plan, copy: generated.copy, evidence: input.evidence, assets: input.assets });
    traceCounts.compiles = incrementOneOrTwo(traceCounts.compiles);
    const renderBundle = bundleForVersion(input.bundle, business, version);
    const gate = await dependencies.gate({
      bundle: renderBundle,
      version,
      plan,
      copy: generated.copy,
      evidence: input.evidence,
      qaRunId: `qa_${business.siteId}_${attempt}_${Date.now()}`,
      artifactRoot,
      captureScreenshots: true
    });
    traceCounts.gates = incrementOneOrTwo(traceCounts.gates);
    const attemptTrace: GenerationPipelineTrace["attempts"][number] = {
      attempt,
      designSystem: plan.designSystem,
      copyModelAttempts: generated.attempts,
      gateStatus: gate.status
    };
    lastResult = { plan, copy: generated.copy, version, gate };
    if (gate.status !== "pass") {
      traceAttempts.push(attemptTrace);
      return finish("operator_review", "objective_gate_failed", lastResult, traceCounts, traceAttempts);
    }
    const packet = await dependencies.packet({ plan, version, assets: input.assets, gate, artifactRoot });
    const judge = await dependencies.judge({
      business,
      plan,
      packet,
      telemetry: input.telemetry,
      spanId: input.spanId,
      signal: input.signal
    });
    traceCounts.judges = incrementZeroOneTwo(traceCounts.judges);
    attemptTrace.judgeVerdict = judge.verdict;
    attemptTrace.judgeAction = judge.action;
    traceAttempts.push(attemptTrace);
    lastResult = { ...lastResult, judge };
    if (judge.verdict === "ship") return finish("ship", undefined, lastResult, traceCounts, traceAttempts);
    if (judge.verdict === "operator_review" || judge.action === "operator_review") {
      return finish("operator_review", "judge_unavailable_or_escalated", lastResult, traceCounts, traceAttempts);
    }
    if (attempt === 1) {
      return finish("operator_review", "regeneration_did_not_ship", lastResult, traceCounts, traceAttempts);
    }
    revisionAction = judge.action;
    revisionFindings = judge.findings.map((finding) => `${finding.area} on ${finding.pageId}: ${finding.instruction}`);
  }
  throw new Error("Canonical generation exhausted its bounded attempts without a result.");
}

function bundleForVersion(bundle: SiteBundle, business: BusinessProfile, version: SiteVersionV3): SiteBundle {
  return {
    ...bundle,
    businessProfile: business,
    siteModel: {
      ...bundle.siteModel,
      theme: version.theme ?? bundle.siteModel.theme,
      versions: [version]
    }
  };
}

function finish(
  status: CanonicalGenerationResult["status"],
  reason: CanonicalGenerationResult["reason"] | undefined,
  result: Omit<CanonicalGenerationResult, "status" | "reason" | "trace">,
  counts: {
    plans: 1 | 2;
    copies: number;
    copyModelAttempts: number;
    compiles: number;
    gates: number;
    judges: number;
  },
  attempts: GenerationPipelineTrace["attempts"]
): CanonicalGenerationResult {
  const traceCounts = {
    plans: counts.plans,
    copies: asOneOrTwo(counts.copies, "copies"),
    copyModelAttempts: counts.copyModelAttempts,
    compiles: asOneOrTwo(counts.compiles, "compiles"),
    gates: asOneOrTwo(counts.gates, "gates"),
    judges: asZeroOneTwo(counts.judges)
  };
  const trace: GenerationPipelineTrace = {
    schemaVersion: generationPipelineTraceSchemaVersion,
    provenance: createRegenerableArtifactProvenanceV1({
      producerId: "run-canonical-generation-pipeline",
      producerVersion: generationPipelineTraceSchemaVersion,
      inputs: { status, reason, counts: traceCounts, attempts }
    }),
    counts: traceCounts,
    attempts
  };
  validateGenerationPipelineTrace(trace);
  return { status, ...(reason ? { reason } : {}), ...result, trace };
}

export function validateGenerationPipelineTrace(trace: GenerationPipelineTrace): void {
  const attempts = trace.attempts;
  if (attempts.length !== 1 && attempts.length !== 2) {
    throw new Error(`Canonical generation trace has invalid attempt count ${attempts.length}.`);
  }
  attempts.forEach((attempt, index) => {
    if (attempt.attempt !== index) {
      throw new Error(`Canonical generation trace expected attempt ${index}, received ${attempt.attempt}.`);
    }
    if (attempt.copyModelAttempts !== 1 && attempt.copyModelAttempts !== 2) {
      throw new Error(`Canonical generation attempt ${index} has invalid copy model attempt count ${attempt.copyModelAttempts}.`);
    }
    const judged = attempt.judgeVerdict !== undefined || attempt.judgeAction !== undefined;
    if (attempt.gateStatus === "pass" && !judged) {
      throw new Error(`Canonical generation attempt ${index} passed the objective gate without a judge result.`);
    }
    if (attempt.gateStatus !== "pass" && judged) {
      throw new Error(`Canonical generation attempt ${index} reached the judge after an objective gate failure.`);
    }
    if ((attempt.judgeVerdict === undefined) !== (attempt.judgeAction === undefined)) {
      throw new Error(`Canonical generation attempt ${index} has an incomplete judge result.`);
    }
  });

  const executionCount = attempts.length;
  if (trace.counts.copies !== executionCount || trace.counts.compiles !== executionCount || trace.counts.gates !== executionCount) {
    throw new Error("Canonical generation trace execution counts do not match its attempts.");
  }
  const copyModelAttempts = attempts.reduce((total, attempt) => total + attempt.copyModelAttempts, 0);
  if (trace.counts.copyModelAttempts !== copyModelAttempts) {
    throw new Error("Canonical generation trace copy model attempt count does not match its attempts.");
  }
  const judges = attempts.filter((attempt) => attempt.judgeVerdict !== undefined).length;
  if (trace.counts.judges !== judges) {
    throw new Error("Canonical generation trace judge count does not match its attempts.");
  }

  if (attempts.length === 1) {
    if (trace.counts.plans !== 1) throw new Error("A one-pass canonical generation trace must contain one plan.");
    return;
  }

  const first = attempts[0];
  const second = attempts[1];
  if (first.gateStatus !== "pass" || first.judgeVerdict !== "revise") {
    throw new Error("A second canonical generation pass requires a first-pass judge revision.");
  }
  if (first.judgeAction !== "copy" && first.judgeAction !== "alternate_system") {
    throw new Error(`A second canonical generation pass cannot follow judge action ${first.judgeAction ?? "missing"}.`);
  }
  const changedSystem = first.designSystem !== second.designSystem;
  if (first.judgeAction === "alternate_system" && (!changedSystem || trace.counts.plans !== 2)) {
    throw new Error("Alternate-system regeneration must change systems and record exactly two plans.");
  }
  if (first.judgeAction === "copy" && (changedSystem || trace.counts.plans !== 1)) {
    throw new Error("Copy regeneration must preserve the design system and reuse the original plan.");
  }
}

function incrementOneOrTwo(value: number): 1 | 2 {
  if (value >= 2) throw new Error("Canonical generation exceeded two bounded executions.");
  return (value + 1) as 1 | 2;
}

function incrementZeroOneTwo(value: number): 1 | 2 {
  if (value >= 2) throw new Error("Canonical generation exceeded two bounded judge calls.");
  return (value + 1) as 1 | 2;
}

function asOneOrTwo(value: number, label: string): 1 | 2 {
  if (value !== 1 && value !== 2) throw new Error(`Canonical generation trace has invalid ${label} count ${value}.`);
  return value;
}

function asZeroOneTwo(value: number): 0 | 1 | 2 {
  if (value !== 0 && value !== 1 && value !== 2) throw new Error(`Canonical generation trace has invalid judges count ${value}.`);
  return value;
}
