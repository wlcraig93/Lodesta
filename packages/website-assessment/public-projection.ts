import type {
  AssessmentCriterion,
  WebsiteAssessment
} from "./contracts";
import {
  agentReadinessCheckDefinitions,
  agentReadinessMethodologyIdentity
} from "./agent-readiness";
import {
  visualQualityGroupLabels,
  visualQualityMethodologyIdentity
} from "./visual-quality";

export type PublicWebsiteAssessmentFinding = {
  id: string;
  dimension: string;
  controlOwner: AssessmentCriterion["controlOwner"];
  severity: "critical" | "major" | "minor" | "advisory";
  status: "fail" | "warning";
  title: string;
  explanation: string;
  businessConsequence: string;
  evidence: string[];
  recommendation: string;
};

type PublicAssessmentStrength = {
  id: string;
  dimension: string;
  controlOwner: AssessmentCriterion["controlOwner"];
  title: string;
  evidence: string[];
};

type PublicAdvisoryCoverage = {
  value: number;
  assessedChecks: number;
  applicableChecks: number;
  limitations: string[];
};

export type PublicWebsiteAssessmentProjection = {
  schemaVersion: 2;
  kind: "public-website-health-report";
  assessmentId: string;
  generatedAt: string;
  sourceUrl?: string;
  methodology: {
    producerIdentity: string;
    registryIdentity: string;
    scannerIdentity: string;
    routeSelectionIdentity: string;
  };
  coverage: {
    siteEvidence: number;
    pipelineCompleteness: number;
    assessedCriteria: number;
    applicableCriteria: number;
    provisional: boolean;
    limitations: string[];
  };
  snapshot: {
    verifiedChecks: number;
    opportunityChecks: number;
    unverifiedChecks: number;
    assessedChecks: number;
    applicableChecks: number;
  };
  grade: {
    withheld: true;
    note: string;
  };
  dimensions: Array<{
    id: string;
    label: string;
    state: WebsiteAssessment["dimensions"][number]["state"];
    reviewMode: "measured" | "advisory";
    siteEvidence: number;
    pipelineCompleteness: number;
    verifiedChecks: number;
    opportunityChecks: number;
    unverifiedChecks: number;
    notApplicableChecks: number;
  }>;
  siteInventory: WebsiteAssessment["siteInventory"];
  siteUnderstanding: {
    businessName?: string;
    primaryLocation?: string;
    services: string[];
    customerJourneys: string[];
  };
  whatsWorking: PublicAssessmentStrength[];
  findings: PublicWebsiteAssessmentFinding[];
  agentReadiness: {
    methodologyIdentity: string;
    coverage: PublicAdvisoryCoverage;
    verified: Array<{
      id: string;
      group: string;
      title: string;
      evidence: string[];
    }>;
    findings: Array<PublicWebsiteAssessmentFinding & {
      authority: "cloudflare" | "lodesta";
      countedByAuthority: boolean;
    }>;
    note: string;
  };
  visualQuality: {
    methodologyIdentity: string;
    coverage: PublicAdvisoryCoverage;
    strengths: Array<{
      id: string;
      group: string;
      title: string;
      evidence: string[];
    }>;
    findings: PublicWebsiteAssessmentFinding[];
    note: string;
  };
};

