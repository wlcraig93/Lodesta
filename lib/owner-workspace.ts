import { notFound } from "next/navigation";
import { authRequired, hasPlatformAdminRole } from "@/lib/auth-policy";
import { requirePlatformSiteOwnerAccess, type OwnerWorkspaceAccessMode } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/supabase/server";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { PlatformSiteRecord } from "@/packages/site-contracts";

export type OwnerWorkspaceSiteOption = {
  id: string;
  slug: string;
  name: string;
  status: PlatformSiteRecord["status"];
  published: boolean;
};

export async function getOwnerSiteInventory() {
  const auth = await getCurrentUser();
  const localOpenMode = !auth.configured && !authRequired();
  const canAccessAdmin = localOpenMode || hasPlatformAdminRole(auth.user);
  const visibleSites = localOpenMode
    ? await sitePlatformRepository.listSites()
    : auth.user?.id
      ? await sitePlatformRepository.getSitesByOwnerUserId(auth.user.id)
      : [];
  const options = await siteOptions(visibleSites);
  return { auth, localOpenMode, canAccessAdmin, sites: visibleSites, options };
}

export async function requireOwnerWorkspace(slug: string, nextPath: string) {
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  const access = await requirePlatformSiteOwnerAccess(site.id, nextPath);
  const [state, inventory] = await Promise.all([
    sitePlatformRepository.getBusinessState(site.businessId),
    getOwnerSiteInventory()
  ]);
  if (!state) notFound();
  const currentOption: OwnerWorkspaceSiteOption = {
    id: site.id,
    slug: site.slug,
    name: state.identity.name,
    status: site.status,
    published: Boolean(site.publishedVersionId)
  };
  const options = access.mode === "platform_admin_preview" ? [currentOption] : inventory.options;
  return {
    site,
    state,
    access,
    accessMode: access.mode satisfies OwnerWorkspaceAccessMode,
    canAccessAdmin: access.canAccessAdmin,
    tokenAccess: access.tokenAccess,
    options,
    accountLabel: access.user?.email ?? (access.mode === "local_open" ? "Local access" : "Admin access"),
    accountEmail: access.user?.email ?? undefined,
    authConfigured: access.configured
  };
}

async function siteOptions(sites: PlatformSiteRecord[]): Promise<OwnerWorkspaceSiteOption[]> {
  const states = await sitePlatformRepository.getBusinessStatesByIds(sites.map((site) => site.businessId));
  const statesByBusinessId = new Map(states.map((state) => [state.businessId, state]));
  return sites.map((site) => {
    const state = statesByBusinessId.get(site.businessId);
    return {
      id: site.id,
      slug: site.slug,
      name: state?.identity.name ?? site.slug.replaceAll("-", " "),
      status: site.status,
      published: Boolean(site.publishedVersionId)
    };
  });
}
