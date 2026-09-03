import { createHash, randomUUID } from "node:crypto";
import {
  websiteAssessmentSchema,
  type AssessmentCriterion,
  type AssessmentCriterionInput,
  type AssessmentDimension,
  type AssessmentUnknownReason,
  type AgentReadinessCheckInput,
  type VisualQuality,
  type WebsiteAssessment,
  type WebsiteAssessmentTargetKind
} from "./contracts";
import {
  assessmentCriteria,
  assessmentDimensions,
  minimumVerticalConfidence,
  websiteAssessmentProducerIdentity,
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity,
  websiteAssessmentScoringPolicy,
  type AssessmentCriterionDefinition
} from "./rubric";
import {
  websiteHealthRequestedRouteSlots,
  websiteHealthRouteSelectionIdentity
} from "./route-selection";
import {
  assessmentInventoryIdentity,
  assessmentReferenceAuthorityFor,
  assessmentServingContractFor
} from "./comparability";

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
  canonicalFactAvailability?: WebsiteAssessment["canonicalFactAvailability"];
  referenceAuthority?: WebsiteAssessment["referenceAuthority"];
  servingContract?: WebsiteAssessment["servingContract"];
  routeSelection?: WebsiteAssessment["routeSelection"];
  siteInventory: WebsiteAssessment["siteInventory"];
  criteria: AssessmentCriterionInput[];
  agentReadinessChecks: AgentReadinessCheckInput[];
  agentReadinessLimitations?: string[];
  visualQuality?: VisualQuality;
  limitations?: string[];
  comparisonEligible?: boolean;
  comparisonLimitations?: string[];
  deterministicReleaseBlockers?: string[];
  generatedAt?: string;
  inputHashSource: unknown;
};