export function publicWebsiteAssessmentProjection(
  assessment: WebsiteAssessment
): PublicWebsiteAssessmentProjection {
  const labels = new Map(
    assessment.dimensions.map((dimension) => [dimension.id, dimension.label])
  );
  const criteria = assessment.dimensions.flatMap((dimension) => dimension.criteria);
  const publicCriteria = criteria.filter((criterion) => criterion.publicEligible);
  const findings = publicCriteria
    .filter(isOpportunity)
    .sort(compareCriteria)
    .slice(0, 20)
    .map((criterion) => publicFinding(criterion, labels.get(criterion.dimensionId) ?? criterion.dimensionId));
  const whatsWorking = diverseStrengths(
    publicCriteria.filter((criterion) => criterion.status === "pass"),
    labels
  );
  const applicablePublicCriteria = publicCriteria.filter((criterion) => criterion.status !== "not_applicable");
  const assessedPublicCriteria = applicablePublicCriteria.filter(isAssessed);
  const agentReadiness = agentReadinessProjection(criteria, assessment.coverage.limitations);
  const visualQuality = visualQualityProjection(criteria, assessment);

  return {
    schemaVersion: 2,
    kind: "public-website-health-report",
    assessmentId: assessment.id,
    generatedAt: assessment.producer.generatedAt,
    sourceUrl: assessment.target.sourceUrl,
    methodology: {
      producerIdentity: assessment.producer.identity,
      registryIdentity: assessment.producer.rubricIdentity,
      scannerIdentity: assessment.producer.scannerIdentity,
      routeSelectionIdentity: assessment.producer.routeSelectionIdentity
    },
    coverage: {
      siteEvidence: assessment.coverage.siteEvidence,
      pipelineCompleteness: assessment.coverage.pipelineCompleteness,
      assessedCriteria: assessment.coverage.assessedCriteria,
      applicableCriteria: assessment.coverage.applicableCriteria,
      provisional: assessment.grade?.provisional ?? true,
      limitations: assessment.coverage.limitations
    },
    snapshot: {
      verifiedChecks: publicCriteria.filter((criterion) => criterion.status === "pass").length,
      opportunityChecks: publicCriteria.filter(isOpportunity).length,
      unverifiedChecks: publicCriteria.filter((criterion) => criterion.status === "unknown").length,
      assessedChecks: assessedPublicCriteria.length,
      applicableChecks: applicablePublicCriteria.length
    },
    grade: {
      withheld: true,
      note: "The public Website Health grade remains withheld until criterion-level calibration is complete and the product owner explicitly approves publication."
    },
    dimensions: assessment.dimensions.map((dimension) => {
      const reviewMode = dimension.id === "visual_editorial_craft" ? "advisory" as const : "measured" as const;
      const visibleCriteria = reviewMode === "advisory"
        ? dimension.criteria.filter((criterion) => criterion.topics.includes("visual_quality"))
        : dimension.criteria.filter((criterion) => criterion.publicEligible);
      return {
        id: dimension.id,
        label: dimension.label,
        state: dimension.state,
        reviewMode,
        siteEvidence: dimension.coverage.siteEvidence,
        pipelineCompleteness: dimension.coverage.pipelineCompleteness,
        verifiedChecks: visibleCriteria.filter((criterion) => criterion.status === "pass").length,
        opportunityChecks: visibleCriteria.filter(isOpportunity).length,
        unverifiedChecks: visibleCriteria.filter((criterion) => criterion.status === "unknown").length,
        notApplicableChecks: visibleCriteria.filter((criterion) => criterion.status === "not_applicable").length
      };
    }),
    siteInventory: assessment.siteInventory,
    siteUnderstanding: {
      businessName: assessment.siteUnderstanding.businessName,
      primaryLocation: assessment.siteUnderstanding.primaryLocation,
      services: assessment.siteUnderstanding.services,
      customerJourneys: assessment.siteUnderstanding.customerJourneys
    },
    whatsWorking,
    findings,
    agentReadiness,
    visualQuality
  };
}

function agentReadinessProjection(
  criteria: AssessmentCriterion[],
  reportLimitations: string[]
): PublicWebsiteAssessmentProjection["agentReadiness"] {
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const checks = agentReadinessCheckDefinitions.flatMap((definition) => {
    const criterion = criteriaById.get(agentCriterionId(definition.id));
    return criterion ? [{ definition, criterion }] : [];
  });
  const applicable = checks.filter(({ criterion }) => criterion.status !== "not_applicable");
  const assessed = applicable.filter(({ criterion }) => isAssessed(criterion));
  const limitations = reportLimitations.filter((limitation) =>
    /agent|answer|markdown|robots|crawl|sitemap|protocol/i.test(limitation)
  );
  return {
    methodologyIdentity: agentReadinessMethodologyIdentity,
    coverage: {
      value: applicable.length ? round(assessed.length / applicable.length) : 1,
      assessedChecks: assessed.length,
      applicableChecks: applicable.length,
      limitations
    },
    verified: checks
      .filter(({ criterion }) => criterion.status === "pass")
      .slice(0, 8)
      .map(({ definition, criterion }) => ({
        id: definition.id,
        group: agentGroupLabel(definition.groupId),
        title: definition.title,
        evidence: criterion.evidence.map((item) => item.summary)
      })),
    findings: checks
      .filter(({ criterion }) => isOpportunity(criterion))
      .sort((left, right) => compareCriteria(left.criterion, right.criterion))
      .slice(0, 12)
      .map(({ definition, criterion }) => {
        if (!isOpportunity(criterion)) {
          throw new Error(`Agent-readiness projection received non-opportunity criterion ${criterion.id}.`);
        }
        return {
          ...publicFinding(criterion, agentGroupLabel(definition.groupId), definition.id),
          authority: definition.standard.authority,
          countedByAuthority: definition.standard.countedByAuthority
        };
      }),
    note: "AEO and agent-readiness observations are advisory and are not included in the public grade. Emerging protocols are shown only when they apply to an advertised capability."
  };
}

