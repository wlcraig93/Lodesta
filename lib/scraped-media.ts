import { createHash } from "node:crypto";
import type { AssetReference, SiteBundle } from "./models";
import { storeAssetBytes } from "./asset-storage";
import { measureImageDimensions } from "./image-dimensions";
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
  storagePath: string;
  contentHash: string;
  bytes: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
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

  const store = async (
    reference: AssetReference,
    kind: "photo" | "logo",
    index: number,
    downloaded?: Awaited<ReturnType<typeof downloadImage>>
  ): Promise<AssetReference> => {
    if (!/^https?:/i.test(reference.url)) return reference;
    downloaded ??= await downloadImage(reference.url);
    if (!downloaded) return reference;
    const contentHash = createHash("sha256").update(downloaded.bytes).digest("hex");
    const assetId = `${scrapedAssetFilePrefix}${kind}-${index + 1}-${contentHash.slice(0, 10)}`;
    const stored = await storeAssetBytes({
      siteId,
      assetId,
      bytes: downloaded.bytes,
      mimeType: downloaded.mimeType as "image/jpeg" | "image/png" | "image/webp",
      // Privacy invariant: scraped media is stored privately and is served
      // only through the authenticated /api/assets route.
      publicUrl: false
    });
    const storedUrl = `/api/assets/${stored.storagePath}`;
    // Measured from the file header at download time; the Playwright palette
    // pass later re-measures, but render gating must not depend on it.
    const dimensions = measureImageDimensions(downloaded.bytes, downloaded.mimeType);
    manifest.push({
      assetId,
      kind,
      originalUrl: reference.url,
      storedUrl,
      storagePath: stored.storagePath,
      contentHash,
      bytes: downloaded.bytes.byteLength,
      mimeType: downloaded.mimeType as "image/jpeg" | "image/png" | "image/webp",
      scrapedAt,
      ...(dimensions ?? {})
    });
    return { ...reference, url: storedUrl, rightsStatus: "reference_only", ...(dimensions ?? {}) };
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
    bundle.businessProfile.logo = await chooseAndStoreLogo(bundle, store);
    rejectNonLogoBrandMark(bundle, manifest);
  }
  bundle.businessProfile.logoCandidates = undefined;

  if (manifest.length) {
    bundle.presenceAssessment.scrapedMediaManifest = manifest;
    bundle.presenceAssessment.technicalNotes.push(
      `Scraped ${manifest.length} media assets into private storage; reference_only until owner attestation.`
    );
  }
  return manifest;
}

/** Matches the renderer's retina floor for the 42px header brand slot. */
const minUsableLogoPx = 84;

/**
 * A real header brand mark is a purpose-built logo: a square-ish icon or tight
 * wordmark. A site's og:image / social share banner is a different artifact —
 * the logo artwork floated on a wide marketing canvas — and crawlers often
 * surface the same file as both the logo candidate and a gallery photo. Crammed
 * into the 42px square header slot it renders as an illegible speck on a white
 * field, so it reads far worse than the typographic lockup fallback.
 *
 * Signal: the chosen logo is byte-identical (content hash) to a scraped photo
 * AND is not near-square. The hash collision alone is too aggressive — some
 * businesses legitimately reuse a clean square logo as their og:image — so we
 * only demote when both hold. Palette sampling still reads the logo bytes from
 * the manifest, so dropping the brand-mark reference costs no brand color.
 */
const maxSquareBrandAspect = 1.4;
const maxWideWordmarkAspect = 2.8;

function rejectNonLogoBrandMark(bundle: SiteBundle, manifest: ScrapedMediaManifestEntry[]): void {
  const logo = bundle.businessProfile.logo;
  if (!logo) return;
  const logoEntry = manifest.find((entry) => entry.kind === "logo" && entry.storedUrl === logo.url);
  if (!logoEntry) return;
  const photoHashes = new Set(manifest.filter((entry) => entry.kind === "photo").map((entry) => entry.contentHash));
  if (!photoHashes.has(logoEntry.contentHash)) return;
  const width = logoEntry.width ?? logo.width;
  const height = logoEntry.height ?? logo.height;
  // Unmeasurable dimensions: a hash collision with a photo is itself enough to
  // distrust the brand mark, so demote rather than risk a banner in the slot.
  const aspect = width && height ? Math.max(width, height) / Math.min(width, height) : maxSquareBrandAspect + 1;
  if (aspect <= maxSquareBrandAspect) return;
  const logoSignals = `${logo.alt ?? ""} ${logoEntry.originalUrl} ${logo.url}`;
  if (aspect <= maxWideWordmarkAspect && /\blogo\b|wordmark|brand\s*mark|brandmark/i.test(logoSignals)) return;
  bundle.businessProfile.logo = undefined;
  bundle.presenceAssessment.technicalNotes.push(
    `Logo demoted to typographic lockup: brand mark is a non-square duplicate of a scraped photo (likely the og:image), not a purpose-built logo.`
  );
}

/**
 * Measure-then-choose logo selection: download the crawl's ranked logo
 * candidates and decide by real pixels, not URL guesses. The first
 * retina-adequate candidate wins; otherwise the largest measured one is
 * stored anyway — palette sampling still wants the brand pixels even when
 * the renderer falls back to the typographic lockup.
 */
async function chooseAndStoreLogo(
  bundle: SiteBundle,
  store: (
    reference: AssetReference,
    kind: "photo" | "logo",
    index: number,
    downloaded?: Awaited<ReturnType<typeof downloadImage>>
  ) => Promise<AssetReference>
): Promise<AssetReference | undefined> {
  const profile = bundle.businessProfile;
  const candidates = (profile.logoCandidates?.length ? profile.logoCandidates : profile.logo ? [profile.logo] : []).filter(
    (candidate) => candidate.rightsStatus === "reference_only" && /^https?:/i.test(candidate.url)
  );
  if (!candidates.length) return profile.logo;

  const fallbacks: { candidate: AssetReference; downloaded: NonNullable<Awaited<ReturnType<typeof downloadImage>>>; minSide: number }[] = [];
  for (const candidate of candidates) {
    const downloaded = await downloadImage(candidate.url);
    if (!downloaded) continue;
    const dimensions = measureImageDimensions(downloaded.bytes, downloaded.mimeType);
    // Unmeasurable bytes rank just below the threshold: never auto-picked over
    // an adequate candidate, but ahead of a measured favicon-sized one.
    const minSide = dimensions ? Math.min(dimensions.width, dimensions.height) : minUsableLogoPx - 1;
    if (minSide >= minUsableLogoPx) return store(candidate, "logo", 0, downloaded);
    fallbacks.push({ candidate, downloaded, minSide });
  }
  const best = [...fallbacks].sort((left, right) => right.minSide - left.minSide)[0];
  if (best) return store(best.candidate, "logo", 0, best.downloaded);
  return profile.logo;
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
  // Stamp measured dimensions onto the profile references the renderer reads,
  // so render surfaces can refuse to display an asset above its natural size.
  const stampDimensions = (reference: AssetReference): AssetReference => {
    const entry = dimensionsByUrl.get(reference.url);
    if (!entry?.width || !entry?.height) return reference;
    return { ...reference, width: entry.width, height: entry.height };
  };
  bundle.businessProfile.photos = bundle.businessProfile.photos.map(stampDimensions);
  if (bundle.businessProfile.logo) {
    bundle.businessProfile.logo = stampDimensions(bundle.businessProfile.logo);
  }
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
