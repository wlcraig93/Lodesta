import { createHash } from "node:crypto";
import type {
  AnalyticsSummary,
  Experiment,
  ExperimentLearning,
  SiteArtifactRecord,
  SiteBundle,
  SiteVersion,
  SourceAwareFactV2
} from "./models";

export type OptimizationReportFindingV2 = {
  id: string;
  severity: "pass" | "watch" | "action";
  area: "conversion" | "local_seo" | "page_gap" | "experiment";
  detail: string;
  recommendedAction: string;
  evidence: string[];
  affectedPageId?: string;
  affectedSectionId?: string;
  evidenceFactIds: string[];
};

export type OptimizationReportV2 = {
  id: string;
  skillId:
    | "optimization.conversion-insights"
    | "optimization.local-seo-refresh"
    | "optimization.page-gap-analysis"
    | "optimization.experiment-recommendations";
  versionId?: string;
  status: "collecting" | "ready" | "action_recommended";
  findings: OptimizationReportFindingV2[];
  scorecard: {
    actionItems: number;
    watchItems: number;
    passes: number;
  };
};

export type OptimizationReportsAuditV2Result = {
  skillIds: OptimizationReportV2["skillId"][];
  skillVersion: "direct-module-v1";
  versionId?: string;
  reports: {
    conversionInsights: OptimizationReportV2;
    localSeoRefresh: OptimizationReportV2;
    pageGapAnalysis: OptimizationReportV2;
    experimentRecommendations: OptimizationReportV2;
  };
  artifacts: SiteArtifactRecord[];
  summary: string;
};

export function runOptimizationReportsAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  analytics?: AnalyticsSummary;
  experiments?: Experiment[];
  learnings?: ExperimentLearning[];
  siteId?: string;
  createdAt?: string;
}): OptimizationReportsAuditV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const sourceFacts = input.bundle.presenceAssessment.businessFactGraph?.sourceFactsV2 ?? [];
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const reports = {
    conversionInsights: reportForFindings({
      id: "conversion_insights",
      skillId: "optimization.conversion-insights",
      versionId: version?.id,
      findings: conversionFindings(input.analytics)
    }),
    localSeoRefresh: reportForFindings({
      id: "local_seo_refresh",
      skillId: "optimization.local-seo-refresh",
      versionId: version?.id,
      findings: localSeoFindings(input.bundle, version, sourceFacts)
    }),
    pageGapAnalysis: reportForFindings({
      id: "page_gap_analysis",
      skillId: "optimization.page-gap-analysis",
      versionId: version?.id,
      findings: pageGapFindings(input.bundle, version, sourceFacts)
    }),
    experimentRecommendations: reportForFindings({
      id: "experiment_recommendations",
      skillId: "optimization.experiment-recommendations",
      versionId: version?.id,
      findings: experimentFindings({
        analytics: input.analytics,
        experiments: input.experiments ?? input.bundle.experiments,
        learnings: input.learnings ?? input.bundle.experimentLearnings ?? []
      })
    })
  };
  const artifacts = [
    artifactForReport({ siteId, report: reports.conversionInsights, artifactType: "conversion_insights_report", createdAt: input.createdAt, version }),
    artifactForReport({ siteId, report: reports.localSeoRefresh, artifactType: "local_seo_refresh_report", createdAt: input.createdAt, version }),
    artifactForReport({ siteId, report: reports.pageGapAnalysis, artifactType: "page_gap_analysis_report", createdAt: input.createdAt, version }),
    artifactForReport({ siteId, report: reports.experimentRecommendations, artifactType: "experiment_recommendation_report", createdAt: input.createdAt, version })
  ];
  const actionItems = Object.values(reports).reduce((sum, report) => sum + report.scorecard.actionItems, 0);

  return {
    skillIds: artifacts.map((artifact) => artifact.producerId as OptimizationReportV2["skillId"]),
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    reports,
    artifacts,
    summary: `${actionItems} optimization action item${actionItems === 1 ? "" : "s"} across conversion, local SEO, page gaps, and experiments.`
  };
}

