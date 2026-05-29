import type { AssetReference, SiteAsset, SiteBundle } from "./models";

export type OwnerAssetInput = {
  url: string;
  alt: string;
};

export type UpdateOwnerAssetsInput = {
  siteId: string;
  logo?: OwnerAssetInput;
  photos?: OwnerAssetInput[];
  rightsAccepted: boolean;
};

export type UpdateOwnerAssetsResult =
  | { ok: true; bundle: SiteBundle; logo?: AssetReference; photos: AssetReference[]; assets: SiteAsset[] }
  | { ok: false; reason: string };

export function applyOwnerAssetsUpdate(bundle: SiteBundle, input: UpdateOwnerAssetsInput): UpdateOwnerAssetsResult {
  if (!input.rightsAccepted) {
    return { ok: false, reason: "Confirm rights before using owner-provided assets on the published site." };
  }

  const logo: AssetReference | undefined = input.logo?.url.trim() ? ownerAssetReference(bundle, "logo", input.logo, 0) : undefined;
  const photos: AssetReference[] = [];
  for (const [index, photo] of (input.photos ?? []).entries()) {
    const asset = ownerAssetReference(bundle, "photo", photo, index);
    if (asset) photos.push(asset);
    if (photos.length >= 12) break;
  }

  if (input.logo?.url.trim() && !logo) return { ok: false, reason: "Logo URL must be a valid image URL." };
  if ((input.photos ?? []).some((photo) => photo.url.trim()) && photos.length === 0) {
    return { ok: false, reason: "Photo URLs must be valid image URLs." };
  }

  bundle.businessProfile.logo = logo;
  bundle.businessProfile.photos = photos;
  bundle.businessProfile.provenance.logo = ownerAssetProvenance();
  bundle.businessProfile.provenance.photos = ownerAssetProvenance();

  const ownerAssets = [
    ...(logo ? [siteAssetFromReference(bundle.businessProfile.siteId, "logo", logo)] : []),
    ...photos.map((photo) => siteAssetFromReference(bundle.businessProfile.siteId, "photo", photo))
  ];
  const ownerAssetIds = new Set(ownerAssets.map((asset) => asset.id));
  bundle.presenceAssessment.assetInventory = [
    ...(bundle.presenceAssessment.assetInventory ?? []).filter(
      (asset) => !(asset.ownerApproved && (asset.kind === "photo" || asset.kind === "logo")) && !ownerAssetIds.has(asset.id)
    ),
    ...ownerAssets
  ];

  if (photos.length) updateGallerySections(bundle, photos);

  return {
    ok: true,
    bundle,
    logo,
    photos,
    assets: ownerAssets
  };
}

function ownerAssetReference(
  bundle: SiteBundle,
  kind: "logo" | "photo",
  input: OwnerAssetInput,
  index: number
): AssetReference | undefined {
  const url = cleanAssetUrl(input.url);
  const alt = input.alt.trim();
  if (!url || !alt) return undefined;
  return {
    id: `owner_${kind}_${bundle.businessProfile.siteId}_${kind === "logo" ? "primary" : index + 1}`,
    url,
    alt,
    source: "uploaded" as const,
    rightsStatus: "customer_granted" as const
  };
}

function siteAssetFromReference(siteId: string, kind: "logo" | "photo", reference: AssetReference): SiteAsset {
  return {
    id: `site_asset_${reference.id}`,
    siteId,
    kind,
    url: reference.url,
    alt: reference.alt,
    source: reference.source,
    rightsStatus: reference.rightsStatus,
    usageScope: "published_site",
    ownerApproved: true,
    provenance: ownerAssetProvenance(),
    metadata: { sourceAssetId: reference.id, ownerGranted: true },
    createdAt: new Date().toISOString()
  };
}

function updateGallerySections(bundle: SiteBundle, photos: AssetReference[]) {
  const galleryImages = photos.map((photo) => ({
    url: photo.url,
    alt: photo.alt,
    label: "Owner-approved"
  }));
  for (const version of bundle.siteModel.versions) {
    for (const page of version.pages) {
      for (const section of page.sections) {
        if (section.type !== "gallery") continue;
        section.props.images = galleryImages;
      }
    }
  }
}

function ownerAssetProvenance() {
  return {
    source: "owner" as const,
    confidence: 1,
    verified: true,
    observedAt: new Date().toISOString()
  };
}

function cleanAssetUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (!/\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(url.href)) return "";
    return url.href;
  } catch {
    return "";
  }
}
