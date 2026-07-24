import { createHash } from "node:crypto";
import {
  websiteAssessmentSchema,
  type AssessmentCriterion,
  type AssessmentCriterionInput,
  type AgentReadinessCheckInput,
  type VisualQuality,
  type WebsiteAssessment,
  type WebsiteAssessmentTargetKind
} from "./contracts";
import { buildAgentReadiness } from "./agent-readiness";
import { unavailableVisualQuality } from "./visual-quality";
import {
  assessmentCriteria,
  assessmentDimensions,
  minimumScoreCoverage,
  minimumVerticalConfidence,
  websiteAssessmentProducerIdentity,
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity
} from "./rubric";

export type BuildWebsiteAssessmentInput = {
  id?: string;
  target: {
    kind: WebsiteAssessmentTargetKind;
    sourceKey: string;
    sourceUrl?: string;
    siteId?: string;
    artifactId?: string;
    versionId?: string;
  };
  siteUnderstanding: WebsiteAssessment["siteUnderstanding"];
  criteria: AssessmentCriterionInput[];
  agentReadinessChecks: AgentReadinessCheckInput[];
  agentReadinessLimitations?: string[];
  visualQuality?: VisualQuality;
  limitations?: string[];
  generatedAt?: string;
  inputHashSource: unknown;
};

