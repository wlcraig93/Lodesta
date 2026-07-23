import type { PlatformSiteRecord, SiteAgentRun, SiteVersion } from "@/packages/site-contracts";

export type SiteLifecycleStatus = "generating" | "needs_attention" | "ready_for_review" | "published" | "draft";
export type SiteOwnershipStatus = "owned" | "unowned";

export const siteLifecycleLabels: Record<SiteLifecycleStatus, string> = {
  generating: "Generating",
  needs_attention: "Needs attention",
  ready_for_review: "Ready for review",
  published: "Published",
  draft: "Draft"
};

export const siteOwnershipLabels: Record<SiteOwnershipStatus, string> = {
  owned: "Account owned",
  unowned: "Unowned"
};

export function deriveSiteLifecycle(
  site: Pick<PlatformSiteRecord, "publishedVersionId">,
  versions: Array<Pick<SiteVersion, "status">>,
  latestRun?: Pick<SiteAgentRun, "status">
): SiteLifecycleStatus {
  if (latestRun?.status === "queued" || latestRun?.status === "running") return "generating";
  if (latestRun?.status === "failed" || latestRun?.status === "needs_input") return "needs_attention";
  if (site.publishedVersionId) return "published";
  if (versions.some((version) => version.status === "candidate")) return "ready_for_review";
  return "draft";
}

export function deriveSiteOwnership(site: Pick<PlatformSiteRecord, "ownerUserId">): SiteOwnershipStatus {
  return site.ownerUserId ? "owned" : "unowned";
}
