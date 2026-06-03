import { createHash } from "node:crypto";
import type { GenerationArtifactV2, RenderInspectionSummary, SiteBundle, SiteVersion } from "./models";
import { webVitalThresholds } from "./web-vitals-standard";

export type PerformanceAuditFindingV2 = {
  id: string;
  severity: "pass" | "warning" | "blocking";
  metric: "render_inspection" | "html_bytes" | "image_loading" | "horizontal_overflow" | "field_vitals";
  detail: string;
};

export type PerformanceAuditV2Result = {
  skillId: "optimization.performance-audit";
  skillVersion: "direct-module-v1";
  versionId?: string;
  findings: PerformanceAuditFindingV2[];
  artifact: GenerationArtifactV2;
  summary: string;
};

export function runPerformanceAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): PerformanceAuditV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const inspection = version?.generationQa?.inspectionSummary ?? input.bundle.presenceAssessment.renderInspection;
  const findings = performanceFindings(inspection);
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: version?.id,
    thresholds: webVitalThresholds,
    findings
  };
  const contentHash = hashPayload(payload);
  const artifact: GenerationArtifactV2 = {
    id: `artifact_${siteId}_performance_audit_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "managed_site_candidate",
    artifactType: "performance_audit_report",
    artifactVersion: "performance-audit-report-v2",
    producerId: "optimization.performance-audit",
    producerVersion: "direct-module-v1",
    sourceFactIds: [],
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  const blockers = findings.filter((finding) => finding.severity === "blocking").length;

  return {
    skillId: "optimization.performance-audit",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    findings,
    artifact,
    summary: `${findings.length} performance finding${findings.length === 1 ? "" : "s"}; ${blockers} blocker${blockers === 1 ? "" : "s"}.`
  };
}

function performanceFindings(inspection: RenderInspectionSummary | SiteBundle["presenceAssessment"]["renderInspection"] | undefined): PerformanceAuditFindingV2[] {
  if (!inspection) {
    return [
      {
        id: "performance_render_inspection_missing",
        severity: "warning",
        metric: "render_inspection",
        detail: "No generated-site render inspection is available; run generated-site QA before promotion."
      },
      {
        id: "performance_field_vitals_pending",
        severity: "warning",
        metric: "field_vitals",
        detail: "Field LCP, CLS, INP, and TTFB are measured after publication through analytics events."
      }
    ];
  }

  const metricsByViewport = inspection.metricsByViewport ?? {};
  const viewportMetrics = Object.values(metricsByViewport);
  const aggregateMetrics = "metrics" in inspection ? inspection.metrics : undefined;
  const findingCount = "findingCount" in inspection ? inspection.findingCount : inspection.findings.length;
  const failingFindingCount = "failingFindingCount" in inspection
    ? inspection.failingFindingCount
    : inspection.findings.filter((finding) => finding.severity === "fail").length;
  const findings: PerformanceAuditFindingV2[] = [
    {
      id: "performance_render_inspection_available",
      severity: failingFindingCount > 0 ? "blocking" : "pass",
      metric: "render_inspection",
      detail: `${inspection.adapter} inspection captured ${findingCount} finding${findingCount === 1 ? "" : "s"} with ${failingFindingCount} failure${failingFindingCount === 1 ? "" : "s"}.`
    }
  ];

  const htmlBytes = aggregateMetrics?.htmlBytes;
  if (typeof htmlBytes === "number") {
    findings.push({
      id: "performance_html_bytes",
      severity: htmlBytes <= 180_000 ? "pass" : htmlBytes <= 300_000 ? "warning" : "blocking",
      metric: "html_bytes",
      detail: `${Math.round(htmlBytes / 1024)}KB rendered HTML/CSS payload in lab inspection.`
    });
  }

  const brokenImages = viewportMetrics.reduce((sum, metrics) => sum + (metrics.brokenImageCount ?? 0), aggregateMetrics?.brokenImageCount ?? 0);
  findings.push({
    id: "performance_image_loading",
    severity: brokenImages > 0 ? "blocking" : "pass",
    metric: "image_loading",
    detail: brokenImages > 0 ? `${brokenImages} broken image observation${brokenImages === 1 ? "" : "s"} across inspected viewports.` : "No broken image observations in render inspection."
  });

  const maxOverflow = Math.max(0, ...viewportMetrics.map((metrics) => metrics.horizontalOverflowPx ?? 0), aggregateMetrics?.horizontalOverflowPx ?? 0);
  findings.push({
    id: "performance_horizontal_overflow",
    severity: maxOverflow > 2 ? "blocking" : "pass",
    metric: "horizontal_overflow",
    detail: `${Math.round(maxOverflow)}px maximum horizontal overflow observed.`
  });

  findings.push({
    id: "performance_field_vitals_pending",
    severity: "warning",
    metric: "field_vitals",
    detail: `Field vitals use launch thresholds LCP <= ${webVitalThresholds.LCP}ms, CLS <= ${webVitalThresholds.CLS}, INP <= ${webVitalThresholds.INP}ms, TTFB <= ${webVitalThresholds.TTFB}ms after publish.`
  });

  return findings;
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
