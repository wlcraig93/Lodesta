import { factsByKind } from "./business-fact-graph";
import { scanPlaceholderText, scanSensitiveClaimText, type SensitiveClaimEvidenceKind } from "./content-safety-scanners";
import type { BusinessFactGraph, SiteVersion } from "./models";

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
    | "regulated"
    | "marketing";
  text: string;
  reason: string;
  pageId?: string;
  sectionId?: string;
};

export type ClaimVerificationResult = {
  status: "passed" | "failed";
  issues: ClaimVerificationIssue[];
};

export function verifyGenerationClaims(input: {
  version: SiteVersion;
  factGraph: BusinessFactGraph;
}): ClaimVerificationResult {
  const issues: ClaimVerificationIssue[] = [];
  if (input.version.rendererVersion !== "layout-v3") {
    throw new Error(`Claim verification requires layout-v3; received ${input.version.rendererVersion}.`);
  }
  const sectionTexts = input.version.pageComposition.pages.flatMap((page) =>
    page.sections.map((section) => ({ pageId: page.id, sectionId: section.id, texts: stringsInValue(section.props) }))
  );
  for (const { pageId, sectionId, texts } of sectionTexts) {
    for (const text of texts) {
        for (const placeholder of scanPlaceholderText(text)) {
          issues.push({
            id: `placeholder_${issues.length + 1}`,
            category: "placeholder",
            text,
            reason: placeholder.reason,
            pageId,
            sectionId
          });
        }
        for (const sensitive of scanSensitiveClaimText(text)) {
          if (hasEvidence(input.factGraph, sensitive.requiredEvidence, text)) continue;
          issues.push({
            id: `${sensitive.category}_${issues.length + 1}`,
            category: sensitive.category,
            text,
            reason: `${sensitive.label} requires ${sensitive.requiredEvidence} evidence in the business fact graph.`,
            pageId,
            sectionId
          });
        }
      }
    }
  return {
    status: issues.length ? "failed" : "passed",
    issues
  };
}

function hasEvidence(graph: BusinessFactGraph, required: SensitiveClaimEvidenceKind, text: string) {
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
