import type { GenerationQaBlocker, GenerationQaMetadata, GenerationQaRepairLog, GenerationQaRepairPatch, GenerationQaRepairTarget, SiteBundle, SiteCandidateStatus, SiteVersion } from "./models";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { buildGeneratedSiteQaMetadata } from "./generated-site-qa";
import { evaluateGenerationQualityV2 } from "./generation-quality-v2";
import { buildGenerationScorecard, scorecardEnforcementBlockers } from "./generation-scorecard";
import { buildGenerationRepairTargets } from "./generated-site-repair-targets";
import {
  applyGeneratedSiteRepairTarget,
  applyMechanicalGeneratedSiteCleanupPatches,
  maxGeneratedSiteRepairPasses,
  orderedLiveRepairTargets,
  patchWasApplied,
  patchWasRejected,
  type GeneratedSiteRepairMode
} from "./generated-site-repair-loop";
import { evaluateSeoStructure } from "./seo-structure";
import { buildFactCoverageReport } from "./fact-coverage";
import { inspectGeneratedSiteBundleRender } from "./generated-site-render-inspection";
import { finalizeGenerationCostEstimate, isModelVisualQaAllowed } from "./generation-cost";
import { createOpenAiVisualQa } from "./visual-qa";
import type { ModelFallbackPolicy } from "./site-candidate-service";
import type { GeneratedSiteQualitySignalsV3 } from "./generated-site-v3-nav";

export type GeneratedSiteReadinessResult = {
  status: Extract<SiteCandidateStatus, "ready" | "blocked">;
  qa: GenerationQaMetadata;
  repaired: boolean;
};

export async function runInitialGeneratedSiteReadiness(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  artifactRoot?: string;
  modelFallbackPolicy?: ModelFallbackPolicy;
  repairMode?: GeneratedSiteRepairMode;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
}): Promise<GeneratedSiteReadinessResult> {
  let version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "draft") ?? input.bundle.siteModel.versions[0];
  if (!version) {
    throw new Error("Generated site has no renderable version.");
  }

  const first = await buildDeterministicGeneratedSiteQa({
    bundle: input.bundle,
    version,
    telemetry: input.telemetry,
    spanId: input.spanId,
    artifactRoot: input.artifactRoot,
    qualitySignals: input.qualitySignals
  });
  version.generationQa = first.qa;

  const repairResult = await runBoundedGeneratedSiteRepairLoop({
    bundle: input.bundle,
    versionId: version.id,
    initialQa: version.generationQa,
    mode: input.repairMode ?? "normal_generation",
    telemetry: input.telemetry,
    spanId: input.spanId,
    artifactRoot: input.artifactRoot
  });
  version = versionById(input.bundle, version.id);
  version.generationQa = repairResult.qa;

  if (version.generationQa.readiness === "ready") {
    const finalInspection = await inspectGeneratedSiteBundleRender({
      bundle: input.bundle,
      version,
      qaRunId: `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`,
      artifactRoot: input.artifactRoot
    });
    const finalVisualQa = await createGeneratedVisualQa({
      bundle: input.bundle,
      inspection: finalInspection,
      telemetry: input.telemetry,
      spanId: input.spanId,
      allowModel: true,
      modelFallbackPolicy: input.modelFallbackPolicy ?? "fail"
    });
    input.bundle.presenceAssessment.generationCostEstimate = finalizeGenerationCostEstimate({
      previous: input.bundle.presenceAssessment.generationCostEstimate,
      generatedRenderInspection: finalInspection,
      generatedVisualQa: finalVisualQa
    });
    version.generationQa = withQualityGate(
      input.bundle,
      version,
      buildGeneratedSiteQaMetadata({
        bundle: input.bundle,
        version,
        inspection: finalInspection,
        qaRunId: finalInspection.qaRunId ?? `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`,
        visualQa: finalVisualQa,
        repair: repairResult.repairLog,
        qualitySignals: input.qualitySignals
      })
    );
  } else if (repairResult.repairLog.attempted) {
    version.generationQa = { ...version.generationQa, repair: repairResult.repairLog };
  }

  version.generationQa = applyUnresolvedRepairTargetReadinessGate(version.generationQa);

  return {
    status: version.generationQa.readiness === "ready" ? "ready" : "blocked",
    qa: version.generationQa,
    repaired: repairResult.repairLog.applied
  };
}