export function buildWebsiteAssessment(input: BuildWebsiteAssessmentInput): WebsiteAssessment {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const supplied = new Map(input.criteria.map((criterion) => [criterion.id, criterion]));
  const criteria = assessmentCriteria.map((definition): AssessmentCriterion => {
    const suppliedCriterion = supplied.get(definition.id);
    if (suppliedCriterion) {
      if (suppliedCriterion.dimensionId !== definition.dimensionId) {
        throw new Error(`Criterion ${definition.id} was assigned to the wrong dimension.`);
      }
      return {
        ...suppliedCriterion,
        impact: definition.impact,
        applicability: definition.applicability,
        businessConsequence: definition.businessConsequence,
        recommendation: definition.recommendation,
        pointsPossible: suppliedCriterion.pointsPossible ?? definition.points,
        pointsEarned: earnedPoints(suppliedCriterion.status, suppliedCriterion.pointsPossible ?? definition.points)
      };
    }
    const notApplicable = definition.applicability === "vertical"
      && input.siteUnderstanding.verticalConfidence < minimumVerticalConfidence;
    return {
      id: definition.id,
      dimensionId: definition.dimensionId,
      title: definition.title,
      status: notApplicable ? "not_applicable" : "unknown",
      impact: definition.impact,
      certainty: "deterministic",
      applicability: definition.applicability,
      explanation: notApplicable
        ? `Vertical-specific checks were not applied because vertical confidence was ${(input.siteUnderstanding.verticalConfidence * 100).toFixed(0)}%.`
        : "The available evidence did not support a reliable conclusion.",
      businessConsequence: definition.businessConsequence,
      recommendation: definition.recommendation,
      evidence: [{
        id: `${definition.id}.coverage`,
        kind: "system",
        summary: notApplicable
          ? "Criterion excluded from scoring because the business vertical was not known with sufficient confidence."
          : "No reliable evidence was captured for this criterion.",
        observedAt: generatedAt
      }],
      pointsPossible: definition.points
    };
  });

  const dimensions = assessmentDimensions.map((dimension) => {
    const dimensionCriteria = criteria.filter((criterion) => criterion.dimensionId === dimension.id);
    const applicable = dimensionCriteria.filter((criterion) => criterion.status !== "not_applicable");
    const assessed = applicable.filter((criterion) => criterion.status !== "unknown");
    const possible = applicable.reduce((total, criterion) => total + (criterion.pointsPossible ?? 0), 0);
    const assessedPossible = assessed.reduce((total, criterion) => total + (criterion.pointsPossible ?? 0), 0);
    const earned = assessed.reduce((total, criterion) => total + (criterion.pointsEarned ?? 0), 0);
    return {
      ...dimension,
      coverage: possible ? assessedPossible / possible : 1,
      score: assessedPossible ? round((earned / assessedPossible) * 100) : undefined,
      assessedCriteria: assessed.length,
      applicableCriteria: applicable.length,
      criteria: dimensionCriteria
    };
  });
  const totalPossible = criteria
    .filter((criterion) => criterion.status !== "not_applicable")
    .reduce((total, criterion) => total + (criterion.pointsPossible ?? 0), 0);
  const assessedPossible = criteria
    .filter((criterion) => criterion.status !== "not_applicable" && criterion.status !== "unknown")
    .reduce((total, criterion) => total + (criterion.pointsPossible ?? 0), 0);
  const coverage = totalPossible ? assessedPossible / totalPossible : 1;
  const scoreEligible = coverage >= minimumScoreCoverage;
  const weightedDimensions = dimensions.filter((dimension) => dimension.score !== undefined);
  const weightedTotal = weightedDimensions.reduce((total, dimension) => total + dimension.weight, 0);
  const scoreValue = weightedTotal
    ? round(weightedDimensions.reduce((total, dimension) => total + (dimension.score ?? 0) * dimension.weight, 0) / weightedTotal)
    : undefined;
  const criticalFailures = criteria.filter((criterion) => criterion.status === "fail" && criterion.impact === "critical");
  const score = scoreEligible && scoreValue !== undefined
    ? {
        value: scoreValue,
        verdict: criticalFailures.length ? "poor" as const : verdictFor(scoreValue),
        provisional: true
      }
    : undefined;

  const failed = criteria.filter((criterion) => criterion.status === "fail")
    .sort((left, right) => impactRank(left.impact) - impactRank(right.impact));
  const warnings = criteria.filter((criterion) => criterion.status === "warning");
  const passes = criteria.filter((criterion) => criterion.status === "pass");
  const agentReadiness = buildAgentReadiness({
    checks: input.agentReadinessChecks,
    limitations: input.agentReadinessLimitations,
    observedAt: generatedAt
  });
  const visualQuality = input.visualQuality ?? unavailableVisualQuality({
    observedAt: generatedAt,
    limitation: "Visual Quality was not supplied by the assessment adapter."
  });
  return websiteAssessmentSchema.parse({
    schemaVersion: 1,
    id: input.id ?? `website_assessment_${crypto.randomUUID().replaceAll("-", "")}`,
    target: input.target,
    producer: {
      name: "lodesta-website-assessment",
      identity: websiteAssessmentProducerIdentity,
      rubricIdentity: websiteAssessmentRubricIdentity,
      scannerIdentity: websiteAssessmentScannerIdentity,
      inputHash: hashInput(input.inputHashSource),
      generatedAt
    },
    siteUnderstanding: input.siteUnderstanding,
    coverage: {
      value: round(coverage, 4),
      assessedCriteria: criteria.filter((criterion) => !["unknown", "not_applicable"].includes(criterion.status)).length,
      applicableCriteria: criteria.filter((criterion) => criterion.status !== "not_applicable").length,
      scoreEligible,
      limitations: unique(input.limitations ?? [])
    },
    score,
    dimensions,
    agentReadiness,
    visualQuality,
    summary: {
      strengths: passes.slice(0, 6).map((criterion) => criterion.explanation),
      opportunities: [...failed, ...warnings].slice(0, 8).map((criterion) => `${criterion.title}: ${criterion.explanation}`),
      criticalFailures: criticalFailures.map((criterion) => `${criterion.title}: ${criterion.explanation}`)
    }
  });
}

function earnedPoints(status: AssessmentCriterion["status"], possible: number) {
  if (status === "pass") return possible;
  if (status === "warning") return possible * 0.5;
  if (status === "fail") return 0;
  return undefined;
}

function verdictFor(score: number): "strong" | "serviceable" | "weak" | "poor" {
  if (score >= 85) return "strong";
  if (score >= 70) return "serviceable";
  if (score >= 50) return "weak";
  return "poor";
}

function impactRank(value: AssessmentCriterion["impact"]) {
  return { critical: 0, major: 1, minor: 2, advisory: 3 }[value];
}

function hashInput(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