function visualQualityProjection(
  criteria: AssessmentCriterion[],
  assessment: WebsiteAssessment
): PublicWebsiteAssessmentProjection["visualQuality"] {
  const checks = criteria.filter((criterion) => criterion.topics.includes("visual_quality"));
  const applicable = checks.filter((criterion) => criterion.status !== "not_applicable");
  const assessed = applicable.filter(isAssessed);
  const evaluator = assessment.evaluators.find((candidate) => candidate.kind === "model");
  const limitations = [
    ...assessment.coverage.limitations.filter((limitation) => /visual|screenshot|render|viewport/i.test(limitation)),
    ...(evaluator?.status === "completed" ? [] : ["The screenshot-based visual evaluator was unavailable for this report."])
  ];
  return {
    methodologyIdentity: visualQualityMethodologyIdentity,
    coverage: {
      value: applicable.length ? round(assessed.length / applicable.length) : 1,
      assessedChecks: assessed.length,
      applicableChecks: applicable.length,
      limitations: [...new Set(limitations)]
    },
    strengths: checks
      .filter((criterion) => criterion.status === "pass")
      .slice(0, 6)
      .map((criterion) => ({
        id: criterion.id,
        group: visualGroupLabel(criterion),
        title: criterion.title,
        evidence: criterion.evidence.map((item) => item.summary)
      })),
    findings: checks
      .filter(isOpportunity)
      .sort(compareCriteria)
      .slice(0, 12)
      .map((criterion) => publicFinding(criterion, visualGroupLabel(criterion))),
    note: "Visual Quality is an advisory screenshot review across sampled desktop and mobile frames. Browser measurements decide measurable defects; these observations are not a grade or a substitute for human review."
  };
}

function publicFinding(
  criterion: AssessmentCriterion & { status: "fail" | "warning" },
  dimension: string,
  id = criterion.id
): PublicWebsiteAssessmentFinding {
  return {
    id,
    dimension,
    controlOwner: criterion.controlOwner,
    severity: criterion.impact,
    status: criterion.status,
    title: criterion.title,
    explanation: criterion.explanation,
    businessConsequence: criterion.businessConsequence,
    evidence: criterion.evidence.map((item) => item.summary),
    recommendation: criterion.recommendation
  };
}

function diverseStrengths(
  criteria: AssessmentCriterion[],
  labels: Map<AssessmentCriterion["dimensionId"], string>
): PublicAssessmentStrength[] {
  const selected: AssessmentCriterion[] = [];
  const seenDimensions = new Set<AssessmentCriterion["dimensionId"]>();
  for (const criterion of criteria) {
    if (seenDimensions.has(criterion.dimensionId)) continue;
    selected.push(criterion);
    seenDimensions.add(criterion.dimensionId);
    if (selected.length === 8) break;
  }
  if (selected.length < 8) {
    for (const criterion of criteria) {
      if (selected.includes(criterion)) continue;
      selected.push(criterion);
      if (selected.length === 8) break;
    }
  }
  return selected.map((criterion) => ({
    id: criterion.id,
    dimension: labels.get(criterion.dimensionId) ?? criterion.dimensionId,
    controlOwner: criterion.controlOwner,
    title: criterion.title,
    evidence: criterion.evidence.map((item) => item.summary)
  }));
}

function agentCriterionId(id: string) {
  return {
    "agent.basic.home_reachable": "functional.home_reachable",
    "agent.basic.https": "functional.https",
    "agent.discoverability.robots": "discoverability.robots",
    "agent.discoverability.sitemap": "discoverability.sitemap"
  }[id] ?? id;
}

function agentGroupLabel(groupId: (typeof agentReadinessCheckDefinitions)[number]["groupId"]) {
  return groupId.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function visualGroupLabel(criterion: AssessmentCriterion) {
  const groupId = criterion.topics[1] as keyof typeof visualQualityGroupLabels | undefined;
  return groupId ? visualQualityGroupLabels[groupId] : "Visual quality";
}

function isOpportunity(
  criterion: AssessmentCriterion
): criterion is AssessmentCriterion & { status: "fail" | "warning" } {
  return criterion.status === "fail" || criterion.status === "warning";
}

function isAssessed(criterion: AssessmentCriterion) {
  return criterion.status !== "unknown" && criterion.status !== "not_applicable";
}

function compareCriteria(left: AssessmentCriterion, right: AssessmentCriterion) {
  return impactRank(left.impact) - impactRank(right.impact)
    || statusRank(left.status) - statusRank(right.status)
    || left.title.localeCompare(right.title);
}

function impactRank(value: AssessmentCriterion["impact"]) {
  return { critical: 0, major: 1, minor: 2, advisory: 3 }[value];
}

function statusRank(value: AssessmentCriterion["status"]) {
  return value === "fail" ? 0 : value === "warning" ? 1 : 2;
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