async function buildDeterministicGeneratedSiteQa(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  artifactRoot?: string;
  repair?: GenerationQaRepairLog;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
}): Promise<{ qa: GenerationQaMetadata }> {
  const qaRunId = `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`;
  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: input.bundle,
    version: input.version,
    qaRunId,
    artifactRoot: input.artifactRoot
  });
  const visualQa = await createGeneratedVisualQa({
    bundle: input.bundle,
    inspection,
    telemetry: input.telemetry,
    spanId: input.spanId,
    allowModel: false,
    reason: "Generated-site repair loop uses deterministic visual checks; model visual QA is reserved for final acceptance."
  });
  input.bundle.presenceAssessment.generationCostEstimate = finalizeGenerationCostEstimate({
    previous: input.bundle.presenceAssessment.generationCostEstimate,
    generatedRenderInspection: inspection,
    generatedVisualQa: visualQa
  });
  return {
    qa: withQualityGate(
      input.bundle,
      input.version,
      buildGeneratedSiteQaMetadata({
        bundle: input.bundle,
        version: input.version,
        inspection,
        qaRunId,
        visualQa,
        repair: input.repair,
        qualitySignals: input.qualitySignals
      })
    )
  };
}

async function runBoundedGeneratedSiteRepairLoop(input: {
  bundle: SiteBundle;
  versionId: string;
  initialQa: GenerationQaMetadata;
  mode: GeneratedSiteRepairMode;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  artifactRoot?: string;
}): Promise<{ qa: GenerationQaMetadata; repairLog: GenerationQaRepairLog }> {
  const attemptedAt = new Date().toISOString();
  const maxPasses = maxGeneratedSiteRepairPasses(input.mode);
  const patches: GenerationQaRepairPatch[] = [];
  let currentQa = input.initialQa;
  let passCount = 0;

  if (!canRepairVersion(versionById(input.bundle, input.versionId))) {
    const repairLog = repairLogForState({ attemptedAt, mode: input.mode, maxPasses, passCount, patches, qa: currentQa });
    input.bundle.presenceAssessment.generationRepairStateV1 = repairStateForLog(repairLog, input.mode, maxPasses);
    return { qa: currentQa, repairLog };
  }

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    passCount = pass;
    let appliedThisPass = false;

    const directorTargets = orderedLiveRepairTargets(currentQa).filter((target) => target.target === "director_plan");
    for (const target of directorTargets) {
      const result = await attemptRepairPatch({
        bundle: input.bundle,
        versionId: input.versionId,
        currentQa,
        mode: input.mode,
        maxPasses,
        pass,
        telemetry: input.telemetry,
        spanId: input.spanId,
        artifactRoot: input.artifactRoot,
        mutate: (bundle, version) => applyGeneratedSiteRepairTarget({ bundle, version, target, pass, telemetry: input.telemetry, spanId: input.spanId }),
        target
      });
      patches.push(...result.patches);
      currentQa = result.qa;
      appliedThisPass ||= result.applied;
    }

    const mechanical = await attemptRepairPatch({
      bundle: input.bundle,
      versionId: input.versionId,
      currentQa,
      mode: input.mode,
      maxPasses,
      pass,
      telemetry: input.telemetry,
      spanId: input.spanId,
      artifactRoot: input.artifactRoot,
      mutate: (bundle, version) => applyMechanicalGeneratedSiteCleanupPatches({ bundle, version, pass })
    });
    patches.push(...mechanical.patches);
    currentQa = mechanical.qa;
    appliedThisPass ||= mechanical.applied;

    const copyTargets = orderedLiveRepairTargets(currentQa).filter((target) => target.target === "copy_slot");
    for (const target of copyTargets) {
      const result = await attemptRepairPatch({
        bundle: input.bundle,
        versionId: input.versionId,
        currentQa,
        mode: input.mode,
        maxPasses,
        pass,
        telemetry: input.telemetry,
        spanId: input.spanId,
        artifactRoot: input.artifactRoot,
        mutate: (bundle, version) => applyGeneratedSiteRepairTarget({ bundle, version, target, pass, telemetry: input.telemetry, spanId: input.spanId }),
        target
      });
      patches.push(...result.patches);
      currentQa = result.qa;
      appliedThisPass ||= result.applied;
    }

    const assetTargets = orderedLiveRepairTargets(currentQa).filter((target) => target.target === "asset_crop");
    for (const target of assetTargets) {
      const result = await attemptRepairPatch({
        bundle: input.bundle,
        versionId: input.versionId,
        currentQa,
        mode: input.mode,
        maxPasses,
        pass,
        telemetry: input.telemetry,
        spanId: input.spanId,
        artifactRoot: input.artifactRoot,
        mutate: (bundle, version) => applyGeneratedSiteRepairTarget({ bundle, version, target, pass, telemetry: input.telemetry, spanId: input.spanId }),
        target
      });
      patches.push(...result.patches);
      currentQa = result.qa;
      appliedThisPass ||= result.applied;
    }

    if (!appliedThisPass || currentQa.readiness === "ready") break;
  }

  const repairLog = repairLogForState({ attemptedAt, mode: input.mode, maxPasses, passCount, patches, qa: currentQa });
  currentQa = { ...currentQa, repair: repairLog };
  versionById(input.bundle, input.versionId).generationQa = currentQa;
  input.bundle.presenceAssessment.generationRepairStateV1 = repairStateForLog(repairLog, input.mode, maxPasses);
  return { qa: currentQa, repairLog };
}

