import { getOwnerSiteInventory } from "@/lib/owner-workspace";
import { getOwnerAccountOverview, type OwnerAccountSiteOverview } from "@/lib/account-overview";
import { deriveOwnerSiteLifecycle, type OwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";
import { sitePlatformRepository } from "@/packages/platform-data";
import { deriveSiteCandidateIntegrity } from "@/packages/site-platform/candidate-integrity";

export type AccountRelationship = {
  id: string;
  kind: "site";
  name: string;
  detail: string;
  hostname?: string;
  recentLabel: string;
  thumbnailUrl?: string;
  lifecycle: OwnerSiteLifecycle;
  nextHref: string;
  siteId: string;
};

export async function getAccountContext() {
  const inventory = await getOwnerSiteInventory();
  if (!inventory.auth.user) return { ...inventory, relationships: [] as AccountRelationship[] };

  const overview = await getOwnerAccountOverview(inventory.auth.user.id, inventory.sites);
  const optionsById = new Map(inventory.options.map((site) => [site.id, site]));
  const statesByBusinessId = new Map(inventory.businessStates.map((state) => [state.businessId, state]));
  const overviewBySiteId = new Map(overview.map((item) => [item.siteId, item]));

  const sitesById = new Map(inventory.sites.map((site) => [site.id, site]));
  const siteRelationships = await Promise.all(inventory.options.map(async (option): Promise<AccountRelationship> => {
    const site = sitesById.get(option.id);
    if (!site) throw new Error(`Owner inventory is missing site ${option.id}.`);
    const siteOverview = overviewBySiteId.get(site.id);
    if (!siteOverview) throw new Error(`Owner account overview is missing site ${site.id}.`);
    const { versions, runs } = siteOverview;
    const state = statesByBusinessId.get(site.businessId);
    const candidate = versions.find((version) => version.status === "candidate");
    const attention = {
      operatorItems: siteOverview.openQueueCount,
      pendingProof: state?.proof.filter((item) => item.status === "observed").length,
      replyInquiries: siteOverview.replyInquiryCount,
      domainAttention: siteOverview.domainAttention
    };
    const candidateIntegrity = candidate && lifecycleNeedsCandidateIntegrity(siteOverview, attention)
      ? await deriveSiteCandidateIntegrity({ versionId: candidate.id, repository: sitePlatformRepository })
      : undefined;
    const lifecycle = deriveOwnerSiteLifecycle({
      slug: site.slug,
      site,
      versions,
      runs,
      candidateIntegrity,
      attention
    });
    const published = versions.find((version) => version.status === "published");
    const recentAt = runs[0]?.completedAt ?? runs[0]?.startedAt ?? published?.publishedAt ?? site.updatedAt;
    const recentPrefix = published?.publishedAt === recentAt ? "Published" : "Updated";
    return {
      id: `site:${site.id}`,
      siteId: site.id,
      kind: "site",
      name: option.name,
      hostname: hostnameLabel(site.sourceUrl ?? `https://${site.slug}.lodesta.com`),
      detail: lifecycle.detail,
      recentLabel: formatRecent(recentAt, recentPrefix),
      thumbnailUrl: `/api/sites/${encodeURIComponent(site.id)}/thumbnail`,
      lifecycle,
      nextHref: `/workspace/${site.slug}`
    };
  }));

  return { ...inventory, relationships: siteRelationships };
}

function lifecycleNeedsCandidateIntegrity(
  overview: OwnerAccountSiteOverview,
  attention: {
    operatorItems?: number;
    pendingProof?: number;
    replyInquiries?: number;
    domainAttention?: boolean;
  }
) {
  const latestRun = overview.runs[0];
  return !["needs_input", "failed", "queued", "running"].includes(latestRun?.status ?? "")
    && !attention.operatorItems
    && !attention.pendingProof
    && !attention.replyInquiries
    && !attention.domainAttention;
}

function hostnameLabel(value: string) { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "New website"; } }
function formatRecent(value: string, prefix: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return prefix;
  return `${prefix} ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date)}`;
}
