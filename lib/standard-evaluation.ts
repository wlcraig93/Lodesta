import type { CrawlAssessment } from "./crawler";
import type { StandardCheckResult, StandardCriterion, StandardEvaluation } from "./presence-contracts";
import { getStandardCriterion } from "./standard";

export function evaluateCrawlAgainstStandard(crawl: CrawlAssessment): StandardEvaluation {
  const checks: StandardCheckResult[] = crawl.score.checks.map((check) => {
    const criterion = getStandardCriterion(check.standardCriterionId);
    return {
      criterionId: check.standardCriterionId,
      title: criterion?.title ?? check.label,
      layer: criterion?.layer ?? "technical_seo",
      vertical: criterion?.vertical ?? "universal",
      checkMethod: criterion?.checkMethod ?? "crawl",
      passed: check.passed,
      severity: check.passed ? "pass" : check.maxPoints >= 10 ? "fail" : "warning",
      evidence: check.passed ? `${check.label} passed during crawl.` : `${check.label} failed during crawl.`,
      businessConsequence: check.consequence
    };
  });

  return {
    source: "crawl",
    sourceUrl: crawl.finalUrl ?? crawl.url,
    score: {
      overall: crawl.score.overall,
      max: crawl.score.max,
      percent: crawl.score.percent,
      grade: crawl.score.grade
    },
    checks
  };
}

export function isColdUrlCheckableMethod(checkMethod: StandardCriterion["checkMethod"]) {
  return checkMethod === "crawl" || checkMethod === "dom";
}

export function coldUrlCheckableChecks(checks: StandardCheckResult[]) {
  return checks.filter((check) => isColdUrlCheckableMethod(check.checkMethod));
}
