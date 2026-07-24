import type { AssessmentCriterion, WebsiteAssessment } from "./contracts";
import { assessmentDimensions } from "./rubric";

export type PublicWebsiteAssessmentFinding = {
  id: string;
  dimension: string;
  severity: "critical" | "major" | "minor" | "advisory";
  status: "fail" | "warning";
  title: string;
  explanation: string;
  businessConsequence: string;
  evidence: string[];
  recommendation: string;
};

export type PublicWebsiteAssessmentProjection = {
  schemaVersion: 1;
  kind: "public-website-assessment";
  assessmentId: string;
  generatedAt: string;
  sourceUrl?: string;
  coverage: {
    value: number;
    assessedCriteria: number;
    applicableCriteria: number;
    limitations: string[];
  };
  siteUnderstanding: {
    businessName?: string;
    primaryLocation?: string;
    services: string[];
    customerJourneys: string[];
  };
  whatsWorking: Array<{ id: string; dimension: string; title: string; evidence: string[] }>;
  findings: PublicWebsiteAssessmentFinding[];
};

export function publicWebsiteAssessmentProjection(assessment: WebsiteAssessment): PublicWebsiteAssessmentProjection {
  const labels = new Map(assessmentDimensions.map((dimension) => [dimension.id, dimension.label]));
  const criteria = assessment.dimensions.flatMap((dimension) => dimension.criteria);
  const findings = criteria
    .filter((criterion): criterion is AssessmentCriterion & { status: "fail" | "warning" } => criterion.status === "fail" || criterion.status === "warning")
    .filter(isPubliclyDefensible)
    .sort((left, right) => impactRank(left.impact) - impactRank(right.impact))
    .slice(0, 12)
    .map((criterion) => ({
      id: criterion.id,
      dimension: labels.get(criterion.dimensionId) ?? criterion.dimensionId,
      severity: criterion.impact,
      status: criterion.status,
      title: criterion.title,
      explanation: criterion.explanation,
      businessConsequence: criterion.businessConsequence,
      evidence: criterion.evidence.map((item) => item.summary),
      recommendation: criterion.recommendation
    }));
  const whatsWorking = criteria
    .filter((criterion) => criterion.status === "pass")
    .filter(isPubliclyDefensible)
    .slice(0, 8)
    .map((criterion) => ({
      id: criterion.id,
      dimension: labels.get(criterion.dimensionId) ?? criterion.dimensionId,
      title: criterion.title,
      evidence: criterion.evidence.map((item) => item.summary)
    }));
  return {
    schemaVersion: 1,
    kind: "public-website-assessment",
    assessmentId: assessment.id,
    generatedAt: assessment.producer.generatedAt,
    sourceUrl: assessment.target.sourceUrl,
    coverage: {
      value: assessment.coverage.value,
      assessedCriteria: assessment.coverage.assessedCriteria,
      applicableCriteria: assessment.coverage.applicableCriteria,
      limitations: assessment.coverage.limitations
    },
    siteUnderstanding: {
      businessName: assessment.siteUnderstanding.businessName,
      primaryLocation: assessment.siteUnderstanding.primaryLocation,
      services: assessment.siteUnderstanding.services,
      customerJourneys: assessment.siteUnderstanding.customerJourneys
    },
    whatsWorking,
    findings
  };
}

function isPubliclyDefensible(criterion: AssessmentCriterion) {
  return criterion.certainty !== "inferred" || (criterion.confidence ?? 0) >= 0.85;
}

function impactRank(value: AssessmentCriterion["impact"]) {
  return { critical: 0, major: 1, minor: 2, advisory: 3 }[value];
}
