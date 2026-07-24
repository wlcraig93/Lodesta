import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import {
  imageMimeTypeMatchesBytes,
  isSupportedAssetMimeType,
  readStoredAsset,
  storeAssetBytes,
  type SupportedAssetMimeType
} from "@/lib/asset-storage";
import { assertPublicFetchUrl, validatePublicHostname } from "@/lib/url-safety";
import { getCurrentUser } from "@/lib/supabase/server";
import { createHash } from "node:crypto";
import { controlPlaneService } from "@/packages/control-plane";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { AssetRevisionRef, AssetRevision } from "@/packages/site-contracts";
import { configuredAppOriginOrDefault } from "@/lib/app-origin";
import sharp from "sharp";

export const runtime = "nodejs";

const maxOwnerAssetBytes = 5 * 1024 * 1024;
const maxBase64Length = Math.ceil((maxOwnerAssetBytes * 4) / 3) + 128;

const assetInputSchema = z.object({
  url: z.string().refine(isAllowedOwnerAssetUrl, "Asset URL must be an HTTP(S) image URL or a platform-hosted asset URL."),
  alt: z.string().min(1).max(180)
});

const uploadInputSchema = z.object({
  base64: z.string().min(1).max(maxBase64Length),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  alt: z.string().min(1).max(180),
  fileName: z.string().max(180).optional()
});

const ownerAssetsSchema = z.object({
  siteId: z.string().min(1),
  logo: assetInputSchema.optional(),
  photos: z.array(assetInputSchema).max(12).optional(),
  logoUpload: uploadInputSchema.optional(),
  photoUploads: z.array(uploadInputSchema).max(12).optional()
});

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "owner_assets",
    limit: 10,
    windowMs: 10 * 60_000
  });
  if (!limit.ok) return limit.response;

  const parsed = await parseOwnerAssetsRequest(request);
  if (!parsed.ok) {
    return applyRateLimitHeaders(NextResponse.json(parsed.body, { status: 400 }), limit);
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);

  const materialized = await materializeUploads(parsed.data);
  if (!materialized.ok) {
    return applyRateLimitHeaders(NextResponse.json({ error: materialized.error }, { status: 400 }), limit);
  }

  const auth = await getCurrentUser();
  const uploadedBy = auth.user?.id ?? "platform_admin";

  const site = await sitePlatformRepository.getSite(parsed.data.siteId);
  const state = site ? await sitePlatformRepository.getBusinessState(site.businessId) : undefined;
  if (!site || !state) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown canonical site" }, { status: 404 }), limit);
  const retainedLogo = await retainOwnerAssets(parsed.data.siteId, [materialized.logo ?? parsed.data.logo].filter(isOwnerAssetRow));
  const retainedPhotos = await retainOwnerAssets(parsed.data.siteId, [...(parsed.data.photos ?? []), ...materialized.photos]);
  const requested = [
    ...assetRegistrations({
      businessId: state.businessId,
      kind: "logo",
      rows: retainedLogo,
      uploadedBy
    }),
    ...assetRegistrations({
      businessId: state.businessId,
      kind: "photo",
      rows: retainedPhotos,
      uploadedBy
    })
  ];
  if (!requested.length) {
    return applyRateLimitHeaders(NextResponse.json({ error: "No owner assets were provided." }, { status: 400 }), limit);
  }
  try {
    for (const payload of requested) {
      await controlPlaneService.submit({ siteId: parsed.data.siteId, payload, requestedBy: uploadedBy });
    }
  } catch (error) {
    return applyRateLimitHeaders(NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }), limit);
  }
  const updated = await sitePlatformRepository.getBusinessState(state.businessId);
  const assets = updated?.assets ?? [];
  const logoAsset = assets.find((asset) => asset.kind === "logo" && asset.publicUrl);
  const photoAssets = assets.filter((asset) => asset.kind === "photo" && asset.publicUrl);

  return applyRateLimitHeaders(
    NextResponse.json({
      ok: true,
      logo: logoAsset ? { url: logoAsset.publicUrl, alt: logoAsset.alt } : undefined,
      photos: photoAssets.map((asset) => ({ url: asset.publicUrl!, alt: asset.alt })),
      assets
    }),
    limit
  );
}

