import { createHash } from "node:crypto";
import type { AssetReference, SiteBundle } from "./models";
import { storeAssetBytes } from "./asset-storage";
import { validatePublicHostname } from "./url-safety";

/**
 * Scraped media pipeline (product decision, this iteration):
 *
 * Real photos and the logo are downloaded from the business's own website at
 * intake and stored PRIVATELY (rightsStatus stays `reference_only`). They may
 * render on access-protected surfaces only — admin candidate previews and the
 * owner dashboard — so v1 sites look real before the owner ever signs in.
 * They are NEVER served on public/claimed-published surfaces until the owner
 * attests rights per photo (per-image attestation flow), which flips them to
 * `customer_granted`.
 *
 * Enforcement points:
 * - Asset serving: `scraped-` storage files require an authenticated
 *   admin/owner request (app/api/assets/[siteId]/[file]/route.ts).
 * - Public route: unclaimed sites whose compiled media includes
 *   reference_only assets are not publicly reachable.
 * - Compile: reference media is only eligible when the compile explicitly
 *   opts in (protected-preview policy).
 */

const maxScrapedAssetBytes = 8 * 1024 * 1024;
const maxScrapedPhotos = 12;
const allowedImageTypes = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export const scrapedAssetFilePrefix = "scraped-";

export function isScrapedAssetFile(file: string) {
  return file.startsWith(scrapedAssetFilePrefix);
}

export type ScrapedMediaManifestEntry = {
  assetId: string;
  kind: "photo" | "logo";
  originalUrl: string;
  storedUrl: string;
  contentHash: string;
  bytes: number;
  scrapedAt: string;
  /** Natural dimensions, measured during palette sampling; feeds media casting. */
  width?: number;
  height?: number;
};

async function downloadImage(url: string): Promise<{ bytes: Buffer; extension: string; mimeType: string } | undefined> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    if (parsed.username || parsed.password) return undefined;
    if (!validatePublicHostname(parsed.hostname).ok) return undefined;
    const response = await fetch(parsed.href, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "image/jpeg,image/png,image/webp,image/*" }
    });
    if (!response.ok) return undefined;
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const extension = allowedImageTypes.get(mimeType);
    if (!extension) return undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.byteLength || buffer.byteLength > maxScrapedAssetBytes) return undefined;
    return { bytes: buffer, extension, mimeType };
  } catch {
    return undefined;
  }
}

/**
 * Download the bundle's crawled photos + logo into private storage and point
 * the profile at the stored copies. Failures are per-asset and non-fatal: an
 * asset that cannot be downloaded keeps its original remote URL and simply
 * stays ineligible for any rendering surface that requires stored assets.
 */
export async function scrapeAndStoreBusinessMedia(bundle: SiteBundle): Promise<ScrapedMediaManifestEntry[]> {
  const siteId = bundle.businessProfile.siteId;
  const manifest: ScrapedMediaManifestEntry[] = [];
  const scrapedAt = new Date().toISOString();

  const store = async (reference: AssetReference, kind: "photo" | "logo", index: number): Promise<AssetReference> => {
    if (!/^https?:/i.test(reference.url)) return reference;
    const downloaded = await downloadImage(reference.url);
    if (!downloaded) return reference;
    const contentHash = createHash("sha256").update(downloaded.bytes).digest("hex");
    const assetId = `${scrapedAssetFilePrefix}${kind}-${index + 1}-${contentHash.slice(0, 10)}`;
    const stored = await storeAssetBytes({
      siteId,
      assetId,
      bytes: downloaded.bytes,
      mimeType: downloaded.mimeType as "image/jpeg" | "image/png" | "image/webp",
      // Privacy invariant: scraped media never goes to the public bucket.
      // Local storage serves through the auth-gated /api/assets route only.
      forceLocal: true
    });
    if (!stored.url) return reference;
    manifest.push({
      assetId,
      kind,
      originalUrl: reference.url,
      storedUrl: stored.url,
      contentHash,
      bytes: downloaded.bytes.byteLength,
      scrapedAt
    });
    return { ...reference, url: stored.url, rightsStatus: "reference_only" };
  };

  const photos: AssetReference[] = [];
  for (const [index, photo] of bundle.businessProfile.photos.slice(0, maxScrapedPhotos).entries()) {
    if (photo.rightsStatus !== "reference_only") {
      photos.push(photo);
      continue;
    }
    photos.push(await store(photo, "photo", index));
  }
  bundle.businessProfile.photos = photos;

  if (bundle.businessProfile.logo && bundle.businessProfile.logo.rightsStatus === "reference_only") {
    bundle.businessProfile.logo = await store(bundle.businessProfile.logo, "logo", 0);
  }

  if (manifest.length) {
    bundle.presenceAssessment.scrapedMediaManifest = manifest;
    bundle.presenceAssessment.technicalNotes.push(
      `Scraped ${manifest.length} media assets into private storage; reference_only until owner attestation.`
    );
  }
  return manifest;
}

/**
 * Media casting (deterministic pass): hero slots want wide, contextual
 * photography; detail close-ups belong in cards. Reorders the profile's
 * scraped photos so the best hero candidate leads selection.
 */
export function castScrapedPhotos(bundle: SiteBundle): void {
  const manifest = bundle.presenceAssessment.scrapedMediaManifest;
  if (!manifest?.length) return;
  const dimensionsByUrl = new Map(manifest.map((entry) => [entry.storedUrl, entry]));
  // Composition floor: favicons/thumbnails (a 20x20 icon, a 147x98 thumb) are
  // palette inputs, never page imagery. Unknown dimensions stay eligible —
  // public-safe remote photos aren't measured.
  bundle.businessProfile.photos = bundle.businessProfile.photos.filter((photo) => {
    const entry = dimensionsByUrl.get(photo.url);
    if (!entry?.width || !entry?.height) return true;
    return entry.width >= 500 && entry.height >= 300;
  });
  const heroScore = (url: string) => {
    const entry = dimensionsByUrl.get(url);
    if (!entry?.width || !entry?.height) return 0;
    const aspect = entry.width / entry.height;
    let score = Math.min(entry.width, 1600) / 1600;
    if (aspect >= 1.15 && aspect <= 2.3) score += 0.8; // landscape context shot
    if (entry.width < 700) score -= 0.6; // too small to lead
    if (aspect < 0.85) score -= 0.3; // portrait detail crops
    return score;
  };
  bundle.businessProfile.photos = [...bundle.businessProfile.photos].sort(
    (left, right) => heroScore(right.url) - heroScore(left.url)
  );
}
