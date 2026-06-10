import { createHash } from "node:crypto";
import type { SiteArtifactRecord, SiteBundle, SiteVersion } from "./models";
import { runClaimVerificationReportV2, type ClaimReportIssueV2 } from "./claim-report-v2";

export type RegulatedClaimsPolicyV2Result = {
  skillId: "policy.regulated-claims";
  skillVersion: "direct-module-v1";
  versionId?: string;
  status: "passed" | "failed";
  issues: ClaimReportIssueV2[];
  artifact: SiteArtifactRecord;
  summary: string;
};

const regulatedCategories = new Set<ClaimReportIssueV2["category"]>([
  "credential",
  "insurance",
  "pricing",
  "warranty",
  "emergency",
  "regulated"
]);

export function runRegulatedClaimsPolicyV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): RegulatedClaimsPolicyV2Result {
  const claimReport = runClaimVerificationReportV2(input);
  const issues = claimReport.issues.filter((issue) => regulatedCategories.has(issue.category));
  const status = issues.some((issue) => issue.severity === "blocking") ? "failed" : "passed";
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: claimReport.versionId,
    status,
    issues,
    policy: "Regulated and sensitive claims must be backed by source-aware facts before public rendering."
  };
  const contentHash = hashPayload(payload);
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_regulated_claims_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "policy_report",
    artifactVersion: "regulated-claims-policy-v2",
    producerId: "policy.regulated-claims",
    producerVersion: "direct-module-v1",
    sourceFactIds: claimReport.artifact.sourceFactIds,
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  return {
    skillId: "policy.regulated-claims",
    skillVersion: "direct-module-v1",
    versionId: claimReport.versionId,
    status,
    issues,
    artifact,
    summary: `${status === "passed" ? "Passed" : "Failed"} regulated-claims policy audit with ${issues.length} issue${issues.length === 1 ? "" : "s"}.`
  };
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
