import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import {
  imageMimeTypeMatchesBytes,
  isSupportedAssetMimeType,
  storeAssetBytes,
  type SupportedAssetMimeType
} from "@/lib/asset-storage";
import { validatePublicHostname } from "@/lib/url-safety";

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
  photoUploads: z.array(uploadInputSchema).max(12).optional(),
  rightsAccepted: z.boolean()
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

  const result = await repository.updateOwnerAssets({
    siteId: parsed.data.siteId,
    rightsAccepted: parsed.data.rightsAccepted,
    logo: materialized.logo ?? parsed.data.logo,
    photos: [...(parsed.data.photos ?? []), ...materialized.photos]
  });
  if (!result) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
  if (!result.ok) return applyRateLimitHeaders(NextResponse.json({ error: result.reason }, { status: 400 }), limit);

  return applyRateLimitHeaders(
    NextResponse.json({
      ok: true,
      logo: result.logo,
      photos: result.photos,
      assets: result.assets
    }),
    limit
  );
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
    rightsAccepted: booleanValue(formData.get("rightsAccepted")),
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
      ? await uploadFromFile(logoFile, stringValue(formData.get("logoAlt")) || "Owner-provided logo")
      : undefined,
    photoUploads: await Promise.all(
      photoFiles.slice(0, 12).map((file, index) => uploadFromFile(file, photoAlts[index] || `Owner-provided photo ${index + 1}`))
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
    alt: input.upload.alt
  };
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: FormDataEntryValue | null) {
  return value === "true" || value === "on" || value === "1";
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