async function attemptRepairPatch(input: {
  bundle: SiteBundle;
  versionId: string;
  currentQa: GenerationQaMetadata;
  mode: GeneratedSiteRepairMode;
  maxPasses: number;
  pass: number;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  artifactRoot?: string;
  mutate: (bundle: SiteBundle, version: SiteVersion) => Promise<GenerationQaRepairPatch | GenerationQaRepairPatch[] | undefined> | GenerationQaRepairPatch | GenerationQaRepairPatch[] | undefined;
  target?: GenerationQaRepairTarget;
}): Promise<{ qa: GenerationQaMetadata; patches: GenerationQaRepairPatch[]; applied: boolean }> {
  const candidateBundle = structuredClone(input.bundle) as SiteBundle;
  const candidateVersion = versionById(candidateBundle, input.versionId);
  const proposed = await input.mutate(candidateBundle, candidateVersion);
  const proposedPatches = (Array.isArray(proposed) ? proposed : proposed ? [proposed] : []).filter(Boolean);
  if (!proposedPatches.length) return { qa: input.currentQa, patches: [], applied: false };

  const validation = await buildDeterministicGeneratedSiteQa({
    bundle: candidateBundle,
    version: candidateVersion,
    telemetry: input.telemetry,
    spanId: input.spanId,
    artifactRoot: input.artifactRoot
  });
  const introduced = introducedBlockerIds(input.currentQa, validation.qa);
  const targetStillPresent = input.target ? repairTargetStillPresent(input.target, validation.qa) : false;
  const rejectReason = introduced.length
    ? `Repair introduced new blockers: ${introduced.join(", ")}.`
    : input.target && targetStillPresent
      ? `Repair did not clear ${input.target.id}.`
      : undefined;

  if (rejectReason) {
    return {
      qa: input.currentQa,
      patches: proposedPatches.map((patch) => patchWasRejected(patch, rejectReason, introduced)),
      applied: false
    };
  }

  replaceBundleWithCandidate(input.bundle, candidateBundle, input.versionId);
  const acceptedPatches = proposedPatches.map((patch) =>
    patchWasApplied({
      ...patch,
      clearedFindingIds: input.target ? [input.target.findingId] : patch.clearedFindingIds
    })
  );
  const repairLog = repairLogForState({
    attemptedAt: new Date().toISOString(),
    mode: input.mode,
    maxPasses: input.maxPasses,
    passCount: input.pass,
    patches: acceptedPatches,
    qa: validation.qa
  });
  const acceptedQa = { ...validation.qa, repair: repairLog };
  versionById(input.bundle, input.versionId).generationQa = acceptedQa;
  return { qa: acceptedQa, patches: acceptedPatches, applied: acceptedPatches.some((patch) => patch.status === "applied") };
}