function conversionFindings(analytics: AnalyticsSummary | undefined): OptimizationReportFindingV2[] {
  if (!analytics || analytics.sessions < 20) {
    return [
      {
        id: "conversion_collect_baseline",
        severity: "watch",
        area: "conversion",
        detail: "Not enough analytics sessions are available to make conversion changes confidently.",
        recommendedAction: "Keep collecting analytics before applying automated conversion changes.",
        evidence: [`sessions=${analytics?.sessions ?? 0}`],
        evidenceFactIds: []
      }
    ];
  }
  const findings: OptimizationReportFindingV2[] = [];
  findings.push({
    id: "conversion_action_rate",
    severity: analytics.actionRate < 0.03 ? "action" : "pass",
    area: "conversion",
    detail: `Primary action rate is ${Math.round(analytics.actionRate * 1000) / 10}%.`,
    recommendedAction: analytics.actionRate < 0.03 ? "Review hero CTA clarity, sticky CTA visibility, and contact section placement." : "Keep current primary conversion path and continue monitoring.",
    evidence: [`sessions=${analytics.sessions}`, `primaryActions=${analytics.primaryActions}`],
    evidenceFactIds: []
  });
  if (analytics.formStarts > 0 && analytics.formSubmits === 0) {
    findings.push({
      id: "conversion_form_dropoff",
      severity: "action",
      area: "conversion",
      detail: "Visitors started a form but did not submit it.",
      recommendedAction: "Review form length, required fields, and confirmation/error states.",
      evidence: [`formStarts=${analytics.formStarts}`, `formSubmits=${analytics.formSubmits}`],
      evidenceFactIds: []
    });
  }
  const weakSection = analytics.sectionConversionPaths
    .filter((path) => path.exposedSessions >= 10)
    .sort((left, right) => left.actionRate - right.actionRate)[0];
  if (weakSection && weakSection.actionRate < analytics.actionRate / 2) {
    findings.push({
      id: `conversion_section_${safeId(weakSection.sectionId)}`,
      severity: "watch",
      area: "conversion",
      detail: `${weakSection.sectionId} is underperforming against the page average.`,
      recommendedAction: "Review section copy, CTA role, and mobile placement before proposing a section-level refresh.",
      evidence: [`sectionActionRate=${weakSection.actionRate}`, `siteActionRate=${analytics.actionRate}`],
      affectedSectionId: weakSection.sectionId,
      evidenceFactIds: []
    });
  }
  return findings;
}

function localSeoFindings(bundle: SiteBundle, version: SiteVersion | undefined, facts: SourceAwareFactV2[]): OptimizationReportFindingV2[] {
  const pages = pagesForVersion(version);
  const sourceFactIds = durableFacts(facts, "service").concat(durableFacts(facts, "service_area")).map((fact) => fact.id);
  const city = bundle.businessProfile.address?.city ?? bundle.businessProfile.serviceAreas[0];
  const findings: OptimizationReportFindingV2[] = [
    {
      id: "local_seo_metadata_local_context",
      severity: pages.some((page) => page.seo.description.includes(city ?? bundle.businessProfile.name)) ? "pass" : "watch",
      area: "local_seo",
      detail: city ? `Local context candidate is ${city}.` : "No city or service-area context is available.",
      recommendedAction: city ? "Keep local context visible in titles, descriptions, and contact/location sections." : "Confirm a city or service area before creating local SEO pages.",
      evidence: [`pages=${pages.length}`, `city=${city ?? "missing"}`],
      evidenceFactIds: sourceFactIds
    }
  ];
  if (bundle.businessProfile.services.length >= 3 && !pages.some((page) => page.slug.startsWith("/services/"))) {
    findings.push({
      id: "local_seo_service_pages_missing",
      severity: "action",
      area: "local_seo",
      detail: "The business has several services but no service landing pages.",
      recommendedAction: "Use page-gap analysis to create only the service pages with durable source evidence.",
      evidence: bundle.businessProfile.services.slice(0, 5),
      evidenceFactIds: durableFacts(facts, "service").map((fact) => fact.id)
    });
  }
  if (!bundle.businessProfile.hours) {
    findings.push({
      id: "local_seo_hours_unavailable",
      severity: "watch",
      area: "local_seo",
      detail: "Hours are unavailable; this should not block a legitimate site, but sections must not imply known hours.",
      recommendedAction: "Render call-to-confirm language or omit hours until confirmed by a durable source.",
      evidence: ["hours=missing"],
      evidenceFactIds: []
    });
  }
  return findings;
}

function pageGapFindings(bundle: SiteBundle, version: SiteVersion | undefined, facts: SourceAwareFactV2[]): OptimizationReportFindingV2[] {
  const pages = pagesForVersion(version);
  const slugs = new Set(pages.map((page) => page.slug));
  const serviceFacts = durableFacts(facts, "service");
  const areaFacts = durableFacts(facts, "service_area");
  const findings = serviceFacts.slice(0, 6).map((fact): OptimizationReportFindingV2 => {
    const slug = `/services/${slugify(String(fact.value))}`;
    return {
      id: `page_gap_service_${safeId(String(fact.value))}`,
      severity: slugs.has(slug) ? "pass" : "action",
      area: "page_gap",
      detail: slugs.has(slug) ? `${slug} exists.` : `${String(fact.value)} has durable evidence but no dedicated service page.`,
      recommendedAction: slugs.has(slug) ? "Keep page current with service evidence." : "Draft a service page only if the compiled page can include differentiated local detail.",
      evidence: [String(fact.value)],
      evidenceFactIds: [fact.id]
    };
  });
  if (bundle.businessProfile.serviceAreas.length >= 2) {
    findings.push(...areaFacts.slice(0, 4).map((fact): OptimizationReportFindingV2 => {
      const slug = `/areas/${slugify(String(fact.value))}`;
      return {
        id: `page_gap_area_${safeId(String(fact.value))}`,
        severity: slugs.has(slug) ? "pass" : "watch",
        area: "page_gap",
        detail: slugs.has(slug) ? `${slug} exists.` : `${String(fact.value)} could support a location page if there is enough unique content.`,
        recommendedAction: "Do not create thin location pages; require service detail, contact path, and local proof before drafting.",
        evidence: [String(fact.value)],
        evidenceFactIds: [fact.id]
      };
    }));
  }
  if (!findings.length) {
    findings.push({
      id: "page_gap_no_durable_candidates",
      severity: "watch",
      area: "page_gap",
      detail: "No durable service or service-area facts are available for page expansion.",
      recommendedAction: "Refresh business context before recommending new pages.",
      evidence: [],
      evidenceFactIds: []
    });
  }
  return findings;
}

