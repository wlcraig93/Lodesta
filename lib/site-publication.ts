import type { ClaimRecord, SiteBundle } from "./models";

const demoSiteIds = new Set(["site_joes_pizza"]);

export function isIndexableSite(bundle: SiteBundle, claims: ClaimRecord[]) {
  if (demoSiteIds.has(bundle.businessProfile.siteId)) return true;
  return claims.some((claim) => claim.siteId === bundle.businessProfile.siteId && claim.status === "claimed");
}
