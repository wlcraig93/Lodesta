import { createHash } from "node:crypto";
import type { SiteArtifactRecord, SiteBundle, SiteVersion } from "./models";

export type SeoMetadataIssueV2 = {
  id: string;
  severity: "pass" | "warning" | "blocking";
  pageId: string;
  field: "title" | "description" | "canonicalPath" | "localContext" | "policy";
  detail: string;
};

export type SeoMetadataAuditV2Result = {
  skillId: "seo.metadata";
  skillVersion: "direct-module-v1";
  versionId?: string;
  issues: SeoMetadataIssueV2[];
  scorecard: {
    pagesChecked: number;
    blockingIssues: number;
    warnings: number;
    passes: number;
  };
  artifact: SiteArtifactRecord;
  summary: string;
};

export function runSeoMetadataAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): SeoMetadataAuditV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const issues = seoIssuesForVersion(input.bundle, version);
  const scorecard = {
    pagesChecked: pagesForVersion(version).length,
    blockingIssues: issues.filter((issue) => issue.severity === "blocking").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    passes: issues.filter((issue) => issue.severity === "pass").length
  };
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: version?.id,
    issues,
    scorecard
  };
  const contentHash = hashPayload(payload);
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_seo_metadata_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "seo_metadata_report",
    artifactVersion: "seo-metadata-report-v2",
    producerId: "seo.metadata",
    producerVersion: "direct-module-v1",
    sourceFactIds: sourceFactIdsForVersion(version),
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  return {
    skillId: "seo.metadata",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    issues,
    scorecard,
    artifact,
    summary: `${scorecard.pagesChecked} SEO page${scorecard.pagesChecked === 1 ? "" : "s"} checked; ${scorecard.blockingIssues} blocker${scorecard.blockingIssues === 1 ? "" : "s"}, ${scorecard.warnings} warning${scorecard.warnings === 1 ? "" : "s"}.`
  };
}

function seoIssuesForVersion(bundle: SiteBundle, version: SiteVersion | undefined): SeoMetadataIssueV2[] {
  const pages = pagesForVersion(version);
  if (!version || !pages.length) {
    return [
      {
        id: "seo_no_pages",
        severity: "blocking",
        pageId: "unknown",
        field: "title",
        detail: "No renderable pages are available for SEO metadata."
      }
    ];
  }

  return pages.flatMap((page) => {
    const title = page.seo.title;
    const description = page.seo.description;
    const canonicalPath = page.seo.canonicalPath;
    const issues: SeoMetadataIssueV2[] = [];
    issues.push(issueFor(title.includes(bundle.businessProfile.name), "title_includes_business", page.id, "title", "Title includes the business name."));
    issues.push(issueFor(title.length >= 18 && title.length <= 70, "title_length", page.id, "title", `Title length is ${title.length}; target 18-70 characters.`));
    issues.push(issueFor(description.length >= 60 && description.length <= 180, "description_length", page.id, "description", `Description length is ${description.length}; target 60-180 characters.`));
    issues.push(issueFor(Boolean(canonicalPath?.startsWith("/")), "canonical_path", page.id, "canonicalPath", "Canonical path is site-relative."));
    issues.push(issueFor(hasLocalContext(bundle), "local_context", page.id, "localContext", "Business has address or service-area context available."));
    if (googleProofLeak(bundle, title) || googleProofLeak(bundle, description)) {
      issues.push({
        id: `seo_google_static_proof_${page.id}`,
        severity: "blocking",
        pageId: page.id,
        field: "policy",
        detail: "SEO metadata must not statically serialize Google-derived rating or review count."
      });
    } else {
      issues.push({
        id: `seo_google_static_proof_${page.id}`,
        severity: "pass",
        pageId: page.id,
        field: "policy",
        detail: "No static Google rating or review-count metadata detected."
      });
    }
    return issues;
  });
}

function issueFor(passed: boolean, id: string, pageId: string, field: SeoMetadataIssueV2["field"], detail: string): SeoMetadataIssueV2 {
  return {
    id: `${id}_${pageId}`,
    severity: passed ? "pass" : "warning",
    pageId,
    field,
    detail
  };
}

function pagesForVersion(version: SiteVersion | undefined) {
  if (!version) return [];
  if (version.rendererVersion === "layout-v3") return version.pageComposition.pages;
  return [];
}

function sourceFactIdsForVersion(version: SiteVersion | undefined) {
  if (version?.rendererVersion !== "layout-v2") return [];
  return Array.from(new Set(version.compiledPages.flatMap((page) => page.sections.flatMap((section) => section.sourceFactIds))));
}

function hasLocalContext(bundle: SiteBundle) {
  return Boolean(bundle.businessProfile.address || bundle.businessProfile.serviceAreas.length);
}

function googleProofLeak(bundle: SiteBundle, value: string) {
  const summary = bundle.businessProfile.reviewsSummary;
  if (!summary?.sources.includes("google_places")) return false;
  return [summary.rating?.toString(), summary.count?.toString()].filter(Boolean).some((candidate) => value.includes(candidate!));
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