function assetRegistrations(input: {
  businessId: string;
  kind: "logo" | "photo";
  rows: OwnerAssetRow[];
  uploadedBy: string;
}) {
  return input.rows.map((row) => {
    const now = new Date().toISOString();
    const contentHash = prefixedSha256(row.contentHash);
    const assetId = `asset_${crypto.randomUUID().replace(/-/g, "")}`;
    const revisionId = `assetrev_${crypto.randomUUID().replace(/-/g, "")}`;
    const publicUrl = absolutePublicAssetUrl(row.url);
    const revision: AssetRevision = {
      schemaVersion: 1,
      id: revisionId,
      assetId,
      businessId: input.businessId,
      contentHash,
      storageKey: row.storagePath,
      publicUrl,
      mimeType: row.mimeType,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      origin: "owner_upload",
      provenance: {
        origin: "owner_upload",
        uploadedBy: input.uploadedBy,
        ...(row.fileName ? { originalFileName: row.fileName } : {})
      },
      createdAt: now
    };
    const asset: AssetRevisionRef = {
      assetId,
      revisionId,
      kind: input.kind,
      alt: row.alt,
      contentHash,
      storageKey: row.storagePath,
      publicUrl,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      origin: "owner_upload",
      sourceFactIds: [],
      activeForFutureBuilds: true
    };
    return { kind: "register_asset" as const, asset, revision };
  });
}

type OwnerAssetRow = {
  url: string;
  alt: string;
  fileName?: string;
  contentHash: string;
  storagePath: string;
  mimeType: AssetRevision["mimeType"];
  bytes: number;
  width: number;
  height: number;
};

function isOwnerAssetRow(value: unknown): value is { url: string; alt: string } {
  return Boolean(value && typeof value === "object" && "url" in value);
}