function introducedBlockerIds(before: GenerationQaMetadata, after: GenerationQaMetadata) {
  const beforeIds = new Set(before.blockers.map((blocker) => blocker.id));
  return after.blockers.map((blocker) => blocker.id).filter((id) => !beforeIds.has(id));
}

function repairTargetStillPresent(target: GenerationQaRepairTarget, qa: GenerationQaMetadata) {
  return (qa.repairTargets ?? []).some((candidate) => candidate.id === target.id);
}

function replaceBundleWithCandidate(bundle: SiteBundle, candidate: SiteBundle, versionId: string) {
  const index = bundle.siteModel.versions.findIndex((version) => version.id === versionId);
  if (index === -1) throw new Error(`Generated site repair could not replace unknown version ${versionId}.`);
  bundle.siteModel.versions[index] = candidate.siteModel.versions[index];
  bundle.presenceAssessment = candidate.presenceAssessment;
}

function repairLogForState(input: {
  attemptedAt: string;
  mode: GeneratedSiteRepairMode;
  maxPasses: number;
  passCount: number;
  patches: GenerationQaRepairPatch[];
  qa: GenerationQaMetadata;
}): GenerationQaRepairLog {
  const mutationSummaries = input.patches
    .filter((patch) => patch.status === "applied")
    .map((patch) => patch.mutationSummary);
  const unresolvedTargetIds = (input.qa.repairTargets ?? [])
    .filter((target) => target.activation === "live")
    .map((target) => target.id);
  return {
    attempted: true,
    applied: mutationSummaries.length > 0,
    attemptedAt: input.attemptedAt,
    mutationSummaries,
    unresolvedBlockerIds: input.qa.blockers.map((blocker) => blocker.id),
    passCount: input.passCount,
    patches: input.patches,
    unresolvedTargetIds
  };
}

function repairStateForLog(repairLog: GenerationQaRepairLog, mode: GeneratedSiteRepairMode, maxPasses: number) {
  return {
    version: "generation-repair-state-v1" as const,
    attemptedAt: repairLog.attemptedAt ?? new Date().toISOString(),
    mode,
    maxPasses,
    passCount: repairLog.passCount ?? 0,
    patches: repairLog.patches ?? [],
    unresolvedTargetIds: repairLog.unresolvedTargetIds ?? [],
    unresolvedBlockerIds: repairLog.unresolvedBlockerIds
  };
}

function canRepairVersion(version: SiteVersion) {
  return version.rendererVersion === "layout-v3" && version.status === "draft" && !version.ownerTouched && !version.ownerApprovedAt;
}

function versionById(bundle: SiteBundle, versionId: string): SiteVersion {
  const version = bundle.siteModel.versions.find((candidate) => candidate.id === versionId);
  if (!version) throw new Error(`Generated site has no version ${versionId}.`);
  return version;
}

function withQualityGate(bundle: SiteBundle, version: SiteVersion, qa: GenerationQaMetadata): GenerationQaMetadata {
  if (version.rendererVersion !== "layout-v3") return qa;
  const mobileIssueCount =
    qa.blockers.filter((blocker) => blocker.viewport === "mobile").length +
    qa.warnings.filter((warning) => warning.viewport === "mobile").length;
  const report = evaluateGenerationQualityV2({ bundle, version, mobileIssueCount, visualQa: qa.visualQa });
  const gated = withQualityReportBlockers(qa, report);
  const factCoverage = buildFactCoverageReport({ bundle, version });
  const scorecard = buildGenerationScorecard({
    qualityReport: gated.qualityReport,
    visualQa: gated.visualQa,
    bundle,
    version,
    blockers: gated.blockers,
    warnings: gated.warnings,
    brandCueApplied: bundle.presenceAssessment.brandCueReport?.applied,
    aboveFoldCta: gated.inspectionSummary?.metricsByViewport?.desktop?.aboveFoldCtaDetected,
    telLinkCount: gated.inspectionSummary?.metricsByViewport?.desktop?.telLinkCount,
    seoScore: evaluateSeoStructure({ bundle, version }).score,
    factCoverageRatio: factCoverage.coverageRatio
  });
  const enforcementBlockers = scorecardEnforcementBlockers(scorecard);
  const blockers = enforcementBlockers.length ? [...gated.blockers, ...enforcementBlockers] : gated.blockers;
  const repairTargets = buildGenerationRepairTargets({
    blockers,
    warnings: gated.warnings,
    scorecard,
    inspectionSummary: gated.inspectionSummary,
    visualQa: gated.visualQa
  });
  return {
    ...gated,
    scorecard,
    factCoverage,
    repairTargets,
    ...(enforcementBlockers.length
      ? { blockers, readiness: "blocked" as const }
      : {})
  };
}

