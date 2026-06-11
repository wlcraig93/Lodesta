import type {
  GenerationQaBlocker,
  GenerationQaWarning,
  GenerationQualityReport,
  GenerationScorecard,
  ScorecardDimension,
  ScorecardDimensionId,
  VisualQaResult
} from "./models";

/**
 * Unified scorecard, slice 1a (next-level plan, Part 1).
 *
 * This is a PROJECTION layer: every score is derived from signals the pipeline
 * already produces (quality rubric, model visual QA, render inspection
 * blockers/warnings). It introduces no new measurement and no new gating —
 * hard blockers remain authoritative, and enforcement of per-dimension gates
 * only activates behind LODESTA_SCORECARD_ENFORCE so the projection can be
 * observed against the benchmark fleet before it gets teeth.
 *
 * Gate-state contract:
 * - `unscored`: no real signal exists yet → dimension reports no score and is
 *   excluded from every average and gate decision.
 * - `shadow`: scored and logged, never enforced (model-judged dimensions
 *   start here; promotion criteria live in the plan).
 * - `enforcing`: deterministic dimensions; `passes` is reported, and the
 *   enforcement hook may convert failures into blockers when enabled.
 * - `disabled`: explicitly turned off with rationale (not used in 1a).
 */

export type ScorecardInput = {
  qualityReport?: GenerationQualityReport;
  visualQa?: VisualQaResult;
  blockers: GenerationQaBlocker[];
  warnings: GenerationQaWarning[];
  brandCueApplied?: boolean;
  /** Slice 1b signals (SEO & structure); unscored until provided. */
  seoScore?: number;
  /** Slice 3 sub-metric (surfaced/eligible fact coverage, 0-1). */
  factCoverageRatio?: number;
};

const dimensionGates: Record<ScorecardDimensionId, number> = {
  correctness_grounding: 90,
  visual_design: 60,
  mobile_experience: 75,
  conversion_readiness: 70,
  seo_structure: 80,
  content_quality: 65,
  brand_identity: 60,
  accessibility: 85
};

