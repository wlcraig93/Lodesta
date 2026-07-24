import type {
  PlatformSiteRecord,
  SiteAgentRun,
  SitePublicationReadiness,
  SiteVersion
} from "@/packages/site-contracts";

export type OwnerSiteLifecycleState =
  | "building"
  | "needs_attention"
  | "ready_to_publish"
  | "live"
  | "update_in_progress";

export type OwnerSiteLifecycleTone = "neutral" | "attention" | "success" | "info";

export type OwnerSiteLifecycle = {
  state: OwnerSiteLifecycleState;
  tone: OwnerSiteLifecycleTone;
  label: string;
  title: string;
  detail: string;
  nextAction: {
    href: string;
    label: string;
  };
};

export type OwnerSiteAttention = {
  operatorItems?: number;
  pendingProof?: number;
  replyInquiries?: number;
  domainAttention?: boolean;
};

export function deriveOwnerSiteLifecycle(input: {
  slug: string;
  site: Pick<PlatformSiteRecord, "publishedVersionId">;
  versions: Array<Pick<SiteVersion, "id" | "number" | "status">>;
  runs: Array<Pick<SiteAgentRun, "kind" | "status" | "stage" | "inputQuestion" | "retryableByOwner">>;
  readiness?: Pick<SitePublicationReadiness, "status" | "blockers">;
  attention?: OwnerSiteAttention;
}): OwnerSiteLifecycle {
  const base = `/workspace/${input.slug}`;
  const latestRun = input.runs[0];
  const candidate = input.versions.find((version) => version.status === "candidate");
  const published = input.versions.find((version) => version.status === "published");
  const attention = input.attention ?? {};

  if (latestRun?.status === "needs_input") {
    return lifecycle("needs_attention", "attention", "Needs attention",
      latestRun.inputQuestion ?? "Answer one question so Lodesta can continue.",
      `${base}/editor`, "Answer question");
  }
  if (latestRun?.status === "failed") {
    return lifecycle("needs_attention", "attention", "Needs attention",
      latestRun.retryableByOwner
        ? "The latest website work was interrupted and can be tried again."
        : "Lodesta flagged the latest website work for review.",
      `${base}/editor`, "Review website");
  }
  if (attention.pendingProof) {
    const count = attention.pendingProof;
    return lifecycle("needs_attention", "attention", "Needs attention",
      `${count} business confirmation${count === 1 ? "" : "s"} need review.`,
      `${base}/business-details#proof-media`, "Review details");
  }
  if (attention.operatorItems || attention.domainAttention) {
    return lifecycle("needs_attention", "attention", "Needs attention",
      attention.domainAttention ? "The custom domain needs to be re-verified." : "Lodesta found an item that needs review.",
      attention.domainAttention ? `${base}/settings#domain` : `${base}/editor`, "Review item");
  }
  if (attention.replyInquiries) {
    return lifecycle("needs_attention", "attention", "Needs attention",
      `${attention.replyInquiries} lead${attention.replyInquiries === 1 ? "" : "s"} waiting for a reply.`,
      `${base}/leads`, "Open leads");
  }
  if (latestRun?.status === "queued" || latestRun?.status === "running") {
    if (input.site.publishedVersionId) {
      return lifecycle("update_in_progress", "info", "Updating",
        "Your live website is available while Lodesta prepares the update.",
        `${base}/editor`, "View progress");
    }
    return lifecycle("building", "info", "Building",
      "Lodesta is preparing the first verified version.",
      `${base}/editor`, "View progress");
  }
  if (candidate && input.readiness?.status === "ready") {
    return lifecycle("ready_to_publish", "success", "Ready to publish",
      `Version ${candidate.number} passed its publication checks.`,
      `${base}/editor`, "Review and publish");
  }
  if (candidate && input.readiness?.status === "blocked") {
    return lifecycle("needs_attention", "attention", "Needs attention",
      `${input.readiness.blockers.length} publishing requirement${input.readiness.blockers.length === 1 ? "" : "s"} need review.`,
      `${base}/editor`, "Review requirements");
  }
  if (input.site.publishedVersionId || published) {
    return lifecycle("live", "success", "Live",
      published?.number ? `Published version ${published.number} is current.` : "The published website is current.",
      `${base}/analytics`, "View analytics");
  }
  return lifecycle("building", "neutral", "Building",
    "The first website version is being prepared.",
    `${base}/editor`, "Open editor");
}

function lifecycle(
  state: OwnerSiteLifecycleState,
  tone: OwnerSiteLifecycleTone,
  label: string,
  detail: string,
  href: string,
  actionLabel: string
): OwnerSiteLifecycle {
  return {
    state,
    tone,
    label,
    title: {
      building: "Your website is being prepared",
      needs_attention: "Your website needs attention",
      ready_to_publish: "Your verified update is ready",
      live: "Your website is live and current",
      update_in_progress: "Your website update is in progress"
    }[state],
    detail,
    nextAction: { href, label: actionLabel }
  };
}
