import { getOwnerSiteInventory } from "@/lib/owner-workspace";
import { getWebsiteSetupView, type WebsiteSetupView } from "@/lib/website-setups";
import { platformOperationsRepository } from "@/packages/platform-operations";

export type AccountRelationship = {
  id: string;
  kind: "setup" | "site";
  name: string;
  detail: string;
  statusLabel: string;
  nextHref: string;
  nextLabel: string;
  setupView?: WebsiteSetupView;
};

export async function getAccountContext() {
  const inventory = await getOwnerSiteInventory();
  if (!inventory.auth.user) return { ...inventory, relationships: [] as AccountRelationship[] };

  const setups = await platformOperationsRepository.listWebsiteSetupsForOwner(inventory.auth.user.id);
  const ownedSiteIds = new Set(inventory.sites.map((site) => site.id));
  const currentSetups = setups.filter((setup) =>
    setup.status !== "canceled"
    && (!setup.siteId || !ownedSiteIds.has(setup.siteId))
  );
  const optionsById = new Map(inventory.options.map((site) => [site.id, site]));

  const setupRelationships = await Promise.all(currentSetups.map(async (setup): Promise<AccountRelationship> => {
    const view = await getWebsiteSetupView(setup);
    const site = setup.siteId ? optionsById.get(setup.siteId) : undefined;
    const name = site?.name ?? hostnameLabel(setup.sourceUrl);
    return {
      id: `setup:${setup.id}`,
      kind: "setup",
      name,
      detail: setupDetail(view),
      statusLabel: setupStatusLabel(view),
      nextHref: `/account/onboarding/${setup.id}`,
      nextLabel: setupNextLabel(view),
      setupView: view
    };
  }));

  const siteRelationships: AccountRelationship[] = inventory.options.map((site) => ({
    id: `site:${site.id}`,
    kind: "site",
    name: site.name,
    detail: "Website project",
    statusLabel: site.published ? "Live" : "Draft",
    nextHref: `/workspace/${site.slug}`,
    nextLabel: "Open overview"
  }));

  return { ...inventory, setups, relationships: [...setupRelationships, ...siteRelationships] };
}

function hostnameLabel(value: string) { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "New website"; } }
function setupStatusLabel(view: WebsiteSetupView) {
  if (view.phase === "needs_attention") return "Needs attention";
  if (view.phase === "building") return "Building";
  return "Queued";
}
function setupNextLabel(view: WebsiteSetupView) { return view.phase === "needs_attention" ? "View next step" : "View progress"; }
function setupDetail(view: WebsiteSetupView) {
  if (view.phase === "needs_attention") return view.message ?? "This setup needs your attention.";
  if (view.phase === "building") return "Lodesta is reading your website and building the first version.";
  return "Your website is waiting for the setup worker.";
}