export function applyUnresolvedRepairTargetReadinessGate(qa: GenerationQaMetadata): GenerationQaMetadata {
  const unresolvedHighLiveTargets = (qa.repairTargets ?? []).filter((target) => target.activation === "live" && target.priority === "high");
  if (!unresolvedHighLiveTargets.length) return qa;
  const unresolvedIds = new Set(qa.repair?.unresolvedTargetIds ?? unresolvedHighLiveTargets.map((target) => target.id));
  const gatedTargets = unresolvedHighLiveTargets.filter((target) => unresolvedIds.has(target.id));
  if (!gatedTargets.length) return qa;
  const blocker: GenerationQaBlocker = {
    id: "repair_unresolved_live_targets",
    title: "High-priority repair targets are unresolved",
    detail: `The generation repair loop left ${gatedTargets.length} high-priority live target(s) unresolved: ${gatedTargets
      .slice(0, 5)
      .map((target) => target.title)
      .join("; ")}.`,
    category: "needs_operator_review" as const,
    severity: "blocking" as const
  };
  return {
    ...qa,
    readiness: "blocked",
    blockers: dedupeBlockers([...qa.blockers, blocker])
  };
}

function withQualityReportBlockers(
  qa: GenerationQaMetadata,
  report: ReturnType<typeof evaluateGenerationQualityV2>
): GenerationQaMetadata {
  const qualityBlockers = report.findings
    .filter((finding) => finding.severity === "blocking")
    .map((finding) => ({
      id: `quality_${finding.id}`,
      title: "Generated site failed a quality check",
      detail: finding.detail,
      category: "quality_failed" as const,
      severity: "blocking" as const
    }));
  if (!qualityBlockers.length) return { ...qa, qualityReport: report };
  return {
    ...qa,
    readiness: "blocked",
    blockers: dedupeBlockers([...qa.blockers, ...qualityBlockers]),
    qualityReport: report
  };
}

function dedupeBlockers<T extends { id: string }>(blockers: T[]) {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    if (seen.has(blocker.id)) return false;
    seen.add(blocker.id);
    return true;
  });
}

async function createGeneratedVisualQa(input: {
  bundle: SiteBundle;
  inspection: Awaited<ReturnType<typeof inspectGeneratedSiteBundleRender>>;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  allowModel: boolean;
  reason?: string;
  modelFallbackPolicy?: ModelFallbackPolicy;
}) {
  const costAllowsModel = isModelVisualQaAllowed(input.bundle.presenceAssessment.generationCostEstimate, "generated_site");
  const qa = await createOpenAiVisualQa({
    bundle: input.bundle,
    renderInspection: input.inspection,
    telemetry: input.telemetry,
    spanId: input.spanId,
    modelReview: {
      allowed: input.allowModel && costAllowsModel,
      reason:
        input.reason ??
        "Generated-site model visual QA was skipped by the generation cost policy; deterministic generated-site visual QA still ran."
    }
  });
  if (input.allowModel && input.modelFallbackPolicy !== "allow" && qa.source !== "openai") {
    const reason = qa.limitations.length ? ` ${qa.limitations.join(" ")}` : "";
    throw new Error(`Canonical generateSite requires model-backed generated-site visual QA; deterministic visual QA fallback is disabled.${reason}`);
  }
  return qa;
}
