import type { GenerationQaBlocker, GenerationQaMetadata, SiteBundle, SiteCandidateStatus, SiteVersion } from "./models";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { inspectGeneratedSiteBundleRender } from "./generated-site-render-inspection";
import { finalizeGenerationCostEstimate } from "./generation-cost";
import { createOpenAiVisualQa } from "./visual-qa";
import { runGenerationGate } from "./generation-gate";
import type { ModelFallbackPolicy } from "./site-candidate-service";
import type { GeneratedSiteQualitySignalsV3 } from "./generated-site-v3-nav";

export type GeneratedSiteReadinessResult = {
  status: Extract<SiteCandidateStatus, "ready" | "blocked">;
  qa: GenerationQaMetadata;
  verdict: "pass" | "needs_regen" | "operator_review";
};

export async function runInitialGeneratedSiteReadiness(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  artifactRoot?: string;
  modelFallbackPolicy?: ModelFallbackPolicy;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
  signal?: AbortSignal;
}): Promise<GeneratedSiteReadinessResult> {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "draft") ?? input.bundle.siteModel.versions[0];
  if (!version) throw new Error("Generated site has no renderable version.");

  const qaRunId = `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`;
  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: input.bundle,
    version,
    qaRunId,
    artifactRoot: input.artifactRoot
  });
  return evaluateGeneratedSiteInspection({
    ...input,
    version,
    inspection,
    qaRunId
  });
}

export async function evaluateGeneratedSiteInspection(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  inspection: Awaited<ReturnType<typeof inspectGeneratedSiteBundleRender>>;
  qaRunId: string;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  qualitySignals?: GeneratedSiteQualitySignalsV3;
  signal?: AbortSignal;
}): Promise<GeneratedSiteReadinessResult> {
  const { version, inspection, qaRunId } = input;
  let qa = runGenerationGate({
    bundle: input.bundle,
    version,
    inspection,
    qaRunId,
    qualitySignals: input.qualitySignals
  });
  input.bundle.presenceAssessment.generationCostEstimate = finalizeGenerationCostEstimate({
    previous: input.bundle.presenceAssessment.generationCostEstimate,
    generatedRenderInspection: inspection
  });
  version.generationQa = qa;

  if (qa.readiness === "ready") {
    const visualQa = await createOpenAiVisualQa({
      bundle: input.bundle,
      renderInspection: inspection,
      telemetry: input.telemetry,
      spanId: input.spanId,
      signal: input.signal,
      modelReview: {
        allowed: true,
        reason: "Generated-site readiness requires one final visual judgment after the deterministic gate."
      }
    });
    input.bundle.presenceAssessment.generationCostEstimate = finalizeGenerationCostEstimate({
      previous: input.bundle.presenceAssessment.generationCostEstimate,
      generatedRenderInspection: inspection
    });
    qa = runGenerationGate({
      bundle: input.bundle,
      version,
      inspection,
      qaRunId,
      visualQa,
      qualitySignals: input.qualitySignals
    });
    version.generationQa = qa;
  }

  return {
    status: qa.readiness === "ready" ? "ready" : "blocked",
    qa,
    verdict: readinessVerdict(qa)
  };
}

function readinessVerdict(qa: GenerationQaMetadata): GeneratedSiteReadinessResult["verdict"] {
  if (qa.readiness === "ready") return "pass";
  return qa.blockers.some((blocker: GenerationQaBlocker) => blocker.id === "visual_judge_needs_regen")
    ? "needs_regen"
    : "operator_review";
}