async function retainOwnerAssets(siteId: string, rows: Array<{ url: string; alt: string } & Partial<OwnerAssetRow>>) {
  const retained: OwnerAssetRow[] = [];
  for (const row of rows) {
    if (row.contentHash && row.storagePath && row.mimeType && row.bytes && row.width && row.height) {
      retained.push(row as OwnerAssetRow);
      continue;
    }
    const localPath = row.url.match(/^\/api\/assets\/(.+)$/)?.[1];
    if (localPath) {
      const stored = await readStoredAsset(localPath);
      if (!stored || !isSupportedAssetMimeType(stored.mimeType) || !imageMimeTypeMatchesBytes(stored.mimeType, stored.bytes)) {
        throw new Error(`Retained owner asset ${row.alt} could not be read.`);
      }
      const dimensions = await imageDimensions(stored.bytes);
      retained.push({
        url: row.url,
        alt: row.alt,
        contentHash: `sha256:${createHash("sha256").update(stored.bytes).digest("hex")}`,
        storagePath: localPath,
        mimeType: stored.mimeType,
        bytes: stored.bytes.byteLength,
        ...dimensions
      });
      continue;
    }
    const safeUrl = await assertPublicFetchUrl(row.url);
    const response = await fetch(safeUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "image/png,image/jpeg,image/webp" },
      redirect: "error"
    });
    if (!response.ok) throw new Error(`Could not retain owner asset ${row.alt}.`);
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!isSupportedAssetMimeType(mimeType)) throw new Error(`Owner asset ${row.alt} is not PNG, JPEG, or WebP.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > maxOwnerAssetBytes || !imageMimeTypeMatchesBytes(mimeType, bytes)) {
      throw new Error(`Owner asset ${row.alt} failed image validation.`);
    }
    const dimensions = await imageDimensions(bytes);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const stored = await storeAssetBytes({
      siteId,
      assetId: `owner-retained-${contentHash.slice(0, 20)}`,
      bytes,
      mimeType
    });
    if (!stored.url) throw new Error(`Owner asset ${row.alt} could not be retained.`);
    retained.push({
      url: stored.url,
      alt: row.alt,
      contentHash,
      storagePath: stored.storagePath,
      mimeType,
      bytes: stored.bytes,
      ...dimensions
    });
  }
  return retained;
}

type ParsedOwnerAssetsRequest =
  | { ok: true; data: z.infer<typeof ownerAssetsSchema> }
  | { ok: false; body: { error: string; issues?: unknown } };

async function parseOwnerAssetsRequest(request: Request): Promise<ParsedOwnerAssetsRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return parseMultipartOwnerAssetsRequest(request);
  }

  const body = await request.json().catch(() => null);
  const parsed = ownerAssetsSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, body: { error: "Invalid owner asset request", issues: parsed.error.issues } };
  }
  return { ok: true, data: parsed.data };
}

async function parseMultipartOwnerAssetsRequest(request: Request): Promise<ParsedOwnerAssetsRequest> {
  const formData = await request.formData().catch(() => null);
  if (!formData) return { ok: false, body: { error: "Invalid multipart owner asset request" } };

  const logoFile = fileValue(formData.get("logoFile") ?? formData.get("logo"));
  const photoFiles = formData.getAll("photoFiles").map(fileValue).filter((file): file is File => Boolean(file));
  const photoAlts = formData.getAll("photoAlt").map(stringValue);
  const photoUrls = formData
    .getAll("photoUrl")
    .map(stringValue)
    .filter(Boolean);
  const photoUrlAlts = formData.getAll("photoUrlAlt").map(stringValue);

  const data = {
    siteId: stringValue(formData.get("siteId")),
    logo: stringValue(formData.get("logoUrl"))
      ? {
          url: stringValue(formData.get("logoUrl")),
          alt: stringValue(formData.get("logoAlt")) || "Owner-provided logo"
        }
      : undefined,
    photos: photoUrls.map((url, index) => ({
      url,
      alt: photoUrlAlts[index] || `Owner-provided photo ${index + 1}`
    })),
    logoUpload: logoFile
      ? {
          ...(await uploadFromFile(logoFile, stringValue(formData.get("logoAlt")) || "Owner-provided logo"))
        }
      : undefined,
    photoUploads: await Promise.all(
      photoFiles.slice(0, 12).map(async (file, index) => ({
        ...(await uploadFromFile(file, photoAlts[index] || `Owner-provided photo ${index + 1}`))
      }))
    )
  };
  const parsed = ownerAssetsSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, body: { error: "Invalid owner asset request", issues: parsed.error.issues } };
  }
  return { ok: true, data: parsed.data };
}

async function uploadFromFile(file: File, alt: string) {
  return {
    base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    mimeType: file.type,
    alt,
    fileName: file.name
  };
}

async function materializeUploads(data: z.infer<typeof ownerAssetsSchema>) {
  const logo = data.logoUpload
    ? await storeOwnerAssetUpload({
        siteId: data.siteId,
        kind: "logo",
        index: 0,
        upload: data.logoUpload
      })
    : undefined;
  if (logo && "error" in logo) return { ok: false as const, error: logo.error };

  const photos = [];
  for (const [index, upload] of (data.photoUploads ?? []).entries()) {
    const photo = await storeOwnerAssetUpload({ siteId: data.siteId, kind: "photo", index, upload });
    if ("error" in photo) return { ok: false as const, error: photo.error };
    photos.push(photo);
  }

  return {
    ok: true as const,
    logo,
    photos
  };
}

async function storeOwnerAssetUpload(input: {
  siteId: string;
  kind: "logo" | "photo";
  index: number;
  upload: z.infer<typeof uploadInputSchema>;
}) {
  if (!isSupportedAssetMimeType(input.upload.mimeType)) {
    return { error: "Owner asset uploads must be PNG, JPEG, or WebP images." };
  }

  const bytes = Buffer.from(input.upload.base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxOwnerAssetBytes) {
    return { error: "Owner asset uploads must be between 1 byte and 5 MB." };
  }
  if (!imageMimeTypeMatchesBytes(input.upload.mimeType as SupportedAssetMimeType, bytes)) {
    return { error: "Owner asset upload content does not match the declared image type." };
  }
  const dimensions = await imageDimensions(bytes).catch(() => undefined);
  if (!dimensions) return { error: "Owner asset upload is corrupt or has unsupported dimensions." };

  const stored = await storeAssetBytes({
    siteId: input.siteId,
    assetId: `owner-${input.kind}-${input.index + 1}-${crypto.randomUUID()}`,
    bytes,
    mimeType: input.upload.mimeType as SupportedAssetMimeType
  });
  if (!stored.url) {
    return { error: "Owner asset upload did not produce a public asset URL." };
  }
  return {
    url: stored.url,
    alt: input.upload.alt,
    fileName: input.upload.fileName,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    storagePath: stored.storagePath,
    mimeType: input.upload.mimeType as AssetRevision["mimeType"],
    bytes: stored.bytes,
    ...dimensions
  };
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function fileValue(value: FormDataEntryValue | null) {
  return typeof File !== "undefined" && value instanceof File && value.size > 0 ? value : undefined;
}

function isAllowedOwnerAssetUrl(value: string) {
  if (/^\/api\/assets\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*\.(png|jpe?g|webp)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    const hostnameCheck = validatePublicHostname(url.hostname);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      hostnameCheck.ok &&
      /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(url.href)
    );
  } catch {
    return false;
  }
}

function absolutePublicAssetUrl(value: string) {
  return value.startsWith("/") ? new URL(value, configuredAppOriginOrDefault()).toString() : value;
}

function prefixedSha256(value: string) {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

async function imageDimensions(bytes: Buffer) {
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image dimensions could not be decoded.");
  return { width: metadata.width, height: metadata.height };
}
