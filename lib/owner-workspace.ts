import { notFound } from "next/navigation";
import { cache } from "react";
import { authRequired, hasPlatformAdminRole } from "@/lib/auth-policy";
import { requirePlatformSiteOwnerAccess, type OwnerWorkspaceAccessMode } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/supabase/server";
import { resolveOwnerIdentity } from "@/lib/owner-identity";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { PlatformSiteRecord } from "@/packages/site-contracts";

export type OwnerWorkspaceSiteOption = {
  id: string;
  slug: string;
  name: string;
  status: PlatformSiteRecord["status"];
  published: boolean;
};

const getOwnerSiteBySlug = cache((slug: string) => sitePlatformRepository.getSiteBySlug(slug));
const getOwnerBusinessState = cache((businessId: string) => sitePlatformRepository.getBusinessState(businessId));

export const getOwnerSiteInventory = cache(async function getOwnerSiteInventory() {
  const auth = await getCurrentUser();
  const localOpenMode = !auth.configured && !authRequired();
  const canAccessAdmin = localOpenMode || hasPlatformAdminRole(auth.user);
  if (localOpenMode) {
    const sites = await sitePlatformRepository.listSites();
    const businessStates = await sitePlatformRepository.getBusinessStatesByIds(sites.map((site) => site.businessId));
    return { auth, localOpenMode, canAccessAdmin, sites, options: siteOptions(sites, businessStates), businessStates };
  }
  if (auth.user?.id) {
    const { sites, businessStates } = await sitePlatformRepository.getSitesWithBusinessStatesByOwnerUserId(auth.user.id);
    return { auth, localOpenMode, canAccessAdmin, sites, options: siteOptions(sites, businessStates), businessStates };
  }
  return { auth, localOpenMode, canAccessAdmin, sites: [], options: [], businessStates: [] };
});

export async function requireOwnerWorkspace(slug: string, nextPath: string) {
  const site = await getOwnerSiteBySlug(slug);
  if (!site) notFound();
  const statePromise = getOwnerBusinessState(site.businessId);
  const access = await requirePlatformSiteOwnerAccess(site, nextPath);
  const [state, inventory] = await Promise.all([
    statePromise,
    access.mode === "platform_admin_preview" ? undefined : getOwnerSiteInventory()
  ]);
  if (!state) notFound();
  const currentOption: OwnerWorkspaceSiteOption = {
    id: site.id,
    slug: site.slug,
    name: state.identity.name,
    status: site.status,
    published: Boolean(site.publishedVersionId)
  };
  const options = access.mode === "platform_admin_preview" ? [currentOption] : inventory?.options ?? [];
  return {
    site,
    state,
    access,
    accessMode: access.mode satisfies OwnerWorkspaceAccessMode,
    canAccessAdmin: access.canAccessAdmin,
    tokenAccess: access.tokenAccess,
    options,
    accountIdentity: resolveOwnerIdentity(access.user, access.mode === "local_open" ? "Local access" : "Admin access"),
    authConfigured: access.configured
  };
}

function siteOptions(
  sites: PlatformSiteRecord[],
  businessStates: Awaited<ReturnType<typeof sitePlatformRepository.getBusinessStatesByIds>>
) {
  const statesByBusinessId = new Map(businessStates.map((state) => [state.businessId, state]));
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