export function buildWebsiteAssessment(input: BuildWebsiteAssessmentInput): WebsiteAssessment {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const canonicalFactAvailability = input.canonicalFactAvailability ?? emptyCanonicalFactAvailability();
  const routeSelection = input.routeSelection ?? defaultRouteSelection(input);
  const referenceAuthority = input.referenceAuthority ?? assessmentReferenceAuthorityFor(undefined);
  const servingContract = input.servingContract ?? assessmentServingContractFor({
    targetKind: input.target.kind,
    sourceUrl: input.target.sourceUrl
  });
  const supplied = suppliedCriteria(input);
  const criteria = assessmentCriteria.map((definition) =>
    materializeCriterion({
      definition,
      supplied: supplied.get(definition.id),
      input,
      canonicalFactAvailability,
      generatedAt
    })
  );
  const dimensions = assessmentDimensions.map((definition) =>
    buildDimension(definition, criteria)
  );
  const scoreable = criteria.filter(isScoreableApplicable);
  const assessed = scoreable.filter(isAssessed);
  const siteCoverage = criterionCoverage(scoreable, "site");
  const pipelineCompleteness = criterionCoverage(scoreable, "pipeline");
  const activeDimensions = dimensions.filter(
    (dimension) => dimension.state === "scored" && dimension.score !== undefined
  );
  const activeWeight = sum(activeDimensions.map((dimension) => dimension.weight));
  const rawValue = activeWeight
    ? round(sum(activeDimensions.map((dimension) => (dimension.score ?? 0) * dimension.weight)) / activeWeight)
    : undefined;
  const criterionReleaseBlockers = unique([
    ...criteria
      .filter((criterion) =>
        criterion.status === "fail"
        && criterion.releaseDisposition === "blocking"
        && criterion.evaluatorType === "deterministic"
      )
      .map((criterion) => criterion.id)
  ]);
  // A retained artifact's strict QA payload is the prepublication release authority.
  // Adapters that supply its blocker list must not be silently broadened by the
  // advisory health assessment.
  const releaseBlockers = input.target.kind === "site_artifact"
    && input.deterministicReleaseBlockers !== undefined
    ? unique(input.deterministicReleaseBlockers)
    : unique([
        ...criterionReleaseBlockers,
        ...(input.deterministicReleaseBlockers ?? [])
      ]);
  const release = input.target.kind === "site_artifact"
    ? {
        status: releaseBlockers.length ? "failed" as const : "passed" as const,
        blockers: releaseBlockers
      }
    : { status: "not_applicable" as const, blockers: [] };
  const appliedCaps = rawValue === undefined
    ? []
    : websiteAssessmentCapsFor({ dimensions, siteCoverage, releaseBlockers });
  const cappedValue = rawValue === undefined
    ? undefined
    : round(Math.min(rawValue, ...appliedCaps.map((cap) => cap.maximum)));
  const collectorLimitations = collectorLimitationsFor(criteria, input.visualQuality);
  const limitations = unique([
    ...(input.limitations ?? []),
    ...(input.agentReadinessLimitations ?? []),
    ...(input.comparisonLimitations ?? []),
    ...collectorLimitations,
    ...(input.routeSelection ? [] : ["Semantic route-selection provenance was not supplied by the target adapter."])
  ]);
  const comparisonEligible = (input.comparisonEligible ?? true)
    && pipelineCompleteness === 1
    && collectorLimitations.length === 0
    && routeSelection.identity === websiteHealthRouteSelectionIdentity;
  const insufficientEvidence = dimensions.some(
    (dimension) => dimension.state === "insufficient_evidence"
  );
  const renormalized = activeWeight > 0 && activeWeight < 100;
  const provisional = insufficientEvidence || siteCoverage < 1 || !comparisonEligible;
  const evaluators = evaluatorsFor(input, generatedAt);
  const evaluatorIdentities = evaluators
    .map((evaluator) => `${evaluator.kind}:${evaluator.identity}:${evaluator.status}`)
    .sort();
  const comparabilityBase = {
    evidenceClass: evidenceClassFor(input.target.kind),
    registryIdentity: websiteAssessmentRubricIdentity,
    scannerIdentity: websiteAssessmentScannerIdentity,
    samplingProfileIdentity: routeSelection.identity,
    sampledRouteCount: routeSelection.selected.filter((selection) => Boolean(selection.route)).length,
    servingContractIdentity: servingContract.identity,
    referenceAuthorityIdentity: referenceAuthority.identity,
    inventoryIdentity: assessmentInventoryIdentity(input.siteInventory),
    evaluatorIdentities
  };
  const failed = criteria
    .filter((criterion) => criterion.status === "fail")
    .sort((left, right) => impactRank(left.impact) - impactRank(right.impact));
  const warnings = criteria.filter((criterion) => criterion.status === "warning");
  const passes = criteria.filter((criterion) => criterion.status === "pass");
  const criticalFailures = failed.filter((criterion) => criterion.impact === "critical");

  return websiteAssessmentSchema.parse({
    schemaVersion: 3,
    kind: "website-health-report",
    id: input.id ?? `website_health_${randomUUID().replaceAll("-", "")}`,
    target: input.target,
    producer: {
      name: "lodesta-website-health",
      identity: websiteAssessmentProducerIdentity,
      rubricIdentity: websiteAssessmentRubricIdentity,
      scannerIdentity: websiteAssessmentScannerIdentity,
      routeSelectionIdentity: websiteHealthRouteSelectionIdentity,
      inputHash: hashInput(input.inputHashSource),
      generatedAt
    },
    siteUnderstanding: input.siteUnderstanding,
    canonicalFactAvailability,
    referenceAuthority,
    servingContract,
    routeSelection,
    siteInventory: input.siteInventory,
    coverage: {
      siteEvidence: round(siteCoverage, 4),
      pipelineCompleteness: round(pipelineCompleteness, 4),
      assessedCriteria: assessed.length,
      applicableCriteria: scoreable.length,
      comparisonEligible,
      limitations
    },
    comparability: {
      key: `comparison@${hashInput(comparabilityBase)}`,
      evidenceClass: comparabilityBase.evidenceClass,
      samplingProfileIdentity: comparabilityBase.samplingProfileIdentity,
      sampledRouteCount: comparabilityBase.sampledRouteCount,
      servingContractIdentity: comparabilityBase.servingContractIdentity,
      referenceAuthorityIdentity: comparabilityBase.referenceAuthorityIdentity,
      inventoryIdentity: comparabilityBase.inventoryIdentity,
      evaluatorIdentities
    },
    score: {
      rawValue,
      activeWeight,
      renormalized,
      scopes: {
        siteAuthor: siteAuthorScope(criteria, dimensions)
      }
    },
    ...(cappedValue === undefined ? {} : {
      grade: {
        label: "Measured Website Health",
        value: cappedValue,
        ...(renormalized || provisional ? {} : { band: websiteAssessmentGradeBandFor(cappedValue) }),
        bandStatus: renormalized
          ? "suppressed_unscored_dimensions"
          : provisional
            ? "suppressed_provisional"
            : "available",
        provisional,
        appliedCaps
      }
    }),
    release,
    dimensions,
    evaluators,
    summary: {
      strengths: passes.slice(0, 6).map((criterion) => criterion.explanation),
      opportunities: [...failed, ...warnings]
        .slice(0, 8)
        .map((criterion) => `${criterion.title}: ${criterion.explanation}`),
      criticalFailures: criticalFailures
        .slice(0, 12)
        .map((criterion) => `${criterion.title}: ${criterion.explanation}`)
    }
  });
}

