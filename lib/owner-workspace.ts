import { notFound } from "next/navigation";
import { authRequired, hasPlatformAdminRole } from "@/lib/auth-policy";
import { requirePlatformSiteOwnerAccess, type OwnerWorkspaceAccessMode } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/supabase/server";
import { platformOperationsRepository } from "@/packages/platform-operations";
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
  const [auth, sites, claims] = await Promise.all([
    getCurrentUser(),
    sitePlatformRepository.listSites(),
    platformOperationsRepository.listClaims()
  ]);
  const localOpenMode = !auth.configured && !authRequired();
  const email = auth.user?.email?.toLowerCase();
  const canAccessAdmin = localOpenMode || hasPlatformAdminRole(auth.user);
  const visibleSites = localOpenMode
    ? sites
    : sites.filter((site) => claims.some((claim) =>
      claim.siteId === site.id &&
      claim.status === "claimed" &&
      ((auth.user?.id && claim.ownerUserId === auth.user.id) || (email && claim.ownerEmail?.toLowerCase() === email))
    ));
  const options = await siteOptions(visibleSites);
  return { auth, claims, localOpenMode, canAccessAdmin, sites: visibleSites, options };
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
  return Promise.all(sites.map(async (site) => {
    const state = await sitePlatformRepository.getBusinessState(site.businessId);
    return {
      id: site.id,
      slug: site.slug,
      name: state?.identity.name ?? site.slug.replaceAll("-", " "),
      status: site.status,
      published: Boolean(site.publishedVersionId)
    };
  }));
}
