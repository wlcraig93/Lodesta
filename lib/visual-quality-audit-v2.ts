import { createHash, randomUUID } from "node:crypto";
import type { SiteArtifactRecord, SiteBundle, SiteVersion, VisualQaResult } from "./models";
import { buildGeneratedSiteQaMetadata } from "./generated-site-qa";
import { inspectGeneratedSiteBundleRender } from "./generated-site-render-inspection";
import { computeSiteModelHash } from "./site-version-metadata";
import { createDeterministicVisualQa } from "./visual-qa";
import { createOpenAiVisualQa } from "./visual-qa";

export type VisualQualityAuditV2Result = {
  skillId: "design.visual-quality-audit";
  skillVersion: "direct-module-v1";
  versionId?: string;
  visualQa: VisualQaResult;
  artifact: SiteArtifactRecord;
  summary: string;
  updatedVersion?: SiteVersion;
};

export function runVisualQualityAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): VisualQualityAuditV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const visualQa =
    version?.generationQa?.visualQa ??
    input.bundle.presenceAssessment.visualQa ??
    createDeterministicVisualQa({
      bundle: input.bundle,
      limitation: "No generated-site visual QA result was stored; deterministic audit used the current SiteModel evidence."
    });
  return visualQualityResult({
    bundle: input.bundle,
    version,
    visualQa,
    siteId: input.siteId,
    createdAt: input.createdAt
  });
}

export async function runFreshVisualQualityAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
  allowModel?: boolean;
}): Promise<VisualQualityAuditV2Result> {
  const sourceVersion =
    input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  if (!sourceVersion) {
    return runVisualQualityAuditV2(input);
  }
  const version = structuredClone(sourceVersion);
  const qaRunId = `visual_quality_${randomUUID().replace(/-/g, "")}`;
  const inspection = await inspectGeneratedSiteBundleRender({
    bundle: input.bundle,
    version,
    qaRunId
  });
  const visualQa = await createOpenAiVisualQa({
    bundle: input.bundle,
    renderInspection: inspection,
    modelReview: {
      allowed: input.allowModel ?? true,
      reason: "Fresh visual quality audits are allowed to run model-backed screenshot review for operator calibration."
    }
  });
  version.generationQa = buildGeneratedSiteQaMetadata({
    bundle: input.bundle,
    version,
    inspection,
    qaRunId,
    visualQa
  });
  return visualQualityResult({
    bundle: input.bundle,
    version,
    visualQa,
    siteId: input.siteId,
    createdAt: input.createdAt,
    extraPayload: {
      siteModelHash: computeSiteModelHash(input.bundle, version),
      renderInspection: {
        adapter: inspection.adapter,
        target: inspection.target,
        metrics: inspection.metrics,
        findings: inspection.findings,
        screenshots: inspection.screenshots.map((screenshot) => ({
          viewport: screenshot.viewport,
          width: screenshot.width,
          height: screenshot.height,
          bytes: screenshot.bytes,
          path: screenshot.path,
          capturedAt: screenshot.capturedAt
        })),
        sectionScreenshots: (inspection.sectionScreenshots ?? []).map((screenshot) => ({
          viewport: screenshot.viewport,
          sectionIndex: screenshot.sectionIndex,
          sectionId: screenshot.sectionId,
          templateId: screenshot.templateId,
          label: screenshot.label,
          width: screenshot.width,
          height: screenshot.height,
          bytes: screenshot.bytes,
          path: screenshot.path,
          capturedAt: screenshot.capturedAt,
          clipped: screenshot.clipped
        })),
        sectionInspections: (inspection.sectionInspections ?? []).map((section) => ({
          viewport: section.viewport,
          sectionIndex: section.sectionIndex,
          sectionId: section.sectionId,
          templateId: section.templateId,
          label: section.label,
          fillRatio: section.fillRatio,
          headingOverflowPx: section.headingOverflowPx,
          blockOverlapMaxRatio: section.blockOverlapMaxRatio,
          figureOverlapMaxRatio: section.figureOverlapMaxRatio,
          crampedTextCount: section.crampedTextCount,
          brokenImageCount: section.brokenImageCount,
          minTextContrastRatio: section.minTextContrastRatio,
          findings: section.findings
        }))
      },
      readiness: version.generationQa.readiness,
      blockers: version.generationQa.blockers,
      warnings: version.generationQa.warnings
    }
  });
}

function visualQualityResult(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  visualQa: VisualQaResult;
  siteId?: string;
  createdAt?: string;
  extraPayload?: Record<string, unknown>;
}): VisualQualityAuditV2Result {
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: input.version?.id,
    visualQa: input.visualQa,
    ...input.extraPayload
  };
  const contentHash = hashPayload(payload);
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_visual_quality_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "visual_benchmark",
    artifactVersion: "visual-quality-audit-v2",
    producerId: "design.visual-quality-audit",
    producerVersion: "direct-module-v1",
    sourceFactIds: [],
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  const failures = input.visualQa.findings.filter((finding) => finding.severity === "fail").length;
  const warnings = input.visualQa.findings.filter((finding) => finding.severity === "warning").length;
  const score = input.visualQa.score?.overall ? `; score ${input.visualQa.score.overall}/100` : "";
  return {
    skillId: "design.visual-quality-audit",
    skillVersion: "direct-module-v1",
    versionId: input.version?.id,
    visualQa: input.visualQa,
    artifact,
    summary: `${input.visualQa.findings.length} visual QA finding${input.visualQa.findings.length === 1 ? "" : "s"}; ${failures} failures, ${warnings} warnings${score}.`,
    updatedVersion: input.version
  };
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