function experimentFindings(input: {
  analytics?: AnalyticsSummary;
  experiments: Experiment[];
  learnings: ExperimentLearning[];
}): OptimizationReportFindingV2[] {
  const activeLearning = input.learnings.find((learning) => learning.status === "active");
  if (activeLearning) {
    return [
      {
        id: `experiment_learning_${safeId(activeLearning.id)}`,
        severity: "action",
        area: "experiment",
        detail: `${activeLearning.winnerLabel} beat control for ${activeLearning.primaryMetric} with ${activeLearning.confidence} confidence.`,
        recommendedAction: "Review and apply the active experiment learning through the compiler instead of hand-editing the site.",
        evidence: [`lift=${activeLearning.observedLift}`, `assignments=${activeLearning.totalAssignments}`],
        evidenceFactIds: []
      }
    ];
  }
  const running = input.experiments.filter((experiment) => experiment.status === "running");
  if (running.length) {
    return running.map((experiment) => ({
      id: `experiment_running_${safeId(experiment.id)}`,
      severity: "watch" as const,
      area: "experiment" as const,
      detail: `${experiment.surface} experiment is already running.`,
      recommendedAction: "Do not start another overlapping experiment on the same surface until this one concludes.",
      evidence: [experiment.hypothesis],
      evidenceFactIds: []
    }));
  }
  if (!input.analytics || input.analytics.sessions < 50) {
    return [
      {
        id: "experiment_collect_baseline",
        severity: "watch",
        area: "experiment",
        detail: "Experiment recommendations need a larger analytics baseline.",
        recommendedAction: "Collect at least 50 sessions before starting an optimization experiment.",
        evidence: [`sessions=${input.analytics?.sessions ?? 0}`],
        evidenceFactIds: []
      }
    ];
  }
  return [
    {
      id: "experiment_recommend_sticky_cta",
      severity: "action",
      area: "experiment",
      detail: "A sticky CTA experiment is available for the current traffic baseline.",
      recommendedAction: "Create a draft sticky CTA experiment with tel/form action rate as the primary metric.",
      evidence: [`sessions=${input.analytics.sessions}`, `actionRate=${input.analytics.actionRate}`],
      evidenceFactIds: []
    }
  ];
}

function reportForFindings(input: {
  id: OptimizationReportV2["id"];
  skillId: OptimizationReportV2["skillId"];
  versionId?: string;
  findings: OptimizationReportFindingV2[];
}): OptimizationReportV2 {
  const scorecard = {
    actionItems: input.findings.filter((finding) => finding.severity === "action").length,
    watchItems: input.findings.filter((finding) => finding.severity === "watch").length,
    passes: input.findings.filter((finding) => finding.severity === "pass").length
  };
  return {
    id: input.id,
    skillId: input.skillId,
    versionId: input.versionId,
    status: scorecard.actionItems ? "action_recommended" : scorecard.watchItems ? "collecting" : "ready",
    findings: input.findings,
    scorecard
  };
}

function artifactForReport(input: {
  siteId: string;
  report: OptimizationReportV2;
  artifactType: SiteArtifactRecord["artifactType"];
  createdAt?: string;
  version?: SiteVersion;
}): SiteArtifactRecord {
  const payload = { report: input.report };
  const contentHash = hashPayload(payload);
  return {
    id: `artifact_${input.siteId}_${input.report.id}_${contentHash.slice(0, 16)}`,
    siteId: input.siteId,
    scope: "site_alternative",
    artifactType: input.artifactType,
    artifactVersion: `${input.report.id}-report-v2`,
    producerId: input.report.skillId,
    producerVersion: "direct-module-v1",
    verticalPlaybookVersion: input.version?.rendererVersion === "layout-v2" ? input.version.blueprint.verticalPlaybookVersion : undefined,
    sourceFactIds: Array.from(new Set(input.report.findings.flatMap((finding) => finding.evidenceFactIds))),
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

function pagesForVersion(version: SiteVersion | undefined) {
  if (!version) return [];
  if (version.rendererVersion === "layout-v3") return version.pageComposition.pages;
  return [];
}

function durableFacts(facts: SourceAwareFactV2[], kind: SourceAwareFactV2["kind"]) {
  return facts.filter((fact) => fact.kind === kind && fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function safeId(value: string) {
  return slugify(value).replace(/-/g, "_") || "item";
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