function suppliedCriteria(input: BuildWebsiteAssessmentInput) {
  const values: AssessmentCriterionInput[] = [...input.criteria];
  values.push(...input.agentReadinessChecks.map((check) => ({
    id: check.id,
    status: check.status,
    certainty: check.certainty,
    confidence: check.confidence,
    explanation: check.explanation,
    evidence: check.evidence
  })));
  if (input.visualQuality) {
    values.push(...input.visualQuality.groups.flatMap((group) =>
      group.checks.map((check): AssessmentCriterionInput => ({
        id: check.id,
        status: check.status,
        certainty: check.certainty,
        confidence: check.confidence,
        explanation: check.explanation,
        evidence: check.evidence
      }))
    ));
  }
  const duplicateIds = duplicates(values.map((criterion) => criterion.id));
  if (duplicateIds.length) {
    throw new Error(`Duplicate supplied website health criteria: ${duplicateIds.join(", ")}`);
  }
  return new Map(values.map((criterion) => [criterion.id, criterion]));
}

function materializeCriterion(input: {
  definition: AssessmentCriterionDefinition;
  supplied?: AssessmentCriterionInput;
  input: BuildWebsiteAssessmentInput;
  canonicalFactAvailability: WebsiteAssessment["canonicalFactAvailability"];
  generatedAt: string;
}): AssessmentCriterion {
  const { definition, supplied, generatedAt } = input;
  const notApplicableReason = criterionNotApplicableReason(input);
  const status = notApplicableReason ? "not_applicable" : supplied?.status ?? "unknown";
  const explanation = notApplicableReason
    ?? supplied?.explanation
    ?? "The target adapter did not retain evidence for this criterion.";
  const unknownReason = status === "unknown"
    ? supplied?.unknownReason ?? inferUnknownReason(explanation, input.input.target.kind, definition)
    : undefined;
  const possible = definition.scoreEligible ? definition.points : 0;
  return {
    id: definition.id,
    definitionIdentity: definition.definitionIdentity,
    dimensionId: definition.dimensionId,
    topics: definition.topics,
    title: definition.title,
    status,
    impact: definition.impact,
    certainty: supplied?.certainty
      ?? (definition.evaluatorType === "model" ? "inferred" : "deterministic"),
    confidence: supplied?.confidence,
    applicability: definition.applicability,
    evaluatorType: definition.evaluatorType,
    controlOwner: definition.controlOwner,
    releaseDisposition: definition.releaseDisposition,
    scoreEligible: definition.scoreEligible,
    publicEligible: definition.publicEligible,
    scopeUnit: definition.scopeUnit,
    aggregation: definition.aggregation,
    evidenceTier: definition.evidenceTier,
    anchors: definition.anchors,
    unknownReason,
    explanation,
    businessConsequence: definition.businessConsequence,
    recommendation: definition.recommendation,
    evidence: supplied?.evidence ?? [{
      id: `${definition.id}.coverage`,
      kind: "system",
      summary: notApplicableReason
        ? "The criterion was excluded by the versioned applicability policy."
        : "No criterion-specific evidence was retained by the target adapter.",
      observedAt: generatedAt
    }],
    pointsEarned: earnedPoints(status, possible),
    pointsPossible: possible
  };
}

