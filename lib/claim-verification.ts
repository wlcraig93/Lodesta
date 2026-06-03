import { factsByKind } from "./business-fact-graph";
import { propsForLayoutSection } from "./layout-registry";
import type { BusinessFactGraph, GenerationPlanV2, SiteVersion } from "./models";

export type ClaimVerificationIssue = {
  id: string;
  category:
    | "placeholder"
    | "credential"
    | "insurance"
    | "pricing"
    | "warranty"
    | "reviews"
    | "guarantee"
    | "emergency"
    | "regulated";
  text: string;
  reason: string;
  pageId?: string;
  sectionId?: string;
};

export type ClaimVerificationResult = {
  status: "passed" | "failed";
  issues: ClaimVerificationIssue[];
};

const placeholderPatterns = [
  /\bvisual proof slot ready\b/i,
  /\bcredential details can be verified\b/i,
  /\bowner-approved\b/i,
  /\bowner-truth\b/i,
  /\bcan be verified\b/i,
  /\bready to request more information\b/i,
  /\bclaimed and published\b/i,
  /\bafter claim\b/i,
  /\bowner verification needed\b/i,
  /\bdo you help customers in nearby customers\b/i
];

const sensitivePatterns: Array<{
  category: ClaimVerificationIssue["category"];
  pattern: RegExp;
  requiredEvidence: "proof" | "reviews" | "insurance" | "pricing" | "emergency";
}> = [
  { category: "credential", pattern: /\b(certified|licensed|award[- ]winning|expert|specialist)\b/i, requiredEvidence: "proof" },
  { category: "insurance", pattern: /\b(insurance accepted|insurance claims?|deductible|rental car)\b/i, requiredEvidence: "insurance" },
  { category: "pricing", pattern: /\b(best prices?|free estimate|free quote|no out of pocket|affordable)\b/i, requiredEvidence: "pricing" },
  { category: "warranty", pattern: /\b(warranty|guaranteed|guarantee)\b/i, requiredEvidence: "proof" },
  { category: "reviews", pattern: /\b(5[- ]star|five[- ]star|top rated|great reviews?|loved by customers)\b/i, requiredEvidence: "reviews" },
  { category: "emergency", pattern: /\b(24\/7|same day|emergency|after hours)\b/i, requiredEvidence: "emergency" },
  { category: "regulated", pattern: /\b(treatment|diagnosis|legal advice|case results?)\b/i, requiredEvidence: "proof" }
];

export function verifyGenerationClaims(input: {
  version: SiteVersion;
  factGraph: BusinessFactGraph;
}): ClaimVerificationResult {
  const issues: ClaimVerificationIssue[] = [];
  for (const page of input.version.pages) {
    for (const section of page.layoutSections) {
      for (const text of stringsInValue(propsForLayoutSection(section))) {
        for (const pattern of placeholderPatterns) {
          if (!pattern.test(text)) continue;
          issues.push({
            id: `placeholder_${issues.length + 1}`,
            category: "placeholder",
            text,
            reason: "Generated placeholder or internal review language is visible.",
            pageId: page.id,
            sectionId: section.id
          });
        }
        for (const sensitive of sensitivePatterns) {
          if (!sensitive.pattern.test(text)) continue;
          if (hasEvidence(input.factGraph, sensitive.requiredEvidence, text)) continue;
          issues.push({
            id: `${sensitive.category}_${issues.length + 1}`,
            category: sensitive.category,
            text,
            reason: `The claim requires ${sensitive.requiredEvidence} evidence in the business fact graph.`,
            pageId: page.id,
            sectionId: section.id
          });
        }
      }
    }
  }
  return {
    status: issues.length ? "failed" : "passed",
    issues
  };
}

export function applyClaimVerificationToPlan(plan: GenerationPlanV2, verification: ClaimVerificationResult): GenerationPlanV2 {
  return {
    ...plan,
    verification: {
      status: verification.status,
      unsupportedClaimCount: verification.issues.length
    }
  };
}

function hasEvidence(graph: BusinessFactGraph, required: "proof" | "reviews" | "insurance" | "pricing" | "emergency", text: string) {
  if (required === "reviews") return factsByKind(graph, "review_summary").length > 0;
  const haystack = graph.facts
    .filter((fact) => fact.renderSafety === "render_safe" || fact.renderSafety === "review_required")
    .map((fact) => JSON.stringify(fact.value).toLowerCase())
    .join(" ");
  if (required === "proof") return /\b(certified|licensed|award|review|credential|warranty|guarantee)\b/.test(haystack);
  if (required === "insurance") return /\binsurance|claim|deductible|rental\b/.test(haystack);
  if (required === "pricing") return /\bprice|pricing|free estimate|quote|affordable\b/.test(haystack);
  if (required === "emergency") return /\bemergency|24\/7|after hours|same day\b/.test(haystack);
  return text.length > 0;
}

function stringsInValue(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsInValue);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsInValue);
  return [];
}
