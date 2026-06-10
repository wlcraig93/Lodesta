import { createHash } from "node:crypto";
import type {
  BusinessFactGraph,
  SiteArtifactRecord,
  SiteBundle,
  SiteVersion
} from "./models";

export type ClaimReportIssueV2 = {
  id: string;
  severity: "warning" | "blocking";
  category:
    | "placeholder"
    | "claim_span_missing"
    | "credential"
    | "insurance"
    | "pricing"
    | "warranty"
    | "reviews"
    | "emergency"
    | "regulated";
  text: string;
  reason: string;
  pageId?: string;
  sectionId?: string;
};

export type ClaimReportV2Result = {
  skillId: "claims.verification";
  skillVersion: "direct-module-v1";
  versionId?: string;
  status: "passed" | "failed";
  issues: ClaimReportIssueV2[];
  artifact: SiteArtifactRecord;
  summary: string;
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
  /\bowner verification needed\b/i
];

const sensitivePatterns: Array<{
  category: Exclude<ClaimReportIssueV2["category"], "placeholder" | "claim_span_missing">;
  pattern: RegExp;
  requiredEvidence: "proof" | "reviews" | "insurance" | "pricing" | "emergency";
}> = [
  { category: "credential", pattern: /\b(certified|licensed|award[- ]winning|specialist)\b/i, requiredEvidence: "proof" },
  { category: "insurance", pattern: /\b(insurance accepted|insurance claims?|deductible|rental car)\b/i, requiredEvidence: "insurance" },
  { category: "pricing", pattern: /\b(best prices?|free estimate|free quote|no out of pocket|affordable)\b/i, requiredEvidence: "pricing" },
  { category: "warranty", pattern: /\b(warranty|guaranteed|guarantee)\b/i, requiredEvidence: "proof" },
  { category: "reviews", pattern: /\b(5[- ]star|five[- ]star|top rated|great reviews?|loved by customers)\b/i, requiredEvidence: "reviews" },
  { category: "emergency", pattern: /\b(24\/7|same day|emergency|after hours)\b/i, requiredEvidence: "emergency" },
  { category: "regulated", pattern: /\b(treatment|diagnosis|legal advice|case results?)\b/i, requiredEvidence: "proof" }
];

export function runClaimVerificationReportV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): ClaimReportV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const issues = claimIssuesForVersion(input.bundle.presenceAssessment.businessFactGraph, version);
  const status = issues.some((issue) => issue.severity === "blocking") ? "failed" : "passed";
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: version?.id,
    status,
    issues
  };
  const contentHash = hashPayload(payload);
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_claim_report_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "claim_report",
    artifactVersion: "claim-report-v2",
    producerId: "claims.verification",
    producerVersion: "direct-module-v1",
    sourceFactIds: sourceFactIdsForVersion(version),
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  return {
    skillId: "claims.verification",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    status,
    issues,
    artifact,
    summary: `${status === "passed" ? "Passed" : "Failed"} claim verification with ${issues.length} issue${issues.length === 1 ? "" : "s"}.`
  };
}

function claimIssuesForVersion(graph: BusinessFactGraph | undefined, version: SiteVersion | undefined): ClaimReportIssueV2[] {
  if (!version) return [];
  const texts = stringsForVersion(version);
  const issues: ClaimReportIssueV2[] = [];
  for (const item of texts) {
    for (const pattern of placeholderPatterns) {
      if (!pattern.test(item.text)) continue;
      issues.push({
        id: `placeholder_${issues.length + 1}`,
        severity: "blocking",
        category: "placeholder",
        text: item.text,
        reason: "Generated placeholder or internal review language is visible.",
        pageId: item.pageId,
        sectionId: item.sectionId
      });
    }
    for (const sensitive of sensitivePatterns) {
      if (!sensitive.pattern.test(item.text)) continue;
      if (hasEvidence(graph, sensitive.requiredEvidence)) continue;
      issues.push({
        id: `${sensitive.category}_${issues.length + 1}`,
        severity: "blocking",
        category: sensitive.category,
        text: item.text,
        reason: `The claim requires ${sensitive.requiredEvidence} evidence in the business fact graph.`,
        pageId: item.pageId,
        sectionId: item.sectionId
      });
    }
    if (item.requiresClaimSpan && !item.claimSpanIds.length) {
      issues.push({
        id: `claim_span_missing_${issues.length + 1}`,
        severity: "warning",
        category: "claim_span_missing",
        text: item.text,
        reason: "Factual compiled copy should be traceable to ClaimSpanV2 ids before render props are considered final.",
        pageId: item.pageId,
        sectionId: item.sectionId
      });
    }
  }
  return issues;
}

function stringsForVersion(version: SiteVersion) {
  if (version.rendererVersion === "layout-v2") {
    return version.compiledPages.flatMap((page) =>
      page.sections.flatMap((section) =>
        stringsInValue(section.props).map((text) => ({
          pageId: page.id,
          sectionId: section.id,
          text,
          claimSpanIds: section.claimSpanIds,
          requiresClaimSpan: section.copyArtifactIds.length > 0
        }))
      )
    );
  }
  return version.pages.flatMap((page) =>
    page.layoutSections.flatMap((section) =>
      stringsInValue(section.slots).map((text) => ({
        pageId: page.id,
        sectionId: section.id,
        text,
        claimSpanIds: [] as string[],
        requiresClaimSpan: false
      }))
    )
  );
}

function hasEvidence(graph: BusinessFactGraph | undefined, required: "proof" | "reviews" | "insurance" | "pricing" | "emergency") {
  if (!graph) return false;
  const sourceFacts = graph.sourceFactsV2 ?? [];
  if (required === "reviews") {
    return sourceFacts.some((fact) => fact.kind === "review_summary" && fact.renderPolicy === "durable_render");
  }
  const haystack = [
    ...graph.facts.map((fact) => fact.value),
    ...sourceFacts
      .filter((fact) => fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render")
      .map((fact) => fact.value)
  ].map((value) => JSON.stringify(value).toLowerCase()).join(" ");
  if (required === "proof") return /\b(certified|licensed|award|review|credential|warranty|guarantee)\b/.test(haystack);
  if (required === "insurance") return /\binsurance|claim|deductible|rental\b/.test(haystack);
  if (required === "pricing") return /\bprice|pricing|free estimate|quote|affordable\b/.test(haystack);
  if (required === "emergency") return /\bemergency|24\/7|after hours|same day\b/.test(haystack);
  return false;
}

function sourceFactIdsForVersion(version: SiteVersion | undefined) {
  if (version?.rendererVersion !== "layout-v2") return [];
  return Array.from(new Set(version.compiledPages.flatMap((page) => page.sections.flatMap((section) => section.sourceFactIds))));
}

function stringsInValue(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(stringsInValue);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringsInValue);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
