import type { AssetReference, SiteBundle, SiteVersionV3 } from "./models";

export type RequiredAssetRight = {
  id: string;
  kind: "logo" | "photo";
  url: string;
  alt: string;
};

export function requiredAssetRightsForBundle(bundle: SiteBundle, version?: SiteVersionV3): RequiredAssetRight[] {
  const selectedVersion =
    version ??
    (bundle.siteModel.versions.find((candidate) => candidate.status === "draft") as SiteVersionV3 | undefined) ??
    (bundle.siteModel.versions[0] as SiteVersionV3 | undefined);
  const usedUrls = new Set<string>();
  if (selectedVersion?.rendererVersion === "layout-v3") collectStringValues(selectedVersion.pageComposition, usedUrls);

  const required: RequiredAssetRight[] = [];
  const add = (kind: "logo" | "photo", asset: AssetReference | undefined, requireUsage: boolean) => {
    if (!asset?.url || !isReferenceAsset(asset)) return;
    if (requireUsage && !usedUrls.has(asset.url)) return;
    required.push({ id: asset.id, kind, url: asset.url, alt: asset.alt || `${kind} reference` });
  };

  add("logo", bundle.businessProfile.logo, false);
  for (const photo of bundle.businessProfile.photos) add("photo", photo, true);

  const seen = new Set<string>();
  return required.filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

export function missingAssetRightIds(requiredAssets: RequiredAssetRight[], attestedAssetIds: readonly string[]) {
  const attested = new Set(attestedAssetIds);
  return requiredAssets.filter((asset) => !attested.has(asset.id)).map((asset) => asset.id);
}

function isReferenceAsset(asset: AssetReference) {
  return asset.rightsStatus === "reference_only" || asset.source === "website_reference";
}

function collectStringValues(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectStringValues(child, output);
  }
}