/** Informational blend weights; renormalized over scored dimensions only. */
const dimensionWeights: Record<ScorecardDimensionId, number> = {
  correctness_grounding: 20,
  visual_design: 25,
  mobile_experience: 15,
  conversion_readiness: 10,
  seo_structure: 5,
  content_quality: 10,
  brand_identity: 10,
  accessibility: 5
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const accessibilityFindingPattern = /contrast|a11y|focus|landmark|alt_text|tap_target|font_size|text_size/i;

export function buildGenerationScorecard(input: ScorecardInput): GenerationScorecard {
  const rubric = input.qualityReport?.rubric;
  const dimensions: ScorecardDimension[] = [];

  const push = (
    id: ScorecardDimensionId,
    state: ScorecardDimension["state"],
    score: number | undefined,
    signals: string[]
  ) => {
    const gate = dimensionGates[id];
    const scored = state !== "unscored" && score !== undefined;
    dimensions.push({
      id,
      state,
      gate,
      signals,
      ...(scored ? { score: clamp(score) } : {}),
      ...(scored && state === "enforcing" ? { passes: clamp(score) >= gate } : {})
    });
  };

  // Correctness & grounding — deterministic rubric components.
  if (rubric) {
    push(
      "correctness_grounding",
      "enforcing",
      rubric.sourceGrounding * 0.4 + rubric.verticalFit * 0.3 + rubric.serviceClarity * 0.3,
      ["rubric.sourceGrounding", "rubric.verticalFit", "rubric.serviceClarity"]
    );
  } else {
    push("correctness_grounding", "unscored", undefined, []);
  }

  // Visual design — model-judged craft (1-10 → 0-100). Shadow until promoted.
  const craft = input.qualityReport?.craft;
  if (typeof craft === "number") {
    push("visual_design", "shadow", craft * 10, ["qualityReport.craft"]);
  } else {
    push("visual_design", "unscored", undefined, []);
  }

  // Mobile experience — deterministic render findings + rubric credibility.
  if (rubric) {
    const mobileBlockers = input.blockers.filter((blocker) => blocker.viewport === "mobile").length;
    const mobileWarnings = input.warnings.filter((warning) => warning.viewport === "mobile").length;
    const findingScore = 100 - mobileBlockers * 25 - mobileWarnings * 10;
    push("mobile_experience", "enforcing", Math.min(findingScore, rubric.mobileCredibility), [
      "render.mobileFindings",
      "rubric.mobileCredibility"
    ]);
  } else {
    push("mobile_experience", "unscored", undefined, []);
  }

  // Conversion readiness — CTA fit is the deterministic core today.
  if (rubric) {
    push("conversion_readiness", "enforcing", rubric.ctaFit, ["rubric.ctaFit"]);
  } else {
    push("conversion_readiness", "unscored", undefined, []);
  }

  // SEO & structure — slice 1b supplies the signal; honest absence until then.
  if (typeof input.seoScore === "number") {
    push("seo_structure", "enforcing", input.seoScore, ["seo.structureChecks"]);
  } else {
    push("seo_structure", "unscored", undefined, []);
  }

  // Content quality — lint-backed rubric parts (+ fact coverage when present).
  if (rubric) {
    const base = rubric.heroSpecificity * 0.5 + rubric.sectionQuality * 0.5;
    const withCoverage =
      typeof input.factCoverageRatio === "number" ? base * 0.7 + input.factCoverageRatio * 100 * 0.3 : base;
    push("content_quality", "shadow", withCoverage, [
      "rubric.heroSpecificity",
      "rubric.sectionQuality",
      ...(typeof input.factCoverageRatio === "number" ? ["factCoverage.surfacedOverEligible"] : [])
    ]);
  } else {
    push("content_quality", "unscored", undefined, []);
  }

  // Brand identity — palette-applied signal plus craft echo. Shadow.
  if (input.brandCueApplied !== undefined) {
    const base = input.brandCueApplied ? 65 : 45;
    const craftBonus = typeof craft === "number" ? Math.max(0, Math.min(20, (craft - 5) * 5)) : 0;
    push("brand_identity", "shadow", base + craftBonus, [
      "brandCueReport.applied",
      ...(typeof craft === "number" ? ["qualityReport.craft"] : [])
    ]);
  } else {
    push("brand_identity", "unscored", undefined, []);
  }

  // Accessibility — deterministic render findings (contrast sampler et al.).
  const a11yBlockers = input.blockers.filter((blocker) => accessibilityFindingPattern.test(blocker.id)).length;
  const a11yWarnings = input.warnings.filter((warning) => accessibilityFindingPattern.test(warning.id)).length;
  push("accessibility", "enforcing", 100 - a11yBlockers * 20 - a11yWarnings * 5, ["render.accessibilityFindings"]);

  const scored = dimensions.filter(
    (dimension) => dimension.score !== undefined && dimension.state !== "unscored" && dimension.state !== "disabled"
  );
  const totalWeight = scored.reduce((sum, dimension) => sum + dimensionWeights[dimension.id], 0);
  const overall = totalWeight
    ? Math.round(scored.reduce((sum, dimension) => sum + (dimension.score ?? 0) * dimensionWeights[dimension.id], 0) / totalWeight)
    : undefined;

  return {
    version: "scorecard-v1",
    dimensions,
    ...(overall !== undefined ? { overall } : {}),
    evaluatedAt: new Date().toISOString()
  };
}

/**
 * Enforcement hook: converts enforcing-dimension failures into blockers.
 * Inactive unless LODESTA_SCORECARD_ENFORCE=on — slice 1a observes only, per
 * the plan's "initially at current-passing levels so nothing breaks".
 */
export function scorecardEnforcementBlockers(scorecard: GenerationScorecard): GenerationQaBlocker[] {
  if (process.env.LODESTA_SCORECARD_ENFORCE !== "on") return [];
  return scorecard.dimensions
    .filter((dimension) => dimension.state === "enforcing" && dimension.passes === false)
    .map((dimension) => ({
      id: `scorecard_${dimension.id}_below_gate`,
      title: `Scorecard: ${dimension.id} below gate`,
      detail: `Dimension ${dimension.id} scored ${dimension.score} against gate ${dimension.gate}. Signals: ${dimension.signals.join(", ")}.`
    }));
}