function criterionNotApplicableReason(input: {
  definition: AssessmentCriterionDefinition;
  supplied?: AssessmentCriterionInput;
  input: BuildWebsiteAssessmentInput;
  canonicalFactAvailability: WebsiteAssessment["canonicalFactAvailability"];
}) {
  const { definition, supplied } = input;
  if (supplied?.status === "not_applicable") return supplied.explanation;
  if (!definition.applicabilityRules.targets.includes(input.input.target.kind)) {
    return `This criterion does not apply to ${input.input.target.kind} targets.`;
  }
  if (
    definition.applicability === "vertical"
    && input.input.siteUnderstanding.verticalConfidence < minimumVerticalConfidence
  ) {
    return `Vertical-specific checks were not applied because vertical confidence was ${(input.input.siteUnderstanding.verticalConfidence * 100).toFixed(0)}%.`;
  }
  const requiredFacts = definition.applicabilityRules.requiredCanonicalFacts ?? [];
  const missingFacts = requiredFacts.filter((fact) => !input.canonicalFactAvailability[fact]);
  if (requiredFacts.length && missingFacts.length) {
    return `This criterion requires publish-eligible canonical ${missingFacts.join(", ")} facts, which were unavailable.`;
  }
  return undefined;
}

function buildDimension(
  definition: (typeof assessmentDimensions)[number],
  criteria: AssessmentCriterion[]
): AssessmentDimension {
  const dimensionCriteria = criteria.filter(
    (criterion) => criterion.dimensionId === definition.id
  );
  const applicable = dimensionCriteria.filter(
    (criterion) => criterion.status !== "not_applicable"
  );
  const scoreable = applicable.filter(
    (criterion) => criterion.scoreEligible && criterion.pointsPossible > 0
  );
  const assessed = scoreable.filter(isAssessed);
  const assessedPossible = sum(assessed.map((criterion) => criterion.pointsPossible));
  const earned = sum(assessed.map((criterion) => criterion.pointsEarned ?? 0));
  const state = applicable.length === 0
    ? "not_applicable" as const
    : scoreable.length === 0
      ? "not_yet_scored" as const
      : assessed.length === 0
        ? "insufficient_evidence" as const
        : "scored" as const;
  const siteEvidence = criterionCoverage(scoreable, "site");
  const pipelineCompleteness = criterionCoverage(scoreable, "pipeline");
  return {
    ...definition,
    state,
    coverage: {
      siteEvidence: round(siteEvidence, 4),
      pipelineCompleteness: round(pipelineCompleteness, 4)
    },
    score: state === "scored" && assessedPossible
      ? round(earned / assessedPossible * 100)
      : undefined,
    capEligible: state === "scored"
      && assessed.length >= websiteAssessmentScoringPolicy.dimensions.capMinimumAssessedCriteria
      && assessedPossible >= websiteAssessmentScoringPolicy.dimensions.capMinimumAssessedPossiblePoints
      && siteEvidence >= websiteAssessmentScoringPolicy.dimensions.capMinimumSiteEvidenceCoverage,
    assessedPoints: round(earned, 2),
    possiblePoints: assessedPossible,
    assessedCriteria: assessed.length,
    applicableCriteria: scoreable.length,
    criteria: dimensionCriteria
  };
}

function siteAuthorScope(
  criteria: AssessmentCriterion[],
  dimensions: AssessmentDimension[]
): WebsiteAssessment["score"]["scopes"]["siteAuthor"] {
  const authorCriteria = criteria.filter(
    (criterion) => criterion.controlOwner === "site_author" && isScoreableApplicable(criterion)
  );
  const dimensionScores = dimensions.flatMap((dimension) => {
    const assessed = authorCriteria.filter(
      (criterion) => criterion.dimensionId === dimension.id && isAssessed(criterion)
    );
    const possible = sum(assessed.map((criterion) => criterion.pointsPossible));
    if (!possible) return [];
    const earned = sum(assessed.map((criterion) => criterion.pointsEarned ?? 0));
    return [{ weight: dimension.weight, score: earned / possible * 100 }];
  });
  const activeWeight = sum(dimensionScores.map((dimension) => dimension.weight));
  const assessedAuthor = authorCriteria.filter(isAssessed);
  const possiblePoints = sum(assessedAuthor.map((criterion) => criterion.pointsPossible));
  const assessedPoints = sum(assessedAuthor.map((criterion) => criterion.pointsEarned ?? 0));
  return {
    value: activeWeight
      ? round(sum(dimensionScores.map((dimension) => dimension.score * dimension.weight)) / activeWeight)
      : undefined,
    coverage: round(criterionCoverage(authorCriteria, "site"), 4),
    activeWeight,
    assessedPoints: round(assessedPoints, 2),
    possiblePoints
  };
}

