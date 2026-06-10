import type { GenerationQaMetadata, SiteBundle, SiteCandidateStatus, SiteVersion } from "./models";
import type { AgentTelemetryRecorder } from "./agent-telemetry";
import { applyDeterministicGeneratedSiteRepair } from "./generated-site-repair";
import { buildGeneratedSiteQaMetadata } from "./generated-site-qa";
import { inspectGeneratedSiteBundleRender } from "./generated-site-render-inspection";
import { finalizeGenerationCostEstimate, isModelVisualQaAllowed } from "./generation-cost";
import { computeSiteModelHash } from "./site-version-metadata";
import { createOpenAiVisualQa } from "./visual-qa";

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
}): Promise<GeneratedSiteReadinessResult> {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "draft") ?? input.bundle.siteModel.versions[0];
  if (!version) {
    throw new Error("Generated site has no renderable version.");
  }

  const firstQaRunId = `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`;
  const firstInspection = await inspectGeneratedSiteBundleRender({
    bundle: input.bundle,
    version,
    qaRunId: firstQaRunId
  });
  const firstVisualQa = await createGeneratedVisualQa({
    bundle: input.bundle,
    inspection: firstInspection,
    telemetry: input.telemetry,
    spanId: input.spanId,
    allowModel: false,
    reason: "Pre-repair generated-site visual QA uses deterministic checks; model review is reserved for the final generated candidate."
  });
  input.bundle.presenceAssessment.generationCostEstimate = finalizeGenerationCostEstimate({
    previous: input.bundle.presenceAssessment.generationCostEstimate,
    generatedRenderInspection: firstInspection,
    generatedVisualQa: firstVisualQa
  });
  version.generationQa = buildGeneratedSiteQaMetadata({
    bundle: input.bundle,
    version,
    inspection: firstInspection,
    qaRunId: firstQaRunId,
    visualQa: firstVisualQa
  });

  if (version.generationQa.blockers.length && version.status === "draft" && !version.ownerTouched && !version.ownerApprovedAt) {
    const repair = applyDeterministicGeneratedSiteRepair({
      bundle: input.bundle,
      version,
      blockers: version.generationQa.blockers
    });
    if (repair.applied && computeSiteModelHash(input.bundle, version) !== version.generationQa.siteModelHash) {
      const secondQaRunId = `generated_qa_${crypto.randomUUID().replace(/-/g, "")}`;
      const secondInspection = await inspectGeneratedSiteBundleRender({
        bundle: input.bundle,
        version,
        qaRunId: secondQaRunId
      });
      const secondVisualQa = await createGeneratedVisualQa({
        bundle: input.bundle,
        inspection: secondInspection,
        telemetry: input.telemetry,
        spanId: input.spanId,
        allowModel: true
      });
      input.bundle.presenceAssessment.generationCostEstimate = finalizeGenerationCostEstimate({
        previous: input.bundle.presenceAssessment.generationCostEstimate,
        generatedRenderInspection: secondInspection,
        generatedVisualQa: secondVisualQa
      });
      version.generationQa = buildGeneratedSiteQaMetadata({
        bundle: input.bundle,
        version,
        inspection: secondInspection,
        qaRunId: secondQaRunId,
        visualQa: secondVisualQa,
        repair
      });
      return {
        status: version.generationQa.readiness === "ready" ? "ready" : "blocked",
        qa: version.generationQa,
        repaired: true
      };
    }
  }

  if (version.generationQa.readiness === "ready") {
    const finalVisualQa = await createGeneratedVisualQa({
      bundle: input.bundle,
      inspection: firstInspection,
      telemetry: input.telemetry,
      spanId: input.spanId,
      allowModel: true
    });
    input.bundle.presenceAssessment.generationCostEstimate = finalizeGenerationCostEstimate({
      previous: input.bundle.presenceAssessment.generationCostEstimate,
      generatedRenderInspection: firstInspection,
      generatedVisualQa: finalVisualQa
    });
    version.generationQa = buildGeneratedSiteQaMetadata({
      bundle: input.bundle,
      version,
      inspection: firstInspection,
      qaRunId: firstQaRunId,
      visualQa: finalVisualQa
    });
  }

  return {
    status: version.generationQa.readiness === "ready" ? "ready" : "blocked",
    qa: version.generationQa,
    repaired: false
  };
}

async function createGeneratedVisualQa(input: {
  bundle: SiteBundle;
  inspection: Awaited<ReturnType<typeof inspectGeneratedSiteBundleRender>>;
  telemetry?: AgentTelemetryRecorder;
  spanId?: string;
  allowModel: boolean;
  reason?: string;
}) {
  const costAllowsModel = isModelVisualQaAllowed(input.bundle.presenceAssessment.generationCostEstimate, "generated_site");
  return createOpenAiVisualQa({
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
}
