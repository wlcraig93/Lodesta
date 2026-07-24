import type {
  AgentReadinessCheck,
  AssessmentCriterion,
  VisualQualityCheck,
  WebsiteAssessment
} from "./contracts";
import { agentReadinessGroupLabels } from "./agent-readiness";
import { assessmentDimensions } from "./rubric";
import {
  publiclyEligibleVisualQualityCheckIds,
  visualQualityGroupLabels
} from "./visual-quality";

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
  agentReadiness: {
    methodologyIdentity: string;
    coverage: {
      value: number;
      assessedChecks: number;
      applicableChecks: number;
      limitations: string[];
    };
    verified: Array<{ id: string; group: string; title: string; evidence: string[] }>;
    findings: Array<PublicWebsiteAssessmentFinding & {
      authority: "cloudflare" | "lodesta";
      countedByAuthority: boolean;
    }>;
    note: string;
  };
  visualQuality: {
    methodologyIdentity: string;
    coverage: {
      value: number;
      assessedChecks: number;
      applicableChecks: number;
      limitations: string[];
    };
    strengths: Array<{ id: string; group: string; title: string; evidence: string[] }>;
    findings: PublicWebsiteAssessmentFinding[];
    note: string;
  };
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
  const agentChecks = assessment.agentReadiness.groups.flatMap((group) => group.checks);
  const agentFindings = agentChecks
    .filter((check): check is AgentReadinessCheck & { status: "fail" | "warning" } => check.status === "fail" || check.status === "warning")
    .filter(isPubliclyDefensibleAgentCheck)
    .filter(isPubliclyRelevantAgentCheck)
    .sort((left, right) => impactRank(left.impact) - impactRank(right.impact))
    .slice(0, 6)
    .map((check) => ({
      id: check.id,
      dimension: agentReadinessGroupLabels[check.groupId],
      severity: check.impact,
      status: check.status,
      title: check.title,
      explanation: check.explanation,
      businessConsequence: check.businessConsequence,
      evidence: check.evidence.map((item) => item.summary),
      recommendation: check.recommendation,
      authority: check.standard.authority,
      countedByAuthority: check.standard.countedByAuthority
    }));
  const agentVerified = agentChecks
    .filter((check) => check.status === "pass")
    .filter(isPubliclyDefensibleAgentCheck)
    .filter(isPubliclyRelevantAgentCheck)
    .slice(0, Math.max(0, 6 - agentFindings.length))
    .map((check) => ({
      id: check.id,
      group: agentReadinessGroupLabels[check.groupId],
      title: check.title,
      evidence: check.evidence.map((item) => item.summary)
    }));
  const visualChecks = assessment.visualQuality.groups.flatMap((group) => group.checks);
  const visualFindings = visualChecks
    .filter((check): check is VisualQualityCheck & { status: "fail" | "warning" } => check.status === "fail" || check.status === "warning")
    .filter(isPubliclyDefensibleVisualCheck)
    .sort((left, right) => impactRank(left.impact) - impactRank(right.impact))
    .slice(0, 4)
    .map((check) => ({
      id: check.id,
      dimension: visualQualityGroupLabels[check.groupId],
      severity: check.impact,
      status: check.status,
      title: check.title,
      explanation: check.explanation,
      businessConsequence: check.businessConsequence,
      evidence: check.evidence.map((item) => item.summary),
      recommendation: check.recommendation
    }));
  const visualStrengths = visualChecks
    .filter((check) => check.status === "pass")
    .filter(isPubliclyDefensibleVisualCheck)
    .slice(0, Math.max(0, 4 - visualFindings.length))
    .map((check) => ({
      id: check.id,
      group: visualQualityGroupLabels[check.groupId],
      title: check.title,
      evidence: check.evidence.map((item) => item.summary)
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
    findings,
    agentReadiness: {
      methodologyIdentity: assessment.agentReadiness.methodologyIdentity,
      coverage: assessment.agentReadiness.coverage,
      verified: agentVerified,
      findings: agentFindings,
      note: "These checks align with Cloudflare's published Agent Readiness methodology and Lodesta's answer-readiness criteria. They are not an official Cloudflare score."
    },
    visualQuality: {
      methodologyIdentity: assessment.visualQuality.methodologyIdentity,
      coverage: assessment.visualQuality.coverage,
      strengths: visualStrengths,
      findings: visualFindings,
      note: "This is an AI-assisted review of retained website screenshots. It reports specific visual evidence, not a design score or grade."
    }
  };
}

function isPubliclyDefensible(criterion: AssessmentCriterion) {
  return criterion.certainty !== "inferred" || (criterion.confidence ?? 0) >= 0.85;
}

function isPubliclyDefensibleAgentCheck(check: AgentReadinessCheck) {
  return check.certainty !== "inferred" || (check.confidence ?? 0) >= 0.85;
}

function isPubliclyRelevantAgentCheck(check: AgentReadinessCheck) {
  return check.groupId !== "protocol_discovery"
    && check.groupId !== "commerce"
    && check.id !== "agent.bot.web_bot_auth";
}

function isPubliclyDefensibleVisualCheck(check: VisualQualityCheck) {
  return publiclyEligibleVisualQualityCheckIds.has(check.id)
    && (check.confidence ?? 0) >= 0.9
    && check.evidence.length > 0
    && check.evidence.every((item) =>
      item.kind === "screenshot"
      && Boolean(item.artifactKey)
      && Boolean(item.route)
      && (item.viewport === "desktop" || item.viewport === "mobile"));
}

function impactRank(value: AssessmentCriterion["impact"]) {
  return { critical: 0, major: 1, minor: 2, advisory: 3 }[value];
}