export function websiteAssessmentCapsFor(input: {
  dimensions: AssessmentDimension[];
  siteCoverage: number;
  releaseBlockers: string[];
}) {
  const caps: Array<{ id: string; maximum: number; explanation: string }> = [];
  if (input.releaseBlockers.length) {
    caps.push({
      id: "deterministic_release_blocker",
      maximum: websiteAssessmentScoringPolicy.caps.deterministicReleaseBlocker,
      explanation: `${input.releaseBlockers.length} deterministic release blocker(s) failed.`
    });
  }
  for (const dimension of input.dimensions) {
    if (!dimension.capEligible || dimension.score === undefined) continue;
    if (dimension.score < 50) {
      caps.push({
        id: `dimension.${dimension.id}.below_50`,
        maximum: websiteAssessmentScoringPolicy.caps.dimensionBelow50,
        explanation: `${dimension.label} scored below 50 with sufficient assessed evidence.`
      });
    } else if (dimension.score < 70) {
      caps.push({
        id: `dimension.${dimension.id}.below_70`,
        maximum: websiteAssessmentScoringPolicy.caps.dimensionBelow70,
        explanation: `${dimension.label} scored from 50 inclusive to 70 exclusive with sufficient assessed evidence.`
      });
    }
  }
  if (input.siteCoverage < 0.5) {
    caps.push({
      id: "coverage.below_50_percent",
      maximum: 49,
      explanation: "Global site-evidence coverage was below 50%."
    });
  } else if (input.siteCoverage < 0.7) {
    caps.push({
      id: "coverage.below_70_percent",
      maximum: 69,
      explanation: "Global site-evidence coverage was at least 50% and below 70%."
    });
  } else if (input.siteCoverage < 0.85) {
    caps.push({
      id: "coverage.below_85_percent",
      maximum: 79,
      explanation: "Global site-evidence coverage was at least 70% and below 85%."
    });
  }
  return caps;
}

function criterionCoverage(
  criteria: AssessmentCriterion[],
  scope: "site" | "pipeline"
) {
  const observable = criteria.filter((criterion) =>
    criterion.unknownReason !== "target_structurally_unobservable"
  );
  if (!observable.length) return 1;
  if (scope === "pipeline") {
    const complete = observable.filter((criterion) =>
      criterion.status !== "unknown"
      || !["collector_unavailable", "evidence_not_retained"].includes(criterion.unknownReason ?? "")
    );
    return complete.length / observable.length;
  }
  const siteAttributable = observable.filter((criterion) =>
    criterion.status !== "unknown"
    || !["collector_unavailable", "evidence_not_retained"].includes(criterion.unknownReason ?? "")
  );
  if (!siteAttributable.length) return 1;
  return siteAttributable.filter(isAssessed).length / siteAttributable.length;
}

function collectorLimitationsFor(
  criteria: AssessmentCriterion[],
  visualQuality: VisualQuality | undefined
) {
  const limitations = criteria
    .filter((criterion) =>
      criterion.status === "unknown"
      && ["collector_unavailable", "evidence_not_retained"].includes(criterion.unknownReason ?? "")
      && criterion.scoreEligible
    )
    .map((criterion) => `${criterion.id}: ${criterion.unknownReason}`);
  if (!visualQuality || visualQuality.evaluator.status === "unavailable") {
    limitations.push("The visual evaluator was unavailable or not supplied.");
  }
  return unique(limitations);
}

