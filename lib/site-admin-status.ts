import type { ClaimRecord } from "@/packages/platform-operations";
import type { PlatformSiteRecord, SiteAgentRunV2, SiteVersionV4 } from "@/packages/site-contracts";

export type SiteLifecycleStatus = "generating" | "needs_attention" | "ready_for_review" | "published" | "draft";
export type SiteOwnershipStatus = "claimed" | "claim_pending" | "unclaimed";

export const siteLifecycleLabels: Record<SiteLifecycleStatus, string> = {
  generating: "Generating",
  needs_attention: "Needs attention",
  ready_for_review: "Ready for review",
  published: "Published",
  draft: "Draft"
};

export const siteOwnershipLabels: Record<SiteOwnershipStatus, string> = {
  claimed: "Claimed",
  claim_pending: "Claim pending",
  unclaimed: "Unclaimed"
};

export function deriveSiteLifecycle(
  site: Pick<PlatformSiteRecord, "publishedVersionId">,
  versions: Array<Pick<SiteVersionV4, "status">>,
  latestRun?: Pick<SiteAgentRunV2, "status">
): SiteLifecycleStatus {
  if (latestRun?.status === "queued" || latestRun?.status === "running") return "generating";
  if (latestRun?.status === "failed") return "needs_attention";
  if (site.publishedVersionId) return "published";
  if (versions.some((version) => version.status === "candidate")) return "ready_for_review";
  return "draft";
}

export function deriveSiteOwnership(claims: Array<Pick<ClaimRecord, "status">>): SiteOwnershipStatus {
  if (claims.some((claim) => claim.status === "claimed")) return "claimed";
  if (claims.length) return "claim_pending";
  return "unclaimed";
}
