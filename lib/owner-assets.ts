import { createHash } from "node:crypto";
import type { AssetAttestationV2, AssetReference, SiteAsset, SiteBundle } from "./models";
import { validatePublicHostname } from "./url-safety";
import { applyPropsToLayoutSection, syncVersionLegacySections } from "./layout-registry";

export type OwnerAssetInput = {
  url: string;
  alt: string;
  /** Per-image rights confirmation; assets without it are rejected, never silently dropped. */
  rightsConfirmed: boolean;
};

export type ScrapedAssetAttestationInput = {
  assetId: string;
  rightsConfirmed: boolean;
};

export type UpdateOwnerAssetsInput = {
  siteId: string;
  /** Authenticated principal recorded on every attestation. */
  attestedBy: string;
  logo?: OwnerAssetInput;
  photos?: OwnerAssetInput[];
  /** Attestations for crawled reference_only images; confirmed ones become customer_granted. */
  scrapedAttestations?: ScrapedAssetAttestationInput[];
};

export type UpdateOwnerAssetsResult =
  | { ok: true; bundle: SiteBundle; logo?: AssetReference; photos: AssetReference[]; assets: SiteAsset[] }
  | { ok: false; reason: string };

export const assetAttestationStatement = "I own this image or hold the rights to use it on this website.";

export function buildAssetAttestation(attestedBy: string, url: string): AssetAttestationV2 {
  return {
    attestedBy,
    attestedAt: new Date().toISOString(),
    imageHash: createHash("sha256").update(url).digest("hex"),
    statement: assetAttestationStatement
  };
}

/** Typed round-trip for the metadata.attestation contract. */
export function parseAssetAttestation(metadata: Record<string, unknown> | undefined): AssetAttestationV2 | undefined {
  const candidate = metadata?.attestation;
  if (!candidate || typeof candidate !== "object") return undefined;
  const record = candidate as Record<string, unknown>;
  if (
    typeof record.attestedBy !== "string" ||
    typeof record.attestedAt !== "string" ||
    typeof record.imageHash !== "string" ||
    typeof record.statement !== "string"
  ) {
    return undefined;
  }
  return {
    attestedBy: record.attestedBy,
    attestedAt: record.attestedAt,
    imageHash: record.imageHash,
    statement: record.statement
  };
}

export function applyOwnerAssetsUpdate(bundle: SiteBundle, input: UpdateOwnerAssetsInput): UpdateOwnerAssetsResult {
  if (!input.attestedBy.trim()) {
    return { ok: false, reason: "Owner asset updates require an authenticated principal to record attestations." };
  }

  const unconfirmed = [
    ...(input.logo?.url.trim() && !input.logo.rightsConfirmed ? ["logo"] : []),
    ...(input.photos ?? []).filter((photo) => photo.url.trim() && !photo.rightsConfirmed).map((photo) => photo.alt || photo.url)
  ];
  if (unconfirmed.length) {
    return {
      ok: false,
      reason: `Each image requires its own rights confirmation before it can be used. Unconfirmed: ${unconfirmed.join(", ")}.`
    };
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

  const scrapedResult = applyScrapedAttestations(bundle, input);
  if (!scrapedResult.ok) return scrapedResult;

  if (logo || input.logo?.url.trim()) {
    bundle.businessProfile.logo = logo;
    bundle.businessProfile.provenance.logo = ownerAssetProvenance();
  }
  if (photos.length || (input.photos ?? []).length) {
    bundle.businessProfile.photos = [...photos, ...scrapedResult.attestedPhotos];
    bundle.businessProfile.provenance.photos = ownerAssetProvenance();
  } else if (scrapedResult.attestedPhotos.length) {
    bundle.businessProfile.photos = [
      ...bundle.businessProfile.photos.filter((photo) => !scrapedResult.attestedIds.has(photo.id)),
      ...scrapedResult.attestedPhotos
    ];
  }

  const ownerAssets = [
    ...(logo ? [siteAssetFromReference(bundle.businessProfile.siteId, "logo", logo, input.attestedBy)] : []),
    ...photos.map((photo) => siteAssetFromReference(bundle.businessProfile.siteId, "photo", photo, input.attestedBy)),
    ...scrapedResult.attestedPhotos.map((photo) => siteAssetFromReference(bundle.businessProfile.siteId, "photo", photo, input.attestedBy))
  ];
  const ownerAssetIds = new Set(ownerAssets.map((asset) => asset.id));
  bundle.presenceAssessment.assetInventory = [
    ...(bundle.presenceAssessment.assetInventory ?? []).filter(
      (asset) => !(asset.ownerApproved && (asset.kind === "photo" || asset.kind === "logo")) && !ownerAssetIds.has(asset.id)
    ),
    ...ownerAssets
  ];

  updateGallerySections(bundle, [...photos, ...scrapedResult.attestedPhotos]);

  return {
    ok: true,
    bundle,
    logo,
    photos: [...photos, ...scrapedResult.attestedPhotos],
    assets: ownerAssets
  };
}

function applyScrapedAttestations(
  bundle: SiteBundle,
  input: UpdateOwnerAssetsInput
):
  | { ok: true; attestedPhotos: AssetReference[]; attestedIds: Set<string> }
  | { ok: false; reason: string } {
  const attestedPhotos: AssetReference[] = [];
  const attestedIds = new Set<string>();
  for (const attestation of input.scrapedAttestations ?? []) {
    if (!attestation.rightsConfirmed) continue;
    const scraped = bundle.businessProfile.photos.find(
      (photo) => photo.id === attestation.assetId && photo.rightsStatus === "reference_only"
    );
    if (!scraped) {
      return { ok: false, reason: `Scraped asset ${attestation.assetId} was not found among attestable reference images.` };
    }
    attestedIds.add(scraped.id);
    attestedPhotos.push({
      ...scraped,
      rightsStatus: "customer_granted"
    });
  }
  return { ok: true, attestedPhotos, attestedIds };
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

function siteAssetFromReference(siteId: string, kind: "logo" | "photo", reference: AssetReference, attestedBy: string): SiteAsset {
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
    metadata: {
      sourceAssetId: reference.id,
      attestation: buildAssetAttestation(attestedBy, reference.url)
    },
    createdAt: new Date().toISOString()
  };
}

function updateGallerySections(bundle: SiteBundle, photos: AssetReference[]) {
  const galleryImages = photos.map((photo) => ({
    url: photo.url,
    alt: photo.alt,
    label: "Business photo"
  }));
  for (const version of bundle.siteModel.versions) {
    for (const page of version.pages) {
      for (const section of page.layoutSections) {
        if (section.kind !== "gallery") continue;
        applyPropsToLayoutSection(section, { images: galleryImages });
      }
    }
    syncVersionLegacySections(version);
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
  if (/^\/api\/assets\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*\.(png|jpe?g|webp)$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    if (!validatePublicHostname(url.hostname).ok) return "";
    if (!/\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(url.href)) return "";
    return url.href;
  } catch {
    return "";
  }
}