function evaluatorsFor(
  input: BuildWebsiteAssessmentInput,
  generatedAt: string
): WebsiteAssessment["evaluators"] {
  const evaluators: WebsiteAssessment["evaluators"] = [{
    kind: "deterministic",
    identity: websiteAssessmentScannerIdentity,
    status: "completed",
    generatedAt
  }];
  if (input.visualQuality) {
    evaluators.push({
      kind: "model",
      identity: input.visualQuality.evaluator.identity,
      status: input.visualQuality.evaluator.status,
      modelId: input.visualQuality.evaluator.modelId,
      promptIdentity: input.visualQuality.evaluator.promptIdentity,
      evidenceSetHash: input.visualQuality.evaluator.screenshotSetHash,
      generatedAt: input.visualQuality.evaluator.generatedAt,
      inputTokens: input.visualQuality.evaluator.inputTokens,
      cachedInputTokens: input.visualQuality.evaluator.cachedInputTokens,
      outputTokens: input.visualQuality.evaluator.outputTokens,
      durationMs: input.visualQuality.evaluator.durationMs,
      estimatedCostUsd: input.visualQuality.evaluator.estimatedCostUsd
    });
  } else {
    evaluators.push({
      kind: "model",
      identity: "visual-evaluator:not-configured",
      status: "not_configured",
      generatedAt
    });
  }
  return evaluators;
}

function inferUnknownReason(
  explanation: string,
  targetKind: WebsiteAssessmentTargetKind,
  definition: AssessmentCriterionDefinition
): AssessmentUnknownReason {
  const normalized = explanation.toLowerCase();
  if (
    normalized.includes("structurally unobservable")
    || normalized.includes("not observable from this target")
    || normalized.includes("cannot be observed at this boundary")
  ) {
    return "target_structurally_unobservable";
  }
  if (
    normalized.includes("unavailable")
    || normalized.includes("could not be audited")
    || normalized.includes("could not be independently")
    || normalized.includes("not configured")
  ) {
    return "collector_unavailable";
  }
  if (
    normalized.includes("not retained")
    || normalized.includes("does not preserve")
    || normalized.includes("predates")
    || normalized.includes("cannot be proven")
    || normalized.includes("public runtime boundary")
    || normalized.includes("public-site boundary")
  ) {
    return "evidence_not_retained";
  }
  if (targetKind === "site_artifact" && definition.evaluatorType === "deterministic") {
    return "evidence_not_retained";
  }
  if (
    normalized.includes("no field")
    || normalized.includes("no available measurement")
    || normalized.includes("no reliable evidence")
  ) {
    return "site_evidence_missing";
  }
  return "inconclusive";
}

function evidenceClassFor(targetKind: WebsiteAssessmentTargetKind) {
  if (targetKind === "site_artifact") return "artifact_authority" as const;
  return "public_observation" as const;
}

function defaultRouteSelection(
  input: BuildWebsiteAssessmentInput
): WebsiteAssessment["routeSelection"] {
  return {
    identity: websiteHealthRouteSelectionIdentity,
    requestedSlots: [...websiteHealthRequestedRouteSlots],
    selected: websiteHealthRequestedRouteSlots.map((slot) => ({
      slot,
      ...(slot === "home" && input.target.sourceUrl
        ? { route: "/", sourceUrl: input.target.sourceUrl, purpose: "home" }
        : {})
    }))
  };
}

function emptyCanonicalFactAvailability(): WebsiteAssessment["canonicalFactAvailability"] {
  return {
    businessName: false,
    phone: false,
    email: false,
    address: false,
    hours: false,
    coordinates: false,
    serviceAreas: false,
    proof: false
  };
}

function isScoreableApplicable(criterion: AssessmentCriterion) {
  return criterion.scoreEligible
    && criterion.pointsPossible > 0
    && criterion.status !== "not_applicable";
}

function isAssessed(criterion: AssessmentCriterion) {
  return !["unknown", "not_applicable"].includes(criterion.status);
}

function earnedPoints(status: AssessmentCriterion["status"], possible: number) {
  if (!possible) return undefined;
  if (status === "pass") return possible;
  if (status === "warning") return possible * 0.5;
  if (status === "fail") return 0;
  return undefined;
}

export function websiteAssessmentGradeBandFor(score: number): "excellent" | "strong" | "serviceable" | "weak" | "poor" {
  if (score >= 90) return "excellent";
  if (score >= 80) return "strong";
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

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) found.add(value);
    seen.add(value);
  }
  return [...found];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
