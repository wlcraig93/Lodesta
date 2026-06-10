import { createHash } from "node:crypto";
import type { SiteArtifactRecord, SiteBundle, SiteVersion } from "./models";
import { makeLocalBusinessJsonLd } from "./structured-data";

export type PolicyReportIssueV2 = {
  id: string;
  severity: "pass" | "warning" | "blocking";
  category: "google_places" | "structured_data" | "regulated_claims";
  detail: string;
  evidence?: string;
};

export type PolicyReportV2Result = {
  skillId: "policy.google-places";
  skillVersion: "direct-module-v1";
  versionId?: string;
  status: "passed" | "failed";
  issues: PolicyReportIssueV2[];
  artifact: SiteArtifactRecord;
  summary: string;
};

export function runPolicyReportV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): PolicyReportV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const issues = policyIssuesForBundle(input.bundle, version);
  const status = issues.some((issue) => issue.severity === "blocking") ? "failed" : "passed";
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: version?.id,
    status,
    issues
  };
  const contentHash = hashPayload(payload);
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_policy_report_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "policy_report",
    artifactVersion: "policy-report-v2",
    producerId: "policy.google-places",
    producerVersion: "direct-module-v1",
    sourceFactIds: [],
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  return {
    skillId: "policy.google-places",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    status,
    issues,
    artifact,
    summary: `${status === "passed" ? "Passed" : "Failed"} policy audit with ${issues.filter((issue) => issue.severity === "blocking").length} blocker${issues.filter((issue) => issue.severity === "blocking").length === 1 ? "" : "s"}.`
  };
}

function policyIssuesForBundle(bundle: SiteBundle, version: SiteVersion | undefined): PolicyReportIssueV2[] {
  const issues: PolicyReportIssueV2[] = [];
  const compiledText = JSON.stringify(version?.rendererVersion === "layout-v2" ? version.compiledPages : version?.pages ?? []);

  for (const signal of bundle.presenceAssessment.publicPresenceSignals ?? []) {
    if (signal.source !== "places_api" && signal.provider !== "google_places") continue;
    if (signal.fields.rating !== undefined || signal.fields.userRatingCount !== undefined || signal.fields.googleMapsUri) {
      issues.push({
        id: `policy_google_places_static_fields_${issues.length + 1}`,
        severity: "blocking",
        category: "google_places",
        detail: "Google Places rating, review count, or Maps URI is stored in public-presence signal fields.",
        evidence: JSON.stringify({
          hasRating: signal.fields.rating !== undefined,
          hasReviewCount: signal.fields.userRatingCount !== undefined,
          hasMapsUri: Boolean(signal.fields.googleMapsUri)
        })
      });
    }
    if (!signal.placeId) {
      issues.push({
        id: `policy_google_places_place_id_missing_${issues.length + 1}`,
        severity: "warning",
        category: "google_places",
        detail: "Google Places signal is missing place_id, so compliant live/link display cannot be resolved."
      });
    }
  }

  const googleReviewSummary = bundle.businessProfile.reviewsSummary?.sources.includes("google_places");
  if (googleReviewSummary) {
    const rating = bundle.businessProfile.reviewsSummary?.rating?.toString();
    const count = bundle.businessProfile.reviewsSummary?.count?.toString();
    if ((rating && compiledText.includes(rating)) || (count && compiledText.includes(count))) {
      issues.push({
        id: "policy_google_review_summary_rendered",
        severity: "blocking",
        category: "google_places",
        detail: "Google-derived rating or review count appears in compiled public site data."
      });
    }
  }

  const jsonLd = makeLocalBusinessJsonLd(bundle.businessProfile);
  if (JSON.stringify(jsonLd).includes("AggregateRating") && googleReviewSummary) {
    issues.push({
      id: "policy_google_aggregate_rating_jsonld",
      severity: "blocking",
      category: "structured_data",
      detail: "Google-derived review summary must not be serialized into LocalBusiness aggregateRating JSON-LD."
    });
  } else {
    issues.push({
      id: "policy_google_aggregate_rating_jsonld",
      severity: "pass",
      category: "structured_data",
      detail: "No Google-derived aggregateRating JSON-LD detected."
    });
  }

  if (!issues.some((issue) => issue.category === "google_places" && issue.severity === "blocking")) {
    issues.push({
      id: "policy_google_static_proof_safe",
      severity: "pass",
      category: "google_places",
      detail: "No static Google rating, review count, or Maps URI leakage detected in V2 policy audit."
    });
  }

  return issues;
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
