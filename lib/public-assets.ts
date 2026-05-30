import type { SiteAsset, SiteBundle } from "./models";

export function isPublicLocalAssetPath(bundle: SiteBundle, storagePath: string) {
  const url = `/api/assets/${storagePath.replace(/^\/+/, "")}`;
  return (bundle.presenceAssessment.assetInventory ?? []).some((asset) => asset.url === url && isPublicSiteAsset(asset));
}

function isPublicSiteAsset(asset: SiteAsset) {
  if (!asset.url) return false;
  if (asset.source === "website_reference" || asset.rightsStatus === "reference_only") return false;
  if (asset.usageScope !== "published_site" && asset.usageScope !== "preclaim_preview") return false;
  if (asset.rightsStatus !== "customer_granted" && asset.rightsStatus !== "preclaim_safe") return false;
  return true;
}
