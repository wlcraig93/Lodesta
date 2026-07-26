import { getOwnerSiteInventory } from "@/lib/owner-workspace";
import { getOwnerAccountOverview, type OwnerAccountSiteOverview } from "@/lib/account-overview";
import { deriveOwnerSiteLifecycle, type OwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";
import { getWebsiteSetupView, type WebsiteSetupView } from "@/lib/website-setups";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { deriveSitePublicationReadiness } from "@/packages/site-platform/publication-readiness";

export type AccountRelationship = {
  id: string;
  kind: "setup" | "site";
  name: string;
  detail: string;
  hostname?: string;
  recentLabel: string;
  thumbnailUrl?: string;
  lifecycle: OwnerSiteLifecycle;
  nextHref: string;
  siteId?: string;
  setupId?: string;
  setupView?: WebsiteSetupView;
  initialBuildModelId?: string;
};

export async function getAccountContext() {
  const inventory = await getOwnerSiteInventory();
  if (!inventory.auth.user) return { ...inventory, relationships: [] as AccountRelationship[] };

  const [setups, overview] = await Promise.all([
    platformOperationsRepository.listWebsiteSetupsForOwner(inventory.auth.user.id),
    getOwnerAccountOverview(inventory.auth.user.id, inventory.sites)
  ]);
  const ownedSiteIds = new Set(inventory.sites.map((site) => site.id));
  const currentSetups = setups.filter((setup) =>
    setup.status !== "canceled"
    && (!setup.siteId || !ownedSiteIds.has(setup.siteId))
  );
  const optionsById = new Map(inventory.options.map((site) => [site.id, site]));
  const statesByBusinessId = new Map(inventory.businessStates.map((state) => [state.businessId, state]));
  const overviewBySiteId = new Map(overview.map((item) => [item.siteId, item]));
  const setupBySiteId = new Map(setups.flatMap((setup) => setup.siteId ? [[setup.siteId, setup] as const] : []));

  const setupRelationships = await Promise.all(currentSetups.map(async (setup): Promise<AccountRelationship> => {
    const view = await getWebsiteSetupView(setup);
    const site = setup.siteId ? optionsById.get(setup.siteId) : undefined;
    const name = site?.name ?? hostnameLabel(setup.sourceUrl);
    return {
      id: `setup:${setup.id}`,
      setupId: setup.id,
      kind: "setup",
      name,
      hostname: hostnameLabel(setup.sourceUrl),
      detail: setupDetail(view),
      recentLabel: formatRecent(setup.updatedAt, view.phase === "needs_attention" ? "Updated" : "Started"),
      lifecycle: setupLifecycle(view, `/account/onboarding/${setup.id}`),
      nextHref: `/account/onboarding/${setup.id}`,
      setupView: view,
      initialBuildModelId: setup.initialBuildModelId
    };
  }));

  const sitesById = new Map(inventory.sites.map((site) => [site.id, site]));
  const siteRelationships = await Promise.all(inventory.options.map(async (option): Promise<AccountRelationship> => {
    const site = sitesById.get(option.id);
    if (!site) throw new Error(`Owner inventory is missing site ${option.id}.`);
    const siteOverview = overviewBySiteId.get(site.id);
    if (!siteOverview) throw new Error(`Owner account overview is missing site ${site.id}.`);
    const { versions, runs } = siteOverview;
    const originatingSetup = setupBySiteId.get(site.id);
    const initialRun = runs.find((run) => run.kind === "initial_build")
      ?? (originatingSetup?.runId ? await sitePlatformRepository.getAgentRun(originatingSetup.runId) : undefined);
    const state = statesByBusinessId.get(site.businessId);
    const candidate = versions.find((version) => version.status === "candidate");
    const attention = {
      operatorItems: siteOverview.openQueueCount,
      pendingProof: state?.proof.filter((item) => item.status === "observed").length,
      replyInquiries: siteOverview.replyInquiryCount,
      domainAttention: siteOverview.domainAttention
    };
    const readiness = candidate && lifecycleNeedsPublicationReadiness(siteOverview, attention)
      ? await deriveSitePublicationReadiness({ versionId: candidate.id, repository: sitePlatformRepository })
      : undefined;
    const lifecycle = deriveOwnerSiteLifecycle({
      slug: site.slug,
      site,
      versions,
      runs,
      readiness,
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
      nextHref: `/workspace/${site.slug}`,
      initialBuildModelId: initialRun?.modelId ?? originatingSetup?.initialBuildModelId
    };
  }));

  return { ...inventory, setups, relationships: [...setupRelationships, ...siteRelationships] };
}

function lifecycleNeedsPublicationReadiness(
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
function setupDetail(view: WebsiteSetupView) {
  if (view.phase === "needs_attention") return view.message ?? "This setup needs your attention.";
  if (view.phase === "building") return "Lodesta is reading your website and building the first version.";
  return "Your website is waiting for the setup worker.";
}

function setupLifecycle(view: WebsiteSetupView, href: string): OwnerSiteLifecycle {
  if (view.phase === "needs_attention") {
    return { state: "needs_attention", tone: "attention", label: "Needs attention", title: "Your website setup needs attention", detail: setupDetail(view), nextAction: { href, label: "View next step" } };
  }
  return {
    state: "building",
    tone: view.phase === "building" ? "info" : "neutral",
    label: view.phase === "building" ? "Building" : "Queued",
    title: view.phase === "building" ? "Your website is being prepared" : "Your website setup is queued",
    detail: setupDetail(view),
    nextAction: { href, label: "View progress" }
  };
}

function formatRecent(value: string, prefix: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return prefix;
  return `${prefix} ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date)}`;
}
